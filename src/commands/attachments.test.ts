import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

// -- Mock function declarations (before vi.mock) --

const mockResolveIssueId = vi.fn();
const mockLinearService = {
	resolveIssueId: mockResolveIssueId,
};

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: vi.fn().mockResolvedValue(mockLinearService),
}));

const mockListAttachments = vi.fn();
const mockCreateAttachment = vi.fn();
const mockDeleteAttachment = vi.fn();
const mockAttachmentsService = {
	listAttachments: mockListAttachments,
	createAttachment: mockCreateAttachment,
	deleteAttachment: mockDeleteAttachment,
};

vi.mock("../utils/graphql-attachments-service.js", () => ({
	createGraphQLAttachmentsService: vi
		.fn()
		.mockResolvedValue(mockAttachmentsService),
}));

const mockUploadFile = vi.fn();
const mockFileServiceInstance = { uploadFile: mockUploadFile };

vi.mock("../utils/file-service.js", () => ({
	createFileService: vi.fn().mockResolvedValue(mockFileServiceInstance),
	FileService: class {
		uploadFile = mockUploadFile;
	},
}));

vi.mock("../utils/auth.js", () => ({
	getApiToken: vi.fn().mockReturnValue("test-token"),
}));

const mockOutputSuccess = vi.fn();
vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return { ...actual, outputSuccess: mockOutputSuccess };
});

const { setupAttachmentsCommands } = await import("./attachments.js");

describe("attachments commands", () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		suppressExit();
		consoleErrorSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
	});

	describe("attachments list", () => {
		it("resolves issue ID and lists attachments", async () => {
			mockResolveIssueId.mockResolvedValue("issue-uuid-1");
			const attachments = [
				{ id: "att-1", title: "file.pdf", url: "https://example.com/file.pdf" },
				{
					id: "att-2",
					title: "image.png",
					url: "https://example.com/image.png",
				},
			];
			mockListAttachments.mockResolvedValue(attachments);

			const program = createTestProgram();
			setupAttachmentsCommands(program);
			await runCommand(program, ["attachments", "list", "ISSUE-1"]);

			expect(mockResolveIssueId).toHaveBeenCalledWith("ISSUE-1");
			expect(mockListAttachments).toHaveBeenCalledWith("issue-uuid-1");
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: attachments,
				meta: { count: attachments.length },
			});
		});

		it("respects --limit option", async () => {
			mockResolveIssueId.mockResolvedValue("issue-uuid-1");
			const attachments = [{ id: "att-1" }, { id: "att-2" }, { id: "att-3" }];
			mockListAttachments.mockResolvedValue(attachments);

			const program = createTestProgram();
			setupAttachmentsCommands(program);
			await runCommand(program, [
				"attachments",
				"list",
				"ISSUE-1",
				"--limit",
				"2",
			]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [{ id: "att-1" }, { id: "att-2" }],
				meta: { count: 2 },
			});
		});
	});

	describe("attachments delete", () => {
		it("deletes an attachment and outputs success", async () => {
			mockDeleteAttachment.mockResolvedValue(undefined);

			const program = createTestProgram();
			setupAttachmentsCommands(program);
			await runCommand(program, ["attachments", "delete", "att-1"]);

			expect(mockDeleteAttachment).toHaveBeenCalledWith("att-1");
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				success: true,
				message: "Attachment deleted",
			});
		});
	});

	describe("attachments create", () => {
		it("uploads file and creates attachment on issue", async () => {
			mockResolveIssueId.mockResolvedValue("issue-uuid-1");
			mockUploadFile.mockResolvedValue({
				success: true,
				assetUrl: "https://uploads.linear.app/file.pdf",
				filename: "test.pdf",
			});
			const attachmentResult = {
				id: "att-new",
				title: "test.pdf",
				url: "https://uploads.linear.app/file.pdf",
			};
			mockCreateAttachment.mockResolvedValue(attachmentResult);

			const program = createTestProgram();
			setupAttachmentsCommands(program);
			await runCommand(program, [
				"attachments",
				"create",
				"ISSUE-1",
				"--file",
				"test.pdf",
			]);

			expect(mockResolveIssueId).toHaveBeenCalledWith("ISSUE-1");
			expect(mockUploadFile).toHaveBeenCalledWith("test.pdf");
			expect(mockCreateAttachment).toHaveBeenCalledWith({
				issueId: "issue-uuid-1",
				url: "https://uploads.linear.app/file.pdf",
				title: "test.pdf",
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith(attachmentResult);
		});

		it("uses custom title when --title is provided", async () => {
			mockResolveIssueId.mockResolvedValue("issue-uuid-1");
			mockUploadFile.mockResolvedValue({
				success: true,
				assetUrl: "https://uploads.linear.app/file.pdf",
				filename: "test.pdf",
			});
			mockCreateAttachment.mockResolvedValue({ id: "att-new" });

			const program = createTestProgram();
			setupAttachmentsCommands(program);
			await runCommand(program, [
				"attachments",
				"create",
				"ISSUE-1",
				"--file",
				"test.pdf",
				"--title",
				"My Custom Title",
			]);

			expect(mockCreateAttachment).toHaveBeenCalledWith(
				expect.objectContaining({ title: "My Custom Title" }),
			);
		});

		it("errors when file upload fails", async () => {
			mockResolveIssueId.mockResolvedValue("issue-uuid-1");
			mockUploadFile.mockResolvedValue({
				success: false,
				error: "File not found",
			});

			const program = createTestProgram();
			setupAttachmentsCommands(program);

			await runCommand(program, [
				"attachments",
				"create",
				"ISSUE-1",
				"--file",
				"missing.pdf",
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("File not found"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});
});
