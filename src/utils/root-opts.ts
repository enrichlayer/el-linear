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
