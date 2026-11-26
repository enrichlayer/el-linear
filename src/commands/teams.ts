import type { Command, OptionValues } from "commander";
import { loadConfig } from "../config/config.js";
import { cached, resolveCacheTTL } from "../utils/disk-cache.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

export const TEAMS_LIST_DEFAULT_LIMIT = 100;

export function setupTeamsCommands(program: Command): void {
	const teams = program
		.command("teams")
		.alias("team")
		.description("Team operations");
	teams.action(() => teams.help());

	teams
		.command("list")
		.description("List all teams")
		.option(
			"-l, --limit <number>",
			"limit results",
			String(TEAMS_LIST_DEFAULT_LIMIT),
		)
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const limit = parsePositiveInt(options.limit, "--limit");
				const ttl = resolveCacheTTL({
					configTTL: loadConfig().cacheTTLSeconds,
					// commander's `--no-cache` produces `cache: false` on the root opts.
					noCacheFlag: rootOpts.cache === false,
				});
				const result = await cached(
					`teams-list-window-v2-limit:${limit}`,
					ttl,
					async () => {
						const service = await createLinearService(rootOpts);
						return service.getTeamsWindow(limit);
					},
				);
				outputSuccess({
					data: result.teams,
					meta: {
						count: result.teams.length,
						_limit_applied: limit,
						_fetched: result.teams.length,
						truncated: result.truncated,
						availability: result.truncated
							? {
									status: "partial",
									detail: `more teams exist beyond --limit ${limit}`,
								}
							: { status: "complete" },
					},
				});
			}),
		);

	teams
		.command("lookup <key>")
		.alias("read")
		.description("Look up one team by exact key without scanning the workspace")
		.action(
			handleAsyncCommand(
				async (key: string, _options: OptionValues, command: Command) => {
					const normalizedKey = key.trim().toUpperCase();
					if (!normalizedKey) {
						throw new Error("Team key must not be empty");
					}
					const service = await createLinearService(getRootOpts(command));
					const team = await service.getTeam(normalizedKey);
					outputSuccess({
						data: team,
						meta: {
							status: team ? "found" : "not-found",
							availability: { status: "complete" },
							query: { key: normalizedKey },
						},
					});
				},
			),
		);
}
