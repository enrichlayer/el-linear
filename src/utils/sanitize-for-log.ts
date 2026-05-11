/**
 * Strip anything that looks like a Linear API/OAuth token from a string.
 *
 * Defense in depth: today the @linear/sdk error message embeds `{ query,
 * variables }` but not the Authorization header. A future SDK upgrade that
 * includes headers (which upstream graphql-request has done historically)
 * would otherwise silently write `Bearer lin_api_…` into stdout, shell
 * history, or CI logs. The regex also catches token shapes that may show
 * up in custom error wrappers — e.g. a network proxy that echoes the
 * Bearer header in its 502 body.
 *
 * Originally lived in `commands/init/token.ts` for the wizard's error
 * formatting. Hoisted to `utils/` so the central error path (`output.ts`'s
 * `outputError`) and the OAuth token-refresh path (`auth/token-resolver.ts`)
 * can use it too — those run on every CLI invocation, not just `init`.
 */

// Personal-API tokens (`lin_api_…`) and OAuth access/refresh tokens
// (`lin_oauth_…`).
const TOKEN_PREFIX_RE = /lin_(api|oauth)_[A-Za-z0-9_-]{16,}/g;

// High-entropy bearer payload fallback: catches generic Bearer-style
// strings adjacent to Authorization / Bearer keywords. Useful for
// future SDK error wrappers that might leak headers without the
// `lin_` prefix.
const BEARER_PAYLOAD_RE =
	/(\b(?:Authorization|Bearer)\b[:\s]*)([A-Za-z0-9_\-/+=]{40,})/gi;

export function sanitizeForLog(text: string): string {
	return text
		.replace(TOKEN_PREFIX_RE, (m) =>
			m.startsWith("lin_oauth_")
				? "lin_oauth_***REDACTED***"
				: "lin_api_***REDACTED***",
		)
		.replace(BEARER_PAYLOAD_RE, "$1***REDACTED***");
}
