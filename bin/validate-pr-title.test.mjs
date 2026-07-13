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

	// DEV-6064 — the lockfile is not a published surface.
	//
	// It is not in package.json's `files`, and a dependent resolves our deps from the
	// RANGES in package.json, never from our lockfile. Listing it made every dependabot
	// PR permanently red (dependabot always titles `build(deps):` and touches only the
	// lockfile). These two tests pin BOTH directions, so the gate can neither re-narrow
	// onto the lockfile nor silently widen away from the surfaces that do matter.
	it("lets a lockfile-only dependabot PR pass with a build(deps) title", () => {
		expect(isPublishedSurfacePath("pnpm-lock.yaml")).toBe(false);

		// The real shape of enrichlayer/el-linear#246 and #247: lockfile, nothing else.
		expect(
			validatePrTitle(
				"build(deps): Bump @sentry/node from 10.62.0 to 10.63.0",
				["pnpm-lock.yaml"],
			).ok,
		).toBe(true);
		expect(
			validatePrTitle(
				"build(deps-dev): Bump the dev-dependencies group with 3 updates",
				["pnpm-lock.yaml"],
			).ok,
		).toBe(true);
	});

	it("still REQUIRES a releaseable title for a consumer-visible dependency change", () => {
		// package.json stays a published surface — a range bump, a new dep, or a moved
		// dep DOES reach consumers, so it must still cut a release. This is the half of
		// the rule that must survive; if it ever goes green, the gate has a real hole.
		const result = validatePrTitle("build(deps): Bump @linear/sdk to ^87.0.0", [
			"package.json",
			"pnpm-lock.yaml",
		]);

		expect(result.ok).toBe(false);
		expect(result.message).toContain("will not trigger release-please");
		// The lockfile must not be named as the offender — package.json is.
		expect(result.message).toContain("package.json");
		expect(result.message).not.toContain("pnpm-lock.yaml");
	});

	it("exposes parsed title type and releaseability", () => {
		expect(titleInfo("fix(cli): add search").releaseable).toBe(true);
		expect(titleInfo("docs: update readme").releaseable).toBe(false);
		expect(titleInfo("not conventional").kind).toBe("invalid");
	});
});
