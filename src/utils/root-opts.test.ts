import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { effectiveOption } from "./root-opts.js";

/**
 * Replicates main.ts's option topology: `--format` / `--fields` registered
 * on the root program AND on a nested subcommand. Commander 15 assigns the
 * CLI token to the root registration even when it appears after the
 * subcommand — the regression that made `issues list --format table
 * --fields …` fall through to the JSON envelope (DEV-5376).
 */
function buildProgram(onAction: (command: Command) => void): Command {
	const program = new Command("el-linear");
	program
		.exitOverride()
		.option("--format <kind>", "global format", "json")
		.option("--fields <fields>", "global fields filter");
	const issues = program.command("issues");
	issues
		.command("list")
		.option("--format <format>", "local format", "json")
		.option("--fields <fields>", "local columns")
		.action((_opts: unknown, command: Command) => {
			onAction(command);
		});
	return program;
}

function parseAndCapture(argv: string[]): Command {
	let captured: Command | undefined;
	buildProgram((command) => {
		captured = command;
	}).parse(["node", "el-linear", ...argv]);
	if (!captured) {
		throw new Error("action did not run");
	}
	return captured;
}

describe("effectiveOption (DEV-5376)", () => {
	it("returns the CLI value when --format is passed after the subcommand (root steals the token)", () => {
		const command = parseAndCapture(["issues", "list", "--format", "table"]);
		// The regression: the subcommand's own option never receives the value.
		expect(command.opts().format).toBe("json");
		expect(effectiveOption(command, "format")).toBe("table");
	});

	it("returns the CLI value when --format is passed before the subcommand", () => {
		const command = parseAndCapture(["--format", "csv", "issues", "list"]);
		expect(effectiveOption(command, "format")).toBe("csv");
	});

	it("resolves --fields passed after the subcommand", () => {
		const command = parseAndCapture([
			"issues",
			"list",
			"--fields",
			"identifier,status,updated",
		]);
		expect(effectiveOption(command, "fields")).toBe(
			"identifier,status,updated",
		);
	});

	it("falls back to the local default when nothing is passed", () => {
		const command = parseAndCapture(["issues", "list"]);
		expect(effectiveOption(command, "format")).toBe("json");
		expect(effectiveOption(command, "fields")).toBeUndefined();
	});

	it("prefers a CLI-set local value over an ancestor's (future-proofing against commander precedence changes)", () => {
		const command = parseAndCapture(["issues", "list"]);
		command.setOptionValueWithSource("format", "md", "cli");
		expect(effectiveOption(command, "format")).toBe("md");
	});
});
