import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

const mockResolveIssueId = vi.fn();
const mockLinearService = {
	resolveIssueId: mockResolveIssueId,
};
const mockCreateLinearService = vi.fn().mockReturnValue(mockLinearService);

const mockRawRequest = vi.fn();
const mockGraphQLService = {
	rawRequest: mockRawRequest,
};
const mockCreateGraphQLService = vi.fn().mockReturnValue(mockGraphQLService);

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: mockCreateLinearService,
}));

vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: mockCreateGraphQLService,
}));

vi.mock("../utils/output.js", async () => ({
	handleAsyncCommand: (await import("../__tests__/test-helpers.js"))
		.passthroughHandleAsyncCommand,
	outputWarning: vi.fn(),
	outputSuccess: vi.fn(),
}));

const { _resetWorkspaceUrlKeyCache } = await import(
	"../utils/workspace-url.js"
);
const { setupRefsCommands, wrapRefsCore } = await import("./refs.js");

const W = "acme";
const url = (id: string) => `https://linear.app/${W}/issue/${id}/`;

describe("wrapRefsCore", () => {
	const baseDeps = {
		resolveValidIdentifiers: async (ids: readonly string[]) => new Set(ids),
		resolveUrlKey: async () => W,
	};

	it("round-trips markdown for a single identifier", async () => {
		const out = await wrapRefsCore(
			{ text: "see DEV-100 for details", target: "markdown", validate: true },
			baseDeps,
		);
		expect(out).toBe(`see [DEV-100](${url("DEV-100")}) for details`);
	});

	it("emits Slack mrkdwn syntax with --target slack", async () => {
		const out = await wrapRefsCore(
			{
				text: "DEV-100 and DEV-200",
				target: "slack",
				validate: true,
			},
			baseDeps,
		);
		expect(out).toBe(
			`<${url("DEV-100")}|DEV-100> and <${url("DEV-200")}|DEV-200>`,
		);
	});

	it("is idempotent for markdown — running twice is a no-op", async () => {
		const text = "DEV-100 and DEV-200";
		const once = await wrapRefsCore(
			{ text, target: "markdown", validate: true },
			baseDeps,
		);
		const twice = await wrapRefsCore(
			{ text: once, target: "markdown", validate: true },
			baseDeps,
		);
		expect(twice).toBe(once);
	});

	it("is idempotent for slack — running twice is a no-op", async () => {
		const text = "DEV-100 and DEV-200";
		const once = await wrapRefsCore(
			{ text, target: "slack", validate: true },
			baseDeps,
		);
		const twice = await wrapRefsCore(
			{ text: once, target: "slack", validate: true },
			baseDeps,
		);
		expect(twice).toBe(once);
	});

	it("skips refs inside fenced code blocks", async () => {
		const text = [
			"before DEV-100",
			"```",
			"log: DEV-200",
			"```",
			"after DEV-300",
		].join("\n");
		const out = await wrapRefsCore(
			{ text, target: "markdown", validate: true },
			baseDeps,
		);
		expect(out).toContain(`[DEV-100](${url("DEV-100")})`);
		expect(out).toContain(`[DEV-300](${url("DEV-300")})`);
		expect(out).toContain("log: DEV-200");
		expect(out).not.toContain("[DEV-200]");
	});

	it("skips refs inside inline backticks", async () => {
		const out = await wrapRefsCore(
			{ text: "use `DEV-100` and DEV-200", target: "markdown", validate: true },
			baseDeps,
		);
		expect(out).toBe(`use \`DEV-100\` and [DEV-200](${url("DEV-200")})`);
	});

	it("skips refs inside an existing Slack-formatted link", async () => {
		const text = `<${url("DEV-100")}|DEV-100> and bare DEV-200`;
		const out = await wrapRefsCore(
			{ text, target: "slack", validate: true },
			baseDeps,
		);
		expect(out).toBe(
			`<${url("DEV-100")}|DEV-100> and bare <${url("DEV-200")}|DEV-200>`,
		);
	});

	it("--no-validate path skips the API and wraps every regex match", async () => {
		const probe = vi.fn(async () => {
			throw new Error("validate should not be called");
		});
		const out = await wrapRefsCore(
			{
				text: "real DEV-100 vs ISO-1424",
				target: "markdown",
				validate: false,
			},
			{
				resolveValidIdentifiers: probe,
				resolveUrlKey: async () => W,
			},
		);
		// Both IDs wrapped — no validation done.
		expect(out).toBe(
			`real [DEV-100](${url("DEV-100")}) vs [ISO-1424](${url("ISO-1424")})`,
		);
		expect(probe).not.toHaveBeenCalled();
	});

	it("validate path drops invalid IDs (resolver returns subset)", async () => {
		const out = await wrapRefsCore(
			{
				text: "real DEV-100 vs ISO-1424",
				target: "markdown",
				validate: true,
			},
			{
				resolveValidIdentifiers: async (ids) => {
					// Simulate the workspace resolver — only DEV-100 exists.
					return new Set(ids.filter((id) => id === "DEV-100"));
				},
				resolveUrlKey: async () => W,
			},
		);
		expect(out).toBe(`real [DEV-100](${url("DEV-100")}) vs ISO-1424`);
	});

	it("returns text unchanged when there are no candidate refs", async () => {
		const probe = vi.fn(async () => new Set<string>());
		const out = await wrapRefsCore(
			{ text: "no issue ids here", target: "markdown", validate: true },
			{
				resolveValidIdentifiers: probe,
				resolveUrlKey: async () => W,
			},
		);
		expect(out).toBe("no issue ids here");
		expect(probe).not.toHaveBeenCalled();
	});
});

describe("refs wrap (CLI integration)", () => {
	let program: Command;
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;
	let captured: string;

	beforeEach(() => {
		vi.clearAllMocks();
		_resetWorkspaceUrlKeyCache();
		captured = "";
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((chunk: unknown) => {
				captured +=
					typeof chunk === "string"
						? chunk
						: Buffer.from(chunk as Uint8Array).toString("utf8");
				return true;
			});
		stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		program = createTestProgram();
		setupRefsCommands(program);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	function setupResolverWith(validIds: string[]): void {
		mockResolveIssueId.mockImplementation(async (id: string) => {
			if (validIds.includes(id)) {
				return `uuid-for-${id}`;
			}
			throw new Error(`Issue ${id} not found`);
		});
		mockRawRequest.mockResolvedValue({
			viewer: { organization: { urlKey: W } },
		});
	}

	it("reads from --file and writes wrapped output to stdout (markdown)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "linctl-refs-"));
		const file = join(dir, "input.md");
		writeFileSync(file, "see DEV-100 for context", "utf8");
		setupResolverWith(["DEV-100"]);

		try {
			await runCommand(program, ["refs", "wrap", "--file", file]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}

		expect(captured).toBe(`see [DEV-100](${url("DEV-100")}) for context`);
	});

	it("reads from stdin and writes wrapped output (markdown)", async () => {
		setupResolverWith(["DEV-100", "DEV-200"]);

		const fakeStdin = new PassThrough();
		const originalStdin = process.stdin;
		Object.defineProperty(process, "stdin", {
			value: fakeStdin,
			configurable: true,
		});
		// Pretend stdin is piped, not a TTY.
		Object.defineProperty(fakeStdin, "isTTY", { value: false });

		fakeStdin.end("DEV-100 and DEV-200");
		try {
			await runCommand(program, ["refs", "wrap"]);
		} finally {
			Object.defineProperty(process, "stdin", {
				value: originalStdin,
				configurable: true,
			});
		}

		expect(captured).toBe(
			`[DEV-100](${url("DEV-100")}) and [DEV-200](${url("DEV-200")})`,
		);
	});

	it("emits Slack syntax with --target slack", async () => {
		const dir = mkdtempSync(join(tmpdir(), "linctl-refs-"));
		const file = join(dir, "input.md");
		writeFileSync(file, "DEV-100", "utf8");
		setupResolverWith(["DEV-100"]);

		try {
			await runCommand(program, [
				"refs",
				"wrap",
				"--target",
				"slack",
				"--file",
				file,
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}

		expect(captured).toBe(`<${url("DEV-100")}|DEV-100>`);
	});

	it("--no-validate skips workspace resolution and warns on stderr", async () => {
		const dir = mkdtempSync(join(tmpdir(), "linctl-refs-"));
		const file = join(dir, "input.md");
		writeFileSync(file, "real DEV-100 vs ISO-1424", "utf8");
		// Note: NOT setting up mockResolveIssueId — if the code calls it, the
		// test fails because the default mock returns `undefined`.
		mockRawRequest.mockResolvedValue({
			viewer: { organization: { urlKey: W } },
		});

		try {
			await runCommand(program, [
				"refs",
				"wrap",
				"--no-validate",
				"--file",
				file,
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}

		expect(mockResolveIssueId).not.toHaveBeenCalled();
		expect(captured).toBe(
			`real [DEV-100](${url("DEV-100")}) vs [ISO-1424](${url("ISO-1424")})`,
		);
		expect(stderrSpy).toHaveBeenCalled();
	});

	it("leaves unresolvable IDs as plain text (validate path)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "linctl-refs-"));
		const file = join(dir, "input.md");
		writeFileSync(file, "real DEV-100 vs ISO-1424", "utf8");
		setupResolverWith(["DEV-100"]); // ISO-1424 throws

		try {
			await runCommand(program, ["refs", "wrap", "--file", file]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}

		expect(captured).toBe(`real [DEV-100](${url("DEV-100")}) vs ISO-1424`);
	});
});
