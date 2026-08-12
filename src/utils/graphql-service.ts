import { LinearClient } from "@linear/sdk";
import type { LinearCredential } from "../auth/linear-credential.js";
import { getActiveAuth } from "../auth/token-resolver.js";
import type { GraphQLResponseData, GraphQLVariables } from "../types/linear.js";
import type { AuthOptions } from "./auth.js";
import {
	classifyGraphQLFailure,
	graphQLErrorCode,
	graphQLErrorHttpStatus,
	LinearGraphQLError,
} from "./linear-graphql-error.js";

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
 * Delegates the verdict to `classifyGraphQLFailure` so this in-process
 * retry loop and the `errorDetail.retryable` field the CLI publishes on
 * its error envelope (DEV-7987) can never diverge — one predicate, two
 * consumers. The `extensions.code` arm is what makes a Linear rate limit
 * classify as transient even when it arrives under a status that would
 * otherwise read as permanent.
 */
export function isTransientGraphQLError(error: unknown): boolean {
	return classifyGraphQLFailure(
		graphQLErrorHttpStatus(error),
		graphQLErrorCode(error),
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
			const httpStatus = graphQLErrorHttpStatus(error);
			const code = graphQLErrorCode(error);
			throw new LinearGraphQLError(message, {
				httpStatus,
				code,
				// Classify off the ORIGINAL rejection, not the new message: the
				// status and code live on the rejection, and the transport-message
				// arm needs the SDK's own text (`fetch failed`), which the
				// GraphQL-error branch above replaces.
				retryable: classifyGraphQLFailure(
					httpStatus,
					code,
					errorMessage(error),
				),
			});
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
