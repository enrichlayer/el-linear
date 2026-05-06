/**
 * Canonical paths to the el-linear on-disk state. Single source of truth so the
 * config loader, the auth module, and the init wizard all agree on where to
 * read and write.
 */

import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "el-linear");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token");
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
