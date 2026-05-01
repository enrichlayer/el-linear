import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

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

// Pin the workspace URL so getWorkspaceUrlKey skips the API roundtrip in tests.
vi.mock("../config/config.js", () => ({
	loadConfig: vi.fn().mockReturnValue({
		defaultTeam: "",
		defaultLabels: [],
		labels: { workspace: {}, teams: {} },
		members: { aliases: {}, fullNames: {}, handles: {}, uuids: {} },
		teams: {},
		teamAliases: {},
		statusDefaults: { noProject: "Triage", withAssigneeAndProject: "Todo" },
		terms: [],
		workspaceUrlKey: "test",
	}),
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
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--body",
				"Looks good!",
			]);

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
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--body",
				"Looks good!",
			]);

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

	// Handler-level integration tests for the auto-link composition on comments.
	// Mirrors the matrix in issues.test.ts: prose keywords must produce the right
	// relation type/direction when sent through the create/update command flow.
	describe("auto-link composition (handler integration)", () => {
		function setupAutoLinkMocks(resolvedIds: Record<string, string>): void {
			mockResolveIssueId.mockImplementation((id: string) => {
				if (id in resolvedIds) {
					return Promise.resolve(resolvedIds[id]);
				}
				if (id === "DEV-999") {
					return Promise.resolve("uuid-source");
				}
				return Promise.reject(new Error(`Issue "${id}" not found`));
			});
			mockRawRequest.mockImplementation((query: string, vars: unknown) => {
				if (query.includes("CreateComment")) {
					return Promise.resolve({
						commentCreate: {
							success: true,
							comment: {
								id: "c1",
								body: "ok",
								user: { id: "u1", name: "Test User" },
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
							},
						},
					});
				}
				if (query.includes("UpdateComment")) {
					return Promise.resolve({
						commentUpdate: {
							success: true,
							comment: {
								id: "c1",
								body: "ok",
								user: { id: "u1", name: "Test User" },
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
								issue: { id: "uuid-source", identifier: "DEV-999" },
							},
						},
					});
				}
				if (query.includes("GetIssueRelations")) {
					return Promise.resolve({
						issue: {
							relations: { nodes: [] },
							inverseRelations: { nodes: [] },
						},
					});
				}
				if (query.includes("IssueRelationCreate")) {
					const input = (
						vars as {
							input: { issueId: string; relatedIssueId: string; type: string };
						}
					).input;
					return Promise.resolve({
						issueRelationCreate: {
							success: true,
							issueRelation: {
								id: "rel-new",
								type: input.type,
								issue: { id: input.issueId, identifier: "X", title: "" },
								relatedIssue: {
									id: input.relatedIssueId,
									identifier: "Y",
									title: "",
								},
							},
						},
					});
				}
				if (query.includes("viewer")) {
					return Promise.resolve({ viewer: { id: "self-uuid" } });
				}
				return Promise.resolve({});
			});
		}

		function findRelationCreateInput():
			| {
					issueId: string;
					relatedIssueId: string;
					type: string;
			  }
			| undefined {
			const call = mockRawRequest.mock.calls.find(
				(c: unknown[]) =>
					typeof c[0] === "string" &&
					(c[0] as string).includes("IssueRelationCreate"),
			);
			return (
				call?.[1] as
					| { input: { issueId: string; relatedIssueId: string; type: string } }
					| undefined
			)?.input;
		}

		it("comments create: 'blocked by DEV-X' creates a reversed 'blocks' relation on the parent issue", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"DEV-999",
				"--body",
				"blocked by DEV-100",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-100",
				relatedIssueId: "uuid-source",
				type: "blocks",
			});
		});

		it("comments create: 'duplicates DEV-X' creates a forward 'duplicate' relation", async () => {
			setupAutoLinkMocks({ "DEV-50": "uuid-50" });
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"DEV-999",
				"--body",
				"this duplicates DEV-50",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-50",
				type: "duplicate",
			});
		});

		it("comments create: bare reference creates a 'related' relation", async () => {
			setupAutoLinkMocks({ "DEV-77": "uuid-77" });
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"DEV-999",
				"--body",
				"see DEV-77 for context",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-77",
				type: "related",
			});
		});

		it("comments create: --no-auto-link suppresses wrapping and relation creation", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"DEV-999",
				"--body",
				"blocked by DEV-100",
				"--no-auto-link",
			]);
			expect(findRelationCreateInput()).toEqual(undefined);
		});

		it("comments update: 'depends on DEV-X' creates a reversed 'blocks' relation", async () => {
			setupAutoLinkMocks({ "DEV-77": "uuid-77" });
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"update",
				"comment-uuid",
				"--body",
				"this depends on DEV-77",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-77",
				relatedIssueId: "uuid-source",
				type: "blocks",
			});
		});
	});
});
