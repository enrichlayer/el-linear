import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockGetTeams = vi.fn().mockResolvedValue({ teams: [] });
const mockService = { getTeams: mockGetTeams };
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

// Disable the disk cache for unit tests by passing through the fetcher.
// Each test exercises the fetch path, not cache hits — those are covered in
// the disk-cache tests directly.
vi.mock("../utils/disk-cache.js", () => ({
	cached: <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) =>
		fetcher(),
	resolveCacheTTL: () => 0,
}));

vi.mock("../config/config.js", () => ({
	loadConfig: () => ({}),
}));

const { setupTeamsCommands } = await import("./teams.js");

describe("teams commands", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		suppressExit();
	});

	describe("teams list", () => {
		it("calls getTeams with default limit 100", async () => {
			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "list"]);

			expect(mockGetTeams).toHaveBeenCalledWith(100);
		});

		it("calls getTeams with custom limit", async () => {
			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "list", "--limit", "25"]);

			expect(mockGetTeams).toHaveBeenCalledWith(25);
		});

		it("outputs result via outputSuccess", async () => {
			const teamsData = [{ id: "1", name: "Engineering" }];
			mockGetTeams.mockResolvedValue(teamsData);

			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "list"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: teamsData,
				meta: { count: 1 },
			});
		});
	});
});
