import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockRawRequest = vi.fn();
const mockGraphQLService = { rawRequest: mockRawRequest };
const mockCreateGraphQLService = vi.fn().mockReturnValue(mockGraphQLService);
const mockOutputSuccess = vi.fn();

vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: mockCreateGraphQLService,
}));

vi.mock("../utils/output.js", async () => ({
	handleAsyncCommand: (await import("../__tests__/test-helpers.js"))
		.passthroughHandleAsyncCommand,
	outputSuccess: mockOutputSuccess,
}));

vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
	},
}));

let setupGraphQLCommands: (program: Command) => void;

beforeEach(async () => {
	vi.clearAllMocks();
	const mod = await import("./graphql.js");
	setupGraphQLCommands = mod.setupGraphQLCommands;
});

describe("graphql command", () => {
	it("executes inline query", async () => {
		const program = createTestProgram();
		setupGraphQLCommands(program);

		mockRawRequest.mockResolvedValue({ viewer: { id: "user-1" } });

		await runCommand(program, ["graphql", "{ viewer { id } }"]);

		expect(mockCreateGraphQLService).toHaveBeenCalledWith(
			expect.objectContaining({ apiToken: "test-token" }),
		);
		expect(mockRawRequest).toHaveBeenCalledWith("{ viewer { id } }", undefined);
		expect(mockOutputSuccess).toHaveBeenCalledWith({
			viewer: { id: "user-1" },
		});
	});

	it("reads query from file", async () => {
		const fs = await import("node:fs");
		(fs.default.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
		(fs.default.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
			"{ teams { nodes { id } } }",
		);

		const program = createTestProgram();
		setupGraphQLCommands(program);

		mockRawRequest.mockResolvedValue({ teams: { nodes: [] } });

		await runCommand(program, ["graphql", "--file", "query.graphql"]);

		expect(fs.default.existsSync).toHaveBeenCalledWith("query.graphql");
		expect(fs.default.readFileSync).toHaveBeenCalledWith(
			"query.graphql",
			"utf8",
		);
		expect(mockRawRequest).toHaveBeenCalledWith(
			"{ teams { nodes { id } } }",
			undefined,
		);
	});

	it("passes variables when provided", async () => {
		const program = createTestProgram();
		setupGraphQLCommands(program);

		mockRawRequest.mockResolvedValue({ issue: { id: "issue-1" } });

		await runCommand(program, [
			"graphql",
			"query($id: String!) { issue(id: $id) { id } }",
			"--variables",
			'{"id":"issue-1"}',
		]);

		expect(mockRawRequest).toHaveBeenCalledWith(
			"query($id: String!) { issue(id: $id) { id } }",
			{
				id: "issue-1",
			},
		);
	});

	it("throws when no query and no --file", async () => {
		const program = createTestProgram();
		setupGraphQLCommands(program);

		await expect(runCommand(program, ["graphql"])).rejects.toThrow(
			"Provide a GraphQL query as an argument or via --file",
		);
	});

	it("throws on invalid JSON variables", async () => {
		const program = createTestProgram();
		setupGraphQLCommands(program);

		await expect(
			runCommand(program, [
				"graphql",
				"{ viewer { id } }",
				"--variables",
				"not-json",
			]),
		).rejects.toThrow("Invalid JSON in --variables: not-json");
	});
});
