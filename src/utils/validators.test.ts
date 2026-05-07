import { describe, expect, it } from "vitest";
import {
	PRIORITY_LABELS,
	parsePositiveInt,
	parsePriorityFilter,
	splitList,
	validateHexColor,
	validateIsoDate,
	validatePriority,
} from "./validators.js";

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

	it("rejects floating point strings", () => {
		// parseInt("3.5") returns 3, which is valid
		expect(parsePositiveInt("3.5", "--limit")).toBe(3);
	});

	it("rejects empty string", () => {
		expect(() => parsePositiveInt("", "--limit")).toThrow(
			"not a positive integer",
		);
	});
});

describe("validatePriority", () => {
	it("accepts valid priorities 1-4", () => {
		expect(validatePriority("1")).toBe(1);
		expect(validatePriority("2")).toBe(2);
		expect(validatePriority("3")).toBe(3);
		expect(validatePriority("4")).toBe(4);
	});

	it("accepts 0 as 'No priority'", () => {
		expect(validatePriority("0")).toBe(0);
	});

	it("rejects 5", () => {
		expect(() => validatePriority("5")).toThrow("not valid");
	});

	it("rejects -1", () => {
		expect(() => validatePriority("-1")).toThrow("not valid");
	});

	it("accepts priority names (case-insensitive)", () => {
		expect(validatePriority("urgent")).toBe(1);
		expect(validatePriority("High")).toBe(2);
		expect(validatePriority("MEDIUM")).toBe(3);
		expect(validatePriority("Normal")).toBe(3);
		expect(validatePriority("low")).toBe(4);
		expect(validatePriority("Low")).toBe(4);
	});

	it("accepts 'none' as priority 0 (No priority is a real Linear state)", () => {
		expect(validatePriority("none")).toBe(0);
		expect(validatePriority("None")).toBe(0);
		expect(validatePriority("NONE")).toBe(0);
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

	it("rejects 8-digit hex (with alpha)", () => {
		expect(() => validateHexColor("#ff000080")).toThrow(
			"not a valid hex color",
		);
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

	it("rejects invalid month/day combinations that produce NaN dates", () => {
		// 2026-13-01 matches the regex pattern but new Date("2026-13-01") is NaN
		expect(() => validateIsoDate("2026-13-01")).toThrow("not a valid date");
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

	it("handles empty string", () => {
		expect(splitList("")).toEqual([]);
	});

	it("handles whitespace-only entries", () => {
		expect(splitList("a, ,b")).toEqual(["a", "b"]);
	});
});

describe("parsePriorityFilter", () => {
	it("parses single priority name", () => {
		expect(parsePriorityFilter("urgent")).toEqual([1]);
		expect(parsePriorityFilter("high")).toEqual([2]);
		expect(parsePriorityFilter("medium")).toEqual([3]);
		expect(parsePriorityFilter("low")).toEqual([4]);
	});

	it("parses single priority number", () => {
		expect(parsePriorityFilter("1")).toEqual([1]);
		expect(parsePriorityFilter("0")).toEqual([0]);
		expect(parsePriorityFilter("4")).toEqual([4]);
	});

	it("accepts 'none' (priority 0) unlike validatePriority", () => {
		expect(parsePriorityFilter("none")).toEqual([0]);
	});

	it("parses comma-separated priorities", () => {
		expect(parsePriorityFilter("urgent,high")).toEqual([1, 2]);
		expect(parsePriorityFilter("1,2,3")).toEqual([1, 2, 3]);
	});

	it("handles mixed names and numbers", () => {
		expect(parsePriorityFilter("urgent,3")).toEqual([1, 3]);
	});

	it("trims whitespace in comma-separated values", () => {
		expect(parsePriorityFilter("urgent , high")).toEqual([1, 2]);
	});

	it("rejects invalid priority names", () => {
		expect(() => parsePriorityFilter("critical")).toThrow("not valid");
	});

	it("rejects out-of-range numbers", () => {
		expect(() => parsePriorityFilter("5")).toThrow("not valid");
		expect(() => parsePriorityFilter("-1")).toThrow("not valid");
	});

	it("maps 'normal' to medium (3)", () => {
		expect(parsePriorityFilter("normal")).toEqual([3]);
	});

	it("is case-insensitive", () => {
		expect(parsePriorityFilter("URGENT")).toEqual([1]);
		expect(parsePriorityFilter("High")).toEqual([2]);
	});
});

describe("PRIORITY_LABELS", () => {
	it("maps all priority numbers to labels", () => {
		expect(PRIORITY_LABELS[0]).toBe("No priority");
		expect(PRIORITY_LABELS[1]).toBe("Urgent");
		expect(PRIORITY_LABELS[2]).toBe("High");
		expect(PRIORITY_LABELS[3]).toBe("Medium");
		expect(PRIORITY_LABELS[4]).toBe("Low");
	});

	it("covers all 5 priority levels (0-4)", () => {
		expect(Object.keys(PRIORITY_LABELS)).toHaveLength(5);
	});

	it("has no undefined entries", () => {
		for (let i = 0; i <= 4; i++) {
			expect(PRIORITY_LABELS[i]).toBeDefined();
			expect(typeof PRIORITY_LABELS[i]).toBe("string");
		}
	});
});
