import { describe, expect, it, vi } from "vitest";

// Example rules used throughout these tests. We intentionally use "Enrich Layer"
// as the demonstration brand because that's the canonical example in the docs.
vi.mock("./config.js", () => ({
	loadConfig: () => ({
		terms: [
			{
				canonical: "Enrich Layer",
				reject: ["EnrichLayer", "enrichlayer", "Enrichlayer", "enrich layer"],
			},
			{
				canonical: "Linear",
				reject: ["linear.app", "Linear App"],
			},
		],
	}),
}));

const { enforceTerms } = await import("./term-enforcer.js");

describe("enforceTerms", () => {
	it("does not throw for the canonical form", () => {
		expect(() => enforceTerms(["Fix Enrich Layer login bug"])).not.toThrow();
	});

	it("does not throw when text contains a URL with a rejected token", () => {
		// enrichlayer.com is a domain — should be allowed even though "enrichlayer" is rejected.
		expect(() =>
			enforceTerms(["Visit enrichlayer.com for details"]),
		).not.toThrow();
	});

	it("throws in strict mode on misspelling", () => {
		expect(() =>
			enforceTerms(["Fix EnrichLayer login bug"], { strict: true }),
		).toThrow("Term enforcement failed");
	});

	it("buffers a warning in non-strict mode", async () => {
		const { resetWarnings, outputSuccess } = await import("../utils/output.js");
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		resetWarnings();
		enforceTerms(["Fix EnrichLayer bug"]);
		outputSuccess({ test: true });
		const output = JSON.parse((spy.mock.calls[0][0] as string).trimEnd());
		expect(output._warnings).toHaveLength(1);
		expect(output._warnings[0]).toContain("EnrichLayer");
		expect(output._warnings[0]).toContain("Enrich Layer");
		spy.mockRestore();
	});

	it("checks every text passed in", () => {
		expect(() =>
			enforceTerms(["Good title", "but EnrichLayer in description"], {
				strict: true,
			}),
		).toThrow("Term enforcement failed");
	});

	it("ignores null/undefined entries", () => {
		expect(() =>
			enforceTerms([null, undefined, "Fix Enrich Layer bug"]),
		).not.toThrow();
	});

	it("allows the rejected token in URLs like enrichlayer.co", () => {
		expect(() =>
			enforceTerms(["Go to enrichlayer.co"], { strict: true }),
		).not.toThrow();
	});

	it("enforces multiple rules in one pass", () => {
		expect(() =>
			enforceTerms(["Fix EnrichLayer integration with linear.app"], {
				strict: true,
			}),
		).toThrow(/EnrichLayer.*Enrich Layer/s);
	});

	it("counts multiple occurrences of the same rejected token", async () => {
		const { resetWarnings, outputSuccess } = await import("../utils/output.js");
		const spy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		resetWarnings();
		enforceTerms(["EnrichLayer is great. EnrichLayer all the things!"]);
		outputSuccess({ test: true });
		const output = JSON.parse((spy.mock.calls[0][0] as string).trimEnd());
		expect(output._warnings[0]).toContain("2 occurrences");
		spy.mockRestore();
	});
});

describe("enforceTerms with no rules", () => {
	it("is a no-op when terms is empty", async () => {
		vi.resetModules();
		vi.doMock("./config.js", () => ({ loadConfig: () => ({ terms: [] }) }));
		const { enforceTerms: enforce } = await import("./term-enforcer.js");
		expect(() =>
			enforce(["literally anything goes here"], { strict: true }),
		).not.toThrow();
		vi.doUnmock("./config.js");
	});
});
