/**
 * Shared "protected ranges" scanner — used by both
 * `issue-reference-wrapper` and `issue-reference-extractor` so they
 * agree on which spans of input text should be excluded from
 * identifier processing.
 *
 * Why this exists: a transform/consumer pair that disagree about what
 * counts as "protected" silently produces phantom relations or
 * double-wrapped links. Concretely, the wrapper protects fenced code,
 * inline code, markdown links, Slack links, angle-bracket autolinks,
 * AND bare URLs; the extractor used to only strip fenced code, so
 * `[click](https://x/DEV-100)` would wrap correctly but the auto-link
 * extractor would still detect DEV-100 inside the URL and create a
 * phantom relation. Same for `https://github.com/org/repo/DEV-100.md`.
 *
 * Centralising the scanner makes both consumers agree by construction.
 */

/** Linear identifier shape: ABC-123, EMW-1, DEV-3592. */
export const IDENTIFIER_REGEX = /\b([A-Z][A-Z0-9]*-\d+)\b/g;

const FENCED_CODE_BLOCK_REGEX =
	/(?:^|\n)([ \t]*)(?:```|~~~)[^\n]*\n[\s\S]*?\n\1?(?:```|~~~)(?=\n|$)/g;
// Inline backtick spans — `EMW-258`. Markdown allows multiple backticks
// for spans containing backticks; we keep it simple and match
// single-backtick spans, which covers the common case.
const INLINE_CODE_REGEX = /`[^`\n]+?`/g;
// Existing markdown links: [text](url). Both halves protected so
// identifiers inside the URL or the text aren't reprocessed.
const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\(([^)]*)\)/g;
// Existing Slack mrkdwn links: <url|text>. Both halves protected for
// the same reason as markdown links.
const SLACK_LINK_REGEX = /<https?:\/\/[^|>\s]+\|[^>]*>/g;
// Angle-bracket autolinks: <https://...>
const ANGLE_AUTOLINK_REGEX = /<[^>\s]+>/g;
// Bare URLs in prose. We protect these so identifiers inside path
// components (e.g. "https://github.com/foo/DEV-100") don't get
// processed.
//
// The character class excludes ASCII closing-bracket / quote chars
// that CommonMark treats as bare-URL terminators: `)`, `]`, `}`,
// `>`, `"`. This terminates the URL at the bracket regardless of
// whether whitespace follows — so both `foo) DEV-100` (with space)
// and `foo)DEV-100bar` (no space) expose the trailing identifier to
// auto-link extraction.
//
// Pre-fix the regex was `https?:\/\/\S+`, which greedily consumed up
// to the next whitespace and silently hid identifiers in position-
// dependent prose. A prior fix used a trailing-punctuation lookahead
// that only worked when whitespace followed the terminator; this
// character-class form is symmetric (no whitespace required).
const BARE_URL_REGEX = /https?:\/\/[^\s<>"()\]}]+/g;

export interface ProtectedRange {
	end: number;
	start: number;
}

/**
 * Find ranges of `text` that should NOT have identifiers processed.
 * Covered: fenced code, inline backticks, existing markdown links,
 * Slack links, angle-bracket autolinks, bare URLs.
 *
 * The returned ranges may overlap; callers only test "is this position
 * inside any protected range" so overlap is harmless.
 */
export function findProtectedRanges(text: string): ProtectedRange[] {
	const ranges: ProtectedRange[] = [];
	for (const re of [
		FENCED_CODE_BLOCK_REGEX,
		INLINE_CODE_REGEX,
		MARKDOWN_LINK_REGEX,
		// Slack links must be considered before generic angle-bracket
		// autolinks — the autolink regex doesn't know about the `|label`
		// boundary, but matchAll resets per regex so order is just for
		// clarity here.
		SLACK_LINK_REGEX,
		ANGLE_AUTOLINK_REGEX,
		BARE_URL_REGEX,
	]) {
		for (const m of text.matchAll(re)) {
			const start = m.index ?? 0;
			ranges.push({ start, end: start + m[0].length });
		}
	}
	return ranges;
}

export function isProtected(pos: number, ranges: ProtectedRange[]): boolean {
	for (const r of ranges) {
		if (pos >= r.start && pos < r.end) {
			return true;
		}
	}
	return false;
}
