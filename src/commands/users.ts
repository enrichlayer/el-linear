import type { Command, OptionValues } from "commander";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

export function setupUsersCommands(program: Command): void {
  const users = program.command("users").description("User operations");
  users.action(() => users.help());

  users
    .command("list")
    .description("List all users")
    .option("--active", "Only show active users")
    .option("-l, --limit <number>", "limit results", "100")
    .action(
      handleAsyncCommand(async (options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const service = createLinearService(rootOpts);
        const result = await service.getUsers(options.active, Number.parseInt(options.limit, 10));
        outputSuccess({ data: result, meta: { count: result.length } });
      }),
    );
}
