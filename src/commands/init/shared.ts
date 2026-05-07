/**
 * Shared helpers for the `el-linear init` wizard.
 *
 * Every step reads the on-disk config first, shows current state, and defaults
 * to "keep as-is" so re-running the wizard with no input produces a
 * byte-identical config.
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ElLinearConfig } from "../../config/config.js";
import {
	ALIASES_PROGRESS_PATH,
	CONFIG_DIR,
	CONFIG_PATH,
	resolveActiveProfile,
	TOKEN_PATH,
} from "../../config/paths.js";

// Re-export for tests and call sites that already pulled the paths from here.
export { ALIASES_PROGRESS_PATH, CONFIG_PATH, TOKEN_PATH };

/**
 * Profile-aware paths for the active wizard run. The wizard always
 * writes to (and reads from) the active profile — switched via
 * `EL_LINEAR_PROFILE`, `--profile`, or the on-disk `active-profile`
 * marker. When no profile is selected, paths fall through to the
 * legacy single-file layout (CONFIG_PATH / TOKEN_PATH).
 */
function activePaths(): {
	configDir: string;
	configPath: string;
	tokenPath: string;
} {
	const active = resolveActiveProfile();
	return {
		// Profile dir is always the directory of configPath (whether
		// that's the legacy CONFIG_DIR or a per-profile subdirectory).
		configDir: path.dirname(active.configPath),
		configPath: active.configPath,
		tokenPath: active.tokenPath,
	};
}

/**
 * Atomic file write: write to a sibling tmp file then rename. Survives SIGINT,
 * OOM, and laptop suspend mid-write — the original file is either untouched
 * (rename never happened) or fully replaced (rename succeeded). On POSIX
 * same-filesystem, rename is atomic.
 *
 * Tmp suffix uses crypto random bytes so concurrent writers don't collide.
 *
 * @param targetPath  destination path
 * @param data        bytes/string to write
 * @param mode        unix mode for the new file (default 0o644)
 */
async function atomicWrite(
	targetPath: string,
	data: string | Uint8Array,
	mode = 0o644,
): Promise<void> {
	const tmpPath = `${targetPath}.tmp-${randomBytes(8).toString("hex")}`;
	try {
		await fs.writeFile(tmpPath, data, { encoding: "utf8", mode });
		// Defensively chmod — fs.writeFile only honors `mode` when the file is
		// newly created. Tmp is always new, but be explicit.
		await fs.chmod(tmpPath, mode);
		await fs.rename(tmpPath, targetPath);
	} catch (err) {
		// Best-effort cleanup of orphaned tmp.
		await fs.unlink(tmpPath).catch(() => {});
		throw err;
	}
}

/** Recursive Partial — sub-objects are also Partial. Arrays/primitives unchanged. */
type DeepPartial<T> =
	T extends Array<infer _U>
		? T
		: T extends object
			? { [K in keyof T]?: DeepPartial<T[K]> }
			: T;

/**
 * Shape the wizard reads and writes. `DeepPartial<ElLinearConfig>` because a
 * wizard run may only set a subset of keys at any nesting level (a partial
 * `statusDefaults: { noProject: "Backlog" }` with no `withAssigneeAndProject`
 * is valid on disk; the runtime loader applies fallbacks at read time).
 *
 * The runtime config loader (`src/config/config.ts`) is the canonical source
 * of truth for the on-disk shape; we narrow to a partial view here so the
 * wizard can compose updates without owning the whole tree.
 *
 * The on-disk `config.json` may also contain unknown keys (custom extensions
 * the wizard doesn't recognise); these are preserved verbatim through the
 * `JSON.parse → sortKeys → JSON.stringify` round-trip in `readConfig` /
 * `writeConfig` even though the type doesn't surface them.
 */
export type WizardConfig = DeepPartial<ElLinearConfig>;

export async function ensureConfigDir(): Promise<void> {
	// Always make sure the legacy CONFIG_DIR exists (it's where the
	// `active-profile` marker + `profiles/` tree live), then make the
	// active profile's directory if it differs.
	await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
	const dir = activePaths().configDir;
	if (dir !== CONFIG_DIR) {
		await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	}
}

export async function readConfig(): Promise<WizardConfig> {
	try {
		const raw = await fs.readFile(activePaths().configPath, "utf8");
		return JSON.parse(raw) as WizardConfig;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return {};
		}
		throw err;
	}
}

export async function writeConfig(config: WizardConfig): Promise<void> {
	await ensureConfigDir();
	// Stable key order so byte-identical config produces byte-identical output.
	const sorted = sortKeys(config);
	await atomicWrite(
		activePaths().configPath,
		`${JSON.stringify(sorted, null, 2)}\n`,
		0o644,
	);
}

export async function readToken(): Promise<string | null> {
	try {
		const raw = await fs.readFile(activePaths().tokenPath, "utf8");
		return raw.trim() || null;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw err;
	}
}

/**
 * Write the token to disk with mode 0600.
 *
 * IMPORTANT: We use atomicWrite (write-tmp + rename), which guarantees the
 * destination file's mode comes from the freshly-created tmp file — not from
 * any pre-existing token file. This closes a real security hole: `fs.writeFile`
 * with `{mode}` only honors the mode when *creating* a new file, so a legacy
 * token left at 0644 (umask, scp from another machine, migrated from
 * `~/.linear_api_token`) would have stayed world-readable forever otherwise.
 */
export async function writeToken(token: string): Promise<void> {
	await ensureConfigDir();
	await atomicWrite(activePaths().tokenPath, `${token.trim()}\n`, 0o600);
}

/**
 * Build a new object containing only the keys whose values are not `undefined`.
 *
 * Use this anywhere you'd otherwise spread `{ ...existing, key: maybeUndefined }`
 * — `JSON.stringify` skips `undefined` values, so the resulting JSON is fine,
 * but the in-memory merged object has an own `key` property that subsequent
 * reads diverge on. That asymmetry is what made `defaultTeam: undefined` round-
 * trip inconsistently across runs.
 */
export function assignDefined<T extends Record<string, unknown>>(
	target: T,
	updates: { [K in keyof T]?: T[K] | undefined },
): T {
	const next: Record<string, unknown> = { ...target };
	for (const key of Object.keys(updates) as Array<keyof T>) {
		const v = updates[key];
		if (v !== undefined) next[key as string] = v;
	}
	return next as T;
}

/**
 * Recursively sort object keys for stable JSON output. Arrays are left in
 * insertion order; primitive values are returned as-is.
 */
function sortKeys<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map(sortKeys) as unknown as T;
	}
	if (value && typeof value === "object" && value.constructor === Object) {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(value as Record<string, unknown>).sort()) {
			out[k] = sortKeys((value as Record<string, unknown>)[k]);
		}
		return out as unknown as T;
	}
	return value;
}

/**
 * Progress checkpoint for the resumable user-walk.
 *
 * Stores the UUID of the last user the operator completed (rather than the
 * positional index). On resume we look up that UUID's index in the freshly-
 * fetched user list — so adding or removing users in the workspace between
 * runs no longer silently misaligns the resume point onto the wrong person.
 *
 * `totalUsers` is kept around as a soft sanity check; if both UUID matching
 * and total-count match fail, we fall back to starting over.
 */
export interface AliasesProgress {
	/** UUID of the last user the operator finished. */
	lastCompletedUserId: string;
	/** Total user count when the run started — used as a soft drift signal. */
	totalUsers: number;
	/** When the progress was saved. */
	savedAt: string;
}

export async function readAliasesProgress(): Promise<AliasesProgress | null> {
	try {
		const raw = await fs.readFile(ALIASES_PROGRESS_PATH, "utf8");
		return JSON.parse(raw) as AliasesProgress;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw err;
	}
}

export async function writeAliasesProgress(p: AliasesProgress): Promise<void> {
	await ensureConfigDir();
	await atomicWrite(ALIASES_PROGRESS_PATH, JSON.stringify(p, null, 2), 0o644);
}

export async function clearAliasesProgress(): Promise<void> {
	try {
		await fs.unlink(ALIASES_PROGRESS_PATH);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			throw err;
		}
	}
}

/**
 * Print a step header in the wizard. Step strings like "1/4" or "2/4 (skipped)".
 */
export function printStep(label: string, title: string): void {
	console.log(`\n[${label}] ${title}`);
}

/**
 * Parse a comma-separated user input ("alice, ali, alex") into trimmed,
 * non-empty values. Used by the alias and label prompts.
 */
export function parseCsvList(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}
