import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	currentGitBranch,
	currentJjBookmark,
	extractIssueIdentifierFromBranch,
	getBranchLinearIssue,
	gitCheckoutBranch,
	setBranchLinearIssue,
	toBranchName,
} from "./branch.js";

describe("toBranchName", () => {
	it("uppercases the team key and applies the default prefix", () => {
		expect(toBranchName("dev-3549-add-thing")).toBe(
			"feature/DEV-3549-add-thing",
		);
	});

	it("honors a custom prefix", () => {
		expect(toBranchName("dev-1-x", "")).toBe("DEV-1-x");
	});

	it("passes through names that don't match the Linear shape", () => {
		expect(toBranchName("hotfix")).toBe("feature/hotfix");
	});
});

describe("extractIssueIdentifierFromBranch", () => {
	it("extracts from the bare Linear shape", () => {
		expect(extractIssueIdentifierFromBranch("dev-4293-slug")).toBe("DEV-4293");
	});

	it("extracts from a prefixed branch", () => {
		expect(extractIssueIdentifierFromBranch("feature/DEV-4293-slug")).toBe(
			"DEV-4293",
		);
	});

	it("extracts from a bare identifier and a URL", () => {
		expect(extractIssueIdentifierFromBranch("DEV-123")).toBe("DEV-123");
		expect(
			extractIssueIdentifierFromBranch(
				"https://linear.app/acme/issue/FE-630/some-slug",
			),
		).toBe("FE-630");
	});

	it("normalizes case and handles non-DEV team keys", () => {
		expect(extractIssueIdentifierFromBranch("emw-280-fix")).toBe("EMW-280");
	});

	it("returns the first identifier when several appear", () => {
		expect(extractIssueIdentifierFromBranch("dev-1-then-dev-2")).toBe("DEV-1");
	});

	it("returns null when there is no identifier token", () => {
		expect(extractIssueIdentifierFromBranch("main")).toBeNull();
		expect(extractIssueIdentifierFromBranch("release/v1.2.3")).toBeNull();
	});

	it("respects the trailing boundary (DEV-1x is not DEV-1)", () => {
		// A trailing letter/digit glued to the number means it isn't an
		// identifier token. (A *leading* run of letters is indistinguishable
		// from an unusual team key — `xDEV-1` legitimately reads as team
		// "XDEV" — so only the trailing boundary is enforced.)
		expect(extractIssueIdentifierFromBranch("DEV-1x")).toBeNull();
		expect(extractIssueIdentifierFromBranch("DEV-12345y")).toBeNull();
	});
});

// These exercise the real `git config` round-trip against a throwaway repo —
// the marker is git metadata, so mocking execFileSync would test nothing real.
describe("branch.<branch>.linearIssue marker (DEV-4293)", () => {
	let repo: string;
	let cwd: string;

	beforeEach(() => {
		cwd = process.cwd();
		repo = mkdtempSync(join(tmpdir(), "branch-marker-"));
		process.chdir(repo);
		execFileSync("git", ["init", "-q", "-b", "dev-4293-marker-test"], {
			stdio: "pipe",
		});
		// Identity so any future commit-based assertions won't fail; not needed
		// for config reads/writes but cheap and keeps the repo well-formed.
		execFileSync("git", ["config", "user.email", "t@example.com"], {
			stdio: "pipe",
		});
		execFileSync("git", ["config", "user.name", "Test"], { stdio: "pipe" });
	});

	afterEach(() => {
		process.chdir(cwd);
		rmSync(repo, { recursive: true, force: true });
	});

	it("currentGitBranch reports the checked-out branch", () => {
		expect(currentGitBranch()).toBe("dev-4293-marker-test");
	});

	it("getBranchLinearIssue returns null before the marker is set", () => {
		expect(getBranchLinearIssue("dev-4293-marker-test")).toBeNull();
	});

	it("setBranchLinearIssue then getBranchLinearIssue round-trips", () => {
		setBranchLinearIssue("dev-4293-marker-test", "DEV-4293");
		expect(getBranchLinearIssue("dev-4293-marker-test")).toBe("DEV-4293");
	});

	it("overwrites a previous marker value", () => {
		setBranchLinearIssue("dev-4293-marker-test", "DEV-1");
		setBranchLinearIssue("dev-4293-marker-test", "DEV-2");
		expect(getBranchLinearIssue("dev-4293-marker-test")).toBe("DEV-2");
	});

	it("scopes the marker to the named branch", () => {
		setBranchLinearIssue("dev-4293-marker-test", "DEV-4293");
		expect(getBranchLinearIssue("some-other-branch")).toBeNull();
	});

	it("gitCheckoutBranch returns true and creates the branch when in a repo", () => {
		expect(gitCheckoutBranch("feature/DEV-1-some-work")).toBe(true);
		expect(currentGitBranch()).toBe("feature/DEV-1-some-work");
	});
});

// gitCheckoutBranch's false return (skip) gates the marker write in
// `issues create --checkout` so it doesn't emit a contradictory second
// warning outside a repo (DEV-4293 cycle-1).
describe("gitCheckoutBranch outside a git repo", () => {
	let dir: string;
	let cwd: string;

	beforeEach(() => {
		cwd = process.cwd();
		dir = mkdtempSync(join(tmpdir(), "not-a-repo-"));
		process.chdir(dir);
	});

	afterEach(() => {
		process.chdir(cwd);
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns false and does not throw", () => {
		// A bare mkdtemp dir is not a git work tree, so the checkout is skipped.
		expect(gitCheckoutBranch("feature/DEV-1-x")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// DEV-8479 -- the jj bookmark fallback.
//
// In a colocated jj repo `.git/HEAD` points at `@`'s PARENT, so git reports a
// detached HEAD and `currentGitBranch()` returns null while a bookmark names
// the work perfectly well. These legs drive a REAL colocated repo through the
// real binary: all three rungs are revset semantics, which is exactly what a
// stubbed `jj` could not check.
// ---------------------------------------------------------------------------
const JJ_AVAILABLE = (() => {
	try {
		execFileSync("jj", ["--version"], { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
})();

describe.skipIf(!JJ_AVAILABLE)("currentJjBookmark (DEV-8479)", () => {
	let repo: string;
	let priorCwd: string;
	let priorJjConfig: string | undefined;

	/** Run a command in the fixture repo, failing loudly rather than silently. */
	function run(bin: string, ...args: string[]): void {
		execFileSync(bin, args, { stdio: "pipe" });
	}

	beforeEach(() => {
		priorCwd = process.cwd();
		repo = mkdtempSync(join(tmpdir(), "jj-bookmark-"));
		process.chdir(repo);

		// jj refuses to create a commit without an identity, and the developer's
		// own ~/.jjconfig must not get a say in what these legs measure.
		const config = join(repo, "jj-config.toml");
		writeFileSync(
			config,
			'[user]\nname = "EL Linear Test"\nemail = "test@example.com"\n',
		);
		priorJjConfig = process.env.JJ_CONFIG;
		process.env.JJ_CONFIG = config;

		run("git", "init", "-q", "-b", "main");
		run("git", "config", "user.email", "test@example.com");
		run("git", "config", "user.name", "EL Linear Test");
		writeFileSync(join(repo, "seed.txt"), "seed\n");
		run("git", "add", "-A");
		run("git", "commit", "-q", "-m", "DEV-8479: seed");
		run("jj", "git", "init", "--colocate");

		// Model a PILOT CLONE, not a colocated `git init`.
		//
		// `--colocate` converts git's local `main` branch into a jj local
		// BOOKMARK, and the revset `bookmarks()` is local-only -- so it matches
		// that commit, and since everything here descends from it, rung 2 would
		// answer "main" for every leg below. A real pilot clone is cloned
		// single-branch: trunk is a REMOTE bookmark (`main@origin`), which
		// `bookmarks()` does not match. Forgetting the local one is what makes
		// this fixture the shape the resolver actually ships against -- and it is
		// the reason rung 3 is reachable in the pilot at all.
		run("jj", "bookmark", "forget", "main");
	});

	afterEach(() => {
		process.chdir(priorCwd);
		if (priorJjConfig === undefined) {
			delete process.env.JJ_CONFIG;
		} else {
			process.env.JJ_CONFIG = priorJjConfig;
		}
		rmSync(repo, { recursive: true, force: true });
	});

	it("returns null when no bookmark names the work", () => {
		expect(currentJjBookmark()).toBeNull();
	});

	/** Rung 1 -- a bookmark sitting on the working-copy commit itself. */
	it("finds a bookmark on @", () => {
		run("jj", "bookmark", "create", "feature/DEV-8479-x", "-r", "@");
		expect(currentJjBookmark()).toBe("feature/DEV-8479-x");
	});

	/** Rung 2 -- `@` has moved on and the bookmark is behind it in the ancestry. */
	it("finds the nearest bookmark in @'s ancestry once @ has moved on", () => {
		run("jj", "bookmark", "create", "feature/DEV-8479-y", "-r", "@");
		run("jj", "new");
		expect(currentJjBookmark()).toBe("feature/DEV-8479-y");
	});

	/**
	 * Rung 3 -- THE CASE THE ORIGINAL DESIGN MISSED.
	 *
	 * `jj new @-` puts `@` on a SIBLING of the bookmarked commit: both are
	 * children of one parent, so the bookmark is neither on `@` nor an ancestor
	 * of it and rungs 1 and 2 both come back empty. This is the shape jj's own
	 * recommended conflict-resolution flow leaves behind, which is why the ladder
	 * has a third rung at all rather than stopping at ancestry.
	 */
	it("finds a sibling bookmark on the same stack (the conflict-resolution shape)", () => {
		run("jj", "bookmark", "create", "feature/DEV-8479-z", "-r", "@");
		run("jj", "new", "@-");
		// Pin the fixture: were ANY bookmark still an ancestor -- the sibling's,
		// or a local `main` the beforeEach forgot to forget -- this leg would pass
		// via rung 2 and prove nothing whatsoever about rung 3.
		const viaAncestry = execFileSync(
			"jj",
			[
				"log",
				"-r",
				"heads(bookmarks() & ::@)",
				"--no-graph",
				"-T",
				'local_bookmarks ++ "\\n"',
			],
			{ stdio: "pipe" },
		)
			.toString()
			.trim();
		expect(viaAncestry).toBe("");
		expect(currentJjBookmark()).toBe("feature/DEV-8479-z");
	});

	/**
	 * Two bookmarks on one commit give no basis for choosing, and `mark-branch`
	 * would write its marker under whichever happened to sort first. Null is the
	 * honest answer, and the caller already fails loudly on it.
	 */
	it("returns null rather than guessing when a rung is ambiguous", () => {
		run("jj", "bookmark", "create", "feature/DEV-8479-a", "-r", "@");
		run("jj", "bookmark", "create", "feature/DEV-8479-b", "-r", "@");
		expect(currentJjBookmark()).toBeNull();
	});

	/**
	 * The premise of the whole issue, asserted rather than assumed: git really
	 * does lose the name here. If that ever stops being true the fallback is
	 * unnecessary, and this is the leg that would say so.
	 */
	it("covers exactly the case git cannot -- a detached HEAD", () => {
		run("jj", "bookmark", "create", "feature/DEV-8479-c", "-r", "@");
		run("jj", "new");
		expect(currentGitBranch()).toBeNull();
		expect(currentJjBookmark()).toBe("feature/DEV-8479-c");
	});
});
