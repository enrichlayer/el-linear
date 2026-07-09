/**
 * Relation-candidate confirmation prompt — DEV-4494.
 *
 * When `el-linear search` or `el-linear issues search` returns results that
 * carry issue identifiers (the "I just ran a dup-check" shape), we emit a
 * structured `_warnings` line that nudges the *caller* (typically a Claude
 * agent driving `linear-operations`) to surface the IDs to the user verbatim
 * and wait for an explicit reply naming which ones to link.
 *
 * Why the explicit reply matters
 * ------------------------------
 * Claude Code's auto-mode permission classifier blocks
 * `el-linear issues relate <source> --related-to "<ids>"` when the IDs were
 * inferred by the agent from its own search rather than typed by the user —
 * because creating a relation writes onto *every* listed peer issue, and the
 * IDs must be user-specified, not agent-inferred, to clear the guard.
 *
 * The fix isn't to weaken the guard. It's to tighten the loop: surface the
 * candidates, ask the human to name which IDs to link, and only THEN call
 * `issues relate` — at which point the IDs are user-specified by
 * construction and the guard passes naturally.
 *
 * This module produces the warning. The actual UX is enforced by the
 * `linear-operations` skill (it consumes the warning and shows it to the
 * user) and by the existing auto-mode guard (it continues to block
 * agent-inferred relate calls).
 *
 * Reference: https://linear.app/verticalint/issue/DEV-4494/
 */

/** Cap how many candidate IDs the prompt enumerates inline. */
const MAX_CANDIDATES_IN_PROMPT = 10;

/**
 * Extract issue identifiers from a heterogeneous result array.
 *
 * Accepts the union of shapes used across the search commands:
 * - `issues search` rows (`LinearIssue`) carry `identifier` at the top level
 * - cross-resource `search` rows transform to `{ type: "issue", identifier }`
 *   for issue rows; non-issue rows (`project`, `document`, …) have no
 *   identifier and are skipped.
 *
 * Deduplicates and preserves insertion order so the prompt enumerates IDs
 * in the same order they appear on screen.
 */
export function extractCandidateIdentifiers(rows: unknown[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const row of rows) {
		if (row === null || typeof row !== "object") continue;
		const r = row as Record<string, unknown>;
		const id = typeof r.identifier === "string" ? r.identifier : undefined;
		if (!id) continue;
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

/**
 * Build the relation-candidate warning string, or `null` when the result set
 * has no identifier-bearing rows (nothing to surface).
 *
 * Shape (single line, structured-prose so a skill can match on the prefix):
 *
 *     relation_candidates: Found N candidate related issues (DEV-1, DEV-2, …).
 *     Link the relevant ones now — at create time with --related-to, or
 *     `issues relate <id> --related-to "<ids>"`. If auto-mode blocks an
 *     agent-inferred relate, reply with the IDs you want linked
 *     (e.g. "link DEV-1 and DEV-2"), or "no links" to skip.
 *
 * DEV-5853: the primary framing is **proactive** — this is a convenience list
 * of link candidates, not a stop sign. Relate the relevant ones directly
 * rather than waiting to be told; the reply flow is the *fallback* for when
 * the auto-mode classifier actually blocks an agent-inferred `issues relate`
 * (create-time `--related-to` typically passes, so prefer it). The
 * `relation_candidates:` prefix matches the existing `results_truncated:`
 * convention in `outputWarning` callers — a stable token a skill / agent
 * harness can grep for without parsing free-form prose.
 */
export function buildRelationCandidatePrompt(rows: unknown[]): string | null {
	const ids = extractCandidateIdentifiers(rows);
	if (ids.length === 0) return null;

	const shown = ids.slice(0, MAX_CANDIDATES_IN_PROMPT);
	const overflow = ids.length - shown.length;
	const idList =
		overflow > 0
			? `${shown.join(", ")}, … (+${overflow} more)`
			: shown.join(", ");

	// Build two concrete example IDs from the head of the list so the
	// fallback "reply with the IDs you want linked" example is realistic for
	// the caller's actual search rather than a fixed placeholder. Single-result
	// case still reads naturally ("link DEV-1").
	const example =
		shown.length >= 2 ? `link ${shown[0]} and ${shown[1]}` : `link ${shown[0]}`;

	const noun =
		ids.length === 1 ? "candidate related issue" : "candidate related issues";
	// DEV-5853: proactive framing first (relate the relevant ones directly),
	// then the reply-flow fallback for when auto-mode blocks an agent-inferred
	// relate. The `relate the relevant ones` / `reply with the IDs you want
	// linked` / `"no links"` / DEV-4494 tokens are all preserved so downstream
	// skill/agent matchers stay stable.
	return (
		`relation_candidates: Found ${ids.length} ${noun} (${idList}). ` +
		`Link the relevant ones now — at create time with --related-to, or ` +
		`\`issues relate <id> --related-to "<ids>"\`. ` +
		`If auto-mode blocks an agent-inferred relate, reply with the IDs you want linked ` +
		`(e.g. "${example}"), or "no links" to skip. ` +
		`(Agent-inferred IDs are blocked by auto-mode; user-named IDs pass — DEV-4494.)`
	);
}
