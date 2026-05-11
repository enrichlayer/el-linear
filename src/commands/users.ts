import type { Command, OptionValues } from "commander";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

export function setupUsersCommands(program: Command): void {
	const users = program.command("users").description("User operations");
	users.action(() => users.help());

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
				const result = await service.getUsers(
					options.active,
					parsePositiveInt(options.limit, "--limit"),
					options.name as string | undefined,
				);
				outputSuccess({ data: result, meta: { count: result.length } });
			}),
		);
}
