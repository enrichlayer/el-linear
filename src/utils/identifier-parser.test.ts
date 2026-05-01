import { describe, expect, it } from "vitest";
import {
	parseIssueIdentifier,
	tryParseIssueIdentifier,
} from "./identifier-parser.js";

describe("parseIssueIdentifier", () => {
	it("parses a valid identifier", () => {
		const result = parseIssueIdentifier("DEV-123");
		expect(result).toEqual({ teamKey: "DEV", issueNumber: 123 });
	});

	it("parses a single-letter team key", () => {
		const result = parseIssueIdentifier("A-1");
		expect(result).toEqual({ teamKey: "A", issueNumber: 1 });
	});

	it("parses lowercase identifier", () => {
		const result = parseIssueIdentifier("fe-42");
		expect(result).toEqual({ teamKey: "fe", issueNumber: 42 });
	});

	it("throws on missing number", () => {
		expect(() => parseIssueIdentifier("DEV-")).toThrow("Invalid issue number");
	});

	it("throws on invalid format without dash", () => {
		expect(() => parseIssueIdentifier("DEV123")).toThrow(
			"Invalid issue identifier format",
		);
	});

	it("throws on too many dashes", () => {
		expect(() => parseIssueIdentifier("DEV-12-3")).toThrow(
			"Invalid issue identifier format",
		);
	});

	it("throws on non-numeric issue number", () => {
		expect(() => parseIssueIdentifier("DEV-abc")).toThrow(
			"Invalid issue number",
		);
	});
});

describe("tryParseIssueIdentifier", () => {
	it("returns parsed result for valid identifier", () => {
		const result = tryParseIssueIdentifier("FE-99");
		expect(result).toEqual({ teamKey: "FE", issueNumber: 99 });
	});

	it("returns null for invalid identifier", () => {
		expect(tryParseIssueIdentifier("not-valid-format")).toBeNull();
	});

	it("returns null for UUID", () => {
		expect(
			tryParseIssueIdentifier("4b6bb89a-9348-4ab7-9e01-581040273998"),
		).toBeNull();
	});
});
