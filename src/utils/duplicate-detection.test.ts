import { describe, expect, it } from "vitest";
import type { LinearIssue } from "../types/linear.js";
import {
	DEFAULT_DUPLICATE_THRESHOLD,
	formatDuplicateBlock,
	jaccardSimilarity,
	scoreDuplicateCandidates,
	tokenizeTitle,
} from "./duplicate-detection.js";

/** Minimal LinearIssue factory — only the fields scoring/formatting read. */
function issue(
	identifier: string,
	title: string,
	overrides: Partial<LinearIssue> = {},
): LinearIssue {
	return {
		id: `id-${identifier}`,
		identifier,
		title,
		labels: [],
		priority: 0,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		url: `https://linear.app/x/issue/${identifier}`,
		...overrides,
	};
}

describe("tokenizeTitle", () => {
	it("lowercases and splits on non-alphanumeric runs", () => {
		expect(tokenizeTitle("Migrate scripts/*.mjs to TypeScript")).toEqual(
			new Set(["migrate", "scripts", "mjs", "typescript"]),
		);
	});

	it("drops stopwords, numbers, and single-character tokens", () => {
		// "to", "from", "the" are stopwords; "52" is a number; "x" is too short.
		expect(tokenizeTitle("Move 52 files from x the scripts")).toEqual(
			new Set(["move", "files", "scripts"]),
		);
	});

	it("keeps type-indicating verbs (they carry topical signal here)", () => {
		expect(tokenizeTitle("Migrate things")).toContain("migrate");
	});

	it("returns an empty set for a title with no salient tokens", () => {
		expect(tokenizeTitle("to the a of").size).toBe(0);
	});

	// DEV-4830: tool-name / CLI-scaffolding boilerplate is dropped so it can't
	// inflate Jaccard between distinct issues that touch the same command.
	it("drops tool-name and CLI-scaffolding boilerplate tokens", () => {
		// el-linear splits to el + linear; both, plus issues/create/flag, go.
		expect(
			tokenizeTitle("Add --checkout flag to el-linear issues create"),
		).toEqual(new Set(["add", "checkout"]));
		// el-git → el + git; command/cli scaffolding dropped.
		expect(tokenizeTitle("Standardize el-git pipeline watch command")).toEqual(
			new Set(["standardize", "pipeline", "watch"]),
		);
	});

	it("keeps topical words that are merely tool suffixes", () => {
		// "research"/"telemetry" carry real signal — only the `el` prefix goes.
		const t = tokenizeTitle("Standardize el-research and el-telemetry output");
		expect(t).toContain("research");
		expect(t).toContain("telemetry");
		expect(t.has("el")).toBe(false);
	});
});

describe("jaccardSimilarity", () => {
	it("is 1 for identical sets", () => {
		expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
	});

	it("is 0 for disjoint sets", () => {
		expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
	});

	it("is 0 when either set is empty", () => {
		expect(jaccardSimilarity(new Set(), new Set(["a"]))).toBe(0);
		expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
	});

	it("computes intersection over union", () => {
		// {a,b,c} ∩ {b,c,d} = 2 ; ∪ = 4 ; 0.5
		expect(
			jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"])),
		).toBe(0.5);
	});
});

describe("scoreDuplicateCandidates — the motivating DEV-4816 ↔ DEV-4818 pair", () => {
	const NEW_TITLE = "Migrate remaining scripts/*.mjs to TypeScript (52 files)"; // DEV-4816
	const EXISTING = issue(
		"DEV-4818",
		"Migrate scripts/ generators and tests from .mjs to TypeScript (run via tsx)",
		{ state: { id: "s", name: "Todo" }, assignee: { id: "u", name: "Yury" } },
	);

	it("fires on the real duplicate pair at the default threshold", () => {
		const matches = scoreDuplicateCandidates(NEW_TITLE, [EXISTING]);
		expect(matches).toHaveLength(1);
		expect(matches[0].identifier).toBe("DEV-4818");
		// Jaccard for this pair is 0.40 — above the 0.35 default.
		expect(matches[0].score).toBeGreaterThanOrEqual(
			DEFAULT_DUPLICATE_THRESHOLD,
		);
		expect(matches[0].score).toBeCloseTo(0.4, 2);
	});

	it("carries state and assignee through for the block", () => {
		const [m] = scoreDuplicateCandidates(NEW_TITLE, [EXISTING]);
		expect(m.state).toBe("Todo");
		expect(m.assignee).toBe("Yury");
	});
});

describe("scoreDuplicateCandidates — does not false-positive on same-domain issues", () => {
	const NEW_TITLE = "Migrate remaining scripts/*.mjs to TypeScript";
	const SAME_DOMAIN = [
		issue("DEV-1159", "Migrate support guide from Notion"),
		issue("DEV-2036", "Migrate public docs to Fumadox app"),
		issue("FE-126", "Migrate proxycurl-web analytics to current stack"),
	];

	it("returns no matches for merely same-verb issues", () => {
		expect(scoreDuplicateCandidates(NEW_TITLE, SAME_DOMAIN)).toEqual([]);
	});

	// DEV-4830: the "Add --X flag to el-linear issues create" family scored
	// 0.45–0.60 on shared tool-name boilerplate alone (top false positives in
	// the 288-title precision sweep). Boilerplate stopwording drops the real
	// DEV-3665↔DEV-4050 pair to ~0.20 — well below the 0.35 default.
	it("does not flag the el-linear-issues-create flag family (DEV-4830)", () => {
		const matches = scoreDuplicateCandidates(
			"Add --checkout flag to el-linear issues create", // DEV-3665
			[
				issue(
					"DEV-4050",
					"Add --parent flag alias for --parent-ticket on el-linear issues create",
				),
				issue(
					"DEV-3347",
					"Add --due-date flag to el-linear issues create and update commands",
				),
			],
		);
		expect(matches).toEqual([]);
	});

	// Observed on real input (Ship-Use-Refine): a different-problem el-linear
	// tooling issue shares only the boilerplate tokens el/linear/issues/create
	// with a new "issues create" issue, scoring 0.31 — below the 0.35 default.
	// Locks in that boilerplate overlap alone does not block.
	it("does not flag a different-problem issue sharing only boilerplate tokens", () => {
		const matches = scoreDuplicateCandidates(
			"Add duplicate detection to el-linear issues create",
			[
				issue(
					"DEV-4057",
					"Improve el-linear issues create error messages with team-scoped suggestions",
				),
			],
		);
		expect(matches).toEqual([]);
	});

	// The genuine sibling (projects-create dup detection) DOES still fire —
	// shared distinctive tokens (duplicate, detection) push it to 0.44.
	it("still flags the genuinely-related sibling above the default threshold", () => {
		const matches = scoreDuplicateCandidates(
			"Add duplicate detection to el-linear issues create",
			[
				issue(
					"DEV-3604",
					"Add projects create command with duplicate detection",
				),
			],
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].identifier).toBe("DEV-3604");
	});
});

describe("scoreDuplicateCandidates — general behavior", () => {
	it("sorts matches by descending similarity", () => {
		const newTitle = "Add duplicate detection to issues create";
		const candidates = [
			issue("A", "Add detection to projects"), // lower overlap
			issue("B", "Add duplicate detection to issues update"), // higher overlap
		];
		const matches = scoreDuplicateCandidates(newTitle, candidates, 0.2);
		expect(matches.map((m) => m.identifier)).toEqual(["B", "A"]);
		expect(matches[0].score).toBeGreaterThanOrEqual(matches[1].score);
	});

	it("respects a custom threshold", () => {
		const newTitle = "Add foo bar baz";
		const candidate = issue("C", "Add foo qux quux"); // ∩{add,foo}=2 ∪6 → 0.33
		expect(scoreDuplicateCandidates(newTitle, [candidate], 0.5)).toEqual([]);
		expect(scoreDuplicateCandidates(newTitle, [candidate], 0.3)).toHaveLength(
			1,
		);
	});

	it("defaults missing state/assignee to a dash", () => {
		const [m] = scoreDuplicateCandidates(
			"Add foo bar baz",
			[issue("D", "Add foo bar qux")],
			0.2,
		);
		expect(m.state).toBe("—");
		expect(m.assignee).toBe("—");
	});

	it("returns empty when the new title has no salient tokens", () => {
		expect(
			scoreDuplicateCandidates("to the a of", [issue("E", "Add real work")]),
		).toEqual([]);
	});
});

describe("formatDuplicateBlock", () => {
	it("lists candidates with id · title · state · assignee and similarity", () => {
		const block = formatDuplicateBlock([
			{
				identifier: "DEV-4818",
				title: "Migrate scripts to TypeScript",
				state: "Todo",
				assignee: "Yury",
				score: 0.4,
			},
		]);
		expect(block).toContain("DEV-4818");
		expect(block).toContain("Migrate scripts to TypeScript");
		expect(block).toContain("Todo");
		expect(block).toContain("Yury");
		expect(block).toContain("0.4");
		expect(block).toContain("--allow-duplicate");
	});

	it("uses singular vs plural wording", () => {
		const one = formatDuplicateBlock([
			{ identifier: "A", title: "t", state: "s", assignee: "a", score: 0.5 },
		]);
		const two = formatDuplicateBlock([
			{ identifier: "A", title: "t", state: "s", assignee: "a", score: 0.5 },
			{ identifier: "B", title: "u", state: "s", assignee: "a", score: 0.4 },
		]);
		expect(one).toContain("Possible duplicate issue found");
		expect(two).toContain("Possible duplicate issues found");
	});
});
