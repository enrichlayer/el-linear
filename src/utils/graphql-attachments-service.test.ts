import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRawRequest = vi.fn();

vi.mock("./graphql-service.js", () => ({
	createGraphQLService: vi.fn().mockReturnValue({ rawRequest: mockRawRequest }),
}));

const { createGraphQLAttachmentsService } = await import(
	"./graphql-attachments-service.js"
);

function createService() {
	return createGraphQLAttachmentsService({ apiToken: "test-token" });
}

describe("GraphQLAttachmentsService", () => {
	beforeEach(() => {
		mockRawRequest.mockReset();
	});

	describe("transformAttachment", () => {
		it("transforms a minimal attachment", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				issue: {
					attachments: {
						nodes: [{ id: "att-1", url: "https://example.com/file.pdf" }],
					},
				},
			});
			const results = await service.listAttachments("issue-1");
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("att-1");
			expect(results[0].url).toBe("https://example.com/file.pdf");
			expect(results[0].title).toBeUndefined();
		});

		it("transforms attachment with all optional fields", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				issue: {
					attachments: {
						nodes: [
							{
								id: "att-2",
								url: "https://example.com/doc.pdf",
								title: "Design Spec",
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-02T00:00:00.000Z",
							},
						],
					},
				},
			});
			const results = await service.listAttachments("issue-1");
			expect(results[0].title).toBe("Design Spec");
			expect(results[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
			expect(results[0].updatedAt).toBe("2026-01-02T00:00:00.000Z");
		});
	});

	describe("createAttachment", () => {
		it("creates an attachment and returns transformed result", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				attachmentCreate: {
					success: true,
					attachment: { id: "att-new", url: "https://example.com/new.pdf" },
				},
			});
			const result = await service.createAttachment({
				issueId: "issue-1",
				url: "https://example.com/new.pdf",
			});
			expect(result.id).toBe("att-new");
			expect(result.url).toBe("https://example.com/new.pdf");
		});

		it("throws on create failure", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				attachmentCreate: { success: false },
			});
			await expect(
				service.createAttachment({
					issueId: "issue-1",
					url: "https://example.com/fail.pdf",
				}),
			).rejects.toThrow("Failed to create attachment on issue issue-1");
		});
	});

	describe("deleteAttachment", () => {
		it("returns true on successful delete", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				attachmentDelete: { success: true },
			});
			const result = await service.deleteAttachment("att-1");
			expect(result).toBe(true);
		});

		it("throws on delete failure", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				attachmentDelete: { success: false },
			});
			await expect(service.deleteAttachment("att-1")).rejects.toThrow(
				"Failed to delete attachment: att-1",
			);
		});
	});

	describe("listAttachments", () => {
		it("throws when issue not found", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({ issue: null });
			await expect(service.listAttachments("nonexistent")).rejects.toThrow(
				"Issue not found: nonexistent",
			);
		});

		it("returns multiple attachments", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				issue: {
					attachments: {
						nodes: [
							{ id: "att-1", url: "https://example.com/a.pdf" },
							{ id: "att-2", url: "https://example.com/b.pdf" },
						],
					},
				},
			});
			const results = await service.listAttachments("issue-1");
			expect(results).toHaveLength(2);
			expect(results[0].id).toBe("att-1");
			expect(results[1].id).toBe("att-2");
		});
	});
});
