import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockGetProjects = vi.fn().mockResolvedValue({ projects: [] });
const mockService = { getProjects: mockGetProjects };
const mockCreateLinearService = vi.fn().mockReturnValue(mockService);
const mockOutputSuccess = vi.fn();

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: mockCreateLinearService,
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
	});

	describe("projects list", () => {
		it("calls getProjects with default limit 100", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list"]);

			expect(mockGetProjects).toHaveBeenCalledWith(100);
		});

		it("calls getProjects with custom limit", async () => {
			const program = createTestProgram();
			setupProjectsCommands(program);
			await runCommand(program, ["projects", "list", "--limit", "10"]);

			expect(mockGetProjects).toHaveBeenCalledWith(10);
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
});
