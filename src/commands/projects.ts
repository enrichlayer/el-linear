import type { Command, OptionValues } from "commander";
import { resolveTeam } from "../config/resolver.js";
import {
  GET_PROJECT_QUERY,
  GET_PROJECT_TEAM_ISSUES_QUERY,
  PROJECT_BY_ID_QUERY,
  UPDATE_PROJECT_MUTATION,
} from "../queries/projects.js";
import type { GraphQLResponseData } from "../types/linear.js";
import type { GraphQLService } from "../utils/graphql-service.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { isUuid } from "../utils/uuid.js";

interface ProjectTeamInfo {
  projectId: string;
  projectName: string;
  currentTeams: { id: string; key: string; name: string }[];
}

async function resolveTeamIdFromInput(
  linearService: ReturnType<typeof createLinearService>,
  teamInput: string,
): Promise<string> {
  const resolved = resolveTeam(teamInput);
  return linearService.resolveTeamId(resolved);
}

async function resolveProjectWithTeams(
  graphQLService: GraphQLService,
  projectNameOrId: string,
): Promise<ProjectTeamInfo> {
  if (isUuid(projectNameOrId)) {
    const result = await graphQLService.rawRequest(PROJECT_BY_ID_QUERY, { id: projectNameOrId });
    const project = result.project as GraphQLResponseData | undefined;
    if (!project) {
      throw new Error(`Project "${projectNameOrId}" not found`);
    }
    const teams = project.teams as GraphQLResponseData | undefined;
    return {
      projectId: project.id as string,
      projectName: project.name as string,
      currentTeams: ((teams?.nodes as GraphQLResponseData[]) || []).map((t: GraphQLResponseData) => ({
        id: t.id as string,
        key: t.key as string,
        name: t.name as string,
      })),
    };
  }

  const result = await graphQLService.rawRequest(GET_PROJECT_QUERY, { name: projectNameOrId });
  const projectNodes = (result.projects as GraphQLResponseData)?.nodes as GraphQLResponseData[] | undefined;
  if (!projectNodes?.length) {
    throw new Error(`Project "${projectNameOrId}" not found`);
  }
  const project = projectNodes[0];
  const teams = project.teams as GraphQLResponseData | undefined;
  return {
    projectId: project.id as string,
    projectName: project.name as string,
    currentTeams: ((teams?.nodes as GraphQLResponseData[]) || []).map((t: GraphQLResponseData) => ({
      id: t.id as string,
      key: t.key as string,
      name: t.name as string,
    })),
  };
}

function formatTeamsOutput(projectUpdate: GraphQLResponseData) {
  const updatedProject = projectUpdate.project as GraphQLResponseData;
  const updatedTeams = updatedProject.teams as GraphQLResponseData;
  return {
    id: updatedProject.id,
    name: updatedProject.name,
    teams: ((updatedTeams.nodes as GraphQLResponseData[]) || []).map(
      (t: GraphQLResponseData) => ({ id: t.id, key: t.key, name: t.name }),
    ),
  };
}

export function setupProjectsCommands(program: Command): void {
  const projects = program.command("projects").alias("project").description("Project operations");
  projects.action(() => projects.help());

  projects
    .command("list")
    .description("List projects")
    .option("-l, --limit <number>", "limit results", "100")
    .action(
      handleAsyncCommand(async (options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const service = createLinearService(rootOpts);
        const result = await service.getProjects(Number.parseInt(options.limit, 10));
        outputSuccess({ data: result, meta: { count: result.length } });
      }),
    );

  projects
    .command("add-team <project> <team>")
    .description("Associate a project with an additional team (resolves names)")
    .action(
      handleAsyncCommand(async (projectNameOrId: string, teamInput: string, _options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const graphQLService = createGraphQLService(rootOpts);

        const finalTeamId = await resolveTeamIdFromInput(createLinearService(rootOpts), teamInput);
        const { projectId, currentTeams } = await resolveProjectWithTeams(graphQLService, projectNameOrId);
        const currentTeamIds = currentTeams.map((t) => t.id);

        if (currentTeamIds.includes(finalTeamId)) {
          outputSuccess({ message: `Team "${teamInput}" is already associated with the project`, projectId });
          return;
        }

        const updateResult = await graphQLService.rawRequest(UPDATE_PROJECT_MUTATION, {
          id: projectId,
          input: { teamIds: [...currentTeamIds, finalTeamId] },
        });

        const projectUpdate = updateResult.projectUpdate as GraphQLResponseData;
        if (!projectUpdate.success) {
          throw new Error("Failed to update project");
        }
        outputSuccess(formatTeamsOutput(projectUpdate));
      }),
    );

  projects
    .command("add-teams <project> <teams...>")
    .description("Associate a project with multiple teams in one operation (resolves names)")
    .action(
      handleAsyncCommand(async (projectNameOrId: string, teamInputs: string[], _options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const graphQLService = createGraphQLService(rootOpts);

        const resolvedTeamIds = await Promise.all(
          teamInputs.map((t) => resolveTeamIdFromInput(createLinearService(rootOpts), t)),
        );
        const { projectId, currentTeams } = await resolveProjectWithTeams(graphQLService, projectNameOrId);
        const currentTeamIds = currentTeams.map((t) => t.id);

        const newTeamIds = resolvedTeamIds.filter((id) => !currentTeamIds.includes(id));
        const skippedInputs = teamInputs.filter(
          (_, i) => currentTeamIds.includes(resolvedTeamIds[i]),
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
        const updateResult = await graphQLService.rawRequest(UPDATE_PROJECT_MUTATION, {
          id: projectId,
          input: { teamIds: mergedTeamIds },
        });

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
      }),
    );

  projects
    .command("remove-team <project> <team>")
    .description("Remove a team from a project (checks for issues first)")
    .option("--force", "remove even if the team has issues in the project")
    .action(
      handleAsyncCommand(async (projectNameOrId: string, teamInput: string, options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const graphQLService = createGraphQLService(rootOpts);

        const finalTeamId = await resolveTeamIdFromInput(createLinearService(rootOpts), teamInput);
        const { projectId, projectName, currentTeams } = await resolveProjectWithTeams(graphQLService, projectNameOrId);
        const currentTeamIds = currentTeams.map((t) => t.id);

        if (!currentTeamIds.includes(finalTeamId)) {
          throw new Error(`Team "${teamInput}" is not associated with project "${projectName}"`);
        }

        if (!options.force) {
          const issueCheck = await graphQLService.rawRequest(GET_PROJECT_TEAM_ISSUES_QUERY, {
            projectId,
            teamId: finalTeamId,
          });
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
        const updateResult = await graphQLService.rawRequest(UPDATE_PROJECT_MUTATION, {
          id: projectId,
          input: { teamIds: updatedTeamIds },
        });

        const projectUpdate = updateResult.projectUpdate as GraphQLResponseData;
        if (!projectUpdate.success) {
          throw new Error("Failed to update project");
        }
        outputSuccess({
          ...formatTeamsOutput(projectUpdate),
          removed: teamInput,
        });
      }),
    );
}
