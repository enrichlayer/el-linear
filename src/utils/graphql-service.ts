import { LinearClient } from "@linear/sdk";
import type { LinearCredential } from "../auth/linear-credential.js";
import { getActiveAuth } from "../auth/token-resolver.js";
import type { GraphQLResponseData, GraphQLVariables } from "../types/linear.js";
import type { AuthOptions } from "./auth.js";
import { toLinearGraphQLError } from "./linear-graphql-error.js";

interface GraphQLRawClient {
	rawRequest: <T>(
		query: string,
		variables?: GraphQLVariables,
	) => Promise<{ data: T }>;
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
}

const DEFAULT_SAFE_MUTATION_RETRY_DELAYS_MS = [150, 400] as const;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * True only for failures where retrying a known-idempotent request is useful.
 *
 * Deliberately NOT the same predicate as the `errorDetail.retryable` this
 * CLI publishes (DEV-7987). They answer different questions. This one gates
 * an IMMEDIATE in-process retry, 150 ms then 400 ms later — a rate limit is
 * a terrible candidate for that, because the window resets minutes away.
 * `retryable` answers whether the failure is transient at all, for an
 * external caller that owns a real backoff (a Temporal activity), where a
 * rate limit is exactly what you want retried. Collapsing the two would
 * force one of them to be wrong.
 */
export function isTransientGraphQLError(error: unknown): boolean {
	const detail = error as {
		response?: { status?: number; statusCode?: number };
	};
	const status = detail.response?.status ?? detail.response?.statusCode;
	if (
		status === 408 ||
		status === 429 ||
		(status !== undefined && status >= 500)
	) {
		return true;
	}
	return /\b(?:408|429|500|502|503|504)\b|(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network error|connection termination)/i.test(
		errorMessage(error),
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

export class GraphQLService {
	private readonly graphQLClient: GraphQLRawClient;
	private readonly retryDelaysMs: readonly number[];
	private readonly sleep: (ms: number) => Promise<void>;

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
	}

	// Default type allows property access on raw GraphQL responses.
	// Callers can narrow with explicit type parameter: rawRequest<{ issues: { nodes: T[] } }>(...)
	async rawRequest<T = GraphQLResponseData>(
		query: string,
		variables?: GraphQLVariables,
		options: GraphQLRequestOptions = {},
	): Promise<T> {
		let attempt = 0;
		try {
			while (true) {
				try {
					const response = await this.graphQLClient.rawRequest<T>(
						query,
						variables,
					);
					return response.data;
				} catch (error) {
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
		return new GraphQLService({ oauthToken: auth.token });
	}
	return new GraphQLService({ apiKey: auth.token });
}
