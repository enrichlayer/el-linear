import { describe, expect, it } from "vitest";
import {
	isPublishedSurfacePath,
	titleInfo,
	validatePrTitle,
} from "./validate-pr-title.mjs";

describe("validate-pr-title", () => {
	it("accepts release-please release PR titles", () => {
		const result = validatePrTitle("chore(main): release 1.37.3", [
			"package.json",
		]);

		expect(result.ok).toBe(true);
	});

	it("rejects non-conventional titles", () => {
		const result = validatePrTitle("DEV-5714 add issues list search flag", [
			"src/commands/issues.ts",
		]);

		expect(result.ok).toBe(false);
		expect(result.message).toContain("Conventional Commit");
	});

	it("requires releaseable types for published el-linear surface", () => {
		const result = validatePrTitle("ci: add release guard", [
			"src/commands/issues.ts",
		]);

		expect(result.ok).toBe(false);
		expect(result.message).toContain("will not trigger release-please");
	});

	it("allows non-release conventional types for CI-only changes", () => {
		const result = validatePrTitle("ci: add release guard", [
			".github/workflows/pr-title.yml",
		]);

		expect(result.ok).toBe(true);
	});

	it("accepts fix and feat titles for published surface changes", () => {
		expect(
			validatePrTitle("fix(cli): add search alias", ["src/commands/issues.ts"])
				.ok,
		).toBe(true);
		expect(
			validatePrTitle("feat(output): add summary format", ["README.md"]).ok,
		).toBe(true);
	});

	it("treats breaking conventional titles as releaseable", () => {
		expect(
			validatePrTitle("refactor(config)!: rename config path", ["package.json"])
				.ok,
		).toBe(true);
	});

	it("classifies published package surface paths", () => {
		expect(isPublishedSurfacePath("src/main.ts")).toBe(true);
		expect(
			isPublishedSurfacePath("claude-skills/linear-operations/SKILL.md"),
		).toBe(true);
		expect(isPublishedSurfacePath("README.md")).toBe(true);
		expect(isPublishedSurfacePath(".github/workflows/ci.yml")).toBe(false);
	});

	it("exposes parsed title type and releaseability", () => {
		expect(titleInfo("fix(cli): add search").releaseable).toBe(true);
		expect(titleInfo("docs: update readme").releaseable).toBe(false);
		expect(titleInfo("not conventional").kind).toBe("invalid");
	});
});
