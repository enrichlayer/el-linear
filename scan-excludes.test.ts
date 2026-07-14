import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import vitestConfig from "./vitest.config.js";

/**
 * Guard for DEV-5944: the vitest + biome scans must skip the gitignored dirs
 * that hold full git worktrees (`.tmp/wt-*` is this repo's standard wt-new
 * placement; `.claude/` can hold them too).
 *
 * Unexcluded, a local `pnpm test` walks every worktree, collects its copy of the
 * suite, and dies with `Cannot find module` on test files whose worktree branch
 * has since deleted them; `biome check .` aborts outright on a nested worktree's
 * root `biome.json` ("Found a nested root configuration"). Neither failure has
 * anything to do with the working tree's own code — they just mask whether a
 * real failure exists.
 *
 * This is a config assertion rather than a behavioral test on purpose. CI runs
 * on a clean checkout with no worktrees, so it is green either way and can NEVER
 * catch a revert of this — which is exactly how the gap shipped unnoticed. This
 * test is the only thing standing between a dropped exclude and every local
 * contributor's suite breaking again, so it asserts the excludes directly.
 */

const WORKTREE_DIRS = [".tmp", ".claude"] as const;

const biome = JSON.parse(
	readFileSync(fileURLToPath(new URL("./biome.json", import.meta.url)), "utf8"),
) as { files: { includes: string[] } };

describe("scan excludes (DEV-5944)", () => {
	it.each(
		WORKTREE_DIRS,
	)("vitest excludes %s/ so worktrees are not collected", (dir) => {
		expect(vitestConfig.test?.exclude).toContain(`${dir}/**`);
	});

	it.each(
		WORKTREE_DIRS,
	)("biome excludes %s/ so a nested root config cannot abort the run", (dir) => {
		expect(biome.files.includes).toContain(`!${dir}`);
	});

	// The load-bearing premise of every exclude above is that these dirs hold NO
	// TRACKED SOURCE — they are gitignored scratch space for worktrees. If that ever
	// stops being true (someone starts tracking files under .tmp/), the excludes turn
	// from "skip the noise" into "silently skip real code": those files would be
	// neither tested nor linted, and nothing would say so. The excludes are only safe
	// BECAUSE of .gitignore, so assert the thing they depend on.
	it.each(WORKTREE_DIRS)(
		"%s/ is gitignored — which is the only reason excluding it is safe",
		(dir) => {
			const gitignore = readFileSync(
				fileURLToPath(new URL("./.gitignore", import.meta.url)),
				"utf8",
			)
				.split("\n")
				.map((line) => line.trim());

			expect(
				gitignore,
				`${dir}/ is excluded from vitest + biome but is NOT gitignored — tracked source ` +
					`under it would be silently unlinted and untested. Either gitignore it, or stop ` +
					`excluding it from the scanners.`,
			).toContain(`${dir}/`);
		},
	);

	it("keeps excluding dist/ and node_modules/ from vitest", () => {
		// Vitest's `exclude` REPLACES its defaults rather than extending them, so
		// these have to stay listed explicitly — dropping one while adding .tmp
		// would silently start collecting built output.
		expect(vitestConfig.test?.exclude).toEqual(
			expect.arrayContaining(["dist/**", "node_modules/**"]),
		);
	});
});
