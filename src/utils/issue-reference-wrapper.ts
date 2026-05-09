// Workspace URL key resolution lives in `./workspace-url.ts` — call
// `getWorkspaceUrlKey(graphQLService)` to obtain it before invoking
// `wrapIssueReferencesAsLinks`. Linear URLs look like
// `https://linear.app/<urlKey>/issue/<identifier>/`.

import {
	findProtectedRanges,
	IDENTIFIER_REGEX,
	isProtected,
} from "./protected-ranges.js";

/**
 * Output emitter target. `markdown` produces `[ID](url)`; `slack` produces
 * Slack mrkdwn `<url|ID>`. New targets (e.g. `html`) can be added to the
 * discriminated map without touching callers.
 */
export type WrapTarget = "markdown" | "slack";

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
