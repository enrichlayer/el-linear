import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockRawRequest = vi.fn();
const mockGraphQLService = {
	rawRequest: mockRawRequest,
};
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

const { setupTemplatesCommands } = await import("./templates.js");

const MOCK_TEMPLATE = {
	id: "tmpl-1",
	name: "Bug Report",
	type: "issue",
	description: "Standard bug report",
	templateData: { title: "Bug: " },
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-02-01T00:00:00.000Z",
	team: { id: "team-1", key: "DEV", name: "Dev" },
	creator: { id: "user-1", name: "Alice" },
};

const MOCK_TEMPLATE_2 = {
	id: "tmpl-2",
	name: "Feature Spec",
	type: "document",
	description: null,
	templateData: { content: "" },
	createdAt: "2026-01-15T00:00:00.000Z",
	updatedAt: "2026-02-15T00:00:00.000Z",
	team: null,
	creator: null,
};

describe("templates", () => {
	let program: Command;

	beforeEach(() => {
		vi.clearAllMocks();
		program = createTestProgram();
		setupTemplatesCommands(program);
	});

	describe("list", () => {
		it("lists all templates", async () => {
			mockRawRequest.mockResolvedValue({
				templates: [MOCK_TEMPLATE, MOCK_TEMPLATE_2],
			});
			await runCommand(program, ["templates", "list"]);
			expect(mockRawRequest).toHaveBeenCalledOnce();
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [
					{
						id: "tmpl-1",
						name: "Bug Report",
						type: "issue",
						description: "Standard bug report",
						team: "DEV",
						creator: "Alice",
						updatedAt: "2026-02-01T00:00:00.000Z",
					},
					{
						id: "tmpl-2",
						name: "Feature Spec",
						type: "document",
						description: null,
						team: null,
						creator: null,
						updatedAt: "2026-02-15T00:00:00.000Z",
					},
				],
				meta: { count: 2 },
			});
		});

		it("filters by type", async () => {
			mockRawRequest.mockResolvedValue({
				templates: [MOCK_TEMPLATE, MOCK_TEMPLATE_2],
			});
			await runCommand(program, ["templates", "list", "--type", "issue"]);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [expect.objectContaining({ id: "tmpl-1", type: "issue" })],
				meta: { count: 1 },
			});
		});

		it("filters by type case-insensitively", async () => {
			mockRawRequest.mockResolvedValue({
				templates: [MOCK_TEMPLATE, MOCK_TEMPLATE_2],
			});
			await runCommand(program, ["templates", "list", "--type", "Document"]);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [expect.objectContaining({ id: "tmpl-2", type: "document" })],
				meta: { count: 1 },
			});
		});

		it("returns empty when no templates match filter", async () => {
			mockRawRequest.mockResolvedValue({ templates: [MOCK_TEMPLATE] });
			await runCommand(program, ["templates", "list", "--type", "project"]);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [],
				meta: { count: 0 },
			});
		});
	});

	describe("read", () => {
		it("reads a template by ID", async () => {
			mockRawRequest.mockResolvedValue({ template: MOCK_TEMPLATE });
			await runCommand(program, ["templates", "read", "tmpl-1"]);
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("template(id: $id)"),
				{
					id: "tmpl-1",
				},
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith(MOCK_TEMPLATE);
		});

		it("throws when template not found", async () => {
			mockRawRequest.mockResolvedValue({ template: null });
			await expect(
				runCommand(program, ["templates", "read", "nonexistent"]),
			).rejects.toThrow('Template "nonexistent" not found');
		});
	});
});
