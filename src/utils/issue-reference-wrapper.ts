// Workspace URL key resolution lives in `./workspace-url.ts` — call
// `getWorkspaceUrlKey(graphQLService)` to obtain it before invoking
// `wrapIssueReferencesAsLinks`. Linear URLs look like
// `https://linear.app/<urlKey>/issue/<identifier>/`.

const IDENTIFIER_REGEX = /\b([A-Z][A-Z0-9]*-\d+)\b/g;
const FENCED_CODE_BLOCK_REGEX =
	/(?:^|\n)([ \t]*)(?:```|~~~)[^\n]*\n[\s\S]*?\n\1?(?:```|~~~)(?=\n|$)/g;
// Inline backtick spans — `EMW-258`. Markdown allows multiple backticks for spans containing
// backticks; we keep it simple and match single-backtick spans.
const INLINE_CODE_REGEX = /`[^`\n]+?`/g;
// Existing markdown links: [text](url). We protect both the text and the url.
const MARKDOWN_LINK_REGEX = /\[([^\]]*)\]\(([^)]*)\)/g;
// Existing Slack mrkdwn links: <url|text>. We protect both halves so identifiers
// inside an already-wrapped Slack link aren't double-wrapped.
const SLACK_LINK_REGEX = /<https?:\/\/[^|>\s]+\|[^>]*>/g;
// Angle-bracket autolinks: <https://...>
const ANGLE_AUTOLINK_REGEX = /<[^>\s]+>/g;
// Bare URLs in prose. We protect these so identifiers inside paths
// (e.g. "https://github.com/foo/DEV-100") don't get split by wrapping.
const BARE_URL_REGEX = /https?:\/\/\S+/g;

/**
 * Output emitter target. `markdown` produces `[ID](url)`; `slack` produces
 * Slack mrkdwn `<url|ID>`. New targets (e.g. `html`) can be added to the
 * discriminated map without touching callers.
 */
export type WrapTarget = "markdown" | "slack";

interface ProtectedRange {
	end: number;
	start: number;
}

/**
 * Find ranges of `text` that should NOT have identifiers wrapped:
 * - Fenced code blocks (``` or ~~~)
 * - Inline backtick code spans
 * - Existing markdown links — both `[text]` and `(url)`
 * - Angle-bracket autolinks
 *
 * The returned ranges may overlap; callers only need to test "is this position
 * inside any protected range" so overlap is fine.
 */
function findProtectedRanges(text: string): ProtectedRange[] {
	const ranges: ProtectedRange[] = [];
	for (const re of [
		FENCED_CODE_BLOCK_REGEX,
		INLINE_CODE_REGEX,
		MARKDOWN_LINK_REGEX,
		// Slack links must be protected before generic angle-bracket autolinks,
		// otherwise the autolink regex would still match `<https://…|label>` because
		// it doesn't include the pipe boundary. matchAll resets per regex so order
		// in this list is irrelevant for correctness — both ranges still cover the span.
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

function isProtected(pos: number, ranges: ProtectedRange[]): boolean {
	for (const r of ranges) {
		if (pos >= r.start && pos < r.end) {
			return true;
		}
	}
	return false;
}

function buildIssueUrl(identifier: string, workspaceUrlKey: string): string {
	return `https://linear.app/${workspaceUrlKey}/issue/${identifier}/`;
}

/**
 * Per-target emitters. Each takes the resolved url and human identifier and
 * returns the wrapped link string. Add a new target by adding a key here.
 */
const EMITTERS: Record<WrapTarget, (id: string, url: string) => string> = {
	markdown: (id, url) => `[${id}](${url})`,
	// Slack mrkdwn link syntax: <url|label>. Reference:
	// https://api.slack.com/reference/surfaces/formatting#linking-urls
	slack: (id, url) => `<${url}|${id}>`,
};

/**
 * Rewrite `text`, wrapping each occurrence of a known-valid Linear issue identifier
 * as a link in the chosen `target` syntax. Skips any occurrence inside protected
 * ranges (code blocks, inline code, existing markdown links, Slack links,
 * angle-bracket autolinks, bare URLs).
 *
 * Only IDs in `validIdentifiers` are wrapped — IDs that don't resolve in the
 * workspace are left as plain text (handles false positives like ISO codes).
 *
 * If `text` already contains a wrapped `[ID](url)` or `<url|ID>` for a given ID,
 * that occurrence is left alone (it's inside a protected range), so this
 * function is idempotent for the matching target. Running `markdown` then
 * `slack` (or vice versa) will not re-wrap previously-wrapped IDs because the
 * existing link's content stays inside a protected range.
 *
 * The 3-arg signature is preserved as a positional `target` defaulting to
 * `"markdown"` for backward compatibility with existing callers
 * (`issues create/update`, `comments create/update`).
 */
export function wrapIssueReferencesAsLinks(
	text: string,
	validIdentifiers: Set<string>,
	workspaceUrlKey: string,
	target: WrapTarget = "markdown",
): string {
	if (!text || validIdentifiers.size === 0) {
		return text;
	}
	const ranges = findProtectedRanges(text);
	const emit = EMITTERS[target];

	// Walk through matches and build the result string in pieces.
	// We can't use String.replace with a callback because we need positional protection checks.
	let result = "";
	let cursor = 0;
	for (const m of text.matchAll(IDENTIFIER_REGEX)) {
		const id = m[1];
		const start = m.index ?? 0;
		const end = start + m[0].length;
		if (!validIdentifiers.has(id)) {
			continue;
		}
		if (isProtected(start, ranges)) {
			continue;
		}
		// Append everything up to this match unchanged
		result += text.slice(cursor, start);
		result += emit(id, buildIssueUrl(id, workspaceUrlKey));
		cursor = end;
	}
	result += text.slice(cursor);
	return result;
}
