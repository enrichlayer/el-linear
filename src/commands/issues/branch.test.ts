import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	currentGitBranch,
	extractIssueIdentifierFromBranch,
	getBranchLinearIssue,
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
});
