/**
 * Unified resolver: returns the right credential for a CLI invocation,
 * preferring OAuth state when present and auto-refreshing expired tokens.
 *
 * Resolution order (highest priority first):
 *   1. `--api-token <token>` flag (always personal-style — sent without
 *      `Bearer `).
 *   2. `LINEAR_API_TOKEN` env var (personal-style).
 *   3. Profile OAuth state (`<profile-dir>/oauth.json`) — auto-refreshes
 *      when the access token has < 60s of validity left.
 *   4. Profile personal token (`<profile-dir>/token`) and legacy fallbacks.
 *
 * The kind discriminant (`personal` vs `oauth`) tells `GraphQLService` which
 * `Authorization` header shape to use:
 *   - personal:  `Authorization: <token>`        (no Bearer prefix)
 *   - oauth:     `Authorization: Bearer <token>`
 */

import { getApiToken } from "../utils/auth.js";
import { withFileLock } from "./oauth-fs.js";
import {
	type OAuthState,
	oauthStatePath,
	readOAuthState,
	writeOAuthState,
} from "./oauth-storage.js";
import {
	type ExchangeResult,
	type FetchLike,
	refreshTokens,
} from "./oauth-token.js";

export interface ActiveAuth {
	kind: "personal" | "oauth";
	token: string;
	/** Original OAuth state, when `kind === "oauth"`. */
	oauth?: OAuthState;
}

export interface GetActiveAuthOptions {
	apiToken?: string;
	/** Test seam: override the network fetcher used by refresh. */
	fetchImpl?: FetchLike;
	/** Test seam: override the wall-clock for refresh expiry checks. */
	now?: () => number;
}

/**
 * Resolve the credential for this invocation.
 *
 * Synchronous personal-token paths still work via `getApiToken` for
 * backwards compatibility — code that hasn't been migrated to OAuth-aware
 * call sites keeps using `getApiToken` directly.
 */
export async function getActiveAuth(
	options: GetActiveAuthOptions = {},
): Promise<ActiveAuth> {
	// 1) Explicit override: `--api-token` always wins. Personal-style.
	if (options.apiToken) {
		return { kind: "personal", token: options.apiToken };
	}
	// 2) Env var: same precedence as the legacy resolver. Personal-style.
	if (process.env.LINEAR_API_TOKEN) {
		return { kind: "personal", token: process.env.LINEAR_API_TOKEN };
	}

	// 3) OAuth state for the active profile, auto-refreshed if needed.
	const oauth = await readOAuthState();
	if (oauth) {
		const fresh = await ensureFreshAccessToken(oauth, options);
		return { kind: "oauth", token: fresh.accessToken, oauth: fresh };
	}

	// 4) Fall back to the existing personal-token resolver (handles
	//    profile-aware token files, legacy paths, etc.). If no token can
	//    be found, this throws — and the message already mentions the
	//    profile, so we don't have to re-wrap.
	return { kind: "personal", token: getApiToken({}) };
}

/**
 * If the token is fresh, return state unchanged. Otherwise call
 * `refreshTokens`, write the new state to disk, and return it.
 *
 * On refresh failure, throws an actionable error pointing at
 * `el-linear init oauth`.
 *
 * **Concurrency.** When a refresh is needed, this acquires an exclusive
 * file lock on the oauth.json sidecar before reading-refreshing-writing.
 * Two parallel CLI invocations would otherwise both call `refreshTokens`
 * with the same refresh token; Linear's server invalidates the loser's
 * stored token and the next refresh permanently fails. The lock
 * serialises them — the second process re-reads the freshly-written
 * state inside the lock and uses the winner's tokens instead of issuing
 * a second refresh.
 */
export async function ensureFreshAccessToken(
	state: OAuthState,
	options: GetActiveAuthOptions = {},
): Promise<OAuthState> {
	const now = options.now ?? Date.now;
	// Fast path: token is fresh; no lock, no refresh.
	if (now() + 60_000 < state.expiresAt) {
		return state;
	}
	// Snapshot the target path ONCE so a profile switch between the
	// lock acquisition and the write inside the closure can't cause
	// cross-profile contamination. The lock + read + write all bind
	// to this path. ALL-935 deferred fix.
	const targetPath = oauthStatePath();
	return withFileLock(targetPath, async () => {
		// Re-read inside the lock — another process may have refreshed
		// while we were waiting. If so, use their result.
		const current = (await readOAuthState(targetPath)) ?? state;
		if (now() + 60_000 < current.expiresAt) {
			return current;
		}
		if (!current.refreshToken) {
			throw new Error(
				"OAuth access token expired and no refresh token is stored. Re-run `el-linear init oauth`.",
			);
		}

		let refreshed: ExchangeResult;
		try {
			refreshed = await refreshTokens(
				{
					clientId: current.clientId,
					clientSecret: current.clientSecret,
					refreshToken: current.refreshToken,
				},
				options.fetchImpl,
				now,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(
				`OAuth refresh failed: ${message}. Re-run \`el-linear init oauth\` to re-authorize.`,
			);
		}

		const next: OAuthState = {
			...current,
			accessToken: refreshed.accessToken,
			// Preserve the previous refresh token if the server didn't rotate
			// (some OAuth servers only return a new refresh_token periodically).
			refreshToken: refreshed.refreshToken ?? current.refreshToken,
			tokenType: refreshed.tokenType,
			// Use the freshly-returned scopes only if non-empty; otherwise
			// keep what we had — some token endpoints omit `scope` on refresh.
			scopes: refreshed.scopes.length > 0 ? refreshed.scopes : current.scopes,
			expiresAt: refreshed.expiresAt,
			obtainedAt: now(),
		};
		await writeOAuthState(next, targetPath);
		return next;
	});
}
