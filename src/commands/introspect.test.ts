import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupIntrospectCommand } from "./introspect.js";

// Build a minimal program that mirrors the shape main.ts wires up: a root
// program with global options, plus a couple of subcommands with their own
// options. We don't import the full main.ts because it has side effects
// (program.parse, profile resolution, etc.) — we only need a tree to walk.
function buildTestProgram(): Command {
	const program = new Command();
	program
		.name("el-linear")
		.description("test fixture for cli-introspect")
		.version("1.10.0")
		.option("--api-token <token>", "Linear API token")
		.option("--format <kind>", "output format", "json")
		.option("--jq <filter>", "apply a jq filter");

	const issues = program.command("issues").alias("issue");
	issues
		.command("create")
		.alias("new")
		.description("Create a new issue")
		.option("-t, --title <title>", "issue title")
		.option("--parent-ticket <parentId>", "parent issue ID")
		.option("--description <body>", "issue description");
	issues
		.command("read <id>")
		.alias("get")
		.description("Get issue details")
		.option("--field <name>", "extract a section");

	const comments = program.command("comments");
	comments.command("create <issueId>").option("--body <text>", "comment body");

	setupIntrospectCommand(program);
	return program;
}

interface RunResult {
	stdout: string;
	exitCode: number;
}

// `outputSuccess` writes via logger.info -> process.stdout.write under the
// hood. Capture stdout writes and process.exit calls so we can read the
// command's behavior without spawning a subprocess (which would require
// dist/ to be built and slows tests by ~30x).
function captureRun(program: Command, argv: string[]): RunResult {
	let stdout = "";
	let exitCode = 0;
	const stdoutSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation((chunk: unknown) => {
			stdout += typeof chunk === "string" ? chunk : String(chunk);
			return true;
		});
	const exitSpy = vi
		.spyOn(process, "exit")
		.mockImplementation((code?: number | string | null) => {
			exitCode = typeof code === "number" ? code : 0;
			// Throw to short-circuit the action callback, mirroring the real
			// behavior where process.exit() terminates immediately.
			throw new Error(`__exit_${exitCode}__`);
		});
	try {
		// from: "user" means argv is already stripped of node + script — pass
		// just the user's args.
		program.parse(argv, { from: "user" });
	} catch (err) {
		if (!(err instanceof Error) || !err.message.startsWith("__exit_")) {
			throw err;
		}
	} finally {
		stdoutSpy.mockRestore();
		exitSpy.mockRestore();
	}
	return { stdout, exitCode };
}

function parseJson(stdout: string): unknown {
	return JSON.parse(stdout);
}

describe("cli-introspect", () => {
	let program: Command;
	beforeEach(() => {
		program = buildTestProgram();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the full command tree as JSON", () => {
		const r = captureRun(program, ["cli-introspect"]);
		expect(r.exitCode).toBe(0);
		const tree = parseJson(r.stdout) as {
			name: string;
			version: string | null;
			commands: { name: string }[];
			options: { long: string | null }[];
		};
		expect(tree.name).toBe("el-linear");
		expect(tree.version).toBe("1.10.0");
		// root globals included
		expect(tree.options.map((o) => o.long)).toEqual(
			expect.arrayContaining(["--api-token", "--format", "--jq"]),
		);
		expect(tree.commands.map((c) => c.name)).toEqual(
			expect.arrayContaining(["issues", "comments"]),
		);
	});

	it("dumps a single subtree when a path is given", () => {
		const r = captureRun(program, ["cli-introspect", "issues", "create"]);
		expect(r.exitCode).toBe(0);
		const cmd = parseJson(r.stdout) as {
			name: string;
			options: { long: string | null }[];
		};
		expect(cmd.name).toBe("create");
		const longs = cmd.options.map((o) => o.long);
		expect(longs).toContain("--parent-ticket");
		expect(longs).toContain("--title");
	});

	it("resolves aliases when walking the command path", () => {
		const r = captureRun(program, ["cli-introspect", "issue", "get"]);
		expect(r.exitCode).toBe(0);
		const cmd = parseJson(r.stdout) as { name: string };
		// commander returns the canonical name even when found via alias
		expect(cmd.name).toBe("read");
	});

	it("exits 1 on an unknown command path", () => {
		const r = captureRun(program, ["cli-introspect", "does-not-exist"]);
		expect(r.exitCode).toBe(1);
		const out = parseJson(r.stdout) as { error: string };
		expect(out.error).toContain("Command not found");
	});
});

describe("validate-flag", () => {
	let program: Command;
	beforeEach(() => {
		program = buildTestProgram();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns ok=true and exit 0 for a flag that exists on the target command", () => {
		const r = captureRun(program, [
			"validate-flag",
			"issues",
			"create",
			"--parent-ticket",
		]);
		expect(r.exitCode).toBe(0);
		const out = parseJson(r.stdout) as { ok: boolean; flag: string };
		expect(out.ok).toBe(true);
		expect(out.flag).toBe("--parent-ticket");
	});

	it("returns ok=false and exit 1 for a flag that does not exist", () => {
		const r = captureRun(program, [
			"validate-flag",
			"issues",
			"create",
			"--this-flag-does-not-exist",
		]);
		expect(r.exitCode).toBe(1);
		const out = parseJson(r.stdout) as {
			ok: boolean;
			error: string;
			availableOptions: string[];
		};
		expect(out.ok).toBe(false);
		expect(out.error).toContain("Flag not found");
		expect(out.availableOptions).toContain("--parent-ticket");
	});

	it("exits 1 when the command path doesn't resolve", () => {
		const r = captureRun(program, ["validate-flag", "does-not-exist", "--foo"]);
		expect(r.exitCode).toBe(1);
		const out = parseJson(r.stdout) as { ok: boolean; error: string };
		expect(out.ok).toBe(false);
		expect(out.error).toContain("Command not found");
	});

	it("resolves root-level global flags via ancestor walk", () => {
		const r = captureRun(program, [
			"validate-flag",
			"--",
			"issues",
			"create",
			"--jq",
		]);
		expect(r.exitCode).toBe(0);
		const out = parseJson(r.stdout) as { ok: boolean; flag: string };
		expect(out.ok).toBe(true);
		expect(out.flag).toBe("--jq");
	});

	it("treats short flags the same as long flags", () => {
		const r = captureRun(program, ["validate-flag", "issues", "create", "-t"]);
		expect(r.exitCode).toBe(0);
		const out = parseJson(r.stdout) as { ok: boolean; flag: string };
		expect(out.ok).toBe(true);
		expect(out.flag).toBe("-t");
	});

	it("returns ok=false when no flag-shaped arg is present in args", () => {
		const r = captureRun(program, ["validate-flag", "issues", "create"]);
		expect(r.exitCode).toBe(1);
		const out = parseJson(r.stdout) as { ok: boolean; error: string };
		expect(out.ok).toBe(false);
		expect(out.error).toContain("No flag argument");
	});

	it("accepts the flag via --check-flag for unambiguous parsing", () => {
		// --check-flag form sidesteps commander's positional parsing
		// entirely: works with flags that take args without needing `--`.
		const r = captureRun(program, [
			"validate-flag",
			"--check-flag",
			"--parent-ticket",
			"issues",
			"create",
		]);
		expect(r.exitCode).toBe(0);
		const out = parseJson(r.stdout) as { ok: boolean; flag: string };
		expect(out.ok).toBe(true);
		expect(out.flag).toBe("--parent-ticket");
	});

	it("--check-flag with a missing flag returns ok=false", () => {
		const r = captureRun(program, [
			"validate-flag",
			"--check-flag",
			"--does-not-exist",
			"issues",
			"create",
		]);
		expect(r.exitCode).toBe(1);
		const out = parseJson(r.stdout) as { ok: boolean; flag: string };
		expect(out.ok).toBe(false);
		expect(out.flag).toBe("--does-not-exist");
	});
});
