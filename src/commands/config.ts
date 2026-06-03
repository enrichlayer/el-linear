import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import type { ElLinearLocalConfig } from "../config/config.js";
import {
	getActiveTeamConfigInfo,
	getActiveTeamConfigPath,
	loadConfig,
	loadLocalConfig,
	type TeamConfigSource,
} from "../config/config.js";
import {
	type JsonObject,
	planMigration,
} from "../config/migrate-from-personal.js";
import {
	CONFIG_PATH,
	isSafeProfileName,
	PROFILES_DIR,
	resolveActiveProfile,
} from "../config/paths.js";
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

/**
 * Render the team-config source token returned by `getActiveTeamConfigInfo()`
 * as a human-readable string for `config team show`. Kept next to the command
 * (not in `config/config.ts`) so the wire format is owned by the renderer,
 * not the resolver. DEV-4258.
 */
function sourceLabel(source: TeamConfigSource): string | null {
	switch (source) {
		case "env":
			return "EL_LINEAR_TEAM_CONFIG env var";
		case "personal":
			return "teamConfigPath in personal config";
		case "marker":
			return "auto-discovered via ~/.config/el-tools-root";
		case null:
			return null;
	}
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
			"Show the active team config layer: path, source (env var, personal config, or auto-discovered marker), file status, top-level keys it contributes",
		)
		.addHelpText(
			"after",
			"\nResolves the team config in the same order loadConfig() does:\n  EL_LINEAR_TEAM_CONFIG (env)  >  teamConfigPath (personal config)  >  ~/.config/el-tools-root marker\n\nExamples:\n  el-linear config team show",
		)
		.action(() => {
			const info = getActiveTeamConfigInfo();
			const teamPath = info.path;
			const source = sourceLabel(info.source);
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

	// ── config migrate-from-personal ──────────────────────────────────
	//
	// Slim personal/profile configs that duplicate keys the team config now
	// provides (DEV-4458). The companion pure logic + tests live in
	// `src/config/migrate-from-personal.ts`. This command just discovers
	// the target files, reads the active team config, calls planMigration
	// for each, and on --apply backs up + atomically rewrites them.

	config
		.command("migrate-from-personal")
		.description(
			"Slim personal/profile configs against the active team config — drops duplicated members/teams/labels/statusDefaults/teamAliases entries, and migrates the deprecated 'brand' key to a 'terms[]' entry. Dry-run by default; pass --apply to write.",
		)
		.option(
			"--apply",
			"Write the slimmed files (with timestamped .bak-<ts> backups + atomic replace). Default is dry-run — only prints the plan.",
		)
		.option(
			"--file <path>",
			"Scope to one file. Default: ~/.config/el-linear/config.json plus every <profiles>/<name>/config.json with a safe name.",
		)
		.addHelpText(
			"after",
			`\nThe slim only drops a shadowable top-level key when the personal copy is a strict subset of team (zero divergence and zero non-trivial personal-only entries). Anything that would silently shadow a team value, or carry a personal-only entry team doesn't have, is left untouched and reported in the plan so a human can decide.\n\nThe active team config is never a target — passing --file <team-path> is rejected, and a profile config that happens to coincide with the team path is skipped silently with a warning. The first --apply may re-format JSON to 2-space indent + trailing newline; this is harmless but the .bak-<ts> backup preserves the original byte-for-byte.\n\nUses the currently-active team config for every target. If you have profiles pointing at different team configs, run --file <path> per profile with EL_LINEAR_TEAM_CONFIG set.\n\nExamples:\n  el-linear config migrate-from-personal\n  el-linear config migrate-from-personal --apply\n  el-linear config migrate-from-personal --file ~/.config/el-linear/profiles/foo/config.json --apply`,
		)
		.action(
			handleAsyncCommand(async (opts: { apply?: boolean; file?: string }) => {
				const teamPath = getActiveTeamConfigPath();
				if (!teamPath) {
					throw new Error(
						"No active team config found. Set one with `el-linear config team set-path <path>` (or EL_LINEAR_TEAM_CONFIG) before running migrate-from-personal — without a team layer there's nothing to dedupe against.",
					);
				}
				let team: JsonObject;
				try {
					team = JSON.parse(fs.readFileSync(teamPath, "utf8")) as JsonObject;
				} catch (err) {
					throw new Error(
						`Failed to read team config at ${teamPath}: ${(err as Error).message}`,
					);
				}

				const apply = opts.apply ?? false;
				const resolvedTeamPath = path.resolve(teamPath);

				// Self-diff guard: refuse to migrate the team config against itself
				// (cycle-1 nit). Without this, every shadowable key in team would
				// classify as "drop" (a key is trivially a subset of itself) and
				// --apply would gut the team config.
				if (
					opts.file &&
					path.resolve(expandHome(opts.file)) === resolvedTeamPath
				) {
					throw new Error(
						`--file resolves to the active team config (${resolvedTeamPath}). Refusing to migrate the team config against itself.`,
					);
				}

				const targetsBeforeFilter = opts.file
					? [path.resolve(expandHome(opts.file))]
					: enumerateMigrationTargets();
				const targets: string[] = [];
				for (const t of targetsBeforeFilter) {
					if (path.resolve(t) === resolvedTeamPath) {
						outputWarning(
							`Skipping ${t} — it resolves to the active team config; migrating it against itself would erase team-shared keys.`,
						);
						continue;
					}
					targets.push(t);
				}

				const results = targets.map((file) =>
					migrateOneFile(file, team, apply),
				);

				// Forward per-file plan warnings to the standard _warnings envelope
				// (cycle-1 nit) so scripters reading the stable warning channel see
				// them without having to inspect each target.
				for (const r of results) {
					for (const w of r.warnings) outputWarning(`${r.file}: ${w}`);
				}

				// --file <single>: an unreadable / unparseable target is a hard
				// failure (cycle-1 nit). Default enumeration stays soft so one bad
				// profile doesn't crash the run for the rest.
				if (opts.file && results.length === 1 && results[0].error) {
					throw new Error(results[0].error);
				}

				outputSuccess({
					data: {
						teamConfigPath: teamPath,
						applied: apply,
						targetCount: results.length,
						targets: results,
					},
				});
			}),
		);
}

/**
 * Enumerate every personal/profile config file the migration tool should
 * consider by default: the global personal config, plus each profile dir
 * whose name passes `isSafeProfileName` and whose `config.json` exists.
 */
function enumerateMigrationTargets(): string[] {
	const out: string[] = [];
	if (fs.existsSync(CONFIG_PATH)) out.push(CONFIG_PATH);
	if (fs.existsSync(PROFILES_DIR)) {
		const entries = fs.readdirSync(PROFILES_DIR);
		for (const name of entries.sort()) {
			if (!isSafeProfileName(name)) continue;
			const p = path.join(PROFILES_DIR, name, "config.json");
			if (fs.existsSync(p)) out.push(p);
		}
	}
	return out;
}

interface PerFileResult {
	file: string;
	changed: boolean;
	before: { sizeBytes: number; keys: string[] };
	after: { sizeBytes: number; keys: string[] };
	keys: ReturnType<typeof planMigration>["plan"]["keys"];
	brand: ReturnType<typeof planMigration>["plan"]["brand"];
	warnings: string[];
	backup?: string;
	error?: string;
}

function migrateOneFile(
	file: string,
	team: JsonObject,
	apply: boolean,
): PerFileResult {
	let rawText: string;
	let personal: JsonObject;
	try {
		rawText = fs.readFileSync(file, "utf8");
		personal = JSON.parse(rawText) as JsonObject;
	} catch (err) {
		return {
			file,
			changed: false,
			before: { sizeBytes: 0, keys: [] },
			after: { sizeBytes: 0, keys: [] },
			keys: [],
			brand: { status: "absent" },
			warnings: [],
			error: `Could not read/parse: ${(err as Error).message}`,
		};
	}

	const { slimmed, plan } = planMigration(personal, team);
	const slimmedText = `${JSON.stringify(slimmed, null, 2)}\n`;
	const beforeBytes = Buffer.byteLength(rawText, "utf8");
	const afterBytes = Buffer.byteLength(slimmedText, "utf8");
	const changed = slimmedText !== rawText;

	const result: PerFileResult = {
		file,
		changed,
		before: { sizeBytes: beforeBytes, keys: Object.keys(personal) },
		after: { sizeBytes: afterBytes, keys: Object.keys(slimmed) },
		keys: plan.keys,
		brand: plan.brand,
		warnings: plan.warnings,
	};

	if (apply && changed) {
		// Backup names include milliseconds (sub-second collisions on rapid
		// re-apply would otherwise overwrite the original backup) AND copy
		// with COPYFILE_EXCL so a same-millisecond collision throws instead
		// of clobbering. Same for the temp file via `wx` flag.
		const { backup, tmp } = acquireBackupAndTempPaths(file);
		fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
		fs.writeFileSync(tmp, slimmedText, { encoding: "utf8", flag: "wx" });
		fs.renameSync(tmp, file);
		result.backup = backup;
	}

	return result;
}

function backupTimestamp(): string {
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, "0");
	const pad3 = (n: number) => n.toString().padStart(3, "0");
	return (
		`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
		`-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
		`-${pad3(d.getMilliseconds())}`
	);
}

/**
 * Pick a `.bak-<ts>` and `.tmp-<ts>` pair that don't collide with anything
 * on disk. Millisecond resolution makes a collision extraordinarily rare,
 * but a tight retry loop closes the remaining gap (and the `COPYFILE_EXCL`
 * / `wx` flags at the call site fail loudly if the gap is ever crossed).
 */
function acquireBackupAndTempPaths(file: string): {
	backup: string;
	tmp: string;
} {
	for (let attempt = 0; attempt < 100; attempt++) {
		const ts = backupTimestamp();
		const suffix = attempt === 0 ? ts : `${ts}-${attempt}`;
		const backup = `${file}.bak-${suffix}`;
		const tmp = `${file}.tmp-${suffix}`;
		if (!fs.existsSync(backup) && !fs.existsSync(tmp)) {
			return { backup, tmp };
		}
	}
	throw new Error(
		`Could not pick a unique backup name for ${file} after 100 attempts; clean up old .bak-/.tmp- siblings and retry.`,
	);
}
