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
		// Match by canonical name or alias. Commander throws on
		// duplicate aliases at registration time, so first-match-wins is
		// only meaningful for the name/alias choice within a single
		// command, not for ambiguity across siblings.
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
				return; // Defense: explicit so test correctness doesn't
				// depend on the vi.spyOn(process.exit) mock throwing.
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
				outputSuccess(describeCommand(target));
			}
		});

	program
		.command("validate-flag [args...]")
		.description(
			"Verify a flag exists on a command. Two equivalent forms:\n" +
				"  $ el-linear validate-flag --check-flag --parent-ticket issues create\n" +
				"  $ el-linear validate-flag issues create --parent-ticket\n" +
				"The first form is unambiguous regardless of whether the flag-to-check " +
				"takes an argument; the positional form needs `--` before flags that " +
				"take args (e.g. `validate-flag -- issues create --jq`) so commander " +
				"doesn't try to consume the next positional as the flag's value. " +
				"Exits 0 if the flag is defined on the target command (or any " +
				"ancestor for inherited globals), 1 otherwise.",
		)
		// Without these, commander tries to parse `--parent-ticket` (the
		// flag we want to *check*) as if it were an option OF validate-flag
		// itself. We need it to pass through as a positional arg.
		.allowUnknownOption(true)
		.option(
			"--check-flag <flag>",
			"the flag to look up (unambiguous alternative to passing it positionally — use this when the flag-being-checked is one that takes an argument)",
		)
		.action((args: string[], options: { checkFlag?: string }) => {
			// Resolve the flag-to-check from either `--check-flag <flag>` or
			// the first positional arg that starts with `-`. The explicit
			// option form sidesteps commander's positional ambiguity for
			// flags that take arguments (e.g. `--jq <filter>`).
			let flag: string;
			let path: string[];
			if (options.checkFlag) {
				flag = options.checkFlag;
				path = args; // all positionals are the command path
			} else {
				const flagIdx = args.findIndex((a) => a.startsWith("-"));
				if (flagIdx === -1) {
					outputSuccess({
						ok: false,
						error:
							"No flag argument found. Pass `--check-flag <flag>` or include `--<flag>` in the positional args.",
						args,
					});
					process.exit(1);
					return;
				}
				path = args.slice(0, flagIdx);
				flag = args[flagIdx];
			}
			const target = path.length === 0 ? program : findCommand(program, path);
			if (!target) {
				outputSuccess({
					ok: false,
					error: `Command not found: ${path.join(" ") || "(root)"}`,
					command: path,
					flag,
				});
				process.exit(1);
				return;
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
				return;
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
