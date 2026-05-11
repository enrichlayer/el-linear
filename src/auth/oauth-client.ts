/**
 * OAuth 2.0 PKCE primitives for Linear.
 *
 * Linear's OAuth flow follows the standard authorization-code-with-PKCE shape:
 *
 *   1. Generate a random `code_verifier` and its SHA-256 `code_challenge`.
 *   2. Send the user to /oauth/authorize with `code_challenge` + `state`.
 *   3. Linear redirects back to our `redirect_uri` with `?code=…&state=…`.
 *   4. We exchange `code` + `code_verifier` for an access token.
 *
 * Notes specific to Linear (per https://linear.app/developers/oauth-2-0-authentication):
 *   - Scopes are joined with commas (`scope=read,write,issues:create`),
 *     not spaces. Defensive: we encode the comma so URL parsers don't treat
 *     it as a multi-value separator.
 *   - `client_secret` is required by Linear's token endpoint even with PKCE
 *     for confidential apps. Public/native apps configured without a secret
 *     can omit it; we let the caller decide.
 */
import { createHash, randomBytes } from "node:crypto";

/** Default scope set picked when the user doesn't customise. */
export const DEFAULT_SCOPES: readonly OAuthScope[] = [
	"read",
	"write",
	"issues:create",
	"comments:create",
];

/** All scopes Linear advertises. Keep in sync with their docs. */
export const ALL_SCOPES = [
	"read",
	"write",
	"issues:create",
	"comments:create",
	"timeSchedule:write",
	"admin",
	"app:assignable",
	"app:mentionable",
] as const;

export type OAuthScope = (typeof ALL_SCOPES)[number];

export const SCOPE_DESCRIPTIONS: Record<OAuthScope, string> = {
	read: "Read access to the user's account.",
	write:
		"Write access. Without admin, also requires issues:create / comments:create for those mutations.",
	"issues:create": "Allow creating new issues and their attachments.",
	"comments:create": "Allow creating new issue comments.",
	"timeSchedule:write": "Manage on-call schedules.",
	admin: "Full administrative permissions.",
	"app:assignable": "Mark this app as assignable to issues (Agents API).",
	"app:mentionable": "Mark this app as mentionable from comments (Agents API).",
};

export const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
export const LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";

interface PkcePair {
	verifier: string;
	challenge: string;
	method: "S256";
}

/**
 * Encode bytes as base64url per RFC 4648 §5: replace `+` and `/`, strip `=`.
 * `Buffer.toString("base64url")` is available in Node 22+ (we require 22+).
 */
function toBase64Url(buf: Buffer): string {
	return buf.toString("base64url");
}

/**
 * Generate a PKCE verifier + S256 challenge.
 *
 * Per RFC 7636 §4.1, verifier length is between 43 and 128 chars after
 * base64url encoding. We pick 32 raw bytes which yields a 43-char verifier —
 * the floor, but cryptographically plenty (256 bits of entropy).
 */
export function generatePkce(): PkcePair {
	const verifier = toBase64Url(randomBytes(32));
	const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge, method: "S256" };
}

/** Cryptographically random `state` parameter. 16 bytes → 22-char b64url. */
export function generateState(): string {
	return toBase64Url(randomBytes(16));
}

interface AuthorizeUrlInput {
	clientId: string;
	redirectUri: string;
	scopes: readonly string[];
	state: string;
	codeChallenge: string;
	/** "consent" forces the consent screen even for previously-authorized users. */
	prompt?: "consent";
}

/**
 * Build the URL to send the user to. Linear's authorize endpoint accepts
 * scope as a comma-separated list.
 */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
	const url = new URL(LINEAR_AUTHORIZE_URL);
	url.searchParams.set("client_id", input.clientId);
	url.searchParams.set("redirect_uri", input.redirectUri);
	url.searchParams.set("response_type", "code");
	// Linear's docs are explicit: scopes are joined with `,`. URLSearchParams
	// will URL-encode the comma to %2C, which Linear accepts.
	url.searchParams.set("scope", input.scopes.join(","));
	url.searchParams.set("state", input.state);
	url.searchParams.set("code_challenge", input.codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	if (input.prompt) {
		url.searchParams.set("prompt", input.prompt);
	}
	return url.toString();
}

export interface CallbackParams {
	code: string;
	state: string;
}

/**
 * Parse a callback URL like
 *   http://localhost:8765/oauth/callback?code=…&state=…
 *
 * Throws on missing parameters or on `?error=…` responses (Linear sends
 * `error=access_denied` if the user cancels).
 */
export function parseCallbackUrl(rawUrl: string): CallbackParams {
	const url = new URL(rawUrl, "http://localhost");
	const error = url.searchParams.get("error");
	if (error) {
		const description =
			url.searchParams.get("error_description") ?? "no description provided";
		throw new Error(`OAuth error: ${error} (${description})`);
	}
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (!code) throw new Error("OAuth callback missing `code` parameter");
	if (!state) throw new Error("OAuth callback missing `state` parameter");
	return { code, state };
}

/**
 * Validate scope strings against Linear's known set. Returns the validated
 * tuple; throws on any unknown scope (typo guard).
 */
export function validateScopes(scopes: readonly string[]): OAuthScope[] {
	const known = new Set<string>(ALL_SCOPES);
	const out: OAuthScope[] = [];
	for (const s of scopes) {
		const trimmed = s.trim();
		if (!known.has(trimmed)) {
			throw new Error(
				`Unknown OAuth scope: "${trimmed}". Allowed: ${ALL_SCOPES.join(", ")}.`,
			);
		}
		out.push(trimmed as OAuthScope);
	}
	if (out.length === 0) {
		throw new Error("At least one OAuth scope is required.");
	}
	return out;
}
