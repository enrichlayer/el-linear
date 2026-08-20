import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockGetTeamsWindow = vi
	.fn()
	.mockResolvedValue({ teams: [], truncated: false });
const mockGetTeam = vi.fn();
const mockService = {
	getTeamsWindow: mockGetTeamsWindow,
	getTeam: mockGetTeam,
};
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
		it("calls getTeamsWindow with default limit 100", async () => {
			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "list"]);

			expect(mockGetTeamsWindow).toHaveBeenCalledWith(100);
		});

		it("calls getTeamsWindow with custom limit", async () => {
			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "list", "--limit", "25"]);

			expect(mockGetTeamsWindow).toHaveBeenCalledWith(25);
		});

		it("passes a large requested window to the paginated service", async () => {
			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "list", "--limit", "1000"]);

			expect(mockGetTeamsWindow).toHaveBeenCalledWith(1000);
		});

		it("outputs result via outputSuccess", async () => {
			const teamsData = [{ id: "1", name: "Engineering" }];
			mockGetTeamsWindow.mockResolvedValue({
				teams: teamsData,
				truncated: false,
			});

			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "list"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: teamsData,
				meta: {
					count: 1,
					_limit_applied: 100,
					_fetched: 1,
					truncated: false,
					availability: { status: "complete" },
				},
			});
		});

		it("surfaces an exact incomplete result when more teams exist", async () => {
			const teamsData = Array.from({ length: 100 }, (_, index) => ({
				id: String(index),
				key: `T${index}`,
				name: `Team ${index}`,
			}));
			mockGetTeamsWindow.mockResolvedValue({
				teams: teamsData,
				truncated: true,
			});

			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "list"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: teamsData,
				meta: expect.objectContaining({
					count: 100,
					_limit_applied: 100,
					_fetched: 100,
					truncated: true,
					availability: {
						status: "partial",
						detail: "more teams exist beyond --limit 100",
					},
				}),
			});
		});
	});

	describe("teams lookup", () => {
		it("uses the exact team-key lookup and reports found", async () => {
			const team = { id: "1", key: "DEV", name: "Dev" };
			mockGetTeam.mockResolvedValue(team);

			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "lookup", "dev"]);

			expect(mockGetTeam).toHaveBeenCalledWith("DEV");
			expect(mockGetTeamsWindow).not.toHaveBeenCalled();
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: team,
				meta: {
					status: "found",
					availability: { status: "complete" },
					query: { key: "DEV" },
				},
			});
		});

		it("reports not-found without treating it as an unavailable read", async () => {
			mockGetTeam.mockResolvedValue(null);

			const program = createTestProgram();
			setupTeamsCommands(program);
			await runCommand(program, ["teams", "read", "ZZZ"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: null,
				meta: {
					status: "not-found",
					availability: { status: "complete" },
					query: { key: "ZZZ" },
				},
			});
		});
	});
});
