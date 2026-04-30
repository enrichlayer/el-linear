import { describe, expect, it } from "vitest";
import { toISOStringOrNow, toISOStringOrUndefined } from "./date-format.js";

describe("toISOStringOrNow", () => {
	it("converts a date string to ISO format", () => {
		const result = toISOStringOrNow("2026-01-15T10:30:00Z");
		expect(result).toBe("2026-01-15T10:30:00.000Z");
	});

	it("converts a Date object to ISO format", () => {
		const date = new Date("2026-06-01T00:00:00Z");
		const result = toISOStringOrNow(date);
		expect(result).toBe("2026-06-01T00:00:00.000Z");
	});

	it("returns current time for null", () => {
		const before = Date.now();
		const result = toISOStringOrNow(null);
		const after = Date.now();
		const resultMs = new Date(result).getTime();
		expect(resultMs).toBeGreaterThanOrEqual(before);
		expect(resultMs).toBeLessThanOrEqual(after);
	});

	it("returns current time for undefined", () => {
		const before = Date.now();
		const result = toISOStringOrNow(undefined);
		const resultMs = new Date(result).getTime();
		expect(resultMs).toBeGreaterThanOrEqual(before);
	});
});

describe("toISOStringOrUndefined", () => {
	it("converts a date string to ISO format", () => {
		expect(toISOStringOrUndefined("2026-03-01")).toBe(
			"2026-03-01T00:00:00.000Z",
		);
	});

	it("returns undefined for null", () => {
		expect(toISOStringOrUndefined(null)).toBeUndefined();
	});

	it("returns undefined for undefined", () => {
		expect(toISOStringOrUndefined(undefined)).toBeUndefined();
	});

	it("converts a Date object", () => {
		const date = new Date("2026-12-25T12:00:00Z");
		expect(toISOStringOrUndefined(date)).toBe("2026-12-25T12:00:00.000Z");
	});
});
