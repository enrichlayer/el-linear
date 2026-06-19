/**
 * Duplicate-issue detection — DEV-4823.
 *
 * Turns the MANDATORY-but-skippable duplicate check from the
 * `linear-operations` skill into a deterministic create-time gate, mirroring
 * the one `projects create` already has (DEV-3604). Before the create POST,
 * `issues create` searches the title's salient keywords and refuses (listing
 * the candidates) when a high-similarity open/recently-closed issue already
 * exists.
 *
 * The skill prose is skippable; this isn't. On 2026-06-19 a single session
 * filed two duplicates of in-flight work (DEV-4816 duped DEV-4818, opposite
 * decided approaches) because it claim-checked the *new* issue's branch
 * instead of searching for a pre-existing issue on the same topic. The
 * claim-check (`scripts/issue-claimed.mjs`, DEV-4666) only catches collisions
 * on the new issue's own id/branch — not a topically-identical issue with a
 * different number. This gate closes that gap.
 *
 * Scoring reuses the Jaccard keyword-overlap heuristic from the
 * `agent-efficiency-auditor` (DEV-4155): tokenize both titles, drop
 * stopwords/numbers, and score by |intersection| / |union| of the token sets.
 */

import type { LinearIssue } from "../types/linear.js";

/**
 * Default similarity threshold above which a candidate is treated as a
 * duplicate. Tuned against real workspace data so the motivating
 * DEV-4816 ↔ DEV-4818 pair (Jaccard 0.40 with the tokenization below) and the
 * genuine sibling DEV-3604 (0.44) fire, while merely same-domain issues do
 * not: two unrelated "Migrate …" titles sharing only the verb sit at ~0.14,
 * and a different-problem tooling issue sharing only boilerplate tokens
 * (`el-linear`/`issues`/`create`) measured 0.31 — both below 0.35.
 * Overridable via `config.validation.duplicateThreshold`.
 */
export const DEFAULT_DUPLICATE_THRESHOLD = 0.35;

/**
 * Function words and issue-boilerplate tokens that carry no topical signal.
 * Dropping them keeps the Jaccard score driven by the distinctive nouns
 * (`scripts`, `mjs`, `typescript`) rather than by glue words every title
 * shares. Type-indicating verbs (`add`, `fix`, `migrate`, …) are deliberately
 * NOT stopworded: `migrate` is a genuine topical signal in the motivating
 * dupe pair, and two unrelated "Add X" issues already score low because their
 * *other* tokens differ — keeping the verb inflates the score by at most one
 * shared token, not enough to false-positive.
 */
const STOPWORDS = new Set([
	"a",
	"an",
	"and",
	"as",
	"at",
	"but",
	"by",
	"for",
	"from",
	"in",
	"into",
	"of",
	"off",
	"on",
	"or",
	"out",
	"over",
	"per",
	"the",
	"then",
	"to",
	"via",
	"vs",
	"with",
	"without",
]);

/** A scored duplicate candidate, ready to print in the block. */
export interface DuplicateCandidate {
	identifier: string;
	title: string;
	state: string;
	assignee: string;
	/** Jaccard similarity in [0, 1], rounded to 2 dp for display. */
	score: number;
}

/**
 * Tokenize a title into a set of salient lowercase keywords.
 *
 * Splits on any run of non-alphanumeric characters (so `scripts/*.mjs` →
 * `scripts`, `mjs`), lowercases, then drops stopwords, pure numbers
 * (`52 files` → `files`), and single-character tokens. Returns a Set so
 * downstream set algebra is direct.
 *
 * Scope: ASCII `[a-z0-9]` only — a title written entirely in a non-Latin
 * script (Cyrillic, CJK, …) tokenizes to the empty set, so the gate fails
 * open (no candidates, never a false positive) and the manual dup check
 * carries it. Acceptable given the workspace's title language.
 */
export function tokenizeTitle(title: string): Set<string> {
	const tokens = title
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
	return new Set(tokens);
}

/**
 * Jaccard similarity of two token sets: |intersection| / |union|.
 * Returns 0 when either set is empty (no signal to compare).
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) {
		return 0;
	}
	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) {
			intersection++;
		}
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

/**
 * Score candidate issues against a proposed title and return those at or above
 * `threshold`, sorted by descending similarity (highest first). Candidates
 * with an unparseable/empty title are skipped. `score` is rounded to 2 dp for
 * stable display and tests.
 */
export function scoreDuplicateCandidates(
	title: string,
	candidates: LinearIssue[],
	threshold: number = DEFAULT_DUPLICATE_THRESHOLD,
): DuplicateCandidate[] {
	const titleTokens = tokenizeTitle(title);
	if (titleTokens.size === 0) {
		return [];
	}

	const scored: DuplicateCandidate[] = [];
	for (const issue of candidates) {
		const score = jaccardSimilarity(titleTokens, tokenizeTitle(issue.title));
		if (score >= threshold) {
			scored.push({
				identifier: issue.identifier,
				title: issue.title,
				state: issue.state?.name ?? "—",
				assignee: issue.assignee?.name ?? "—",
				score: Math.round(score * 100) / 100,
			});
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return scored;
}

/**
 * Render the human/agent-facing block listing duplicate candidates, matching
 * the shape of the validation "Suggestions:" blocks (id · title · state ·
 * assignee). Used as the body of the thrown error when the gate fires.
 */
export function formatDuplicateBlock(candidates: DuplicateCandidate[]): string {
	const lines = candidates.map(
		(c) =>
			`    ${c.identifier} · ${c.title} · ${c.state} · ${c.assignee}  (similarity ${c.score})`,
	);
	return (
		`Possible duplicate issue${candidates.length > 1 ? "s" : ""} found ` +
		"(by title-keyword overlap):\n" +
		`${lines.join("\n")}\n\n` +
		"  If one of these is the same work, comment on it instead of creating a new issue.\n" +
		"  If this is genuinely distinct, re-run with --allow-duplicate to proceed " +
		"(and consider --related-to to link the related issue)."
	);
}
