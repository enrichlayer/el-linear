import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRawRequest = vi.fn();

vi.mock("./graphql-service.js", () => ({
	createGraphQLService: vi.fn().mockReturnValue({ rawRequest: mockRawRequest }),
}));

const { createGraphQLDocumentsService } = await import(
	"./graphql-documents-service.js"
);

function createService() {
	return createGraphQLDocumentsService({ apiToken: "test-token" });
}

describe("GraphQLDocumentsService", () => {
	beforeEach(() => {
		mockRawRequest.mockReset();
	});

	describe("transformDocument", () => {
		it("transforms a minimal document", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				document: {
					id: "doc-1",
					title: "Test Doc",
				},
			});
			const result = await service.getDocument("doc-1");
			expect(result.id).toBe("doc-1");
			expect(result.title).toBe("Test Doc");
			expect(result.content).toBeUndefined();
			expect(result.creator).toBeUndefined();
			expect(result.project).toBeUndefined();
			expect(result.issue).toBeUndefined();
		});

		it("transforms document with all optional fields", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				document: {
					id: "doc-2",
					title: "Full Doc",
					content: "# Hello",
					color: "#ff0000",
					icon: "doc-icon",
					slugId: "full-doc-slug",
					url: "https://linear.app/doc/full-doc-slug",
					creator: { id: "user-1", name: "Alice" },
					project: { id: "proj-1", name: "Project Alpha" },
					issue: {
						id: "issue-1",
						identifier: "DEV-100",
						title: "Related Issue",
					},
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-02T00:00:00.000Z",
				},
			});
			const result = await service.getDocument("doc-2");
			expect(result.content).toBe("# Hello");
			expect(result.color).toBe("#ff0000");
			expect(result.icon).toBe("doc-icon");
			expect(result.slugId).toBe("full-doc-slug");
			expect(result.url).toBe("https://linear.app/doc/full-doc-slug");
			expect(result.creator).toEqual({ id: "user-1", name: "Alice" });
			expect(result.project).toEqual({ id: "proj-1", name: "Project Alpha" });
			expect(result.issue).toEqual({
				id: "issue-1",
				identifier: "DEV-100",
				title: "Related Issue",
			});
			expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
			expect(result.updatedAt).toBe("2026-01-02T00:00:00.000Z");
		});
	});

	describe("createDocument", () => {
		it("creates a document and returns transformed result", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documentCreate: {
					success: true,
					document: { id: "doc-new", title: "New Doc" },
				},
			});
			const result = await service.createDocument({ title: "New Doc" });
			expect(result.id).toBe("doc-new");
			expect(result.title).toBe("New Doc");
		});

		it("throws on create failure", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documentCreate: { success: false },
			});
			await expect(
				service.createDocument({ title: "Fail Doc" }),
			).rejects.toThrow('Failed to create document "Fail Doc"');
		});
	});

	describe("updateDocument", () => {
		it("updates a document and returns transformed result", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documentUpdate: {
					success: true,
					document: { id: "doc-1", title: "Updated Title" },
				},
			});
			const result = await service.updateDocument("doc-1", {
				title: "Updated Title",
			});
			expect(result.id).toBe("doc-1");
			expect(result.title).toBe("Updated Title");
		});

		it("throws on update failure", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documentUpdate: { success: false },
			});
			await expect(
				service.updateDocument("doc-1", { title: "X" }),
			).rejects.toThrow("Failed to update document: doc-1");
		});
	});

	describe("getDocument", () => {
		it("throws when document not found", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({ document: null });
			await expect(service.getDocument("nonexistent")).rejects.toThrow(
				"Document not found: nonexistent",
			);
		});
	});

	describe("listDocuments", () => {
		it("lists documents with default limit", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documents: {
					nodes: [
						{ id: "doc-1", title: "Doc A" },
						{ id: "doc-2", title: "Doc B" },
					],
				},
			});
			const results = await service.listDocuments();
			expect(results).toHaveLength(2);
			expect(results[0].title).toBe("Doc A");
			expect(results[1].title).toBe("Doc B");
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ first: 50 }),
			);
		});

		it("lists documents with project filter", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documents: { nodes: [{ id: "doc-1", title: "Project Doc" }] },
			});
			await service.listDocuments({ projectId: "proj-1" });
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					filter: { project: { id: { eq: "proj-1" } } },
				}),
			);
		});

		it("lists documents with custom limit", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({ documents: { nodes: [] } });
			await service.listDocuments({ first: 10 });
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ first: 10 }),
			);
		});
	});

	describe("deleteDocument", () => {
		it("returns true on successful delete", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documentDelete: { success: true },
			});
			const result = await service.deleteDocument("doc-1");
			expect(result).toBe(true);
		});

		it("throws on delete failure", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documentDelete: { success: false },
			});
			await expect(service.deleteDocument("doc-1")).rejects.toThrow(
				"Failed to delete document: doc-1",
			);
		});
	});

	describe("listDocumentsBySlugIds", () => {
		it("returns empty array for empty slugIds", async () => {
			const service = createService();
			const results = await service.listDocumentsBySlugIds([]);
			expect(results).toEqual([]);
			expect(mockRawRequest).not.toHaveBeenCalled();
		});

		it("builds OR filter for multiple slugIds", async () => {
			const service = createService();
			mockRawRequest.mockResolvedValue({
				documents: {
					nodes: [
						{ id: "doc-1", title: "Doc A", slugId: "slug-a" },
						{ id: "doc-2", title: "Doc B", slugId: "slug-b" },
					],
				},
			});
			const results = await service.listDocumentsBySlugIds([
				"slug-a",
				"slug-b",
			]);
			expect(results).toHaveLength(2);
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					first: 2,
					filter: {
						or: [{ slugId: { eq: "slug-a" } }, { slugId: { eq: "slug-b" } }],
					},
				}),
			);
		});
	});
});
