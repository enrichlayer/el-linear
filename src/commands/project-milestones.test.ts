import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand, suppressExit } from "./test-helpers.js";

// Use proper UUID format so isUuid() returns true
const MILESTONE_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// -- Mock function declarations (before vi.mock) --

const mockRawRequest = vi.fn();
const mockGraphQLService = { rawRequest: mockRawRequest };

vi.mock("../utils/graphql-service.js", () => ({
  createGraphQLService: vi.fn().mockReturnValue(mockGraphQLService),
}));

const mockResolveProjectId = vi.fn();
const mockLinearService = {
  resolveProjectId: mockResolveProjectId,
};

vi.mock("../utils/linear-service.js", () => ({
  createLinearService: vi.fn().mockReturnValue(mockLinearService),
}));

const mockOutputSuccess = vi.fn();
vi.mock("../utils/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/output.js")>();
  return { ...actual, outputSuccess: mockOutputSuccess };
});

vi.mock("../utils/error-messages.js", () => ({
  notFoundError: (entity: string, value: string) => new Error(`${entity} "${value}" not found`),
  multipleMatchesError: (entity: string, value: string, matches: string[], hint: string) =>
    new Error(`Multiple ${entity} matches for "${value}": ${matches.join(", ")}. ${hint}`),
}));

const { setupProjectMilestonesCommands } = await import("./project-milestones.js");

describe("project-milestones commands", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    suppressExit();
    consoleErrorSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  describe("project-milestones list", () => {
    it("resolves project and lists milestones", async () => {
      mockResolveProjectId.mockResolvedValue("proj-uuid-1");
      const milestones = [
        { id: "m1", name: "M1" },
        { id: "m2", name: "M2" },
      ];
      mockRawRequest.mockResolvedValue({
        project: {
          projectMilestones: { nodes: milestones },
        },
      });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);
      await runCommand(program, ["project-milestones", "list", "--project", "My Project"]);

      expect(mockResolveProjectId).toHaveBeenCalledWith("My Project");
      expect(mockRawRequest).toHaveBeenCalledWith(expect.any(String), {
        projectId: "proj-uuid-1",
        first: 50,
      });
      expect(mockOutputSuccess).toHaveBeenCalledWith({
        data: milestones,
        meta: { count: milestones.length },
      });
    });

    it("passes custom limit", async () => {
      mockResolveProjectId.mockResolvedValue("proj-uuid-1");
      mockRawRequest.mockResolvedValue({
        project: { projectMilestones: { nodes: [] } },
      });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);
      await runCommand(program, [
        "project-milestones",
        "list",
        "--project",
        "My Project",
        "--limit",
        "10",
      ]);

      expect(mockRawRequest).toHaveBeenCalledWith(expect.any(String), {
        projectId: "proj-uuid-1",
        first: 10,
      });
    });
  });

  describe("project-milestones read", () => {
    it("reads a milestone by UUID", async () => {
      const milestoneData = { id: MILESTONE_UUID, name: "M1", description: "First milestone" };
      mockRawRequest.mockResolvedValue({ projectMilestone: milestoneData });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);
      await runCommand(program, ["project-milestones", "read", MILESTONE_UUID]);

      expect(mockRawRequest).toHaveBeenCalledWith(expect.any(String), {
        id: MILESTONE_UUID,
        issuesFirst: 50,
      });
      expect(mockOutputSuccess).toHaveBeenCalledWith(milestoneData);
    });

    it("resolves milestone name with --project scope", async () => {
      mockResolveProjectId.mockResolvedValue("proj-uuid-1");
      // First call: name lookup (scoped by project)
      mockRawRequest.mockResolvedValueOnce({
        project: {
          projectMilestones: { nodes: [{ id: "m-resolved", name: "M1" }] },
        },
      });
      // Second call: read by resolved ID
      const milestoneData = { id: "m-resolved", name: "M1" };
      mockRawRequest.mockResolvedValueOnce({ projectMilestone: milestoneData });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);
      await runCommand(program, ["project-milestones", "read", "M1", "--project", "My Project"]);

      expect(mockResolveProjectId).toHaveBeenCalledWith("My Project");
      expect(mockOutputSuccess).toHaveBeenCalledWith(milestoneData);
    });
  });

  describe("project-milestones create", () => {
    it("creates a milestone with name and project", async () => {
      mockResolveProjectId.mockResolvedValue("proj-uuid-1");
      const createdMilestone = { id: "m-new", name: "M1" };
      mockRawRequest.mockResolvedValue({
        projectMilestoneCreate: {
          success: true,
          projectMilestone: createdMilestone,
        },
      });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);
      await runCommand(program, ["project-milestones", "create", "M1", "--project", "My Project"]);

      expect(mockResolveProjectId).toHaveBeenCalledWith("My Project");
      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          projectId: "proj-uuid-1",
          name: "M1",
        }),
      );
      expect(mockOutputSuccess).toHaveBeenCalledWith(createdMilestone);
    });

    it("passes description and target date", async () => {
      mockResolveProjectId.mockResolvedValue("proj-uuid-1");
      mockRawRequest.mockResolvedValue({
        projectMilestoneCreate: {
          success: true,
          projectMilestone: { id: "m-new", name: "M1" },
        },
      });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);
      await runCommand(program, [
        "project-milestones",
        "create",
        "M1",
        "--project",
        "My Project",
        "--description",
        "Sprint goal",
        "--target-date",
        "2026-04-01",
      ]);

      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          description: "Sprint goal",
          targetDate: "2026-04-01",
        }),
      );
    });

    it("errors when creation fails", async () => {
      mockResolveProjectId.mockResolvedValue("proj-uuid-1");
      mockRawRequest.mockResolvedValue({
        projectMilestoneCreate: { success: false },
      });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);

      await runCommand(program, ["project-milestones", "create", "M1", "--project", "My Project"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create project milestone"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("project-milestones update", () => {
    it("updates milestone name by UUID", async () => {
      const updatedMilestone = { id: MILESTONE_UUID, name: "New Name" };
      mockRawRequest.mockResolvedValue({
        projectMilestoneUpdate: {
          success: true,
          projectMilestone: updatedMilestone,
        },
      });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);
      await runCommand(program, [
        "project-milestones",
        "update",
        MILESTONE_UUID,
        "--name",
        "New Name",
      ]);

      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          id: MILESTONE_UUID,
          name: "New Name",
        }),
      );
      expect(mockOutputSuccess).toHaveBeenCalledWith(updatedMilestone);
    });

    it("passes target-date and sort-order", async () => {
      mockRawRequest.mockResolvedValue({
        projectMilestoneUpdate: {
          success: true,
          projectMilestone: { id: MILESTONE_UUID },
        },
      });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);
      await runCommand(program, [
        "project-milestones",
        "update",
        MILESTONE_UUID,
        "--target-date",
        "2026-06-15",
        "--sort-order",
        "3.5",
      ]);

      expect(mockRawRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          id: MILESTONE_UUID,
          targetDate: "2026-06-15",
          sortOrder: 3.5,
        }),
      );
    });

    it("errors when update fails", async () => {
      mockRawRequest.mockResolvedValue({
        projectMilestoneUpdate: { success: false },
      });

      const program = createTestProgram();
      setupProjectMilestonesCommands(program);

      await runCommand(program, ["project-milestones", "update", MILESTONE_UUID, "--name", "X"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to update project milestone"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
