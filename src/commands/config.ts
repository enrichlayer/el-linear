import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import type { ElLinearLocalConfig } from "../config/config.js";
import {
	getActiveTeamConfigPath,
	loadConfig,
	loadLocalConfig,
} from "../config/config.js";
import { resolveActiveProfile } from "../config/paths.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

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
					throw new Error(
						`cacheTTLSeconds must be an integer, got "${value}"`,
					);
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
