import { describe, expect, it } from "vitest";
import { errorChain, errorChainMessage } from "./error-chain.js";

function wrapped(outer: string, inner: unknown): Error {
	return new Error(outer, { cause: inner });
}

describe("errorChainMessage", () => {
	it("renders a chain as one line, outermost first", () => {
		expect(errorChainMessage(wrapped("a", wrapped("b", new Error("c"))))).toBe(
			"a: b: c",
		);
	});

	it("drops a segment that merely restates its parent", () => {
		// Wrappers that reuse the inner message as their own are common; the
		// repetition is noise in a mailbox row or a Linear comment.
		expect(errorChainMessage(wrapped("same", new Error("same")))).toBe("same");
	});

	it("drops a cause already spelled out in the parent's message", () => {
		// `GraphQL request failed: ${err.message}` is the house way to add
		// context, so the inner text is already on the line; only the detail
		// underneath it is new.
		const outer = new Error("GraphQL request failed: fetch failed", {
			cause: new TypeError("fetch failed", {
				cause: new Error("connect ECONNREFUSED 127.0.0.1:443"),
			}),
		});
		expect(errorChainMessage(outer.cause)).toBe(
			"fetch failed: connect ECONNREFUSED 127.0.0.1:443",
		);
	});

	it("skips a segment the caller already prints", () => {
		const outer = new Error("GraphQL request failed: fetch failed", {
			cause: new TypeError("fetch failed", {
				cause: new Error("connect ECONNREFUSED 127.0.0.1:443"),
			}),
		});
		expect(errorChainMessage(outer.cause, outer.message)).toBe(
			"connect ECONNREFUSED 127.0.0.1:443",
		);
	});

	it("stops on a cycle instead of recursing", () => {
		const first = new Error("first");
		const second = new Error("second", { cause: first });
		(first as Error & { cause?: unknown }).cause = second;
		expect(errorChainMessage(first)).toBe("first: second");
	});

	it("reads message off an error-shaped object, not just an Error", () => {
		// A failure that crossed a module boundary or a JSON round trip is a
		// plain object; `instanceof Error` would render `[object Object]`.
		expect(errorChainMessage({ message: "serialized", cause: "raw" })).toBe(
			"serialized: raw",
		);
	});

	it("returns an empty string for an absent or blank chain", () => {
		expect(errorChainMessage(undefined)).toBe("");
		expect(errorChainMessage(null)).toBe("");
		expect(errorChainMessage({ message: "   " })).toBe("");
	});

	it("keeps a non-Error cause as its string form", () => {
		expect(errorChainMessage(wrapped("outer", 502))).toBe("outer: 502");
	});
});

describe("errorChain", () => {
	it("includes the value itself as the first link", () => {
		const inner = new Error("inner");
		const outer = wrapped("outer", inner);
		expect(errorChain(outer)).toEqual([outer, inner]);
	});

	it("bounds the walk", () => {
		let current: unknown = new Error("leaf");
		for (let depth = 0; depth < 12; depth += 1) {
			current = new Error(`level-${depth}`, { cause: current });
		}
		expect(errorChain(current).length).toBeLessThanOrEqual(4);
	});
});
