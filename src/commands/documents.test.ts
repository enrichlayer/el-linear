import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

// -- Mock function declarations (before vi.mock) --

const mockListDocuments = vi.fn();
const mockListDocumentsBySlugIds = vi.fn();
const mockGetDocument = vi.fn();
const mockCreateDocument = vi.fn();
const mockUpdateDocument = vi.fn();
const mockDeleteDocument = vi.fn();
const mockDocumentsService = {
	listDocuments: mockListDocuments,
	listDocumentsBySlugIds: mockListDocumentsBySlugIds,
	getDocument: mockGetDocument,
	createDocument: mockCreateDocument,
	updateDocument: mockUpdateDocument,
	deleteDocument: mockDeleteDocument,
};

vi.mock("../utils/graphql-documents-service.js", () => ({
	createGraphQLDocumentsService: vi.fn().mockReturnValue(mockDocumentsService),
}));

const mockListAttachments = vi.fn();
const mockCreateAttachment = vi.fn();
const mockAttachmentsService = {
	listAttachments: mockListAttachments,
	createAttachment: mockCreateAttachment,
};

vi.mock("../utils/graphql-attachments-service.js", () => ({
	createGraphQLAttachmentsService: vi
		.fn()
		.mockReturnValue(mockAttachmentsService),
}));

const mockResolveProjectId = vi.fn();
const mockResolveIssueId = vi.fn();
const mockResolveTeamId = vi.fn();
const mockLinearService = {
	resolveProjectId: mockResolveProjectId,
	resolveIssueId: mockResolveIssueId,
	resolveTeamId: mockResolveTeamId,
};

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: vi.fn().mockReturnValue(mockLinearService),
}));

const mockOutputSuccess = vi.fn();
vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return { ...actual, outputSuccess: mockOutputSuccess };
});

const { setupDocumentsCommands } = await import("./documents.js");

describe("documents commands", () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		suppressExit();
		consoleErrorSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	describe("documents list", () => {
		it("calls listDocuments with default limit", async () => {
			mockListDocuments.mockResolvedValue([]);

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, ["documents", "list"]);

			expect(mockListDocuments).toHaveBeenCalledWith({
				projectId: undefined,
				issueId: undefined,
				first: 50,
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [],
				meta: { count: 0 },
			});
		});

		it("resolves project ID when --project is provided", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-123");
			mockListDocuments.mockResolvedValue([{ id: "doc-1" }]);

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, [
				"documents",
				"list",
				"--project",
				"My Project",
			]);

			expect(mockResolveProjectId).toHaveBeenCalledWith("My Project");
			expect(mockListDocuments).toHaveBeenCalledWith({
				projectId: "proj-uuid-123",
				issueId: undefined,
				first: 50,
			});
		});

		it("uses --issue to filter documents by their direct issue link", async () => {
			mockResolveIssueId.mockResolvedValue("issue-uuid-1");
			mockListDocuments.mockResolvedValue([
				{ id: "doc-1", title: "Linked Doc" },
			]);

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, ["documents", "list", "--issue", "ENG-5"]);

			expect(mockResolveIssueId).toHaveBeenCalledWith("ENG-5");
			expect(mockListDocuments).toHaveBeenCalledWith({
				projectId: undefined,
				issueId: "issue-uuid-1",
				first: 50,
			});
			expect(mockListAttachments).not.toHaveBeenCalled();
		});

		it("uses --attached-to to find documents via URL attachments", async () => {
			mockResolveIssueId.mockResolvedValue("issue-uuid-1");
			mockListAttachments.mockResolvedValue([
				{ url: "https://linear.app/team/document/my-doc-abc123" },
				{ url: "https://example.com/not-a-linear-doc" },
			]);
			mockListDocumentsBySlugIds.mockResolvedValue([
				{ id: "abc123", title: "My Doc" },
			]);

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, [
				"documents",
				"list",
				"--attached-to",
				"ENG-5",
			]);

			expect(mockResolveIssueId).toHaveBeenCalledWith("ENG-5");
			expect(mockListAttachments).toHaveBeenCalledWith("issue-uuid-1");
			expect(mockListDocumentsBySlugIds).toHaveBeenCalledWith(["abc123"], 50);
		});

		it("errors when multiple document relation filters are provided", async () => {
			const program = createTestProgram();
			setupDocumentsCommands(program);

			await runCommand(program, [
				"documents",
				"list",
				"--project",
				"X",
				"--issue",
				"Y",
				"--attached-to",
				"Z",
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"Cannot combine --project, --issue, and --attached-to",
				),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe("documents read", () => {
		it("calls getDocument with the document ID", async () => {
			const docData = { id: "doc-1", title: "Test Doc", content: "Hello" };
			mockGetDocument.mockResolvedValue(docData);

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, ["documents", "read", "doc-1"]);

			expect(mockGetDocument).toHaveBeenCalledWith("doc-1");
			expect(mockOutputSuccess).toHaveBeenCalledWith(docData);
		});
	});

	describe("documents create", () => {
		it("wires create, read, and list consistently for the same direct issue link", async () => {
			const linkedDocument = {
				id: "doc-linked",
				title: "Linked Doc",
				issue: {
					id: "issue-uuid-1",
					identifier: "ENG-5",
					title: "Issue",
				},
			};
			mockResolveIssueId.mockResolvedValue("issue-uuid-1");
			mockCreateDocument.mockResolvedValue(linkedDocument);
			mockGetDocument.mockResolvedValue(linkedDocument);
			mockListDocuments.mockResolvedValue([linkedDocument]);

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, [
				"documents",
				"create",
				"--title",
				"Linked Doc",
				"--issue",
				"ENG-5",
			]);
			await runCommand(program, ["documents", "read", "doc-linked"]);
			await runCommand(program, ["documents", "list", "--issue", "ENG-5"]);

			expect(mockCreateDocument).toHaveBeenCalledWith(
				expect.objectContaining({ issueId: "issue-uuid-1" }),
			);
			expect(mockGetDocument).toHaveBeenCalledWith("doc-linked");
			expect(mockListDocuments).toHaveBeenCalledWith({
				projectId: undefined,
				issueId: "issue-uuid-1",
				first: 50,
			});
			expect(mockOutputSuccess).toHaveBeenLastCalledWith({
				data: [linkedDocument],
				meta: { count: 1 },
			});
		});

		it("creates a document with title", async () => {
			const createdDoc = {
				id: "doc-new",
				title: "Test",
				url: "https://linear.app/doc/test-abc",
			};
			mockCreateDocument.mockResolvedValue(createdDoc);

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, ["documents", "create", "--title", "Test"]);

			expect(mockCreateDocument).toHaveBeenCalledWith(
				expect.objectContaining({ title: "Test" }),
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith(createdDoc);
		});

		it("resolves project ID when --project is provided", async () => {
			mockResolveProjectId.mockResolvedValue("proj-uuid-1");
			mockCreateDocument.mockResolvedValue({
				id: "doc-new",
				title: "Test",
				url: "",
			});

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, [
				"documents",
				"create",
				"--title",
				"Test",
				"--project",
				"My Project",
			]);

			// DEV-4103: resolveProjectId accepts an optional --team scope so a
			// name shared across teams doesn't silently bind to the wrong one.
			expect(mockResolveProjectId).toHaveBeenCalledWith(
				"My Project",
				undefined,
			);
			expect(mockCreateDocument).toHaveBeenCalledWith(
				expect.objectContaining({ projectId: "proj-uuid-1" }),
			);
		});
	});

	describe("documents delete", () => {
		it("deletes a document and outputs success", async () => {
			mockDeleteDocument.mockResolvedValue(undefined);

			const program = createTestProgram();
			setupDocumentsCommands(program);
			await runCommand(program, ["documents", "delete", "doc-1"]);

			expect(mockDeleteDocument).toHaveBeenCalledWith("doc-1");
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				success: true,
				message: "Document moved to trash",
			});
		});
	});
});
