/**
 * `el-linear profile` — manage named profiles.
 *
 * A profile is a named directory under `~/.config/el-linear/profiles/`
 * that holds its own `token` + `config.json`. Profiles let one user
 * keep multiple Linear workspaces (e.g. day-job + side-project) on the
 * same machine without juggling tokens.
 *
 * Subcommands:
 *
 *   el-linear profile list                — show all profiles + which is active
 *   el-linear profile current             — print the active profile name (or `<default>`)
 *   el-linear profile use <name>          — make <name> the default profile
 *   el-linear profile add <name>          — create a profile + run init for it
 *   el-linear profile remove <name>       — delete the profile dir (with confirmation)
 *
 * The `--profile <name>` flag (top-level, see main.ts) overrides the
 * active profile for one invocation only.
 *
 * Backward-compat: when no profile is configured, every read still
 * falls back to the legacy single-file paths (CONFIG_PATH / TOKEN_PATH).
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { confirm } from "@inquirer/prompts";
import type { Command } from "commander";

import {
	ACTIVE_PROFILE_FILE,
	CONFIG_DIR,
	CONFIG_PATH,
	PROFILES_DIR,
	profilePaths,
	resolveActiveProfile,
	setActiveProfileForSession,
	TOKEN_PATH,
} from "../config/paths.js";
import { outputSuccess, outputWarning } from "../utils/output.js";
import { runFullWizard } from "./init/index.js";

export function setupProfileCommands(program: Command): void {
	const profile = program
		.command("profile")
		.description(
			"Manage el-linear profiles (named workspaces with separate tokens + configs).",
		);
	profile.action(() => profile.help());

	profile
		.command("list")
		.description("List configured profiles + which one is active.")
		.action(async () => {
			const data = await runProfileList();
			outputSuccess({ data });
		});

	profile
		.command("current")
		.description(
			"Print the active profile name (or `<default>` for the legacy single-profile setup).",
		)
		.action(() => {
			const active = resolveActiveProfile();
			outputSuccess({
				data: {
					name: active.name ?? "<default>",
					configPath: active.configPath,
					tokenPath: active.tokenPath,
				},
			});
		});

	profile
		.command("use <name>")
		.description(
			"Make <name> the active profile (writes ~/.config/el-linear/active-profile).",
		)
		.action(async (name: string) => {
			await runProfileUse(name);
			outputSuccess({ data: { name, activeProfileFile: ACTIVE_PROFILE_FILE } });
		});

	profile
		.command("add <name>")
		.description(
			"Create a new profile named <name> + run the init wizard scoped to it. After this finishes, <name> becomes the active profile.",
		)
		.action(async (name: string) => {
			await runProfileAdd(name);
		});

	profile
		.command("remove <name>")
		.alias("rm")
		.description(
			"Delete the profile directory + its token (with confirmation).",
		)
		.option("--force", "skip the confirmation prompt")
		.action(async (name: string, opts: { force?: boolean }) => {
			await runProfileRemove(name, opts.force === true);
		});
}

// ---- Implementations ----------------------------------------------------

export interface ProfileListEntry {
	name: string;
	active: boolean;
	hasToken: boolean;
	hasConfig: boolean;
	configPath: string;
	tokenPath: string;
}

export interface ProfileListReport {
	activeName: string | null;
	defaultPaths: { configPath: string; tokenPath: string };
	hasLegacyToken: boolean;
	hasLegacyConfig: boolean;
	profiles: ProfileListEntry[];
}

export async function runProfileList(): Promise<ProfileListReport> {
	const active = resolveActiveProfile();
	const profiles: ProfileListEntry[] = [];

	let entries: string[] = [];
	try {
		entries = (await fsp.readdir(PROFILES_DIR, { withFileTypes: true }))
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
			.sort();
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}

	for (const name of entries) {
		const paths = profilePaths(name);
		profiles.push({
			name,
			active: active.name === name,
			hasToken: await pathExists(paths.tokenPath),
			hasConfig: await pathExists(paths.configPath),
			configPath: paths.configPath,
			tokenPath: paths.tokenPath,
		});
	}

	return {
		activeName: active.name,
		defaultPaths: { configPath: CONFIG_PATH, tokenPath: TOKEN_PATH },
		hasLegacyToken: await pathExists(TOKEN_PATH),
		hasLegacyConfig: await pathExists(CONFIG_PATH),
		profiles,
	};
}

export async function runProfileUse(name: string): Promise<void> {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("Profile name must be non-empty.");
	if (!isSafeName(trimmed)) {
		throw new Error(
			`Profile name "${trimmed}" must contain only [a-z0-9_-]. Pick a different name.`,
		);
	}
	await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
	await fsp.writeFile(ACTIVE_PROFILE_FILE, `${trimmed}\n`, { mode: 0o644 });
}

export async function runProfileAdd(name: string): Promise<void> {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("Profile name must be non-empty.");
	if (!isSafeName(trimmed)) {
		throw new Error(
			`Profile name "${trimmed}" must contain only [a-z0-9_-]. Pick a different name.`,
		);
	}

	const dir = path.dirname(profilePaths(trimmed).configPath);
	await fsp.mkdir(dir, { recursive: true, mode: 0o700 });

	// Activate the profile for the rest of THIS process so the wizard's
	// readConfig/writeConfig/readToken/writeToken IO targets the new
	// profile's directory (not the legacy single-file path).
	setActiveProfileForSession(trimmed);

	// Persist activation: write `active-profile` so subsequent invocations
	// stay on the new profile until `profile use <other>` switches away.
	await runProfileUse(trimmed);

	outputWarning(
		`Created profile "${trimmed}" at ${dir}. Running init wizard scoped to this profile…`,
	);
	await runFullWizard();
}

export async function runProfileRemove(
	name: string,
	force: boolean,
): Promise<void> {
	const trimmed = name.trim();
	if (!trimmed || !isSafeName(trimmed)) {
		throw new Error(`Invalid profile name "${name}".`);
	}
	const paths = profilePaths(trimmed);
	const dir = path.dirname(paths.configPath);
	if (!(await pathExists(dir))) {
		throw new Error(`Profile "${trimmed}" not found at ${dir}.`);
	}

	if (!force) {
		const confirmed = await confirm({
			message: `Delete profile "${trimmed}" (${dir})? Token + config will be lost.`,
			default: false,
		});
		if (!confirmed) {
			outputWarning("Aborted.");
			return;
		}
	}

	await fsp.rm(dir, { recursive: true, force: true });

	// If the just-removed profile was the active one, clear the marker
	// so subsequent invocations fall back to the default paths.
	const active = resolveActiveProfile();
	if (active.name === trimmed && (await pathExists(ACTIVE_PROFILE_FILE))) {
		await fsp.rm(ACTIVE_PROFILE_FILE, { force: true });
	}

	outputSuccess({ data: { removed: trimmed, dir } });
}

// ---- Helpers ------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
	try {
		await fsp.access(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Profile names land in filesystem paths AND get written to a
 * single-line marker. Restrict to a conservative charset so we can't
 * accidentally pick up `..` traversal, command-line metacharacters, or
 * Unicode lookalikes that would confuse `profile use`.
 */
function isSafeName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name);
}
