import type { Command, OptionValues } from "commander";
import { loadConfig } from "../config/config.js";
import { cached, resolveCacheTTL } from "../utils/disk-cache.js";
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
				const limit = Number.parseInt(options.limit, 10);
				const ttl = resolveCacheTTL({
					configTTL: loadConfig().cacheTTLSeconds,
					// commander's `--no-cache` produces `cache: false` on the root opts.
					noCacheFlag: rootOpts.cache === false,
				});
				const result = await cached(
					`teams-list-limit:${limit}`,
					ttl,
					async () => {
						const service = await createLinearService(rootOpts);
						return service.getTeams(limit);
					},
				);
				outputSuccess({ data: result, meta: { count: result.length } });
			}),
		);
}
