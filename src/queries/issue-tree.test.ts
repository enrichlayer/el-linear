import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import {
	buildIssueTreeQuery,
	DEFAULT_TREE_DEPTH,
	MAX_TREE_DEPTH,
	MIN_TREE_DEPTH,
} from "./issue-tree.js";

describe("buildIssueTreeQuery", () => {
	it("emits the root fields plus exactly one level of children at depth 1", () => {
		const q = buildIssueTreeQuery(1);
		// One `children {` block, not nested.
		expect((q.match(/children\s*{/g) ?? []).length).toBe(1);
		expect(q).toMatch(/issue\(id:\s*\$id\)/);
		// Each level fetches the same minimal field set.
		expect((q.match(/identifier/g) ?? []).length).toBeGreaterThanOrEqual(2);
	});

	it("nests `children {` N times at depth N", () => {
		expect((buildIssueTreeQuery(2).match(/children\s*{/g) ?? []).length).toBe(
			2,
		);
		expect(
			(buildIssueTreeQuery(DEFAULT_TREE_DEPTH).match(/children\s*{/g) ?? [])
				.length,
		).toBe(DEFAULT_TREE_DEPTH);
		expect(
			(buildIssueTreeQuery(MAX_TREE_DEPTH).match(/children\s*{/g) ?? []).length,
		).toBe(MAX_TREE_DEPTH);
	});

	it("requests state.type so the client-side terminal-state prune works", () => {
		const q = buildIssueTreeQuery(3);
		// state.type appears at every level; only need to confirm at least one.
		expect(q).toMatch(/state\s*{\s*id\s+name\s+type\s*}/);
	});

	it("requests completedAt at every node level (DEV-5454)", () => {
		// Consumers such as el-sop health's completed-children grace check read
		// each child's completion timestamp off the tree; it must be selected at
		// every depth, once per node (root + one per `children` block).
		const q = buildIssueTreeQuery(3);
		const nodeLevels = (q.match(/identifier/g) ?? []).length;
		expect((q.match(/completedAt/g) ?? []).length).toBe(nodeLevels);
	});

	it("rejects sub-minimum depth", () => {
		expect(() => buildIssueTreeQuery(0)).toThrow(/integer in \[1, 5\]/);
		expect(() => buildIssueTreeQuery(-1)).toThrow(/integer in \[1, 5\]/);
	});

	it("rejects super-maximum depth", () => {
		expect(() => buildIssueTreeQuery(MAX_TREE_DEPTH + 1)).toThrow(
			/integer in \[1, 5\]/,
		);
		expect(() => buildIssueTreeQuery(100)).toThrow(/integer in \[1, 5\]/);
	});

	it("rejects non-integer depth", () => {
		expect(() => buildIssueTreeQuery(1.5)).toThrow(/integer in \[1, 5\]/);
		expect(() => buildIssueTreeQuery(Number.NaN)).toThrow(
			/integer in \[1, 5\]/,
		);
	});

	it("exposes the depth bounds as named constants", () => {
		expect(MIN_TREE_DEPTH).toBe(1);
		expect(MAX_TREE_DEPTH).toBe(5);
		expect(DEFAULT_TREE_DEPTH).toBeGreaterThanOrEqual(MIN_TREE_DEPTH);
		expect(DEFAULT_TREE_DEPTH).toBeLessThanOrEqual(MAX_TREE_DEPTH);
	});

	it("emits structurally-valid GraphQL at every allowed depth (cycle-1 nit)", () => {
		// The `ALL_QUERIES` gate in graphql-queries.test.ts runs `parse()`
		// across the static-query inventory. `buildIssueTreeQuery` is
		// runtime-generated and isn't in that gate, so round-trip parse here
		// instead for every depth in [MIN, MAX]. Catches typos in the
		// nested-children block, missing braces, etc.
		for (let d = MIN_TREE_DEPTH; d <= MAX_TREE_DEPTH; d++) {
			expect(() => parse(buildIssueTreeQuery(d))).not.toThrow();
		}
	});
});
