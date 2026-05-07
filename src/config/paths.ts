/**
 * Canonical paths to the el-linear on-disk state. Single source of truth so the
 * config loader, the auth module, and the init wizard all agree on where to
 * read and write.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "el-linear");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token");
export const TEAM_OAUTH_CONFIG_PATH = path.join(CONFIG_DIR, "team-oauth.json");
export const ALIASES_PROGRESS_PATH = path.join(
	CONFIG_DIR,
	".init-aliases-progress",
);

/**
 * Legacy fallback paths kept for backward compatibility. The CLI was briefly
 * published as `@enrichlayer/linctl` (binary `linctl`); reverted to el-linear
 * because of an npm collision with `dorkitude/linctl`. Reads check the new
 * path first and fall back to these. Writes always go to the new path.
 */
export const LEGACY_LINCTL_CONFIG_DIR = path.join(
	os.homedir(),
	".config",
	"linctl",
);
export const LEGACY_LINCTL_CONFIG_PATH = path.join(
	LEGACY_LINCTL_CONFIG_DIR,
	"config.json",
);
export const LEGACY_LINCTL_TOKEN_PATH = path.join(
	LEGACY_LINCTL_CONFIG_DIR,
	"token",
);

/** Even older fallback from before the `~/.config/...` move (one release). */
export const LEGACY_TOKEN_PATH = path.join(os.homedir(), ".linear_api_token");

// ---- Profiles --------------------------------------------------------
//
// el-linear supports named profiles for switching between Linear
// workspaces (org A vs org B vs scratch token). Each profile owns its
// own config + token. The single-profile layout (CONFIG_PATH +
// TOKEN_PATH above) keeps working unchanged — existing users see no
// behavior change. A user opts in to multi-profile by either:
//   - calling `el-linear profile add <name>`, OR
//   - hand-creating <CONFIG_DIR>/profiles/<name>/{config.json,token}
//
// Resolution order (highest priority first):
//   1. Per-call --profile <name> flag (set via setActiveProfileForSession)
//   2. EL_LINEAR_PROFILE env var
//   3. <CONFIG_DIR>/active-profile (single-line text file)
//   4. Legacy single-file paths (CONFIG_PATH / TOKEN_PATH) — default,
//      keeps backward compatibility.

export const PROFILES_DIR = path.join(CONFIG_DIR, "profiles");
export const ACTIVE_PROFILE_FILE = path.join(CONFIG_DIR, "active-profile");

export interface ProfilePaths {
	/** Profile name; null when using the legacy single-file layout. */
	name: string | null;
	configPath: string;
	tokenPath: string;
}

export interface ProfileFsOps {
	readFileSync: (p: string) => string;
	existsSync: (p: string) => boolean;
}

const DEFAULT_FS_OPS: ProfileFsOps = {
	readFileSync: (p: string) => fs.readFileSync(p, "utf8"),
	existsSync: (p: string) => fs.existsSync(p),
};

/**
 * Per-process override for the active profile name. Set by main.ts when
 * `--profile <name>` is passed (highest priority).
 */
let sessionProfileOverride: string | null = null;

/**
 * Set the active profile for the duration of this process. Pass `null`
 * to clear the override and fall back to env / on-disk markers.
 */
export function setActiveProfileForSession(name: string | null): void {
	sessionProfileOverride = name && name.trim().length > 0 ? name.trim() : null;
}

/** Read-only accessor for the per-session override (test seam). */
export function getSessionProfileOverride(): string | null {
	return sessionProfileOverride;
}

/**
 * Resolve the active profile name + on-disk paths. Returns the legacy
 * single-file layout when no profile is selected, so existing setups
 * keep working without migration.
 */
export function resolveActiveProfile(
	env: NodeJS.ProcessEnv = process.env,
	fsImpl: ProfileFsOps = DEFAULT_FS_OPS,
): ProfilePaths {
	const explicit =
		sessionProfileOverride ??
		(env.EL_LINEAR_PROFILE?.trim() || null) ??
		readActiveProfileMarker(fsImpl);
	if (explicit) {
		return profilePaths(explicit);
	}
	return {
		name: null,
		configPath: CONFIG_PATH,
		tokenPath: TOKEN_PATH,
	};
}

/** Build profile-relative paths for a named profile. Pure. */
export function profilePaths(name: string): ProfilePaths {
	const dir = path.join(PROFILES_DIR, name);
	return {
		name,
		configPath: path.join(dir, "config.json"),
		tokenPath: path.join(dir, "token"),
	};
}

function readActiveProfileMarker(fsImpl: ProfileFsOps): string | null {
	if (!fsImpl.existsSync(ACTIVE_PROFILE_FILE)) return null;
	try {
		const value = fsImpl.readFileSync(ACTIVE_PROFILE_FILE).toString().trim();
		return value.length > 0 ? value : null;
	} catch {
		return null;
	}
}
