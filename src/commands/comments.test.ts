import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	let tmpDir: string | undefined;

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

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
			tmpDir = undefined;
		}
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

		it("reads body from --body-file", async () => {
			tmpDir = mkdtempSync(join(tmpdir(), "comments-test-"));
			const filePath = join(tmpDir, "body.md");
			writeFileSync(filePath, "Body from file");

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--body-file",
				filePath,
			]);

			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("commentCreate"),
				expect.objectContaining({
					input: expect.objectContaining({
						body: "Body from file",
					}),
				}),
			);
		});

		it("does not call API when --body-file path does not exist", async () => {
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--body-file",
				"/nonexistent/path/body.md",
			]);

			expect(mockRawRequest).not.toHaveBeenCalled();
		});
	});

	describe("comments update", () => {
		beforeEach(() => {
			mockRawRequest.mockResolvedValue({
				commentUpdate: {
					success: true,
					comment: {
						id: "c1",
						body: "Updated body",
						user: { id: "u1", name: "Test User" },
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
					},
				},
			});
		});

		it("reads body from --body-file", async () => {
			tmpDir = mkdtempSync(join(tmpdir(), "comments-test-"));
			const filePath = join(tmpDir, "body.md");
			writeFileSync(filePath, "Updated from file");

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"update",
				"comment-uuid",
				"--body-file",
				filePath,
			]);

			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("commentUpdate"),
				expect.objectContaining({
					input: expect.objectContaining({
						body: "Updated from file",
					}),
				}),
			);
		});

		it("does not call API when --body-file path does not exist", async () => {
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"update",
				"comment-uuid",
				"--body-file",
				"/nonexistent/path/body.md",
			]);

			expect(mockRawRequest).not.toHaveBeenCalled();
		});

		it("does not call API when neither --body nor --body-file is provided", async () => {
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, ["comments", "update", "comment-uuid"]);

			expect(mockRawRequest).not.toHaveBeenCalled();
		});
	});

	// DEV-4261: handleUpdateComment used to send `bodyData` straight through
	// without the `BODY_DATA_ERROR_RE` try/catch that handleCreateComment has,
	// so any future schema drift in the prosemirror converter would silently
	// break updates while creates kept working via the markdown-body fallback.
	// These tests lock in symmetric coverage — both paths retry with raw body
	// on the same family of validation errors. Covers create-side too since
	// the same pattern is now exercised twice in the suite.
	describe("bodyData fallback to raw markdown (DEV-4261)", () => {
		// Use an @mention so the handler takes the `input.bodyData` branch
		// (the fallback only fires when `input.bodyData` was set — a body
		// without mentions skips the converter entirely and gets `input.body`
		// from the start). Pass `--no-auto-mention` to skip the bare-name
		// scan AND the `fetchSelfUserId` graphql call that would otherwise
		// consume one of our `mockRejectedValueOnce` / `mockResolvedValueOnce`
		// stubs before the mutation runs. Explicit `@alice` resolution is
		// unaffected by `--no-auto-mention`; only bare names are gated.
		const BODY_WITH_MENTION = "@alice please confirm";
		const VALIDATOR_ERROR = new Error(
			"GraphQL request failed: Invalid bodyData value. Value must be a valid prosemirror document.",
		);

		beforeEach(() => {
			mockResolveUserId.mockResolvedValue("alice-uuid");
		});

		it("comments update: retries with raw body when Linear rejects bodyData", async () => {
			// First call (with bodyData) throws the validator error; second
			// call (the fallback, with raw `body`) succeeds.
			mockRawRequest
				.mockRejectedValueOnce(VALIDATOR_ERROR)
				.mockResolvedValueOnce({
					commentUpdate: {
						success: true,
						comment: {
							id: "c1",
							body: BODY_WITH_MENTION,
							user: { id: "u1", name: "Test User" },
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
						},
					},
				});

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"update",
				"comment-uuid",
				"--body",
				BODY_WITH_MENTION,
				"--no-auto-mention",
			]);

			expect(mockRawRequest).toHaveBeenCalledTimes(2);
			// First attempt used the bodyData path (the failure trigger).
			const firstCallInput = (
				mockRawRequest.mock.calls[0][1] as { input: Record<string, unknown> }
			).input;
			expect(firstCallInput).toHaveProperty("bodyData");
			expect(firstCallInput).not.toHaveProperty("body");
			// Retry sent raw markdown — Linear converts server-side.
			const secondCallInput = (
				mockRawRequest.mock.calls[1][1] as { input: Record<string, unknown> }
			).input;
			expect(secondCallInput).toEqual({ body: BODY_WITH_MENTION });
			// And the update succeeded from the caller's perspective.
			expect(mockOutputSuccess).toHaveBeenCalled();
		});

		it("comments update: does not retry on unrelated errors (e.g. auth)", async () => {
			// A non-prosemirror error (e.g. auth failure) should NOT fall
			// through to the markdown retry — that would mask the real
			// failure and the caller wouldn't see the auth problem.
			// `handleAsyncCommand` swallows the throw into an error JSON
			// envelope (so `runCommand` resolves rather than rejecting), so
			// we assert the no-retry invariant via call count: exactly ONE
			// rawRequest call, never two.
			mockRawRequest.mockRejectedValue(new Error("401 Unauthorized"));

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"update",
				"comment-uuid",
				"--body",
				BODY_WITH_MENTION,
				"--no-auto-mention",
			]);

			expect(mockRawRequest).toHaveBeenCalledTimes(1);
			// The success path didn't fire, so outputSuccess wasn't called.
			expect(mockOutputSuccess).not.toHaveBeenCalled();
		});

		it("comments create: retries with raw body when Linear rejects bodyData (symmetry check)", async () => {
			mockRawRequest
				.mockRejectedValueOnce(VALIDATOR_ERROR)
				.mockResolvedValueOnce({
					commentCreate: {
						success: true,
						comment: {
							id: "c1",
							body: BODY_WITH_MENTION,
							user: { id: "u1", name: "Test User" },
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
						},
					},
				});

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"DEV-1",
				"--body",
				BODY_WITH_MENTION,
				"--no-auto-link",
				"--no-auto-mention",
			]);

			expect(mockRawRequest).toHaveBeenCalledTimes(2);
			const secondCallInput = (
				mockRawRequest.mock.calls[1][1] as { input: Record<string, unknown> }
			).input;
			expect(secondCallInput).toEqual({
				issueId: "resolved-uuid",
				body: BODY_WITH_MENTION,
			});
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

	// DEV-4306: a multi-element body (lists + bold) with a resolved mention must
	// go through the `bodyData` converter path on update and *succeed on the
	// first attempt* — no fallback to raw markdown (which would drop the
	// mention). Locks create/update parity at the handler level; the converter
	// shape itself is covered in mention-resolver.test.ts.
	describe("comments update: rich body takes the bodyData path (DEV-4306)", () => {
		it("sends bodyData (not raw body) and does not fall back for a list + bold + mention", async () => {
			mockResolveUserId.mockResolvedValue("alice-uuid");
			mockRawRequest.mockResolvedValue({
				commentUpdate: {
					success: true,
					comment: {
						id: "c1",
						body: "updated",
						user: { id: "u1", name: "Test User" },
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
					},
				},
			});

			const richBody = [
				"@alice please review:",
				"",
				"- **Item one** with detail",
				"- Item two",
				"",
				"Done.",
			].join("\n");

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"update",
				"comment-uuid",
				"--body",
				richBody,
				// Skip auto-link (and its ref-validation roundtrips) and the
				// bare-name self-id fetch so the only rawRequest is the mutation.
				"--no-auto-link",
				"--no-auto-mention",
			]);

			// Exactly one rawRequest: no validator rejection, no retry.
			expect(mockRawRequest).toHaveBeenCalledTimes(1);
			const input = (
				mockRawRequest.mock.calls[0][1] as { input: Record<string, unknown> }
			).input;
			expect(input).toHaveProperty("bodyData");
			expect(input).not.toHaveProperty("body");

			// The converted doc carries the rich structure AND the mention.
			const types = new Set<string>();
			const walk = (node: { type: string; content?: unknown[] }) => {
				types.add(node.type);
				for (const c of (node.content ?? []) as (typeof node)[]) walk(c);
			};
			walk(
				(input.bodyData as { type: string; content?: unknown[] }) ?? {
					type: "",
				},
			);
			expect(types.has("bullet_list")).toBe(true);
			expect(types.has("suggestion_userMentions")).toBe(true);
			expect(mockOutputSuccess).toHaveBeenCalled();
		});
	});

	describe("comments delete", () => {
		it("deletes a comment by id and reports success", async () => {
			mockRawRequest.mockResolvedValue({ commentDelete: { success: true } });

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, ["comments", "delete", "comment-uuid"]);

			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("commentDelete"),
				{ id: "comment-uuid" },
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				id: "comment-uuid",
				deleted: true,
			});
		});

		it("aliases: 'rm' resolves to the same handler", async () => {
			mockRawRequest.mockResolvedValue({ commentDelete: { success: true } });

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, ["comments", "rm", "comment-uuid"]);

			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("commentDelete"),
				{ id: "comment-uuid" },
			);
		});

		it("throws (no success output) when the API reports failure", async () => {
			mockRawRequest.mockResolvedValue({ commentDelete: { success: false } });

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, ["comments", "delete", "comment-uuid"]);

			// handleAsyncCommand swallows the throw into an error envelope, so
			// the success path must not have fired.
			expect(mockOutputSuccess).not.toHaveBeenCalled();
		});
	});
});
