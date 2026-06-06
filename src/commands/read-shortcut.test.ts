import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockGetIssueById = vi.fn();
const mockGetIssuesByRefs = vi.fn();
const mockOutputSuccess = vi.fn();
const mockOutputWarning = vi.fn();
const mockDownloadLinearUploads = vi.fn((issue: unknown) => issue);

vi.mock("../utils/graphql-issues-service.js", () => ({
	GraphQLIssuesService: class {
		getIssueById = mockGetIssueById;
		getIssuesByRefs = mockGetIssuesByRefs;
	},
}));

vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: vi.fn().mockReturnValue({}),
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
