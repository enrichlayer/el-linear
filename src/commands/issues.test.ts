import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

// -- Mock function declarations (before vi.mock) --

const mockGetIssues = vi.fn();
const mockGetIssueById = vi.fn();
const mockCreateIssue = vi.fn();
const mockUpdateIssue = vi.fn();
const mockSearchIssues = vi.fn();
const mockArchiveIssue = vi.fn();
const mockDeleteIssue = vi.fn();
const mockStartIssue = vi.fn();
const mockClaimIssue = vi.fn();

class MockGraphQLIssuesService {
	getIssues = mockGetIssues;
	getIssueById = mockGetIssueById;
	createIssue = mockCreateIssue;
	updateIssue = mockUpdateIssue;
	searchIssues = mockSearchIssues;
	archiveIssue = mockArchiveIssue;
	deleteIssue = mockDeleteIssue;
	startIssue = mockStartIssue;
	claimIssue = mockClaimIssue;
}

vi.mock("../utils/graphql-issues-service.js", () => ({
	GraphQLIssuesService: MockGraphQLIssuesService,
}));

const mockGraphQLService = { rawRequest: vi.fn() };
const mockCreateGraphQLService = vi.fn().mockResolvedValue(mockGraphQLService);
vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: mockCreateGraphQLService,
}));

const mockLinearService = {
	resolveIssueId: vi.fn(),
	resolveProjectId: vi.fn(),
	resolveTeamId: vi.fn(),
};
const mockCreateLinearService = vi.fn().mockResolvedValue(mockLinearService);
vi.mock("../utils/linear-service.js", () => ({
	createLinearService: mockCreateLinearService,
}));

const mockOutputSuccess = vi.fn();
const mockOutputWarning = vi.fn();
vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return {
		...actual,
		outputSuccess: mockOutputSuccess,
		outputWarning: mockOutputWarning,
	};
});

// Mock the gate-telemetry emit so the dup-gate tests don't write to the real
// ~/.cache/el-telemetry ledger and can assert the recorded outcome (DEV-4834).
const mockEmitGateEvent = vi.fn();
vi.mock("../utils/gate-telemetry.js", () => ({
	emitGateEvent: mockEmitGateEvent,
}));

const mockResolveTeam = vi
	.fn()
	.mockImplementation((v: string) => `team-id-${v}`);
const mockResolveMember = vi
	.fn()
	.mockImplementation((v: string) => `member-id-${v}`);
const mockResolveMemberWithRegistry = vi
	.fn()
	.mockImplementation((v: string) => Promise.resolve(`member-id-${v}`));
const mockResolveAssignee = vi
	.fn()
	.mockImplementation((v: string) => Promise.resolve(`member-id-${v}`));
const mockResolveLabels = vi.fn().mockReturnValue([]);
vi.mock("../config/resolver.js", () => ({
	resolveTeam: mockResolveTeam,
	resolveMember: mockResolveMember,
	resolveMemberWithRegistry: mockResolveMemberWithRegistry,
	resolveAssignee: mockResolveAssignee,
	resolveLabels: mockResolveLabels,
}));

const baseConfig = {
	defaultTeam: "DEV",
	labels: { workspace: {} },
	members: {},
	teams: {},
	// Validation tested in issue-validation.test.ts — disable here to isolate command wiring
	validation: { enabled: false },
	// Pin the workspace URL so getWorkspaceUrlKey skips the API roundtrip in tests.
	workspaceUrlKey: "test",
};
const mockLoadConfig = vi.fn().mockReturnValue(baseConfig);
vi.mock("../config/config.js", () => ({
	loadConfig: mockLoadConfig,
}));

const mockEnforceTerms = vi.fn();
vi.mock("../config/term-enforcer.js", () => ({
	enforceTerms: mockEnforceTerms,
}));

vi.mock("../utils/auth.js", () => ({
	getApiToken: vi.fn().mockReturnValue("test-token"),
}));

const mockUploadFile = vi.fn();
const mockFileServiceInstance = { uploadFile: mockUploadFile };
vi.mock("../utils/file-service.js", () => ({
	createFileService: vi.fn().mockResolvedValue(mockFileServiceInstance),
	FileService: class {
		uploadFile = mockUploadFile;
	},
}));

const mockCreateAttachment = vi.fn();
vi.mock("../utils/graphql-attachments-service.js", () => ({
	createGraphQLAttachmentsService: vi.fn().mockResolvedValue({
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
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		consoleErrorSpy = stdoutSpy; // errors now go to stdout
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		mockResolveTeam.mockImplementation((v: string) => `team-id-${v}`);
		mockResolveMember.mockImplementation((v: string) => `member-id-${v}`);
		mockResolveLabels.mockReturnValue([]);
		mockResolveDefaultStatus.mockReturnValue(undefined);
		mockCreateGraphQLService.mockResolvedValue(mockGraphQLService);
		mockCreateLinearService.mockResolvedValue(mockLinearService);
		// vi.clearAllMocks resets call counts but not implementations set via
		// mockReturnValue — re-pin the default loadConfig to the bare baseline
		// so individual tests start with a clean slate.
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	describe("issues list", () => {
		it("defaults to excluding terminal states — routes through searchIssues with excludeTerminalStates:true (DEV-4478)", async () => {
			mockSearchIssues.mockResolvedValue([]);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "list"]);

			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({
					excludeTerminalStates: true,
					status: undefined,
					limit: 25,
				}),
			);
			// No raw getIssues fetch when the filter is on by default.
			expect(mockGetIssues).not.toHaveBeenCalled();
		});

		it("--include-closed alone routes through searchIssues with excludeTerminalStates:false (DEV-4478 cycle-1)", async () => {
			// Cycle-1 bug: falling through to getIssues silently dropped Done
			// issues because GET_ISSUES_QUERY hard-codes `state.type.neq: "completed"`.
			// The fix: any --include-closed invocation goes through searchIssues
			// so the CLI controls the GraphQL filter end-to-end (no state filter
			// when both excludeTerminalStates and status are absent).
			mockSearchIssues.mockResolvedValue([]);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "list", "--include-closed"]);

			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({
					excludeTerminalStates: false,
					status: undefined,
					limit: 25,
				}),
			);
			expect(mockGetIssues).not.toHaveBeenCalled();
		});

		it("--include-closed combined with --team also routes through searchIssues with excludeTerminalStates:false (DEV-4478)", async () => {
			// The pre-cycle-1 routing already handled this case correctly via
			// hasOtherFilters; lock it in so the cycle-1 fix doesn't regress
			// the multi-flag combination.
			mockSearchIssues.mockResolvedValue([]);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"list",
				"--include-closed",
				"--team",
				"DEV",
			]);

			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({
					teamId: "team-id-DEV",
					excludeTerminalStates: false,
					status: undefined,
				}),
			);
			expect(mockGetIssues).not.toHaveBeenCalled();
		});

		it("explicit --status wins over the implicit terminal-state filter", async () => {
			mockSearchIssues.mockResolvedValue([]);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"list",
				"--status",
				"Done,Canceled",
			]);

			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({
					status: ["Done", "Canceled"],
					excludeTerminalStates: false,
				}),
			);
		});

		it("passes --limit through with the default filter on", async () => {
			mockSearchIssues.mockResolvedValue([]);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "list", "--limit", "10"]);

			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({ limit: 10, excludeTerminalStates: true }),
			);
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
				delegateId: undefined,
				project: undefined,
				labelNames: undefined,
				status: undefined,
				excludeTerminalStates: true,
				priority: undefined,
				orderBy: "updatedAt",
				limit: 25,
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: filteredIssues,
				meta: { count: 2, team: "DEV" },
			});
		});

		it("filters results by --delegate", async () => {
			mockSearchIssues.mockResolvedValue([]);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "list", "--delegate", "claude"]);

			expect(mockResolveMemberWithRegistry).toHaveBeenCalledWith("claude");
			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({
					delegateId: "member-id-claude",
				}),
			);
		});

		it("--project filters with kind=id discriminant (DEV-4068 T4)", async () => {
			mockSearchIssues.mockResolvedValue([]);
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "list", "--project", "Auth"]);
			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({
					project: { kind: "id", id: "Auth" },
				}),
			);
		});

		it("--no-project filters with kind=none discriminant (DEV-4068 T4)", async () => {
			mockSearchIssues.mockResolvedValue([]);
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "list", "--no-project"]);
			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({
					project: { kind: "none" },
				}),
			);
		});
	});

	describe("issues read", () => {
		it("calls getIssueById with the issue identifier", async () => {
			const issueData = {
				id: "uuid-1",
				identifier: "DEV-123",
				title: "My issue",
			};
			mockGetIssueById.mockResolvedValue(issueData);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "read", "DEV-123"]);

			expect(mockGetIssueById).toHaveBeenCalledWith("DEV-123");
			expect(mockOutputSuccess).toHaveBeenCalledWith(issueData);
		});
	});

	describe("issues search — relation_candidates warning (DEV-4494)", () => {
		// Composition lock for the primary dup-check path: handleSearchIssues
		// → buildRelationCandidatePrompt → outputWarning. search.test.ts covers
		// the cross-resource `search` command; this covers the `issues search`
		// wiring the linear-operations skill actually calls. (cycle-1 nit 1.)
		it("emits the relation_candidates warning when the search returns issue rows", async () => {
			mockSearchIssues.mockResolvedValue([
				{ id: "i1", identifier: "DEV-2134", title: "a" },
				{ id: "i2", identifier: "FIN-77", title: "b" },
			]);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "search", "auth"]);

			expect(mockOutputWarning).toHaveBeenCalledWith(
				expect.stringMatching(/^relation_candidates:/),
			);
			const relationCall = mockOutputWarning.mock.calls.find(
				(c) =>
					typeof c[0] === "string" && c[0].startsWith("relation_candidates:"),
			);
			expect(relationCall?.[0]).toContain("DEV-2134");
			expect(relationCall?.[0]).toContain("FIN-77");
			expect(relationCall?.[0]).toContain("reply with the IDs you want linked");
		});

		it("emits no relation_candidates warning when the search returns nothing", async () => {
			mockSearchIssues.mockResolvedValue([]);

			const program = createTestProgram();
			setupIssuesCommands(program);
			// --include-closed suppresses the unrelated terminal-states warning so
			// the assertion isolates the relation-candidate path.
			await runCommand(program, [
				"issues",
				"search",
				"nope",
				"--include-closed",
			]);

			expect(mockOutputWarning).not.toHaveBeenCalledWith(
				expect.stringMatching(/^relation_candidates:/),
			);
		});
	});

	describe("issues create", () => {
		// Required fields for all create commands (assignee + project enforced)
		const requiredArgs = ["--assignee", "bob", "--project", "Infrastructure"];

		it("creates issue with team resolved from option", async () => {
			mockCreateIssue.mockResolvedValue({
				id: "new-issue-id",
				identifier: "DEV-999",
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"My Title",
				"--team",
				"DEV",
				...requiredArgs,
			]);

			expect(mockResolveTeam).toHaveBeenCalledWith("DEV");
			expect(mockEnforceTerms).toHaveBeenCalledWith(["My Title", undefined], {
				strict: undefined,
			});
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
				"bob",
				"--project",
				"Infrastructure",
			]);

			expect(mockResolveAssignee).toHaveBeenCalledWith(
				"bob",
				expect.any(Object),
			);
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					assigneeId: "member-id-bob",
				}),
			);
		});

		it("passes delegateId when --delegate is provided", async () => {
			mockCreateIssue.mockResolvedValue({ id: "new-issue-id" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				"--delegate",
				"claude",
				...requiredArgs,
			]);

			expect(mockResolveMemberWithRegistry).toHaveBeenCalledWith("claude");
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					delegateId: "member-id-claude",
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
				...requiredArgs,
			]);

			// No team arg: team-scoped labels are resolved API-side against the
			// issue's final (possibly auto-switched) team, not the --team input.
			expect(mockResolveLabels).toHaveBeenCalledWith(["bug", "feature"]);
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					labelIds: ["label-uuid-1", "label-uuid-2"],
				}),
			);
		});

		it("inlines image attachment in description", async () => {
			mockCreateIssue.mockResolvedValue({
				id: "new-issue-id",
				identifier: "DEV-999",
			});
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
				...requiredArgs,
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
			mockCreateIssue.mockResolvedValue({
				id: "new-issue-id",
				identifier: "DEV-999",
			});
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
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					description: "See attached report.",
				}),
			);
			expect(mockCreateAttachment).toHaveBeenCalled();
		});

		it("creates image-only description when no --description provided", async () => {
			mockCreateIssue.mockResolvedValue({
				id: "new-issue-id",
				identifier: "DEV-999",
			});
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
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					description:
						"![photo.jpg](https://uploads.linear.app/asset/image.png)",
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
				...requiredArgs,
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
			// --skip-validation to bypass assignee/project enforcement (testing status resolution)
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				"--skip-validation",
			]);

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

	// DEV-4823: create-time duplicate-detection gate. These assert the real
	// composition (search → score → block), not just the pure scorer
	// (covered in duplicate-detection.test.ts) — per the "test compositions"
	// rule, the gate's value is that the matched candidate actually prevents
	// the create POST.
	describe("issues create — duplicate-detection gate (DEV-4823)", () => {
		// Field validation must be ON for the gate to run, so every create call
		// here supplies valid fields and we vary only the dup-related inputs.
		const validArgs = [
			"--team",
			"DEV",
			"--labels",
			"feature",
			"--description",
			"A sufficiently long description that passes the length check.",
			"--assignee",
			"bob",
			"--project",
			"Infrastructure",
		];
		const enabledConfig = {
			...baseConfig,
			validation: { enabled: true },
		};
		const dupeCandidate = {
			id: "dup-id",
			identifier: "DEV-4818",
			title:
				"Migrate scripts/ generators and tests from .mjs to TypeScript (run via tsx)",
			state: { id: "s", name: "Todo" },
			assignee: { id: "u", name: "Yury" },
		};

		it("blocks creation when a high-similarity issue exists", async () => {
			mockLoadConfig.mockReturnValue(enabledConfig);
			mockSearchIssues.mockResolvedValue([dupeCandidate]);
			mockCreateIssue.mockResolvedValue({ id: "x" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Migrate remaining scripts/*.mjs to TypeScript (52 files)",
				...validArgs,
			]);

			// Searched the salient keywords, including closed issues.
			expect(mockSearchIssues).toHaveBeenCalledWith(
				expect.objectContaining({ excludeTerminalStates: false }),
			);
			// Blocked: the candidate prevented the POST.
			expect(mockCreateIssue).not.toHaveBeenCalled();
			expect(process.exit).toHaveBeenCalledWith(1);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("DEV-4818"),
			);
			// DEV-4834: the blocked decision is recorded for override-rate telemetry.
			expect(mockEmitGateEvent).toHaveBeenCalledWith(
				"el-linear",
				"issues create",
				expect.objectContaining({
					gate: "issues-create-dup",
					outcome: "blocked",
					candidateCount: 1,
				}),
			);
		});

		it("--allow-duplicate runs the gate, records an override, and creates", async () => {
			mockLoadConfig.mockReturnValue(enabledConfig);
			mockSearchIssues.mockResolvedValue([dupeCandidate]);
			mockCreateIssue.mockResolvedValue({ id: "x", identifier: "DEV-999" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Migrate remaining scripts/*.mjs to TypeScript (52 files)",
				...validArgs,
				"--allow-duplicate",
			]);

			// DEV-4834: --allow-duplicate still searches (to detect the would-fire),
			// records `overridden`, then proceeds to create.
			expect(mockSearchIssues).toHaveBeenCalled();
			expect(mockEmitGateEvent).toHaveBeenCalledWith(
				"el-linear",
				"issues create",
				expect.objectContaining({
					gate: "issues-create-dup",
					outcome: "overridden",
				}),
			);
			expect(mockCreateIssue).toHaveBeenCalled();
		});

		it("--allow-duplicate with no real match records nothing and creates", async () => {
			mockLoadConfig.mockReturnValue(enabledConfig);
			mockSearchIssues.mockResolvedValue([
				{
					id: "sd",
					identifier: "DEV-1159",
					title: "Migrate support guide from Notion",
					state: { id: "s", name: "Done" },
				},
			]);
			mockCreateIssue.mockResolvedValue({ id: "x", identifier: "DEV-999" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Migrate remaining scripts/*.mjs to TypeScript (52 files)",
				...validArgs,
				"--allow-duplicate",
			]);

			// No would-fire → no override event (override-rate counts real fires only).
			expect(mockEmitGateEvent).not.toHaveBeenCalled();
			expect(mockCreateIssue).toHaveBeenCalled();
		});

		it("validation.duplicateDetection:false disables only the gate", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				validation: { enabled: true, duplicateDetection: false },
			});
			mockSearchIssues.mockResolvedValue([dupeCandidate]);
			mockCreateIssue.mockResolvedValue({ id: "x", identifier: "DEV-999" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Migrate remaining scripts/*.mjs to TypeScript (52 files)",
				...validArgs,
			]);

			expect(mockSearchIssues).not.toHaveBeenCalled();
			expect(mockCreateIssue).toHaveBeenCalled();
		});

		it("--skip-validation bypasses the gate and emits nothing (DEV-4834)", async () => {
			mockLoadConfig.mockReturnValue(enabledConfig);
			mockSearchIssues.mockResolvedValue([dupeCandidate]);
			mockCreateIssue.mockResolvedValue({ id: "x", identifier: "DEV-999" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Migrate remaining scripts/*.mjs to TypeScript (52 files)",
				...validArgs,
				"--skip-validation",
			]);

			// Blanket bypass: no search, no telemetry (not a gate-specific override,
			// so it must not count toward override-rate), issue created.
			expect(mockSearchIssues).not.toHaveBeenCalled();
			expect(mockEmitGateEvent).not.toHaveBeenCalled();
			expect(mockCreateIssue).toHaveBeenCalled();
		});

		it("does not block on a merely same-domain candidate", async () => {
			mockLoadConfig.mockReturnValue(enabledConfig);
			mockSearchIssues.mockResolvedValue([
				{
					id: "sd",
					identifier: "DEV-1159",
					title: "Migrate support guide from Notion",
					state: { id: "s", name: "Done" },
				},
			]);
			mockCreateIssue.mockResolvedValue({ id: "x", identifier: "DEV-999" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Migrate remaining scripts/*.mjs to TypeScript (52 files)",
				...validArgs,
			]);

			expect(mockSearchIssues).toHaveBeenCalled();
			expect(mockCreateIssue).toHaveBeenCalled();
		});

		it("proceeds (best-effort) when the dup search itself fails", async () => {
			mockLoadConfig.mockReturnValue(enabledConfig);
			mockSearchIssues.mockRejectedValue(new Error("network down"));
			mockCreateIssue.mockResolvedValue({ id: "x", identifier: "DEV-999" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Migrate remaining scripts/*.mjs to TypeScript (52 files)",
				...validArgs,
			]);

			expect(mockOutputWarning).toHaveBeenCalledWith(
				expect.stringContaining("Duplicate-detection search failed"),
			);
			expect(mockCreateIssue).toHaveBeenCalled();
		});
	});

	// DEV-4293: `create --checkout` must record branch.<branch>.linearIssue.
	// Runs against a real temp git repo (the checkout + git config writes are
	// real); chdir is restored in afterEach so it can't leak into other tests.
	describe("issues create --checkout writes the Linear issue marker (DEV-4293)", () => {
		let repo: string;
		let cwd: string;

		beforeEach(() => {
			cwd = process.cwd();
			repo = mkdtempSync(join(tmpdir(), "create-checkout-"));
			process.chdir(repo);
			execFileSync("git", ["init", "-q"], { stdio: "pipe" });
			execFileSync("git", ["config", "user.email", "t@example.com"], {
				stdio: "pipe",
			});
			execFileSync("git", ["config", "user.name", "Test"], { stdio: "pipe" });
			// One commit so HEAD is born and `checkout -b` has a base.
			execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], {
				stdio: "pipe",
			});
		});

		afterEach(() => {
			process.chdir(cwd);
			rmSync(repo, { recursive: true, force: true });
		});

		it("checks out the branch and records the marker with the issue identifier", async () => {
			mockCreateIssue.mockResolvedValue({
				id: "new-issue-id",
				identifier: "DEV-4293",
				branchName: "dev-4293-add-marker",
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Add marker",
				"--team",
				"DEV",
				"--assignee",
				"bob",
				"--project",
				"Infrastructure",
				"--checkout",
			]);

			const branch = "feature/DEV-4293-add-marker";
			// The branch was actually created and checked out.
			expect(
				execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
					stdio: "pipe",
				})
					.toString()
					.trim(),
			).toBe(branch);
			// And the marker points at the issue identifier (read raw to avoid
			// importing branch.js at module top, which would load the mocked
			// output.js before its mock vars initialize).
			expect(
				execFileSync(
					"git",
					["config", "--get", `branch.${branch}.linearIssue`],
					{ stdio: "pipe" },
				)
					.toString()
					.trim(),
			).toBe("DEV-4293");
			expect(mockClaimIssue).toHaveBeenCalledWith("DEV-4293");
		});

		it("--no-claim checks out the branch and marker without claiming the issue", async () => {
			mockCreateIssue.mockResolvedValue({
				id: "new-issue-id",
				identifier: "DEV-4293",
				branchName: "dev-4293-add-marker",
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Add marker",
				"--team",
				"DEV",
				"--assignee",
				"bob",
				"--project",
				"Infrastructure",
				"--checkout",
				"--no-claim",
			]);

			expect(mockClaimIssue).not.toHaveBeenCalled();
			expect(
				execFileSync(
					"git",
					["config", "--get", "branch.feature/DEV-4293-add-marker.linearIssue"],
					{ stdio: "pipe" },
				)
					.toString()
					.trim(),
			).toBe("DEV-4293");
		});
	});

	describe("issues mark-branch auto-claims the issue (DEV-4500)", () => {
		let repo: string;
		let cwd: string;

		beforeEach(() => {
			cwd = process.cwd();
			repo = mkdtempSync(join(tmpdir(), "mark-branch-claim-"));
			process.chdir(repo);
			execFileSync("git", ["init", "-q"], { stdio: "pipe" });
			execFileSync("git", ["config", "user.email", "t@example.com"], {
				stdio: "pipe",
			});
			execFileSync("git", ["config", "user.name", "Test"], { stdio: "pipe" });
			execFileSync("git", ["checkout", "-b", "feature/DEV-4500-claim"], {
				stdio: "pipe",
			});
			execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "init"], {
				stdio: "pipe",
			});
		});

		afterEach(() => {
			process.chdir(cwd);
			rmSync(repo, { recursive: true, force: true });
		});

		it("claims the marked issue by default", async () => {
			mockClaimIssue.mockResolvedValue({
				claimed: true,
				assigned: true,
				started: true,
				assignee: {
					id: "user-1",
					name: "Nico Appel",
					displayName: "Nico",
					email: "nico@example.com",
				},
				issue: { id: "issue-1", identifier: "DEV-4500" },
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "mark-branch", "DEV-4500"]);

			expect(mockClaimIssue).toHaveBeenCalledWith("DEV-4500");
			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					linearIssue: "DEV-4500",
					marked: true,
					claim: expect.objectContaining({
						claimed: true,
						assigned: true,
						started: true,
					}),
				}),
			);
		});

		it("--no-claim only writes the git metadata marker", async () => {
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"mark-branch",
				"DEV-4500",
				"--no-claim",
			]);

			expect(mockClaimIssue).not.toHaveBeenCalled();
			expect(
				execFileSync("git", [
					"config",
					"--get",
					"branch.feature/DEV-4500-claim.linearIssue",
				])
					.toString()
					.trim(),
			).toBe("DEV-4500");
		});

		it("fails open when claiming fails after the marker is written", async () => {
			mockClaimIssue.mockRejectedValue(new Error("Linear API unavailable"));

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "mark-branch", "DEV-4500"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					linearIssue: "DEV-4500",
					marked: true,
				}),
			);
			expect(process.exit).not.toHaveBeenCalled();
		});

		it("fails open when Linear service creation fails before claiming", async () => {
			mockCreateGraphQLService.mockRejectedValueOnce(
				new Error("missing Linear token"),
			);

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "mark-branch", "DEV-4500"]);

			expect(mockClaimIssue).not.toHaveBeenCalled();
			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					linearIssue: "DEV-4500",
					marked: true,
				}),
			);
			expect(process.exit).not.toHaveBeenCalled();
		});
	});

	describe("issues create — defaultAssignee fallback", () => {
		// Required project for validation; assignee is what we're testing.
		const projectArg = ["--project", "Infrastructure"];

		it("uses --assignee when explicitly passed (config default ignored)", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultAssignee: "carol",
			});
			mockCreateIssue.mockResolvedValue({ id: "id", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				"--assignee",
				"alice",
				...projectArg,
			]);

			expect(mockResolveAssignee).toHaveBeenCalledWith(
				"alice",
				expect.any(Object),
			);
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ assigneeId: "member-id-alice" }),
			);
		});

		it("falls back to config.defaultAssignee when --assignee is omitted", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultAssignee: "carol",
			});
			mockCreateIssue.mockResolvedValue({ id: "id", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				...projectArg,
			]);

			expect(mockResolveAssignee).toHaveBeenCalledWith(
				"carol",
				expect.any(Object),
			);
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ assigneeId: "member-id-carol" }),
			);
		});

		it("--no-assignee skips both flag and config default", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultAssignee: "carol",
			});
			mockCreateIssue.mockResolvedValue({ id: "id", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				"--no-assignee",
				...projectArg,
			]);

			expect(mockResolveAssignee).not.toHaveBeenCalled();
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ assigneeId: undefined }),
			);
		});

		it("no flag and no config default → unassigned", async () => {
			// Validation off in baseConfig, so no assignee is allowed.
			mockCreateIssue.mockResolvedValue({ id: "id", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				...projectArg,
			]);

			expect(mockResolveAssignee).not.toHaveBeenCalled();
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ assigneeId: undefined }),
			);
		});
	});

	describe("issues create — defaultPriority fallback", () => {
		const requiredArgs = ["--assignee", "bob", "--project", "Infrastructure"];

		it("uses --priority when passed (config default ignored)", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultPriority: "low",
			});
			mockCreateIssue.mockResolvedValue({ id: "id", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				"--priority",
				"urgent",
				...requiredArgs,
			]);

			// urgent → 1
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ priority: 1 }),
			);
		});

		it("falls back to config.defaultPriority when --priority is omitted", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultPriority: "high",
			});
			mockCreateIssue.mockResolvedValue({ id: "id", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				...requiredArgs,
			]);

			// high → 2
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ priority: 2 }),
			);
		});

		it("no flag and no config default → priority undefined", async () => {
			mockCreateIssue.mockResolvedValue({ id: "id", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ priority: undefined }),
			);
		});

		it("config.defaultPriority='none' resolves to 0", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultPriority: "none",
			});
			mockCreateIssue.mockResolvedValue({ id: "id", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ priority: 0 }),
			);
		});
	});

	describe("issues update — defaultPriority fallback", () => {
		it("uses --priority when passed", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultPriority: "low",
			});
			mockLinearService.resolveIssueId.mockResolvedValue("uuid-1");
			mockUpdateIssue.mockResolvedValue({ id: "uuid-1", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--priority",
				"urgent",
			]);

			// urgent → 1
			expect(mockUpdateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ priority: 1 }),
				"adding",
			);
		});

		it("falls back to config.defaultPriority when --priority is omitted", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultPriority: "medium",
			});
			mockLinearService.resolveIssueId.mockResolvedValue("uuid-1");
			mockUpdateIssue.mockResolvedValue({ id: "uuid-1", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--title",
				"new title",
			]);

			// medium → 3
			expect(mockUpdateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ priority: 3 }),
				"adding",
			);
		});

		it("no flag, no config default → priority undefined", async () => {
			mockLinearService.resolveIssueId.mockResolvedValue("uuid-1");
			mockUpdateIssue.mockResolvedValue({ id: "uuid-1", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--title",
				"new title",
			]);

			expect(mockUpdateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ priority: undefined }),
				"adding",
			);
		});
	});

	describe("issues create — --template + --footer", () => {
		const requiredArgs = ["--assignee", "bob", "--project", "Infrastructure"];

		beforeEach(() => {
			mockLoadConfig.mockReturnValue(baseConfig);
		});

		it("--template uses the body from config.descriptionTemplates", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				descriptionTemplates: {
					bug: "## Steps to reproduce\n\n1. ...\n\n## Expected\n\n...",
				},
			});
			mockCreateIssue.mockResolvedValue({ id: "uuid", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"My bug",
				"--team",
				"DEV",
				"--template",
				"bug",
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					description: expect.stringContaining("Steps to reproduce"),
				}),
			);
		});

		it("--template errors with a clear message when the name is unknown", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				descriptionTemplates: { bug: "..." },
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Something",
				"--team",
				"DEV",
				"--template",
				"feature",
				...requiredArgs,
			]);

			// The error goes through outputError → JSON.stringify, so the
			// embedded double quotes around the template name are backslash-
			// escaped in the captured stdout output.
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Template"),
			);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("not found"),
			);
		});

		it("--template errors when used alongside --description", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				descriptionTemplates: { bug: "..." },
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Something",
				"--team",
				"DEV",
				"--template",
				"bug",
				"--description",
				"explicit body",
				...requiredArgs,
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("--template is mutually exclusive"),
			);
		});

		it("--template + --description-file is also rejected", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				descriptionTemplates: { bug: "..." },
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Something",
				"--team",
				"DEV",
				"--template",
				"bug",
				"--description-file",
				"/tmp/desc.md",
				...requiredArgs,
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("--template is mutually exclusive"),
			);
		});

		it("--footer is appended to the description", async () => {
			mockCreateIssue.mockResolvedValue({ id: "uuid", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Title",
				"--team",
				"DEV",
				"--description",
				"the body",
				"--footer",
				"\n\n— Kamal",
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					description: "the body\n\n— Kamal",
				}),
			);
		});

		it("config.messageFooter is appended automatically", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				messageFooter: "\n— Filed via el-linear",
			});
			mockCreateIssue.mockResolvedValue({ id: "uuid", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Title",
				"--team",
				"DEV",
				"--description",
				"body",
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					description: "body\n— Filed via el-linear",
				}),
			);
		});

		it("--no-footer skips a configured messageFooter", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				messageFooter: "\n— always here",
			});
			mockCreateIssue.mockResolvedValue({ id: "uuid", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Title",
				"--team",
				"DEV",
				"--description",
				"body",
				"--no-footer",
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					description: "body",
				}),
			);
		});

		it("accepts --parent as alias for --parent-ticket", async () => {
			mockCreateIssue.mockResolvedValue({ id: "new-issue-id" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Task",
				"--team",
				"DEV",
				"--parent",
				"DEV-7",
				...requiredArgs,
			]);

			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					parentId: "DEV-7",
				}),
			);
		});
	});

	describe("issues update", () => {
		it("errors when --delegate and --clear-delegate are both used", async () => {
			const program = createTestProgram();
			setupIssuesCommands(program);

			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--delegate",
				"claude",
				"--clear-delegate",
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Cannot use --delegate and --clear-delegate"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

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
				expect.stringContaining(
					"Cannot use --parent-ticket and --clear-parent-ticket together",
				),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("accepts --parent as alias for --parent-ticket on update", async () => {
			mockUpdateIssue.mockResolvedValue({ id: "uuid", identifier: "DEV-1" });
			mockLinearService.resolveIssueId.mockResolvedValue("issue-uuid");

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--parent",
				"DEV-9",
			]);

			expect(mockUpdateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					parentId: "DEV-9",
				}),
				expect.anything(),
			);
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

			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--cycle",
				"C1",
				"--clear-cycle",
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"Cannot use --cycle and --clear-cycle together",
				),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("errors when --label-by is used without --labels", async () => {
			const program = createTestProgram();
			setupIssuesCommands(program);

			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--label-by",
				"overwriting",
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("--label-by requires --labels to be specified"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("errors when --clear-labels is used with --labels", async () => {
			const program = createTestProgram();
			setupIssuesCommands(program);

			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--clear-labels",
				"--labels",
				"bug",
			]);

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("--clear-labels cannot be used with --labels"),
			);
			expect(process.exit).toHaveBeenCalledWith(1);
		});

		it("updates issue with title", async () => {
			mockUpdateIssue.mockResolvedValue({ id: "DEV-1", title: "New Title" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--title",
				"New Title",
			]);

			expect(mockUpdateIssue).toHaveBeenCalled();
			expect(mockOutputSuccess).toHaveBeenCalled();
		});

		it("updates issue delegate", async () => {
			mockUpdateIssue.mockResolvedValue({ id: "uuid", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--delegate",
				"claude",
			]);

			expect(mockUpdateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					delegateId: "member-id-claude",
				}),
				"adding",
			);
		});

		it("clears issue delegate", async () => {
			mockUpdateIssue.mockResolvedValue({ id: "uuid", identifier: "DEV-1" });

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-1",
				"--clear-delegate",
			]);

			expect(mockUpdateIssue).toHaveBeenCalledWith(
				expect.objectContaining({
					delegateId: null,
				}),
				"adding",
			);
		});
	});

	describe("issues archive/delete", () => {
		it("archives an issue by identifier", async () => {
			mockArchiveIssue.mockResolvedValue({
				id: "uuid-1",
				entity: { id: "uuid-1" },
				lastSyncId: 10,
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "archive", "DEV-1"]);

			expect(mockArchiveIssue).toHaveBeenCalledWith("DEV-1");
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				success: true,
				archived: true,
				id: "uuid-1",
				entity: { id: "uuid-1" },
				lastSyncId: 10,
			});
		});

		it("deletes an issue without permanently deleting by default", async () => {
			mockDeleteIssue.mockResolvedValue({
				id: "uuid-1",
				entity: { id: "uuid-1" },
				lastSyncId: 11,
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "delete", "DEV-1"]);

			expect(mockDeleteIssue).toHaveBeenCalledWith("DEV-1", {
				permanentlyDelete: false,
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				success: true,
				deleted: true,
				permanentlyDeleted: false,
				id: "uuid-1",
				entity: { id: "uuid-1" },
				lastSyncId: 11,
			});
		});

		it("supports permanent issue deletion", async () => {
			mockDeleteIssue.mockResolvedValue({
				id: "uuid-1",
				lastSyncId: 12,
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"delete",
				"DEV-1",
				"--permanently-delete",
			]);

			expect(mockDeleteIssue).toHaveBeenCalledWith("DEV-1", {
				permanentlyDelete: true,
			});
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				success: true,
				deleted: true,
				permanentlyDeleted: true,
				id: "uuid-1",
				lastSyncId: 12,
			});
		});

		it("maps hard-delete to permanent issue deletion", async () => {
			mockDeleteIssue.mockResolvedValue({
				id: "uuid-1",
				lastSyncId: 13,
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "hard-delete", "DEV-1"]);

			expect(mockDeleteIssue).toHaveBeenCalledWith("DEV-1", {
				permanentlyDelete: true,
			});
		});
	});

	describe("issues start", () => {
		it("moves an issue to a started workflow state", async () => {
			mockStartIssue.mockResolvedValue({
				issue: { id: "uuid-1", identifier: "DEV-1", title: "Task" },
				started: true,
				previousState: {
					id: "state-backlog",
					name: "Backlog",
					type: "backlog",
				},
				targetState: { id: "state-started", name: "In Progress" },
			});

			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, ["issues", "start", "DEV-1"]);

			expect(mockStartIssue).toHaveBeenCalledWith("DEV-1");
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Task",
				started: true,
				previousState: {
					id: "state-backlog",
					name: "Backlog",
					type: "backlog",
				},
				targetState: { id: "state-started", name: "In Progress" },
			});
		});
	});

	// Handler-level integration tests for the auto-link composition.
	// Unit tests on extractIssueReferences + autoLinkReferences pass with raw input,
	// but the create/update handlers wrap the description before passing it down — which
	// previously broke prose-keyword inference (Nico, MR !428). These tests exercise the
	// composed flow end-to-end and assert the relation-create mutation receives the
	// correct {type, issueId↔relatedIssueId} based on prose keywords.
	describe("auto-link composition (handler integration)", () => {
		const requiredArgs = ["--assignee", "bob", "--project", "Infrastructure"];

		function setupAutoLinkMocks(resolvedIds: Record<string, string>): void {
			mockLinearService.resolveIssueId.mockImplementation((id: string) => {
				if (id in resolvedIds) {
					return Promise.resolve(resolvedIds[id]);
				}
				if (id === "DEV-999") {
					return Promise.resolve("uuid-source");
				}
				return Promise.reject(new Error(`Issue "${id}" not found`));
			});
			mockGraphQLService.rawRequest.mockImplementation(
				(query: string, vars: unknown) => {
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
								input: {
									issueId: string;
									relatedIssueId: string;
									type: string;
								};
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
					return Promise.resolve({});
				},
			);
		}

		function findRelationCreateInput():
			| {
					issueId: string;
					relatedIssueId: string;
					type: string;
			  }
			| undefined {
			const call = mockGraphQLService.rawRequest.mock.calls.find(
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

		beforeEach(() => {
			mockCreateIssue.mockResolvedValue({
				id: "uuid-source",
				identifier: "DEV-999",
			});
			mockUpdateIssue.mockResolvedValue({
				id: "uuid-source",
				identifier: "DEV-999",
			});
		});

		it("create: bare reference creates a 'related' relation (forward)", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Test",
				"--team",
				"DEV",
				"--description",
				"see DEV-100 for details",
				...requiredArgs,
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-100",
				type: "related",
			});
		});

		it("create: 'blocked by DEV-X' creates a reversed 'blocks' relation", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Test",
				"--team",
				"DEV",
				"--description",
				"blocked by DEV-100",
				...requiredArgs,
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-100",
				relatedIssueId: "uuid-source",
				type: "blocks",
			});
		});

		it("create: 'this blocks DEV-X' creates a forward 'blocks' relation", async () => {
			setupAutoLinkMocks({ "DEV-200": "uuid-200" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Test",
				"--team",
				"DEV",
				"--description",
				"this blocks DEV-200",
				...requiredArgs,
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-200",
				type: "blocks",
			});
		});

		it("create: 'duplicates DEV-X' creates a forward 'duplicate' relation", async () => {
			setupAutoLinkMocks({ "DEV-50": "uuid-50" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Test",
				"--team",
				"DEV",
				"--description",
				"this duplicates DEV-50",
				...requiredArgs,
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-50",
				type: "duplicate",
			});
		});

		it("create: 'duplicated by DEV-X' creates a reversed 'duplicate' relation", async () => {
			setupAutoLinkMocks({ "DEV-50": "uuid-50" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Test",
				"--team",
				"DEV",
				"--description",
				"this was duplicated by DEV-50",
				...requiredArgs,
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-50",
				relatedIssueId: "uuid-source",
				type: "duplicate",
			});
		});

		it("create: 'depends on DEV-X' creates a reversed 'blocks' relation (alias for blocked-by)", async () => {
			setupAutoLinkMocks({ "DEV-77": "uuid-77" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Test",
				"--team",
				"DEV",
				"--description",
				"this depends on DEV-77",
				...requiredArgs,
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-77",
				relatedIssueId: "uuid-source",
				type: "blocks",
			});
		});

		it("create: invalid identifier (e.g. ISO-1424) does NOT trigger a relation create", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Test",
				"--team",
				"DEV",
				"--description",
				"real DEV-100 plus fake ISO-1424",
				...requiredArgs,
			]);
			// Only DEV-100 should trigger a relation create — ISO-1424 fails validation
			const createCalls = mockGraphQLService.rawRequest.mock.calls.filter(
				(c: unknown[]) =>
					typeof c[0] === "string" &&
					(c[0] as string).includes("IssueRelationCreate"),
			);
			expect(createCalls).toHaveLength(1);
			expect(
				(createCalls[0]?.[1] as { input: { relatedIssueId: string } }).input
					.relatedIssueId,
			).toBe("uuid-100");
		});

		it("create: --no-auto-link suppresses both wrapping and sidebar creation", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"create",
				"Test",
				"--team",
				"DEV",
				"--description",
				"blocked by DEV-100",
				"--no-auto-link",
				...requiredArgs,
			]);
			expect(findRelationCreateInput()).toBeUndefined();
			// The description sent to createIssue should be unchanged (no markdown wrap)
			expect(mockCreateIssue).toHaveBeenCalledWith(
				expect.objectContaining({ description: "blocked by DEV-100" }),
			);
		});

		it("update: 'blocked by DEV-X' creates a reversed 'blocks' relation (regression)", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--description",
				"blocked by DEV-100",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-100",
				relatedIssueId: "uuid-source",
				type: "blocks",
			});
		});

		it("update: 'duplicates DEV-X' creates a forward 'duplicate' relation", async () => {
			setupAutoLinkMocks({ "DEV-50": "uuid-50" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--description",
				"this duplicates DEV-50",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-50",
				type: "duplicate",
			});
		});

		it("update: --related-to creates a forward 'related' relation", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--related-to",
				"DEV-100",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-100",
				type: "related",
			});
		});

		it("update: --blocked-by creates a reversed 'blocks' relation", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--blocked-by",
				"DEV-100",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-100",
				relatedIssueId: "uuid-source",
				type: "blocks",
			});
		});

		it("update: --duplicate-of creates a forward 'duplicate' relation", async () => {
			setupAutoLinkMocks({ "DEV-50": "uuid-50" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--duplicate-of",
				"DEV-50",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-50",
				type: "duplicate",
			});
		});

		it("update: --blocks creates a forward 'blocks' relation", async () => {
			setupAutoLinkMocks({ "DEV-200": "uuid-200" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--blocks",
				"DEV-200",
			]);
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-200",
				type: "blocks",
			});
		});

		it("update: relation-only invocation does NOT call updateIssue", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--related-to",
				"DEV-100",
			]);
			// Relation-only update must behave like `issues relate`: create the
			// relation, but never issue an issueUpdate mutation.
			expect(mockUpdateIssue).not.toHaveBeenCalled();
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-100",
				type: "related",
			});
		});

		it("update: relation-only does not apply defaultPriority side effect", async () => {
			mockLoadConfig.mockReturnValue({
				...baseConfig,
				defaultPriority: "high",
			});
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--related-to",
				"DEV-100",
			]);
			// Regression: with defaultPriority configured, a relation-only
			// update previously rewrote the issue's priority via updateIssue.
			expect(mockUpdateIssue).not.toHaveBeenCalled();
		});

		it("update: field + relation flags updates AND relates in one call", async () => {
			setupAutoLinkMocks({ "DEV-100": "uuid-100" });
			const program = createTestProgram();
			setupIssuesCommands(program);
			await runCommand(program, [
				"issues",
				"update",
				"DEV-999",
				"--title",
				"Renamed",
				"--related-to",
				"DEV-100",
			]);
			expect(mockUpdateIssue).toHaveBeenCalled();
			expect(findRelationCreateInput()).toEqual({
				issueId: "uuid-source",
				relatedIssueId: "uuid-100",
				type: "related",
			});
		});
	});
});
