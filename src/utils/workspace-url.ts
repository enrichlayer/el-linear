import { loadConfig } from "../config/config.js";
import type { GraphQLService } from "./graphql-service.js";

/**
 * Resolve the Linear workspace URL key (the segment after `linear.app/` in
 * issue URLs). Used to build canonical markdown link URLs like
 * `https://linear.app/<urlKey>/issue/<identifier>/`.
 *
 * Resolution order:
 *   1. `config.workspaceUrlKey` if explicitly set in linctl config
 *   2. `viewer.organization.urlKey` from the Linear API (fetched once, cached)
 *
 * Cached in-process for the lifetime of the CLI invocation.
 */

const VIEWER_ORG_URL_KEY_QUERY = /* GraphQL */ `
  query ViewerOrgUrlKey {
    viewer {
      organization {
        urlKey
      }
    }
  }
`;

interface ViewerOrgResponse {
	viewer: {
		organization: {
			urlKey: string;
		};
	};
}

let cachedUrlKey: string | undefined;

export async function getWorkspaceUrlKey(
	graphQLService: GraphQLService,
): Promise<string> {
	if (cachedUrlKey) {
		return cachedUrlKey;
	}

	const { workspaceUrlKey } = loadConfig();
	if (workspaceUrlKey) {
		cachedUrlKey = workspaceUrlKey;
		return workspaceUrlKey;
	}

	const data = await graphQLService.rawRequest<ViewerOrgResponse>(
		VIEWER_ORG_URL_KEY_QUERY,
	);
	const fetched = data?.viewer?.organization?.urlKey;
	if (!fetched) {
		throw new Error(
			"Could not resolve Linear workspace URL key from `viewer.organization.urlKey`. " +
				"Set `workspaceUrlKey` in your linctl config to override.",
		);
	}
	cachedUrlKey = fetched;
	return fetched;
}

/** Test helper: clear the cached URL key. Not called from production code. */
export function _resetWorkspaceUrlKeyCache(): void {
	cachedUrlKey = undefined;
}
