import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../../__tests__/test-helpers.js";

const mockResolveIssueId = vi.fn();
const mockRawRequest = vi.fn();
const mockOutputSuccess = vi.fn();

vi.mock("../../utils/graphql-issues-service.js", () => ({
	GraphQLIssuesService: class {},
}));

vi.mock("../../utils/graphql-service.js", () => ({
	createGraphQLService: vi.fn().mockReturnValue({
		rawRequest: (...args: unknown[]) => mockRawRequest(...args),
	}),
}));

vi.mock("../../utils/linear-service.js", () => ({
	createLinearService: vi.fn().mockReturnValue({
		resolveIssueId: (...args: unknown[]) => mockResolveIssueId(...args),
	}),
}));

vi.mock("../../utils/auth.js", () => ({
	getApiToken: vi.fn().mockReturnValue("test-token"),
}));

vi.mock("../../utils/output.js", () => ({
	outputSuccess: (...args: unknown[]) => mockOutputSuccess(...args),
	handleAsyncCommand:
		(fn: (...args: unknown[]) => unknown) =>
		(...args: unknown[]) =>
			fn(...args),
}));

const { setupTreeCommand } = await import("./tree.js");

function setupProgram() {
	const program = createTestProgram();
	const issues = program.command("issues");
	setupTreeCommand(issues);
	return program;
}

describe("issues tree (DEV-4480)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves the issue ID and emits the nested envelope by default", async () => {
		mockResolveIssueId.mockResolvedValue("uuid-1");
		const issueNode = {
			id: "uuid-1",
			identifier: "DEV-1",
			title: "Root",
			state: { id: "s", name: "Todo", type: "unstarted" },
			assignee: null,
			priority: null,
			children: { nodes: [] },
		};
		mockRawRequest.mockResolvedValue({ issue: issueNode });

		const program = setupProgram();
		await runCommand(program, ["issues", "tree", "DEV-1"]);

		expect(mockResolveIssueId).toHaveBeenCalledWith("DEV-1");
		// One GraphQL call, with the resolved UUID.
		expect(mockRawRequest).toHaveBeenCalledTimes(1);
		expect(mockRawRequest).toHaveBeenCalledWith(
			expect.stringContaining("GetIssueTree"),
			{ id: "uuid-1" },
		);
		expect(mockOutputSuccess).toHaveBeenCalledWith(issueNode);
	});

	it("scales the query string with --depth", async () => {
		mockResolveIssueId.mockResolvedValue("uuid-1");
		mockRawRequest.mockResolvedValue({
			issue: {
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Root",
				state: null,
				assignee: null,
				priority: null,
				children: { nodes: [] },
			},
		});

		const program = setupProgram();
		await runCommand(program, ["issues", "tree", "DEV-1", "--depth", "5"]);

		const query = (mockRawRequest.mock.calls[0][0] as string) ?? "";
		expect((query.match(/children\s*{/g) ?? []).length).toBe(5);
	});

	it("rejects --depth outside [1, 5]", async () => {
		mockResolveIssueId.mockResolvedValue("uuid-1");

		const program = setupProgram();
		await expect(
			runCommand(program, ["issues", "tree", "DEV-1", "--depth", "10"]),
		).rejects.toThrow(/--depth must be an integer in \[1, 5\]/);
		// Fail fast — no GraphQL call attempted.
		expect(mockRawRequest).not.toHaveBeenCalled();
	});

	it("throws notFoundError when the issue is missing", async () => {
		mockResolveIssueId.mockResolvedValue("uuid-1");
		mockRawRequest.mockResolvedValue({ issue: null });

		const program = setupProgram();
		await expect(
			runCommand(program, ["issues", "tree", "DEV-99"]),
		).rejects.toThrow(/not found/);
	});

	it("prunes terminal-state children when --no-include-closed is passed", async () => {
		mockResolveIssueId.mockResolvedValue("uuid-1");
		mockRawRequest.mockResolvedValue({
			issue: {
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Root",
				state: { id: "s", name: "In Progress", type: "started" },
				assignee: null,
				priority: null,
				children: {
					nodes: [
						{
							id: "uuid-2",
							identifier: "DEV-2",
							title: "Alive",
							state: { id: "s2", name: "Todo", type: "unstarted" },
							assignee: null,
							priority: null,
							children: { nodes: [] },
						},
						{
							id: "uuid-3",
							identifier: "DEV-3",
							title: "Done",
							state: { id: "s3", name: "Done", type: "completed" },
							assignee: null,
							priority: null,
							children: { nodes: [] },
						},
					],
				},
			},
		});

		const program = setupProgram();
		await runCommand(program, [
			"issues",
			"tree",
			"DEV-1",
			"--no-include-closed",
		]);

		const emitted = mockOutputSuccess.mock.calls[0][0];
		expect(emitted.children.nodes).toHaveLength(1);
		expect(emitted.children.nodes[0].identifier).toBe("DEV-2");
	});

	it("includes terminal-state branches by default", async () => {
		mockResolveIssueId.mockResolvedValue("uuid-1");
		const tree = {
			id: "uuid-1",
			identifier: "DEV-1",
			title: "Root",
			state: null,
			assignee: null,
			priority: null,
			children: {
				nodes: [
					{
						id: "uuid-2",
						identifier: "DEV-2",
						title: "Done",
						state: { id: "s", name: "Done", type: "completed" },
						assignee: null,
						priority: null,
						children: { nodes: [] },
					},
				],
			},
		};
		mockRawRequest.mockResolvedValue({ issue: tree });

		const program = setupProgram();
		await runCommand(program, ["issues", "tree", "DEV-1"]);

		const emitted = mockOutputSuccess.mock.calls[0][0];
		expect(emitted.children.nodes).toHaveLength(1);
		expect(emitted.children.nodes[0].state.type).toBe("completed");
	});
});
