import type { Command, OptionValues } from "commander";
import {
	CREATE_PROJECT_MILESTONE_MUTATION,
	FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL,
	FIND_PROJECT_MILESTONE_BY_NAME_SCOPED,
	GET_PROJECT_MILESTONE_BY_ID_QUERY,
	LIST_PROJECT_MILESTONES_QUERY,
	UPDATE_PROJECT_MILESTONE_MUTATION,
} from "../queries/project-milestones.js";
import type {
	CreateProjectMilestoneResponse,
	FindProjectMilestoneGlobalResponse,
	FindProjectMilestoneScopedResponse,
	GetProjectMilestoneByIdResponse,
	ListProjectMilestonesResponse,
	MilestoneLookupNode,
	UpdateProjectMilestoneResponse,
} from "../queries/project-milestones-types.js";
import {
	multipleMatchesError,
	notFoundError,
} from "../utils/error-messages.js";
import {
	createGraphQLService,
	type GraphQLService,
} from "../utils/graphql-service.js";
import {
	createLinearService,
	type LinearService,
} from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { isUuid } from "../utils/uuid.js";
import { parsePositiveInt, validateIsoDate } from "../utils/validators.js";

async function resolveMilestoneId(
	milestoneNameOrId: string,
	graphQLService: GraphQLService,
	linearService: LinearService,
	projectNameOrId?: string,
): Promise<string> {
	if (isUuid(milestoneNameOrId)) {
		return milestoneNameOrId;
	}
	let nodes: MilestoneLookupNode[] = [];
	if (projectNameOrId) {
		const projectId = await linearService.resolveProjectId(projectNameOrId);
		const findRes =
			await graphQLService.rawRequest<FindProjectMilestoneScopedResponse>(
				FIND_PROJECT_MILESTONE_BY_NAME_SCOPED,
				{
					name: milestoneNameOrId,
					projectId,
				},
			);
		nodes = findRes.project?.projectMilestones.nodes ?? [];
	}
	if (nodes.length === 0) {
		const globalRes =
			await graphQLService.rawRequest<FindProjectMilestoneGlobalResponse>(
				FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL,
				{ name: milestoneNameOrId },
			);
		nodes = globalRes.projectMilestones.nodes;
	}
	if (nodes.length === 0) {
		throw notFoundError("Milestone", milestoneNameOrId);
	}
	if (nodes.length > 1) {
		const matches = nodes.map(
			(m) => `"${m.name}" in project "${m.project.name}"`,
		);
		throw multipleMatchesError(
			"milestone",
			milestoneNameOrId,
			matches,
			"specify --project or use the milestone ID",
		);
	}
	return nodes[0].id;
}

async function handleListMilestones(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const projectId = await linearService.resolveProjectId(options.project);
	const result = await graphQLService.rawRequest<ListProjectMilestonesResponse>(
		LIST_PROJECT_MILESTONES_QUERY,
		{
			projectId,
			first: parsePositiveInt(options.limit || "50", "--limit"),
		},
	);
	const nodes = result.project?.projectMilestones.nodes ?? [];
	outputSuccess({ data: nodes, meta: { count: nodes.length } });
}

async function handleReadMilestone(
	milestoneIdOrName: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const milestoneId = await resolveMilestoneId(
		milestoneIdOrName,
		graphQLService,
		linearService,
		options.project,
	);
	const result =
		await graphQLService.rawRequest<GetProjectMilestoneByIdResponse>(
			GET_PROJECT_MILESTONE_BY_ID_QUERY,
			{
				id: milestoneId,
				issuesFirst: Number.parseInt(options.issuesFirst || "50", 10),
			},
		);
	outputSuccess(result.projectMilestone);
}

async function handleCreateMilestone(
	name: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const projectId = await linearService.resolveProjectId(options.project);
	if (options.targetDate) {
		validateIsoDate(options.targetDate);
	}
	const result =
		await graphQLService.rawRequest<CreateProjectMilestoneResponse>(
			CREATE_PROJECT_MILESTONE_MUTATION,
			{
				projectId,
				name,
				description: options.description,
				targetDate: options.targetDate,
			},
		);
	if (
		!result.projectMilestoneCreate.success ||
		!result.projectMilestoneCreate.projectMilestone
	) {
		throw new Error("Failed to create project milestone");
	}
	outputSuccess(result.projectMilestoneCreate.projectMilestone);
}

async function handleUpdateMilestone(
	milestoneIdOrName: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const milestoneId = await resolveMilestoneId(
		milestoneIdOrName,
		graphQLService,
		linearService,
		options.project,
	);
	const updateVars: Record<string, unknown> = { id: milestoneId };
	if (options.name !== undefined) {
		updateVars.name = options.name;
	}
	if (options.description !== undefined) {
		updateVars.description = options.description;
	}
	if (options.targetDate !== undefined) {
		validateIsoDate(options.targetDate);
		updateVars.targetDate = options.targetDate;
	}
	if (options.sortOrder !== undefined) {
		updateVars.sortOrder = Number.parseFloat(options.sortOrder);
	}
	const result =
		await graphQLService.rawRequest<UpdateProjectMilestoneResponse>(
			UPDATE_PROJECT_MILESTONE_MUTATION,
			updateVars,
		);
	if (
		!result.projectMilestoneUpdate.success ||
		!result.projectMilestoneUpdate.projectMilestone
	) {
		throw new Error("Failed to update project milestone");
	}
	outputSuccess(result.projectMilestoneUpdate.projectMilestone);
}

export function setupProjectMilestonesCommands(program: Command): void {
	const projectMilestones = program
		.command("project-milestones")
		.description("Project milestone operations");
	projectMilestones.action(() => projectMilestones.help());

	projectMilestones
		.command("list")
		.description("List milestones in a project")
		.requiredOption("--project <project>", "project name or ID")
		.option("-l, --limit <number>", "limit results", "50")
		.action(handleAsyncCommand(handleListMilestones));

	projectMilestones
		.command("read <milestoneIdOrName>")
		.description("Get milestone details including issues.")
		.option("--project <project>", "project name or ID to scope name lookup")
		.option("--issues-first <n>", "how many issues to fetch (default 50)", "50")
		.action(handleAsyncCommand(handleReadMilestone));

	projectMilestones
		.command("create <name>")
		.description("Create a new project milestone")
		.requiredOption("--project <project>", "project name or ID")
		.option("-d, --description <description>", "milestone description")
		.option("--target-date <date>", "target date in ISO format (YYYY-MM-DD)")
		.action(handleAsyncCommand(handleCreateMilestone));

	projectMilestones
		.command("update <milestoneIdOrName>")
		.description("Update an existing project milestone.")
		.option("--project <project>", "project name or ID to scope name lookup")
		.option("-n, --name <name>", "new milestone name")
		.option("-d, --description <description>", "new milestone description")
		.option(
			"--target-date <date>",
			"new target date in ISO format (YYYY-MM-DD)",
		)
		.option("--sort-order <number>", "new sort order")
		.action(handleAsyncCommand(handleUpdateMilestone));
}
