import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "./test-helpers.js";

const mockLoadConfig = vi.fn();
const mockOutputSuccess = vi.fn();

vi.mock("../config/config.js", () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
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
  });

  describe("config show", () => {
    it("outputs the resolved configuration", async () => {
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
  });
});
