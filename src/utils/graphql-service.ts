import { LinearClient } from "@linear/sdk";
import { getActiveAuth } from "../auth/token-resolver.js";
import type { GraphQLResponseData, GraphQLVariables } from "../types/linear.js";
import type { AuthOptions } from "./auth.js";

interface GraphQLRawClient {
	rawRequest: <T>(
		query: string,
		variables?: GraphQLVariables,
	) => Promise<{ data: T }>;
}

/**
 * Constructor arg shapes for `GraphQLService`. Three variants:
 *   - `string` → personal API token (legacy; sent without `Bearer` prefix).
 *   - `{apiKey: string}` → personal API token (explicit).
 *   - `{oauthToken: string}` → OAuth access token (sent as
 *     `Authorization: Bearer <token>` via the SDK's accessToken option).
 *
 * The string variant exists because hundreds of call sites and tests pass
 * a plain string. We continue to support it indefinitely.
 */
export type GraphQLServiceAuth =
	| string
	| { apiKey: string }
	| { oauthToken: string };

function buildLinearClient(auth: GraphQLServiceAuth): LinearClient {
	const baseHeaders = { "public-file-urls-expire-in": "3600" };
	if (typeof auth === "string") {
		return new LinearClient({ apiKey: auth, headers: baseHeaders });
	}
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

	constructor(auth: GraphQLServiceAuth) {
		const client = buildLinearClient(auth);
		// LinearClient stores a private graphql-request client — access via escape hatch
		this.graphQLClient = (
			client as unknown as { client: GraphQLRawClient }
		).client;
	}

	// Default type allows property access on raw GraphQL responses.
	// Callers can narrow with explicit type parameter: rawRequest<{ issues: { nodes: T[] } }>(...)
	async rawRequest<T = GraphQLResponseData>(
		query: string,
		variables?: GraphQLVariables,
	): Promise<T> {
		try {
			const response = await this.graphQLClient.rawRequest<T>(query, variables);
			return response.data;
		} catch (error: unknown) {
			const err = error as {
				response?: { errors?: Array<{ message?: string }> };
				message?: string;
			};
			if (err.response?.errors) {
				const graphQLError = err.response.errors[0];
				throw new Error(graphQLError.message || "GraphQL query failed");
			}
			throw new Error(`GraphQL request failed: ${err.message}`);
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
