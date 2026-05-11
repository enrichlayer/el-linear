import { describe, expect, it } from "vitest";
import {
	findProtectedRanges,
	firstUnbalancedClose,
} from "./protected-ranges.js";

describe("firstUnbalancedClose", () => {
	it("returns string length when every close bracket has a matching opener", () => {
		expect(firstUnbalancedClose("")).toBe(0);
		expect(firstUnbalancedClose("hello")).toBe(5);
		expect(firstUnbalancedClose("(a)")).toBe(3);
		expect(firstUnbalancedClose("[a]")).toBe(3);
		expect(firstUnbalancedClose("{a}")).toBe(3);
		expect(firstUnbalancedClose("(a(b)c)")).toBe(7);
		expect(firstUnbalancedClose("(([a]))")).toBe(7);
	});

	it("returns the index of the first unbalanced close bracket", () => {
		expect(firstUnbalancedClose(")")).toBe(0);
		expect(firstUnbalancedClose("a)b")).toBe(1);
		expect(firstUnbalancedClose("(()")).toBe(3); // balanced — opener still open
		expect(firstUnbalancedClose("a]b")).toBe(1);
		expect(firstUnbalancedClose("a}b")).toBe(1);
	});

	it("counts each bracket type independently (paren, brack, brace)", () => {
		// Independent depth counters: `[(a]b)` looks like an unbalanced
		// interleaving, but `(` and `[` each have a matching closer.
		// Pragmatically correct — these URLs don't exist in the wild.
		expect(firstUnbalancedClose("[(a]b)")).toBe(6);
		// Truly unbalanced cases still trigger:
		expect(firstUnbalancedClose("(a]")).toBe(2); // `]` unbalanced
		expect(firstUnbalancedClose("[a)")).toBe(2); // `)` unbalanced
	});

	it("ignores non-bracket characters", () => {
		expect(firstUnbalancedClose("https://example.com/foo")).toBe(23);
		expect(firstUnbalancedClose("https://example.com/foo?q=1&z=2")).toBe(31);
	});
});

describe("findProtectedRanges — bare-URL trim integration", () => {
	function rangesFor(text: string): string[] {
		return findProtectedRanges(text).map((r) => text.slice(r.start, r.end));
	}

	it("trims unbalanced trailing brackets from bare URLs", () => {
		// `https://example.com/foo)` greedy-matches the entire URL+`)`,
		// then truncates at the unbalanced close.
		expect(rangesFor("(see https://example.com/foo) extra")).toContain(
			"https://example.com/foo",
		);
	});

	it("preserves balanced parens inside bare URLs", () => {
		// `https://en.wikipedia.org/wiki/Foo_(bar)/baz` should stay intact —
		// the `(bar)` is balanced.
		const ranges = rangesFor(
			"see https://en.wikipedia.org/wiki/Foo_(bar)/baz here",
		);
		expect(ranges).toContain("https://en.wikipedia.org/wiki/Foo_(bar)/baz");
	});

	it("strips trailing sentence punctuation from bare URLs", () => {
		const ranges = rangesFor("Visit https://example.com/page.html. End.");
		expect(ranges).toContain("https://example.com/page.html");
	});

	it("preserves URL-internal periods (extensions, hostnames)", () => {
		// The trailing-period trim should not eat `.html` since the `l`
		// before the final `.` is not punct.
		const ranges = rangesFor("see https://example.com/page.html here");
		expect(ranges).toContain("https://example.com/page.html");
	});

	it("preserves balanced braces (template-placeholder-style URLs)", () => {
		const ranges = rangesFor("https://cdn.example.com/{hash}/asset.js");
		expect(ranges).toContain("https://cdn.example.com/{hash}/asset.js");
	});
});
