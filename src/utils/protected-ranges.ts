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
// Match strategy follows CommonMark's "extended autolink" rule:
//
// 1. Greedy match up to whitespace or angle/quote terminators
//    (`<`, `>`, `"`). Parens and brackets stay IN the match — they
//    appear inside legitimate URLs (Wikipedia article paths, Next.js
//    route groups like `/docs/app/(group)/page`, CDN signing-key
//    query strings, etc.).
// 2. Post-process via `trimBareUrlTrailingPunct` to strip UNBALANCED
//    trailing brackets and stand-alone punctuation. So
//    `https://example.com/foo)DEV-100` correctly terminates at
//    `…foo` (the closing paren is unbalanced — no opener inside the
//    match), while `https://en.wikipedia.org/wiki/Foo_(bar)` keeps
//    its balanced parens intact.
//
// Pre-fix `https?:\/\/\S+` greedily consumed everything to the next
// whitespace and silently hid identifiers in position-dependent
// prose. A char-class exclusion of `)`, `]`, `}` over-corrected and
// broke Wikipedia / route-group URLs (cycle 2 finding on PR #75).
// The balanced-paren trim is the CommonMark-faithful middle ground.
const BARE_URL_REGEX = /https?:\/\/[^\s<>"]+/g;

/**
 * Find the first position in `s` where a close-bracket character
 * appears without a matching opener earlier in the string. Returns
 * `s.length` if all close-brackets are balanced. Used to truncate
 * a bare-URL match at the first unbalanced `)`, `]`, or `}` —
 * exactly the position CommonMark treats as the URL terminator.
 *
 * Exported for direct unit testing. Depth counters per bracket type
 * are independent — pathological interleavings like `[(a]b)` don't
 * trigger an unbalance, which errs toward keeping a URL whole rather
 * than over-truncating (no real-world URL nests bracket types this
 * way).
 */
export function firstUnbalancedClose(s: string): number {
	let parenDepth = 0;
	let brackDepth = 0;
	let braceDepth = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "(") parenDepth++;
		else if (ch === ")") {
			if (parenDepth === 0) return i;
			parenDepth--;
		} else if (ch === "[") brackDepth++;
		else if (ch === "]") {
			if (brackDepth === 0) return i;
			brackDepth--;
		} else if (ch === "{") braceDepth++;
		else if (ch === "}") {
			if (braceDepth === 0) return i;
			braceDepth--;
		}
	}
	return s.length;
}

function trimBareUrlTrailingPunct(url: string): string {
	// First: truncate at the first unbalanced bracket. So
	// `https://example.com/foo)DEV-100` (no `(` opener inside) terminates
	// at the `)` regardless of what follows it; `Foo_(bar)/DEV` keeps
	// the balanced `(bar)` intact.
	let trimmed = url.slice(0, firstUnbalancedClose(url));
	// Then: strip standard trailing sentence-terminators (`.`, `,`, `;`,
	// `:`, `!`, `?`). These never appear in legitimate URL paths at the
	// very end, but they're commonly adjacent to URLs in prose. The
	// char class deliberately excludes `)`, `]`, `}` — those are
	// already handled by firstUnbalancedClose above, where the
	// balanced/unbalanced check lives.
	while (trimmed.length > 0 && /[.,;:!?]$/.test(trimmed)) {
		trimmed = trimmed.slice(0, -1);
	}
	return trimmed;
}

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
	]) {
		for (const m of text.matchAll(re)) {
			const start = m.index ?? 0;
			ranges.push({ start, end: start + m[0].length });
		}
	}
	// Bare URLs need the trailing-punctuation trim that's hard to express
	// in pure regex (depends on bracket-balance inside the match).
	for (const m of text.matchAll(BARE_URL_REGEX)) {
		const start = m.index ?? 0;
		const trimmed = trimBareUrlTrailingPunct(m[0]);
		ranges.push({ start, end: start + trimmed.length });
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
