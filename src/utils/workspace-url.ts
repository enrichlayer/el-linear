import { loadConfig } from "../config/config.js";
import type { GraphQLService } from "./graphql-service.js";

/**
 * Resolve the Linear workspace URL key (the segment after `linear.app/` in
 * issue URLs). Used to build canonical markdown link URLs like
 * `https://linear.app/<urlKey>/issue/<identifier>/`.
 *
 * Resolution order (highest priority first):
 *
 *   1. `options.override` — typically wired from a `--workspace-url-key` CLI flag
 *      (per-invocation, wins over everything).
 *   2. `EL_LINEAR_WORKSPACE_URL_KEY` env var.
 *   3. `config.workspaceUrlKey` from `~/.config/el-linear/config.json`.
 *   4. Live `viewer.organization.urlKey` GraphQL query (cached in-process).
 *
 * Layers 1–3 short-circuit without touching the network — this makes
 * `el-linear refs wrap --no-validate` work offline once any one of them
 * is set. Layer 4 is the original behavior preserved as a fallback.
 *
 * The graphQLService is only needed for layer 4 — pass `undefined` (or omit it)
 * when the caller knows the network will not be used.
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

export interface GetWorkspaceUrlKeyOptions {
	/** Highest-priority source. Typically the `--workspace-url-key` flag. */
	override?: string;
}

const WORKSPACE_URL_KEY_ENV = "EL_LINEAR_WORKSPACE_URL_KEY";

// Linear workspace URL keys are URL-safe slugs. The Linear API itself
// validates this shape (`viewerIsValid` in init/token.ts uses the same
// regex). Applying the check on env + config reads closes the gap where
// a malformed key (`EL_LINEAR_WORKSPACE_URL_KEY=" javascript:alert(1)#"`)
// would otherwise flow into markdown link URLs verbatim. Live-API path
// is already trusted because the value comes from `viewer.organization`.
// DEV-4067.
const VALID_URL_KEY_RE = /^[a-z0-9-]+$/i;

function validateUrlKey(value: string, source: string): string {
	if (!VALID_URL_KEY_RE.test(value)) {
		throw new Error(
			`Invalid Linear workspace URL key from ${source}: ${JSON.stringify(value)}. ` +
				"Must match /^[a-z0-9-]+$/i (e.g. 'verticalint').",
		);
	}
	return value;
}

let cachedUrlKey: string | undefined;

export async function getWorkspaceUrlKey(
	graphQLService?: GraphQLService,
	options: GetWorkspaceUrlKeyOptions = {},
): Promise<string> {
	// 1. Per-invocation override — highest priority.
	if (options.override) {
		return validateUrlKey(options.override, "--workspace-url-key flag");
	}

	// 2. Env var. Read on every call (cheap; lets tests/CI flip the value
	//    mid-process without restarting). Not cached, so a test that sets
	//    EL_LINEAR_WORKSPACE_URL_KEY then unsets it sees the unset state.
	const envKey = process.env[WORKSPACE_URL_KEY_ENV];
	if (envKey) {
		return validateUrlKey(envKey, `${WORKSPACE_URL_KEY_ENV} env var`);
	}

	// Layers 3-4 are cached in-process — config and the live lookup are
	// both stable for the CLI invocation's lifetime.
	if (cachedUrlKey) {
		return cachedUrlKey;
	}

	// 3. Config override.
	const { workspaceUrlKey } = loadConfig();
	if (workspaceUrlKey) {
		const validated = validateUrlKey(workspaceUrlKey, "config.workspaceUrlKey");
		cachedUrlKey = validated;
		return validated;
	}

	// 4. Live API lookup — requires a GraphQL service.
	if (!graphQLService) {
		throw new Error(
			"Could not resolve Linear workspace URL key — no override, env, or config set, " +
				"and no GraphQL service was provided for the live lookup. " +
				`Set \`workspaceUrlKey\` in your el-linear config, or \`${WORKSPACE_URL_KEY_ENV}\` in the environment.`,
		);
	}
	const data = await graphQLService.rawRequest<ViewerOrgResponse>(
		VIEWER_ORG_URL_KEY_QUERY,
	);
	const fetched = data?.viewer?.organization?.urlKey;
	if (!fetched) {
		throw new Error(
			"Could not resolve Linear workspace URL key from `viewer.organization.urlKey`. " +
				"Set `workspaceUrlKey` in your el-linear config to override.",
		);
	}
	cachedUrlKey = fetched;
	return fetched;
}

/** Test helper: clear the cached URL key. Not called from production code. */
export function _resetWorkspaceUrlKeyCache(): void {
	cachedUrlKey = undefined;
}
