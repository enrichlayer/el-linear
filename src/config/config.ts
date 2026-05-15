import fs from "node:fs";
import { outputWarning } from "../utils/output.js";
import {
	CONFIG_PATH,
	LOCAL_CONFIG_PATH,
	type ProfilePaths,
	resolveActiveProfile,
} from "./paths.js";
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
	 *
	 * When a team config layer is active, personal `terms` are appended to the
	 * team's rules (not replaced). To start fresh, omit `terms` from personal
	 * config entirely.
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
	 *
	 * Prefer setting this in `local.json` instead of `config.json` so it stays
	 * out of shared team config.
	 */
	defaultAssignee?: string;
	/**
	 * Default priority for `issues create` / `issues update`. Accepts the same
	 * keywords as the --priority flag: `none|urgent|high|medium|normal|low`
	 * or `0`–`4`. Applied when `--priority` is not passed.
	 *
	 * Prefer setting this in `local.json` instead of `config.json`.
	 */
	defaultPriority?: string;
	/**
	 * TTL (seconds) for the on-disk cache used by `teams list`, `labels list`,
	 * and `projects list`. Defaults to 3600 (1 hour) when omitted. A value of
	 * `0` disables the cache entirely. Override per-invocation with
	 * `--no-cache`.
	 *
	 * Prefer setting this in `local.json` instead of `config.json`.
	 */
	cacheTTLSeconds?: number;
	/**
	 * Path to a shared team config file. Fields in the team config are merged
	 * under the personal config (personal config wins on conflicts). Arrays such
	 * as `terms` and `defaultLabels` are concatenated — personal entries are
	 * appended to team entries. The team config accepts any ElLinearConfig fields
	 * except `teamConfigPath` itself. Useful for sharing member aliases, label
	 * maps, and term rules across a team by checking the file into a shared
	 * repository. Override at runtime with the `EL_LINEAR_TEAM_CONFIG` env var
	 * (env var takes precedence over this field).
	 */
	teamConfigPath?: string;
}

/**
 * Fields valid in a shared team config file (the file pointed to by
 * `teamConfigPath` or `EL_LINEAR_TEAM_CONFIG`). All fields are optional —
 * omitted fields fall back to defaults or the personal config layer. The type
 * excludes `teamConfigPath` itself to prevent circular references.
 */
export type TeamConfig = Omit<ElLinearConfig, "teamConfigPath">;

/**
 * User-local overrides that live in `~/.config/el-linear/local.json` (or the
 * per-profile equivalent). These are applied on top of the merged team+personal
 * config, so every field here takes the highest precedence.
 *
 * Use `local.json` for anything that is personal rather than team-wide:
 * your own email, personal default priority, cache preferences. Never commit
 * `local.json` to a shared repo — it is `.gitignore`-worthy by nature.
 *
 * Merge order (lowest → highest priority):
 *   defaults → team config file → personal config.json → local.json
 */
export interface ElLinearLocalConfig {
	/**
	 * Your Linear account email. Used as the default `--assignee` when creating
	 * issues. Takes precedence over `config.json`'s `defaultAssignee`.
	 *
	 * Example: "ytspar@gmail.com"
	 */
	assigneeEmail?: string;
	/** Same semantics as `ElLinearConfig.defaultAssignee`, but local-wins. */
	defaultAssignee?: string;
	/** Same semantics as `ElLinearConfig.defaultPriority`, but local-wins. */
	defaultPriority?: string;
	/** Same semantics as `ElLinearConfig.cacheTTLSeconds`, but local-wins. */
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

// Two-level cache to avoid re-reading personal config on every loadConfig() call.
//
// Level 1 — team config path resolution:
//   Key: `"${profileKey}::${envPath}"` (both "" when absent)
//   Value: the resolved team config path, or undefined if none is configured.
//   Populated on the first loadConfig() call for a (profile, env) combination.
//   On subsequent calls the cache hit lets us skip reading personal config and
//   go straight to the merged-config cache.
//
// Level 2 — merged result (team + personal):
//   Key: `"${profileKey}::${teamConfigPath}"`
//   Value: the fully merged ElLinearConfig (before local.json overlay).
//
// Level 3 — local config:
//   Key: profile name (null for legacy single-file layout).
//   Value: the parsed ElLinearLocalConfig from local.json.
//
// ALL-935 deferred fix note: profile switching mid-process is covered because
// the profile name is part of all cache keys.
const cachedTeamConfigPath = new Map<string, string | undefined>();
const cachedConfig = new Map<string, ElLinearConfig>();
const cachedLocalConfigByProfile = new Map<string | null, ElLinearLocalConfig>();

/** Test seam — resets all caches between test cases. */
export function _resetConfigCacheForTests(): void {
	cachedTeamConfigPath.clear();
	cachedConfig.clear();
	cachedLocalConfigByProfile.clear();
}

export function loadConfig(): ElLinearConfig {
	const active = resolveActiveProfile();
	const teamConfigEnvPath =
		process.env.EL_LINEAR_TEAM_CONFIG?.trim() || undefined;
	const profileKey = active.name ?? "";
	const pathCacheKey = `${profileKey}::${teamConfigEnvPath ?? ""}`;

	// Fast path: if we already know the team config path for this
	// (profile, env) combination, skip reading personal config.
	let teamConfigPath: string | undefined;
	let personalRaw: Record<string, unknown> | undefined;

	if (cachedTeamConfigPath.has(pathCacheKey)) {
		teamConfigPath = cachedTeamConfigPath.get(pathCacheKey);
	} else if (teamConfigEnvPath !== undefined) {
		// Env var fully determines the path — no need to read personal config.
		teamConfigPath = teamConfigEnvPath;
		cachedTeamConfigPath.set(pathCacheKey, teamConfigPath);
	} else {
		// First time for this profile without an env var: read personal config
		// to find teamConfigPath, then cache it for future fast-path lookups.
		personalRaw = readRawPersonalConfig(active);
		teamConfigPath = personalRaw.teamConfigPath as string | undefined;
		cachedTeamConfigPath.set(pathCacheKey, teamConfigPath);
	}

	const cacheKey = `${profileKey}::${teamConfigPath ?? ""}`;
	const cached = cachedConfig.get(cacheKey);
	if (cached) {
		// Apply local config on top of cached merged result.
		return applyLocalConfig(cached, loadLocalConfig());
	}

	// Cache miss — do the full merge. Reuse personalRaw if we already read it.
	if (!personalRaw) {
		personalRaw = readRawPersonalConfig(active);
	}

	// Load the team config layer (errors are warned, never thrown).
	const teamRaw: Record<string, unknown> = teamConfigPath
		? loadTeamConfigRaw(teamConfigPath)
		: {};
	// teamConfigPath inside a team config file would be circular; strip it.
	delete teamRaw.teamConfigPath;

	// Merge order: defaults → team config → personal config.
	// Arrays (terms, defaultLabels, etc.) are concatenated so personal entries
	// extend team entries rather than replace them.
	const afterTeam = deepMerge(
		DEFAULT_CONFIG as unknown as Record<string, unknown>,
		teamRaw,
	);
	const merged = deepMerge(
		afterTeam,
		personalRaw,
	) as unknown as ElLinearConfig;

	cachedConfig.set(cacheKey, merged);

	// Overlay local.json on top — highest priority layer.
	return applyLocalConfig(merged, loadLocalConfig());
}

/**
 * Returns the team config file path that is active for the current process
 * (from `EL_LINEAR_TEAM_CONFIG` env var or `teamConfigPath` in personal
 * config). Returns `undefined` when no team config is configured.
 *
 * Calling this before `loadConfig()` will trigger a `loadConfig()` internally
 * so the path cache is populated.
 */
export function getActiveTeamConfigPath(): string | undefined {
	const active = resolveActiveProfile();
	const teamConfigEnvPath =
		process.env.EL_LINEAR_TEAM_CONFIG?.trim() || undefined;
	const profileKey = active.name ?? "";
	const pathCacheKey = `${profileKey}::${teamConfigEnvPath ?? ""}`;
	if (!cachedTeamConfigPath.has(pathCacheKey)) {
		loadConfig();
	}
	return cachedTeamConfigPath.get(pathCacheKey);
}

/**
 * Load user-local overrides from `local.json`. Returns an empty object when
 * no file exists — callers treat it as "no overrides". Errors are silent so
 * a missing or malformed `local.json` never breaks a command.
 */
export function loadLocalConfig(): ElLinearLocalConfig {
	const active = resolveActiveProfile();
	const cacheKey = active.name;
	const cached = cachedLocalConfigByProfile.get(cacheKey);
	if (cached !== undefined) {
		return cached;
	}

	const candidates = [active.localConfigPath];
	if (active.localConfigPath !== LOCAL_CONFIG_PATH)
		candidates.push(LOCAL_CONFIG_PATH);
	const sourcePath = candidates.find((p) => fs.existsSync(p));

	let local: ElLinearLocalConfig = {};
	if (sourcePath) {
		try {
			local = JSON.parse(
				fs.readFileSync(sourcePath, "utf8"),
			) as ElLinearLocalConfig;
		} catch {
			outputWarning(`Failed to parse ${sourcePath}, ignoring local config`);
		}
	}

	cachedLocalConfigByProfile.set(cacheKey, local);
	return local;
}

/**
 * Merge local config overrides onto the merged team+personal config.
 * `assigneeEmail` maps to `defaultAssignee` as a convenience alias.
 */
function applyLocalConfig(
	base: ElLinearConfig,
	local: ElLinearLocalConfig,
): ElLinearConfig {
	if (Object.keys(local).length === 0) return base;
	const result = { ...base };
	if (local.cacheTTLSeconds !== undefined)
		result.cacheTTLSeconds = local.cacheTTLSeconds;
	if (local.defaultPriority !== undefined)
		result.defaultPriority = local.defaultPriority;
	if (local.defaultAssignee !== undefined) {
		result.defaultAssignee = local.defaultAssignee;
	} else if (local.assigneeEmail !== undefined) {
		result.defaultAssignee = local.assigneeEmail;
	}
	return result;
}

function readRawPersonalConfig(active: ProfilePaths): Record<string, unknown> {
	const candidates = [active.configPath];
	if (active.configPath !== CONFIG_PATH) candidates.push(CONFIG_PATH);
	const sourcePath = candidates.find((p) => fs.existsSync(p));

	if (!sourcePath) {
		const profileNote = active.name
			? ` (active profile: \`${active.name}\` — expected at ${active.configPath})`
			: "";
		outputWarning(
			`No config found at ${active.configPath}${profileNote}. Run \`el-linear init\` (or \`el-linear profile add ${active.name ?? "<name>"}\`) to create one.`,
		);
		return {};
	}

	try {
		const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as Record<
			string,
			unknown
		>;
		// Migration: the legacy `brand: { name, reject }` config is auto-promoted
		// to a single entry in `terms[]`. We warn (not throw) so existing users get
		// a grace period to update their config.
		if (
			raw.brand &&
			typeof raw.brand === "object" &&
			!Array.isArray(raw.brand)
		) {
			const legacy = raw.brand as { name?: unknown; reject?: unknown };
			if (typeof legacy.name === "string" && Array.isArray(legacy.reject)) {
				outputWarning(
					"config.brand is deprecated — replace it with config.terms = [{ canonical, reject }]. See README#term-enforcer.",
				);
				const existing = Array.isArray(raw.terms) ? raw.terms : [];
				raw.terms = [
					...existing,
					{ canonical: legacy.name, reject: legacy.reject },
				];
			}
			delete raw.brand;
		}
		return raw;
	} catch {
		outputWarning(`Failed to parse ${sourcePath}, using empty defaults`);
		return {};
	}
}

function loadTeamConfigRaw(teamConfigPath: string): Record<string, unknown> {
	if (!fs.existsSync(teamConfigPath)) {
		outputWarning(
			`Team config not found at ${teamConfigPath} — skipping team config layer.`,
		);
		return {};
	}
	try {
		return JSON.parse(fs.readFileSync(teamConfigPath, "utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		outputWarning(
			`Failed to parse team config at ${teamConfigPath} — skipping team config layer.`,
		);
		return {};
	}
}

/**
 * Deep-merge `source` into `target`. Objects are merged recursively; arrays
 * are concatenated (target first, source appended) so that a team config's
 * `terms` and `defaultLabels` are extended by personal config rather than
 * replaced. Scalar values from `source` win over `target`.
 */
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
		if (Array.isArray(source[key]) && Array.isArray(target[key])) {
			result[key] = [
				...(target[key] as unknown[]),
				...(source[key] as unknown[]),
			];
		} else if (
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
