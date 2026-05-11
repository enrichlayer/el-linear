/**
 * Service-trio bootstrap helper.
 *
 * The 3-line incantation
 *
 * ```ts
 * const graphQLService = await createGraphQLService(rootOpts);
 * const linearService = await createLinearService(rootOpts);
 * const issuesService = new GraphQLIssuesService(graphQLService, linearService);
 * ```
 *
 * repeats verbatim across ~13 issue/batch command handlers. This helper
 * collapses it to a single line; callers destructure only what they use.
 *
 * Sites that need just `graphQLService` + `linearService` (no `issuesService`)
 * can keep their direct calls — there's no benefit to routing through a
 * helper that constructs an unused third service.
 */

import type { AuthOptions } from "./auth.js";
import { GraphQLIssuesService } from "./graphql-issues-service.js";
import {
	createGraphQLService,
	type GraphQLService,
} from "./graphql-service.js";
import { createLinearService, type LinearService } from "./linear-service.js";

export interface IssuesServiceTrio {
	graphQLService: GraphQLService;
	linearService: LinearService;
	issuesService: GraphQLIssuesService;
}

export async function createIssuesService(
	options: AuthOptions,
): Promise<IssuesServiceTrio> {
	const graphQLService = await createGraphQLService(options);
	const linearService = await createLinearService(options);
	const issuesService = new GraphQLIssuesService(graphQLService, linearService);
	return { graphQLService, linearService, issuesService };
}
