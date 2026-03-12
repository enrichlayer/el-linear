import type { Command, OptionValues } from "commander";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

export function setupTeamsCommands(program: Command): void {
  const teams = program.command("teams").alias("team").description("Team operations");
  teams.action(() => teams.help());

  teams
    .command("list")
    .description("List all teams")
    .option("-l, --limit <number>", "limit results", "100")
    .action(
      handleAsyncCommand(async (options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const service = createLinearService(rootOpts);
        const result = await service.getTeams(Number.parseInt(options.limit, 10));
        outputSuccess({ data: result, meta: { count: result.length } });
      }),
    );
}
