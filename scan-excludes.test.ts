import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import vitestConfig from "./vitest.config.js";

/**
 * Guard for DEV-5944 + DEV-6206: the vitest + biome scans must skip the
 * gitignored dirs that local agent tooling fills with content from OTHER
 * checkouts. Two flavours, same premise:
 *
 *  - full git worktrees — `.tmp/wt-*` is this repo's standard wt-new placement;
 *    `.claude/` can hold them too (DEV-5944).
 *  - symlink farms pointing into a separate repo — a setup step links another
 *    checkout's skills in at `.agents/skills/*` and `.claude/*` (DEV-6206).
 *
 * Unexcluded, a local `pnpm test` walks every worktree, collects its copy of the
 * suite, and dies with `Cannot find module` on test files whose worktree branch
 * has since deleted them; `biome check .` aborts outright on a nested worktree's
 * root `biome.json` ("Found a nested root configuration"), and — because biome
 * FOLLOWS SYMLINKS — walks straight out of the repo through `.agents/skills/*`
 * and lints the linked repo's files. That last one took `pnpm lint` from 261
 * files / 0 errors to 873 files / 479 errors, none of them this repo's
 * (DEV-6206). None of these failures has anything to do with the working tree's
 * own code — they just mask whether a real failure exists.
 *
 * CI clones fresh, so it has no worktrees and no links and stays green either
 * way — which is exactly how the DEV-5944 gap shipped unnoticed. The config
 * assertions below therefore assert the excludes directly. A symlink farm,
 * unlike a worktree, is cheap enough to fabricate that we can do better, so
 * `biome really stops at an excluded link dir` closes that hole behaviorally.
 */

const SCAN_EXCLUDED_DIRS = [".tmp", ".claude", ".agents"] as const;

const repoRoot = fileURLToPath(new URL(".", import.meta.url));

const biome = JSON.parse(
	readFileSync(join(repoRoot, "biome.json"), "utf8"),
) as { files: { includes: string[] } };

describe("scan excludes (DEV-5944, DEV-6206)", () => {
	it.each(
		SCAN_EXCLUDED_DIRS,
	)("vitest excludes %s/ so foreign checkouts are not collected", (dir) => {
		expect(vitestConfig.test?.exclude).toContain(`${dir}/**`);
	});

	it.each(
		SCAN_EXCLUDED_DIRS,
	)("biome excludes %s/ so the scan cannot leave the repo", (dir) => {
		expect(biome.files.includes).toContain(`!${dir}`);
	});

	// The load-bearing premise of every exclude above is that these dirs hold NO
	// TRACKED SOURCE — they are gitignored scratch space. If that ever stops being
	// true (someone starts tracking files under .tmp/), the excludes turn from
	// "skip the noise" into "silently skip real code": those files would be
	// neither tested nor linted, and nothing would say so. The excludes are only safe
	// BECAUSE of .gitignore, so assert the thing they depend on.
	it.each(
		SCAN_EXCLUDED_DIRS,
	)("%s/ is gitignored — which is the only reason excluding it is safe", (dir) => {
		const gitignore = readFileSync(join(repoRoot, ".gitignore"), "utf8")
			.split("\n")
			.map((line) => line.trim());

		expect(
			gitignore,
			`${dir}/ is excluded from vitest + biome but is NOT gitignored — tracked source ` +
				`under it would be silently unlinted and untested. Either gitignore it, or stop ` +
				`excluding it from the scanners.`,
		).toContain(`${dir}/`);
	});

	// The assertions above are string-matching on config. They prove `!.agents` is
	// PRESENT; they cannot prove it WORKS — biome's `files.includes` glob semantics
	// changed in 2.0, so a bare `!.agents` silently ceasing to match on some future
	// upgrade would leave every assertion above green while lint walked out of the
	// repo again. So drive the real thing: build a throwaway project from THIS
	// repo's actual biome.json, point a link at an outside dir, and check whether
	// biome follows it. The control run (same fixture, `!.agents` stripped) must
	// fail to be excluded — otherwise this test would pass for the wrong reason and
	// prove nothing.
	const LINKED_FILE = "linked-fixture.ts";
	const OWN_FILE = "own-fixture.ts";
	// Deliberately mis-formatted: `biome check` always runs the formatter, so this
	// is a diagnostic that does not depend on any lint rule staying enabled.
	const VIOLATING = "const    x   =    1\n";
	const biomeBin = join(repoRoot, "node_modules", ".bin", "biome");
	const tempDirs: string[] = [];

	afterAll(() => {
		for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
	});

	function runBiomeOnProjectWith(includes: string[]): string {
		const project = mkdtempSync(join(tmpdir(), "dev6206-project-"));
		const outside = mkdtempSync(join(tmpdir(), "dev6206-outside-"));
		tempDirs.push(project, outside);

		// The "other checkout" the link farm points into.
		writeFileSync(join(outside, LINKED_FILE), VIOLATING);
		// A file the project genuinely owns, so we can tell "biome excluded the link"
		// apart from "biome scanned nothing at all".
		writeFileSync(join(project, OWN_FILE), VIOLATING);
		writeFileSync(
			join(project, "biome.json"),
			JSON.stringify({ files: { includes } }),
		);
		mkdirSync(join(project, ".agents"));
		symlinkSync(outside, join(project, ".agents", "skills"), "dir");

		// spawnSync, not execFileSync, for two reasons (DEV-6206 cycle-1 review):
		//
		// 1. Biome writes its diagnostics to STDERR. execFileSync's return value is
		//    stdout only, so its success path returned the one stream that never
		//    carries what we assert on — silently, since the fixture always exits
		//    non-zero and took the catch path instead. spawnSync hands back both.
		// 2. Without an explicit stdio, biome's diagnostics echo through to the
		//    parent's stderr, printing red "× Formatter would have printed…" lines
		//    in the middle of a PASSING suite. `pipe` captures them instead.
		//
		// Biome exits non-zero whenever it reports diagnostics, which is the
		// expected path here — we assert on the output, never the exit code.
		const result = spawnSync(biomeBin, ["check", "."], {
			cwd: project,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return `${result.stdout ?? ""}${result.stderr ?? ""}`;
	}

	it("biome really stops at an excluded link dir instead of following it out of the repo", () => {
		const output = runBiomeOnProjectWith(biome.files.includes);

		expect(
			output,
			"biome reported nothing for the project's own file, so this run proves " +
				"nothing about the exclusion — the fixture or the biome binary is broken.",
		).toContain(OWN_FILE);
		expect(
			output,
			`biome followed the .agents/ link out of the project and linted ${LINKED_FILE}. ` +
				"The `!.agents` entry in biome.json is present but no longer effective — most " +
				"likely biome's files.includes glob semantics changed (DEV-6206).",
		).not.toContain(LINKED_FILE);
	});

	it("control: without the !.agents exclude, biome does follow the link out (so the test above is not vacuous)", () => {
		const output = runBiomeOnProjectWith(
			biome.files.includes.filter((pattern) => pattern !== "!.agents"),
		);

		expect(
			output,
			"biome did NOT follow a symlink out of an UNexcluded dir. If biome has stopped " +
				"following symlinks entirely, the exclusion is no longer what keeps the scan " +
				"inside the repo, and the test above no longer proves anything — re-derive the " +
				"guard rather than deleting this control.",
		).toContain(LINKED_FILE);
	});

	it("keeps excluding dist/ and node_modules/ from vitest", () => {
		// Vitest's `exclude` REPLACES its defaults rather than extending them, so
		// these have to stay listed explicitly — dropping one while adding .tmp
		// would silently start collecting built output.
		expect(vitestConfig.test?.exclude).toEqual(
			expect.arrayContaining(["dist/**", "node_modules/**"]),
		);
	});
});
