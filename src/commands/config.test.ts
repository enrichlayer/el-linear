import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockLoadConfig = vi.fn();
const mockGetActiveTeamConfigPath = vi.fn().mockReturnValue(undefined);
const mockOutputSuccess = vi.fn();

vi.mock("../config/config.js", () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
	getActiveTeamConfigPath: (...args: unknown[]) =>
		mockGetActiveTeamConfigPath(...args),
}));

vi.mock("../utils/output.js", () => ({
	outputSuccess: (...args: unknown[]) => mockOutputSuccess(...args),
	handleAsyncCommand:
		(fn: (...args: unknown[]) => unknown) =>
		(...args: unknown[]) =>
			fn(...args),
}));

// Import after mocks
const { setupConfigCommands } = await import("./config.js");

describe("config commands", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetActiveTeamConfigPath.mockReturnValue(undefined);
	});

	describe("config show", () => {
		it("outputs the resolved configuration (no team config)", async () => {
			const fakeConfig = {
				defaultTeam: "DEV",
				teams: { DEV: "team-uuid" },
			};
			mockLoadConfig.mockReturnValue(fakeConfig);

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "show"]);

			expect(mockLoadConfig).toHaveBeenCalled();
			expect(mockOutputSuccess).toHaveBeenCalledWith({ data: fakeConfig });
		});

		it("includes teamConfig path in output when a team config is active", async () => {
			const fakeConfig = { defaultTeam: "DEV" };
			mockLoadConfig.mockReturnValue(fakeConfig);
			mockGetActiveTeamConfigPath.mockReturnValue(
				"/shared/tools/.el-linear/config.json",
			);

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "show"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: fakeConfig,
				teamConfig: "/shared/tools/.el-linear/config.json",
			});
		});
	});
});
