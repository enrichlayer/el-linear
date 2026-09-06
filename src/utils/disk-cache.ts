/**
 * Profile-aware disk cache with TTL. Stores JSON envelopes at
 * `<profile-dir>/cache/<key>.json`:
 *
 *   { v: 1, key, fetchedAt, expiresAt, data }
 *
 * `cached(key, ttlSeconds, fetcher)`:
 *   - returns cached `data` when expiresAt > now
 *   - else awaits fetcher, writes envelope, returns fresh data
 *   - on read error (corrupt JSON, missing dir), silently refetches
 *
 * Bypass:
 *   - `bypass: true` option always refetches and rewrites (used by --no-cache)
 *   - any error during write is logged via stderr but doesn't fail the call
 *
 * Eviction:
 *   - no automatic eviction; old keys stay until manually cleared
 *   - `clearCache(prefix?)` for tests + a future `el-linear cache clear` command
 *
 * Path:
 *   - profile-aware via resolveActiveProfile() — caches don't bleed between
 *     profiles
 */

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "../auth/oauth-fs.js";
import { resolveActiveProfile } from "../config/paths.js";
import { logger } from "./logger.js";

const CACHE_VERSION = 1;
const CACHE_FILE_MODE = 0o644;
const CACHE_DIR_MODE = 0o700;

interface CacheEnvelope<T> {
	v: number;
	key: string;
	fetchedAt: number;
	expiresAt: number;
	data: T;
}

/**
 * Resolve `<profile-dir>/cache/`. Profile-aware so caches don't bleed
 * across profiles. The directory of the active profile's `configPath` is
 * the canonical "profile dir" — this matches what `commands/init/shared.ts`
 * uses.
 */
function cacheDir(): string {
	const active = resolveActiveProfile();
	return path.join(path.dirname(active.configPath), "cache");
}

function cachePath(key: string): string {
	return path.join(cacheDir(), `${sanitizeKey(key)}.json`);
}

/**
 * Cache keys may include filter values like `team:ENG` or `status:active`,
 * which are POSIX-safe but we still strip path separators defensively so a
 * malicious or buggy caller can't write outside the cache directory.
 */
function sanitizeKey(key: string): string {
	return key.replace(/[/\\\0]/g, "_");
}

/**
 * Atomic write: write to a sibling tmp file then rename. Mirrors the helper
 * in `commands/init/shared.ts` and `auth/oauth-fs.ts`. Duplicated (12 lines)
 * to keep the dependency graph clean — the wizard depends on cache callers
 * indirectly, so importing wizard internals here would be a cycle hazard.
 */
async function atomicWrite(targetPath: string, data: string): Promise<void> {
	const tmpPath = `${targetPath}.tmp-${randomBytes(8).toString("hex")}`;
	try {
		await fs.writeFile(tmpPath, data, {
			encoding: "utf8",
			mode: CACHE_FILE_MODE,
		});
		await fs.chmod(tmpPath, CACHE_FILE_MODE);
		await fs.rename(tmpPath, targetPath);
	} catch (err) {
		await fs.unlink(tmpPath).catch(() => {});
		throw err;
	}
}

async function readEnvelope<T>(key: string): Promise<CacheEnvelope<T> | null> {
	let raw: string;
	try {
		raw = await fs.readFile(cachePath(key), "utf8");
	} catch {
		// Missing dir, missing file, permission errors → treat as cache miss.
		return null;
	}
	try {
		const parsed = JSON.parse(raw) as CacheEnvelope<T>;
		// Reject envelopes from a future cache version we don't understand.
		if (
			!parsed ||
			typeof parsed !== "object" ||
			parsed.v !== CACHE_VERSION ||
			typeof parsed.expiresAt !== "number"
		) {
			return null;
		}
		return parsed;
	} catch {
		// Corrupt JSON → treat as cache miss.
		return null;
	}
}

async function writeEnvelope<T>(
	key: string,
	envelope: CacheEnvelope<T>,
): Promise<void> {
	const dir = cacheDir();
	await fs.mkdir(dir, { recursive: true, mode: CACHE_DIR_MODE });
	await atomicWrite(cachePath(key), JSON.stringify(envelope));
}

export interface CacheOptions {
	/** When true, skip the read step and always refetch + rewrite. */
	bypass?: boolean;
}

/**
 * Read-through cache wrapper.
 *
 *   `key`         — stable string identifier including any filter params
 *                   (e.g. `teams-list`, `labels-list-team:ENG`)
 *   `ttlSeconds`  — lifetime; `0` disables the cache entirely (always
 *                   refetch, never write).
 *   `fetcher`     — async function returning the fresh data on a miss.
 *   `options.bypass` — force a refetch even when an unexpired envelope
 *                      exists. Still rewrites on success.
 */
export async function cached<T>(
	key: string,
	ttlSeconds: number,
	fetcher: () => Promise<T>,
	options?: CacheOptions,
): Promise<T> {
	// TTL = 0 disables caching: never read, never write.
	if (ttlSeconds <= 0) {
		return fetcher();
	}

	if (!options?.bypass) {
		const envelope = await readEnvelope<T>(key);
		if (envelope && envelope.expiresAt > Date.now()) {
			return envelope.data;
		}
	}

	const fetchAndStore = async (): Promise<T> => {
		const data = await fetcher();
		const now = Date.now();
		const envelope: CacheEnvelope<T> = {
			v: CACHE_VERSION,
			key,
			fetchedAt: now,
			expiresAt: now + ttlSeconds * 1000,
			data,
		};
		try {
			await writeEnvelope(key, envelope);
		} catch (err) {
			// Cache writes are best-effort — log to stderr and return the data
			// anyway so a flaky disk doesn't break the user's command.
			const msg = err instanceof Error ? err.message : String(err);
			logger.error(`[disk-cache] write failed for "${key}": ${msg}`);
		}
		return data;
	};

	// `--no-cache` is an explicit request to bypass both the cached value and
	// cache coordination. Preserve that contract instead of making two forced
	// refreshes wait on one another.
	if (options?.bypass) return fetchAndStore();

	// Cold-cache single flight across processes. Re-read only after acquiring
	// the sidecar lock: another el-linear invocation may have populated the
	// envelope while this process was waiting. Without this second read, a
	// burst of identical commands still sends one Linear request per process.
	let enteredCriticalSection = false;
	try {
		await fs.mkdir(cacheDir(), { recursive: true, mode: CACHE_DIR_MODE });
		return await withFileLock(cachePath(key), async () => {
			enteredCriticalSection = true;
			const winner = await readEnvelope<T>(key);
			if (winner && winner.expiresAt > Date.now()) return winner.data;
			return fetchAndStore();
		});
	} catch (err) {
		// Never retry a failed fetcher: a write may have reached Linear before
		// throwing, so replaying it would be unsafe. Only coordination failures
		// that happen before entering the critical section degrade to the old
		// uncoordinated read-through behavior.
		if (enteredCriticalSection) throw err;
		const msg = err instanceof Error ? err.message : String(err);
		logger.error(`[disk-cache] single-flight unavailable for "${key}": ${msg}`);
		return fetchAndStore();
	}
}

/**
 * Clear cached entries. With no `prefix`, removes the entire cache
 * directory. With a `prefix`, only deletes envelopes whose sanitized key
 * starts with it. Errors (missing dir, permission) are swallowed so this is
 * safe to call from tests.
 */
export async function clearCache(prefix?: string): Promise<void> {
	const dir = cacheDir();
	if (!prefix) {
		await fs.rm(dir, { recursive: true, force: true });
		return;
	}
	const sanitized = sanitizeKey(prefix);
	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return;
	}
	await Promise.all(
		entries
			.filter((name) => name.endsWith(".json") && name.startsWith(sanitized))
			.map((name) => fs.unlink(path.join(dir, name)).catch(() => {})),
	);
}

/** Resolved cache TTL for command call sites: respects --no-cache + config. */
export function resolveCacheTTL(args: {
	configTTL: number | undefined;
	noCacheFlag: boolean | undefined;
}): number {
	if (args.noCacheFlag) {
		return 0;
	}
	if (args.configTTL === undefined) {
		return 3600;
	}
	return args.configTTL;
}
