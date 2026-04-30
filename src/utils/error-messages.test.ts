import { describe, expect, it } from "vitest";
import {
	invalidParameterError,
	multipleMatchesError,
	notFoundError,
	requiresParameterError,
} from "./error-messages.js";

describe("notFoundError", () => {
	it("creates error with entity type and identifier", () => {
		const error = notFoundError("Team", "DEV");
		expect(error.message).toBe('Team "DEV" not found.');
	});

	it("includes context when provided", () => {
		const error = notFoundError("Cycle", "Sprint 1", "for team DEV");
		expect(error.message).toBe('Cycle "Sprint 1" for team DEV not found.');
	});

	it("includes hint after not found", () => {
		const error = notFoundError(
			"Label",
			"bug",
			undefined,
			"— check labels list",
		);
		expect(error.message).toBe('Label "bug" not found. — check labels list');
	});
});

describe("multipleMatchesError", () => {
	it("lists candidates and disambiguation hint", () => {
		const error = multipleMatchesError(
			"cycle",
			"Sprint",
			["id1", "id2"],
			"use an ID",
		);
		expect(error.message).toContain('Multiple cycles found matching "Sprint"');
		expect(error.message).toContain("id1, id2");
		expect(error.message).toContain("use an ID");
	});
});

describe("invalidParameterError", () => {
	it("creates error with parameter and reason", () => {
		const error = invalidParameterError("--priority", "must be 1-4");
		expect(error.message).toBe("Invalid --priority: must be 1-4");
	});
});

describe("requiresParameterError", () => {
	it("creates error with flag dependency", () => {
		const error = requiresParameterError("--label-by", "--labels");
		expect(error.message).toBe("--label-by requires --labels to be specified");
	});
});
