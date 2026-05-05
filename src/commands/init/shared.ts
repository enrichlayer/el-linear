/**
 * Shared helpers for the `linctl init` wizard.
 *
 * Every step reads the on-disk config first, shows current state, and defaults
 * to "keep as-is" so re-running the wizard with no input produces a
 * byte-identical config.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".config", "linctl");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token");
export const ALIASES_PROGRESS_PATH = path.join(
	CONFIG_DIR,
	".init-aliases-progress",
);

/**
 * Minimal config shape — mirrors the subset that the wizard reads/writes.
 * The runtime `loadConfig()` uses a richer type; we accept any extra keys
 * so the wizard never accidentally drops fields it doesn't know about.
 */
export interface WizardConfig {
	defaultLabels?: string[];
	defaultTeam?: string;
	labels?: {
		workspace?: Record<string, string>;
		teams?: Record<string, Record<string, string>>;
	};
	members?: {
		aliases?: Record<string, string>;
		fullNames?: Record<string, string>;
		handles?: Record<string, Record<string, string>>;
		uuids?: Record<string, string>;
	};
	statusDefaults?: {
		noProject?: string;
		withAssigneeAndProject?: string;
	};
	teamAliases?: Record<string, string>;
	teams?: Record<string, string>;
	terms?: Array<{ canonical: string; reject: string[] }>;
	workspaceUrlKey?: string;
	[key: string]: unknown;
}

export async function ensureConfigDir(): Promise<void> {
	await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}

export async function readConfig(): Promise<WizardConfig> {
	try {
		const raw = await fs.readFile(CONFIG_PATH, "utf8");
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
	await fs.writeFile(
		CONFIG_PATH,
		`${JSON.stringify(sorted, null, 2)}\n`,
		"utf8",
	);
}

export async function readToken(): Promise<string | null> {
	try {
		const raw = await fs.readFile(TOKEN_PATH, "utf8");
		return raw.trim() || null;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw err;
	}
}

export async function writeToken(token: string): Promise<void> {
	await ensureConfigDir();
	await fs.writeFile(TOKEN_PATH, `${token.trim()}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
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

export interface AliasesProgress {
	/** Index into the user list (zero-based). */
	lastCompleted: number;
	/** Total user count when the run started — used to detect drift. */
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
	await fs.writeFile(ALIASES_PROGRESS_PATH, JSON.stringify(p, null, 2), "utf8");
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
	// biome-ignore lint/suspicious/noConsole: wizard output is meant for stdout
	console.log(`\n[${label}] ${title}`);
}
