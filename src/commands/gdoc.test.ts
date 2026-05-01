import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockExtractDocId = vi.fn();
const mockParseGoogleDoc = vi.fn();
const mockExecFileSync = vi.fn();

vi.mock("../utils/gdoc-parser.js", () => ({
	extractDocId: (...args: unknown[]) => mockExtractDocId(...args),
	parseGoogleDoc: (...args: unknown[]) => mockParseGoogleDoc(...args),
}));

vi.mock("node:child_process", () => ({
	execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

vi.mock("../utils/output.js", () => ({
	handleAsyncCommand:
		(fn: (...args: unknown[]) => unknown) =>
		(...args: unknown[]) =>
			fn(...args),
}));

const { setupGdocCommands } = await import("./gdoc.js");

describe("gdoc command", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("extracts doc ID, fetches via gws, and outputs markdown", async () => {
		mockExtractDocId.mockReturnValue("doc-123");
		mockExecFileSync.mockReturnValue('{"title":"Test"}');
		mockParseGoogleDoc.mockReturnValue("# Test\n\nHello world");
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		const program = createTestProgram();
		setupGdocCommands(program);
		await runCommand(program, [
			"gdoc",
			"https://docs.google.com/document/d/doc-123/edit",
		]);

		expect(mockExtractDocId).toHaveBeenCalledWith(
			"https://docs.google.com/document/d/doc-123/edit",
		);
		expect(mockExecFileSync).toHaveBeenCalledWith(
			"gws",
			["docs", "documents", "get", "--params", '{"documentId":"doc-123"}'],
			expect.objectContaining({ encoding: "utf-8" }),
		);
		expect(mockParseGoogleDoc).toHaveBeenCalledWith({ title: "Test" });
		expect(writeSpy).toHaveBeenCalledWith("# Test\n\nHello world");
		writeSpy.mockRestore();
	});

	it("throws descriptive error when gws CLI is not found", async () => {
		mockExtractDocId.mockReturnValue("doc-123");
		const enoent = new Error("spawn gws ENOENT");
		mockExecFileSync.mockImplementation(() => {
			throw enoent;
		});
		suppressExit();

		const program = createTestProgram();
		setupGdocCommands(program);
		await expect(runCommand(program, ["gdoc", "doc-123"])).rejects.toThrow(
			"gws CLI not found",
		);
	});
});
