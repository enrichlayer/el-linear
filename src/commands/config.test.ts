import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockLoadConfig = vi.fn();
const mockGetActiveTeamConfigPath = vi.fn().mockReturnValue(undefined);
const mockLoadLocalConfig = vi.fn(() => ({}));
const mockOutputSuccess = vi.fn();

vi.mock("../config/config.js", () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
	getActiveTeamConfigPath: (...args: unknown[]) =>
		mockGetActiveTeamConfigPath(...args),
	loadLocalConfig: (...args: unknown[]) => mockLoadLocalConfig(...args),
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
		mockLoadLocalConfig.mockReturnValue({});
	});

	describe("config show", () => {
		it("outputs resolved config with no team config and no local overrides", async () => {
			const fakeConfig = {
				defaultTeam: "DEV",
				teams: { DEV: "team-uuid" },
			};
			mockLoadConfig.mockReturnValue(fakeConfig);
			mockGetActiveTeamConfigPath.mockReturnValue(undefined);
			mockLoadLocalConfig.mockReturnValue({});

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
			mockLoadLocalConfig.mockReturnValue({});

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "show"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: fakeConfig,
				teamConfig: "/shared/tools/.el-linear/config.json",
			});
		});

		it("includes local overrides when local.json is non-empty", async () => {
			const fakeConfig = { defaultTeam: "DEV", teams: {} };
			const fakeLocal = { assigneeEmail: "you@example.com" };
			mockLoadConfig.mockReturnValue(fakeConfig);
			mockGetActiveTeamConfigPath.mockReturnValue(undefined);
			mockLoadLocalConfig.mockReturnValue(fakeLocal);

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "show"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: fakeConfig,
				local: fakeLocal,
			});
		});

		it("includes both teamConfig and local when both are present", async () => {
			const fakeConfig = { defaultTeam: "DEV" };
			const fakeLocal = { assigneeEmail: "you@example.com" };
			mockLoadConfig.mockReturnValue(fakeConfig);
			mockGetActiveTeamConfigPath.mockReturnValue("/shared/team.json");
			mockLoadLocalConfig.mockReturnValue(fakeLocal);

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "show"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: fakeConfig,
				teamConfig: "/shared/team.json",
				local: fakeLocal,
			});
		});
	});

	describe("config local show", () => {
		it("outputs the raw local config", async () => {
			const fakeLocal = {
				assigneeEmail: "you@example.com",
				defaultPriority: "high",
			};
			mockLoadLocalConfig.mockReturnValue(fakeLocal);

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "local", "show"]);

			expect(mockLoadLocalConfig).toHaveBeenCalled();
			expect(mockOutputSuccess).toHaveBeenCalledWith({ data: fakeLocal });
		});
	});
});
