import { LinearClient } from "@linear/sdk";
import type { GraphQLResponseData, GraphQLVariables } from "../types/linear.js";
import { type AuthOptions, getApiToken } from "./auth.js";

interface GraphQLRawClient {
	rawRequest: <T>(
		query: string,
		variables?: GraphQLVariables,
	) => Promise<{ data: T }>;
}

export class GraphQLService {
	private readonly graphQLClient: GraphQLRawClient;

	constructor(apiToken: string) {
		const client = new LinearClient({
			apiKey: apiToken,
			headers: {
				"public-file-urls-expire-in": "3600",
			},
		});
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

export function createGraphQLService(options: AuthOptions): GraphQLService {
	const apiToken = getApiToken(options);
	return new GraphQLService(apiToken);
}
