import type { Command, OptionValues } from "commander";

/**
 * Extract root command options from inside a subcommand action handler.
 *
 * Commander guarantees `command.parent` exists inside any subcommand action,
 * and `command.parent.parent` exists inside a nested subcommand action
 * (e.g. `el-linear comments create` — the `create` command is nested under
 * `comments`, which is nested under the root program). The non-null
 * assertions live here so call sites can stay clean and typed.
 */
export function getRootOpts(command: Command): OptionValues {
	// biome-ignore lint/style/noNonNullAssertion: command.parent / .parent.parent are guaranteed by commander inside subcommand actions; see docstring
	return (command.parent?.parent ?? command.parent!).opts();
}

/**
 * Resolve an option that is registered on BOTH the root program and a
 * subcommand (`--format` / `--fields` on `issues list|search`,
 * `projects list`).
 *
 * Commander 15 hands a same-named option to the OUTERMOST registration
 * even when it appears after the subcommand: `issues list --format table`
 * sets the program's global `--format` and leaves the subcommand's local
 * option at its default, so handlers reading `options.format` silently
 * saw `"json"` (DEV-5376). Precedence here: local CLI-set value, then the
 * nearest ancestor's CLI-set value, then the local default.
 */
export function effectiveOption(
	command: Command,
	key: string,
): string | undefined {
	if (command.getOptionValueSource(key) === "cli") {
		return command.getOptionValue(key) as string | undefined;
	}
	for (let c = command.parent; c; c = c.parent) {
		if (c.getOptionValueSource(key) === "cli") {
			return c.getOptionValue(key) as string | undefined;
		}
	}
	return command.getOptionValue(key) as string | undefined;
}
