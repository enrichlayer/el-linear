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
	isSafeProfileName as isSafeName,
	PROFILES_DIR,
	profilePaths,
	readActiveProfileMarker,
	resolveActiveProfile,
	setActiveProfileForSession,
	TOKEN_PATH,
} from "../config/paths.js";
import {
	applyGlobalPin,
	applyRepoLocalPin,
	defaultRepoProfileOps,
	globalPinTablePath,
	LINEAR_PROFILE_REPO_FILE,
	removeRepoLocalPin,
	resolveRepoLinearProfile,
} from "../config/repo-profile.js";
import { outputSuccess, outputWarning } from "../utils/output.js";
import { runFullWizard } from "./init/index.js";
import { registerMembersCommands } from "./profile/members.js";
import { registerMigrateLegacy } from "./profile/migrate-legacy.js";

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
					localConfigPath: active.localConfigPath,
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

	// `el-linear profile pin [name]` — DEV-7277: pin the current git repo to a
	// Linear profile so multi-workspace users stop defaulting to the wrong one.
	profile
		.command("pin [name]")
		.description(
			"Pin the current git repo to a Linear profile so writes target the right workspace. Writes .el-git.json at the repo root (shared with el-git/el-session); [name] defaults to the active profile.",
		)
		.option(
			"--global",
			"pin via the global owner/repo table (~/.config/el-git/linear-profiles.json) instead of the repo-local .el-git.json",
		)
		.option(
			"--show",
			"print the resolved pin + its source without writing anything",
		)
		.action(async (name: string | undefined, opts: ProfilePinOptions) => {
			await runProfilePin(name, opts);
		});

	profile
		.command("unpin")
		.description(
			"Remove this repo's repo-local pin (drops linearProfile from .el-git.json).",
		)
		.action(async () => {
			await runProfileUnpin();
		});

	// `el-linear profile migrate-legacy` — registered alongside add/list/etc.
	// Lives in its own module so the multi-step migration logic stays
	// self-contained and unit-testable without dragging in the full
	// profile-management surface.
	registerMigrateLegacy(profile);

	// `el-linear profile members {list,clear,set}` — DEV-5612: direct,
	// non-interactive alias/handle edits without hand-editing config.json.
	registerMembersCommands(profile);
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
	// DEV-5610: `active-profile` is a single, machine-global marker — every
	// el-linear invocation anywhere on this machine that doesn't set
	// --profile/$EL_LINEAR_PROFILE resolves through it. Warn loudly on an
	// actual switch so the blast radius is visible instead of silently
	// redirecting some other concurrent session/tool to a different
	// workspace. `--profile`/$EL_LINEAR_PROFILE remain the correct,
	// non-mutating choice for automation and concurrent sessions.
	//
	// Read the raw marker (readActiveProfileMarker), not
	// resolveActiveProfile().name — the latter resolves through the
	// --profile/$EL_LINEAR_PROFILE precedence layers too, so a concurrent
	// override in place while `profile use` runs would make it report the
	// wrong "previous" value (a false-positive warning when the marker
	// didn't actually change, or a false-negative when it did) — cycle-1
	// review finding on PR #229.
	const previous = readActiveProfileMarker();
	await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
	await fsp.writeFile(ACTIVE_PROFILE_FILE, `${trimmed}\n`, { mode: 0o644 });
	if (previous !== trimmed) {
		outputWarning(
			`Switched the GLOBAL active profile to "${trimmed}" (${ACTIVE_PROFILE_FILE}). This affects every other el-linear invocation on this machine that doesn't set --profile/$EL_LINEAR_PROFILE explicitly — concurrent sessions/tools relying on a different profile will silently start hitting the wrong workspace.`,
		);
	}
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

// ---- Repo pin (DEV-7277) ------------------------------------------------

export interface ProfilePinOptions {
	global?: boolean;
	show?: boolean;
}

async function readFileOrNull(p: string): Promise<string | null> {
	try {
		return await fsp.readFile(p, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

/**
 * `el-linear profile pin [name]` — pin the current git repo to a Linear
 * profile. Default target is the repo-local `.el-git.json`; `--global` writes
 * the `owner/repo` entry into the shared global table. `--show` reports the
 * resolved pin without writing.
 */
export async function runProfilePin(
	name: string | undefined,
	opts: ProfilePinOptions,
): Promise<void> {
	const ops = defaultRepoProfileOps();
	const cwd = process.cwd();
	const root = ops.repoRoot(cwd);

	if (opts.show) {
		const resolved = resolveRepoLinearProfile(cwd);
		outputSuccess({
			data: {
				pinned: resolved?.profile ?? null,
				source: resolved?.source ?? null,
				repoRoot: root,
				originFullpath: ops.originFullpath(cwd),
			},
		});
		return;
	}

	if (!root) {
		throw new Error(
			"Not in a git repository. `profile pin` writes a repo-scoped pin and needs a git repo (run it inside the repo you want to pin).",
		);
	}

	// Default to the active profile when no name is given.
	const target = (name ?? resolveActiveProfile().name ?? "").trim();
	if (!target) {
		throw new Error(
			"No profile name given and no active profile is set (legacy single-profile default). Pass a name explicitly: `el-linear profile pin <name>`.",
		);
	}
	if (!isSafeName(target)) {
		throw new Error(
			`Profile name "${target}" must contain only [a-z0-9_-]. Pick a different name.`,
		);
	}

	if (opts.global) {
		const fullpath = ops.originFullpath(cwd);
		if (!fullpath) {
			throw new Error(
				"Cannot determine the origin owner/repo for a global pin. Add an `origin` remote, or drop --global to write a repo-local .el-git.json instead.",
			);
		}
		const file = globalPinTablePath();
		const next = applyGlobalPin(await readFileOrNull(file), fullpath, target);
		await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		await fsp.writeFile(file, next, { mode: 0o644 });
		outputSuccess({
			data: { scope: "global", key: fullpath, profile: target, file },
		});
		return;
	}

	const file = path.join(root, LINEAR_PROFILE_REPO_FILE);
	const next = applyRepoLocalPin(await readFileOrNull(file), target);
	await fsp.writeFile(file, next, { mode: 0o644 });
	outputSuccess({ data: { scope: "repo", profile: target, file } });
}

/**
 * `el-linear profile unpin` — remove the repo-local pin. Preserves any sibling
 * keys in `.el-git.json`; deletes the file only when the pin was its sole key.
 */
export async function runProfileUnpin(): Promise<void> {
	const ops = defaultRepoProfileOps();
	const cwd = process.cwd();
	const root = ops.repoRoot(cwd);
	if (!root) {
		throw new Error(
			"Not in a git repository. `profile unpin` operates on the repo-local .el-git.json.",
		);
	}
	const file = path.join(root, LINEAR_PROFILE_REPO_FILE);
	const existing = await readFileOrNull(file);
	const next = removeRepoLocalPin(existing);
	if (next === null) {
		if (existing !== null) await fsp.rm(file, { force: true });
	} else {
		await fsp.writeFile(file, next, { mode: 0o644 });
	}
	outputSuccess({ data: { scope: "repo", unpinned: true, file } });
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
