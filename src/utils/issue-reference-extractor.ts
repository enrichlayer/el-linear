import {
	findProtectedRanges,
	IDENTIFIER_REGEX,
	isProtected,
} from "./protected-ranges.js";

export type IssueRelationType = "related" | "blocks" | "duplicate";

export interface IssueReference {
	identifier: string;
	/** When true, swap source/target on the create mutation (e.g. "blocked by X" means X→source). */
	reverse: boolean;
	type: IssueRelationType;
}

/**
 * Window of text immediately before an identifier where we look for relation keywords.
 * 30 chars covers phrases like "is a prerequisite of" comfortably.
 */
const KEYWORD_WINDOW = 30;

/**
 * Phrase patterns matched against the text immediately preceding an identifier.
 * Each pattern is anchored at the *end* of the window (so the phrase must directly precede
 * the identifier, modulo whitespace). Order matters — most-specific phrases first.
 *
 * `reverse: true` flips the source/target on the relation create:
 *   - "blocked by DEV-100" → DEV-100 blocks the source issue
 *   - "duplicated by EMW-258" → EMW-258 duplicates the source issue
 */
const PHRASE_PATTERNS: Array<{
	regex: RegExp;
	type: IssueRelationType;
	reverse: boolean;
}> = [
	{
		regex: /\bduplicated by\s*$/i,
		type: "duplicate",
		reverse: true,
	},
	{
		regex: /\b(?:duplicate of|dup(?:e)? of|duplicates)\s*$/i,
		type: "duplicate",
		reverse: false,
	},
	{
		regex: /\b(?:blocked by|blocked on|depends on|waiting on|requires)\s*$/i,
		type: "blocks",
		reverse: true,
	},
	{
		regex: /\b(?:blocks|unblocks|prerequisite (?:for|of)|required by)\s*$/i,
		type: "blocks",
		reverse: false,
	},
];

function inferRelation(textBefore: string): {
	type: IssueRelationType;
	reverse: boolean;
} {
	const window = textBefore.slice(-KEYWORD_WINDOW);
	for (const { regex, type, reverse } of PHRASE_PATTERNS) {
		if (regex.test(window)) {
			return { type, reverse };
		}
	}
	return { type: "related", reverse: false };
}

/**
 * Specificity ranking — used when the same identifier appears more than once
 * in the text with different qualifiers. The strongest non-default inference
 * wins. Exported because `auto-link-references` does the same merge over its
 * own description+comments fan-in (DEV-4070 deduplication).
 */
export function specificity(ref: IssueReference): number {
	if (ref.type === "duplicate") {
		return 3;
	}
	if (ref.type === "blocks") {
		return 2;
	}
	return 1; // related
}

/**
 * Extract issue identifiers from text along with the inferred relation type.
 *
 * Identifiers inside protected ranges are skipped — fenced code blocks,
 * inline backticks, existing markdown links, Slack links, angle-bracket
 * autolinks, and bare URLs. This is the same protection set used by
 * `wrapIssueReferencesAsLinks`, so the two stay symmetric: a wrapped
 * `[label](https://x/DEV-100)` won't have DEV-100 re-extracted as a
 * phantom reference, and a bare URL like
 * `https://github.com/org/repo/DEV-100.md` won't either. (See
 * `protected-ranges.ts` for the shared scanner.)
 *
 * The relation type is inferred from prose keywords immediately before the identifier
 * (e.g. "blocked by DEV-100" → blocks/reverse=true). Default is `related`.
 *
 * Each identifier appears at most once in the result. If the same identifier appears
 * with different qualifiers, the strongest non-default inference wins.
 */
export function extractIssueReferences(
	text: string,
	selfIdentifier?: string,
): IssueReference[] {
	if (!text) {
		return [];
	}
	const ranges = findProtectedRanges(text);
	const byIdentifier = new Map<string, IssueReference>();

	for (const match of text.matchAll(IDENTIFIER_REGEX)) {
		const id = match[1];
		if (selfIdentifier && id === selfIdentifier) {
			continue;
		}
		const matchIndex = match.index ?? 0;
		if (isProtected(matchIndex, ranges)) {
			continue;
		}
		const textBefore = text.slice(0, matchIndex);
		const { type, reverse } = inferRelation(textBefore);
		const candidate: IssueReference = { identifier: id, type, reverse };

		const existing = byIdentifier.get(id);
		if (!existing || specificity(candidate) > specificity(existing)) {
			byIdentifier.set(id, candidate);
		}
	}

	return [...byIdentifier.values()];
}
