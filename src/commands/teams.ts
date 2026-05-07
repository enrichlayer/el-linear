import type { Command, OptionValues } from "commander";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";

export function setupTeamsCommands(program: Command): void {
	const teams = program
		.command("teams")
		.alias("team")
		.description("Team operations");
	teams.action(() => teams.help());

	teams
		.command("list")
		.description("List all teams")
		.option("-l, --limit <number>", "limit results", "100")
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const service = await createLinearService(rootOpts);
				const result = await service.getTeams(
					Number.parseInt(options.limit, 10),
				);
				outputSuccess({ data: result, meta: { count: result.length } });
			}),
		);
}
