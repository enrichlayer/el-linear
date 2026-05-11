import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockGetProjects = vi.fn().mockResolvedValue({ projects: [] });
const mockResolveProjectId = vi
	.fn()
	.mockImplementation((project: string) =>
		Promise.resolve(`project-id-${project}`),
	);
const mockResolveTeamId = vi.fn();
const mockService = {
	getProjects: mockGetProjects,
	resolveProjectId: mockResolveProjectId,
	resolveTeamId: mockResolveTeamId,
};
const mockCreateLinearService = vi.fn().mockReturnValue(mockService);
const mockOutputSuccess = vi.fn();
const mockGraphQLService = { rawRequest: vi.fn() };

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: mockCreateLinearService,
}));

vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: vi.fn().mockResolvedValue(mockGraphQLService),
}));

vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return {
		...actual,
		outputSuccess: mockOutputSuccess,
	};
});

// Pass-through cache so tests still hit the LinearService fetcher; cache
// behaviour is covered in disk-cache.test.ts.
vi.mock("../utils/disk-cache.js", () => ({
	cached: <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) =>
		fetcher(),
	resolveCacheTTL: () => 0,
}));

vi.mock("../config/config.js", () => ({
	loadConfig: () => ({}),
}));

const { setupProjectsCommands } = await import("./projects.js");

describe("projects commands", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		suppressExit();
		mockResolveProjectId.mockImplementation((project: string) =>
			Promise.resolve(`project-id-${project}`),
		);
	});

	describe("projects list", () => {
		it("calls getProjects with default limit 100", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list"]);

			expect(mockGetProjects).toHaveBeenCalledWith(100, {
				nameFilter: undefined,
				states: undefined,
				excludeStates: undefined,
			});
		});

		it("calls getProjects with custom limit", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list", "--limit", "10"]);

			expect(mockGetProjects).toHaveBeenCalledWith(10, {
				nameFilter: undefined,
				states: undefined,
				excludeStates: undefined,
			});
		});

		it("passes --name through nameFilter", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list", "--name", "knowledge"]);

			expect(mockGetProjects).toHaveBeenCalledWith(100, {
				nameFilter: "knowledge",
				states: undefined,
				excludeStates: undefined,
			});
		});

		it("passes --active as excludeStates [completed, canceled]", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list", "--active"]);

			expect(mockGetProjects).toHaveBeenCalledWith(100, {
				nameFilter: undefined,
				states: undefined,
				excludeStates: ["completed", "canceled"],
			});
		});

		it("passes --state as states list (lowercased)", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, [
				"projects",
				"list",
				"--state",
				"Started, Planned",
			]);

			expect(mockGetProjects).toHaveBeenCalledWith(100, {
				nameFilter: undefined,
				states: ["started", "planned"],
				excludeStates: undefined,
			});
		});

		it("outputs result via outputSuccess", async () => {
			const projectsData = [{ id: "p1", name: "Launch" }];
			mockGetProjects.mockResolvedValue(projectsData);

			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: projectsData,
				meta: { count: 1 },
			});
		});
	});

	describe("projects archive/delete", () => {
		it("archives a project by name", async () => {
			mockGraphQLService.rawRequest.mockResolvedValue({
				projectArchive: {
					success: true,
					entity: { id: "project-id-Launch" },
					lastSyncId: 20,
				},
			});

			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "archive", "Launch"]);

			expect(mockResolveProjectId).toHaveBeenCalledWith("Launch");
			expect(mockGraphQLService.rawRequest).toHaveBeenCalledWith(
				expect.stringContaining("projectArchive"),
				{ id: "project-id-Launch" },
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				success: true,
				archived: true,
				id: "project-id-Launch",
				entity: { id: "project-id-Launch" },
				lastSyncId: 20,
			});
		});

		it("deletes a project by name", async () => {
			mockGraphQLService.rawRequest.mockResolvedValue({
				projectDelete: {
					success: true,
					entity: null,
					lastSyncId: 21,
				},
			});

			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "delete", "Launch"]);

			expect(mockResolveProjectId).toHaveBeenCalledWith("Launch");
			expect(mockGraphQLService.rawRequest).toHaveBeenCalledWith(
				expect.stringContaining("projectDelete"),
				{ id: "project-id-Launch" },
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				success: true,
				deleted: true,
				id: "project-id-Launch",
				entity: undefined,
				lastSyncId: 21,
			});
		});
	});
});
