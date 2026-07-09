import { describe, expect, it } from "vitest";
import {
	buildRelationCandidatePrompt,
	extractCandidateIdentifiers,
} from "./relation-candidate-prompt.js";

describe("extractCandidateIdentifiers", () => {
	it("returns top-level identifier fields (LinearIssue / issues search shape)", () => {
		const rows = [
			{ identifier: "DEV-1", title: "x" },
			{ identifier: "DEV-2", title: "y" },
		];
		expect(extractCandidateIdentifiers(rows)).toEqual(["DEV-1", "DEV-2"]);
	});

	it("returns identifiers from cross-resource search rows (type+identifier shape)", () => {
		// search.ts transformSearchResult produces { type: "issue", identifier, … }
		// for issue rows and { type: "project", name, … } for projects.
		const rows = [
			{ type: "issue", identifier: "ALL-672", title: "Auth bug" },
			{ type: "project", name: "Reliability", id: "p1" },
			{ type: "issue", identifier: "FIN-77", title: "Billing edge case" },
			{ type: "document", title: "RFC", id: "d1" },
		];
		expect(extractCandidateIdentifiers(rows)).toEqual(["ALL-672", "FIN-77"]);
	});

	it("returns empty array when no rows carry identifiers", () => {
		const rows = [
			{ type: "project", name: "Reliability" },
			{ type: "document", title: "RFC" },
		];
		expect(extractCandidateIdentifiers(rows)).toEqual([]);
	});

	it("returns empty array for an empty input", () => {
		expect(extractCandidateIdentifiers([])).toEqual([]);
	});

	it("deduplicates repeated identifiers while preserving first-seen order", () => {
		const rows = [
			{ identifier: "DEV-1" },
			{ identifier: "DEV-2" },
			{ identifier: "DEV-1" }, // dup
			{ identifier: "DEV-3" },
		];
		expect(extractCandidateIdentifiers(rows)).toEqual([
			"DEV-1",
			"DEV-2",
			"DEV-3",
		]);
	});

	it("ignores non-object / null entries defensively", () => {
		const rows = [null, "DEV-1", 42, { identifier: "DEV-2" }];
		expect(extractCandidateIdentifiers(rows)).toEqual(["DEV-2"]);
	});

	it("ignores rows whose identifier field is not a string", () => {
		const rows = [
			{ identifier: 123 },
			{ identifier: null },
			{ identifier: { id: "DEV-1" } },
			{ identifier: "DEV-2" },
		];
		expect(extractCandidateIdentifiers(rows)).toEqual(["DEV-2"]);
	});
});

describe("buildRelationCandidatePrompt", () => {
	it("returns null when no candidates carry identifiers", () => {
		expect(buildRelationCandidatePrompt([])).toBeNull();
		expect(
			buildRelationCandidatePrompt([{ type: "project", name: "x" }]),
		).toBeNull();
	});

	it("emits the structured `relation_candidates:` prefix so skills can grep", () => {
		const out = buildRelationCandidatePrompt([
			{ identifier: "DEV-1" },
			{ identifier: "DEV-2" },
		]);
		expect(out).not.toBeNull();
		expect(out).toMatch(/^relation_candidates:/);
	});

	it("enumerates IDs inline, leads with proactive linking, keeps the reply fallback", () => {
		const out = buildRelationCandidatePrompt([
			{ identifier: "DEV-2134" },
			{ identifier: "FIN-77" },
			{ identifier: "ALL-672" },
		]);
		expect(out).toContain("Found 3 candidate related issues");
		expect(out).toContain("DEV-2134");
		expect(out).toContain("FIN-77");
		expect(out).toContain("ALL-672");
		// DEV-5853: proactive framing is primary — link the relevant ones now.
		expect(out).toContain("Link the relevant ones now");
		expect(out).toContain("--related-to");
		// …and the reply flow is retained as the auto-mode-block fallback.
		expect(out).toContain("reply with the IDs you want linked");
		expect(out).toContain("link DEV-2134 and FIN-77");
		expect(out).toContain('"no links"');
	});

	it("singular noun for one candidate, no `and` in the example", () => {
		const out = buildRelationCandidatePrompt([{ identifier: "DEV-1" }]);
		expect(out).toContain("Found 1 candidate related issue ");
		expect(out).toContain("(DEV-1)");
		expect(out).toContain('"link DEV-1"');
		expect(out).not.toMatch(/link DEV-1 and/);
	});

	it("caps inline enumeration at 10 IDs and notes the overflow", () => {
		const rows = Array.from({ length: 14 }, (_, i) => ({
			identifier: `DEV-${i + 1}`,
		}));
		const out = buildRelationCandidatePrompt(rows);
		expect(out).toContain("Found 14 candidate related issues");
		expect(out).toContain("DEV-1");
		expect(out).toContain("DEV-10");
		// 11..14 collapsed into the overflow count, not enumerated
		expect(out).not.toContain("DEV-11");
		expect(out).toContain("(+4 more)");
	});

	it("cites DEV-4494 so the rule is traceable from the warning alone", () => {
		const out = buildRelationCandidatePrompt([{ identifier: "DEV-1" }]);
		expect(out).toContain("DEV-4494");
	});
});
