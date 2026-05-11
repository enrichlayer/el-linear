import { describe, expect, it } from "vitest";
import {
	extractIssueReferences,
	type IssueReference,
} from "./issue-reference-extractor.js";

const related = (id: string): IssueReference => ({
	identifier: id,
	type: "related",
	reverse: false,
});
const blocks = (id: string, reverse = false): IssueReference => ({
	identifier: id,
	type: "blocks",
	reverse,
});
const duplicate = (id: string, reverse = false): IssueReference => ({
	identifier: id,
	type: "duplicate",
	reverse,
});

describe("extractIssueReferences", () => {
	it("extracts a single identifier from prose as related by default", () => {
		expect(extractIssueReferences("based on DEV-3592, we should...")).toEqual([
			related("DEV-3592"),
		]);
	});

	it("extracts multiple distinct identifiers", () => {
		expect(
			extractIssueReferences("see DEV-100 and EMW-258, also INF-9"),
		).toEqual([related("DEV-100"), related("EMW-258"), related("INF-9")]);
	});

	it("deduplicates repeated identifiers", () => {
		expect(
			extractIssueReferences("DEV-100 again DEV-100 once more DEV-100"),
		).toEqual([related("DEV-100")]);
	});

	it("returns empty array for text without identifiers", () => {
		expect(extractIssueReferences("nothing to see here")).toEqual([]);
	});

	it("returns empty array for empty string", () => {
		expect(extractIssueReferences("")).toEqual([]);
	});

	it("excludes the self identifier", () => {
		expect(
			extractIssueReferences("see EMW-258 and DEV-3592", "EMW-258"),
		).toEqual([related("DEV-3592")]);
	});

	it("strips fenced code blocks (triple backticks)", () => {
		const text = [
			"real reference: DEV-100",
			"```",
			"log: BUILD-12345 not a real reference",
			"```",
			"another: DEV-200",
		].join("\n");
		expect(extractIssueReferences(text)).toEqual([
			related("DEV-100"),
			related("DEV-200"),
		]);
	});

	it("strips fenced code blocks (tildes)", () => {
		const text = [
			"real: DEV-100",
			"~~~",
			"ENV-999 inside tilde fence",
			"~~~",
			"real: DEV-200",
		].join("\n");
		expect(extractIssueReferences(text)).toEqual([
			related("DEV-100"),
			related("DEV-200"),
		]);
	});

	it("does NOT match identifiers inside inline backticks (protected range)", () => {
		// Inline code is protected — extractor matches the wrapper's
		// protection set so the wrap-then-extract composition stays
		// symmetric. Pre-fix behaviour was to extract; that produced
		// phantom relations from pasted log lines.
		expect(extractIssueReferences("see `EMW-258` for context")).toEqual([]);
	});

	it("does not match lowercase team keys", () => {
		expect(extractIssueReferences("dev-100 isn't a Linear identifier")).toEqual(
			[],
		);
	});

	it("does NOT match identifiers embedded in bare URLs (protected range)", () => {
		// Bare URLs are protected — `https://github.com/foo/DEV-100.md`
		// no longer creates a phantom DEV-100 relation just because
		// the path component happens to look like a Linear identifier.
		expect(
			extractIssueReferences(
				"https://linear.app/foo/issue/DEV-3592/title-slug",
			),
		).toEqual([]);
	});

	it("DOES match an identifier that follows trailing-punctuation URL terminator", () => {
		// CommonMark's bare-URL rule: strip UNBALANCED trailing brackets
		// and standard sentence terminators. Pre-fix `\S+` greedy-consumed
		// everything; a cycle-1 over-correction excluded brackets from the
		// URL char class outright, which broke balanced-paren URLs
		// (Wikipedia, Next.js route groups). The balanced-paren trim is
		// the CommonMark-faithful middle ground.
		expect(
			extractIssueReferences("(see https://example.com/foo) DEV-100"),
		).toEqual([related("DEV-100")]);
		// No-space case from the original adversarial repro.
		expect(
			extractIssueReferences("(see https://example.com/foo)DEV-100 bar"),
		).toEqual([related("DEV-100")]);
		// Square brackets too.
		expect(extractIssueReferences("[https://example.com/foo]DEV-200")).toEqual([
			related("DEV-200"),
		]);
	});

	it("preserves balanced parens INSIDE a bare URL (Wikipedia / Next.js route groups)", () => {
		// `https://en.wikipedia.org/wiki/Foo_(bar)/DEV-100` should not be
		// split at the parens. The cycle-1 char-class fix excluded `(`
		// and `)` from URLs, which clipped the URL at `Foo_`, exposing
		// `bar)/DEV-100` to identifier extraction (cycle-2 finding).
		expect(
			extractIssueReferences(
				"see https://en.wikipedia.org/wiki/Foo_(bar)/DEV-100 for context",
			),
		).toEqual([]);
		// Next.js route groups: `/(group)/page`
		expect(
			extractIssueReferences(
				"docs at https://nextjs.org/docs/app/(group)/DEV-200/page",
			),
		).toEqual([]);
		// Nested balanced parens.
		expect(
			extractIssueReferences("https://example.com/path/(a(b)c)/DEV-300/x"),
		).toEqual([]);
	});

	it("strips unbalanced trailing brackets only, not balanced ones", () => {
		// Closing paren with no opener inside the URL → strip.
		expect(extractIssueReferences("(https://example.com/foo) DEV-100")).toEqual(
			[related("DEV-100")],
		);
		// Opening paren inside the URL, then trailing close → keep both.
		expect(
			extractIssueReferences("see https://example.com/foo(bar) and DEV-200"),
		).toEqual([related("DEV-200")]);
	});

	it("does NOT match identifiers inside markdown links (protected range)", () => {
		// `[label](https://x/DEV-100)` — neither the label nor the URL
		// path counts. Mirrors the wrapper's protection so the two
		// stay symmetric and the wrap→extract composition is safe.
		expect(
			extractIssueReferences("see [click here](https://x/DEV-100) instead"),
		).toEqual([]);
	});

	it("does NOT match identifiers inside Slack mrkdwn links", () => {
		expect(
			extractIssueReferences("see <https://x/DEV-100|click here> instead"),
		).toEqual([]);
	});

	it("does NOT match identifiers inside angle-bracket autolinks", () => {
		expect(
			extractIssueReferences("see <https://x/DEV-100> for context"),
		).toEqual([]);
	});

	it("matches alphanumeric team keys", () => {
		expect(extractIssueReferences("legacy team: A1B-42")).toEqual([
			related("A1B-42"),
		]);
	});

	it("does not match numeric-only suffixes glued to other words", () => {
		expect(extractIssueReferences("FOO-bar-123 is not a match")).toEqual([]);
	});

	it("ignores trailing punctuation", () => {
		expect(
			extractIssueReferences("see DEV-100, DEV-200; also DEV-300."),
		).toEqual([related("DEV-100"), related("DEV-200"), related("DEV-300")]);
	});

	// ---- prose-based relation inference ----

	it("infers blockedBy from 'blocked by'", () => {
		expect(extractIssueReferences("blocked by DEV-100")).toEqual([
			blocks("DEV-100", true),
		]);
	});

	it("infers blockedBy from 'depends on'", () => {
		expect(extractIssueReferences("This depends on DEV-100")).toEqual([
			blocks("DEV-100", true),
		]);
	});

	it("infers blockedBy from 'waiting on'", () => {
		expect(extractIssueReferences("Currently waiting on EMW-200")).toEqual([
			blocks("EMW-200", true),
		]);
	});

	it("infers blocks from 'blocks'", () => {
		expect(extractIssueReferences("This blocks DEV-100")).toEqual([
			blocks("DEV-100", false),
		]);
	});

	it("infers blocks from 'prerequisite for'", () => {
		expect(
			extractIssueReferences("This is a prerequisite for DEV-100"),
		).toEqual([blocks("DEV-100", false)]);
	});

	it("infers blocks from 'prerequisite of'", () => {
		expect(extractIssueReferences("Listed as prerequisite of DEV-100")).toEqual(
			[blocks("DEV-100", false)],
		);
	});

	it("infers duplicate from 'duplicates'", () => {
		expect(extractIssueReferences("This duplicates DEV-50")).toEqual([
			duplicate("DEV-50", false),
		]);
	});

	it("infers duplicate from 'duplicate of'", () => {
		expect(extractIssueReferences("This is a duplicate of DEV-50")).toEqual([
			duplicate("DEV-50", false),
		]);
	});

	it("infers duplicate from 'dup of'", () => {
		expect(extractIssueReferences("dup of DEV-50")).toEqual([
			duplicate("DEV-50", false),
		]);
	});

	it("infers reversed duplicate from 'duplicated by'", () => {
		expect(extractIssueReferences("This was duplicated by EMW-100")).toEqual([
			duplicate("EMW-100", true),
		]);
	});

	it("keyword detection is case-insensitive", () => {
		expect(extractIssueReferences("Blocked By DEV-100")).toEqual([
			blocks("DEV-100", true),
		]);
		expect(extractIssueReferences("DUPLICATES DEV-50")).toEqual([
			duplicate("DEV-50", false),
		]);
	});

	it("upgrades from related to a stronger inference when the same id repeats", () => {
		// first occurrence is bare (related), second is "blocked by" — stronger wins
		expect(
			extractIssueReferences("see DEV-100; later, blocked by DEV-100"),
		).toEqual([blocks("DEV-100", true)]);
	});

	it("does not downgrade from a stronger inference back to related", () => {
		// first occurrence "blocked by", second is bare — first wins
		expect(
			extractIssueReferences("blocked by DEV-100; see also DEV-100 elsewhere"),
		).toEqual([blocks("DEV-100", true)]);
	});

	it("handles mixed types in one description", () => {
		const text =
			"based on DEV-3592, this duplicates DEV-50, and is blocked by DEV-100, also see EMW-9";
		expect(extractIssueReferences(text)).toEqual([
			related("DEV-3592"),
			duplicate("DEV-50", false),
			blocks("DEV-100", true),
			related("EMW-9"),
		]);
	});

	it("does not misattribute keyword across line breaks beyond the window", () => {
		// The keyword and the identifier are far apart — should be related, not blocks
		const text =
			"blocked by something not described here.\n\nLater, in another paragraph, we mention DEV-100 in passing.";
		expect(extractIssueReferences(text)).toEqual([related("DEV-100")]);
	});

	// Pre-fix behaviour (kept here as historical context — fixed in
	// ALL-933): the wrapper inserted `[` between the keyword and the
	// identifier, breaking the trailing-whitespace anchor in the
	// keyword regex; inference silently degraded from `blocks` to
	// `related`. Post-fix: identifiers inside markdown links sit in a
	// protected range and are skipped entirely, so the wrap→extract
	// composition produces no phantom relations.
	it("skips identifiers inside markdown links entirely (no phantom relations)", () => {
		expect(
			extractIssueReferences(
				"blocked by [DEV-100](https://linear.app/x/issue/DEV-100/)",
			),
		).toEqual([]);
		expect(
			extractIssueReferences(
				"this duplicates [DEV-50](https://linear.app/x/issue/DEV-50/)",
			),
		).toEqual([]);
	});
});

describe("composition: wrap → extract pipeline (DEV-3606 regression guard)", () => {
	// Locks in the symmetry between wrapper and extractor protection
	// sets (ALL-933). Callers historically had to pass the pre-wrap
	// description to extractIssueReferences because the wrap step's
	// `[` broke the prose-keyword regex anchor. Post-ALL-933, the
	// extractor also protects markdown links, so the wrap→extract
	// composition is now a no-op (no phantom relations) instead of
	// a silent type degradation from `blocks` to `related`. The
	// pre-wrap path remains the recommended call order for correct
	// type inference.

	const cases = [
		{
			label: "blocked by",
			text: "this is blocked by DEV-100",
			expectedType: "blocks" as const,
		},
		{
			label: "depends on",
			text: "depends on DEV-200",
			expectedType: "blocks" as const,
		},
		{
			label: "duplicates",
			text: "this duplicates DEV-300",
			expectedType: "duplicate" as const,
		},
		{
			label: "blocks",
			text: "this blocks DEV-400",
			expectedType: "blocks" as const,
		},
	];

	it.each(
		cases,
	)("$label keyword: pre-wrap text infers $expectedType correctly", ({
		text,
		expectedType,
	}) => {
		const refs = extractIssueReferences(text);
		expect(refs).toHaveLength(1);
		expect(refs[0].type).toBe(expectedType);
	});

	it("post-wrap text yields no extraction at all (markdown links are protected)", () => {
		// Pre-fix behaviour: the wrap step inserted `[` before the
		// identifier, which broke the prose-keyword regex anchor and
		// silently degraded the relation type from `blocks` to `related`.
		// Post-fix: identifiers inside markdown links are skipped
		// entirely, so wrap→extract returns no references at all. The
		// "callers must pass the PRE-wrap description" contract still
		// holds — but a regression where the wrap+extract order flips
		// is now a no-op rather than a silent type degradation.
		const wrapped =
			"this is blocked by [DEV-100](https://example.com/issue/DEV-100/)";
		expect(extractIssueReferences(wrapped)).toEqual([]);
	});
});
