/**
 * On-disk storage for OAuth tokens.
 *
 * Stored at `<active-profile-dir>/oauth.json` with mode 0600 — same security
 * posture as the personal-token file. Schema is versioned (`v: 1`) so future
 * changes can be migrated without silently corrupting older state.
 *
 * The personal-token file (`<profile-dir>/token`) and `oauth.json` are
 * mutually-exclusive *by convention*, not by enforcement: if both exist the
 * resolver prefers OAuth. We don't delete the personal token automatically
 * during `init oauth` — operators sometimes keep both for fallback.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG_DIR, resolveActiveProfile } from "../config/paths.js";
import { atomicWrite } from "./oauth-fs.js";

export const OAUTH_STATE_VERSION = 1;
export const OAUTH_STATE_FILENAME = "oauth.json";

/**
 * Persisted OAuth state. Mirrors what we got back from Linear's token
 * endpoint plus the bits we need to refresh / re-authorize.
 */
export interface OAuthState {
	v: typeof OAUTH_STATE_VERSION;
	clientId: string;
	clientSecret?: string;
	registeredRedirectUri: string;
	accessToken: string;
	refreshToken?: string;
	tokenType: string;
	scopes: string[];
	/** Unix epoch milliseconds; computed at write time from `expires_in`. */
	expiresAt: number;
	/** When we last fetched a token (for diagnostics). */
	obtainedAt: number;
}

/**
 * Resolve the path to the active profile's `oauth.json`. Mirrors
 * `activePaths()` in `commands/init/shared.ts` so OAuth state lands in the
 * same directory as the profile's `config.json` and `token`.
 */
export function oauthStatePath(): string {
	const active = resolveActiveProfile();
	return path.join(path.dirname(active.configPath), OAUTH_STATE_FILENAME);
}

/**
 * Read the active profile's OAuth state, or `null` if none has been written.
 * Returns `null` (not throw) on JSON parse errors so callers can fall back
 * to personal-token auth without spamming users with repair instructions —
 * the `init oauth` command is responsible for repair.
 *
 * Pass an explicit `targetPath` to bind to a specific profile's
 * `oauth.json`. Useful for read-modify-write sequences that snapshot
 * the path once at the top so a profile switch mid-sequence can't
 * cause cross-profile contamination. ALL-935.
 */
export async function readOAuthState(
	targetPath: string = oauthStatePath(),
): Promise<OAuthState | null> {
	try {
		const raw = await fs.readFile(targetPath, "utf8");
		const parsed = JSON.parse(raw) as OAuthState;
		if (parsed?.v !== OAUTH_STATE_VERSION) return null;
		if (typeof parsed.accessToken !== "string" || parsed.accessToken === "") {
			return null;
		}
		return parsed;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		// Corrupt JSON or unreadable file — treat as "no state" so the
		// resolver can fall through to personal-token auth.
		return null;
	}
}

/**
 * Write the active profile's OAuth state atomically with mode 0600.
 *
 * IMPORTANT: uses the same write-tmp + rename pattern as `writeToken` so a
 * pre-existing 0644 file gets its mode reset. Tokens leaking via group/other
 * read is the failure mode we want to make impossible.
 *
 * Pass an explicit `targetPath` to bind to a specific profile (see
 * `readOAuthState`).
 */
export async function writeOAuthState(
	state: OAuthState,
	targetPath: string = oauthStatePath(),
): Promise<void> {
	// Ensure both the legacy CONFIG_DIR (where active-profile + profiles/
	// live) and the active profile's directory exist before writing.
	await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
	await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
	await atomicWrite(targetPath, `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

/**
 * Delete the active profile's OAuth state. No-op if the file is already gone.
 */
export async function clearOAuthState(
	targetPath: string = oauthStatePath(),
): Promise<void> {
	try {
		await fs.unlink(targetPath);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

/**
 * Return `true` when the access token is still valid for at least
 * `skewMs` milliseconds. Default 60s skew protects against clock drift +
 * network latency.
 */
export function isAccessTokenFresh(
	state: OAuthState,
	skewMs = 60_000,
): boolean {
	return Date.now() + skewMs < state.expiresAt;
}
