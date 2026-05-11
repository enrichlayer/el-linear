/**
 * Linear OAuth token endpoint calls: code exchange, refresh, and revoke.
 *
 * Linear's token endpoint accepts both `application/x-www-form-urlencoded`
 * and JSON; we use form-encoded because that's what the docs show and what
 * spec-compliant servers all support.
 *
 * We keep the dependency surface tiny — just `globalThis.fetch` (Node 22+
 * has it native) plus our own tiny error envelope. The only thing the
 * caller injects is the URL fetcher, so tests can mock without touching the
 * network.
 */

import { sanitizeForLog } from "../utils/sanitize-for-log.js";
import {
	LINEAR_REVOKE_URL,
	LINEAR_TOKEN_URL,
	type OAuthScope,
} from "./oauth-client.js";

/**
 * Minimal subset of `globalThis.fetch` we use. Typing as the structural
 * shape (instead of `typeof fetch`) avoids dragging in DOM lib types.
 */
export type FetchLike = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	text(): Promise<string>;
}>;

const defaultFetch: FetchLike = async (url, init) => {
	const res = await globalThis.fetch(url, init);
	return {
		ok: res.ok,
		status: res.status,
		statusText: res.statusText,
		text: () => res.text(),
	};
};

/** Shape Linear returns from /oauth/token on success. */
interface LinearTokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
	refresh_token?: string;
}

export interface ExchangeCodeInput {
	clientId: string;
	clientSecret?: string;
	code: string;
	redirectUri: string;
	codeVerifier: string;
}

export interface RefreshTokensInput {
	clientId: string;
	clientSecret?: string;
	refreshToken: string;
}

export interface RevokeTokenInput {
	accessToken: string;
}

export interface ExchangeResult {
	accessToken: string;
	refreshToken?: string;
	tokenType: string;
	scopes: OAuthScope[];
	/** Unix epoch milliseconds; computed from `expires_in`. */
	expiresAt: number;
}

/** Common form-encoded POST helper. Throws an error with sanitized body on non-2xx. */
async function postForm<T>(
	url: string,
	params: Record<string, string>,
	fetchImpl: FetchLike,
): Promise<T> {
	const body = new URLSearchParams(params).toString();
	let res: Awaited<ReturnType<FetchLike>>;
	try {
		res = await fetchImpl(url, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json",
			},
			body,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Network error talking to ${url}: ${message}`);
	}
	const text = await res.text();
	if (!res.ok) {
		// Don't dump the request body — it contains client_secret /
		// refresh_token / authorization code, all of which are secrets.
		// Sanitize the response body at source too: an MITM, misconfigured
		// proxy, or buggy upstream that echoes the request headers back in
		// its error body would otherwise leak `Bearer <token>` into the
		// error chain. Defense in depth on top of outputError's
		// sanitization (DEV-4065).
		const safe = sanitizeForLog(text || "(empty body)");
		throw new Error(
			`OAuth endpoint ${url} responded ${res.status} ${res.statusText}: ${safe}`,
		);
	}
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(
			`OAuth endpoint ${url} returned non-JSON response: ${sanitizeForLog(text.slice(0, 200))}`,
		);
	}
}

function parseScopes(raw: string | undefined): OAuthScope[] {
	if (!raw) return [];
	// Linear docs show scopes are returned comma-separated; some OAuth
	// servers return space-separated. Accept either.
	return raw
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean) as OAuthScope[];
}

function tokenResponseToResult(
	response: LinearTokenResponse,
	now: number,
): ExchangeResult {
	const expiresInMs =
		typeof response.expires_in === "number" && response.expires_in > 0
			? response.expires_in * 1000
			: // Linear docs say tokens last 24h. If the field is missing, fall
				// back to 23h to leave a safety margin before forcing a refresh.
				23 * 60 * 60 * 1000;
	return {
		accessToken: response.access_token,
		refreshToken: response.refresh_token,
		tokenType: response.token_type ?? "Bearer",
		scopes: parseScopes(response.scope),
		expiresAt: now + expiresInMs,
	};
}

/**
 * Exchange an authorization code for tokens. PKCE-aware: send the verifier;
 * `client_secret` is optional (some Linear apps configured as native/public
 * don't have one).
 */
export async function exchangeCodeForTokens(
	input: ExchangeCodeInput,
	fetchImpl: FetchLike = defaultFetch,
	now: () => number = Date.now,
): Promise<ExchangeResult> {
	const params: Record<string, string> = {
		grant_type: "authorization_code",
		code: input.code,
		redirect_uri: input.redirectUri,
		client_id: input.clientId,
		code_verifier: input.codeVerifier,
	};
	if (input.clientSecret) params.client_secret = input.clientSecret;
	const res = await postForm<LinearTokenResponse>(
		LINEAR_TOKEN_URL,
		params,
		fetchImpl,
	);
	if (typeof res.access_token !== "string" || res.access_token === "") {
		throw new Error("OAuth response missing `access_token`.");
	}
	return tokenResponseToResult(res, now());
}

/**
 * Use a refresh token to get a new access token. Linear may rotate the
 * refresh token, so we plumb both fields through.
 */
export async function refreshTokens(
	input: RefreshTokensInput,
	fetchImpl: FetchLike = defaultFetch,
	now: () => number = Date.now,
): Promise<ExchangeResult> {
	const params: Record<string, string> = {
		grant_type: "refresh_token",
		refresh_token: input.refreshToken,
		client_id: input.clientId,
	};
	if (input.clientSecret) params.client_secret = input.clientSecret;
	const res = await postForm<LinearTokenResponse>(
		LINEAR_TOKEN_URL,
		params,
		fetchImpl,
	);
	if (typeof res.access_token !== "string" || res.access_token === "") {
		throw new Error("OAuth refresh response missing `access_token`.");
	}
	return tokenResponseToResult(res, now());
}

/**
 * Revoke an access token. Best-effort — we don't throw on transport
 * errors so callers can still clear local state.
 */
export async function revokeToken(
	input: RevokeTokenInput,
	fetchImpl: FetchLike = defaultFetch,
): Promise<{ ok: boolean; status: number; message?: string }> {
	try {
		const res = await fetchImpl(LINEAR_REVOKE_URL, {
			method: "POST",
			headers: {
				authorization: `Bearer ${input.accessToken}`,
				"content-type": "application/x-www-form-urlencoded",
			},
			body: "",
		});
		// Sanitize at source for symmetry with postForm's error branch — a
		// misconfigured proxy that echoes the request's Authorization header
		// in its 5xx body would otherwise surface the bearer token through
		// `message`. The two call sites in `commands/init/oauth.ts` already
		// re-sanitize at emission, but defense in depth (DEV-4065).
		return {
			ok: res.ok,
			status: res.status,
			message: res.ok ? undefined : sanitizeForLog(await res.text()),
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, status: 0, message: sanitizeForLog(message) };
	}
}
