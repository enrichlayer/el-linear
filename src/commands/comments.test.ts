import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestProgram, runCommand, suppressExit } from "./test-helpers.js";

const mockResolveIssueId = vi.fn().mockResolvedValue("resolved-uuid");
const mockResolveUserId = vi.fn();
const mockService = {
  resolveIssueId: mockResolveIssueId,
  resolveUserId: mockResolveUserId,
};
const mockCreateLinearService = vi.fn().mockReturnValue(mockService);
const mockOutputSuccess = vi.fn();
const mockRawRequest = vi.fn();

vi.mock("../utils/linear-service.js", () => ({
  createLinearService: mockCreateLinearService,
}));

vi.mock("../utils/graphql-service.js", () => ({
  createGraphQLService: vi.fn().mockReturnValue({ rawRequest: mockRawRequest }),
}));

vi.mock("../utils/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/output.js")>();
  return {
    ...actual,
    outputSuccess: mockOutputSuccess,
  };
});

const { setupCommentsCommands } = await import("./comments.js");

describe("comments commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    suppressExit();
    mockRawRequest.mockResolvedValue({
      commentCreate: {
        success: true,
        comment: {
          id: "c1",
          body: "Looks good!",
          user: { id: "u1", name: "Test User" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
  });

  describe("comments create", () => {
    it("resolves issue ID and creates comment with body", async () => {
      const program = createTestProgram();
      setupCommentsCommands(program);
      await runCommand(program, ["comments", "create", "ENG-123", "--body", "Looks good!"]);

      expect(mockResolveIssueId).toHaveBeenCalledWith("ENG-123");
      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.stringContaining("commentCreate"),
        expect.objectContaining({
          input: expect.objectContaining({
            issueId: "resolved-uuid",
            body: "Looks good!",
          }),
        }),
      );
    });

    it("outputs result via outputSuccess", async () => {
      const program = createTestProgram();
      setupCommentsCommands(program);
      await runCommand(program, ["comments", "create", "ENG-123", "--body", "Looks good!"]);

      expect(mockOutputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "c1",
          body: "Looks good!",
        }),
      );
    });

    it("throws when --body not provided", async () => {
      const program = createTestProgram();
      setupCommentsCommands(program);
      await runCommand(program, ["comments", "create", "ENG-123"]);

      expect(mockRawRequest).not.toHaveBeenCalled();
    });
  });
});
