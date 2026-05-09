import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockGetLabels = vi.fn();
const mockService = {
	getLabels: mockGetLabels,
};
const mockCreateLinearService = vi.fn().mockReturnValue(mockService);

const mockRawRequest = vi.fn();
const mockGraphQLService = {
	rawRequest: mockRawRequest,
};
const mockCreateGraphQLService = vi.fn().mockReturnValue(mockGraphQLService);

const mockOutputSuccess = vi.fn();
const mockResolveTeam = vi.fn().mockImplementation((v: string) => v);

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: mockCreateLinearService,
}));

vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: mockCreateGraphQLService,
}));

vi.mock("../utils/output.js", async () => ({
	handleAsyncCommand: (await import("../__tests__/test-helpers.js"))
		.passthroughHandleAsyncCommand,
	outputSuccess: mockOutputSuccess,
}));

vi.mock("../config/resolver.js", () => ({
	resolveTeam: mockResolveTeam,
}));

// Pass-through cache; cache semantics covered in disk-cache.test.ts.
vi.mock("../utils/disk-cache.js", () => ({
	cached: <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) =>
		fetcher(),
	resolveCacheTTL: () => 0,
}));

vi.mock("../config/config.js", () => ({
	loadConfig: () => ({}),
}));

const { setupLabelsCommands } = await import("./labels.js");

describe("labels", () => {
	let program: Command;

	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveTeam.mockImplementation((v: string) => v);
		program = createTestProgram();
		setupLabelsCommands(program);
	});

	describe("list", () => {
		it("calls getLabels with no team filter", async () => {
			mockGetLabels.mockResolvedValue({ labels: [] });
			await runCommand(program, ["labels", "list"]);
			expect(mockGetLabels).toHaveBeenCalledWith(undefined, 100, undefined);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [],
				meta: { count: 0 },
			});
		});

		it("calls getLabels with team filter resolved", async () => {
			mockResolveTeam.mockReturnValue("team-uuid-456");
			mockGetLabels.mockResolvedValue({
				labels: [{ id: "lbl-1", name: "Bug" }],
			});
			await runCommand(program, ["labels", "list", "--team", "ENG"]);
			expect(mockResolveTeam).toHaveBeenCalledWith("ENG");
			expect(mockGetLabels).toHaveBeenCalledWith(
				"team-uuid-456",
				100,
				undefined,
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [{ id: "lbl-1", name: "Bug" }],
				meta: { count: 1 },
			});
		});

		it("passes --name as third arg", async () => {
			mockGetLabels.mockResolvedValue({ labels: [] });
			await runCommand(program, ["labels", "list", "--name", "chore"]);
			expect(mockGetLabels).toHaveBeenCalledWith(undefined, 100, "chore");
		});
	});

	describe("create", () => {
		it("creates label with name and team", async () => {
			mockRawRequest.mockResolvedValue({
				issueLabelCreate: {
					success: true,
					issueLabel: { id: "lbl-new", name: "Feature" },
				},
			});
			await runCommand(program, [
				"labels",
				"create",
				"Feature",
				"--team",
				"ENG",
			]);
			expect(mockResolveTeam).toHaveBeenCalledWith("ENG");
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					input: expect.objectContaining({ name: "Feature", teamId: "ENG" }),
				}),
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				id: "lbl-new",
				name: "Feature",
			});
		});

		it("includes parent label when --parent specified", async () => {
			mockRawRequest
				.mockResolvedValueOnce({
					issueLabels: { nodes: [{ id: "parent-lbl-id", name: "Category" }] },
				})
				.mockResolvedValueOnce({
					issueLabelCreate: {
						success: true,
						issueLabel: { id: "lbl-child", name: "SubFeature" },
					},
				});
			await runCommand(program, [
				"labels",
				"create",
				"SubFeature",
				"--team",
				"ENG",
				"--parent",
				"Category",
			]);
			// First call: find parent label
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ name: "Category", teamId: "ENG" }),
			);
			// Second call: create with parentId
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					input: expect.objectContaining({
						name: "SubFeature",
						teamId: "ENG",
						parentId: "parent-lbl-id",
					}),
				}),
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				id: "lbl-child",
				name: "SubFeature",
			});
		});
	});

	describe("retire", () => {
		it("calls retire mutation", async () => {
			mockRawRequest.mockResolvedValue({
				issueLabelRetire: {
					success: true,
					issueLabel: { id: "lbl-123", name: "Retired" },
				},
			});
			await runCommand(program, ["labels", "retire", "lbl-123"]);
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ id: "lbl-123" }),
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				id: "lbl-123",
				name: "Retired",
			});
		});
	});

	describe("restore", () => {
		it("calls restore mutation", async () => {
			mockRawRequest.mockResolvedValue({
				issueLabelRestore: {
					success: true,
					issueLabel: { id: "lbl-456", name: "Restored" },
				},
			});
			await runCommand(program, ["labels", "restore", "lbl-456"]);
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ id: "lbl-456" }),
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				id: "lbl-456",
				name: "Restored",
			});
		});
	});
});
