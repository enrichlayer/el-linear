import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const UPDATE_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// -- Mock function declarations (before vi.mock) --

const mockRawRequest = vi.fn();
const mockGraphQLService = { rawRequest: mockRawRequest };

vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: vi.fn().mockReturnValue(mockGraphQLService),
}));

const mockResolveProjectId = vi.fn();
const mockLinearService = {
	resolveProjectId: mockResolveProjectId,
};

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: vi.fn().mockReturnValue(mockLinearService),
}));

const mockOutputSuccess = vi.fn();
vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return { ...actual, outputSuccess: mockOutputSuccess };
});

vi.mock("../utils/error-messages.js", () => ({
	notFoundError: (entity: string, value: string) =>
		new Error(`${entity} "${value}" not found`),
}));

const { setupProjectUpdatesCommands } = await import("./project-updates.js");

describe("project-updates commands", () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		suppressExit();
		consoleErrorSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	describe("project-updates create", () => {
		it("resolves project and posts an update with body", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");
			const created = { id: "u-new", url: "https://linear.app/x/u-new" };
			mockRawRequest.mockResolvedValue({
				projectUpdateCreate: { success: true, projectUpdate: created },
			});

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, [
				"project-updates",
				"create",
				"--project",
				"My Project",
				"--body",
				"Weekly summary",
			]);

			expect(mockResolveProjectId).toHaveBeenCalledWith("My Project");
			expect(mockRawRequest).toHaveBeenCalledWith(expect.any(String), {
				input: { projectId: "proj-uuid-1", body: "Weekly summary" },
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith(created);
		});

		it("passes a valid --health value into the input", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");
			mockRawRequest.mockResolvedValue({
				projectUpdateCreate: { success: true, projectUpdate: { id: "u" } },
			});

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, [
				"project-updates",
				"create",
				"--project",
				"My Project",
				"--body",
				"On track this week",
				"--health",
				"onTrack",
			]);

			expect(mockRawRequest).toHaveBeenCalledWith(expect.any(String), {
				input: {
					projectId: "proj-uuid-1",
					body: "On track this week",
					health: "onTrack",
				},
			});
		});

		it("rejects an invalid --health value before calling the API", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, [
				"project-updates",
				"create",
				"--project",
				"My Project",
				"--body",
				"x",
				"--health",
				"green",
			]);

			expect(mockRawRequest).not.toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Invalid --health"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("reads the body from --body-file", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");
			mockRawRequest.mockResolvedValue({
				projectUpdateCreate: { success: true, projectUpdate: { id: "u" } },
			});
			const dir = mkdtempSync(join(tmpdir(), "el-linear-pu-"));
			const file = join(dir, "body.md");
			writeFileSync(file, "# From file\nbody");

			try {
				const program = createTestProgram();
				setupProjectUpdatesCommands(program);
				await runCommand(program, [
					"project-updates",
					"create",
					"--project",
					"My Project",
					"--body-file",
					file,
				]);

				expect(mockRawRequest).toHaveBeenCalledWith(expect.any(String), {
					input: { projectId: "proj-uuid-1", body: "# From file\nbody" },
				});
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("errors when neither --body nor --body-file is given", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, [
				"project-updates",
				"create",
				"--project",
				"My Project",
			]);

			expect(mockRawRequest).not.toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Either --body or --body-file is required"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("errors when --body and --body-file are both given", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, [
				"project-updates",
				"create",
				"--project",
				"My Project",
				"--body",
				"inline",
				"--body-file",
				"/tmp/x.md",
			]);

			expect(mockRawRequest).not.toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("mutually exclusive"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("errors when the API reports failure", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");
			mockRawRequest.mockResolvedValue({
				projectUpdateCreate: { success: false, projectUpdate: null },
			});

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, [
				"project-updates",
				"create",
				"--project",
				"My Project",
				"--body",
				"x",
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to create project update"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe("project-updates list", () => {
		it("resolves project and lists updates", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");
			const updates = [{ id: "u1" }, { id: "u2" }];
			mockRawRequest.mockResolvedValue({
				project: { projectUpdates: { nodes: updates } },
			});

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, [
				"project-updates",
				"list",
				"--project",
				"My Project",
			]);

			expect(mockRawRequest).toHaveBeenCalledWith(expect.any(String), {
				projectId: "proj-uuid-1",
				first: 50,
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: updates,
				meta: { count: updates.length },
			});
		});
	});

	describe("project-updates read", () => {
		it("reads an update by ID", async () => {
			const update = { id: UPDATE_UUID, health: "onTrack" };
			mockRawRequest.mockResolvedValue({ projectUpdate: update });

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, ["project-updates", "read", UPDATE_UUID]);

			expect(mockRawRequest).toHaveBeenCalledWith(expect.any(String), {
				id: UPDATE_UUID,
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith(update);
		});

		it("errors when the update is not found", async () => {
			mockRawRequest.mockResolvedValue({ projectUpdate: null });

			const program = createTestProgram();
			setupProjectUpdatesCommands(program);
			await runCommand(program, ["project-updates", "read", UPDATE_UUID]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("not found"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});
});
