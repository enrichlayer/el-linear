import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand, suppressExit } from "./test-helpers.js";

const mockRawRequest = vi.fn();
const mockGraphQLService = {
  rawRequest: mockRawRequest,
};
const mockCreateGraphQLService = vi.fn().mockReturnValue(mockGraphQLService);

const mockOutputSuccess = vi.fn();
const mockResolveTeam = vi.fn().mockImplementation((v: string) => v);

vi.mock("../utils/graphql-service.js", () => ({
  createGraphQLService: mockCreateGraphQLService,
}));

vi.mock("../utils/output.js", async () => ({
  handleAsyncCommand: (await import("./test-helpers.js")).passthroughHandleAsyncCommand,
  outputSuccess: mockOutputSuccess,
}));

vi.mock("../config/resolver.js", () => ({
  resolveTeam: mockResolveTeam,
}));

const { setupSearchCommands } = await import("./search.js");

describe("search", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveTeam.mockImplementation((v: string) => v);
    program = createTestProgram();
    setupSearchCommands(program);
  });

  it("calls rawRequest with query and default limit 10", async () => {
    mockRawRequest.mockResolvedValue({
      semanticSearch: {
        results: [{ type: "issue", id: "iss-1", title: "Fix bug" }],
      },
    });
    await runCommand(program, ["search", "fix bug"]);
    expect(mockRawRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "fix bug",
        maxResults: 10,
        filters: undefined,
      }),
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { count: 1, query: "fix bug" },
      }),
    );
  });

  it("passes --team through resolveTeam into filters", async () => {
    mockResolveTeam.mockReturnValue("team-uuid-789");
    mockRawRequest.mockResolvedValue({
      semanticSearch: { results: [] },
    });
    await runCommand(program, ["search", "onboarding", "--team", "ENG"]);
    expect(mockResolveTeam).toHaveBeenCalledWith("ENG");
    expect(mockRawRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "onboarding",
        maxResults: 10,
        filters: {
          issues: { team: { id: { eq: "team-uuid-789" } } },
        },
      }),
    );
  });

  it("--type filters results by type", async () => {
    mockRawRequest.mockResolvedValue({
      semanticSearch: {
        results: [
          { type: "issue", id: "iss-1", title: "Bug report" },
          { type: "project", id: "prj-1", title: "Q1 project" },
          { type: "document", id: "doc-1", title: "RFC" },
        ],
      },
    });
    await runCommand(program, ["search", "quarterly", "--type", "issue,project"]);
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { count: 2, query: "quarterly" },
      }),
    );
    const callArgs = mockOutputSuccess.mock.calls[0][0];
    expect(callArgs.data).toHaveLength(2);
  });

  it("invalid --type throws error", async () => {
    suppressExit();
    mockRawRequest.mockResolvedValue({
      semanticSearch: {
        results: [{ type: "issue", id: "iss-1", title: "Test" }],
      },
    });
    await expect(runCommand(program, ["search", "test", "--type", "bogus"])).rejects.toThrow(
      'Invalid type "bogus"',
    );
  });
});
