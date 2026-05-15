import fs from "node:fs";
import { outputWarning } from "../utils/output.js";
import type { ProfilePaths } from "./paths.js";
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
	/**
	 * Path to a shared team config file. Fields in the team config are merged
	 * under the personal config (personal config wins on conflicts). The team
	 * config accepts any ElLinearConfig fields except `teamConfigPath` itself.
	 * Useful for sharing member aliases, label maps, and term rules across a
	 * team by checking the file into a shared repository. Override at runtime
	 * with the `EL_LINEAR_TEAM_CONFIG` env var (env var takes precedence).
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

// Cache keyed by `"${profileName}::${teamConfigPath}"` so that switching
// profiles or team config paths mid-process (test isolation, --profile flag)
// returns the correct merged config without a stale hit.
// Key uses "" for the legacy single-file layout (no active profile) and ""
// for no team config path.
const cachedConfig = new Map<string, ElLinearConfig>();

/** Test seam — resets the cache between test cases. */
export function _resetConfigCacheForTests(): void {
	cachedConfig.clear();
}

export function loadConfig(): ElLinearConfig {
	const active = resolveActiveProfile();
	// Env var overrides teamConfigPath in personal config.
	const teamConfigEnvPath =
		process.env.EL_LINEAR_TEAM_CONFIG?.trim() || undefined;

	// Read personal config raw first so we can extract teamConfigPath before
	// computing the full cache key (and to avoid double-reads on cache hit).
	const personalRaw = readRawPersonalConfig(active);
	const teamConfigPath =
		teamConfigEnvPath ?? (personalRaw.teamConfigPath as string | undefined);

	const cacheKey = `${active.name ?? ""}::${teamConfigPath ?? ""}`;
	const cached = cachedConfig.get(cacheKey);
	if (cached) return cached;

	// Load the team config layer (errors are warned, never thrown).
	const teamRaw: Record<string, unknown> = teamConfigPath
		? loadTeamConfigRaw(teamConfigPath)
		: {};
	// teamConfigPath inside a team config file would be circular; strip it.
	delete teamRaw.teamConfigPath;

	// Merge order: defaults → team config → personal config (personal wins).
	const afterTeam = deepMerge(
		DEFAULT_CONFIG as unknown as Record<string, unknown>,
		teamRaw,
	);
	const resolved = deepMerge(
		afterTeam,
		personalRaw,
	) as unknown as ElLinearConfig;

	cachedConfig.set(cacheKey, resolved);
	return resolved;
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
