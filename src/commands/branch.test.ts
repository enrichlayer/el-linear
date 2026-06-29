import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockGetTeams = vi.fn();
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

// Passthrough the disk cache — exercise the fetch path, not cache hits.
vi.mock("../utils/disk-cache.js", () => ({
	cached: <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) =>
		fetcher(),
	resolveCacheTTL: () => 60,
}));

vi.mock("../config/config.js", () => ({
	loadConfig: () => ({}),
}));

const { setupBranchCommands } = await import("./branch.js");

const REAL_TEAMS = [
	{ id: "1", key: "EMW", name: "Endpoints middleware", description: null },
	{ id: "2", key: "DEV", name: "Dev", description: null },
	{ id: "3", key: "PYT", name: "Python App", description: null },
];

async function validate(branch: string, extra: string[] = []) {
	const program = createTestProgram();
	setupBranchCommands(program);
	await runCommand(program, ["branch", "validate", branch, ...extra]);
}

describe("branch validate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		suppressExit();
		process.exitCode = 0;
		mockGetTeams.mockResolvedValue(REAL_TEAMS);
	});

	it("passes a branch on a real team (exit 0)", async () => {
		await validate("feature/EMW-349-pricing-panel");
		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ valid: true, team: "EMW", reason: "ok" }),
		);
		expect(process.exitCode).toBe(0);
	});

	it("fails a branch on a team that isn't a real workspace team (exit 1)", async () => {
		await validate("feature/ZZZ-1-bogus");
		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({
				valid: false,
				team: "ZZZ",
				reason: "unknown-team",
			}),
		);
		expect(process.exitCode).toBe(1);
	});

	it("exempts protected branches without calling the API (exit 0)", async () => {
		await validate("main");
		expect(mockGetTeams).not.toHaveBeenCalled();
		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ valid: true, reason: "exempt" }),
		);
		expect(process.exitCode).toBe(0);
	});

	it("fails a branch with no Linear ID (exit 1), no API call", async () => {
		await validate("scratch-no-id");
		expect(mockGetTeams).not.toHaveBeenCalled();
		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ valid: false, reason: "no-linear-id" }),
		);
		expect(process.exitCode).toBe(1);
	});

	it("returns indeterminate (exit 2) when the team set can't be loaded", async () => {
		mockGetTeams.mockRejectedValue(new Error("offline"));
		await validate("feature/EMW-349-pricing-panel");
		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ valid: null, reason: "teams-unavailable" }),
		);
		expect(process.exitCode).toBe(2);
	});

	it("--exit-zero reports the verdict but always exits 0", async () => {
		await validate("feature/ZZZ-1-bogus", ["--exit-zero"]);
		expect(mockOutputSuccess).toHaveBeenCalledWith(
			expect.objectContaining({ valid: false, reason: "unknown-team" }),
		);
		expect(process.exitCode).toBe(0);
	});
});
