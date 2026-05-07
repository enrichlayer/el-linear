/**
 * Detects "legacy drift" — the on-disk state where a user upgraded el-linear
 * to >=1.4.0 (named profiles) while their old `~/.config/el-linear/config.json`
 * is still present but the legacy single-file `token` (and any per-profile
 * token) is missing or unreadable. In that state every command fails with
 * "No API token found" and the user has no clear migration path.
 *
 * This module is **pure detection** — it returns a discriminated state and
 * nothing else. The hint emission lives in `migration-hint.ts` and is wired
 * into the auth-failure path (`auth.ts`) so the user gets a single clear
 * stderr line *before* the regular auth error fires.
 *
 * The state shape is intentionally a discriminated union so callers can match
 * exhaustively without re-checking individual booleans:
 *
 *   { kind: 'no-drift' }
 *     — healthy: legacy single-file layout *or* a working active profile.
 *
 *   { kind: 'legacy-no-token' }
 *     — `config.json` exists but no token (legacy or per-profile) does. This
 *       is the post-upgrade case: 1.4.0 expects per-profile tokens; legacy
 *       config was never migrated.
 *
 *   { kind: 'broken-active-profile' }
 *     — `active-profile` points at a name whose directory doesn't exist.
 *       Typically caused by an interrupted `profile remove` or a hand-edit.
 */

import fs from "node:fs";
import path from "node:path";
import {
	ACTIVE_PROFILE_FILE,
	CONFIG_PATH,
	PROFILES_DIR,
	TOKEN_PATH,
} from "../config/paths.js";

export type LegacyDriftState =
	| { kind: "no-drift" }
	| { kind: "legacy-no-token"; legacyConfigPath: string }
	| { kind: "broken-active-profile"; pointedAt: string };

export interface DetectionFsOps {
	existsSync: (p: string) => boolean;
	readFileSync: (p: string) => string;
	readdirSync: (p: string) => string[];
}

const DEFAULT_FS_OPS: DetectionFsOps = {
	existsSync: (p) => fs.existsSync(p),
	readFileSync: (p) => fs.readFileSync(p, "utf8"),
	readdirSync: (p) => fs.readdirSync(p),
};

/**
 * Detect drift between the legacy single-file layout and the >=1.4 named-
 * profiles layout. Pure — `fsImpl` is overridable so tests can drive every
 * branch without touching the filesystem.
 */
export function detectLegacyDrift(
	fsImpl: DetectionFsOps = DEFAULT_FS_OPS,
): LegacyDriftState {
	// Branch 1: broken active-profile pointer.
	// The `active-profile` marker names a profile that doesn't exist on disk —
	// classic post-`profile remove` orphan, or a hand-edit typo. We classify
	// this *before* the legacy-no-token branch because the user explicitly
	// asked for that profile; the right fix is `profile use <good-name>`, not
	// migration.
	if (fsImpl.existsSync(ACTIVE_PROFILE_FILE)) {
		let pointedAt = "";
		try {
			pointedAt = fsImpl.readFileSync(ACTIVE_PROFILE_FILE).trim();
		} catch {
			pointedAt = "";
		}
		if (pointedAt.length > 0) {
			const profileDir = path.join(PROFILES_DIR, pointedAt);
			if (!fsImpl.existsSync(profileDir)) {
				return { kind: "broken-active-profile", pointedAt };
			}
		}
	}

	// Branch 2: legacy drift.
	// Legacy `config.json` exists; legacy `token` doesn't; no profiles configured.
	// "No profiles configured" = profiles dir missing OR exists-but-empty.
	if (!fsImpl.existsSync(CONFIG_PATH)) {
		return { kind: "no-drift" };
	}
	if (fsImpl.existsSync(TOKEN_PATH)) {
		return { kind: "no-drift" };
	}
	const profilesEmpty = isProfilesDirEmpty(fsImpl);
	if (!profilesEmpty) {
		return { kind: "no-drift" };
	}
	return { kind: "legacy-no-token", legacyConfigPath: CONFIG_PATH };
}

function isProfilesDirEmpty(fsImpl: DetectionFsOps): boolean {
	if (!fsImpl.existsSync(PROFILES_DIR)) return true;
	try {
		const entries = fsImpl.readdirSync(PROFILES_DIR);
		return entries.length === 0;
	} catch {
		// Unreadable dir — treat as empty for the purposes of drift detection
		// so we don't suppress the hint on a permissions edge case.
		return true;
	}
}
