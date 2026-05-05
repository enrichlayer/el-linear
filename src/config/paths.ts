/**
 * Canonical paths to the linctl on-disk state. Single source of truth so the
 * config loader, the auth module, and the init wizard all agree on where to
 * read and write.
 */

import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "linctl");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token");
export const ALIASES_PROGRESS_PATH = path.join(
	CONFIG_DIR,
	".init-aliases-progress",
);

/** Legacy fallback paths kept for backward compatibility (one release). */
export const LEGACY_TOKEN_PATH = path.join(os.homedir(), ".linear_api_token");
