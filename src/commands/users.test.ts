import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand, suppressExit } from "./test-helpers.js";

const mockGetUsers = vi.fn().mockResolvedValue({ users: [] });
const mockService = { getUsers: mockGetUsers };
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

const { setupUsersCommands } = await import("./users.js");

describe("users commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suppressExit();
  });

  describe("users list", () => {
    it("calls getUsers with default limit and no active filter", async () => {
      const program = createTestProgram();
      setupUsersCommands(program);
      await runCommand(program, ["users", "list"]);

      expect(mockGetUsers).toHaveBeenCalledWith(undefined, 100);
    });

    it("passes --active flag correctly", async () => {
      const program = createTestProgram();
      setupUsersCommands(program);
      await runCommand(program, ["users", "list", "--active"]);

      expect(mockGetUsers).toHaveBeenCalledWith(true, 100);
    });

    it("passes custom limit", async () => {
      const program = createTestProgram();
      setupUsersCommands(program);
      await runCommand(program, ["users", "list", "--limit", "50"]);

      expect(mockGetUsers).toHaveBeenCalledWith(undefined, 50);
    });

    it("outputs result via outputSuccess", async () => {
      const usersData = [{ id: "u1", name: "Alice" }];
      mockGetUsers.mockResolvedValue(usersData);

      const program = createTestProgram();
      setupUsersCommands(program);
      await runCommand(program, ["users", "list"]);

      expect(mockOutputSuccess).toHaveBeenCalledWith({
        data: usersData,
        meta: { count: 1 },
      });
    });
  });
});
