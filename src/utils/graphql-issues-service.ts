import { resolveUserDisplayName } from "../config/resolver.js";
import { CREATE_LABEL_MUTATION } from "../queries/labels.js";
import {
  BATCH_RESOLVE_FOR_CREATE_QUERY,
  BATCH_RESOLVE_FOR_SEARCH_QUERY,
  BATCH_RESOLVE_FOR_UPDATE_QUERY,
  buildResolveLabelsByNameQuery,
  CREATE_ISSUE_MUTATION,
  FILTERED_SEARCH_ISSUES_QUERY,
  GET_ISSUE_BY_ID_QUERY,
  GET_ISSUE_BY_IDENTIFIER_QUERY,
  GET_ISSUE_TEAM_QUERY,
  GET_ISSUES_QUERY,
  SEARCH_ISSUES_QUERY,
  UPDATE_ISSUE_MUTATION,
} from "../queries/issues.js";
import type { GraphQLResponseData, LinearIssue } from "../types/linear.js";
import { toISOStringOrNow } from "./date-format.js";
import { extractEmbeds } from "./embed-parser.js";
import { notFoundError } from "./error-messages.js";
import type { GraphQLService } from "./graphql-service.js";
import { parseIssueIdentifier, tryParseIssueIdentifier } from "./identifier-parser.js";
import type { LinearService } from "./linear-service.js";
import { isUuid } from "./uuid.js";

const TEAM_KEY_REGEX = /^[A-Z0-9]+$/i;

function extractSummaryText(summary: GraphQLResponseData): string | undefined {
  if (summary.generationStatus !== "completed" || !summary.content) {
    return undefined;
  }
  const parts: string[] = [];
  const walk = (node: GraphQLResponseData) => {
    if (node.text) {
      parts.push(node.text as string);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content as GraphQLResponseData[]) {
        walk(child);
      }
    }
  };
  walk(summary.content as GraphQLResponseData);
  return parts.length > 0 ? parts.join("") : undefined;
}

export class GraphQLIssuesService {
  private readonly graphQLService: GraphQLService;
  private readonly linearService: LinearService;

  constructor(graphQLService: GraphQLService, linearService: LinearService) {
    this.graphQLService = graphQLService;
    this.linearService = linearService;
  }

  async getIssues(limit = 25): Promise<LinearIssue[]> {
    const result = await this.graphQLService.rawRequest(GET_ISSUES_QUERY, {
      first: limit,
      orderBy: "updatedAt",
    });
    const issues = result.issues as GraphQLResponseData | undefined;
    if (!issues?.nodes) {
      return [];
    }
    return (issues.nodes as GraphQLResponseData[]).map((issue: GraphQLResponseData) =>
      this.transformIssueData(issue),
    );
  }

  async getIssueById(issueId: string): Promise<LinearIssue> {
    let issueData: GraphQLResponseData;
    if (isUuid(issueId)) {
      const result = await this.graphQLService.rawRequest(GET_ISSUE_BY_ID_QUERY, { id: issueId });
      if (!result.issue) {
        throw notFoundError("Issue", issueId);
      }
      issueData = result.issue as GraphQLResponseData;
    } else {
      const { teamKey, issueNumber } = parseIssueIdentifier(issueId);
      const result = await this.graphQLService.rawRequest(GET_ISSUE_BY_IDENTIFIER_QUERY, {
        teamKey,
        number: issueNumber,
      });
      const issues = result.issues as GraphQLResponseData | undefined;
      const nodes = issues?.nodes as GraphQLResponseData[] | undefined;
      if (!nodes?.length) {
        throw notFoundError("Issue", issueId);
      }
      issueData = nodes[0];
    }
    return this.transformIssueData(issueData);
  }

  async updateIssue(
    args: Record<string, unknown>,
    labelMode = "overwriting",
  ): Promise<LinearIssue> {
    const { resolvedIssueId, issueTeamId, currentIssueLabels, resolveResult } =
      await this.resolveUpdateContext(args);

    let teamIdForLabels = issueTeamId;
    if (!teamIdForLabels && args.labelIds && resolvedIssueId) {
      teamIdForLabels = await this.fetchIssueTeamId(resolvedIssueId);
    }

    const finalLabelIds = await this.resolveLabelsWithMode(
      args.labelIds as string[] | undefined,
      resolveResult,
      labelMode,
      currentIssueLabels,
      teamIdForLabels,
      args.teamId as string | undefined,
    );

    const finalProjectId = args.projectId
      ? this.resolveProjectId(args.projectId as string, resolveResult)
      : args.projectId;

    const { projectMilestoneNodes, issueProjectMilestoneNodes } = this.extractMilestoneNodes(
      args,
      resolveResult,
    );

    const finalMilestoneId = this.resolveMilestoneId(
      args.milestoneId as string | undefined,
      resolveResult,
      projectMilestoneNodes,
      issueProjectMilestoneNodes,
    );

    const finalCycleId = await this.resolveCycleIdForUpdate(args, resolveResult, resolvedIssueId);
    const resolvedStatusId = await this.resolveStatusIdForUpdate(args, resolvedIssueId);

    if (args.assigneeId && !isUuid(args.assigneeId as string)) {
      args.assigneeId = await this.linearService.resolveUserId(args.assigneeId as string);
    }

    const updateInput = this.buildUpdateInput(args, {
      statusId: resolvedStatusId,
      projectId: finalProjectId,
      labelIds: finalLabelIds,
      milestoneId: finalMilestoneId,
      cycleId: finalCycleId,
    });

    return this.executeUpdateMutation(resolvedIssueId, args.id as string, updateInput);
  }

  private extractMilestoneNodes(
    args: Record<string, unknown>,
    resolveResult: GraphQLResponseData,
  ): {
    projectMilestoneNodes: GraphQLResponseData[] | undefined;
    issueProjectMilestoneNodes: GraphQLResponseData[] | undefined;
  } {
    const projectNodes = (resolveResult.projects as GraphQLResponseData | undefined)?.nodes as
      | GraphQLResponseData[]
      | undefined;
    const projectMilestoneNodes = args.projectId
      ? ((projectNodes?.[0]?.projectMilestones as GraphQLResponseData | undefined)?.nodes as
          | GraphQLResponseData[]
          | undefined)
      : undefined;

    const issueNodes = (resolveResult.issues as GraphQLResponseData | undefined)?.nodes as
      | GraphQLResponseData[]
      | undefined;
    const issueProjectMilestoneNodes = (
      (issueNodes?.[0]?.project as GraphQLResponseData | undefined)?.projectMilestones as
        | GraphQLResponseData
        | undefined
    )?.nodes as GraphQLResponseData[] | undefined;

    return { projectMilestoneNodes, issueProjectMilestoneNodes };
  }

  private async executeUpdateMutation(
    resolvedIssueId: string,
    originalId: string,
    updateInput: Record<string, unknown>,
  ): Promise<LinearIssue> {
    let updateResult: GraphQLResponseData;
    try {
      updateResult = await this.graphQLService.rawRequest(UPDATE_ISSUE_MUTATION, {
        id: resolvedIssueId,
        input: updateInput,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("Discrepancy between issue team")) {
        const hint = updateInput.projectId
          ? `The project may not be associated with this issue's team. Fix with: linctl projects add-team "<project>" <team>`
          : "The issue's team doesn't match the assigned project, cycle, or status.";
        throw new Error(`Failed to update issue ${originalId}: ${hint}`);
      }
      throw new Error(`Failed to update issue ${originalId}: ${msg}`);
    }
    const issueUpdate = updateResult.issueUpdate as GraphQLResponseData;
    if (!issueUpdate.success) {
      throw new Error(`Failed to update issue ${originalId}`);
    }
    if (!issueUpdate.issue) {
      throw new Error("Failed to retrieve updated issue");
    }
    return this.transformIssueData(issueUpdate.issue as GraphQLResponseData);
  }

  async createIssue(args: Record<string, unknown>): Promise<LinearIssue> {
    const resolveVariables = this.buildCreateResolveVariables(args);

    let resolveResult: GraphQLResponseData = {};
    if (Object.keys(resolveVariables).length > 0) {
      const { __labelNames, ...queryVars } = resolveVariables;
      const requests: Promise<GraphQLResponseData>[] = [
        this.graphQLService.rawRequest(BATCH_RESOLVE_FOR_CREATE_QUERY, queryVars),
      ];
      if (__labelNames) {
        const labelQuery = buildResolveLabelsByNameQuery(__labelNames as string[]);
        requests.push(this.graphQLService.rawRequest(labelQuery.query, labelQuery.variables));
      }
      const results = await Promise.all(requests);
      resolveResult = results[0];
      if (results[1]) {
        resolveResult.labels = results[1].labels;
      }
    }

    const resolved = await this.resolveCreateFields(args, resolveResult);

    if (args.assigneeId && !isUuid(args.assigneeId as string)) {
      args.assigneeId = await this.linearService.resolveUserId(args.assigneeId as string);
    }

    const createInput = this.buildCreateInput(args, resolved);
    return this.executeCreateMutation(createInput);
  }

  private async resolveCreateFields(
    args: Record<string, unknown>,
    resolveResult: GraphQLResponseData,
  ): Promise<{
    teamId: unknown;
    projectId: unknown;
    statusId: unknown;
    labelIds: string[] | undefined;
    parentId: string | undefined;
    milestoneId: string | undefined;
    cycleId: unknown;
  }> {
    let teamId = args.teamId
      ? await this.resolveTeamId(args.teamId as string, resolveResult)
      : args.teamId;

    const projectId = args.projectId
      ? this.resolveProjectId(args.projectId as string, resolveResult)
      : args.projectId;

    // Validate team-project compatibility and auto-correct when possible
    if (projectId && teamId) {
      teamId = this.validateProjectTeam(teamId as string, args.projectId as string, resolveResult);
    }

    const labelIds = await this.resolveLabels(
      args.labelIds as string[] | undefined,
      resolveResult,
      teamId as string | undefined,
      args.teamInput as string | undefined,
    );
    const parentId = this.resolveParentId(args.parentId as string | undefined, resolveResult);
    const milestoneId = this.resolveMilestoneIdForCreate(
      args.milestoneId as string | undefined,
      resolveResult,
      projectId as string | undefined,
    );

    let cycleId = args.cycleId;
    if (args.cycleId && typeof args.cycleId === "string" && !isUuid(args.cycleId)) {
      cycleId = await this.linearService.resolveCycleId(args.cycleId, teamId as string | undefined);
    }

    let statusId = args.statusId;
    if (args.statusId && !isUuid(args.statusId as string)) {
      statusId = await this.linearService.resolveStatusId(
        args.statusId as string,
        teamId as string | undefined,
      );
    }

    return { teamId, projectId, statusId, labelIds, parentId, milestoneId, cycleId };
  }

  private async executeCreateMutation(createInput: Record<string, unknown>): Promise<LinearIssue> {
    let createResult: GraphQLResponseData;
    try {
      createResult = await this.graphQLService.rawRequest(CREATE_ISSUE_MUTATION, {
        input: createInput,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create issue: ${msg}`);
    }
    const issueCreate = createResult.issueCreate as GraphQLResponseData;
    if (!issueCreate.success) {
      throw new Error("Failed to create issue: the API reported failure.");
    }
    if (!issueCreate.issue) {
      throw new Error("Failed to retrieve created issue");
    }
    return this.transformIssueData(issueCreate.issue as GraphQLResponseData);
  }

  async searchIssues(args: Record<string, unknown>): Promise<LinearIssue[]> {
    const resolveVariables: Record<string, unknown> = {};

    if (args.teamId && !isUuid(args.teamId as string)) {
      Object.assign(resolveVariables, this.buildResolveVariablesForTeam(args.teamId as string));
    }
    if (args.projectId && !isUuid(args.projectId as string)) {
      resolveVariables.projectName = args.projectId;
    }
    if (
      args.assigneeId &&
      !isUuid(args.assigneeId as string) &&
      (args.assigneeId as string).includes("@")
    ) {
      resolveVariables.assigneeEmail = args.assigneeId;
    }

    let resolveResult: GraphQLResponseData = {};
    if (Object.keys(resolveVariables).length > 0) {
      resolveResult = await this.graphQLService.rawRequest(
        BATCH_RESOLVE_FOR_SEARCH_QUERY,
        resolveVariables,
      );
    }

    const finalTeamId = args.teamId
      ? await this.resolveTeamId(args.teamId as string, resolveResult)
      : args.teamId;

    const finalProjectId = args.projectId
      ? this.resolveProjectId(args.projectId as string, resolveResult)
      : args.projectId;

    const finalAssigneeId = this.resolveAssigneeId(
      args.assigneeId as string | undefined,
      resolveResult,
    );

    if (args.query) {
      const searchResult = await this.graphQLService.rawRequest(SEARCH_ISSUES_QUERY, {
        term: args.query,
        first: (args.limit as number) || 10,
      });
      const searchIssues = searchResult.searchIssues as GraphQLResponseData | undefined;
      if (!searchIssues?.nodes) {
        return [];
      }
      const results = (searchIssues.nodes as GraphQLResponseData[]).map(
        (issue: GraphQLResponseData) => this.transformIssueData(issue),
      );
      return this.applySearchFilters(results, {
        teamId: finalTeamId as string | undefined,
        assigneeId: finalAssigneeId as string | undefined,
        projectId: finalProjectId as string | undefined,
        status: args.status as string[] | undefined,
        labelNames: args.labelNames as string[] | undefined,
        priority: args.priority as number[] | undefined,
      });
    }
    const filter = this.buildSearchFilter({
      teamId: finalTeamId as string | undefined,
      assigneeId: finalAssigneeId as string | undefined,
      projectId: finalProjectId as string | undefined,
      noProject: args.noProject as boolean | undefined,
      status: args.status as string[] | undefined,
      labelNames: args.labelNames as string[] | undefined,
      priority: args.priority as number[] | undefined,
    });
    const searchResult = await this.graphQLService.rawRequest(FILTERED_SEARCH_ISSUES_QUERY, {
      first: (args.limit as number) || 10,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      orderBy: (args.orderBy as string) || "updatedAt",
    });
    const filteredIssues = searchResult.issues as GraphQLResponseData | undefined;
    if (!filteredIssues?.nodes) {
      return [];
    }
    return (filteredIssues.nodes as GraphQLResponseData[]).map((issue: GraphQLResponseData) =>
      this.transformIssueData(issue),
    );
  }

  // --- Private helper methods for field resolution ---

  private async resolveTeamId(
    teamId: string,
    resolveResult: GraphQLResponseData,
  ): Promise<string> {
    if (isUuid(teamId)) {
      return teamId;
    }
    const teams = resolveResult.teams as GraphQLResponseData | undefined;
    const teamNodes = teams?.nodes as GraphQLResponseData[] | undefined;
    const resolvedTeam = teamNodes?.[0];
    if (
      resolvedTeam &&
      ((resolvedTeam.key as string).toUpperCase() === teamId.toUpperCase() ||
        (resolvedTeam.name as string).toLowerCase() === teamId.toLowerCase())
    ) {
      return resolvedTeam.id as string;
    }
    // Exact GraphQL match failed — fall back to prefix matching via LinearService
    return this.linearService.resolveTeamId(teamId);
  }

  private resolveProjectId(projectId: string, resolveResult: GraphQLResponseData): string {
    if (isUuid(projectId)) {
      return projectId;
    }
    const projects = resolveResult.projects as GraphQLResponseData | undefined;
    const projectNodes = projects?.nodes as GraphQLResponseData[] | undefined;
    if (!projectNodes?.length) {
      throw notFoundError("Project", projectId);
    }
    return projectNodes[0].id as string;
  }

  /**
   * Check that the resolved team is associated with the project.
   * If not, auto-switch when the project belongs to exactly one team.
   */
  private validateProjectTeam(
    teamId: string,
    projectInput: string,
    resolveResult: GraphQLResponseData,
  ): string {
    const projects = resolveResult.projects as GraphQLResponseData | undefined;
    const projectNode = (projects?.nodes as GraphQLResponseData[] | undefined)?.[0];
    if (!projectNode) {
      return teamId;
    }

    const teamsConn = projectNode.teams as GraphQLResponseData | undefined;
    const teamNodes = teamsConn?.nodes as GraphQLResponseData[] | undefined;
    if (!teamNodes?.length) {
      return teamId;
    }

    const isAssociated = teamNodes.some((t) => (t.id as string) === teamId);
    if (isAssociated) {
      return teamId;
    }

    const projectName = (projectNode.name as string) || projectInput;
    const teamKeys = teamNodes.map((t) => t.key as string);

    if (teamNodes.length === 1) {
      const correctTeamId = teamNodes[0].id as string;
      const correctKey = teamKeys[0];
      process.stderr.write(
        `Auto-switched team to ${correctKey} (the only team associated with project "${projectName}").\n`,
      );
      return correctTeamId;
    }

    throw new Error(
      `Project "${projectName}" is not associated with the specified team.\n` +
        `Associated teams: ${teamKeys.join(", ")}\n` +
        `Hint: Use --team ${teamKeys[0]} or run \`linctl projects add-team "${projectName}" TEAM\` to add your team.`,
    );
  }

  private async resolveLabels(
    labelIds: string[] | undefined,
    resolveResult: GraphQLResponseData,
    teamId?: string,
    teamInput?: string,
  ): Promise<string[] | undefined> {
    return this.resolveLabelsWithMode(labelIds, resolveResult, "overwriting", [], teamId, teamInput);
  }

  private async resolveLabelsWithMode(
    labelIds: string[] | undefined,
    resolveResult: GraphQLResponseData,
    labelMode: string,
    currentIssueLabels: string[],
    teamId?: string,
    teamInput?: string,
  ): Promise<string[] | undefined> {
    if (!(labelIds && Array.isArray(labelIds))) {
      return labelIds;
    }
    const resolvedLabels: string[] = [];
    const labels = resolveResult.labels as GraphQLResponseData | undefined;
    const labelNodes = labels?.nodes as GraphQLResponseData[] | undefined;
    for (const labelIdOrName of labelIds) {
      if (isUuid(labelIdOrName)) {
        resolvedLabels.push(labelIdOrName);
      } else {
        const lowerName = labelIdOrName.toLowerCase();
        const candidates = labelNodes?.filter(
          (l: GraphQLResponseData) => (l.name as string).toLowerCase() === lowerName,
        );
        let label: GraphQLResponseData | undefined;
        if (candidates && candidates.length > 1 && teamId) {
          label = candidates.find((l: GraphQLResponseData) => {
            const team = l.team as GraphQLResponseData | undefined;
            return team?.id === teamId;
          });
        }
        if (!label) {
          label = candidates?.[0];
        }
        if (!label) {
          // Auto-create the missing label on the team
          const created = await this.autoCreateLabel(labelIdOrName, teamId);
          if (created) {
            resolvedLabels.push(created);
            continue;
          }
          const teamKey = this.resolveTeamKeyFromResult(resolveResult, teamId, teamInput);
          const hint = teamKey
            ? `— check available labels with: linctl labels list --team ${teamKey}`
            : undefined;
          throw notFoundError("Label", labelIdOrName, undefined, hint);
        }
        if (label.isGroup) {
          const teamKey = this.resolveTeamKeyFromResult(resolveResult, teamId, teamInput);
          const hint = teamKey ? ` Run: linctl labels list --team ${teamKey}` : "";
          throw new Error(
            `Label "${labelIdOrName}" is a group label. Use a specific child label instead.${hint}`,
          );
        }
        resolvedLabels.push(label.id as string);
      }
    }
    if (labelMode === "adding") {
      return [...new Set([...currentIssueLabels, ...resolvedLabels])];
    }
    return resolvedLabels;
  }

  /** Auto-create a missing label on the team. Returns the new label ID or null on failure. */
  private async autoCreateLabel(name: string, teamId?: string): Promise<string | null> {
    try {
      const input: Record<string, string> = { name };
      if (teamId) {
        input.teamId = teamId;
      }
      const result = await this.graphQLService.rawRequest(CREATE_LABEL_MUTATION, { input });
      const created = (result as GraphQLResponseData).issueLabelCreate as GraphQLResponseData | undefined;
      if (created?.success && created.issueLabel) {
        const labelData = created.issueLabel as GraphQLResponseData;
        const teamInfo = labelData.team as GraphQLResponseData | undefined;
        const teamKey = teamInfo?.key ?? "";
        process.stderr.write(`Auto-created label "${name}" on team ${teamKey}\n`);
        return labelData.id as string;
      }
      return null;
    } catch {
      return null;
    }
  }

  private resolveTeamKeyFromResult(
    resolveResult: GraphQLResponseData,
    teamId?: string,
    teamInput?: string,
  ): string | undefined {
    // Collect team nodes from both the top-level teams query and the project's teams.
    // When the team was pre-resolved to a UUID by config, the top-level teams query
    // runs with null filters and may return an unrelated team. The project's teams
    // always include the correct team when a project is specified.
    const allTeamNodes = this.collectTeamNodes(resolveResult);

    if (teamId) {
      const match = allTeamNodes.find((t: GraphQLResponseData) => t.id === teamId);
      if (match) {
        return match.key as string;
      }
    }

    // If the team was pre-resolved to UUID by config and not found in the result,
    // use the original input (e.g., "DEV") as the hint.
    if (teamInput && !isUuid(teamInput)) {
      return teamInput.toUpperCase();
    }

    // Only fall back to first team if there's exactly one (unambiguous).
    // With multiple teams, returning an arbitrary one produces misleading error hints.
    const topLevelNodes = (resolveResult.teams as GraphQLResponseData | undefined)?.nodes as
      | GraphQLResponseData[]
      | undefined;
    return topLevelNodes?.length === 1 ? (topLevelNodes[0].key as string) : undefined;
  }

  private collectTeamNodes(resolveResult: GraphQLResponseData): GraphQLResponseData[] {
    const nodes: GraphQLResponseData[] = [];
    const seen = new Set<string>();

    const topTeams = resolveResult.teams as GraphQLResponseData | undefined;
    const topNodes = topTeams?.nodes as GraphQLResponseData[] | undefined;
    if (topNodes) {
      for (const t of topNodes) {
        const id = t.id as string;
        if (!seen.has(id)) {
          seen.add(id);
          nodes.push(t);
        }
      }
    }

    // Also check project teams (which are always fetched when --project is used)
    const projects = resolveResult.projects as GraphQLResponseData | undefined;
    const projectNode = (projects?.nodes as GraphQLResponseData[] | undefined)?.[0];
    if (projectNode) {
      const projectTeams = projectNode.teams as GraphQLResponseData | undefined;
      const projectTeamNodes = projectTeams?.nodes as GraphQLResponseData[] | undefined;
      if (projectTeamNodes) {
        for (const t of projectTeamNodes) {
          const id = t.id as string;
          if (!seen.has(id)) {
            seen.add(id);
            nodes.push(t);
          }
        }
      }
    }

    return nodes;
  }

  private resolveMilestoneId(
    milestoneId: string | undefined,
    resolveResult: GraphQLResponseData,
    projectMilestoneNodes?: GraphQLResponseData[],
    issueProjectMilestoneNodes?: GraphQLResponseData[],
  ): string | undefined {
    if (!milestoneId || isUuid(milestoneId)) {
      return milestoneId;
    }
    let resolved = milestoneId;
    if (projectMilestoneNodes) {
      const projectMilestone = projectMilestoneNodes.find(
        (m: GraphQLResponseData) => m.name === milestoneId,
      );
      if (projectMilestone) {
        resolved = projectMilestone.id as string;
      }
    }
    if (!isUuid(resolved) && issueProjectMilestoneNodes) {
      const issueMilestone = issueProjectMilestoneNodes.find(
        (m: GraphQLResponseData) => m.name === milestoneId,
      );
      if (issueMilestone) {
        resolved = issueMilestone.id as string;
      }
    }
    const milestones = resolveResult.milestones as GraphQLResponseData | undefined;
    const milestoneNodes = milestones?.nodes as GraphQLResponseData[] | undefined;
    if (!isUuid(resolved) && milestoneNodes?.length) {
      resolved = milestoneNodes[0].id as string;
    }
    if (!isUuid(resolved)) {
      throw notFoundError("Milestone", milestoneId);
    }
    return resolved;
  }

  private resolveMilestoneIdForCreate(
    milestoneId: string | undefined,
    resolveResult: GraphQLResponseData,
    finalProjectId: string | undefined,
  ): string | undefined {
    if (!milestoneId || isUuid(milestoneId)) {
      return milestoneId;
    }
    let resolved: string | undefined;
    const createProjects = resolveResult.projects as GraphQLResponseData | undefined;
    const createProjectNodes = createProjects?.nodes as GraphQLResponseData[] | undefined;
    const createProjectMilestones = createProjectNodes?.[0]?.projectMilestones as
      | GraphQLResponseData
      | undefined;
    const createProjectMilestoneNodes = createProjectMilestones?.nodes as
      | GraphQLResponseData[]
      | undefined;
    if (createProjectMilestoneNodes) {
      const projectMilestone = createProjectMilestoneNodes.find(
        (m: GraphQLResponseData) => m.name === milestoneId,
      );
      if (projectMilestone) {
        resolved = projectMilestone.id as string;
      }
    }
    const createMilestones = resolveResult.milestones as GraphQLResponseData | undefined;
    const createMilestoneNodes = createMilestones?.nodes as GraphQLResponseData[] | undefined;
    if (!resolved && createMilestoneNodes?.length) {
      resolved = createMilestoneNodes[0].id as string;
    }
    if (!resolved) {
      if (finalProjectId) {
        throw notFoundError("Milestone", milestoneId, "in project");
      }
      throw notFoundError("Milestone", milestoneId, undefined, "Consider specifying --project.");
    }
    return resolved;
  }

  private async fetchIssueTeamId(issueId: string): Promise<string | undefined> {
    const result = await this.graphQLService.rawRequest(GET_ISSUE_TEAM_QUERY, { issueId });
    const fetchedIssue = result.issue as GraphQLResponseData | undefined;
    const fetchedTeam = fetchedIssue?.team as GraphQLResponseData | undefined;
    return fetchedTeam?.id as string | undefined;
  }

  private buildCreateInput(
    args: Record<string, unknown>,
    resolved: {
      teamId?: unknown;
      projectId?: unknown;
      statusId?: unknown;
      labelIds?: unknown;
      parentId?: unknown;
      milestoneId?: unknown;
      cycleId?: unknown;
    },
  ): Record<string, unknown> {
    const input: Record<string, unknown> = { title: args.title };
    if (resolved.teamId) {
      input.teamId = resolved.teamId;
    }
    if (args.description) {
      input.description = args.description;
    }
    if (args.assigneeId) {
      input.assigneeId = args.assigneeId;
    }
    if (args.priority !== undefined) {
      input.priority = args.priority;
    }
    if (resolved.projectId) {
      input.projectId = resolved.projectId;
    }
    if (resolved.statusId) {
      input.stateId = resolved.statusId;
    }
    if (resolved.labelIds && Array.isArray(resolved.labelIds) && resolved.labelIds.length > 0) {
      input.labelIds = resolved.labelIds;
    }
    if (args.estimate !== undefined) {
      input.estimate = args.estimate;
    }
    if (resolved.parentId) {
      input.parentId = resolved.parentId;
    }
    if (resolved.milestoneId) {
      input.projectMilestoneId = resolved.milestoneId;
    }
    if (resolved.cycleId) {
      input.cycleId = resolved.cycleId;
    }
    if (args.subscriberIds && Array.isArray(args.subscriberIds) && args.subscriberIds.length > 0) {
      input.subscriberIds = args.subscriberIds;
    }
    if (args.dueDate !== undefined) {
      input.dueDate = args.dueDate;
    }
    return input;
  }

  private buildUpdateInput(
    args: Record<string, unknown>,
    resolved: {
      statusId?: unknown;
      projectId?: unknown;
      labelIds?: unknown;
      milestoneId?: unknown;
      cycleId?: unknown;
    },
  ): Record<string, unknown> {
    const input: Record<string, unknown> = {};
    if (args.title !== undefined) {
      input.title = args.title;
    }
    if (args.description !== undefined) {
      input.description = args.description;
    }
    if (resolved.statusId !== undefined) {
      input.stateId = resolved.statusId;
    }
    if (args.priority !== undefined) {
      input.priority = args.priority;
    }
    if (args.assigneeId !== undefined) {
      input.assigneeId = args.assigneeId;
    }
    if (resolved.projectId !== undefined) {
      input.projectId = resolved.projectId;
    }
    if (resolved.cycleId !== undefined) {
      input.cycleId = resolved.cycleId;
    }
    if (args.estimate !== undefined) {
      input.estimate = args.estimate;
    }
    if (args.parentId !== undefined) {
      input.parentId = args.parentId;
    }
    if (resolved.milestoneId !== undefined) {
      input.projectMilestoneId = resolved.milestoneId;
    }
    if (resolved.labelIds !== undefined) {
      input.labelIds = resolved.labelIds;
    }
    if (args.dueDate !== undefined) {
      input.dueDate = args.dueDate;
    }
    return input;
  }

  private buildResolveVariablesForTeam(teamId: string): Record<string, unknown> {
    const isTeamKey = teamId.length <= 5 && TEAM_KEY_REGEX.test(teamId);
    if (isTeamKey) {
      return { teamKey: teamId, teamName: null };
    }
    return { teamKey: null, teamName: teamId };
  }

  private applySearchFilters(
    results: LinearIssue[],
    filters: {
      teamId?: string;
      assigneeId?: string;
      projectId?: string;
      status?: string[];
      labelNames?: string[];
      priority?: number[];
    },
  ): LinearIssue[] {
    let filtered = results;
    if (filters.teamId) {
      filtered = filtered.filter((issue: LinearIssue) => issue.team?.id === filters.teamId);
    }
    if (filters.assigneeId) {
      filtered = filtered.filter((issue: LinearIssue) => issue.assignee?.id === filters.assigneeId);
    }
    if (filters.projectId) {
      filtered = filtered.filter((issue: LinearIssue) => issue.project?.id === filters.projectId);
    }
    if (filters.status && filters.status.length > 0) {
      filtered = filtered.filter((issue: LinearIssue) =>
        (filters.status as string[]).includes(issue.state?.name ?? ""),
      );
    }
    if (filters.labelNames && filters.labelNames.length > 0) {
      const lowerNames = (filters.labelNames as string[]).map((n) => n.toLowerCase());
      filtered = filtered.filter((issue: LinearIssue) => {
        const issueLabels = issue.labels.map((l) => l.name.toLowerCase());
        return lowerNames.every((name) => issueLabels.includes(name));
      });
    }
    if (filters.priority && filters.priority.length > 0) {
      filtered = filtered.filter((issue: LinearIssue) =>
        (filters.priority as number[]).includes(issue.priority),
      );
    }
    return filtered;
  }

  private buildSearchFilter(filters: {
    teamId?: string;
    assigneeId?: string;
    projectId?: string;
    noProject?: boolean;
    status?: string[];
    labelNames?: string[];
    priority?: number[];
  }): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (filters.teamId) {
      filter.team = { id: { eq: filters.teamId } };
    }
    if (filters.assigneeId) {
      filter.assignee = { id: { eq: filters.assigneeId } };
    }
    if (filters.noProject) {
      filter.project = { null: true };
    } else if (filters.projectId) {
      filter.project = { id: { eq: filters.projectId } };
    }
    if (filters.status && filters.status.length > 0) {
      filter.state = { name: { in: filters.status } };
    }
    if (filters.labelNames && filters.labelNames.length > 0) {
      if (filters.labelNames.length === 1) {
        filter.labels = { some: { name: { eqIgnoreCase: filters.labelNames[0] } } };
      } else {
        filter.labels = {
          and: filters.labelNames.map((name) => ({
            some: { name: { eqIgnoreCase: name } },
          })),
        };
      }
    }
    if (filters.priority && filters.priority.length > 0) {
      filter.priority = { in: filters.priority };
    }
    return filter;
  }

  private resolveAssigneeId(
    assigneeId: string | undefined,
    resolveResult: GraphQLResponseData,
  ): string | undefined {
    if (!assigneeId || isUuid(assigneeId) || !assigneeId.includes("@")) {
      return assigneeId;
    }
    const users = resolveResult.users as GraphQLResponseData | undefined;
    const userNodes = users?.nodes as GraphQLResponseData[] | undefined;
    if (!userNodes?.length) {
      throw notFoundError("User", assigneeId);
    }
    return userNodes[0].id as string;
  }

  private async resolveUpdateContext(args: Record<string, unknown>): Promise<{
    resolvedIssueId: string;
    issueTeamId: string | undefined;
    currentIssueLabels: string[];
    resolveResult: GraphQLResponseData;
  }> {
    let resolvedIssueId = args.id as string;
    let issueTeamId: string | undefined;
    let currentIssueLabels: string[] = [];
    const resolveVariables: Record<string, unknown> = {};

    if (!isUuid(args.id as string)) {
      const { teamKey, issueNumber } = parseIssueIdentifier(args.id as string);
      resolveVariables.teamKey = teamKey;
      resolveVariables.issueNumber = issueNumber;
    }

    if (args.labelIds && Array.isArray(args.labelIds)) {
      const nonUuidLabels = (args.labelIds as string[]).filter((id: string) => !isUuid(id));
      if (nonUuidLabels.length > 0) {
        resolveVariables.__labelNames = nonUuidLabels;
      }
    }

    if (args.projectId && !isUuid(args.projectId as string)) {
      resolveVariables.projectName = args.projectId;
    }

    if (args.milestoneId && typeof args.milestoneId === "string" && !isUuid(args.milestoneId)) {
      resolveVariables.milestoneName = args.milestoneId;
    }

    const { __labelNames, ...updateQueryVars } = resolveVariables;
    const requests: Promise<GraphQLResponseData>[] = [
      this.graphQLService.rawRequest(BATCH_RESOLVE_FOR_UPDATE_QUERY, updateQueryVars),
    ];
    if (__labelNames) {
      const labelQuery = buildResolveLabelsByNameQuery(__labelNames as string[]);
      requests.push(this.graphQLService.rawRequest(labelQuery.query, labelQuery.variables));
    }
    const results = await Promise.all(requests);
    const resolveResult = results[0];
    if (results[1]) {
      resolveResult.labels = results[1].labels;
    }

    if (!isUuid(args.id as string)) {
      const resolvedIssues = resolveResult.issues as GraphQLResponseData;
      const resolvedIssueNodes = resolvedIssues.nodes as GraphQLResponseData[];
      if (!resolvedIssueNodes.length) {
        throw notFoundError("Issue", args.id as string);
      }
      resolvedIssueId = resolvedIssueNodes[0].id as string;
      const team = resolvedIssueNodes[0].team as GraphQLResponseData | undefined;
      issueTeamId = team?.id as string | undefined;
      const issueLabels = resolvedIssueNodes[0].labels as GraphQLResponseData;
      currentIssueLabels = (issueLabels.nodes as GraphQLResponseData[]).map(
        (l: GraphQLResponseData) => l.id as string,
      );
    }

    return { resolvedIssueId, issueTeamId, currentIssueLabels, resolveResult };
  }

  private async resolveCycleIdForUpdate(
    args: Record<string, unknown>,
    resolveResult: GraphQLResponseData,
    resolvedIssueId: string,
  ): Promise<string | null | undefined> {
    if (args.cycleId === undefined || args.cycleId === null) {
      return args.cycleId as string | null | undefined;
    }
    if (typeof args.cycleId !== "string" || isUuid(args.cycleId)) {
      return args.cycleId as string;
    }
    let teamIdForCycle = (
      (
        (resolveResult.issues as GraphQLResponseData | undefined)?.nodes as
          | GraphQLResponseData[]
          | undefined
      )?.[0]?.team as GraphQLResponseData | undefined
    )?.id as string | undefined;
    if (!teamIdForCycle && resolvedIssueId && isUuid(resolvedIssueId)) {
      teamIdForCycle = await this.fetchIssueTeamId(resolvedIssueId);
    }
    return this.linearService.resolveCycleId(args.cycleId, teamIdForCycle);
  }

  private async resolveStatusIdForUpdate(
    args: Record<string, unknown>,
    resolvedIssueId: string,
  ): Promise<string | undefined> {
    if (!args.statusId || isUuid(args.statusId as string)) {
      return args.statusId as string | undefined;
    }
    let teamId: string | undefined;
    if (resolvedIssueId && isUuid(resolvedIssueId)) {
      teamId = await this.fetchIssueTeamId(resolvedIssueId);
    }
    return this.linearService.resolveStatusId(args.statusId as string, teamId);
  }

  private buildCreateResolveVariables(args: Record<string, unknown>): Record<string, unknown> {
    const resolveVariables: Record<string, unknown> = {};
    if (args.teamId && !isUuid(args.teamId as string)) {
      Object.assign(resolveVariables, this.buildResolveVariablesForTeam(args.teamId as string));
    }
    if (args.projectId && !isUuid(args.projectId as string)) {
      resolveVariables.projectName = args.projectId;
    }
    if (args.milestoneId && !isUuid(args.milestoneId as string)) {
      resolveVariables.milestoneName = args.milestoneId;
    }
    if (args.labelIds && Array.isArray(args.labelIds)) {
      const nonUuidLabels = (args.labelIds as string[]).filter((id: string) => !isUuid(id));
      if (nonUuidLabels.length > 0) {
        resolveVariables.__labelNames = nonUuidLabels;
      }
    }
    if (args.parentId && !isUuid(args.parentId as string)) {
      const parentParsed = tryParseIssueIdentifier(args.parentId as string);
      if (parentParsed) {
        resolveVariables.parentTeamKey = parentParsed.teamKey;
        resolveVariables.parentIssueNumber = parentParsed.issueNumber;
      }
    }
    return resolveVariables;
  }

  private resolveParentId(
    parentId: string | undefined,
    resolveResult: GraphQLResponseData,
  ): string | undefined {
    if (!parentId || isUuid(parentId)) {
      return parentId;
    }
    const parentIssues = resolveResult.parentIssues as GraphQLResponseData | undefined;
    const parentNodes = parentIssues?.nodes as GraphQLResponseData[] | undefined;
    if (!parentNodes?.length) {
      throw notFoundError("Parent issue", parentId);
    }
    return parentNodes[0].id as string;
  }

  transformIssueData(issue: GraphQLResponseData): LinearIssue {
    const labels = issue.labels as GraphQLResponseData;

    return {
      ...this.transformIssueCoreFields(issue),
      ...this.transformIssueRelations(issue),
      summary: issue.summary ? extractSummaryText(issue.summary as GraphQLResponseData) : undefined,
      priority: issue.priority as number,
      estimate: (issue.estimate as number | undefined) || undefined,
      dueDate: (issue.dueDate as string | undefined) || undefined,
      labels: (labels.nodes as GraphQLResponseData[]).map((label: GraphQLResponseData) => ({
        id: label.id as string,
        name: label.name as string,
      })),
      ...this.transformIssueHierarchy(issue),
      comments: this.transformIssueComments(issue),
      createdAt: toISOStringOrNow(issue.createdAt as string),
      updatedAt: toISOStringOrNow(issue.updatedAt as string),
    };
  }

  private transformIssueCoreFields(
    issue: GraphQLResponseData,
  ): Pick<
    LinearIssue,
    "id" | "identifier" | "url" | "title" | "description" | "branchName" | "embeds"
  > {
    return {
      id: issue.id as string,
      identifier: issue.identifier as string,
      url: issue.url as string,
      title: issue.title as string,
      description: (issue.description as string | undefined) || undefined,
      branchName: (issue.branchName as string | undefined) || undefined,
      embeds: issue.description ? extractEmbeds(issue.description as string) : undefined,
    };
  }

  private transformIssueRelations(
    issue: GraphQLResponseData,
  ): Pick<LinearIssue, "state" | "assignee" | "team" | "project" | "cycle" | "projectMilestone"> {
    const state = issue.state as GraphQLResponseData | undefined;
    const assignee = issue.assignee as GraphQLResponseData | undefined;
    const team = issue.team as GraphQLResponseData | undefined;
    const project = issue.project as GraphQLResponseData | undefined;
    const cycle = issue.cycle as GraphQLResponseData | undefined;
    const milestone = issue.projectMilestone as GraphQLResponseData | undefined;

    return {
      state: state ? { id: state.id as string, name: state.name as string } : undefined,
      assignee: assignee
        ? {
            id: assignee.id as string,
            name: resolveUserDisplayName(assignee.id as string, assignee.name as string),
            url: (assignee.url as string | undefined) || undefined,
          }
        : undefined,
      team: team
        ? { id: team.id as string, key: team.key as string, name: team.name as string }
        : undefined,
      project: project ? { id: project.id as string, name: project.name as string } : undefined,
      cycle: cycle
        ? { id: cycle.id as string, name: cycle.name as string, number: cycle.number as number }
        : undefined,
      projectMilestone: milestone
        ? {
            id: milestone.id as string,
            name: milestone.name as string,
            targetDate: (milestone.targetDate as string | undefined) || undefined,
          }
        : undefined,
    };
  }

  private transformIssueHierarchy(
    issue: GraphQLResponseData,
  ): Pick<LinearIssue, "parentIssue" | "subIssues"> {
    const parent = issue.parent as GraphQLResponseData | undefined;
    const children = issue.children as GraphQLResponseData | undefined;

    return {
      parentIssue: parent
        ? {
            id: parent.id as string,
            identifier: parent.identifier as string,
            title: parent.title as string,
          }
        : undefined,
      subIssues:
        (children?.nodes as GraphQLResponseData[] | undefined)?.map(
          (child: GraphQLResponseData) => ({
            id: child.id as string,
            identifier: child.identifier as string,
            title: child.title as string,
          }),
        ) || undefined,
    };
  }

  private transformIssueComments(issue: GraphQLResponseData): LinearIssue["comments"] {
    const comments = issue.comments as GraphQLResponseData | undefined;
    return (
      (comments?.nodes as GraphQLResponseData[] | undefined)?.map(
        (comment: GraphQLResponseData) => {
          const commentUser = comment.user as GraphQLResponseData | null;
          return {
            id: comment.id as string,
            body: comment.body as string,
            embeds: extractEmbeds(comment.body as string),
            user: commentUser
              ? {
                  id: commentUser.id as string,
                  name: resolveUserDisplayName(
                    commentUser.id as string,
                    commentUser.name as string,
                  ),
                  url: (commentUser.url as string | undefined) || undefined,
                }
              : undefined,
            createdAt: toISOStringOrNow(comment.createdAt as string),
            updatedAt: toISOStringOrNow(comment.updatedAt as string),
          };
        },
      ) || []
    );
  }
}
