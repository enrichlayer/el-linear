import { isUuid } from "./uuid.js";

/**
 * Parse a Linear project URL or bare slug-id into the `slugId` form that
 * Linear's GraphQL `ProjectFilter.slugId` accepts.
 *
 * Linear project URLs look like:
 *   https://linear.app/<workspace>/project/<slug>-<12-hex>/<view>
 *
 * The slug-id is the `<slug>-<12-hex>` segment (kebab-case name followed
 * by a 12-character hex suffix). Linear uses this exact string as the
 * unique `slugId` field on the Project type.
 *
 * Accepts:
 *   - Full URL form: extracts the slug-id from the path
 *   - Bare slug-id: `tools-and-standardization-40815d9beb16`
 *   - Trailing path / query string is tolerated (`/overview`, `?foo=bar`)
 *
 * Returns `null` when the input is neither — caller can then fall through
 * to name-based or UUID-based resolution. Canonical UUIDs are rejected
 * here so that `isUuid()` callers stay the authoritative UUID path.
 */
export function parseProjectSlugId(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed || isUuid(trimmed)) {
		return null;
	}

	const urlMatch = trimmed.match(
		/\blinear\.app\/[^/\s]+\/project\/([^/?#\s]+)/i,
	);
	if (urlMatch) {
		const candidate = urlMatch[1];
		return looksLikeSlugId(candidate) ? candidate : null;
	}

	if (looksLikeSlugId(trimmed)) {
		return trimmed;
	}

	return null;
}

/**
 * A Linear project slug-id is a kebab-case name segment followed by a
 * 12-character hex suffix. The minimum form is just the 12 hex chars
 * (when the project name slugifies to empty), but in practice there's
 * always at least one name segment.
 */
function looksLikeSlugId(value: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{12}$/i.test(value);
}
