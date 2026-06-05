import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockGetIssueById = vi.fn();
const mockGetIssuesByRefs = vi.fn();
const mockOutputSuccess = vi.fn();
const mockOutputWarning = vi.fn();
const mockDownloadLinearUploads = vi.fn((issue: unknown) => issue);
const mockRawRequest = vi.fn();

vi.mock("../utils/graphql-issues-service.js", () => ({
	GraphQLIssuesService: class {
		getIssueById = mockGetIssueById;
		getIssuesByRefs = mockGetIssuesByRefs;
	},
}));

vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: vi.fn().mockReturnValue({
		rawRequest: (...args: unknown[]) => mockRawRequest(...args),
	}),
}));

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: vi.fn().mockReturnValue({}),
}));

vi.mock("../utils/auth.js", () => ({
	getApiToken: vi.fn().mockReturnValue("test-token"),
}));

vi.mock("../utils/download-uploads.js", () => ({
	downloadLinearUploads: (...args: unknown[]) =>
		mockDownloadLinearUploads(...args),
}));

vi.mock("../utils/output.js", () => ({
	outputSuccess: (...args: unknown[]) => mockOutputSuccess(...args),
	outputWarning: (...args: unknown[]) => mockOutputWarning(...args),
	handleAsyncCommand:
		(fn: (...args: unknown[]) => unknown) =>
		(...args: unknown[]) =>
			fn(...args),
}));

const { setupReadShortcut } = await import("./read-shortcut.js");

describe("read-shortcut", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reads a single issue via top-level read command", async () => {
		const issue = { id: "uuid-1", identifier: "DEV-123", title: "Test" };
		mockGetIssueById.mockResolvedValue(issue);

		const program = createTestProgram();
		setupReadShortcut(program);
		await runCommand(program, ["read", "DEV-123"]);

		expect(mockGetIssueById).toHaveBeenCalledWith("DEV-123");
		expect(mockOutputSuccess).toHaveBeenCalledWith(issue);
	});

	it("reads multiple issues via top-level read command (DEV-4477: batched into one GraphQL call)", async () => {
		const issue1 = { id: "uuid-1", identifier: "DEV-123" };
		const issue2 = { id: "uuid-2", identifier: "DEV-456" };
		mockGetIssuesByRefs.mockResolvedValue([issue1, issue2]);

		const program = createTestProgram();
		setupReadShortcut(program);
		await runCommand(program, ["read", "DEV-123", "DEV-456"]);

		// One batched call, not two single-issue calls.
		expect(mockGetIssuesByRefs).toHaveBeenCalledTimes(1);
		expect(mockGetIssuesByRefs).toHaveBeenCalledWith(["DEV-123", "DEV-456"]);
		expect(mockGetIssueById).not.toHaveBeenCalled();
		expect(mockOutputSuccess).toHaveBeenCalledWith([issue1, issue2]);
	});

	it("works via the 'get' alias", async () => {
		const issue = { id: "uuid-1", identifier: "ADM-99" };
		mockGetIssueById.mockResolvedValue(issue);

		const program = createTestProgram();
		setupReadShortcut(program);
		await runCommand(program, ["get", "ADM-99"]);

		expect(mockGetIssueById).toHaveBeenCalledWith("ADM-99");
		expect(mockOutputSuccess).toHaveBeenCalledWith(issue);
	});

	describe("--with relations (DEV-4476)", () => {
		it("attaches a `relations` array to the envelope when --with relations is set", async () => {
			const issue = { id: "uuid-1", identifier: "DEV-1", title: "Parent" };
			mockGetIssueById.mockResolvedValue(issue);
			mockRawRequest.mockResolvedValue({
				issue: {
					id: "uuid-1",
					identifier: "DEV-1",
					title: "Parent",
					description: null,
					relations: {
						nodes: [
							{
								id: "rel-1",
								type: "blocks",
								relatedIssue: {
									id: "uuid-2",
									identifier: "DEV-2",
									title: "Child",
									state: { id: "s", name: "Todo" },
									priority: 1,
									assignee: null,
									team: { id: "t", key: "DEV", name: "Dev" },
								},
							},
						],
					},
					inverseRelations: { nodes: [] },
				},
			});

			const program = createTestProgram();
			setupReadShortcut(program);
			await runCommand(program, ["read", "DEV-1", "--with", "relations"]);

			expect(mockGetIssueById).toHaveBeenCalledWith("DEV-1");
			// Fetched relations via raw GraphQL using the resolved UUID.
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.stringContaining("GetIssueRelations"),
				{ id: "uuid-1" },
			);
			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "uuid-1",
					identifier: "DEV-1",
					relations: [
						expect.objectContaining({
							id: "rel-1",
							type: "blocks",
							direction: "outgoing",
							issue: expect.objectContaining({ identifier: "DEV-2" }),
						}),
					],
				}),
			);
		});

		it("does NOT fetch relations when --with is absent", async () => {
			const issue = { id: "uuid-1", identifier: "DEV-1" };
			mockGetIssueById.mockResolvedValue(issue);

			const program = createTestProgram();
			setupReadShortcut(program);
			await runCommand(program, ["read", "DEV-1"]);

			expect(mockRawRequest).not.toHaveBeenCalled();
			expect(mockOutputSuccess).toHaveBeenCalledWith(issue);
		});

		it("rejects unknown --with values with a candidate-list error", async () => {
			const issue = { id: "uuid-1", identifier: "DEV-1" };
			mockGetIssueById.mockResolvedValue(issue);

			const program = createTestProgram();
			setupReadShortcut(program);

			await expect(
				runCommand(program, ["read", "DEV-1", "--with", "attachments"]),
			).rejects.toThrow(/unknown include "attachments"/);
			// Fail fast — no base-issue fetch is wasted.
			expect(mockRawRequest).not.toHaveBeenCalled();
		});

		it("rejects --field paired with --with as mutually exclusive", async () => {
			const issue = { id: "uuid-1", identifier: "DEV-1" };
			mockGetIssueById.mockResolvedValue(issue);

			const program = createTestProgram();
			setupReadShortcut(program);

			await expect(
				runCommand(program, [
					"read",
					"DEV-1",
					"--field",
					"Done when",
					"--with",
					"relations",
				]),
			).rejects.toThrow(/mutually exclusive/);
		});

		it("attaches relations per-issue in the multi-issue path", async () => {
			const i1 = { id: "uuid-1", identifier: "DEV-1" };
			const i2 = { id: "uuid-2", identifier: "DEV-2" };
			// DEV-4477 batch path: the multi-issue read resolves all issues in one
			// `getIssuesByRefs` call (not per-id getIssueById), then --with relations
			// (DEV-4476) enriches each over that batch result. Mocking getIssueById
			// with a once-queue here would leave unconsumed values that bleed into
			// later tests (clearAllMocks does not drain once-queues).
			mockGetIssuesByRefs.mockResolvedValue([i1, i2]);
			mockRawRequest.mockResolvedValue({
				issue: {
					id: "any",
					identifier: "any",
					title: "any",
					description: null,
					relations: { nodes: [] },
					inverseRelations: { nodes: [] },
				},
			});

			const program = createTestProgram();
			setupReadShortcut(program);
			await runCommand(program, [
				"read",
				"DEV-1",
				"DEV-2",
				"--with",
				"relations",
			]);

			// Two relations fetches (one per issue, in parallel).
			expect(mockRawRequest).toHaveBeenCalledTimes(2);
			const arg = mockOutputSuccess.mock.calls[0][0];
			expect(arg).toHaveLength(2);
			expect(arg[0]).toHaveProperty("relations");
			expect(arg[1]).toHaveProperty("relations");
		});

		it("merges incoming relations (inverseRelations) into the envelope (cycle-1 nit)", async () => {
			const issue = { id: "uuid-1", identifier: "DEV-1", title: "Parent" };
			mockGetIssueById.mockResolvedValue(issue);
			// Outgoing AND incoming — pins the merge order (outgoing first,
			// then incoming) and exercises normalizeInverseType for the
			// `blocks` → `blockedBy` flip on the incoming side.
			mockRawRequest.mockResolvedValue({
				issue: {
					id: "uuid-1",
					identifier: "DEV-1",
					title: "Parent",
					description: null,
					relations: {
						nodes: [
							{
								id: "rel-out",
								type: "related",
								relatedIssue: {
									id: "uuid-2",
									identifier: "DEV-2",
									title: "Outgoing",
									state: null,
									priority: null,
									assignee: null,
									team: null,
								},
							},
						],
					},
					inverseRelations: {
						nodes: [
							{
								id: "rel-in",
								type: "blocks",
								issue: {
									id: "uuid-3",
									identifier: "DEV-3",
									title: "Incoming-Blocker",
									state: null,
									priority: null,
									assignee: null,
									team: null,
								},
							},
						],
					},
				},
			});

			const program = createTestProgram();
			setupReadShortcut(program);
			await runCommand(program, ["read", "DEV-1", "--with", "relations"]);

			const arg = mockOutputSuccess.mock.calls[0][0];
			expect(arg.relations).toHaveLength(2);
			// Outgoing first.
			expect(arg.relations[0]).toEqual(
				expect.objectContaining({
					direction: "outgoing",
					type: "related",
					issue: expect.objectContaining({ identifier: "DEV-2" }),
				}),
			);
			// Incoming with inverted type ("blocks" → "blockedBy").
			expect(arg.relations[1]).toEqual(
				expect.objectContaining({
					direction: "incoming",
					type: "blockedBy",
					issue: expect.objectContaining({ identifier: "DEV-3" }),
				}),
			);
		});

		it("emits relations: [] when Linear loses the issue between fetches (race; cycle-1 nit)", async () => {
			// getIssueById succeeds → we have a UUID and emit the base
			// envelope. The relations query then returns `issue: null`
			// (true race: issue deleted between calls). Contract: surface
			// the base issue with relations: [] rather than throwing.
			const issue = { id: "uuid-1", identifier: "DEV-1" };
			mockGetIssueById.mockResolvedValue(issue);
			mockRawRequest.mockResolvedValue({ issue: null });

			const program = createTestProgram();
			setupReadShortcut(program);
			await runCommand(program, ["read", "DEV-1", "--with", "relations"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "uuid-1",
					identifier: "DEV-1",
					relations: [],
				}),
			);
		});
	});
});

describe("read-shortcut --sections (multi-section extraction)", () => {
	const issueWithBody = {
		id: "uuid-x",
		identifier: "DEV-999",
		title: "Test",
		description: [
			"## Done when",
			"- A",
			"- B",
			"",
			"## Out of scope",
			"Nothing else.",
		].join("\n"),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns { identifier, sections } envelope for present sections", async () => {
		mockGetIssueById.mockResolvedValue(issueWithBody);

		const program = createTestProgram();
		setupReadShortcut(program);
		await runCommand(program, [
			"read",
			"DEV-999",
			"--sections",
			"Done when,Out of scope",
		]);

		expect(mockOutputSuccess).toHaveBeenCalledTimes(1);
		const payload = mockOutputSuccess.mock.calls[0][0] as {
			identifier: string;
			sections: Record<string, string | null>;
		};
		expect(payload.identifier).toBe("DEV-999");
		expect(payload.sections).toEqual({
			"Done when": "- A\n- B",
			"Out of scope": "Nothing else.",
		});
		expect(mockOutputWarning).not.toHaveBeenCalled();
	});

	it("emits null for missing sections + one coalesced warning naming them all", async () => {
		mockGetIssueById.mockResolvedValue(issueWithBody);

		const program = createTestProgram();
		setupReadShortcut(program);
		await runCommand(program, [
			"read",
			"DEV-999",
			"--sections",
			"Done when,NoSuchHeader,AnotherMissing",
		]);

		const payload = mockOutputSuccess.mock.calls[0][0] as {
			sections: Record<string, string | null>;
		};
		expect(payload.sections["Done when"]).toBe("- A\n- B");
		expect(payload.sections.NoSuchHeader).toBeNull();
		expect(payload.sections.AnotherMissing).toBeNull();

		// One coalesced warning — not three.
		expect(mockOutputWarning).toHaveBeenCalledTimes(1);
		const msg = mockOutputWarning.mock.calls[0][0] as string;
		expect(msg).toContain("DEV-999");
		expect(msg).toContain('"NoSuchHeader"');
		expect(msg).toContain('"AnotherMissing"');
		expect(msg).not.toContain('"Done when"');
	});

	it("rejects --field and --sections together", async () => {
		mockGetIssueById.mockResolvedValue(issueWithBody);

		const program = createTestProgram();
		setupReadShortcut(program);
		await expect(
			runCommand(program, [
				"read",
				"DEV-999",
				"--field",
				"A",
				"--sections",
				"B",
			]),
		).rejects.toThrow(/mutually exclusive/);
	});

	it("rejects --sections with multiple issue IDs", async () => {
		mockGetIssueById.mockResolvedValue(issueWithBody);

		const program = createTestProgram();
		setupReadShortcut(program);
		await expect(
			runCommand(program, [
				"read",
				"DEV-999",
				"DEV-998",
				"--sections",
				"Done when",
			]),
		).rejects.toThrow(/single-issue only/);
	});

	it("rejects --sections that's empty after comma-split + trim", async () => {
		mockGetIssueById.mockResolvedValue(issueWithBody);

		const program = createTestProgram();
		setupReadShortcut(program);
		await expect(
			runCommand(program, ["read", "DEV-999", "--sections", ", , ,"]),
		).rejects.toThrow(/empty after trimming/);
	});
});
