import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";
import { logger } from "../utils/logger.js";

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
		mockResolveIssueId.mockResolvedValue("resolved-uuid");
		mockResolveUserId.mockResolvedValue(undefined);
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

		it("normalizes literal newline escapes in inline body text", async () => {
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--body",
				"First line\\nSecond line\\r\\nThird line",
			]);

			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("commentCreate"),
				expect.objectContaining({
					input: expect.objectContaining({
						body: "First line\nSecond line\nThird line",
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

		it("attaches a mentions field and ships bodyData when an @name resolves (DEV-4987)", async () => {
			mockResolveUserId.mockResolvedValue("user-alice");
			const program = createTestProgram();
			setupCommentsCommands(program);
			// --no-auto-mention skips the `{ viewer }` self-fetch so the create
			// mutation is the first rawRequest call; explicit @name resolution
			// runs regardless of the flag.
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--no-auto-mention",
				"--body",
				"cc @alice please review",
			]);

			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					mentions: {
						resolved: [{ label: "alice", userId: "user-alice" }],
						unresolved: [],
						delivered: true,
					},
				}),
			);
			// A resolved mention takes the structured bodyData path (real notification).
			const input = (
				mockRawRequest.mock.calls[0][1] as { input: Record<string, unknown> }
			).input;
			expect(input).toHaveProperty("bodyData");
		});

		it("warns on stderr and reports an unresolved @name as plain text (DEV-4987)", async () => {
			mockResolveUserId.mockRejectedValue(new Error("not found"));
			const errSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--no-auto-mention",
				"--body",
				"cc @ghost",
			]);

			expect(errSpy).toHaveBeenCalledWith(
				expect.stringContaining("@ghost did not resolve to a team member"),
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					mentions: expect.objectContaining({
						resolved: [],
						unresolved: ["ghost"],
					}),
				}),
			);
			// Nothing resolved → plain markdown body, not bodyData.
			const input = (
				mockRawRequest.mock.calls[0][1] as { input: Record<string, unknown> }
			).input;
			expect(input).toHaveProperty("body");
			expect(input).not.toHaveProperty("bodyData");
			errSpy.mockRestore();
		});

		it("does not warn on hyphenated scoped package coordinates (DEV-5202)", async () => {
			const errSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--no-auto-mention",
				"--body",
				"Pin @ast-grep/napi@0.44.0 before rerunning the audit.",
			]);

			expect(mockResolveUserId).not.toHaveBeenCalled();
			expect(errSpy).not.toHaveBeenCalled();
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("commentCreate"),
				expect.objectContaining({
					input: expect.objectContaining({
						issueId: "resolved-uuid",
						body: "Pin @ast-grep/napi@0.44.0 before rerunning the audit.",
					}),
				}),
			);
			errSpy.mockRestore();
		});

		it("marks mentions undelivered and warns when bodyData is rejected and falls back (DEV-4987)", async () => {
			mockResolveUserId.mockResolvedValue("user-alice");
			// First attempt (bodyData) is rejected by Linear; the default
			// beforeEach mockResolvedValue serves the plain-body retry.
			mockRawRequest.mockRejectedValueOnce(
				new Error(
					"Invalid bodyData value. Value must be a valid prosemirror document.",
				),
			);
			const errSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const program = createTestProgram();
			setupCommentsCommands(program);
			// --no-auto-mention skips the `{ viewer }` self-fetch so the
			// mockRejectedValueOnce lands on the create mutation, not the
			// viewer query — the create's bodyData attempt is what must fail.
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--no-auto-mention",
				"--body",
				"cc @alice",
			]);

			expect(errSpy).toHaveBeenCalledWith(
				expect.stringContaining("were NOT delivered as notifications"),
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					mentions: expect.objectContaining({ delivered: false }),
				}),
			);
			errSpy.mockRestore();
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
			writeFileSync(filePath, "Body from file with literal \\n");

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
						body: "Body from file with literal \\n",
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

		it("does not call API when both --body and --body-file are given (mutually exclusive)", async () => {
			tmpDir = mkdtempSync(join(tmpdir(), "comments-test-"));
			const filePath = join(tmpDir, "body.md");
			writeFileSync(filePath, "Body from file");
			const infoSpy = vi.spyOn(logger, "info");

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"create",
				"ENG-123",
				"--body",
				"inline body",
				"--body-file",
				filePath,
			]);

			expect(mockRawRequest).not.toHaveBeenCalled();
			// Pin the actual contract: it's the mutual-exclusivity guard that
			// fired, not some other early throw (outputError logs the JSON error
			// via logger.info).
			expect(infoSpy).toHaveBeenCalledWith(
				expect.stringContaining("mutually exclusive"),
			);
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
			writeFileSync(filePath, "Updated from file with literal \\n");

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
						body: "Updated from file with literal \\n",
					}),
				}),
			);
		});

		it("normalizes literal newline escapes in inline update body text", async () => {
			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"update",
				"comment-uuid",
				"--body",
				"First line\\nSecond line",
			]);

			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("commentUpdate"),
				expect.objectContaining({
					input: expect.objectContaining({
						body: "First line\nSecond line",
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

		it("does not call API when both --body and --body-file are given (mutually exclusive)", async () => {
			tmpDir = mkdtempSync(join(tmpdir(), "comments-test-"));
			const filePath = join(tmpDir, "body.md");
			writeFileSync(filePath, "Updated from file");
			const infoSpy = vi.spyOn(logger, "info");

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"update",
				"comment-uuid",
				"--body",
				"inline body",
				"--body-file",
				filePath,
			]);

			expect(mockRawRequest).not.toHaveBeenCalled();
			expect(infoSpy).toHaveBeenCalledWith(
				expect.stringContaining("mutually exclusive"),
			);
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

	describe("comments read", () => {
		const commentResponse = {
			comment: {
				id: "c5d15b28-0000-4000-8000-000000000000",
				body: "Full comment body\nwith a second line.",
				url: "https://linear.app/test/issue/DEV-1#comment-c5d15b28",
				user: {
					id: "u1",
					name: "Test User",
					displayName: null,
					url: null,
				},
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				issue: { id: "issue-1", identifier: "DEV-1" },
			},
		};

		it("reads a full comment id and emits the comment payload", async () => {
			mockRawRequest.mockResolvedValue(commentResponse);

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"read",
				"c5d15b28-0000-4000-8000-000000000000",
			]);

			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("comment(id: $id, hash: $hash)"),
				{ id: "c5d15b28-0000-4000-8000-000000000000" },
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "c5d15b28-0000-4000-8000-000000000000",
					body: "Full comment body\nwith a second line.",
				}),
			);
		});

		it("accepts a Linear #comment hash anchor", async () => {
			mockRawRequest.mockResolvedValue(commentResponse);

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"read",
				"https://linear.app/test/issue/DEV-1#comment-c5d15b28",
			]);

			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("comment(id: $id, hash: $hash)"),
				{ hash: "c5d15b28" },
			);
		});

		it("prints the raw body with --body and no JSON envelope", async () => {
			mockRawRequest.mockResolvedValue(commentResponse);
			const stdoutSpy = vi
				.spyOn(process.stdout, "write")
				.mockImplementation(() => true);

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, [
				"comments",
				"read",
				"comment-c5d15b28",
				"--body",
			]);

			expect(stdoutSpy).toHaveBeenCalledWith(
				"Full comment body\nwith a second line.\n",
			);
			expect(mockOutputSuccess).not.toHaveBeenCalled();
			stdoutSpy.mockRestore();
		});
	});

	describe("comments list", () => {
		const listResponse = {
			issue: {
				id: "issue-1",
				identifier: "DEV-1",
				comments: {
					nodes: [
						{
							id: "c1",
							body: "first body",
							user: {
								id: "u1",
								name: "Test User",
								displayName: null,
								url: null,
							},
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
						},
						{
							id: "c2",
							body: "second body\nline two",
							user: {
								id: "u2",
								name: "Other User",
								displayName: null,
								url: null,
							},
							createdAt: "2026-01-02T00:00:00.000Z",
							updatedAt: "2026-01-02T00:00:00.000Z",
						},
					],
				},
			},
		};

		it("lists comments with ids in the output payload", async () => {
			mockRawRequest.mockResolvedValue(listResponse);

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, ["comments", "list", "DEV-1"]);

			expect(mockResolveIssueId).toHaveBeenCalledWith("DEV-1");
			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					data: [
						expect.objectContaining({ id: "c1", body: "first body" }),
						expect.objectContaining({
							id: "c2",
							body: "second body\nline two",
						}),
					],
					meta: { count: 2, issue: "DEV-1" },
				}),
			);
		});

		it("prints complete comment bodies as text blocks with --body", async () => {
			mockRawRequest.mockResolvedValue(listResponse);
			const stdoutSpy = vi
				.spyOn(process.stdout, "write")
				.mockImplementation(() => true);

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, ["comments", "list", "DEV-1", "--body"]);

			expect(stdoutSpy).toHaveBeenCalledWith(
				"comment c1\n\nfirst body\n\n---\n\ncomment c2\n\nsecond body\nline two\n",
			);
			expect(mockOutputSuccess).not.toHaveBeenCalled();
			stdoutSpy.mockRestore();
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
			// handleAsyncCommand routes the throw to outputError, which emits the
			// `{ error }` envelope via logger.info — spy it to assert the message.
			const loggerInfo = vi.spyOn(logger, "info").mockImplementation(() => {});

			const program = createTestProgram();
			setupCommentsCommands(program);
			await runCommand(program, ["comments", "delete", "comment-uuid"]);

			// The delete WAS attempted (so we're guarding the `if (!success)`
			// branch, not an early bail)...
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("commentDelete"),
				{ id: "comment-uuid" },
			);
			// ...the success path did NOT fire...
			expect(mockOutputSuccess).not.toHaveBeenCalled();
			// ...and the error envelope names the comment that failed.
			expect(loggerInfo).toHaveBeenCalledWith(
				expect.stringContaining('Failed to delete comment \\"comment-uuid\\"'),
			);
			loggerInfo.mockRestore();
		});
	});
});
