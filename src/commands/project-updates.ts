import { readFileSync } from "node:fs";
import type { Command, OptionValues } from "commander";
import {
	CREATE_PROJECT_UPDATE_MUTATION,
	GET_PROJECT_UPDATE_BY_ID_QUERY,
	LIST_PROJECT_UPDATES_QUERY,
} from "../queries/project-updates.js";
import type {
	CreateProjectUpdateResponse,
	GetProjectUpdateByIdResponse,
	ListProjectUpdatesResponse,
	ProjectUpdateHealth,
} from "../queries/project-updates-types.js";
import { notFoundError } from "../utils/error-messages.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

const VALID_HEALTH: readonly ProjectUpdateHealth[] = [
	"onTrack",
	"atRisk",
	"offTrack",
];

/**
 * Resolve the update body from `--body` / `--body-file` (mutually exclusive,
 * exactly one required) — mirrors the comments-command contract so file-sourced
 * bodies sidestep shell-quoting traps for markdown/tables/backticks.
 */
function resolveBody(options: OptionValues): string {
	if (options.body && options.bodyFile) {
		throw new Error(
			"--body and --body-file are mutually exclusive — pass one or the other",
		);
	}
	if (options.bodyFile) {
		return readFileSync(options.bodyFile, "utf-8");
	}
	if (options.body) {
		return options.body;
	}
	throw new Error("Either --body or --body-file is required");
}

/**
 * Validate an optional `--health` value against Linear's
 * `ProjectUpdateHealthType` enum. Returns undefined when the flag is omitted
 * (Linear then defaults the health), throws on an unknown value.
 */
function resolveHealth(
	value: string | undefined,
): ProjectUpdateHealth | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!VALID_HEALTH.includes(value as ProjectUpdateHealth)) {
		throw new Error(
			`Invalid --health "${value}" — expected one of: ${VALID_HEALTH.join(", ")}`,
		);
	}
	return value as ProjectUpdateHealth;
}

async function handleCreateProjectUpdate(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const projectId = await linearService.resolveProjectId(options.project);
	const body = resolveBody(options);
	const health = resolveHealth(options.health);
	const input: Record<string, unknown> = { projectId, body };
	if (health !== undefined) {
		input.health = health;
	}
	if (options.diffHidden) {
		input.isDiffHidden = true;
	}
	const result = await graphQLService.rawRequest<CreateProjectUpdateResponse>(
		CREATE_PROJECT_UPDATE_MUTATION,
		{ input },
	);
	if (
		!result.projectUpdateCreate.success ||
		!result.projectUpdateCreate.projectUpdate
	) {
		throw new Error(
			`Failed to create project update on project "${options.project}"`,
		);
	}
	outputSuccess(result.projectUpdateCreate.projectUpdate);
}

async function handleListProjectUpdates(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const projectId = await linearService.resolveProjectId(options.project);
	const result = await graphQLService.rawRequest<ListProjectUpdatesResponse>(
		LIST_PROJECT_UPDATES_QUERY,
		{
			projectId,
			first: parsePositiveInt(options.limit || "50", "--limit"),
		},
	);
	const nodes = result.project?.projectUpdates.nodes ?? [];
	outputSuccess({ data: nodes, meta: { count: nodes.length } });
}

async function handleReadProjectUpdate(
	updateId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const result = await graphQLService.rawRequest<GetProjectUpdateByIdResponse>(
		GET_PROJECT_UPDATE_BY_ID_QUERY,
		{ id: updateId },
	);
	if (!result.projectUpdate) {
		throw notFoundError("Project update", updateId);
	}
	outputSuccess(result.projectUpdate);
}

export function setupProjectUpdatesCommands(program: Command): void {
	const projectUpdates = program
		.command("project-updates")
		.description("Project update (status post) operations");
	projectUpdates.action(() => projectUpdates.help());

	projectUpdates
		.command("create")
		.description(
			"Post a status update to a project (appears in the project's Updates feed).",
		)
		.requiredOption("--project <project>", "project name or ID")
		.option("--body <body>", "update body markdown (inline)")
		.option("--body-file <path>", "read update body from file")
		.option(
			"--health <health>",
			"project health: onTrack | atRisk | offTrack (omit to leave unset)",
		)
		.option("--diff-hidden", "hide the progress diff on the update")
		.option(
			"-q, --quiet",
			"print one confirmation line (health url) instead of the full JSON",
		)
		.action(handleAsyncCommand(handleCreateProjectUpdate));

	projectUpdates
		.command("list")
		.description("List status updates posted to a project (newest first).")
		.requiredOption("--project <project>", "project name or ID")
		.option("-l, --limit <number>", "limit results", "50")
		.action(handleAsyncCommand(handleListProjectUpdates));

	projectUpdates
		.command("read <updateId>")
		.description("Get a single project update by its ID.")
		.action(handleAsyncCommand(handleReadProjectUpdate));
}
