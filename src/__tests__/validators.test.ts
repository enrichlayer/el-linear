import { describe, expect, it } from "vitest";
import {
	parsePositiveInt,
	splitList,
	validateHexColor,
	validateIsoDate,
	validatePriority,
} from "../utils/validators.js";

describe("parsePositiveInt", () => {
	it("parses valid positive integers", () => {
		expect(parsePositiveInt("1", "--limit")).toBe(1);
		expect(parsePositiveInt("25", "--limit")).toBe(25);
		expect(parsePositiveInt("100", "--limit")).toBe(100);
	});

	it("rejects zero", () => {
		expect(() => parsePositiveInt("0", "--limit")).toThrow(
			"not a positive integer",
		);
	});

	it("rejects negative numbers", () => {
		expect(() => parsePositiveInt("-5", "--limit")).toThrow(
			"not a positive integer",
		);
	});

	it("rejects non-numeric strings", () => {
		expect(() => parsePositiveInt("abc", "--limit")).toThrow(
			"not a positive integer",
		);
	});

	it("includes flag name in error", () => {
		expect(() => parsePositiveInt("abc", "--limit")).toThrow("--limit");
	});
});

describe("validatePriority", () => {
	it("accepts valid priorities 1-4", () => {
		expect(validatePriority("1")).toBe(1);
		expect(validatePriority("2")).toBe(2);
		expect(validatePriority("3")).toBe(3);
		expect(validatePriority("4")).toBe(4);
	});

	it("rejects 0", () => {
		expect(() => validatePriority("0")).toThrow("not valid");
	});

	it("rejects 5", () => {
		expect(() => validatePriority("5")).toThrow("not valid");
	});

	it("accepts priority names (case-insensitive)", () => {
		expect(validatePriority("urgent")).toBe(1);
		expect(validatePriority("High")).toBe(2);
		expect(validatePriority("MEDIUM")).toBe(3);
		expect(validatePriority("Normal")).toBe(3);
		expect(validatePriority("low")).toBe(4);
		expect(validatePriority("Low")).toBe(4);
	});

	it("rejects 'none' (priority 0 not valid for create/update)", () => {
		expect(() => validatePriority("none")).toThrow("not valid");
	});

	it("rejects invalid strings", () => {
		expect(() => validatePriority("critical")).toThrow("not valid");
	});
});

describe("validateHexColor", () => {
	it("accepts valid hex colors", () => {
		expect(validateHexColor("#e06666")).toBe("#e06666");
		expect(validateHexColor("#000000")).toBe("#000000");
		expect(validateHexColor("#FFFFFF")).toBe("#FFFFFF");
		expect(validateHexColor("#aaBBcc")).toBe("#aaBBcc");
	});

	it("rejects colors without hash", () => {
		expect(() => validateHexColor("e06666")).toThrow("not a valid hex color");
	});

	it("rejects short hex", () => {
		expect(() => validateHexColor("#fff")).toThrow("not a valid hex color");
	});

	it("rejects invalid characters", () => {
		expect(() => validateHexColor("#gggggg")).toThrow("not a valid hex color");
	});

	it("rejects named colors", () => {
		expect(() => validateHexColor("red")).toThrow("not a valid hex color");
	});
});

describe("validateIsoDate", () => {
	it("accepts valid dates", () => {
		expect(validateIsoDate("2026-03-06")).toBe("2026-03-06");
		expect(validateIsoDate("2025-01-01")).toBe("2025-01-01");
		expect(validateIsoDate("2026-12-31")).toBe("2026-12-31");
	});

	it("rejects non-date strings", () => {
		expect(() => validateIsoDate("tomorrow")).toThrow("not a valid date");
	});

	it("rejects wrong format", () => {
		expect(() => validateIsoDate("03/06/2026")).toThrow("not a valid date");
	});

	it("rejects partial dates", () => {
		expect(() => validateIsoDate("2026-03")).toThrow("not a valid date");
	});
});

describe("splitList", () => {
	it("splits comma-separated values", () => {
		expect(splitList("a,b,c")).toEqual(["a", "b", "c"]);
	});

	it("trims whitespace", () => {
		expect(splitList("a , b , c")).toEqual(["a", "b", "c"]);
	});

	it("filters empty entries", () => {
		expect(splitList("a,,b,")).toEqual(["a", "b"]);
	});

	it("handles single value", () => {
		expect(splitList("single")).toEqual(["single"]);
	});
});
