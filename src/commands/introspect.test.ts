import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const CLI = path.resolve(__dirname, "..", "..", "dist", "main.js");

interface Result {
	stdout: string;
	stderr: string;
	exitCode: number;
}

function run(args: string[]): Result {
	const proc = spawnSync("node", [CLI, ...args], {
		encoding: "utf-8",
		// Empty PROFILE/token env so it doesn't try to load the user's
		// real config — introspect/validate-flag don't need API access.
		env: { ...process.env, EL_LINEAR_PROFILE: "" },
	});
	return {
		stdout: proc.stdout ?? "",
		stderr: proc.stderr ?? "",
		exitCode: proc.status ?? -1,
	};
}

function parseJson(stdout: string): unknown {
	return JSON.parse(stdout);
}

describe("cli-introspect", () => {
	it("returns the full command tree as JSON", () => {
		const r = run(["cli-introspect"]);
		expect(r.exitCode).toBe(0);
		const tree = parseJson(r.stdout) as {
			name: string;
			version: string | null;
			commands: { name: string }[];
			options: { long: string | null }[];
		};
		expect(tree.name).toBe("el-linear");
		// root globals include --jq, --format, --raw, etc.
		const longs = tree.options.map((o) => o.long);
		expect(longs).toContain("--jq");
		expect(longs).toContain("--format");
		// subcommands include the canonical ones the SKILL.md linter cares about
		const cmdNames = tree.commands.map((c) => c.name);
		expect(cmdNames).toContain("issues");
		expect(cmdNames).toContain("comments");
	});

	it("dumps a single subtree when a path is given", () => {
		const r = run(["cli-introspect", "issues", "create"]);
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
		// `issue` is an alias for `issues`; `read` and `get` are alias siblings.
		const r = run(["cli-introspect", "issue", "get"]);
		expect(r.exitCode).toBe(0);
		const cmd = parseJson(r.stdout) as { name: string };
		// commander returns the canonical name even when found via alias
		expect(cmd.name).toBe("read");
	});

	it("exits 1 on an unknown command path", () => {
		const r = run(["cli-introspect", "does-not-exist"]);
		expect(r.exitCode).toBe(1);
		const out = parseJson(r.stdout) as { error: string };
		expect(out.error).toContain("Command not found");
	});
}, 30_000);

describe("validate-flag", () => {
	it("returns ok=true and exit 0 for a flag that exists on the target command", () => {
		const r = run(["validate-flag", "issues", "create", "--parent-ticket"]);
		expect(r.exitCode).toBe(0);
		const out = parseJson(r.stdout) as { ok: boolean; flag: string };
		expect(out.ok).toBe(true);
		expect(out.flag).toBe("--parent-ticket");
	});

	it("returns ok=false and exit 1 for a flag that does not exist", () => {
		const r = run([
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
		// Lists the actual options for the user's reference.
		expect(out.availableOptions).toContain("--parent-ticket");
	});

	it("exits 1 when the command path doesn't resolve", () => {
		const r = run(["validate-flag", "does-not-exist", "--foo"]);
		expect(r.exitCode).toBe(1);
		const out = parseJson(r.stdout) as { ok: boolean; error: string };
		expect(out.ok).toBe(false);
		expect(out.error).toContain("Command not found");
	});

	it("resolves root-level global flags via ancestor walk (uses -- separator for flags taking args)", () => {
		const r = run(["validate-flag", "--", "issues", "create", "--jq"]);
		expect(r.exitCode).toBe(0);
		const out = parseJson(r.stdout) as { ok: boolean; flag: string };
		expect(out.ok).toBe(true);
		expect(out.flag).toBe("--jq");
	});

	it("treats short flags the same as long flags", () => {
		// -t is the short form of --title on `issues create`.
		const r = run(["validate-flag", "issues", "create", "-t"]);
		expect(r.exitCode).toBe(0);
		const out = parseJson(r.stdout) as { ok: boolean; flag: string };
		expect(out.ok).toBe(true);
		expect(out.flag).toBe("-t");
	});

	it("returns ok=false when no flag-shaped arg is present in args", () => {
		const r = run(["validate-flag", "issues", "create"]);
		expect(r.exitCode).toBe(1);
		const out = parseJson(r.stdout) as { ok: boolean; error: string };
		expect(out.ok).toBe(false);
		expect(out.error).toContain("No flag argument");
	});
}, 30_000);
