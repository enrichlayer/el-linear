import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockLoadConfig = vi.fn();
const mockGetActiveTeamConfigPath = vi.fn().mockReturnValue(undefined);
const mockLoadLocalConfig = vi.fn(() => ({}));
const mockOutputSuccess = vi.fn();
const mockOutputWarning = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockUpdateConfig = vi.fn();
const mockResolveActiveProfile = vi.fn(() => ({
	name: null,
	configPath: "/home/test/.config/el-linear/config.json",
	tokenPath: "/home/test/.config/el-linear/token",
	localConfigPath: "/home/test/.config/el-linear/local.json",
}));

vi.mock("../config/config.js", () => ({
	loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
	getActiveTeamConfigPath: (...args: unknown[]) =>
		mockGetActiveTeamConfigPath(...args),
	loadLocalConfig: (...args: unknown[]) => mockLoadLocalConfig(...args),
}));

vi.mock("../config/paths.js", () => ({
	resolveActiveProfile: (...args: unknown[]) =>
		mockResolveActiveProfile(...args),
}));

vi.mock("../utils/output.js", () => ({
	outputSuccess: (...args: unknown[]) => mockOutputSuccess(...args),
	outputWarning: (...args: unknown[]) => mockOutputWarning(...args),
	handleAsyncCommand:
		(fn: (...args: unknown[]) => unknown) =>
		(...args: unknown[]) =>
			fn(...args),
}));

vi.mock("./init/shared.js", () => ({
	updateConfig: (
		mutator: (
			current: Record<string, unknown>,
		) => Record<string, unknown> | Promise<Record<string, unknown>>,
	) => mockUpdateConfig(mutator),
}));

// `node:fs` is mocked so set-path / show can simulate file existence + JSON
// validity without writing to the real config directory.
vi.mock("node:fs", () => ({
	default: {
		existsSync: (...args: unknown[]) => mockExistsSync(...args),
		readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
	},
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

	describe("config team show", () => {
		const ORIGINAL_ENV = process.env.EL_LINEAR_TEAM_CONFIG;
		afterEachRestoreEnv();

		it("reports no team config when none is active", async () => {
			delete process.env.EL_LINEAR_TEAM_CONFIG;
			mockGetActiveTeamConfigPath.mockReturnValue(undefined);

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "team", "show"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: { teamConfigPath: null, source: null },
			});
		});

		it("reports the personal-config path and the top-level keys it provides", async () => {
			delete process.env.EL_LINEAR_TEAM_CONFIG;
			mockGetActiveTeamConfigPath.mockReturnValue("/shared/team.json");
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(
				'{"teams":{"DEV":"u"},"members":{"uuids":{}},"labels":{"workspace":{}}}',
			);

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "team", "show"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: {
					teamConfigPath: "/shared/team.json",
					source: "teamConfigPath in personal config",
					exists: true,
					valid: true,
					providedKeys: ["labels", "members", "teams"],
				},
			});
		});

		it("flags the env var as the source when EL_LINEAR_TEAM_CONFIG is set", async () => {
			process.env.EL_LINEAR_TEAM_CONFIG = "/env/team.json";
			mockGetActiveTeamConfigPath.mockReturnValue("/env/team.json");
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('{"teams":{}}');

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "team", "show"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: {
					teamConfigPath: "/env/team.json",
					source: "EL_LINEAR_TEAM_CONFIG env var",
					exists: true,
					valid: true,
					providedKeys: ["teams"],
				},
			});
		});

		it("surfaces invalid JSON without throwing", async () => {
			delete process.env.EL_LINEAR_TEAM_CONFIG;
			mockGetActiveTeamConfigPath.mockReturnValue("/broken/team.json");
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockImplementation(() => "{not json");

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "team", "show"]);

			const call = mockOutputSuccess.mock.calls[0]?.[0] as {
				data: Record<string, unknown>;
			};
			expect(call.data.teamConfigPath).toBe("/broken/team.json");
			expect(call.data.valid).toBe(false);
			expect(call.data.exists).toBe(true);
			expect(typeof call.data.error).toBe("string");
		});

		// Restore env after each test to avoid bleed into sibling describes.
		function afterEachRestoreEnv(): void {
			beforeEach(() => {
				if (ORIGINAL_ENV !== undefined) {
					process.env.EL_LINEAR_TEAM_CONFIG = ORIGINAL_ENV;
				} else {
					delete process.env.EL_LINEAR_TEAM_CONFIG;
				}
			});
		}
	});

	describe("config team set-path", () => {
		beforeEach(() => {
			delete process.env.EL_LINEAR_TEAM_CONFIG;
			// `updateConfig` mock returns void; tests assert on the mutator call.
			mockUpdateConfig.mockResolvedValue(undefined);
		});

		it("refuses to wire a non-existent path", async () => {
			mockExistsSync.mockReturnValue(false);

			const program = createTestProgram();
			setupConfigCommands(program);
			await expect(
				runCommand(program, [
					"config",
					"team",
					"set-path",
					"/no/such/file.json",
				]),
			).rejects.toThrow(/not found/i);
			expect(mockUpdateConfig).not.toHaveBeenCalled();
		});

		it("refuses to wire a file that isn't valid JSON", async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue("{broken json");

			const program = createTestProgram();
			setupConfigCommands(program);
			await expect(
				runCommand(program, ["config", "team", "set-path", "/broken.json"]),
			).rejects.toThrow(/not valid JSON/i);
			expect(mockUpdateConfig).not.toHaveBeenCalled();
		});

		it("writes the resolved absolute path into personal config via updateConfig", async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('{"teams":{}}');

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, [
				"config",
				"team",
				"set-path",
				"/abs/path/team.json",
			]);

			expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
			const mutator = mockUpdateConfig.mock.calls[0]?.[0] as (
				c: Record<string, unknown>,
			) => Record<string, unknown>;
			expect(mutator({ defaultTeam: "DEV" })).toEqual({
				defaultTeam: "DEV",
				teamConfigPath: "/abs/path/team.json",
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: {
					teamConfigPath: "/abs/path/team.json",
					written: "/home/test/.config/el-linear/config.json",
				},
			});
		});

		it("warns when EL_LINEAR_TEAM_CONFIG would override the persistent setting", async () => {
			process.env.EL_LINEAR_TEAM_CONFIG = "/different/env.json";
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('{"teams":{}}');

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, [
				"config",
				"team",
				"set-path",
				"/abs/path/team.json",
			]);

			expect(mockOutputWarning).toHaveBeenCalledWith(
				expect.stringContaining("EL_LINEAR_TEAM_CONFIG=/different/env.json"),
			);
		});

		it("does not warn when env var equals the path being set", async () => {
			process.env.EL_LINEAR_TEAM_CONFIG = "/abs/path/team.json";
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('{"teams":{}}');

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, [
				"config",
				"team",
				"set-path",
				"/abs/path/team.json",
			]);

			expect(mockOutputWarning).not.toHaveBeenCalled();
		});
	});

	describe("config team clear", () => {
		beforeEach(() => {
			delete process.env.EL_LINEAR_TEAM_CONFIG;
			mockUpdateConfig.mockResolvedValue(undefined);
		});

		it("removes teamConfigPath via updateConfig and reports the previous value", async () => {
			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "team", "clear"]);

			expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
			const mutator = mockUpdateConfig.mock.calls[0]?.[0] as (
				c: Record<string, unknown>,
			) => Record<string, unknown>;
			expect(
				mutator({ defaultTeam: "DEV", teamConfigPath: "/was/here.json" }),
			).toEqual({ defaultTeam: "DEV" });
		});

		it("warns when EL_LINEAR_TEAM_CONFIG remains set after clearing", async () => {
			process.env.EL_LINEAR_TEAM_CONFIG = "/still/active.json";

			const program = createTestProgram();
			setupConfigCommands(program);
			await runCommand(program, ["config", "team", "clear"]);

			expect(mockOutputWarning).toHaveBeenCalledWith(
				expect.stringContaining("still set"),
			);
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
