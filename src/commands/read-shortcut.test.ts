import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockGetIssueById = vi.fn();
const mockOutputSuccess = vi.fn();
const mockDownloadLinearUploads = vi.fn((issue: unknown) => issue);

vi.mock("../utils/graphql-issues-service.js", () => ({
	GraphQLIssuesService: class {
		getIssueById = mockGetIssueById;
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

	it("reads multiple issues via top-level read command", async () => {
		const issue1 = { id: "uuid-1", identifier: "DEV-123" };
		const issue2 = { id: "uuid-2", identifier: "DEV-456" };
		mockGetIssueById
			.mockResolvedValueOnce(issue1)
			.mockResolvedValueOnce(issue2);

		const program = createTestProgram();
		setupReadShortcut(program);
		await runCommand(program, ["read", "DEV-123", "DEV-456"]);

		expect(mockGetIssueById).toHaveBeenCalledWith("DEV-123");
		expect(mockGetIssueById).toHaveBeenCalledWith("DEV-456");
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
