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
