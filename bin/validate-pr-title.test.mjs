import { describe, expect, it } from "vitest";
import {
	classifyPackageJsonChange,
	consumerVisiblePackageJsonKeys,
	isPublishedSurfacePath,
	titleInfo,
	validatePrTitle,
} from "./validate-pr-title.mjs";

/** A trimmed but structurally faithful el-linear package.json. */
const BASE_PACKAGE = {
	name: "@enrichlayer/el-linear",
	version: "1.38.2",
	main: "dist/main.js",
	bin: { "el-linear": "dist/main.js" },
	files: ["dist/", "claude-skills/", "LICENSE", "README.md"],
	engines: { node: ">=22.0.0" },
	scripts: { build: "tsc -p tsconfig.build.json", test: "vitest run" },
	dependencies: { "@linear/sdk": "^86.0.0", commander: "^15.0.0" },
	devDependencies: { typescript: "^6.0.3", vitest: "^4.0.18" },
	optionalDependencies: { "@sentry/node": "^10.50.0" },
};

/** Serialize a package.json with an override applied, as the validator receives it. */
function pkg(overrides = {}) {
	return JSON.stringify({ ...BASE_PACKAGE, ...overrides }, null, "\t");
}

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

	// DEV-6066 — the published-surface check is SECTION-AWARE for package.json.
	//
	// DEV-6064 fixed the lockfile-only dependabot PR. The residual it left: dependabot
	// rewrites the RANGE in package.json on a MAJOR bump, so the first major bump of a
	// devDependency (typescript, @types/node, vitest, @biomejs/biome — the
	// `dev-dependencies` group in .github/dependabot.yml) reproduces the identical
	// permanent-red. These tests pin BOTH halves of the rule.
	describe("section-aware package.json check (DEV-6066)", () => {
		it("lets a devDependencies-only major bump pass with a build(deps-dev) title", () => {
			// The exact shape of the next dev-dependencies group PR: package.json range
			// rewrite + lockfile, titled build(deps-dev). A consumer cannot observe it —
			// devDeps are never installed by a dependent and the build is `tsc`, not a
			// bundler, so no dev tool is inlined into dist/.
			const result = validatePrTitle(
				"build(deps-dev): Bump the dev-dependencies group with 2 updates",
				["package.json", "pnpm-lock.yaml"],
				{
					packageJson: {
						base: pkg(),
						head: pkg({
							devDependencies: { typescript: "^7.0.0", vitest: "^5.0.0" },
						}),
					},
				},
			);

			expect(result.ok).toBe(true);
		});

		it("STILL fails a runtime dependency range bump with a build(deps) title", () => {
			// The half of the rule that is the reason the gate exists. A `dependencies`
			// range IS resolved at the consumer's install, so it must cut a release.
			const result = validatePrTitle(
				"build(deps): Bump @linear/sdk from 86.0.0 to 87.0.0",
				["package.json", "pnpm-lock.yaml"],
				{
					packageJson: {
						base: pkg(),
						head: pkg({
							dependencies: {
								"@linear/sdk": "^87.0.0",
								commander: "^15.0.0",
							},
						}),
					},
				},
			);

			expect(result.ok).toBe(false);
			expect(result.message).toContain("will not trigger release-please");
			// The message names the offending KEY, not just the file.
			expect(result.message).toContain("package.json (dependencies)");
			expect(result.message).not.toContain("pnpm-lock.yaml");
		});

		it("still fires for optionalDependencies and peerDependencies bumps", () => {
			expect(
				validatePrTitle("build(deps): Bump @sentry/node", ["package.json"], {
					packageJson: {
						base: pkg(),
						head: pkg({ optionalDependencies: { "@sentry/node": "^11.0.0" } }),
					},
				}).ok,
			).toBe(false);

			expect(
				validatePrTitle("chore: add a peer dep", ["package.json"], {
					packageJson: {
						base: pkg(),
						head: pkg({ peerDependencies: { typescript: "^6.0.0" } }),
					},
				}).ok,
			).toBe(false);
		});

		it("fires for every other consumer-visible key, not just dependencies", () => {
			const cases = {
				engines: { engines: { node: ">=24.0.0" } },
				bin: { bin: { "el-linear": "dist/cli.js" } },
				exports: { exports: { ".": "./dist/main.js" } },
				files: { files: ["dist/"] },
				name: { name: "@enrichlayer/el-linear-next" },
				version: { version: "2.0.0" },
				// NOT in the issue's enumerated list — proves the check is fail-closed
				// (denylist of dev-only keys) rather than an allowlist that would let an
				// unlisted-but-consumer-visible key slip through.
				main: { main: "dist/cli.js" },
			};

			for (const [key, override] of Object.entries(cases)) {
				const result = validatePrTitle("ci: tweak", ["package.json"], {
					packageJson: { base: pkg(), head: pkg(override) },
				});
				expect(result.ok, `${key} must still gate`).toBe(false);
				expect(result.message).toContain(`package.json (${key})`);
			}
		});

		it("treats dev-only script targets as invisible but install lifecycle scripts as visible", () => {
			expect(
				consumerVisiblePackageJsonKeys(JSON.parse(pkg()), {
					...BASE_PACKAGE,
					scripts: { ...BASE_PACKAGE.scripts, test: "vitest run --coverage" },
				}),
			).toEqual([]);

			// A postinstall runs on the CONSUMER's machine at install time.
			expect(
				consumerVisiblePackageJsonKeys(JSON.parse(pkg()), {
					...BASE_PACKAGE,
					scripts: { ...BASE_PACKAGE.scripts, postinstall: "node ./setup.js" },
				}),
			).toEqual(["scripts"]);
		});

		it("fails closed when the package.json blobs are unavailable or unparseable", () => {
			// No context at all — the pre-DEV-6066 wholesale behavior.
			expect(
				validatePrTitle("build(deps): Bump something", ["package.json"]).ok,
			).toBe(false);

			// File added or deleted (one side missing), and malformed JSON.
			expect(
				classifyPackageJsonChange({ base: null, head: pkg() }),
			).toMatchObject({ consumerVisible: true, readable: false });
			expect(
				classifyPackageJsonChange({ base: pkg(), head: "{ not json" }),
			).toMatchObject({ consumerVisible: true, readable: false });
		});

		it("ignores key REORDERING and formatting-only churn", () => {
			const reordered = JSON.stringify(
				Object.fromEntries(Object.entries(BASE_PACKAGE).reverse()),
				null,
				2,
			);

			expect(
				classifyPackageJsonChange({ base: pkg(), head: reordered }),
			).toMatchObject({ consumerVisible: false, keys: [] });
		});
	});

	it("exposes parsed title type and releaseability", () => {
		expect(titleInfo("fix(cli): add search").releaseable).toBe(true);
		expect(titleInfo("docs: update readme").releaseable).toBe(false);
		expect(titleInfo("not conventional").kind).toBe("invalid");
	});
});
