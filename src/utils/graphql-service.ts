import { LinearClient } from "@linear/sdk";
import { type DocumentNode, print } from "graphql";
import type { LinearCredential } from "../auth/linear-credential.js";
import type { OAuthState } from "../auth/oauth-storage.js";
import {
	ensureFreshAccessToken,
	getActiveAuth,
} from "../auth/token-resolver.js";
import type { GraphQLResponseData, GraphQLVariables } from "../types/linear.js";
import type { AuthOptions } from "./auth.js";
import {
	graphQLErrorCode,
	graphQLErrorHttpStatus,
	toLinearGraphQLError,
} from "./linear-graphql-error.js";
import { logger } from "./logger.js";
import { type RateLimitInfo, recordRateLimitInfo } from "./output.js";
import {
	createOAuthProfileRateLimitAdmission,
	createRateLimitAdmission,
	type RateLimitAdmission,
	RateLimitAdmissionRefusal,
} from "./rate-limit-admission.js";

interface ResponseHeaders {
	get(name: string): string | null;
}

interface GraphQLRawClient {
	setHeader(name: string, value: string): void;
	rawRequest: <T>(
		query: string,
		variables?: GraphQLVariables,
	) => Promise<{ data: T; headers?: ResponseHeaders; status?: number }>;
}

export interface GraphQLRequestOptions {
	/**
	 * Retry only an operation whose mutation is safe to repeat. Callers must
	 * opt in; creates and comment writes intentionally retain one-shot
	 * semantics because a transport failure can leave their server-side result
	 * unknown.
	 */
	retrySafeMutation?: boolean;
}

interface GraphQLServiceRuntimeOptions {
	retryDelaysMs?: readonly number[];
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	/** Test/embedding seam; production derives this from EL_LINEAR_RATE_LIMIT_HEADROOM. */
	admission?: RateLimitAdmission;
	/** Reacquire an app-user client-credentials token after HTTP 401. */
	renewAccessToken?: () => Promise<string>;
}

const DEFAULT_SAFE_MUTATION_RETRY_DELAYS_MS = [150, 400] as const;

type OAuthStateRenewal = (
	state: OAuthState,
	options: { forceOAuthRenewal: true },
) => Promise<OAuthState>;

/**
 * Keep the last persisted client-credentials state in a long-lived service.
 * Each forced 401 renewal must advance from the previous renewal, not from the
 * state captured when the service was constructed.
 */
export function createClientCredentialsTokenRenewal(
	initialState: OAuthState,
	renew: OAuthStateRenewal = ensureFreshAccessToken,
): (() => Promise<string>) | undefined {
	if (initialState.grantType !== "client_credentials") return undefined;
	let currentState = initialState;
	return async () => {
		currentState = await renew(currentState, { forceOAuthRenewal: true });
		return currentState.accessToken;
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface GraphQLErrorDetail {
	type?: string;
	status?: number;
	retryAfter?: number;
	requestsLimit?: number;
	requestsRemaining?: number;
	requestsResetAt?: number;
	response?: GraphQLErrorResponse;
	raw?: { response?: GraphQLErrorResponse };
	errors?: Array<{
		message?: string;
		type?: string;
		extensions?: { code?: string; type?: string };
	}>;
}

interface GraphQLErrorResponse {
	status?: number;
	statusCode?: number;
	headers?: ResponseHeaders | Record<string, string | undefined>;
	errors?: GraphQLErrorDetail["errors"];
}

function errorDetail(error: unknown): GraphQLErrorDetail {
	return error as GraphQLErrorDetail;
}

function errorResponse(error: unknown): GraphQLErrorResponse | undefined {
	const detail = errorDetail(error);
	return detail.response ?? detail.raw?.response;
}

function headerValue(
	headers: GraphQLErrorResponse["headers"] | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	if ("get" in headers && typeof headers.get === "function") {
		return headers.get(name) ?? undefined;
	}
	const expected = name.toLowerCase();
	const entry = Object.entries(headers).find(
		([key]) => key.toLowerCase() === expected,
	);
	return entry?.[1];
}

function finiteNumber(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function resetAtFromRetryAfter(
	value: string | number | undefined,
	now: () => number,
): string | undefined {
	if (value === undefined) return undefined;
	const seconds = finiteNumber(value);
	if (seconds !== undefined) {
		return new Date(now() + seconds * 1_000).toISOString();
	}
	if (typeof value === "string") {
		const timestamp = Date.parse(value);
		if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
	}
	return undefined;
}

export function extractRateLimitInfo(
	source: unknown,
	now: () => number,
): RateLimitInfo | undefined {
	const detail = errorDetail(source);
	const response = errorResponse(source) ?? (source as GraphQLErrorResponse);
	const headers = response?.headers;
	const limit = finiteNumber(
		detail.requestsLimit ?? headerValue(headers, "x-ratelimit-requests-limit"),
	);
	const remaining = finiteNumber(
		detail.requestsRemaining ??
			headerValue(headers, "x-ratelimit-requests-remaining"),
	);
	const resetTimestamp = finiteNumber(
		detail.requestsResetAt ??
			headerValue(headers, "x-ratelimit-requests-reset"),
	);
	const resetAt =
		resetTimestamp !== undefined
			? new Date(resetTimestamp).toISOString()
			: resetAtFromRetryAfter(
					detail.retryAfter ?? headerValue(headers, "retry-after"),
					now,
				);
	const complexityCost = finiteNumber(headerValue(headers, "x-complexity"));
	const complexityLimit = finiteNumber(
		headerValue(headers, "x-ratelimit-complexity-limit"),
	);
	const complexityRemaining = finiteNumber(
		headerValue(headers, "x-ratelimit-complexity-remaining"),
	);
	const complexityResetTimestamp = finiteNumber(
		headerValue(headers, "x-ratelimit-complexity-reset"),
	);
	const endpointName = headerValue(headers, "x-ratelimit-endpoint-name");
	const endpointLimit = finiteNumber(
		headerValue(headers, "x-ratelimit-endpoint-requests-limit"),
	);
	const endpointRemaining = finiteNumber(
		headerValue(headers, "x-ratelimit-endpoint-requests-remaining"),
	);
	const endpointResetTimestamp = finiteNumber(
		headerValue(headers, "x-ratelimit-endpoint-requests-reset"),
	);
	const hasComplexity =
		complexityCost !== undefined ||
		complexityLimit !== undefined ||
		complexityRemaining !== undefined ||
		complexityResetTimestamp !== undefined;
	const hasEndpoint =
		endpointName !== undefined ||
		endpointLimit !== undefined ||
		endpointRemaining !== undefined ||
		endpointResetTimestamp !== undefined;
	if (
		limit === undefined &&
		remaining === undefined &&
		resetAt === undefined &&
		!hasComplexity &&
		!hasEndpoint
	) {
		return undefined;
	}
	return {
		limit,
		remaining,
		resetAt,
		observedRequests: 1,
		minimumRemaining: remaining,
		...(hasComplexity
			? {
					complexity: {
						cost: complexityCost,
						totalCost: complexityCost,
						limit: complexityLimit,
						remaining: complexityRemaining,
						minimumRemaining: complexityRemaining,
						resetAt:
							complexityResetTimestamp === undefined
								? undefined
								: new Date(complexityResetTimestamp).toISOString(),
					},
				}
			: {}),
		...(hasEndpoint
			? {
					endpoints: {
						[endpointName ?? "unknown"]: {
							limit: endpointLimit,
							remaining: endpointRemaining,
							minimumRemaining: endpointRemaining,
							resetAt:
								endpointResetTimestamp === undefined
									? undefined
									: new Date(endpointResetTimestamp).toISOString(),
							observedRequests: 1,
						},
					},
				}
			: {}),
	};
}

/** True for both HTTP and GraphQL representations of Linear rate limiting. */
export function isRateLimitGraphQLError(error: unknown): boolean {
	const detail = errorDetail(error);
	if (
		graphQLErrorHttpStatus(error) === 429 ||
		graphQLErrorCode(error)?.toUpperCase() === "RATELIMITED" ||
		detail.type?.toLowerCase() === "ratelimited"
	) {
		return true;
	}
	return /\b(?:429|rate[- ]?limit(?:ed| exceeded))\b/i.test(
		errorMessage(error),
	);
}

/**
 * True only for failures where retrying a known-idempotent request immediately
 * is useful. This deliberately differs from published `errorDetail.retryable`:
 * a rate limit is transient for an external caller with reset-aware backoff,
 * but must never enter this CLI's 150 ms / 400 ms retry loop.
 */
export function isTransientGraphQLError(error: unknown): boolean {
	if (isRateLimitGraphQLError(error)) return false;
	const status = graphQLErrorHttpStatus(error);
	if (status === 408 || (status !== null && status >= 500)) {
		return true;
	}
	return /\b(?:408|500|502|503|504)\b|(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network error|connection termination)/i.test(
		errorMessage(error),
	);
}

function isMutationOperation(query: string): boolean {
	const withoutLeadingComments = query.replace(/^(?:\s*#[^\n]*(?:\n|$))*/, "");
	return /^\s*mutation\b/i.test(withoutLeadingComments);
}

function rateLimitError(
	error: unknown,
	query: string,
	now: () => number,
): Error {
	const rateLimit = extractRateLimitInfo(error, now);
	const details: string[] = [];
	if (rateLimit?.remaining !== undefined && rateLimit.limit !== undefined) {
		details.push(
			`${rateLimit.remaining}/${rateLimit.limit} requests remain in the current window`,
		);
	}
	if (rateLimit?.resetAt) {
		details.push(`the request limit resets at ${rateLimit.resetAt}`);
	}
	const suffix = details.length > 0 ? ` ${details.join("; ")}.` : "";
	const ambiguity = isMutationOperation(query)
		? " This mutation may have been applied; verify its outcome before retrying."
		: "";
	return toLinearGraphQLError(
		error,
		`GraphQL request failed: Rate limit exceeded.${suffix}${ambiguity}`,
	);
}

/**
 * Constructor arg for `GraphQLService`. Re-exported alias of the shared
 * `LinearCredential` union (`{ apiKey } | { oauthToken }`). Kept as a
 * named local export so call sites that already import
 * `GraphQLServiceAuth` keep compiling — the alias collapses through to
 * the shared shape.
 *
 * The bare-string legacy arm was dropped in DEV-4068 T7. Tests now
 * construct with `{ apiKey: "test-token" }` (mechanical rewrite, no
 * semantic change — same `Authorization: <token>` header is emitted).
 */
export type GraphQLServiceAuth = LinearCredential;

function buildLinearClient(auth: GraphQLServiceAuth): LinearClient {
	const baseHeaders = { "public-file-urls-expire-in": "3600" };
	if ("oauthToken" in auth) {
		// Linear's SDK natively supports OAuth via the `accessToken` option,
		// which causes the underlying graphql-request client to send
		// `Authorization: Bearer <token>` instead of the personal-token
		// shape (`Authorization: <token>`).
		return new LinearClient({
			accessToken: auth.oauthToken,
			headers: baseHeaders,
		});
	}
	return new LinearClient({ apiKey: auth.apiKey, headers: baseHeaders });
}

interface InstrumentableTransport {
	rawRequest<T>(
		query: string,
		variables?: GraphQLVariables,
		requestHeaders?: Record<string, string>,
	): Promise<{ data: T; headers?: ResponseHeaders; status?: number }>;
	request<T>(
		document: string | DocumentNode,
		variables?: GraphQLVariables,
		requestHeaders?: Record<string, string>,
	): Promise<T>;
}

async function persistRateLimitObservation(
	admission: RateLimitAdmission,
	info: RateLimitInfo,
): Promise<void> {
	recordRateLimitInfo(info);
	try {
		await admission.observe(info);
	} catch (error) {
		// The request already completed. Never turn an observation write
		// failure into a replayable command failure (especially for mutations).
		const message = error instanceof Error ? error.message : String(error);
		logger.error(
			`[rate-limit] could not persist quota observation: ${message}`,
		);
	}
}

/**
 * Put SDK-backed LinearService calls through the same quota admission and
 * response-header observer as custom GraphQLService calls. The SDK's public
 * `request()` discards response headers, so this narrow transport adapter uses
 * its own public-ish rawRequest escape hatch and returns only `data` to the
 * generated SDK models, preserving their existing contract.
 */
export function instrumentLinearClient(
	client: LinearClient,
	auth: GraphQLServiceAuth,
	options: { admission?: RateLimitAdmission; now?: () => number } = {},
): LinearClient {
	const transport = (client as unknown as { client?: InstrumentableTransport })
		.client;
	// Unit-test doubles and future SDK versions may not expose the escape hatch.
	// Leave them untouched rather than manufacturing a partial transport.
	if (!transport?.rawRequest || !transport.request) return client;
	const originalRawRequest = transport.rawRequest.bind(transport);
	const admission =
		options.admission ?? createRateLimitAdmission(auth, { now: options.now });
	const now = options.now ?? Date.now;

	transport.request = async <T>(
		document: string | DocumentNode,
		variables?: GraphQLVariables,
		requestHeaders?: Record<string, string>,
	): Promise<T> => {
		await admission.admit();
		const query = typeof document === "string" ? document : print(document);
		try {
			const response = await originalRawRequest<T>(
				query,
				variables,
				requestHeaders,
			);
			const rateLimit = extractRateLimitInfo(response, now);
			if (rateLimit) await persistRateLimitObservation(admission, rateLimit);
			return response.data;
		} catch (error) {
			const rateLimit = extractRateLimitInfo(error, now);
			if (rateLimit) await persistRateLimitObservation(admission, rateLimit);
			throw error;
		}
	};
	return client;
}

export class GraphQLService {
	private readonly graphQLClient: GraphQLRawClient;
	private readonly retryDelaysMs: readonly number[];
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly now: () => number;
	private readonly admission: RateLimitAdmission;
	private readonly renewAccessToken?: () => Promise<string>;

	constructor(
		auth: GraphQLServiceAuth,
		options: GraphQLServiceRuntimeOptions = {},
	) {
		const client = buildLinearClient(auth);
		// LinearClient stores a private graphql-request client — access via escape hatch
		this.graphQLClient = (
			client as unknown as { client: GraphQLRawClient }
		).client;
		this.retryDelaysMs =
			options.retryDelaysMs ?? DEFAULT_SAFE_MUTATION_RETRY_DELAYS_MS;
		this.sleep =
			options.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.now = options.now ?? Date.now;
		this.admission =
			options.admission ?? createRateLimitAdmission(auth, { now: this.now });
		this.renewAccessToken = options.renewAccessToken;
	}

	private async observeRateLimit(info: RateLimitInfo): Promise<void> {
		await persistRateLimitObservation(this.admission, info);
	}

	// Default type allows property access on raw GraphQL responses.
	// Callers can narrow with explicit type parameter: rawRequest<{ issues: { nodes: T[] } }>(...)
	async rawRequest<T = GraphQLResponseData>(
		query: string,
		variables?: GraphQLVariables,
		options: GraphQLRequestOptions = {},
	): Promise<T> {
		let attempt = 0;
		let renewedAfterUnauthorized = false;
		try {
			while (true) {
				try {
					await this.admission.admit();
					const response = await this.graphQLClient.rawRequest<T>(
						query,
						variables,
					);
					const rateLimit = extractRateLimitInfo(response, this.now);
					if (rateLimit) await this.observeRateLimit(rateLimit);
					return response.data;
				} catch (error) {
					if (error instanceof RateLimitAdmissionRefusal) throw error;
					const rateLimit = extractRateLimitInfo(error, this.now);
					if (rateLimit) await this.observeRateLimit(rateLimit);
					if (
						!renewedAfterUnauthorized &&
						this.renewAccessToken &&
						graphQLErrorHttpStatus(error) === 401
					) {
						const token = await this.renewAccessToken();
						this.graphQLClient.setHeader("authorization", `Bearer ${token}`);
						renewedAfterUnauthorized = true;
						continue;
					}
					if (
						!options.retrySafeMutation ||
						attempt >= this.retryDelaysMs.length ||
						!isTransientGraphQLError(error)
					) {
						throw error;
					}
					await this.sleep(this.retryDelaysMs[attempt]);
					attempt += 1;
				}
			}
		} catch (error: unknown) {
			if (error instanceof RateLimitAdmissionRefusal) throw error;
			if (isRateLimitGraphQLError(error)) {
				throw rateLimitError(error, query, this.now);
			}
			const err = error as {
				response?: { errors?: Array<{ message?: string }> };
				message?: string;
			};
			// The message text is byte-identical to what the plain `Error`
			// carried before DEV-7987; only the classification is new, so
			// callers matching on the message are untouched.
			const message = err.response?.errors
				? err.response.errors[0]?.message || "GraphQL query failed"
				: `GraphQL request failed: ${err.message}`;
			// This is the ONLY place a Linear GraphQL failure leaves the
			// service, so it is the only place that has to attach the
			// classification. Any future branch that throws its own shaped
			// message from here must go through `toLinearGraphQLError` too, or
			// that failure silently loses its `errorDetail` on the envelope.
			throw toLinearGraphQLError(error, message);
		}
	}
}

export async function createGraphQLService(
	options: AuthOptions,
): Promise<GraphQLService> {
	const auth = await getActiveAuth(options);
	if (auth.kind === "oauth") {
		const credential = { oauthToken: auth.token } as const;
		return new GraphQLService(credential, {
			admission: createOAuthProfileRateLimitAdmission(
				credential,
				auth.oauth.clientId,
				auth.oauth.viewerId,
			),
			renewAccessToken: createClientCredentialsTokenRenewal(auth.oauth),
		});
	}
	return new GraphQLService({ apiKey: auth.token });
}
