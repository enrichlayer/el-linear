import type { Command, OptionValues } from "commander";
import { loadConfig } from "../config/config.js";
import { resolveTeam } from "../config/resolver.js";
import {
	CREATE_LABEL_MUTATION,
	FIND_PARENT_LABEL_QUERY,
	RESTORE_LABEL_MUTATION,
	RETIRE_LABEL_MUTATION,
} from "../queries/labels.js";
import type {
	CreateLabelResponse,
	FindParentLabelResponse,
	RestoreLabelResponse,
	RetireLabelResponse,
} from "../queries/labels-types.js";
import { cached, resolveCacheTTL } from "../utils/disk-cache.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt, validateHexColor } from "../utils/validators.js";

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
		const parentResult =
			await graphQLService.rawRequest<FindParentLabelResponse>(
				FIND_PARENT_LABEL_QUERY,
				{
					name: options.parent,
					teamId,
				},
			);
		const parentLabel = parentResult.issueLabels.nodes[0];
		if (parentLabel) {
			input.parentId = parentLabel.id;
		}
	}

	const result = await graphQLService.rawRequest<CreateLabelResponse>(
		CREATE_LABEL_MUTATION,
		{ input },
	);
	if (!result.issueLabelCreate.success || !result.issueLabelCreate.issueLabel) {
		throw new Error(`Failed to create label "${name}"`);
	}
	outputSuccess(result.issueLabelCreate.issueLabel);
}

async function handleRetireLabel(
	labelId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const result = await graphQLService.rawRequest<RetireLabelResponse>(
		RETIRE_LABEL_MUTATION,
		{ id: labelId },
	);
	if (!result.issueLabelRetire.success || !result.issueLabelRetire.issueLabel) {
		throw new Error(`Failed to retire label "${labelId}"`);
	}
	outputSuccess(result.issueLabelRetire.issueLabel);
}

async function handleRestoreLabel(
	labelId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const result = await graphQLService.rawRequest<RestoreLabelResponse>(
		RESTORE_LABEL_MUTATION,
		{ id: labelId },
	);
	if (
		!result.issueLabelRestore.success ||
		!result.issueLabelRestore.issueLabel
	) {
		throw new Error(`Failed to restore label "${labelId}"`);
	}
	outputSuccess(result.issueLabelRestore.issueLabel);
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
		.option(
			"--name <substring>",
			"filter by case-insensitive substring on label name",
		)
		.option("-l, --limit <number>", "limit results", "100")
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const teamFilter = options.team ? resolveTeam(options.team) : undefined;
				const nameFilter = options.name as string | undefined;
				const limit = parsePositiveInt(options.limit, "--limit");
				const ttl = resolveCacheTTL({
					configTTL: loadConfig().cacheTTLSeconds,
					noCacheFlag: rootOpts.cache === false,
				});
				// Cache key includes the team filter and name filter so different
				// filter combinations don't collide. Same `limit` participates
				// because a smaller list isn't a valid cached answer for a larger ask.
				const cacheKey = `labels-list-team:${teamFilter ?? "_all"}-name:${nameFilter ?? "_all"}-limit:${limit}`;
				const result = await cached(cacheKey, ttl, async () => {
					const service = await createLinearService(rootOpts);
					return service.getLabels(teamFilter, limit, nameFilter);
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
