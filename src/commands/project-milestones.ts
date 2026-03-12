import type { Command, OptionValues } from "commander";
import {
  CREATE_PROJECT_MILESTONE_MUTATION,
  FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL,
  FIND_PROJECT_MILESTONE_BY_NAME_SCOPED,
  GET_PROJECT_MILESTONE_BY_ID_QUERY,
  LIST_PROJECT_MILESTONES_QUERY,
  UPDATE_PROJECT_MILESTONE_MUTATION,
} from "../queries/project-milestones.js";
import type { GraphQLResponseData } from "../types/linear.js";
import { multipleMatchesError, notFoundError } from "../utils/error-messages.js";
import { createGraphQLService, type GraphQLService } from "../utils/graphql-service.js";
import { createLinearService, type LinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { isUuid } from "../utils/uuid.js";
import { validateIsoDate } from "../utils/validators.js";

async function resolveMilestoneId(
  milestoneNameOrId: string,
  graphQLService: GraphQLService,
  linearService: LinearService,
  projectNameOrId?: string,
): Promise<string> {
  if (isUuid(milestoneNameOrId)) {
    return milestoneNameOrId;
  }
  let nodes: Record<string, unknown>[] = [];
  if (projectNameOrId) {
    const projectId = await linearService.resolveProjectId(projectNameOrId);
    const findRes = await graphQLService.rawRequest(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED, {
      name: milestoneNameOrId,
      projectId,
    });
    const projectData = findRes.project as GraphQLResponseData | undefined;
    const milestonesData = projectData?.projectMilestones as GraphQLResponseData | undefined;
    nodes = (milestonesData?.nodes as Record<string, unknown>[]) || [];
  }
  if (nodes.length === 0) {
    const globalRes = await graphQLService.rawRequest(FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL, {
      name: milestoneNameOrId,
    });
    const globalMilestones = globalRes.projectMilestones as GraphQLResponseData | undefined;
    nodes = (globalMilestones?.nodes as Record<string, unknown>[]) || [];
  }
  if (nodes.length === 0) {
    throw notFoundError("Milestone", milestoneNameOrId);
  }
  if (nodes.length > 1) {
    const matches = nodes.map(
      (m) => `"${m.name}" in project "${(m.project as Record<string, unknown> | undefined)?.name}"`,
    );
    throw multipleMatchesError(
      "milestone",
      milestoneNameOrId,
      matches,
      "specify --project or use the milestone ID",
    );
  }
  return nodes[0].id as string;
}

async function handleListMilestones(options: OptionValues, command: Command): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const projectId = await linearService.resolveProjectId(options.project);
  const result = await graphQLService.rawRequest(LIST_PROJECT_MILESTONES_QUERY, {
    projectId,
    first: Number.parseInt(options.limit || "50", 10),
  });
  const projectData = result.project as GraphQLResponseData | undefined;
  const milestonesData = projectData?.projectMilestones as GraphQLResponseData | undefined;
  const nodes = (milestonesData?.nodes as GraphQLResponseData[]) || [];
  outputSuccess({ data: nodes, meta: { count: nodes.length } });
}

async function handleReadMilestone(
  milestoneIdOrName: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const milestoneId = await resolveMilestoneId(
    milestoneIdOrName,
    graphQLService,
    linearService,
    options.project,
  );
  const result = await graphQLService.rawRequest(GET_PROJECT_MILESTONE_BY_ID_QUERY, {
    id: milestoneId,
    issuesFirst: Number.parseInt(options.issuesFirst || "50", 10),
  });
  outputSuccess(result.projectMilestone);
}

async function handleCreateMilestone(
  name: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const projectId = await linearService.resolveProjectId(options.project);
  if (options.targetDate) {
    validateIsoDate(options.targetDate);
  }
  const result = await graphQLService.rawRequest(CREATE_PROJECT_MILESTONE_MUTATION, {
    projectId,
    name,
    description: options.description,
    targetDate: options.targetDate,
  });
  const createData = result.projectMilestoneCreate as GraphQLResponseData | undefined;
  if (!createData?.success) {
    throw new Error("Failed to create project milestone");
  }
  outputSuccess(createData.projectMilestone);
}

async function handleUpdateMilestone(
  milestoneIdOrName: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
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
  const result = await graphQLService.rawRequest(UPDATE_PROJECT_MILESTONE_MUTATION, updateVars);
  const updateData = result.projectMilestoneUpdate as GraphQLResponseData | undefined;
  if (!updateData?.success) {
    throw new Error("Failed to update project milestone");
  }
  outputSuccess(updateData.projectMilestone);
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
    .option("--target-date <date>", "new target date in ISO format (YYYY-MM-DD)")
    .option("--sort-order <number>", "new sort order")
    .action(handleAsyncCommand(handleUpdateMilestone));
}
