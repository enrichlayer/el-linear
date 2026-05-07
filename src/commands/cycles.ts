import type { Command, OptionValues } from "commander";
import { resolveTeam } from "../config/resolver.js";
import {
	invalidParameterError,
	notFoundError,
	requiresParameterError,
} from "../utils/error-messages.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";

export function setupCyclesCommands(program: Command): void {
	const cycles = program
		.command("cycles")
		.alias("cycle")
		.description("Cycle operations");
	cycles.action(() => cycles.help());

	cycles
		.command("list")
		.description("List cycles")
		.option("--team <team>", "team key, name, or ID")
		.option("--active", "only active cycles")
		.option(
			"--around-active <n>",
			"return active +/- n cycles (requires --team)",
		)
		.option("-l, --limit <number>", "limit results", "50")
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				if (options.aroundActive && !options.team) {
					throw requiresParameterError("--around-active", "--team");
				}
				const rootOpts = getRootOpts(command);
				const teamFilter = options.team ? resolveTeam(options.team) : undefined;
				const linearService = await createLinearService(rootOpts);
				const allCycles = await linearService.getCycles(
					teamFilter,
					options.active || undefined,
					Number.parseInt(options.limit, 10),
				);
				if (options.aroundActive) {
					const n = Number.parseInt(options.aroundActive, 10);
					if (Number.isNaN(n) || n < 0) {
						throw invalidParameterError(
							"--around-active",
							"requires a non-negative integer",
						);
					}
					const activeCycle = allCycles.find((c) => c.isActive);
					if (!activeCycle) {
						throw notFoundError("Active cycle", options.team, "for team");
					}
					const activeNumber = Number(activeCycle.number || 0);
					const min = activeNumber - n;
					const max = activeNumber + n;
					const filtered = allCycles
						.filter(
							(c) =>
								typeof c.number === "number" &&
								c.number >= min &&
								c.number <= max,
						)
						.sort((a, b) => a.number - b.number);
					outputSuccess({ data: filtered, meta: { count: filtered.length } });
					return;
				}
				outputSuccess({ data: allCycles, meta: { count: allCycles.length } });
			}),
		);

	cycles
		.command("read <cycleIdOrName>")
		.description("Get cycle details including issues.")
		.option("--team <team>", "team key, name, or ID to scope name lookup")
		.option("--issues-first <n>", "how many issues to fetch (default 50)", "50")
		.action(
			handleAsyncCommand(
				async (
					cycleIdOrName: string,
					options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const teamFilter = options.team
						? resolveTeam(options.team)
						: undefined;
					const linearService = await createLinearService(rootOpts);
					const cycleId = await linearService.resolveCycleId(
						cycleIdOrName,
						teamFilter,
					);
					const cycle = await linearService.getCycleById(
						cycleId,
						Number.parseInt(options.issuesFirst || "50", 10),
					);
					outputSuccess(cycle);
				},
			),
		);
}
