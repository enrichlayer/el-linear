import type { Command, OptionValues } from "commander";
import { loadConfig } from "../config/config.js";
import { resolveTeam } from "../config/resolver.js";
import {
	CREATE_LABEL_MUTATION,
	FIND_PARENT_LABEL_QUERY,
	RESTORE_LABEL_MUTATION,
	RETIRE_LABEL_MUTATION,
} from "../queries/labels.js";
import type { GraphQLResponseData } from "../types/linear.js";
import { cached, resolveCacheTTL } from "../utils/disk-cache.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { validateHexColor } from "../utils/validators.js";

async function handleCreateLabel(
	name: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const teamId = resolveTeam(options.team);
	const graphQLService = await createGraphQLService(rootOpts);

	const input: Record<string, unknown> = { name, teamId };
	if (options.color) {
		input.color = validateHexColor(options.color);
	}
	if (options.description) {
		input.description = options.description;
	}

	if (options.parent) {
		const parentResult = await graphQLService.rawRequest(
			FIND_PARENT_LABEL_QUERY,
			{
				name: options.parent,
				teamId,
			},
		);
		const issueLabels = parentResult.issueLabels as
			| GraphQLResponseData
			| undefined;
		const nodes = issueLabels?.nodes as GraphQLResponseData[] | undefined;
		const parentLabel = nodes?.[0];
		if (parentLabel) {
			input.parentId = parentLabel.id;
		}
	}

	const result = await graphQLService.rawRequest(CREATE_LABEL_MUTATION, {
		input,
	});
	const createResult = result.issueLabelCreate as
		| GraphQLResponseData
		| undefined;
	if (!createResult?.success) {
		throw new Error(`Failed to create label "${name}"`);
	}
	outputSuccess(createResult.issueLabel);
}

async function handleRetireLabel(
	labelId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const result = await graphQLService.rawRequest(RETIRE_LABEL_MUTATION, {
		id: labelId,
	});
	const retireResult = result.issueLabelRetire as
		| GraphQLResponseData
		| undefined;
	if (!retireResult?.success) {
		throw new Error(`Failed to retire label "${labelId}"`);
	}
	outputSuccess(retireResult.issueLabel);
}

async function handleRestoreLabel(
	labelId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const result = await graphQLService.rawRequest(RESTORE_LABEL_MUTATION, {
		id: labelId,
	});
	const restoreResult = result.issueLabelRestore as
		| GraphQLResponseData
		| undefined;
	if (!restoreResult?.success) {
		throw new Error(`Failed to restore label "${labelId}"`);
	}
	outputSuccess(restoreResult.issueLabel);
}

export function setupLabelsCommands(program: Command): void {
	const labels = program
		.command("labels")
		.alias("label")
		.description("Label operations");
	labels.action(() => labels.help());

	labels
		.command("list")
		.description("List all available labels")
		.option("--team <team>", "filter by team key, name, or ID")
		.option("-l, --limit <number>", "limit results", "100")
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const teamFilter = options.team ? resolveTeam(options.team) : undefined;
				const limit = Number.parseInt(options.limit, 10);
				const ttl = resolveCacheTTL({
					configTTL: loadConfig().cacheTTLSeconds,
					noCacheFlag: rootOpts.cache === false,
				});
				// Cache key includes the team filter so list-with-team and list-
				// without-team don't collide. Same `limit` participates because
				// a smaller list isn't a valid cached answer for a larger ask.
				const cacheKey = `labels-list-team:${teamFilter ?? "_all"}-limit:${limit}`;
				const result = await cached(cacheKey, ttl, async () => {
					const service = await createLinearService(rootOpts);
					return service.getLabels(teamFilter, limit);
				});
				outputSuccess({
					data: result.labels,
					meta: { count: result.labels.length },
				});
			}),
		);

	labels
		.command("create <name>")
		.description("Create a new label on a team")
		.requiredOption("--team <team>", "team key, name, or ID")
		.option("--color <color>", "label color (hex, e.g. #e06666)")
		.option("--description <desc>", "label description")
		.option("--parent <parent>", "parent label group name or ID")
		.action(handleAsyncCommand(handleCreateLabel));

	labels
		.command("retire <labelId>")
		.description("Retire a label (soft-delete — can be restored later)")
		.action(handleAsyncCommand(handleRetireLabel));

	labels
		.command("restore <labelId>")
		.description("Restore a previously retired label")
		.action(handleAsyncCommand(handleRestoreLabel));
}
