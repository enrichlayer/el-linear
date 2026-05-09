import fs from "node:fs";
import { outputWarning } from "../utils/output.js";
import { CONFIG_PATH, resolveActiveProfile } from "./paths.js";
import type { TermRule } from "./term-enforcer.js";

/**
 * Canonical shape of `~/.config/el-linear/config.json`. This is the single source
 * of truth for the on-disk config — the wizard reads/writes the same shape
 * (as `Partial<ElLinearConfig>` since wizard runs may only set a subset).
 */
export interface ElLinearConfig {
	defaultLabels: string[];
	defaultTeam: string;
	labels: {
		workspace: Record<string, string>;
		teams: Record<string, Record<string, string>>;
	};
	members: {
		aliases: Record<string, string>;
		fullNames: Record<string, string>;
		handles: Record<string, Record<string, string>>;
		uuids: Record<string, string>;
	};
	statusDefaults: {
		noProject: string;
		withAssigneeAndProject: string;
	};
	teamAliases: Record<string, string>;
	teams: Record<string, string>;
	/**
	 * Term-enforcement rules. Each rule has a canonical form and a list of
	 * rejected forms; rejected forms in issue titles/descriptions are flagged
	 * (or thrown on, in strict mode) with a hint to use the canonical form.
	 */
	terms: TermRule[];
	validation?: {
		enabled: boolean;
		typeLabels?: string[];
	};
	/**
	 * Optional override for the Linear workspace URL key (the part after
	 * `linear.app/` in issue URLs). When omitted, el-linear queries the Linear API
	 * once per session and caches the result.
	 */
	workspaceUrlKey?: string;
	/**
	 * Text appended to issue descriptions and comment bodies on the `create`
	 * paths. Treated as a literal string — include any `\n\n---\n` separator
	 * yourself if you want a horizontal rule. CLI flags `--footer <text>` and
	 * `--no-footer` override this per-invocation.
	 */
	messageFooter?: string;
	/**
	 * Named description boilerplates for `el-linear issues create --template <name>`.
	 * The template's value is used as the description body when `--template` is
	 * provided and neither `--description` nor `--description-file` is set.
	 *
	 * Example:
	 *   "descriptionTemplates": {
	 *     "bug": "## Steps to reproduce\n\n1. ...\n\n## Expected\n\n...\n\n## Actual\n\n..."
	 *   }
	 */
	descriptionTemplates?: Record<string, string>;
	/**
	 * Default assignee identifier (alias / display name / email / UUID — same
	 * shapes resolveAssignee accepts) for `issues create`. Applied when
	 * `--assignee` is not passed. Pass `--no-assignee` to override at one site.
	 */
	defaultAssignee?: string;
	/**
	 * Default priority for `issues create` / `issues update`. Accepts the same
	 * keywords as the --priority flag: `none|urgent|high|medium|normal|low`
	 * or `0`–`4`. Applied when `--priority` is not passed.
	 */
	defaultPriority?: string;
	/**
	 * TTL (seconds) for the on-disk cache used by `teams list`, `labels list`,
	 * and `projects list`. Defaults to 3600 (1 hour) when omitted. A value of
	 * `0` disables the cache entirely. Override per-invocation with
	 * `--no-cache`.
	 */
	cacheTTLSeconds?: number;
}

const DEFAULT_CONFIG: ElLinearConfig = {
	defaultTeam: "",
	defaultLabels: [],
	members: {
		aliases: {},
		fullNames: {},
		handles: {},
		uuids: {},
	},
	teams: {},
	teamAliases: {},
	labels: {
		workspace: {},
		teams: {},
	},
	statusDefaults: {
		noProject: "Triage",
		withAssigneeAndProject: "Todo",
	},
	terms: [],
};

// Profile-keyed cache. Pre-fix this was a single `cachedConfig` —
// switching the active profile mid-process and calling `loadConfig`
// again would return the OLD profile's config until
// `_resetConfigCacheForTests` ran. Today the CLI sets the profile
// in `preAction` before any command body, so this is latent — but
// keying by profile makes it future-proof and makes test isolation
// less footgun-prone (profile A's setup pollutes profile B's read).
// ALL-935 deferred fix.
//
// Key: `null` for the legacy single-file layout (no active profile),
// otherwise the profile name. We never mix the two paths in the
// cache — the marker name selects exactly one path.
const cachedConfigByProfile = new Map<string | null, ElLinearConfig>();

/** Test seam — resets the cache between test cases. */
export function _resetConfigCacheForTests(): void {
	cachedConfigByProfile.clear();
}

export function loadConfig(): ElLinearConfig {
	// Profile-aware: read from <CONFIG_DIR>/profiles/<name>/config.json
	// when a profile is active, falling back to the legacy single-file
	// path so existing setups keep working without migration.
	const active = resolveActiveProfile();
	const cacheKey = active.name;
	const cached = cachedConfigByProfile.get(cacheKey);
	if (cached) {
		return cached;
	}

	const candidates = [active.configPath];
	if (active.configPath !== CONFIG_PATH) candidates.push(CONFIG_PATH);
	const sourcePath = candidates.find((p) => fs.existsSync(p));

	let resolved: ElLinearConfig;
	if (sourcePath) {
		try {
			const userConfig = JSON.parse(
				fs.readFileSync(sourcePath, "utf8"),
			) as Record<string, unknown>;
			// Migration: the legacy `brand: { name, reject }` config is auto-promoted to
			// a single entry in `terms[]`. We warn (not throw) so existing users get a
			// grace period to update their config.
			if (
				userConfig.brand &&
				typeof userConfig.brand === "object" &&
				!Array.isArray(userConfig.brand)
			) {
				const legacy = userConfig.brand as { name?: unknown; reject?: unknown };
				if (typeof legacy.name === "string" && Array.isArray(legacy.reject)) {
					outputWarning(
						"config.brand is deprecated — replace it with config.terms = [{ canonical, reject }]. See README#term-enforcer.",
					);
					const existing = Array.isArray(userConfig.terms)
						? userConfig.terms
						: [];
					userConfig.terms = [
						...existing,
						{ canonical: legacy.name, reject: legacy.reject },
					];
				}
				delete userConfig.brand;
			}
			resolved = deepMerge(
				DEFAULT_CONFIG as unknown as Record<string, unknown>,
				userConfig,
			) as unknown as ElLinearConfig;
		} catch {
			outputWarning(`Failed to parse ${sourcePath}, using empty defaults`);
			resolved = DEFAULT_CONFIG;
		}
	} else {
		const profileNote = active.name
			? ` (active profile: \`${active.name}\` — expected at ${active.configPath})`
			: "";
		outputWarning(
			`No config found at ${active.configPath}${profileNote}. Run \`el-linear init\` (or \`el-linear profile add ${active.name ?? "<name>"}\`) to create one.`,
		);
		resolved = DEFAULT_CONFIG;
	}

	cachedConfigByProfile.set(cacheKey, resolved);
	return resolved;
}

function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...target };
	for (const key of Object.keys(source)) {
		// Reject prototype-pollution keys regardless of value shape: a
		// hand-edited config.json with `__proto__` would otherwise mutate
		// Object.prototype for the whole process.
		if (key === "__proto__" || key === "constructor" || key === "prototype") {
			continue;
		}
		if (
			source[key] &&
			typeof source[key] === "object" &&
			!Array.isArray(source[key]) &&
			target[key] &&
			typeof target[key] === "object" &&
			!Array.isArray(target[key])
		) {
			result[key] = deepMerge(
				target[key] as Record<string, unknown>,
				source[key] as Record<string, unknown>,
			);
		} else {
			result[key] = source[key];
		}
	}
	return result;
}
