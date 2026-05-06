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

let cachedConfig: ElLinearConfig | undefined;

/** Test seam — resets the cache between test cases. */
export function _resetConfigCacheForTests(): void {
	cachedConfig = undefined;
}

export function loadConfig(): ElLinearConfig {
	if (cachedConfig) {
		return cachedConfig;
	}

	// Profile-aware: read from <CONFIG_DIR>/profiles/<name>/config.json
	// when a profile is active, falling back to the legacy single-file
	// path so existing setups keep working without migration.
	const active = resolveActiveProfile();
	const candidates = [active.configPath];
	if (active.configPath !== CONFIG_PATH) candidates.push(CONFIG_PATH);
	const sourcePath = candidates.find((p) => fs.existsSync(p));

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
			cachedConfig = deepMerge(
				DEFAULT_CONFIG as unknown as Record<string, unknown>,
				userConfig,
			) as unknown as ElLinearConfig;
		} catch {
			outputWarning(`Failed to parse ${sourcePath}, using empty defaults`);
			cachedConfig = DEFAULT_CONFIG;
		}
	} else {
		const profileNote = active.name
			? ` (active profile: \`${active.name}\` — expected at ${active.configPath})`
			: "";
		outputWarning(
			`No config found at ${active.configPath}${profileNote}. Run \`el-linear init\` (or \`el-linear profile add ${active.name ?? "<name>"}\`) to create one.`,
		);
		cachedConfig = DEFAULT_CONFIG;
	}

	return cachedConfig;
}

function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...target };
	for (const key of Object.keys(source)) {
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
