/**
 * `el-linear introspect` and `el-linear validate-flag` — expose the
 * commander command tree so external linters (e.g. CI steps that scan
 * SKILL.md files for `el-linear <cmd> --<flag>` references) can verify
 * that hardcoded flag names actually exist on the current binary.
 *
 * Without this, a flag rename inside `el-linear` (say `--parent-ticket`
 * → `--parent`) silently breaks every skill that prose-references the
 * old name. Skills then fail at runtime, far from the rename commit.
 *
 * `introspect` dumps the full tree — name, description, version,
 * options, aliases, and recursively nested subcommands.
 *
 * `validate-flag` is a thin ergonomic wrapper for the CI-lint use case:
 *
 *   $ el-linear validate-flag issues create --parent-ticket
 *   { "ok": true, "command": ["issues", "create"], "flag": "--parent-ticket" }
 *   $ el-linear validate-flag issues create --does-not-exist
 *   { "ok": false, ... "error": "..." }   # exit code 1
 *
 * Both commands ignore root-level flags (`--api-token`, `--json`, etc.)
 * when walking subcommand options; those are dumped at the root, not
 * under every command. `validate-flag` walks ancestors so a global flag
 * (e.g. `--format`) validates on any subcommand.
 */

import type { Command, Option } from "commander";
import { outputSuccess } from "../utils/output.js";

interface OptionDescriptor {
	flags: string;
	long: string | null;
	short: string | null;
	description: string;
	required: boolean;
	optional: boolean;
	variadic: boolean;
	defaultValue: unknown;
	negated: boolean;
}

interface CommandDescriptor {
	name: string;
	aliases: string[];
	description: string;
	usage: string;
	options: OptionDescriptor[];
	commands: CommandDescriptor[];
}

function describeOption(opt: Option): OptionDescriptor {
	return {
		flags: opt.flags,
		long: opt.long ?? null,
		short: opt.short ?? null,
		description: opt.description,
		required: opt.required,
		optional: opt.optional,
		variadic: opt.variadic,
		defaultValue: opt.defaultValue,
		negated: opt.negate,
	};
}

function describeCommand(cmd: Command): CommandDescriptor {
	return {
		name: cmd.name(),
		aliases: cmd.aliases(),
		description: cmd.description(),
		usage: cmd.usage(),
		options: cmd.options.map(describeOption),
		commands: cmd.commands.map(describeCommand),
	};
}

/**
 * Walk the command tree to find the command at `path`. Returns null if
 * any segment doesn't resolve. Matches both canonical name and aliases
 * so `el-linear validate-flag issue get --foo` works the same as
 * `el-linear validate-flag issues read --foo`.
 */
function findCommand(root: Command, path: string[]): Command | null {
	let current: Command = root;
	for (const segment of path) {
		const next = current.commands.find(
			(c) => c.name() === segment || c.aliases().includes(segment),
		);
		if (!next) return null;
		current = next;
	}
	return current;
}

export function setupIntrospectCommand(program: Command): void {
	program
		.command("cli-introspect [path...]")
		.description(
			"Dump the el-linear CLI command tree as JSON so external linters can verify flag references in prose (e.g. SKILL.md). Pass a path (`cli-introspect issues create`) to dump a specific subtree. Distinct from `introspect` (which queries the Linear GraphQL schema).",
		)
		.action((path: string[]) => {
			const target = path.length === 0 ? program : findCommand(program, path);
			if (!target) {
				outputSuccess({
					error: `Command not found: ${path.join(" ")}`,
					path,
				});
				process.exit(1);
			}
			if (path.length === 0) {
				outputSuccess({
					name: program.name(),
					description: program.description(),
					version: program.version() ?? null,
					options: program.options.map(describeOption),
					commands: program.commands.map(describeCommand),
				});
			} else {
				outputSuccess(describeCommand(target as Command));
			}
		});

	program
		.command("validate-flag <args...>")
		.description(
			"Verify a flag exists on a command. Pass the command path followed by the flag — e.g. `el-linear validate-flag issues create --parent-ticket`. Exits 0 if the flag is defined on the target command (or on any ancestor for inherited globals), 1 otherwise. Use `--` before flags if commander mis-parses them: `el-linear validate-flag -- issues create --parent-ticket`.",
		)
		// Without these, commander tries to parse `--parent-ticket` (the
		// flag we want to *check*) as if it were an option OF validate-flag
		// itself. We need it to pass through as a positional arg.
		.allowUnknownOption(true)
		.action((args: string[]) => {
			// The flag is the first arg that starts with `-`; everything
			// before it is the command path. Tolerate the flag being
			// anywhere in the args (not strictly last) since users may
			// write it mid-args by habit.
			const flagIdx = args.findIndex((a) => a.startsWith("-"));
			if (flagIdx === -1) {
				outputSuccess({
					ok: false,
					error: "No flag argument found. Expected `--<flag>` in the args.",
					args,
				});
				process.exit(1);
			}
			const path = args.slice(0, flagIdx);
			const flag = args[flagIdx];
			const target = path.length === 0 ? program : findCommand(program, path);
			if (!target) {
				outputSuccess({
					ok: false,
					error: `Command not found: ${path.join(" ") || "(root)"}`,
					command: path,
					flag,
				});
				process.exit(1);
			}
			// Walk the target + ancestors so root-level globals
			// (--api-token, --format, etc.) validate when a skill writes
			// `el-linear issues create --format summary`.
			const ancestors: Command[] = [];
			for (let c: Command | null = target; c; c = c.parent) {
				ancestors.push(c);
			}
			const allOptions = ancestors.flatMap((c) => c.options);
			const found = allOptions.find(
				(opt) => opt.long === flag || opt.short === flag,
			);
			if (!found) {
				outputSuccess({
					ok: false,
					error: `Flag not found: ${flag}`,
					command: path,
					flag,
					availableOptions: target.options.map((o) => o.long ?? o.short),
				});
				process.exit(1);
			}
			outputSuccess({
				ok: true,
				command: path,
				flag,
				flags: found.flags,
				description: found.description,
			});
		});
}
