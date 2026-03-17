import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockRawRequest = vi.fn();
const mockGraphQLService = { rawRequest: mockRawRequest };
const mockCreateGraphQLService = vi.fn().mockReturnValue(mockGraphQLService);
const mockOutputSuccess = vi.fn();

vi.mock("../utils/graphql-service.js", () => ({
  createGraphQLService: mockCreateGraphQLService,
}));

vi.mock("../utils/output.js", async () => ({
  handleAsyncCommand: (await import("../__tests__/test-helpers.js")).passthroughHandleAsyncCommand,
  outputSuccess: mockOutputSuccess,
}));

let setupReleasesCommands: (program: Command) => void;
let GET_RELEASES_QUERY: string;
let GET_RELEASE_BY_ID_QUERY: string;
let GET_RELEASE_PIPELINES_QUERY: string;
let CREATE_RELEASE_MUTATION: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const mod = await import("./releases.js");
  setupReleasesCommands = mod.setupReleasesCommands;
  const queries = await import("../queries/releases.js");
  GET_RELEASES_QUERY = queries.GET_RELEASES_QUERY;
  GET_RELEASE_BY_ID_QUERY = queries.GET_RELEASE_BY_ID_QUERY;
  GET_RELEASE_PIPELINES_QUERY = queries.GET_RELEASE_PIPELINES_QUERY;
  CREATE_RELEASE_MUTATION = queries.CREATE_RELEASE_MUTATION;
});

describe("releases list command", () => {
  it("calls rawRequest with GET_RELEASES_QUERY and default limit 25", async () => {
    const program = createTestProgram();
    setupReleasesCommands(program);

    mockRawRequest.mockResolvedValue({
      releases: {
        nodes: [{ id: "rel-1", name: "v1.0.0", description: null, version: null, url: null }],
      },
    });

    await runCommand(program, ["releases", "list"]);

    expect(mockRawRequest).toHaveBeenCalledWith(GET_RELEASES_QUERY, {
      first: 25,
      filter: undefined,
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith({
      data: expect.arrayContaining([expect.objectContaining({ id: "rel-1", name: "v1.0.0" })]),
      meta: { count: 1 },
    });
  });

  it("passes --pipeline filter", async () => {
    const program = createTestProgram();
    setupReleasesCommands(program);

    mockRawRequest.mockResolvedValue({ releases: { nodes: [] } });

    await runCommand(program, ["releases", "list", "--pipeline", "Web App"]);

    expect(mockRawRequest).toHaveBeenCalledWith(GET_RELEASES_QUERY, {
      first: 25,
      filter: { pipeline: { name: { eqIgnoreCase: "Web App" } } },
    });
  });
});

describe("releases read command", () => {
  it("calls rawRequest with release ID", async () => {
    const program = createTestProgram();
    setupReleasesCommands(program);

    mockRawRequest.mockResolvedValue({
      release: {
        id: "rel-1",
        name: "v1.0.0",
        description: "First release",
        version: "1.0.0",
        url: "https://example.com",
      },
    });

    await runCommand(program, ["releases", "read", "rel-1"]);

    expect(mockRawRequest).toHaveBeenCalledWith(GET_RELEASE_BY_ID_QUERY, { id: "rel-1" });
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rel-1", name: "v1.0.0" }),
    );
  });

  it("throws when release not found", async () => {
    const program = createTestProgram();
    setupReleasesCommands(program);

    mockRawRequest.mockResolvedValue({ release: null });

    await expect(runCommand(program, ["releases", "read", "nonexistent"])).rejects.toThrow(
      'Release "nonexistent" not found',
    );
  });
});

describe("releases pipelines command", () => {
  it("calls rawRequest with GET_RELEASE_PIPELINES_QUERY", async () => {
    const program = createTestProgram();
    setupReleasesCommands(program);

    mockRawRequest.mockResolvedValue({
      releasePipelines: {
        nodes: [
          {
            id: "pipe-1",
            name: "Web App",
            stages: {
              nodes: [{ id: "stage-1", name: "Staging", type: "staging", color: "#ff0000" }],
            },
          },
        ],
      },
    });

    await runCommand(program, ["releases", "pipelines"]);

    expect(mockRawRequest).toHaveBeenCalledWith(GET_RELEASE_PIPELINES_QUERY, { first: 50 });
    expect(mockOutputSuccess).toHaveBeenCalledWith({
      data: [
        {
          id: "pipe-1",
          name: "Web App",
          stages: [{ id: "stage-1", name: "Staging", type: "staging", color: "#ff0000" }],
        },
      ],
      meta: { count: 1 },
    });
  });
});

describe("releases create command", () => {
  it("resolves pipeline and calls CREATE_RELEASE_MUTATION", async () => {
    const program = createTestProgram();
    setupReleasesCommands(program);

    // First call resolves pipeline, second call creates the release
    mockRawRequest
      .mockResolvedValueOnce({
        releasePipelines: {
          nodes: [{ id: "pipe-1", name: "Web App" }],
        },
      })
      .mockResolvedValueOnce({
        releaseCreate: {
          success: true,
          release: {
            id: "rel-new",
            name: "v2.0.0",
            description: "New release",
            version: "2.0.0",
            url: null,
          },
        },
      });

    await runCommand(program, [
      "releases",
      "create",
      "v2.0.0",
      "--pipeline",
      "Web App",
      "--description",
      "New release",
      "--version",
      "2.0.0",
    ]);

    expect(mockRawRequest).toHaveBeenCalledWith(
      CREATE_RELEASE_MUTATION,
      expect.objectContaining({
        input: expect.objectContaining({
          name: "v2.0.0",
          pipelineId: "pipe-1",
        }),
      }),
    );
  });
});
