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
				children: {
					nodes: [
						{
							id: "uuid-2",
							identifier: "DEV-2",
							title: "Alive",
							state: { id: "s2", name: "Todo", type: "unstarted" },
							assignee: null,
							children: { nodes: [] },
						},
						{
							id: "uuid-3",
							identifier: "DEV-3",
							title: "Done",
							state: { id: "s3", name: "Done", type: "completed" },
							assignee: null,
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

	it("prunes duplicate-typed children too under --no-include-closed (DEV-4879)", async () => {
		mockResolveIssueId.mockResolvedValue("uuid-1");
		mockRawRequest.mockResolvedValue({
			issue: {
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Root",
				state: { id: "s", name: "In Progress", type: "started" },
				assignee: null,
				children: {
					nodes: [
						{
							id: "uuid-2",
							identifier: "DEV-2",
							title: "Alive",
							state: { id: "s2", name: "Todo", type: "unstarted" },
							assignee: null,
							children: { nodes: [] },
						},
						{
							id: "uuid-3",
							identifier: "DEV-3",
							title: "Dupe",
							state: { id: "s3", name: "Duplicate", type: "duplicate" },
							assignee: null,
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

		// The duplicate-typed child is pruned just like completed/canceled —
		// tree.ts now shares TERMINAL_STATE_TYPES with list/search.
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
			children: {
				nodes: [
					{
						id: "uuid-2",
						identifier: "DEV-2",
						title: "Done",
						state: { id: "s", name: "Done", type: "completed" },
						assignee: null,
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

	it("--format summary writes ASCII tree to stdout (cycle-1 blocker)", async () => {
		// The cycle-1 blocker: `--format` is a *root-program* option, so the
		// subcommand action's local `options` parameter doesn't see it.
		// Reading from `getRootOpts(command).format` is the correct dispatch.
		// This test would have caught the original bug — `outputSuccess`
		// vs. `process.stdout.write` is observable here.
		mockResolveIssueId.mockResolvedValue("uuid-1");
		mockRawRequest.mockResolvedValue({
			issue: {
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Root",
				state: null,
				assignee: null,
				children: {
					nodes: [
						{
							id: "uuid-2",
							identifier: "DEV-2",
							title: "Child",
							state: null,
							assignee: null,
							children: { nodes: [] },
						},
					],
				},
			},
		});

		const writes: string[] = [];
		const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
			chunk: string | Uint8Array,
		) => {
			writes.push(typeof chunk === "string" ? chunk : chunk.toString());
			return true;
		}) as typeof process.stdout.write);

		try {
			const program = createTestProgram();
			// `--format` is a root-program option in production (declared in
			// main.ts). Mirror that here so the action sees it via getRootOpts.
			program.option("--format <kind>", "json or summary");
			const issues = program.command("issues");
			setupTreeCommand(issues);
			await runCommand(program, [
				"--format",
				"summary",
				"issues",
				"tree",
				"DEV-1",
			]);

			const all = writes.join("");
			// Box-drawing prefix proves formatTree ran; outputSuccess was NOT called.
			expect(all).toContain("DEV-1 Root");
			expect(all).toContain("└── DEV-2 Child");
			expect(mockOutputSuccess).not.toHaveBeenCalled();
		} finally {
			stdoutSpy.mockRestore();
		}
	});

	it("--no-include-closed drops a terminal child's entire subtree (cycle-1 nit)", async () => {
		// A terminal-state PARENT with a non-terminal grandchild — the
		// grandchild should NOT re-emerge under the surviving children
		// (the prune drops the whole subtree, per the docstring).
		mockResolveIssueId.mockResolvedValue("uuid-1");
		mockRawRequest.mockResolvedValue({
			issue: {
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Root",
				state: { id: "s", name: "In Progress", type: "started" },
				assignee: null,
				children: {
					nodes: [
						{
							id: "uuid-2",
							identifier: "DEV-2",
							title: "Alive-Parent",
							state: { id: "s2", name: "Todo", type: "unstarted" },
							assignee: null,
							children: { nodes: [] },
						},
						{
							id: "uuid-3",
							identifier: "DEV-3",
							title: "Done-Parent",
							state: { id: "s3", name: "Done", type: "completed" },
							assignee: null,
							children: {
								nodes: [
									{
										id: "uuid-4",
										identifier: "DEV-4",
										title: "Alive-Grandchild",
										state: {
											id: "s4",
											name: "In Progress",
											type: "started",
										},
										assignee: null,
										children: { nodes: [] },
									},
								],
							},
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
		// DEV-4 (alive grandchild of pruned DEV-3) must NOT reappear at the
		// top level — the prune is subtree-scoped, not per-node.
		const flatIds = JSON.stringify(emitted);
		expect(flatIds).not.toContain("DEV-4");
	});
});
