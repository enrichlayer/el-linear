import type { Command, OptionValues } from "commander";
import { createLinearService } from "../utils/linear-service.js";
import {
	handleAsyncCommand,
	outputSuccess,
	warnIfTruncated,
} from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

export function setupUsersCommands(program: Command): void {
	const users = program.command("users").description("User operations");
	users.action(() => users.help());

	users
		.command("read <id>")
		.description(
			"Look up a single user by UUID, email, or name (resolves ambiguity the same way as other --assignee-style lookups).",
		)
		.action(
			handleAsyncCommand(
				async (id: string, _options: OptionValues, command: Command) => {
					const rootOpts = getRootOpts(command);
					const service = await createLinearService(rootOpts);
					const result = await service.getUser(id);
					outputSuccess({ data: result });
				},
			),
		);

	users
		.command("list")
		.description("List all users")
		.option("--active", "Only show active users")
		.option(
			"--name <substring>",
			"filter by case-insensitive substring on user name",
		)
		.option("-l, --limit <number>", "limit results", "100")
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const service = await createLinearService(rootOpts);
				const limit = parsePositiveInt(options.limit, "--limit");
				const result = await service.getUsers(
					options.active,
					limit,
					options.name as string | undefined,
				);
				warnIfTruncated(result.length, limit);
				outputSuccess({ data: result, meta: { count: result.length } });
			}),
		);
}
