import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import type { ElLinearLocalConfig } from "../config/config.js";
import {
	getActiveTeamConfigPath,
	loadConfig,
	loadLocalConfig,
} from "../config/config.js";
import { resolveActiveProfile } from "../config/paths.js";
import {
	handleAsyncCommand,
	outputSuccess,
	outputWarning,
} from "../utils/output.js";
import { updateConfig } from "./init/shared.js";

/**
 * Expand a leading `~` to the user's home directory. Shells expand `~` before
 * the command sees it, but a literal `~/...` pasted from documentation reaches
 * Node verbatim. We handle it so `el-linear config team set-path ~/git/...`
 * works regardless of whether the shell did the expansion first.
 */
function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

const LOCAL_SETTABLE_KEYS = [
	"assigneeEmail",
	"defaultAssignee",
	"defaultPriority",
	"cacheTTLSeconds",
] as const;
type LocalSettableKey = (typeof LOCAL_SETTABLE_KEYS)[number];

export function setupConfigCommands(program: Command): void {
	const config = program
		.command("config")
		.description("Configuration introspection");
	config.action(() => config.help());

	config
		.command("show")
		.description(
			"Show resolved configuration (team file → personal config → local overrides)",
		)
		.addHelpText(
			"after",
			"\nDumps the merged config from the active team file + config.json + local.json.\n\nExamples:\n  el-linear config show",
		)
		.action(() => {
			const data = loadConfig();
			const teamConfig = getActiveTeamConfigPath();
			const local = loadLocalConfig();
			const out: Record<string, unknown> = { data };
			if (teamConfig) out.teamConfig = teamConfig;
			if (Object.keys(local).length > 0) out.local = local;
			outputSuccess(out);
		});

	const local = config
		.command("local")
		.description("Manage user-local config overrides (local.json)");
	local.action(() => local.help());

	local
		.command("show")
		.description("Show the raw contents of local.json")
		.addHelpText(
			"after",
			`\nShows ~/.config/el-linear/local.json (or the per-profile equivalent).\n\nExamples:\n  el-linear config local show`,
		)
		.action(() => {
			outputSuccess({ data: loadLocalConfig() });
		});

	const team = config
		.command("team")
		.description(
			"Manage the shared team config layer (teamConfigPath in personal config)",
		);
	team.action(() => team.help());

	team
		.command("show")
		.description(
			"Show the active team config layer: path, source (env var or personal config), file status, top-level keys it contributes",
		)
		.addHelpText(
			"after",
			"\nResolves the team config in the same order loadConfig() does:\n  EL_LINEAR_TEAM_CONFIG (env)  >  teamConfigPath (personal config)\n\nExamples:\n  el-linear config team show",
		)
		.action(() => {
			const teamPath = getActiveTeamConfigPath();
			const envOverride =
				process.env.EL_LINEAR_TEAM_CONFIG?.trim() || undefined;
			const source =
				envOverride !== undefined
					? "EL_LINEAR_TEAM_CONFIG env var"
					: teamPath
						? "teamConfigPath in personal config"
						: null;
			const out: Record<string, unknown> = {
				teamConfigPath: teamPath ?? null,
				source,
			};
			if (teamPath) {
				try {
					const raw = fs.readFileSync(teamPath, "utf8");
					const parsed = JSON.parse(raw) as Record<string, unknown>;
					out.exists = true;
					out.valid = true;
					out.providedKeys = Object.keys(parsed).sort();
				} catch (err) {
					out.exists = fs.existsSync(teamPath);
					out.valid = false;
					out.error = (err as Error).message;
				}
			}
			outputSuccess({ data: out });
		});

	team
		.command("set-path <path>")
		.description(
			"Write teamConfigPath into personal config.json. Path is resolved to an absolute path. The target file must exist and be valid JSON — a pointer to a missing or broken file is footgun-shaped and refused.",
		)
		.addHelpText(
			"after",
			"\nUse this when adopting a shared team config (e.g. one checked into a tools repo):\n  el-linear config team set-path ~/git/enrichlayer/tools/config/el-linear.shared.json\n\nRelative paths resolve against the current working directory; absolute paths are stored as-is. EL_LINEAR_TEAM_CONFIG in the environment still overrides the personal field when both are set — a warning surfaces in that case.",
		)
		.action(
			handleAsyncCommand(async (rawPath: string) => {
				const resolved = path.resolve(expandHome(rawPath));
				if (!fs.existsSync(resolved)) {
					throw new Error(
						`Team config file not found at ${resolved}. Create the file (or fix the path) before pointing personal config at it.`,
					);
				}
				try {
					JSON.parse(fs.readFileSync(resolved, "utf8"));
				} catch (err) {
					throw new Error(
						`Team config at ${resolved} is not valid JSON: ${(err as Error).message}`,
					);
				}
				await updateConfig((current) => ({
					...current,
					teamConfigPath: resolved,
				}));

				const envOverride =
					process.env.EL_LINEAR_TEAM_CONFIG?.trim() || undefined;
				if (envOverride !== undefined && envOverride !== resolved) {
					outputWarning(
						`EL_LINEAR_TEAM_CONFIG=${envOverride} is set in this shell and overrides the personal config field. Unset it (or align it) for the persistent setting to take effect.`,
					);
				}
				outputSuccess({
					data: {
						teamConfigPath: resolved,
						written: resolveActiveProfile().configPath,
					},
				});
			}),
		);

	team
		.command("clear")
		.description(
			"Remove teamConfigPath from personal config.json. EL_LINEAR_TEAM_CONFIG (env) is unaffected and continues to override if set.",
		)
		.action(
			handleAsyncCommand(async () => {
				let removed: string | undefined;
				await updateConfig((current) => {
					removed = current.teamConfigPath;
					const { teamConfigPath: _drop, ...rest } = current;
					return rest;
				});

				const envOverride =
					process.env.EL_LINEAR_TEAM_CONFIG?.trim() || undefined;
				if (envOverride !== undefined) {
					outputWarning(
						`EL_LINEAR_TEAM_CONFIG=${envOverride} is still set in this shell; it overrides the personal field and remains active until unset.`,
					);
				}
				outputSuccess({
					data: {
						cleared: true,
						previousTeamConfigPath: removed ?? null,
						written: resolveActiveProfile().configPath,
					},
				});
			}),
		);

	local
		.command("set <key> <value>")
		.description(
			`Set a key in local.json. Keys: ${LOCAL_SETTABLE_KEYS.join(", ")}`,
		)
		.addHelpText(
			"after",
			`\nAllowed keys:\n  assigneeEmail    — your Linear account email (used as default --assignee)\n  defaultAssignee  — alias / display name / email / UUID\n  defaultPriority  — none|urgent|high|medium|normal|low\n  cacheTTLSeconds  — integer seconds (0 = disable cache)\n\nExamples:\n  el-linear config local set assigneeEmail you@example.com\n  el-linear config local set defaultPriority medium\n  el-linear config local set cacheTTLSeconds 0`,
		)
		.action(
			handleAsyncCommand(async (key: string, value: string) => {
				if (!LOCAL_SETTABLE_KEYS.includes(key as LocalSettableKey)) {
					throw new Error(
						`Unknown local config key "${key}". Allowed: ${LOCAL_SETTABLE_KEYS.join(", ")}`,
					);
				}
				const active = resolveActiveProfile();
				const localPath = active.localConfigPath;

				let existing: ElLinearLocalConfig = {};
				if (fs.existsSync(localPath)) {
					try {
						existing = JSON.parse(
							fs.readFileSync(localPath, "utf8"),
						) as ElLinearLocalConfig;
					} catch {
						// overwrite a corrupt file
					}
				}

				const typedValue = key === "cacheTTLSeconds" ? Number(value) : value;
				if (key === "cacheTTLSeconds" && Number.isNaN(typedValue)) {
					throw new Error(`cacheTTLSeconds must be an integer, got "${value}"`);
				}

				const updated = { ...existing, [key]: typedValue };
				fs.mkdirSync(path.dirname(localPath), { recursive: true });
				fs.writeFileSync(
					localPath,
					`${JSON.stringify(updated, null, 2)}\n`,
					"utf8",
				);

				outputSuccess({ data: updated });
			}),
		);
}
