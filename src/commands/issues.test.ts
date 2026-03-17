import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand, suppressExit } from "../__tests__/test-helpers.js";

// -- Mock function declarations (before vi.mock) --

const mockGetIssues = vi.fn();
const mockGetIssueById = vi.fn();
const mockCreateIssue = vi.fn();
const mockUpdateIssue = vi.fn();
const mockSearchIssues = vi.fn();

class MockGraphQLIssuesService {
  getIssues = mockGetIssues;
  getIssueById = mockGetIssueById;
  createIssue = mockCreateIssue;
  updateIssue = mockUpdateIssue;
  searchIssues = mockSearchIssues;
}

vi.mock("../utils/graphql-issues-service.js", () => ({
  GraphQLIssuesService: MockGraphQLIssuesService,
}));

const mockGraphQLService = { rawRequest: vi.fn() };
vi.mock("../utils/graphql-service.js", () => ({
  createGraphQLService: vi.fn().mockReturnValue(mockGraphQLService),
}));

const mockLinearService = {
  resolveIssueId: vi.fn(),
  resolveProjectId: vi.fn(),
  resolveTeamId: vi.fn(),
};
vi.mock("../utils/linear-service.js", () => ({
  createLinearService: vi.fn().mockReturnValue(mockLinearService),
}));

const mockOutputSuccess = vi.fn();
vi.mock("../utils/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/output.js")>();
  return { ...actual, outputSuccess: mockOutputSuccess };
});

const mockResolveTeam = vi.fn().mockImplementation((v: string) => `team-id-${v}`);
const mockResolveMember = vi.fn().mockImplementation((v: string) => `member-id-${v}`);
const mockResolveAssignee = vi
  .fn()
  .mockImplementation((v: string) => Promise.resolve(`member-id-${v}`));
const mockResolveLabels = vi.fn().mockReturnValue([]);
vi.mock("../config/resolver.js", () => ({
  resolveTeam: mockResolveTeam,
  resolveMember: mockResolveMember,
  resolveAssignee: mockResolveAssignee,
  resolveLabels: mockResolveLabels,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    defaultTeam: "DEV",
    labels: { workspace: {} },
    members: {},
    teams: {},
  }),
}));

const mockEnforceBrandName = vi.fn();
vi.mock("../config/brand-validator.js", () => ({
  enforceBrandName: mockEnforceBrandName,
}));

vi.mock("../utils/auth.js", () => ({
  getApiToken: vi.fn().mockReturnValue("test-token"),
}));

const mockUploadFile = vi.fn();
vi.mock("../utils/file-service.js", () => ({
  FileService: class {
    uploadFile = mockUploadFile;
  },
}));

const mockCreateAttachment = vi.fn();
vi.mock("../utils/graphql-attachments-service.js", () => ({
  createGraphQLAttachmentsService: vi.fn().mockReturnValue({
    createAttachment: mockCreateAttachment,
  }),
}));

const mockResolveDefaultStatus = vi.fn().mockReturnValue(undefined);
vi.mock("../config/status-defaults.js", () => ({
  resolveDefaultStatus: mockResolveDefaultStatus,
}));

const { setupIssuesCommands } = await import("./issues.js");

describe("issues commands", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    suppressExit();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    consoleErrorSpy = stdoutSpy; // errors now go to stdout
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockResolveTeam.mockImplementation((v: string) => `team-id-${v}`);
    mockResolveMember.mockImplementation((v: string) => `member-id-${v}`);
    mockResolveLabels.mockReturnValue([]);
    mockResolveDefaultStatus.mockReturnValue(undefined);
  });

  describe("issues list", () => {
    it("calls getIssues with default limit 25", async () => {
      mockGetIssues.mockResolvedValue([]);

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, ["issues", "list"]);

      expect(mockGetIssues).toHaveBeenCalledWith(25);
      expect(mockOutputSuccess).toHaveBeenCalledWith({
        data: [],
        meta: { count: 0 },
      });
    });

    it("calls getIssues with custom limit", async () => {
      mockGetIssues.mockResolvedValue([]);

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, ["issues", "list", "--limit", "10"]);

      expect(mockGetIssues).toHaveBeenCalledWith(10);
    });

    it("filters results by --team", async () => {
      const filteredIssues = [
        { id: "1", team: { id: "team-id-DEV", key: "DEV" } },
        { id: "3", team: { id: "team-id-DEV", key: "DEV" } },
      ];
      mockSearchIssues.mockResolvedValue(filteredIssues);

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, ["issues", "list", "--team", "DEV"]);

      expect(mockResolveTeam).toHaveBeenCalledWith("DEV");
      expect(mockSearchIssues).toHaveBeenCalledWith({
        teamId: "team-id-DEV",
        assigneeId: undefined,
        projectId: undefined,
        noProject: false,
        labelNames: undefined,
        status: undefined,
        priority: undefined,
        orderBy: "updatedAt",
        limit: 25,
      });
      expect(mockOutputSuccess).toHaveBeenCalledWith({
        data: filteredIssues,
        meta: { count: 2, team: "DEV" },
      });
    });
  });

  describe("issues read", () => {
    it("calls getIssueById with the issue identifier", async () => {
      const issueData = { id: "uuid-1", identifier: "DEV-123", title: "My issue" };
      mockGetIssueById.mockResolvedValue(issueData);

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, ["issues", "read", "DEV-123"]);

      expect(mockGetIssueById).toHaveBeenCalledWith("DEV-123");
      expect(mockOutputSuccess).toHaveBeenCalledWith(issueData);
    });
  });

  describe("issues create", () => {
    it("creates issue with team resolved from option", async () => {
      mockCreateIssue.mockResolvedValue({ id: "new-issue-id", identifier: "DEV-999" });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, ["issues", "create", "My Title", "--team", "DEV"]);

      expect(mockResolveTeam).toHaveBeenCalledWith("DEV");
      expect(mockEnforceBrandName).toHaveBeenCalledWith("My Title", undefined, undefined);
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "My Title",
          teamId: "team-id-DEV",
        }),
      );
      expect(mockOutputSuccess).toHaveBeenCalled();
    });

    it("resolves assignee when --assignee is provided", async () => {
      mockCreateIssue.mockResolvedValue({ id: "new-issue-id" });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, [
        "issues",
        "create",
        "Task",
        "--team",
        "DEV",
        "--assignee",
        "dima",
      ]);

      expect(mockResolveAssignee).toHaveBeenCalledWith("dima", expect.any(Object));
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeId: "member-id-dima",
        }),
      );
    });

    it("resolves labels when --labels is provided", async () => {
      mockResolveLabels.mockReturnValue(["label-uuid-1", "label-uuid-2"]);
      mockCreateIssue.mockResolvedValue({ id: "new-issue-id" });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, [
        "issues",
        "create",
        "Task",
        "--team",
        "DEV",
        "--labels",
        "bug,feature",
      ]);

      expect(mockResolveLabels).toHaveBeenCalledWith(["bug", "feature"], "DEV");
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          labelIds: ["label-uuid-1", "label-uuid-2"],
        }),
      );
    });

    it("inlines image attachment in description", async () => {
      mockCreateIssue.mockResolvedValue({ id: "new-issue-id", identifier: "DEV-999" });
      mockUploadFile.mockResolvedValue({
        success: true,
        assetUrl: "https://uploads.linear.app/asset/image.png",
        filename: "screenshot.png",
      });
      mockCreateAttachment.mockResolvedValue({
        id: "att-1",
        url: "https://uploads.linear.app/asset/image.png",
        title: "screenshot.png",
      });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, [
        "issues",
        "create",
        "Bug with screenshot",
        "--team",
        "DEV",
        "--description",
        "See the bug below.",
        "--attachment",
        "/tmp/screenshot.png",
      ]);

      expect(mockUploadFile).toHaveBeenCalledWith("/tmp/screenshot.png");
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          description:
            "See the bug below.\n\n![screenshot.png](https://uploads.linear.app/asset/image.png)",
        }),
      );
      // Images are embedded inline in description, so no separate attachment record
      expect(mockCreateAttachment).not.toHaveBeenCalled();
      expect(mockOutputSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: "DEV-999",
        }),
      );
    });

    it("does not inline non-image attachments in description", async () => {
      mockCreateIssue.mockResolvedValue({ id: "new-issue-id", identifier: "DEV-999" });
      mockUploadFile.mockResolvedValue({
        success: true,
        assetUrl: "https://uploads.linear.app/asset/report.pdf",
        filename: "report.pdf",
      });
      mockCreateAttachment.mockResolvedValue({
        id: "att-2",
        url: "https://uploads.linear.app/asset/report.pdf",
        title: "report.pdf",
      });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, [
        "issues",
        "create",
        "Issue with PDF",
        "--team",
        "DEV",
        "--description",
        "See attached report.",
        "--attachment",
        "/tmp/report.pdf",
      ]);

      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "See attached report.",
        }),
      );
      expect(mockCreateAttachment).toHaveBeenCalled();
    });

    it("creates image-only description when no --description provided", async () => {
      mockCreateIssue.mockResolvedValue({ id: "new-issue-id", identifier: "DEV-999" });
      mockUploadFile.mockResolvedValue({
        success: true,
        assetUrl: "https://uploads.linear.app/asset/image.png",
        filename: "photo.jpg",
      });
      mockCreateAttachment.mockResolvedValue({ id: "att-3" });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, [
        "issues",
        "create",
        "Visual bug",
        "--team",
        "DEV",
        "--attachment",
        "/tmp/photo.jpg",
      ]);

      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "![photo.jpg](https://uploads.linear.app/asset/image.png)",
        }),
      );
    });

    it("throws on attachment upload failure", async () => {
      mockUploadFile.mockResolvedValue({
        success: false,
        error: "File not found: /tmp/missing.png",
      });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, [
        "issues",
        "create",
        "Bug",
        "--team",
        "DEV",
        "--attachment",
        "/tmp/missing.png",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Attachment upload failed"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockCreateIssue).not.toHaveBeenCalled();
    });

    it("calls resolveDefaultStatus", async () => {
      mockResolveDefaultStatus.mockReturnValue("status-uuid");
      mockCreateIssue.mockResolvedValue({ id: "new-issue-id" });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, ["issues", "create", "Task", "--team", "DEV"]);

      expect(mockResolveDefaultStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          hasAssignee: false,
          hasProject: false,
        }),
      );
      expect(mockCreateIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          statusId: "status-uuid",
        }),
      );
    });
  });

  describe("issues update", () => {
    it("errors when --parent-ticket and --clear-parent-ticket are both used", async () => {
      const program = createTestProgram();
      setupIssuesCommands(program);

      await runCommand(program, [
        "issues",
        "update",
        "DEV-1",
        "--parent-ticket",
        "DEV-2",
        "--clear-parent-ticket",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot use --parent-ticket and --clear-parent-ticket together"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("errors when --project-milestone and --clear-project-milestone are both used", async () => {
      const program = createTestProgram();
      setupIssuesCommands(program);

      await runCommand(program, [
        "issues",
        "update",
        "DEV-1",
        "--project-milestone",
        "M1",
        "--clear-project-milestone",
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Cannot use --project-milestone and --clear-project-milestone together",
        ),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("errors when --cycle and --clear-cycle are both used", async () => {
      const program = createTestProgram();
      setupIssuesCommands(program);

      await runCommand(program, ["issues", "update", "DEV-1", "--cycle", "C1", "--clear-cycle"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cannot use --cycle and --clear-cycle together"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("errors when --label-by is used without --labels", async () => {
      const program = createTestProgram();
      setupIssuesCommands(program);

      await runCommand(program, ["issues", "update", "DEV-1", "--label-by", "overwriting"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--label-by requires --labels to be specified"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("errors when --clear-labels is used with --labels", async () => {
      const program = createTestProgram();
      setupIssuesCommands(program);

      await runCommand(program, ["issues", "update", "DEV-1", "--clear-labels", "--labels", "bug"]);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("--clear-labels cannot be used with --labels"),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("updates issue with title", async () => {
      mockUpdateIssue.mockResolvedValue({ id: "DEV-1", title: "New Title" });

      const program = createTestProgram();
      setupIssuesCommands(program);
      await runCommand(program, ["issues", "update", "DEV-1", "--title", "New Title"]);

      expect(mockUpdateIssue).toHaveBeenCalled();
      expect(mockOutputSuccess).toHaveBeenCalled();
    });
  });
});
