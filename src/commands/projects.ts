import type { Command, OptionValues } from "commander";
import { loadConfig } from "../config/config.js";
import { resolveTeam } from "../config/resolver.js";
import {
	CREATE_PROJECT_MUTATION,
	GET_PROJECT_QUERY,
	GET_PROJECT_TEAM_ISSUES_QUERY,
	PROJECT_BY_ID_QUERY,
	SEARCH_PROJECTS_BY_NAME_QUERY,
	UPDATE_PROJECT_MUTATION,
} from "../queries/projects.js";
import type { GraphQLResponseData, LinearProject } from "../types/linear.js";
import { cached, resolveCacheTTL } from "../utils/disk-cache.js";
import type { GraphQLService } from "../utils/graphql-service.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { logger } from "../utils/logger.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { isUuid } from "../utils/uuid.js";
import { splitList } from "../utils/validators.js";

function formatProjectsOutput(
	projects: LinearProject[],
	format: string,
	fieldNames?: string[],
): void {
	const fields = fieldNames ?? [
		"name",
		"state",
		"progress",
		"teams",
		"lead",
		"targetDate",
	];
	const rows = projects.map((p) => {
		const row: Record<string, string> = {};
		for (const f of fields) {
			switch (f) {
				case "name":
					row[f] = p.name;
					break;
				case "state":
					row[f] = p.state ?? "";
					break;
				case "progress":
					row[f] =
						p.progress !== undefined ? `${Math.round(p.progress * 100)}%` : "";
					break;
				case "teams":
					row[f] = p.teams?.map((t) => t.key).join(", ") ?? "";
					break;
				case "lead":
					row[f] = p.lead?.name ?? "";
					break;
				case "targetDate":
					row[f] = p.targetDate ?? "";
					break;
				case "id":
					row[f] = p.id;
					break;
				default:
					row[f] = String((p as unknown as Record<string, unknown>)[f] ?? "");
			}
		}
		return row;
	});

	if (format === "csv") {
		logger.info(fields.join(","));
		for (const row of rows) {
			logger.info(
				fields.map((f) => `"${(row[f] ?? "").replace(/"/g, '""')}"`).join(","),
			);
		}
		return;
	}

	// table and md formats
	const widths = fields.map((f) =>
		Math.max(f.length, ...rows.map((r) => (r[f] ?? "").length)),
	);

	const separator =
		format === "md"
			? `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`
			: widths.map((w) => "-".repeat(w + 2)).join("+");
	const header =
		format === "md"
			? `| ${fields.map((f, i) => f.padEnd(widths[i])).join(" | ")} |`
			: fields.map((f, i) => ` ${f.padEnd(widths[i])} `).join("|");

	logger.info(header);
	logger.info(separator);
	for (const row of rows) {
		const line =
			format === "md"
				? `| ${fields.map((f, i) => (row[f] ?? "").padEnd(widths[i])).join(" | ")} |`
				: fields
						.map((f, i) => ` ${(row[f] ?? "").padEnd(widths[i])} `)
						.join("|");
		logger.info(line);
	}
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
		const result = await graphQLService.rawRequest(PROJECT_BY_ID_QUERY, {
			id: projectNameOrId,
		});
		const project = result.project as GraphQLResponseData | undefined;
		if (!project) {
			throw new Error(`Project "${projectNameOrId}" not found`);
		}
		const teams = project.teams as GraphQLResponseData | undefined;
		return {
			projectId: project.id as string,
			projectName: project.name as string,
			currentTeams: ((teams?.nodes as GraphQLResponseData[]) || []).map(
				(t: GraphQLResponseData) => ({
					id: t.id as string,
					key: t.key as string,
					name: t.name as string,
				}),
			),
		};
	}

	const result = await graphQLService.rawRequest(GET_PROJECT_QUERY, {
		name: projectNameOrId,
	});
	const projectNodes = (result.projects as GraphQLResponseData)?.nodes as
		| GraphQLResponseData[]
		| undefined;
	if (!projectNodes?.length) {
		throw new Error(`Project "${projectNameOrId}" not found`);
	}
	const project = projectNodes[0];
	const teams = project.teams as GraphQLResponseData | undefined;
	return {
		projectId: project.id as string,
		projectName: project.name as string,
		currentTeams: ((teams?.nodes as GraphQLResponseData[]) || []).map(
			(t: GraphQLResponseData) => ({
				id: t.id as string,
				key: t.key as string,
				name: t.name as string,
			}),
		),
	};
}

function formatTeamsOutput(projectUpdate: GraphQLResponseData) {
	const updatedProject = projectUpdate.project as GraphQLResponseData;
	const updatedTeams = updatedProject.teams as GraphQLResponseData;
	return {
		id: updatedProject.id,
		name: updatedProject.name,
		teams: ((updatedTeams.nodes as GraphQLResponseData[]) || []).map(
			(t: GraphQLResponseData) => ({
				id: t.id,
				key: t.key,
				name: t.name,
			}),
		),
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

	const updateResult = await graphQLService.rawRequest(
		UPDATE_PROJECT_MUTATION,
		{
			id: projectId,
			input: { teamIds: [...currentTeamIds, finalTeamId] },
		},
	);

	const projectUpdate = updateResult.projectUpdate as GraphQLResponseData;
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
	const updateResult = await graphQLService.rawRequest(
		UPDATE_PROJECT_MUTATION,
		{
			id: projectId,
			input: { teamIds: mergedTeamIds },
		},
	);

	const projectUpdate = updateResult.projectUpdate as GraphQLResponseData;
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
		const issueCheck = await graphQLService.rawRequest(
			GET_PROJECT_TEAM_ISSUES_QUERY,
			{
				projectId,
				teamId: finalTeamId,
			},
		);
		const project = issueCheck.project as GraphQLResponseData;
		const issues = project.issues as GraphQLResponseData;
		const issueNodes = (issues.nodes as GraphQLResponseData[]) || [];

		if (issueNodes.length > 0) {
			const examples = issueNodes
				.slice(0, 5)
				.map((i: GraphQLResponseData) => `${i.identifier}: ${i.title}`)
				.join("\n  ");
			throw new Error(
				`Cannot remove team "${teamInput}" — it has ${issueNodes.length}${issueNodes.length >= 50 ? "+" : ""} issues in project "${projectName}". Reassign or remove those issues first.\n  ${examples}${issueNodes.length > 5 ? "\n  ..." : ""}\n\nUse --force to bypass this check.`,
			);
		}
	}

	const updatedTeamIds = currentTeamIds.filter((id) => id !== finalTeamId);
	const updateResult = await graphQLService.rawRequest(
		UPDATE_PROJECT_MUTATION,
		{
			id: projectId,
			input: { teamIds: updatedTeamIds },
		},
	);

	const projectUpdate = updateResult.projectUpdate as GraphQLResponseData;
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
	const searchResult = await graphQLService.rawRequest(
		SEARCH_PROJECTS_BY_NAME_QUERY,
		{ name },
	);
	const existing = (
		((searchResult.projects as GraphQLResponseData)
			?.nodes as GraphQLResponseData[]) ?? []
	).filter(
		(p: GraphQLResponseData) =>
			(p.name as string).toLowerCase() === name.toLowerCase(),
	);

	if (existing.length > 0 && !options.force) {
		const match = existing[0];
		const teams = (
			((match.teams as GraphQLResponseData)?.nodes as GraphQLResponseData[]) ??
			[]
		)
			.map((t: GraphQLResponseData) => t.key)
			.join(", ");
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

	const createResult = await graphQLService.rawRequest(
		CREATE_PROJECT_MUTATION,
		{ input },
	);
	const created = createResult.projectCreate as GraphQLResponseData;
	if (!created?.success) {
		throw new Error("Failed to create project");
	}

	const project = created.project as GraphQLResponseData;

	// Step 4: Set content if provided (separate mutation — Linear API quirk)
	if (options.content) {
		await graphQLService.rawRequest(UPDATE_PROJECT_MUTATION, {
			id: project.id,
			input: { content: options.content },
		});
	}

	const teamList = (
		((project.teams as GraphQLResponseData)?.nodes as GraphQLResponseData[]) ??
		[]
	)
		.map((t: GraphQLResponseData) => t.key)
		.join(", ");

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
		.command("list")
		.description("List projects")
		.option("-l, --limit <number>", "limit results", "100")
		.option("--format <format>", "output format (json, table, md, csv)", "json")
		.option(
			"--fields <fields>",
			"columns for table/csv (comma-separated: name,state,progress,teams,lead,targetDate)",
		)
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const limit = Number.parseInt(options.limit, 10);
				const ttl = resolveCacheTTL({
					configTTL: loadConfig().cacheTTLSeconds,
					noCacheFlag: rootOpts.cache === false,
				});
				const result = await cached(
					`projects-list-limit:${limit}`,
					ttl,
					async () => {
						const service = await createLinearService(rootOpts);
						return service.getProjects(limit);
					},
				);
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
