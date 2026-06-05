import { describe, expect, it } from "vitest";
import { parseWithIncludes } from "./with-includes.js";

describe("parseWithIncludes", () => {
	it("parses a single known include", () => {
		expect(parseWithIncludes("relations")).toEqual({ relations: true });
	});

	it("tolerates whitespace around commas", () => {
		expect(parseWithIncludes("  relations  ")).toEqual({ relations: true });
		expect(parseWithIncludes(" relations , ")).toEqual({ relations: true });
	});

	it("rejects an unknown include with a candidate-list message", () => {
		expect(() => parseWithIncludes("attachments")).toThrow(
			/unknown include "attachments"\. Supported: relations/,
		);
	});

	it("rejects an empty argument with a candidate-list message", () => {
		expect(() => parseWithIncludes("")).toThrow(
			/requires at least one include name\. Supported: relations/,
		);
	});

	it("rejects whitespace-only with the same shape", () => {
		expect(() => parseWithIncludes("  , ,  ")).toThrow(
			/requires at least one include name\./,
		);
	});

	it("rejects on the first unknown even if other values are valid", () => {
		expect(() => parseWithIncludes("relations,bogus")).toThrow(
			/unknown include "bogus"/,
		);
	});

	it("deduplicates repeated names without error", () => {
		expect(parseWithIncludes("relations,relations")).toEqual({
			relations: true,
		});
	});
});
