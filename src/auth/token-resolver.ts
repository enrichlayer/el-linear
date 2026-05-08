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
import {
	type OAuthState,
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
 */
export async function ensureFreshAccessToken(
	state: OAuthState,
	options: GetActiveAuthOptions = {},
): Promise<OAuthState> {
	const now = options.now ?? Date.now;
	// Use the injected clock for the freshness check — `isAccessTokenFresh`
	// reads `Date.now()` directly, which doesn't honor the test seam. When
	// a test pins `now` to a fake epoch (or the production wall clock has
	// drifted relative to `state.expiresAt`), going through the helper
	// short-circuits the wrong way and falls through to a real refresh.
	if (now() + 60_000 < state.expiresAt) {
		return state;
	}
	if (!state.refreshToken) {
		throw new Error(
			"OAuth access token expired and no refresh token is stored. Re-run `el-linear init oauth`.",
		);
	}

	let refreshed: ExchangeResult;
	try {
		refreshed = await refreshTokens(
			{
				clientId: state.clientId,
				clientSecret: state.clientSecret,
				refreshToken: state.refreshToken,
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
		...state,
		accessToken: refreshed.accessToken,
		// Preserve the previous refresh token if the server didn't rotate
		// (some OAuth servers only return a new refresh_token periodically).
		refreshToken: refreshed.refreshToken ?? state.refreshToken,
		tokenType: refreshed.tokenType,
		// Use the freshly-returned scopes only if non-empty; otherwise keep
		// what we had, since some token endpoints omit `scope` on refresh.
		scopes: refreshed.scopes.length > 0 ? refreshed.scopes : state.scopes,
		expiresAt: refreshed.expiresAt,
		obtainedAt: now(),
	};
	await writeOAuthState(next);
	return next;
}
