import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockSpawnSync = vi.fn();
vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

const mockRawRequest = vi.fn();
vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: vi.fn().mockReturnValue({ rawRequest: mockRawRequest }),
}));

const mockOutputSuccess = vi.fn();
vi.mock("../utils/output.js", async () => ({
	handleAsyncCommand: (await import("../__tests__/test-helpers.js"))
		.passthroughHandleAsyncCommand,
	outputSuccess: mockOutputSuccess,
}));

const { parseBranchName, setupIssueIdCommand } = await import("./issue-id.js");

describe("parseBranchName", () => {
	it("parses feature/DEV-123-slug branch", () => {
		expect(parseBranchName("feature/DEV-123-add-thing")).toEqual({
			branch: "feature/DEV-123-add-thing",
			issueId: "DEV-123",
			team: "DEV",
			number: 123,
			slug: "add-thing",
		});
	});

	it("parses fix-ALL-9 branch (hyphen separator)", () => {
		expect(parseBranchName("fix-ALL-9")).toEqual({
			branch: "fix-ALL-9",
			issueId: "ALL-9",
			team: "ALL",
			number: 9,
			slug: null,
		});
	});

	it("normalizes lowercase team key", () => {
		expect(parseBranchName("feature/dev-50-thing").team).toBe("DEV");
		expect(parseBranchName("feature/dev-50-thing").issueId).toBe("DEV-50");
	});

	it("supports chore/refactor/dev prefixes", () => {
		expect(parseBranchName("chore/CORE-1").issueId).toBe("CORE-1");
		expect(parseBranchName("refactor/QA-2-cleanup").issueId).toBe("QA-2");
		expect(parseBranchName("dev/FE-3").issueId).toBe("FE-3");
	});

	it("parses Codex-authored branches (codex/<TEAM>-<N>-slug) — DEV-4660", () => {
		// Codex creates branches like `codex/ALL-973-slug` rather than
		// `feature/ALL-973-slug`. Pre-fix this returned issueId: null,
		// breaking every skill that calls `el-linear issue-id` (commit-guard,
		// glab-commit-push-mr, stray-file-triage, git-branch-from-linear).
		// Mirrors tools-repo DEV-4417 (cli/el-git/src/commands/context.ts).
		expect(parseBranchName("codex/ALL-973-wire-extractor")).toEqual({
			branch: "codex/ALL-973-wire-extractor",
			issueId: "ALL-973",
			team: "ALL",
			number: 973,
			slug: "wire-extractor",
		});
	});

	it("parses Codex branches across team prefixes (DEV-4660)", () => {
		expect(parseBranchName("codex/DEV-4660-add-codex-prefix").issueId).toBe(
			"DEV-4660",
		);
		expect(parseBranchName("codex/CS-42-bug-fix").issueId).toBe("CS-42");
		expect(parseBranchName("codex/FE-718-mobile-carousel").issueId).toBe(
			"FE-718",
		);
	});

	it("rejects a bare codex/ branch with no Linear ID (DEV-4660)", () => {
		// A `codex/` prefix without a traceable `<TEAM>-<N>` must still be
		// rejected — the whole point of the guard is to ensure every branch
		// carries an issue reference.
		expect(parseBranchName("codex/some-random-slug")).toEqual({
			branch: "codex/some-random-slug",
			issueId: null,
			team: null,
			number: null,
			slug: null,
		});
	});

	it("parses bug/<TEAM>-<N>-slug branches (DEV-4777)", () => {
		// `bug` is a sanctioned Linear type label; a `bug/DEV-4773-slug`
		// branch must surface its issue ID for commit guards and MR description
		// generation the same way `feature/` and `codex/` do.
		// Mirrors tools-repo DEV-4774 (el-git context + check-readiness +
		// check-linear-branch.sh).
		expect(parseBranchName("bug/DEV-4773-slug")).toEqual({
			branch: "bug/DEV-4773-slug",
			issueId: "DEV-4773",
			team: "DEV",
			number: 4773,
			slug: "slug",
		});
		expect(parseBranchName("bug/CS-42-stale-cache").issueId).toBe("CS-42");
	});

	it("parses spike/<TEAM>-<N>-slug branches (DEV-4777)", () => {
		// `spike` is a sanctioned Linear type label for time-boxed
		// investigation branches; same first-class treatment as `bug`.
		expect(parseBranchName("spike/DEV-100-evaluate-options")).toEqual({
			branch: "spike/DEV-100-evaluate-options",
			issueId: "DEV-100",
			team: "DEV",
			number: 100,
			slug: "evaluate-options",
		});
		expect(parseBranchName("spike/ALL-7-perf").issueId).toBe("ALL-7");
	});

	it("parses feat/<TEAM>-<N>-slug branches, same as feature/ (DEV-5342)", () => {
		// `feat` is the short-form alias for `feature`, already in use on
		// several branches; it must surface its issue ID the same way
		// `feature/` does. Mirrors tools-repo DEV-5334 (el-git branch-types
		// allowlist + check-linear-branch.sh).
		expect(parseBranchName("feat/DEV-5342-branch-re-feat-prefix")).toEqual({
			branch: "feat/DEV-5342-branch-re-feat-prefix",
			issueId: "DEV-5342",
			team: "DEV",
			number: 5342,
			slug: "branch-re-feat-prefix",
		});
		expect(parseBranchName("feat/ALL-7-thing").issueId).toBe("ALL-7");
		// `feature/` still parses — the alias doesn't shadow the long form.
		expect(parseBranchName("feature/DEV-1-x").issueId).toBe("DEV-1");
	});

	it("rejects team keys longer than 4 chars (regex limit)", () => {
		expect(parseBranchName("feature/INFRA-1").issueId).toBeNull();
	});

	it("returns null fields when branch has no recognizable issue id", () => {
		expect(parseBranchName("main")).toEqual({
			branch: "main",
			issueId: null,
			team: null,
			number: null,
			slug: null,
		});
	});

	it("returns null fields when prefix is unknown", () => {
		expect(parseBranchName("yury/test-DEV-1")).toEqual({
			branch: "yury/test-DEV-1",
			issueId: null,
			team: null,
			number: null,
			slug: null,
		});
	});
});

describe("issue-id command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		suppressExit();
	});

	it("uses provided branch arg, no --fetch — emits parsed only", async () => {
		const program = createTestProgram();
		setupIssueIdCommand(program);
		await runCommand(program, ["issue-id", "feature/DEV-100-thing"]);

		expect(mockOutputSuccess).toHaveBeenCalledWith({
			branch: "feature/DEV-100-thing",
			issueId: "DEV-100",
			team: "DEV",
			number: 100,
			slug: "thing",
		});
		expect(mockSpawnSync).not.toHaveBeenCalled();
		expect(mockRawRequest).not.toHaveBeenCalled();
	});

	it("falls back to current branch via git when no arg given", async () => {
		mockSpawnSync.mockReturnValue({
			status: 0,
			stdout: "feature/DEV-77-x\n",
			stderr: "",
		});

		const program = createTestProgram();
		setupIssueIdCommand(program);
		await runCommand(program, ["issue-id"]);

		expect(mockSpawnSync).toHaveBeenCalledWith(
			"git",
			["rev-parse", "--abbrev-ref", "HEAD"],
			expect.objectContaining({ encoding: "utf8" }),
		);
		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ issueId: "DEV-77" }),
		);
	});

	it("throws when git rev-parse fails", async () => {
		mockSpawnSync.mockReturnValue({
			status: 128,
			stdout: "",
			stderr: "fatal: not a git repository\n",
		});

		const program = createTestProgram();
		setupIssueIdCommand(program);
		await expect(runCommand(program, ["issue-id"])).rejects.toThrow(
			/git rev-parse failed.*not a git repository/i,
		);
	});

	it("with --fetch: queries Linear with the parsed identifier and includes the issue", async () => {
		mockRawRequest.mockResolvedValue({
			issue: {
				id: "uuid-1",
				identifier: "DEV-100",
				title: "T",
				description: "D",
				branchName: "feature/DEV-100-x",
				state: { name: "In Progress", type: "started" },
				assignee: { id: "u1", name: "Alice", email: "a@x.com" },
			},
		});

		const program = createTestProgram();
		setupIssueIdCommand(program);
		await runCommand(program, ["issue-id", "feature/DEV-100-x", "--fetch"]);

		expect(mockRawRequest).toHaveBeenCalledWith(
			expect.stringContaining("IssueByIdentifier"),
			{ id: "DEV-100" },
		);
		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({
				issueId: "DEV-100",
				issue: expect.objectContaining({
					identifier: "DEV-100",
					title: "T",
				}),
			}),
		);
	});

	it("with --fetch on a no-match branch: skips API call, returns parsed", async () => {
		const program = createTestProgram();
		setupIssueIdCommand(program);
		await runCommand(program, ["issue-id", "main", "--fetch"]);

		expect(mockRawRequest).not.toHaveBeenCalled();
		expect(mockOutputSuccess).toHaveBeenCalledWith({
			branch: "main",
			issueId: null,
			team: null,
			number: null,
			slug: null,
		});
	});

	it("with --fetch when issue is missing in Linear: passes issue: null", async () => {
		mockRawRequest.mockResolvedValue({ issue: undefined });

		const program = createTestProgram();
		setupIssueIdCommand(program);
		await runCommand(program, [
			"issue-id",
			"feature/DEV-999-missing",
			"--fetch",
		]);

		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({
				issueId: "DEV-999",
				issue: null,
			}),
		);
	});
});
