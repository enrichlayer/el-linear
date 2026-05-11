import type { Command, OptionValues } from "commander";
import { loadConfig } from "../config/config.js";
import { resolveTeam } from "../config/resolver.js";
import {
	ARCHIVE_PROJECT_MUTATION,
	CREATE_PROJECT_MUTATION,
	DELETE_PROJECT_MUTATION,
	GET_PROJECT_QUERY,
	GET_PROJECT_TEAM_ISSUES_QUERY,
	PROJECT_BY_ID_QUERY,
	SEARCH_PROJECTS_BY_NAME_QUERY,
	UPDATE_PROJECT_MUTATION,
} from "../queries/projects.js";
import type {
	ArchiveProjectResponse,
	CreateProjectResponse,
	DeleteProjectResponse,
	GetProjectResponse,
	GetProjectTeamIssuesResponse,
	ProjectByIdResponse,
	SearchProjectsByNameResponse,
	UpdateProjectResponse,
} from "../queries/projects-types.js";
import type { LinearProject } from "../types/linear.js";
import { cached, resolveCacheTTL } from "../utils/disk-cache.js";
import type { GraphQLService } from "../utils/graphql-service.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { logger } from "../utils/logger.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import {
	type ColumnDef,
	type MarkdownColumnDef,
	renderCsv,
	renderFixedWidthTable,
	renderMarkdownTable,
} from "../utils/table-formatter.js";
import { isUuid } from "../utils/uuid.js";
import { splitList } from "../utils/validators.js";

const VALID_PROJECT_STATES: ReadonlySet<string> = new Set([
	"backlog",
	"planned",
	"started",
	"paused",
	"completed",
	"canceled",
]);

function parseStateList(value: string, flagName: string): string[] {
	const states = splitList(value).map((s) => s.toLowerCase());
	for (const s of states) {
		if (!VALID_PROJECT_STATES.has(s)) {
			throw new Error(
				`Invalid state "${s}" for ${flagName}. Valid: ${[...VALID_PROJECT_STATES].join(", ")}.`,
			);
		}
	}
	return states;
}

export function resolveProjectStateFilter(options: OptionValues): {
	states?: string[];
	excludeStates?: string[];
} {
	const flags = [options.state, options.excludeState, options.active].filter(
		Boolean,
	).length;
	if (flags > 1) {
		throw new Error(
			"--state, --exclude-state, and --active are mutually exclusive.",
		);
	}
	if (options.active) {
		return { excludeStates: ["completed", "canceled"] };
	}
	if (options.state) {
		return { states: parseStateList(options.state as string, "--state") };
	}
	if (options.excludeState) {
		return {
			excludeStates: parseStateList(
				options.excludeState as string,
				"--exclude-state",
			),
		};
	}
	return {};
}

// ── Project column definitions ────────────────────────────────
//
// Pre-fix this file inlined an 80-line `formatProjectsOutput`
// function that hand-rolled column width math, table padding, CSV
// quoting, and markdown pipe syntax — all duplicating
// `utils/table-formatter.ts`. Now we declare `ColumnDef<LinearProject>`
// arrays and let the shared renderers do the work. ALL-938 cleanup.

const PROJECT_COLUMNS: Record<string, ColumnDef<LinearProject>> = {
	name: { key: "name", header: "Name", width: 32, extract: (p) => p.name },
	state: {
		key: "state",
		header: "State",
		width: 10,
		extract: (p) => p.state ?? "",
	},
	progress: {
		key: "progress",
		header: "Progress",
		width: 10,
		extract: (p) =>
			p.progress !== undefined ? `${Math.round(p.progress * 100)}%` : "",
	},
	teams: {
		key: "teams",
		header: "Teams",
		width: 18,
		extract: (p) => p.teams?.map((t) => t.key).join(", ") ?? "",
	},
	lead: {
		key: "lead",
		header: "Lead",
		width: 18,
		extract: (p) => p.lead?.name ?? "",
	},
	targetDate: {
		key: "targetDate",
		header: "Target",
		width: 12,
		extract: (p) => p.targetDate ?? "",
	},
	id: { key: "id", header: "ID", width: 38, extract: (p) => p.id },
};

const PROJECT_MD_COLUMNS: Record<string, MarkdownColumnDef<LinearProject>> = {
	name: { header: "Name", extract: (p) => p.name },
	state: { header: "State", extract: (p) => p.state ?? "" },
	progress: {
		header: "Progress",
		extract: (p) =>
			p.progress !== undefined ? `${Math.round(p.progress * 100)}%` : "",
	},
	teams: {
		header: "Teams",
		extract: (p) => p.teams?.map((t) => t.key).join(", ") ?? "",
	},
	lead: { header: "Lead", extract: (p) => p.lead?.name ?? "" },
	targetDate: { header: "Target", extract: (p) => p.targetDate ?? "" },
	id: { header: "ID", extract: (p) => p.id },
};

const DEFAULT_PROJECT_COLUMNS = [
	"name",
	"state",
	"progress",
	"teams",
	"lead",
	"targetDate",
];

function formatProjectsOutput(
	projects: LinearProject[],
	format: string,
	fieldNames?: string[],
): void {
	const keys = fieldNames ?? DEFAULT_PROJECT_COLUMNS;

	if (format === "csv") {
		const columns = keys
			.map((k) => PROJECT_COLUMNS[k])
			.filter((c): c is ColumnDef<LinearProject> => c !== undefined);
		logger.info(renderCsv(projects, columns));
		return;
	}

	if (format === "md") {
		const columns = keys
			.map((k) => PROJECT_MD_COLUMNS[k])
			.filter((c): c is MarkdownColumnDef<LinearProject> => c !== undefined);
		logger.info(renderMarkdownTable(projects, columns));
		return;
	}

	// Default: fixed-width text table.
	const columns = keys
		.map((k) => PROJECT_COLUMNS[k])
		.filter((c): c is ColumnDef<LinearProject> => c !== undefined);
	logger.info(renderFixedWidthTable(projects, columns));
}

interface ProjectTeamInfo {
	currentTeams: { id: string; key: string; name: string }[];
	projectId: string;
	projectName: string;
}

async function resolveProjectWithTeams(
	graphQLService: GraphQLService,
	projectNameOrId: string,
): Promise<ProjectTeamInfo> {
	if (isUuid(projectNameOrId)) {
		const result = await graphQLService.rawRequest<ProjectByIdResponse>(
			PROJECT_BY_ID_QUERY,
			{ id: projectNameOrId },
		);
		if (!result.project) {
			throw new Error(`Project "${projectNameOrId}" not found`);
		}
		return {
			projectId: result.project.id,
			projectName: result.project.name,
			currentTeams: result.project.teams.nodes.map((t) => ({
				id: t.id,
				key: t.key,
				name: t.name,
			})),
		};
	}

	const result = await graphQLService.rawRequest<GetProjectResponse>(
		GET_PROJECT_QUERY,
		{ name: projectNameOrId },
	);
	const project = result.projects.nodes[0];
	if (!project) {
		throw new Error(`Project "${projectNameOrId}" not found`);
	}
	return {
		projectId: project.id,
		projectName: project.name,
		currentTeams: project.teams.nodes.map((t) => ({
			id: t.id,
			key: t.key,
			name: t.name,
		})),
	};
}

function formatTeamsOutput(
	projectUpdate: UpdateProjectResponse["projectUpdate"],
) {
	if (!projectUpdate.project) {
		throw new Error("Failed to update project");
	}
	const updatedProject = projectUpdate.project;
	return {
		id: updatedProject.id,
		name: updatedProject.name,
		teams: updatedProject.teams.nodes.map((t) => ({
			id: t.id,
			key: t.key,
			name: t.name,
		})),
	};
}

async function handleAddTeam(
	projectNameOrId: string,
	teamInput: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);

	const linearService = await createLinearService(rootOpts);
	const finalTeamId = await linearService.resolveTeamId(resolveTeam(teamInput));
	const { projectId, currentTeams } = await resolveProjectWithTeams(
		graphQLService,
		projectNameOrId,
	);
	const currentTeamIds = currentTeams.map((t) => t.id);

	if (currentTeamIds.includes(finalTeamId)) {
		outputSuccess({
			message: `Team "${teamInput}" is already associated with the project`,
			projectId,
		});
		return;
	}

	const updateResult = await graphQLService.rawRequest<UpdateProjectResponse>(
		UPDATE_PROJECT_MUTATION,
		{
			id: projectId,
			input: { teamIds: [...currentTeamIds, finalTeamId] },
		},
	);

	const projectUpdate = updateResult.projectUpdate;
	if (!projectUpdate.success) {
		throw new Error("Failed to update project");
	}
	outputSuccess(formatTeamsOutput(projectUpdate));
}

async function handleAddTeams(
	projectNameOrId: string,
	teamInputs: string[],
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);

	const resolvedTeamIds = await Promise.all(
		teamInputs.map((t: string) => linearService.resolveTeamId(resolveTeam(t))),
	);
	const { projectId, currentTeams } = await resolveProjectWithTeams(
		graphQLService,
		projectNameOrId,
	);
	const currentTeamIds = currentTeams.map((t) => t.id);

	const newTeamIds = resolvedTeamIds.filter(
		(id) => !currentTeamIds.includes(id),
	);
	const skippedInputs = teamInputs.filter((_, i) =>
		currentTeamIds.includes(resolvedTeamIds[i]),
	);

	if (newTeamIds.length === 0) {
		outputSuccess({
			message: "All teams are already associated with the project",
			projectId,
			skipped: skippedInputs,
		});
		return;
	}

	const mergedTeamIds = [...currentTeamIds, ...newTeamIds];
	const updateResult = await graphQLService.rawRequest<UpdateProjectResponse>(
		UPDATE_PROJECT_MUTATION,
		{
			id: projectId,
			input: { teamIds: mergedTeamIds },
		},
	);

	const projectUpdate = updateResult.projectUpdate;
	if (!projectUpdate.success) {
		throw new Error("Failed to update project");
	}

	const result = formatTeamsOutput(projectUpdate);
	outputSuccess({
		...result,
		added: newTeamIds.length,
		skipped: skippedInputs.length > 0 ? skippedInputs : undefined,
	});
}

async function handleRemoveTeam(
	projectNameOrId: string,
	teamInput: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);

	const finalTeamId = await linearService.resolveTeamId(resolveTeam(teamInput));
	const { projectId, projectName, currentTeams } =
		await resolveProjectWithTeams(graphQLService, projectNameOrId);
	const currentTeamIds = currentTeams.map((t) => t.id);

	if (!currentTeamIds.includes(finalTeamId)) {
		throw new Error(
			`Team "${teamInput}" is not associated with project "${projectName}"`,
		);
	}

	if (!options.force) {
		const issueCheck =
			await graphQLService.rawRequest<GetProjectTeamIssuesResponse>(
				GET_PROJECT_TEAM_ISSUES_QUERY,
				{
					projectId,
					teamId: finalTeamId,
				},
			);
		const issueNodes = issueCheck.project?.issues.nodes ?? [];

		if (issueNodes.length > 0) {
			const examples = issueNodes
				.slice(0, 5)
				.map((i) => `${i.identifier}: ${i.title}`)
				.join("\n  ");
			throw new Error(
				`Cannot remove team "${teamInput}" — it has ${issueNodes.length}${issueNodes.length >= 50 ? "+" : ""} issues in project "${projectName}". Reassign or remove those issues first.\n  ${examples}${issueNodes.length > 5 ? "\n  ..." : ""}\n\nUse --force to bypass this check.`,
			);
		}
	}

	const updatedTeamIds = currentTeamIds.filter((id) => id !== finalTeamId);
	const updateResult = await graphQLService.rawRequest<UpdateProjectResponse>(
		UPDATE_PROJECT_MUTATION,
		{
			id: projectId,
			input: { teamIds: updatedTeamIds },
		},
	);

	const projectUpdate = updateResult.projectUpdate;
	if (!projectUpdate.success) {
		throw new Error("Failed to update project");
	}
	outputSuccess({
		...formatTeamsOutput(projectUpdate),
		removed: teamInput,
	});
}

async function handleCreateProject(
	name: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);

	// Step 1: Check for duplicate projects (case-insensitive)
	const searchResult =
		await graphQLService.rawRequest<SearchProjectsByNameResponse>(
			SEARCH_PROJECTS_BY_NAME_QUERY,
			{ name },
		);
	const existing = searchResult.projects.nodes.filter(
		(p) => p.name.toLowerCase() === name.toLowerCase(),
	);

	if (existing.length > 0 && !options.force) {
		const match = existing[0];
		const teams = match.teams.nodes.map((t) => t.key).join(", ");
		throw new Error(
			`Project "${match.name}" already exists (state: ${match.state}, teams: ${teams}). ` +
				`Use --force to create anyway, or use the existing project.`,
		);
	}

	// Step 2: Resolve team IDs
	const service = await createLinearService(rootOpts);
	const teamKeys = options.team ? splitList(options.team) : [];
	const teamIds: string[] = [];
	for (const key of teamKeys) {
		teamIds.push(await service.resolveTeamId(resolveTeam(key)));
	}

	// Step 3: Create the project
	const input: Record<string, unknown> = {
		name,
		...(options.description ? { description: options.description } : {}),
		...(teamIds.length > 0 ? { teamIds } : {}),
	};

	const createResult = await graphQLService.rawRequest<CreateProjectResponse>(
		CREATE_PROJECT_MUTATION,
		{ input },
	);
	if (
		!createResult.projectCreate.success ||
		!createResult.projectCreate.project
	) {
		throw new Error("Failed to create project");
	}

	const project = createResult.projectCreate.project;

	// Step 4: Set content if provided (separate mutation — Linear API quirk)
	if (options.content) {
		await graphQLService.rawRequest(UPDATE_PROJECT_MUTATION, {
			id: project.id,
			input: { content: options.content },
		});
	}

	const teamList = project.teams.nodes.map((t) => t.key).join(", ");

	outputSuccess({
		id: project.id,
		name: project.name,
		state: project.state ?? "planned",
		teams: teamList,
		...(existing.length > 0
			? {
					_warnings: [
						`Created despite existing project "${existing[0].name}" (--force used)`,
					],
				}
			: {}),
	});
}

async function handleArchiveProject(
	projectNameOrId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const projectId = await linearService.resolveProjectId(projectNameOrId);
	const result = await graphQLService.rawRequest<ArchiveProjectResponse>(
		ARCHIVE_PROJECT_MUTATION,
		{ id: projectId },
	);
	const payload = result.projectArchive;
	if (!payload.success) {
		throw new Error(`Failed to archive project "${projectNameOrId}"`);
	}
	outputSuccess({
		success: true,
		archived: true,
		id: projectId,
		entity: payload.entity ?? undefined,
		lastSyncId: payload.lastSyncId,
	});
}

async function handleDeleteProject(
	projectNameOrId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const projectId = await linearService.resolveProjectId(projectNameOrId);
	const result = await graphQLService.rawRequest<DeleteProjectResponse>(
		DELETE_PROJECT_MUTATION,
		{ id: projectId },
	);
	const payload = result.projectDelete;
	if (!payload.success) {
		throw new Error(`Failed to delete project "${projectNameOrId}"`);
	}
	outputSuccess({
		success: true,
		deleted: true,
		id: projectId,
		entity: payload.entity ?? undefined,
		lastSyncId: payload.lastSyncId,
	});
}

export function setupProjectsCommands(program: Command): void {
	const projects = program
		.command("projects")
		.alias("project")
		.description("Project operations");
	projects.action(() => projects.help());

	projects
		.command("create <name>")
		.description("Create a project (checks for duplicates first)")
		.option("--team <teams>", "comma-separated team keys (e.g., FE,DEV)")
		.option(
			"-d, --description <text>",
			"short summary (max 255 chars, shown in lists)",
		)
		.option(
			"--content <markdown>",
			"full markdown body (shown in project panel)",
		)
		.option("--force", "create even if a project with the same name exists")
		.action(handleAsyncCommand(handleCreateProject));

	projects
		.command("archive <project>")
		.description("Archive a project (resolves names)")
		.action(handleAsyncCommand(handleArchiveProject));

	projects
		.command("delete <project>")
		.description("Delete (trash) a project (resolves names)")
		.action(handleAsyncCommand(handleDeleteProject));

	projects
		.command("list")
		.description("List projects")
		.option("-l, --limit <number>", "limit results", "100")
		.option(
			"--format <format>",
			"output format (json, summary, table, md, csv)",
			"json",
		)
		.option(
			"--fields <fields>",
			"columns for table/csv (comma-separated: name,state,progress,teams,lead,targetDate)",
		)
		.option(
			"--name <substring>",
			"filter by case-insensitive substring on project name",
		)
		.option(
			"--state <names>",
			"include only projects in these states (comma-separated: backlog, planned, started, paused, completed, canceled)",
		)
		.option(
			"--exclude-state <names>",
			"exclude projects in these states (comma-separated). Mutually exclusive with --state.",
		)
		.option(
			"--active",
			"shorthand for --exclude-state completed,canceled (mutually exclusive with --state / --exclude-state)",
		)
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const limit = Number.parseInt(options.limit, 10);
				const nameFilter = options.name as string | undefined;
				const stateFilter = resolveProjectStateFilter(options);
				const ttl = resolveCacheTTL({
					configTTL: loadConfig().cacheTTLSeconds,
					noCacheFlag: rootOpts.cache === false,
				});
				// Cache key includes filter inputs so different filter combinations
				// don't collide.
				const cacheKey =
					`projects-list-limit:${limit}` +
					`-name:${nameFilter ?? "_all"}` +
					`-states:${stateFilter.states?.join(",") ?? "_any"}` +
					`-excl:${stateFilter.excludeStates?.join(",") ?? "_none"}`;
				const result = await cached(cacheKey, ttl, async () => {
					const service = await createLinearService(rootOpts);
					return service.getProjects(limit, {
						nameFilter,
						states: stateFilter.states,
						excludeStates: stateFilter.excludeStates,
					});
				});
				const format = options.format as string;
				if (
					format === "table" ||
					format === "md" ||
					format === "markdown" ||
					format === "csv"
				) {
					const fieldList = options.fields
						? splitList(options.fields)
						: undefined;
					formatProjectsOutput(result, format, fieldList);
					if (format === "table") {
						logger.info(`\n${result.length} projects`);
					}
				} else {
					outputSuccess({ data: result, meta: { count: result.length } });
				}
			}),
		);

	projects
		.command("add-team <project> <team>")
		.description("Associate a project with an additional team (resolves names)")
		.action(handleAsyncCommand(handleAddTeam));

	projects
		.command("add-teams <project> <teams...>")
		.description(
			"Associate a project with multiple teams in one operation (resolves names)",
		)
		.action(handleAsyncCommand(handleAddTeams));

	projects
		.command("remove-team <project> <team>")
		.description("Remove a team from a project (checks for issues first)")
		.option("--force", "remove even if the team has issues in the project")
		.action(handleAsyncCommand(handleRemoveTeam));
}
