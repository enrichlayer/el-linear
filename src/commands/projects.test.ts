import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

// `getProjects` returns `LinearProject[]`. The earlier `{ projects: [] }`
// default was inert under the old `result.length` access (gave NaN, harmless)
// but breaks once the command runs the result through `sortActiveFirst`,
// which spreads its argument. An empty array is both correct and safe.
const mockGetProjects = vi.fn().mockResolvedValue([]);
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

const mockResolveTeam = vi.fn((name: string) => name);
vi.mock("../config/resolver.js", () => ({
	resolveTeam: (name: string) => mockResolveTeam(name),
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
				teamId: undefined,
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
				teamId: undefined,
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
				teamId: undefined,
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
				teamId: undefined,
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
				teamId: undefined,
				states: ["started", "planned"],
				excludeStates: undefined,
			});
		});

		it("resolves --team alias to UUID and passes teamId server-side", async () => {
			mockResolveTeam.mockReturnValue("ENG");
			mockResolveTeamId.mockResolvedValue("team-uuid-eng");

			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list", "--team", "ENG"]);

			expect(mockResolveTeam).toHaveBeenCalledWith("ENG");
			expect(mockResolveTeamId).toHaveBeenCalledWith("ENG");
			expect(mockGetProjects).toHaveBeenCalledWith(100, {
				nameFilter: undefined,
				teamId: "team-uuid-eng",
				states: undefined,
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

		// DEV-4175 — silent-truncation fix.
		it("--all passes limit 0 to getProjects (unlimited)", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list", "--all"]);

			expect(mockGetProjects).toHaveBeenCalledWith(0, {
				nameFilter: undefined,
				teamId: undefined,
				states: undefined,
				excludeStates: undefined,
			});
		});

		it("--limit 0 is treated the same as --all (unlimited)", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list", "--limit", "0"]);

			expect(mockGetProjects).toHaveBeenCalledWith(0, {
				nameFilter: undefined,
				teamId: undefined,
				states: undefined,
				excludeStates: undefined,
			});
		});

		it("sorts active projects ahead of completed/canceled before output", async () => {
			// Upstream order from `getProjects` is `updatedAt`-descending —
			// a recently-touched completed project can come first. After
			// `sortActiveFirst` the started one must lead so it survives any
			// `--limit` clipping. DEV-4175.
			mockGetProjects.mockResolvedValue([
				{ id: "c1", name: "Done thing", state: "completed" },
				{ id: "s1", name: "Live work", state: "started" },
				{ id: "x1", name: "Killed", state: "canceled" },
				{ id: "p1", name: "Next up", state: "planned" },
			]);

			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [
					{ id: "s1", name: "Live work", state: "started" },
					{ id: "p1", name: "Next up", state: "planned" },
					{ id: "c1", name: "Done thing", state: "completed" },
					{ id: "x1", name: "Killed", state: "canceled" },
				],
				meta: { count: 4 },
			});
		});

		describe("--format/--fields colliding with root registrations (DEV-5376)", () => {
			// main.ts registers --format/--fields on the root program too, and
			// commander 15 hands the CLI token to the root registration even
			// when it appears after the subcommand — the same collision fixed
			// on `issues list`. This proves the `projects list` half renders the
			// table instead of silently falling through to the JSON envelope.
			function createCollidingProgram() {
				const program = createTestProgram();
				program.option("--format <kind>", "global format", "json");
				program.option("--fields <fields>", "global fields filter");
				return program;
			}

			let stdoutSpy: ReturnType<typeof vi.spyOn>;

			beforeEach(() => {
				stdoutSpy = vi
					.spyOn(process.stdout, "write")
					.mockImplementation(() => true);
			});

			afterEach(() => {
				stdoutSpy.mockRestore();
			});

			it("--format table --fields renders the table, not the JSON envelope", async () => {
				mockGetProjects.mockResolvedValue([
					{ id: "s1", name: "Live work", state: "started" },
				]);
				const program = createCollidingProgram();
				setupProjectsCommands(program);
				await runCommand(program, [
					"projects",
					"list",
					"--format",
					"table",
					"--fields",
					"name,state",
				]);

				expect(mockOutputSuccess).not.toHaveBeenCalled();
				const written = stdoutSpy.mock.calls
					.map((c: unknown[]) => c[0])
					.join("");
				expect(written).toContain("Name");
				expect(written).toContain("State");
				expect(written).toContain("Live work");
				expect(written).toContain("started");
			});

			it("no --format still emits the JSON envelope", async () => {
				mockGetProjects.mockResolvedValue([
					{ id: "s1", name: "Live work", state: "started" },
				]);
				const program = createCollidingProgram();
				setupProjectsCommands(program);
				await runCommand(program, ["projects", "list"]);

				expect(mockOutputSuccess).toHaveBeenCalledWith({
					data: [{ id: "s1", name: "Live work", state: "started" }],
					meta: { count: 1 },
				});
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

	describe("projects read", () => {
		it("resolves the id, runs the full read query, and flattens teams.nodes", async () => {
			mockGraphQLService.rawRequest.mockResolvedValue({
				project: {
					id: "project-id-Launch",
					name: "Launch",
					state: "started",
					progress: 0.5,
					url: "https://linear.app/acme/project/launch-abc",
					startDate: null,
					targetDate: "2026-07-01",
					description: "Short desc",
					content: "# Full content",
					lead: { id: "u1", name: "Alice", displayName: "alice" },
					teams: { nodes: [{ id: "t1", key: "ENG", name: "Engineering" }] },
				},
			});

			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "read", "Launch"]);

			expect(mockResolveProjectId).toHaveBeenCalledWith("Launch");
			expect(mockGraphQLService.rawRequest).toHaveBeenCalledWith(
				expect.stringContaining("ProjectRead"),
				{ id: "project-id-Launch" },
			);
			// teams is flattened to a plain array (what the summary formatter +
			// JSON shape expect), and description/content/url are present.
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				id: "project-id-Launch",
				name: "Launch",
				state: "started",
				progress: 0.5,
				url: "https://linear.app/acme/project/launch-abc",
				startDate: null,
				targetDate: "2026-07-01",
				description: "Short desc",
				content: "# Full content",
				lead: { id: "u1", name: "Alice", displayName: "alice" },
				teams: [{ id: "t1", key: "ENG", name: "Engineering" }],
			});
		});

		it("forwards a URL/slug identifier through resolveProjectId", async () => {
			mockGraphQLService.rawRequest.mockResolvedValue({
				project: {
					id: "project-id-x",
					name: "X",
					state: "planned",
					progress: 0,
					url: "u",
					startDate: null,
					targetDate: null,
					description: null,
					content: null,
					lead: null,
					teams: { nodes: [] },
				},
			});
			const url = "https://linear.app/acme/project/launch-abc123def456";

			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "read", url]);

			expect(mockResolveProjectId).toHaveBeenCalledWith(url);
		});

		it("throws a clear error when the project is not found", async () => {
			mockGraphQLService.rawRequest.mockResolvedValue({ project: null });

			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "read", "Ghost"]);

			// handleAsyncCommand routes the throw to outputError; the success
			// path must not fire.
			expect(mockOutputSuccess).not.toHaveBeenCalled();
		});
	});
});
