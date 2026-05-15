import { resolveUserDisplayName } from "../config/resolver.js";
import {
	ARCHIVE_ISSUE_MUTATION,
	BATCH_RESOLVE_FOR_CREATE_QUERY,
	BATCH_RESOLVE_FOR_SEARCH_QUERY,
	BATCH_RESOLVE_FOR_UPDATE_QUERY,
	buildResolveLabelsByNameQuery,
	CREATE_ISSUE_MUTATION,
	DELETE_ISSUE_MUTATION,
	FILTERED_SEARCH_ISSUES_QUERY,
	GET_ISSUE_BY_ID_QUERY,
	GET_ISSUE_BY_IDENTIFIER_QUERY,
	GET_ISSUE_START_CONTEXT_QUERY,
	GET_ISSUE_TEAM_QUERY,
	GET_ISSUES_QUERY,
	SEARCH_ISSUES_QUERY,
	TEAM_STARTED_STATUSES_QUERY,
	UPDATE_ISSUE_MUTATION,
} from "../queries/issues.js";
import type {
	ArchiveIssueResponse,
	BatchResolveForCreateResponse,
	BatchResolveForSearchResponse,
	BatchResolveForUpdateResponse,
	BatchResolveLabelNode,
	BatchResolveProjectMilestoneRef,
	BatchResolveResult,
	CreateIssueResponse,
	DeleteIssueResponse,
	GetIssueByIdentifierResponse,
	GetIssueByIdResponse,
	GetIssuesResponse,
	GetIssueTeamResponse,
	IssueArchiveEntity,
	IssueNode,
	IssueStartContextResponse,
	IssueWithCommentsNode,
	ResolveLabelsByNameResponse,
	SearchIssuesResponse,
	TeamStartedStatusesResponse,
	UpdateIssueResponse,
} from "../queries/issues-types.js";
import { CREATE_LABEL_MUTATION } from "../queries/labels.js";
import type { CreateLabelResponse } from "../queries/labels-types.js";
import type { LinearIssue, LinearPriority } from "../types/linear.js";
import { toISOStringOrNow } from "./date-format.js";
import { extractEmbeds } from "./embed-parser.js";
import { notFoundError } from "./error-messages.js";
import type { GraphQLService } from "./graphql-service.js";
import {
	parseIssueIdentifier,
	tryParseIssueIdentifier,
} from "./identifier-parser.js";
import type { LinearService } from "./linear-service.js";
import { logger } from "./logger.js";
import { isUuid } from "./uuid.js";

const TEAM_KEY_REGEX = /^[A-Z0-9]+$/i;

/**
 * Project filter for `SearchIssueArgs`. Discriminated on `kind` so the
 * "filter by project" and "filter to issues with no project" cases are
 * mutually exclusive at the type level — the old `projectId?: string;
 * noProject?: boolean` pair allowed `{ projectId: "x", noProject: true }`
 * to compile but had to be detangled at runtime (`noProject` won by
 * convention). The discriminant is the contract.
 */
export type SearchIssueProject = { kind: "id"; id: string } | { kind: "none" };

/**
 * Arguments accepted by `GraphQLIssuesService.searchIssues`. Two
 * modes:
 *   - When `query` is set, runs Linear's full-text search and
 *     post-filters the results with the structured filters below.
 *   - When `query` is unset, runs a structured filter directly.
 */
export interface SearchIssueArgs {
	/** Free-text search term. When set, `searchIssues` uses Linear's
	 * native full-text search. */
	query?: string;
	/** Team key, name, or UUID. */
	teamId?: string;
	/**
	 * Project filter. `{ kind: "id", id }` filters to a specific project
	 * (name or UUID accepted); `{ kind: "none" }` matches issues with no
	 * project. Undefined leaves the filter off.
	 */
	project?: SearchIssueProject;
	/** Assignee name, email, alias, or UUID. */
	assigneeId?: string;
	/** Agent user name, email, alias, or UUID delegated to the issue. */
	delegateId?: string;
	/** Issue states to include (e.g. `["Todo", "In Progress"]`). */
	status?: string[];
	/** Label names to require (intersection). */
	labelNames?: string[];
	/** Priority values (0-4) to include. */
	priority?: LinearPriority[];
	/** Result cap; defaults to 10 when not set. */
	limit?: number;
	/** Linear orderBy enum (`createdAt` / `updatedAt`). */
	orderBy?: string;
}

/**
 * Fields shared by `CreateIssueArgs` and `UpdateIssueArgs`. Both mutations
 * accept the same scalar/foreign-key fields — only their lifecycle
 * fields differ. `Create` adds `teamInput`/`subscriberIds`/`templateId`
 * (initial-state-only); `Update` adds the required `id` and widens
 * `cycleId` to `| null` (Linear's API uses `null` to detach from a
 * cycle on update).
 *
 * Pre-fix this lived as two parallel 13-field interfaces. A field added
 * to one would silently diverge from the other; the shared base now
 * forces a deliberate per-side decision.
 */
interface IssueMutationFields {
	title?: string;
	/** Team key, name, or UUID. Required on create unless `templateId` is set. */
	teamId?: string;
	description?: string;
	/** Assignee name, email, alias, or UUID. */
	assigneeId?: string;
	/** Agent user name, email, alias, or UUID delegated to work on the issue. */
	delegateId?: string | null;
	/** Linear priority: 0 (none), 1 (urgent), 2 (high), 3 (medium), 4 (low). */
	priority?: LinearPriority;
	/** Project name or UUID. */
	projectId?: string;
	/** Status name or UUID — resolved per team. */
	statusId?: string;
	/** Label names or UUIDs — auto-created on the team if missing. */
	labelIds?: string[];
	/** Parent issue identifier or UUID. */
	parentId?: string;
	/** Project milestone name or UUID — resolved within the project. */
	milestoneId?: string;
	/** Due date, ISO 8601. */
	dueDate?: string;
	/** Story-points / estimate. */
	estimate?: number;
}

/**
 * Arguments accepted by `GraphQLIssuesService.updateIssue`. Same field
 * shapes as `CreateIssueArgs` (UUID-or-name where applicable), but with
 * `id` required (the issue to update) and the create-only initial-state
 * fields (`teamInput` / `subscriberIds` / `templateId`) omitted.
 */
export interface UpdateIssueArgs extends IssueMutationFields {
	/** Issue identifier (e.g. `DEV-3592`) or UUID. Required. */
	id: string;
	/**
	 * On update, `null` detaches the issue from its current cycle.
	 * (`undefined` leaves it unchanged; a UUID/number/name moves it.)
	 */
	cycleId?: string | null;
}

/**
 * Arguments accepted by `GraphQLIssuesService.createIssue`. Most fields
 * may be passed as a Linear UUID OR a name/identifier — the service
 * resolves names to UUIDs against the workspace before issuing the
 * mutation. The few fields that must already be UUIDs are noted on
 * the property docstring.
 *
 * Pre-fix this was `Record<string, unknown>` and every command-side
 * caller built up a free-form object. A typo in `assigeeId` vs
 * `assigneeId` compiled cleanly and silently dropped the field. With
 * the typed shape, `tsc` catches the typo.
 */
export interface CreateIssueArgs extends IssueMutationFields {
	/** Original team token (key or name) — used in label resolution error messages. */
	teamInput?: string;
	/** Cycle number, name, or UUID — resolved per team. (No `null` on create.) */
	cycleId?: string;
	/** Subscriber names, emails, aliases, or UUIDs. */
	subscriberIds?: string[];
	/** Linear server-side template UUID for `--from-template`. */
	templateId?: string;
}

export interface IssueArchiveOperationResult {
	id: string;
	entity?: IssueArchiveEntity;
	lastSyncId: number;
}

export interface StartIssueResult {
	issue: LinearIssue;
	previousState?: { id: string; name: string; type: string };
	started: boolean;
	targetState?: { id: string; name: string };
}

interface SummaryWalkNode {
	text?: string;
	content?: SummaryWalkNode[];
}

function extractSummaryText(
	summary: NonNullable<IssueNode["summary"]>,
): string | undefined {
	if (summary.generationStatus !== "completed" || !summary.content) {
		return undefined;
	}
	const parts: string[] = [];
	const walk = (node: SummaryWalkNode) => {
		if (typeof node.text === "string") {
			parts.push(node.text);
		}
		if (Array.isArray(node.content)) {
			for (const child of node.content) {
				walk(child);
			}
		}
	};
	walk(summary.content as SummaryWalkNode);
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
		const result = await this.graphQLService.rawRequest<GetIssuesResponse>(
			GET_ISSUES_QUERY,
			{ first: limit, orderBy: "updatedAt" },
		);
		const nodes = result.issues?.nodes;
		if (!nodes?.length) {
			return [];
		}
		return nodes.map((issue) => this.transformIssueData(issue));
	}

	async getIssueById(issueId: string): Promise<LinearIssue> {
		let issueData: IssueWithCommentsNode;
		if (isUuid(issueId)) {
			const result = await this.graphQLService.rawRequest<GetIssueByIdResponse>(
				GET_ISSUE_BY_ID_QUERY,
				{ id: issueId },
			);
			if (!result.issue) {
				throw notFoundError("Issue", issueId);
			}
			issueData = result.issue;
		} else {
			const { teamKey, issueNumber } = parseIssueIdentifier(issueId);
			const result =
				await this.graphQLService.rawRequest<GetIssueByIdentifierResponse>(
					GET_ISSUE_BY_IDENTIFIER_QUERY,
					{ teamKey, number: issueNumber },
				);
			const nodes = result.issues?.nodes;
			if (!nodes?.length) {
				throw notFoundError("Issue", issueId);
			}
			issueData = nodes[0];
		}
		return this.transformIssueData(issueData);
	}

	async startIssue(issueId: string): Promise<StartIssueResult> {
		const resolvedIssueId = await this.linearService.resolveIssueId(issueId);
		const context =
			await this.graphQLService.rawRequest<IssueStartContextResponse>(
				GET_ISSUE_START_CONTEXT_QUERY,
				{ id: resolvedIssueId },
			);
		const issue = context.issue;
		if (!issue) {
			throw notFoundError("Issue", issueId);
		}

		const previousState = issue.state
			? {
					id: issue.state.id,
					name: issue.state.name,
					type: issue.state.type,
				}
			: undefined;
		if (
			previousState &&
			["started", "completed", "canceled"].includes(previousState.type)
		) {
			return {
				issue: await this.getIssueById(resolvedIssueId),
				previousState,
				started: false,
			};
		}
		if (!issue.team?.id) {
			throw new Error(
				`Issue ${issue.identifier} has no team; cannot start it.`,
			);
		}

		const statuses =
			await this.graphQLService.rawRequest<TeamStartedStatusesResponse>(
				TEAM_STARTED_STATUSES_QUERY,
				{ teamId: issue.team.id },
			);
		const startedStatus = statuses.team?.states.nodes
			.slice()
			.sort((a, b) => a.position - b.position)[0];
		if (!startedStatus) {
			throw new Error(
				`Team ${issue.team.key} has no workflow status of type "started".`,
			);
		}

		const updated = await this.updateIssue(
			{ id: resolvedIssueId, statusId: startedStatus.id },
			"adding",
		);
		return {
			issue: updated,
			previousState,
			started: true,
			targetState: { id: startedStatus.id, name: startedStatus.name },
		};
	}

	async updateIssue(
		args: UpdateIssueArgs,
		labelMode = "overwriting",
	): Promise<LinearIssue> {
		// Normalize URL/slug-id --project inputs to UUIDs before the batch
		// resolver runs; see comment on `withNormalizedProjectId`.
		const normalizedArgs = await this.withNormalizedProjectId(args);
		const { resolvedIssueId, issueTeamId, currentIssueLabels, resolveResult } =
			await this.resolveUpdateContext(normalizedArgs);

		let teamIdForLabels = issueTeamId;
		if (!teamIdForLabels && normalizedArgs.labelIds && resolvedIssueId) {
			teamIdForLabels = await this.fetchIssueTeamId(resolvedIssueId);
		}

		const finalLabelIds = await this.resolveLabelsWithMode(
			normalizedArgs.labelIds,
			resolveResult,
			labelMode,
			currentIssueLabels,
			teamIdForLabels,
			normalizedArgs.teamId,
		);

		const finalProjectId = normalizedArgs.projectId
			? this.resolveProjectId(normalizedArgs.projectId, resolveResult)
			: undefined;

		const { projectMilestoneNodes, issueProjectMilestoneNodes } =
			this.extractMilestoneNodes(normalizedArgs, resolveResult);

		const finalMilestoneId = this.resolveMilestoneId(
			normalizedArgs.milestoneId,
			resolveResult,
			projectMilestoneNodes,
			issueProjectMilestoneNodes,
		);

		const finalCycleId = await this.resolveCycleIdForUpdate(
			normalizedArgs,
			resolveResult,
			resolvedIssueId,
		);
		const resolvedStatusId = await this.resolveStatusIdForUpdate(
			normalizedArgs,
			resolvedIssueId,
		);

		// Resolve assignee in place — `buildUpdateInput` reads it
		// directly. Match the createIssue pattern.
		let assigneeId = normalizedArgs.assigneeId;
		if (assigneeId && !isUuid(assigneeId)) {
			assigneeId = await this.linearService.resolveUserId(assigneeId);
		}
		let delegateId = normalizedArgs.delegateId;
		if (delegateId && !isUuid(delegateId)) {
			delegateId = await this.linearService.resolveUserId(delegateId);
		}

		const updateInput = this.buildUpdateInput(
			{ ...normalizedArgs, assigneeId, delegateId },
			{
				statusId: resolvedStatusId,
				projectId: finalProjectId,
				labelIds: finalLabelIds,
				milestoneId: finalMilestoneId,
				cycleId: finalCycleId,
			},
		);

		return this.executeUpdateMutation(
			resolvedIssueId,
			normalizedArgs.id,
			updateInput,
		);
	}

	async archiveIssue(issueId: string): Promise<IssueArchiveOperationResult> {
		const resolvedIssueId = await this.linearService.resolveIssueId(issueId);
		const result = await this.graphQLService.rawRequest<ArchiveIssueResponse>(
			ARCHIVE_ISSUE_MUTATION,
			{ id: resolvedIssueId },
		);
		const payload = result.issueArchive;
		if (!payload.success) {
			throw new Error(`Failed to archive issue ${issueId}`);
		}
		return {
			id: resolvedIssueId,
			entity: payload.entity ?? undefined,
			lastSyncId: payload.lastSyncId,
		};
	}

	async deleteIssue(
		issueId: string,
		options: { permanentlyDelete?: boolean } = {},
	): Promise<IssueArchiveOperationResult> {
		const resolvedIssueId = await this.linearService.resolveIssueId(issueId);
		const result = await this.graphQLService.rawRequest<DeleteIssueResponse>(
			DELETE_ISSUE_MUTATION,
			{
				id: resolvedIssueId,
				permanentlyDelete: Boolean(options.permanentlyDelete),
			},
		);
		const payload = result.issueDelete;
		if (!payload.success) {
			throw new Error(`Failed to delete issue ${issueId}`);
		}
		return {
			id: resolvedIssueId,
			entity: payload.entity ?? undefined,
			lastSyncId: payload.lastSyncId,
		};
	}

	private extractMilestoneNodes(
		args: UpdateIssueArgs,
		resolveResult: BatchResolveResult,
	): {
		projectMilestoneNodes: BatchResolveProjectMilestoneRef[] | undefined;
		issueProjectMilestoneNodes: BatchResolveProjectMilestoneRef[] | undefined;
	} {
		const projectMilestoneNodes = args.projectId
			? resolveResult.projects?.nodes?.[0]?.projectMilestones?.nodes
			: undefined;

		const issueProjectMilestoneNodes =
			resolveResult.issues?.nodes?.[0]?.project?.projectMilestones.nodes;

		return { projectMilestoneNodes, issueProjectMilestoneNodes };
	}

	private async executeUpdateMutation(
		resolvedIssueId: string,
		originalId: string,
		updateInput: Record<string, unknown>,
	): Promise<LinearIssue> {
		let updateResult: UpdateIssueResponse;
		try {
			updateResult = await this.graphQLService.rawRequest<UpdateIssueResponse>(
				UPDATE_ISSUE_MUTATION,
				{
					id: resolvedIssueId,
					input: updateInput,
				},
			);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (msg.includes("Discrepancy between issue team")) {
				const hint = updateInput.projectId
					? `The project may not be associated with this issue's team. Fix with: el-linear projects add-team "<project>" <team>`
					: "The issue's team doesn't match the assigned project, cycle, or status.";
				throw new Error(`Failed to update issue ${originalId}: ${hint}`);
			}
			throw new Error(`Failed to update issue ${originalId}: ${msg}`);
		}
		const issueUpdate = updateResult.issueUpdate;
		if (!issueUpdate.success) {
			throw new Error(`Failed to update issue ${originalId}`);
		}
		if (!issueUpdate.issue) {
			throw new Error("Failed to retrieve updated issue");
		}
		return this.transformIssueData(issueUpdate.issue);
	}

	async createIssue(args: CreateIssueArgs): Promise<LinearIssue> {
		// Pre-resolve URL/slug-id forms of --project to a UUID so the batch
		// resolver below (which uses a `name eqIgnoreCase` filter) can skip
		// the project lookup entirely. Plain name inputs flow through unchanged
		// and get resolved by the batch query in a single round-trip.
		const normalizedArgs = await this.withNormalizedProjectId(args);
		const resolveVariables = this.buildCreateResolveVariables(normalizedArgs);

		let resolveResult: BatchResolveResult = {};
		if (Object.keys(resolveVariables).length > 0) {
			const { __labelNames, ...queryVars } = resolveVariables;
			const batchPromise =
				this.graphQLService.rawRequest<BatchResolveForCreateResponse>(
					BATCH_RESOLVE_FOR_CREATE_QUERY,
					queryVars,
				);
			if (__labelNames) {
				const labelQuery = buildResolveLabelsByNameQuery(
					__labelNames as string[],
				);
				const [batch, labels] = await Promise.all([
					batchPromise,
					this.graphQLService.rawRequest<ResolveLabelsByNameResponse>(
						labelQuery.query,
						labelQuery.variables,
					),
				]);
				resolveResult = {
					...this.foldCreateBatchResult(batch),
					labels: labels.labels,
				};
			} else {
				resolveResult = this.foldCreateBatchResult(await batchPromise);
			}
		}

		const resolved = await this.resolveCreateFields(
			normalizedArgs,
			resolveResult,
		);

		// Mutate-the-input feels gross but matches the existing pattern
		// — `resolved` doesn't carry assigneeId, so the buildCreateInput
		// step reads `args.assigneeId` directly. Resolve in place.
		let assigneeId = normalizedArgs.assigneeId;
		if (assigneeId && !isUuid(assigneeId)) {
			assigneeId = await this.linearService.resolveUserId(assigneeId);
		}
		let delegateId = normalizedArgs.delegateId;
		if (delegateId && !isUuid(delegateId)) {
			delegateId = await this.linearService.resolveUserId(delegateId);
		}

		const createInput = this.buildCreateInput(
			{ ...normalizedArgs, assigneeId, delegateId },
			resolved,
		);
		return this.executeCreateMutation(createInput);
	}

	/**
	 * Folds the `@include`-gated `projectsByName` / `projectsById` aliases
	 * from a create batch response into the single `projects` field the
	 * field-resolution helpers expect. At most one project alias is ever
	 * present, since a `--project` input is either a name or a UUID.
	 */
	private foldCreateBatchResult(
		batch: BatchResolveForCreateResponse,
	): BatchResolveResult {
		return {
			teams: batch.teams,
			projects: batch.projectsByName ?? batch.projectsById,
			milestones: batch.milestones,
			parentIssues: batch.parentIssues,
		};
	}

	/**
	 * Folds the `@include`-gated `projectsByName` / `projectsById` aliases
	 * from an update batch response into the single `projects` field the
	 * field-resolution helpers expect. See `foldCreateBatchResult`.
	 */
	private foldUpdateBatchResult(
		batch: BatchResolveForUpdateResponse,
	): BatchResolveResult {
		return {
			projects: batch.projectsByName ?? batch.projectsById,
			milestones: batch.milestones,
			issues: batch.issues,
		};
	}

	private async resolveCreateFields(
		args: CreateIssueArgs,
		resolveResult: BatchResolveResult,
	): Promise<{
		teamId: string | undefined;
		projectId: string | undefined;
		statusId: string | undefined;
		labelIds: string[] | undefined;
		parentId: string | undefined;
		milestoneId: string | undefined;
		cycleId: string | undefined;
	}> {
		let teamId: string | undefined = args.teamId
			? await this.resolveTeamId(args.teamId, resolveResult)
			: undefined;

		const projectId: string | undefined = args.projectId
			? this.resolveProjectId(args.projectId, resolveResult)
			: undefined;

		// Validate team-project compatibility and auto-correct when possible
		if (projectId && teamId && args.projectId) {
			teamId = this.validateProjectTeam(teamId, args.projectId, resolveResult);
		}

		const labelIds = await this.resolveLabels(
			args.labelIds,
			resolveResult,
			teamId,
			args.teamInput,
		);
		const parentId = this.resolveParentId(args.parentId, resolveResult);
		const milestoneId = this.resolveMilestoneIdForCreate(
			args.milestoneId,
			resolveResult,
			projectId,
		);

		let cycleId: string | undefined = args.cycleId;
		if (cycleId && !isUuid(cycleId)) {
			cycleId = await this.linearService.resolveCycleId(cycleId, teamId);
		}

		let statusId: string | undefined = args.statusId;
		if (statusId && !isUuid(statusId)) {
			statusId = await this.linearService.resolveStatusId(statusId, teamId);
		}

		return {
			teamId,
			projectId,
			statusId,
			labelIds,
			parentId,
			milestoneId,
			cycleId,
		};
	}

	private async executeCreateMutation(
		createInput: Record<string, unknown>,
	): Promise<LinearIssue> {
		let createResult: CreateIssueResponse;
		try {
			createResult = await this.graphQLService.rawRequest<CreateIssueResponse>(
				CREATE_ISSUE_MUTATION,
				{
					input: createInput,
				},
			);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to create issue: ${msg}`);
		}
		const issueCreate = createResult.issueCreate;
		if (!issueCreate.success) {
			throw new Error("Failed to create issue: the API reported failure.");
		}
		if (!issueCreate.issue) {
			throw new Error("Failed to retrieve created issue");
		}
		return this.transformIssueData(issueCreate.issue);
	}

	async searchIssues(args: SearchIssueArgs): Promise<LinearIssue[]> {
		const resolveVariables: Record<string, unknown> = {};

		if (args.teamId && !isUuid(args.teamId)) {
			Object.assign(
				resolveVariables,
				this.buildResolveVariablesForTeam(args.teamId),
			);
		}
		// Only the `id` arm carries a name/UUID for resolution; `none` and
		// `undefined` skip the resolve.
		const projectIdArg =
			args.project?.kind === "id" ? args.project.id : undefined;
		if (projectIdArg && !isUuid(projectIdArg)) {
			resolveVariables.projectName = projectIdArg;
			resolveVariables.hasProjectName = true;
		}
		if (
			args.assigneeId &&
			!isUuid(args.assigneeId) &&
			args.assigneeId.includes("@")
		) {
			resolveVariables.assigneeEmail = args.assigneeId;
		}
		if (
			args.delegateId &&
			!isUuid(args.delegateId) &&
			args.delegateId.includes("@")
		) {
			resolveVariables.delegateEmail = args.delegateId;
		}

		let resolveResult: BatchResolveResult = {};
		if (Object.keys(resolveVariables).length > 0) {
			resolveResult =
				await this.graphQLService.rawRequest<BatchResolveForSearchResponse>(
					BATCH_RESOLVE_FOR_SEARCH_QUERY,
					resolveVariables,
				);
		}

		const finalTeamId: string | undefined = args.teamId
			? await this.resolveTeamId(args.teamId, resolveResult)
			: undefined;

		const finalProjectId: string | undefined = projectIdArg
			? this.resolveProjectId(projectIdArg, resolveResult)
			: undefined;

		const finalAssigneeId = this.resolveAssigneeId(
			args.assigneeId,
			resolveResult,
		);
		const finalDelegateId = await this.resolveDelegateId(
			args.delegateId,
			resolveResult,
		);

		// Map the public discriminant back to the internal filter shape:
		// `{ kind: "id", id }` → `{ kind: "id", id: <resolvedUuid> }`
		// `{ kind: "none" }`  → pass through
		// undefined            → undefined (filter off)
		// Reused by both the full-text and structured search paths so
		// `--no-project` (`{ kind: "none" }`) participates in both — pre-fix,
		// the full-text branch silently dropped `noProject` because only
		// the resolved `projectId` was forwarded.
		const projectFilter: SearchIssueProject | undefined =
			args.project?.kind === "id" && finalProjectId
				? { kind: "id", id: finalProjectId }
				: args.project?.kind === "none"
					? { kind: "none" }
					: undefined;

		const limit = args.limit ?? 10;

		if (args.query) {
			const searchResult =
				await this.graphQLService.rawRequest<SearchIssuesResponse>(
					SEARCH_ISSUES_QUERY,
					{
						term: args.query,
						first: limit,
					},
				);
			const nodes = searchResult.searchIssues?.nodes;
			if (!nodes?.length) {
				return [];
			}
			const results = nodes.map((issue) => this.transformIssueData(issue));
			return this.applySearchFilters(results, {
				teamId: finalTeamId,
				assigneeId: finalAssigneeId,
				delegateId: finalDelegateId,
				project: projectFilter,
				status: args.status,
				labelNames: args.labelNames,
				priority: args.priority,
			});
		}
		const filter = this.buildSearchFilter({
			teamId: finalTeamId,
			assigneeId: finalAssigneeId,
			delegateId: finalDelegateId,
			project: projectFilter,
			status: args.status,
			labelNames: args.labelNames,
			priority: args.priority,
		});
		const searchResult =
			await this.graphQLService.rawRequest<GetIssuesResponse>(
				FILTERED_SEARCH_ISSUES_QUERY,
				{
					first: limit,
					filter: Object.keys(filter).length > 0 ? filter : undefined,
					orderBy: args.orderBy ?? "updatedAt",
				},
			);
		const filteredIssues = searchResult.issues;
		if (!filteredIssues?.nodes) {
			return [];
		}
		return filteredIssues.nodes.map((issue) => this.transformIssueData(issue));
	}

	// --- Private helper methods for field resolution ---

	private async resolveTeamId(
		teamId: string,
		resolveResult: BatchResolveResult,
	): Promise<string> {
		if (isUuid(teamId)) {
			return teamId;
		}
		const teamNodes = resolveResult.teams?.nodes;
		const resolvedTeam = teamNodes?.[0];
		if (
			resolvedTeam &&
			(resolvedTeam.key.toUpperCase() === teamId.toUpperCase() ||
				resolvedTeam.name.toLowerCase() === teamId.toLowerCase())
		) {
			return resolvedTeam.id;
		}
		// Exact GraphQL match failed — fall back to prefix matching via LinearService
		return this.linearService.resolveTeamId(teamId);
	}

	private resolveProjectId(
		projectId: string,
		resolveResult: BatchResolveResult,
	): string {
		if (isUuid(projectId)) {
			// The create/update batch queries fetch a `projectsById` block for a
			// UUID `--project` (folded into `resolveResult.projects`). An empty
			// `nodes` array means the block ran but matched nothing — i.e. the
			// UUID doesn't exist. Fail clearly here instead of passing a dead
			// UUID to the mutation, which would surface a vague server error.
			// When no block was fetched (`projects` undefined — e.g. the search
			// path has no `projectsById` arm) there's nothing to validate, so
			// the UUID passes through unchanged.
			const fetched = resolveResult.projects?.nodes;
			if (fetched && fetched.length === 0) {
				throw notFoundError("Project", projectId);
			}
			return projectId;
		}
		const projectNodes = resolveResult.projects?.nodes;
		if (!projectNodes?.length) {
			throw notFoundError("Project", projectId);
		}
		return projectNodes[0].id;
	}

	/**
	 * Check that the resolved team is associated with the project.
	 * If not, auto-switch when the project belongs to exactly one team.
	 */
	private validateProjectTeam(
		teamId: string,
		projectInput: string,
		resolveResult: BatchResolveResult,
	): string {
		const projectNode = resolveResult.projects?.nodes?.[0];
		if (!projectNode) {
			return teamId;
		}

		const teamNodes = projectNode.teams?.nodes;
		if (!teamNodes?.length) {
			return teamId;
		}

		const isAssociated = teamNodes.some((t) => t.id === teamId);
		if (isAssociated) {
			return teamId;
		}

		const projectName = projectNode.name || projectInput;
		const teamKeys = teamNodes.map((t) => t.key);

		if (teamNodes.length === 1) {
			const correctTeamId = teamNodes[0].id;
			const correctKey = teamKeys[0];
			logger.error(
				`Auto-switched team to ${correctKey} (the only team associated with project "${projectName}").`,
			);
			return correctTeamId;
		}

		throw new Error(
			`Project "${projectName}" is not associated with the specified team.\n` +
				`Associated teams: ${teamKeys.join(", ")}\n` +
				`Hint: Use --team ${teamKeys[0]} or run \`el-linear projects add-team "${projectName}" TEAM\` to add your team.`,
		);
	}

	private async resolveLabels(
		labelIds: string[] | undefined,
		resolveResult: BatchResolveResult,
		teamId?: string,
		teamInput?: string,
	): Promise<string[] | undefined> {
		return this.resolveLabelsWithMode(
			labelIds,
			resolveResult,
			"overwriting",
			[],
			teamId,
			teamInput,
		);
	}

	private async resolveLabelsWithMode(
		labelIds: string[] | undefined,
		resolveResult: BatchResolveResult,
		labelMode: string,
		currentIssueLabels: string[],
		teamId?: string,
		teamInput?: string,
	): Promise<string[] | undefined> {
		if (!(labelIds && Array.isArray(labelIds))) {
			return labelIds;
		}
		const resolvedLabels: string[] = [];
		const labelNodes = resolveResult.labels?.nodes;
		for (const labelIdOrName of labelIds) {
			if (isUuid(labelIdOrName)) {
				resolvedLabels.push(labelIdOrName);
			} else {
				const lowerName = labelIdOrName.toLowerCase();
				const candidates = labelNodes?.filter(
					(l) => l.name.toLowerCase() === lowerName,
				);
				let label: BatchResolveLabelNode | undefined;
				if (candidates && candidates.length > 1 && teamId) {
					label = candidates.find((l) => l.team?.id === teamId);
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
					const teamKey = this.resolveTeamKeyFromResult(
						resolveResult,
						teamId,
						teamInput,
					);
					const hint = teamKey
						? `— check available labels with: el-linear labels list --team ${teamKey}`
						: undefined;
					throw notFoundError("Label", labelIdOrName, undefined, hint);
				}
				if (label.isGroup) {
					const teamKey = this.resolveTeamKeyFromResult(
						resolveResult,
						teamId,
						teamInput,
					);
					const hint = teamKey
						? ` Run: el-linear labels list --team ${teamKey}`
						: "";
					throw new Error(
						`Label "${labelIdOrName}" is a group label. Use a specific child label instead.${hint}`,
					);
				}
				resolvedLabels.push(label.id);
			}
		}
		if (labelMode === "adding") {
			return [...new Set([...currentIssueLabels, ...resolvedLabels])];
		}
		return resolvedLabels;
	}

	/** Auto-create a missing label on the team. Returns the new label ID or null on failure. */
	private async autoCreateLabel(
		name: string,
		teamId?: string,
	): Promise<string | null> {
		try {
			const input: Record<string, string> = { name };
			if (teamId) {
				input.teamId = teamId;
			}
			const result = await this.graphQLService.rawRequest<CreateLabelResponse>(
				CREATE_LABEL_MUTATION,
				{ input },
			);
			const created = result.issueLabelCreate;
			if (created.success && created.issueLabel) {
				const teamKey = created.issueLabel.team?.key ?? "";
				logger.error(`Auto-created label "${name}" on team ${teamKey}`);
				return created.issueLabel.id;
			}
			return null;
		} catch {
			return null;
		}
	}

	private resolveTeamKeyFromResult(
		resolveResult: BatchResolveResult,
		teamId?: string,
		teamInput?: string,
	): string | undefined {
		// Collect team nodes from both the top-level teams query and the project's teams.
		// When the team was pre-resolved to a UUID by config, the top-level teams query
		// runs with null filters and may return an unrelated team. The project's teams
		// always include the correct team when a project is specified.
		const allTeamNodes = this.collectTeamNodes(resolveResult);

		if (teamId) {
			const match = allTeamNodes.find((t) => t.id === teamId);
			if (match) {
				return match.key;
			}
		}

		// If the team was pre-resolved to UUID by config and not found in the result,
		// use the original input (e.g., "DEV") as the hint.
		if (teamInput && !isUuid(teamInput)) {
			return teamInput.toUpperCase();
		}

		// Only fall back to first team if there's exactly one (unambiguous).
		// With multiple teams, returning an arbitrary one produces misleading error hints.
		const topLevelNodes = resolveResult.teams?.nodes;
		return topLevelNodes?.length === 1 ? topLevelNodes[0].key : undefined;
	}

	private collectTeamNodes(
		resolveResult: BatchResolveResult,
	): { id: string; key: string }[] {
		const nodes: { id: string; key: string }[] = [];
		const seen = new Set<string>();

		const topNodes = resolveResult.teams?.nodes;
		if (topNodes) {
			for (const t of topNodes) {
				if (!seen.has(t.id)) {
					seen.add(t.id);
					nodes.push(t);
				}
			}
		}

		// Also check project teams (which are always fetched when --project is used)
		const projectTeamNodes = resolveResult.projects?.nodes?.[0]?.teams?.nodes;
		if (projectTeamNodes) {
			for (const t of projectTeamNodes) {
				if (!seen.has(t.id)) {
					seen.add(t.id);
					nodes.push(t);
				}
			}
		}

		return nodes;
	}

	private resolveMilestoneId(
		milestoneId: string | undefined,
		resolveResult: BatchResolveResult,
		projectMilestoneNodes?: BatchResolveProjectMilestoneRef[],
		issueProjectMilestoneNodes?: BatchResolveProjectMilestoneRef[],
	): string | undefined {
		if (!milestoneId || isUuid(milestoneId)) {
			return milestoneId;
		}
		let resolved = milestoneId;
		if (projectMilestoneNodes) {
			const projectMilestone = projectMilestoneNodes.find(
				(m) => m.name === milestoneId,
			);
			if (projectMilestone) {
				resolved = projectMilestone.id;
			}
		}
		if (!isUuid(resolved) && issueProjectMilestoneNodes) {
			const issueMilestone = issueProjectMilestoneNodes.find(
				(m) => m.name === milestoneId,
			);
			if (issueMilestone) {
				resolved = issueMilestone.id;
			}
		}
		const milestoneNodes = resolveResult.milestones?.nodes;
		if (!isUuid(resolved) && milestoneNodes?.length) {
			resolved = milestoneNodes[0].id;
		}
		if (!isUuid(resolved)) {
			throw notFoundError("Milestone", milestoneId);
		}
		return resolved;
	}

	private resolveMilestoneIdForCreate(
		milestoneId: string | undefined,
		resolveResult: BatchResolveResult,
		finalProjectId: string | undefined,
	): string | undefined {
		if (!milestoneId || isUuid(milestoneId)) {
			return milestoneId;
		}
		let resolved: string | undefined;
		const createProjectMilestoneNodes =
			resolveResult.projects?.nodes?.[0]?.projectMilestones?.nodes;
		if (createProjectMilestoneNodes) {
			const projectMilestone = createProjectMilestoneNodes.find(
				(m) => m.name === milestoneId,
			);
			if (projectMilestone) {
				resolved = projectMilestone.id;
			}
		}
		const createMilestoneNodes = resolveResult.milestones?.nodes;
		if (!resolved && createMilestoneNodes?.length) {
			resolved = createMilestoneNodes[0].id;
		}
		if (!resolved) {
			if (finalProjectId) {
				throw notFoundError("Milestone", milestoneId, "in project");
			}
			throw notFoundError(
				"Milestone",
				milestoneId,
				undefined,
				"Consider specifying --project.",
			);
		}
		return resolved;
	}

	private async fetchIssueTeamId(issueId: string): Promise<string | undefined> {
		const result = await this.graphQLService.rawRequest<GetIssueTeamResponse>(
			GET_ISSUE_TEAM_QUERY,
			{ issueId },
		);
		return result.issue?.team?.id;
	}

	private buildCreateInput(
		args: CreateIssueArgs,
		resolved: {
			teamId: string | undefined;
			projectId: string | undefined;
			statusId: string | undefined;
			labelIds: string[] | undefined;
			parentId: string | undefined;
			milestoneId: string | undefined;
			cycleId: string | undefined;
		},
	): Record<string, unknown> {
		const input: Record<string, unknown> = {};
		// Title is required by Linear's API unless --from-template is set,
		// in which case Linear copies the template's title. We only include
		// the field when explicitly set so a missing title with templateId
		// works as the API documents.
		if (args.title) {
			input.title = args.title;
		}
		if (resolved.teamId) {
			input.teamId = resolved.teamId;
		}
		if (args.description) {
			input.description = args.description;
		}
		if (args.assigneeId) {
			input.assigneeId = args.assigneeId;
		}
		if (args.delegateId) {
			input.delegateId = args.delegateId;
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
		if (resolved.labelIds && resolved.labelIds.length > 0) {
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
		if (args.subscriberIds && args.subscriberIds.length > 0) {
			input.subscriberIds = args.subscriberIds;
		}
		if (args.dueDate !== undefined) {
			input.dueDate = args.dueDate;
		}
		if (args.templateId !== undefined && args.templateId !== null) {
			// Server-side template instantiation: Linear copies the
			// template's title/description/labels/priority onto the
			// new issue. Any explicit field above wins by override.
			input.templateId = args.templateId;
		}
		return input;
	}

	private buildUpdateInput(
		args: UpdateIssueArgs,
		resolved: {
			statusId: string | undefined;
			projectId: string | undefined;
			labelIds: string[] | undefined;
			milestoneId: string | undefined;
			cycleId: string | null | undefined;
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
		if (args.delegateId !== undefined) {
			input.delegateId = args.delegateId;
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

	private buildResolveVariablesForTeam(
		teamId: string,
	): Record<string, unknown> {
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
			delegateId?: string;
			project?: SearchIssueProject;
			status?: string[];
			labelNames?: string[];
			priority?: LinearPriority[];
		},
	): LinearIssue[] {
		let filtered = results;
		if (filters.teamId) {
			filtered = filtered.filter(
				(issue: LinearIssue) => issue.team?.id === filters.teamId,
			);
		}
		if (filters.assigneeId) {
			filtered = filtered.filter(
				(issue: LinearIssue) => issue.assignee?.id === filters.assigneeId,
			);
		}
		if (filters.delegateId) {
			filtered = filtered.filter(
				(issue: LinearIssue) => issue.delegate?.id === filters.delegateId,
			);
		}
		if (filters.project) {
			switch (filters.project.kind) {
				case "id": {
					const id = filters.project.id;
					filtered = filtered.filter(
						(issue: LinearIssue) => issue.project?.id === id,
					);
					break;
				}
				case "none":
					filtered = filtered.filter((issue: LinearIssue) => !issue.project);
					break;
				default:
					return filters.project satisfies never;
			}
		}
		if (filters.status && filters.status.length > 0) {
			filtered = filtered.filter((issue: LinearIssue) =>
				(filters.status as string[]).includes(issue.state?.name ?? ""),
			);
		}
		if (filters.labelNames && filters.labelNames.length > 0) {
			const lowerNames = (filters.labelNames as string[]).map((n) =>
				n.toLowerCase(),
			);
			filtered = filtered.filter((issue: LinearIssue) => {
				const issueLabels = issue.labels.map((l) => l.name.toLowerCase());
				return lowerNames.every((name) => issueLabels.includes(name));
			});
		}
		if (filters.priority && filters.priority.length > 0) {
			filtered = filtered.filter((issue: LinearIssue) =>
				(filters.priority as LinearPriority[]).includes(issue.priority),
			);
		}
		return filtered;
	}

	private buildSearchFilter(filters: {
		teamId?: string;
		assigneeId?: string;
		delegateId?: string;
		project?: SearchIssueProject;
		status?: string[];
		labelNames?: string[];
		priority?: LinearPriority[];
	}): Record<string, unknown> {
		const filter: Record<string, unknown> = {};
		if (filters.teamId) {
			filter.team = { id: { eq: filters.teamId } };
		}
		if (filters.assigneeId) {
			filter.assignee = { id: { eq: filters.assigneeId } };
		}
		if (filters.delegateId) {
			filter.delegate = { id: { eq: filters.delegateId } };
		}
		if (filters.project) {
			switch (filters.project.kind) {
				case "id":
					filter.project = { id: { eq: filters.project.id } };
					break;
				case "none":
					filter.project = { null: true };
					break;
				default:
					return filters.project satisfies never;
			}
		}
		if (filters.status && filters.status.length > 0) {
			filter.state = { name: { in: filters.status } };
		}
		if (filters.labelNames && filters.labelNames.length > 0) {
			if (filters.labelNames.length === 1) {
				filter.labels = {
					some: { name: { eqIgnoreCase: filters.labelNames[0] } },
				};
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
		resolveResult: BatchResolveResult,
	): string | undefined {
		if (!assigneeId || isUuid(assigneeId) || !assigneeId.includes("@")) {
			return assigneeId;
		}
		const userNodes = resolveResult.users?.nodes;
		if (!userNodes?.length) {
			throw notFoundError("User", assigneeId);
		}
		return userNodes[0].id;
	}

	private async resolveDelegateId(
		delegateId: string | undefined,
		resolveResult: BatchResolveResult,
	): Promise<string | undefined> {
		if (!delegateId || isUuid(delegateId)) {
			return delegateId;
		}
		if (!delegateId.includes("@")) {
			return this.linearService.resolveUserId(delegateId);
		}
		const userNodes = resolveResult.delegates?.nodes;
		if (!userNodes?.length) {
			throw notFoundError("Delegate", delegateId);
		}
		return userNodes[0].id;
	}

	private async resolveUpdateContext(args: UpdateIssueArgs): Promise<{
		resolvedIssueId: string;
		issueTeamId: string | undefined;
		currentIssueLabels: string[];
		resolveResult: BatchResolveResult;
	}> {
		let resolvedIssueId = args.id;
		let issueTeamId: string | undefined;
		let currentIssueLabels: string[] = [];
		const resolveVariables: Record<string, unknown> = {};

		if (!isUuid(args.id)) {
			const { teamKey, issueNumber } = parseIssueIdentifier(args.id);
			resolveVariables.teamKey = teamKey;
			resolveVariables.issueNumber = issueNumber;
		}

		if (args.labelIds && args.labelIds.length > 0) {
			const nonUuidLabels = args.labelIds.filter((id) => !isUuid(id));
			if (nonUuidLabels.length > 0) {
				resolveVariables.__labelNames = nonUuidLabels;
			}
		}

		if (args.projectId) {
			// A UUID resolves by `id` so the project's milestones are still
			// fetched for `--project-milestone` name resolution; a name
			// resolves by `name`. The `has*` flags gate the `@include`d
			// blocks so an unset input never triggers a null no-op filter.
			if (isUuid(args.projectId)) {
				resolveVariables.projectId = args.projectId;
				resolveVariables.hasProjectId = true;
			} else {
				resolveVariables.projectName = args.projectId;
				resolveVariables.hasProjectName = true;
			}
		}

		if (args.milestoneId && !isUuid(args.milestoneId)) {
			resolveVariables.milestoneName = args.milestoneId;
			resolveVariables.hasMilestoneName = true;
		}

		const { __labelNames, ...updateQueryVars } = resolveVariables;
		const batchPromise =
			this.graphQLService.rawRequest<BatchResolveForUpdateResponse>(
				BATCH_RESOLVE_FOR_UPDATE_QUERY,
				updateQueryVars,
			);
		let resolveResult: BatchResolveResult;
		if (__labelNames) {
			const labelQuery = buildResolveLabelsByNameQuery(
				__labelNames as string[],
			);
			const [batch, labels] = await Promise.all([
				batchPromise,
				this.graphQLService.rawRequest<ResolveLabelsByNameResponse>(
					labelQuery.query,
					labelQuery.variables,
				),
			]);
			resolveResult = {
				...this.foldUpdateBatchResult(batch),
				labels: labels.labels,
			};
		} else {
			resolveResult = this.foldUpdateBatchResult(await batchPromise);
		}

		if (!isUuid(args.id)) {
			const resolvedIssueNodes = resolveResult.issues?.nodes ?? [];
			if (!resolvedIssueNodes.length) {
				throw notFoundError("Issue", args.id);
			}
			resolvedIssueId = resolvedIssueNodes[0].id;
			issueTeamId = resolvedIssueNodes[0].team?.id;
			currentIssueLabels = resolvedIssueNodes[0].labels.nodes.map((l) => l.id);
		}

		return { resolvedIssueId, issueTeamId, currentIssueLabels, resolveResult };
	}

	private async resolveCycleIdForUpdate(
		args: UpdateIssueArgs,
		resolveResult: BatchResolveResult,
		resolvedIssueId: string,
	): Promise<string | null | undefined> {
		if (args.cycleId === undefined || args.cycleId === null) {
			return args.cycleId;
		}
		if (isUuid(args.cycleId)) {
			return args.cycleId;
		}
		let teamIdForCycle = resolveResult.issues?.nodes?.[0]?.team?.id;
		if (!teamIdForCycle && resolvedIssueId && isUuid(resolvedIssueId)) {
			teamIdForCycle = await this.fetchIssueTeamId(resolvedIssueId);
		}
		return this.linearService.resolveCycleId(args.cycleId, teamIdForCycle);
	}

	private async resolveStatusIdForUpdate(
		args: UpdateIssueArgs,
		resolvedIssueId: string,
	): Promise<string | undefined> {
		if (!args.statusId || isUuid(args.statusId)) {
			return args.statusId;
		}
		let teamId: string | undefined;
		if (resolvedIssueId && isUuid(resolvedIssueId)) {
			teamId = await this.fetchIssueTeamId(resolvedIssueId);
		}
		return this.linearService.resolveStatusId(args.statusId, teamId);
	}

	/**
	 * Pre-resolve URL/slug-id project inputs to UUIDs before the batch
	 * resolver runs. Plain names and UUIDs pass through unchanged; only
	 * URL/slug-id forms incur a separate slug→UUID round-trip (the batch
	 * query's `name eqIgnoreCase` filter can't match a URL string).
	 */
	private async withNormalizedProjectId<T extends { projectId?: string }>(
		args: T,
	): Promise<T> {
		if (!args.projectId) {
			return args;
		}
		const normalized = await this.linearService.normalizeProjectInput(
			args.projectId,
		);
		if (normalized === args.projectId) {
			return args;
		}
		return { ...args, projectId: normalized };
	}

	private buildCreateResolveVariables(
		args: CreateIssueArgs,
	): Record<string, unknown> {
		const resolveVariables: Record<string, unknown> = {};
		if (args.teamId && !isUuid(args.teamId)) {
			Object.assign(
				resolveVariables,
				this.buildResolveVariablesForTeam(args.teamId),
			);
		}
		if (args.projectId) {
			// A UUID is resolved by `id` so the project's team associations
			// are still fetched for team-project validation; a name is
			// resolved by `name`. The `has*` flags gate the `@include`d
			// blocks so an unset input never triggers a null no-op filter.
			if (isUuid(args.projectId)) {
				resolveVariables.projectId = args.projectId;
				resolveVariables.hasProjectId = true;
			} else {
				resolveVariables.projectName = args.projectId;
				resolveVariables.hasProjectName = true;
			}
		}
		if (args.milestoneId && !isUuid(args.milestoneId)) {
			resolveVariables.milestoneName = args.milestoneId;
			resolveVariables.hasMilestoneName = true;
		}
		if (args.labelIds && args.labelIds.length > 0) {
			const nonUuidLabels = args.labelIds.filter((id) => !isUuid(id));
			if (nonUuidLabels.length > 0) {
				resolveVariables.__labelNames = nonUuidLabels;
			}
		}
		if (args.parentId && !isUuid(args.parentId)) {
			const parentParsed = tryParseIssueIdentifier(args.parentId);
			if (parentParsed) {
				resolveVariables.parentTeamKey = parentParsed.teamKey;
				resolveVariables.parentIssueNumber = parentParsed.issueNumber;
			}
		}
		return resolveVariables;
	}

	private resolveParentId(
		parentId: string | undefined,
		resolveResult: BatchResolveResult,
	): string | undefined {
		if (!parentId || isUuid(parentId)) {
			return parentId;
		}
		const parentNodes = resolveResult.parentIssues?.nodes;
		if (!parentNodes?.length) {
			throw notFoundError("Parent issue", parentId);
		}
		return parentNodes[0].id;
	}

	transformIssueData(issue: IssueNode | IssueWithCommentsNode): LinearIssue {
		// `labels`/`children`/`comments` are connection fields that the
		// fragment always selects, so production responses populate them.
		// Test mocks pass partial objects, so read defensively to keep
		// those test fixtures small.
		return {
			...this.transformIssueCoreFields(issue),
			...this.transformIssueRelations(issue),
			summary: issue.summary ? extractSummaryText(issue.summary) : undefined,
			priority: issue.priority,
			estimate: issue.estimate ?? undefined,
			dueDate: issue.dueDate ?? undefined,
			labels: (issue.labels?.nodes ?? []).map((label) => ({
				id: label.id,
				name: label.name,
			})),
			...this.transformIssueHierarchy(issue),
			comments:
				"comments" in issue && issue.comments
					? this.transformIssueComments(issue)
					: [],
			createdAt: toISOStringOrNow(issue.createdAt),
			updatedAt: toISOStringOrNow(issue.updatedAt),
		};
	}

	private transformIssueCoreFields(
		issue: IssueNode,
	): Pick<
		LinearIssue,
		| "id"
		| "identifier"
		| "url"
		| "title"
		| "description"
		| "branchName"
		| "embeds"
	> {
		return {
			id: issue.id,
			identifier: issue.identifier,
			url: issue.url,
			title: issue.title,
			description: issue.description ?? undefined,
			branchName: issue.branchName || undefined,
			embeds: issue.description ? extractEmbeds(issue.description) : undefined,
		};
	}

	private transformIssueRelations(
		issue: IssueNode,
	): Pick<
		LinearIssue,
		| "state"
		| "assignee"
		| "delegate"
		| "team"
		| "project"
		| "cycle"
		| "projectMilestone"
	> {
		return {
			state: issue.state
				? { id: issue.state.id, name: issue.state.name }
				: undefined,
			assignee: issue.assignee
				? {
						id: issue.assignee.id,
						name: resolveUserDisplayName(
							issue.assignee.id,
							issue.assignee.name,
						),
						url: issue.assignee.url ?? undefined,
					}
				: undefined,
			delegate: issue.delegate
				? {
						id: issue.delegate.id,
						name: resolveUserDisplayName(
							issue.delegate.id,
							issue.delegate.name,
						),
						url: issue.delegate.url ?? undefined,
					}
				: undefined,
			team: issue.team
				? {
						id: issue.team.id,
						key: issue.team.key,
						name: issue.team.name,
					}
				: undefined,
			project: issue.project
				? { id: issue.project.id, name: issue.project.name }
				: undefined,
			cycle: issue.cycle
				? {
						id: issue.cycle.id,
						name: issue.cycle.name ?? "",
						number: issue.cycle.number,
					}
				: undefined,
			projectMilestone: issue.projectMilestone
				? {
						id: issue.projectMilestone.id,
						name: issue.projectMilestone.name,
						targetDate: issue.projectMilestone.targetDate ?? undefined,
					}
				: undefined,
		};
	}

	private transformIssueHierarchy(
		issue: IssueNode,
	): Pick<LinearIssue, "parentIssue" | "subIssues"> {
		// children is a connection field — always present in production
		// responses. Defensive read keeps test mocks small.
		const childNodes = issue.children?.nodes ?? [];
		return {
			parentIssue: issue.parent
				? {
						id: issue.parent.id,
						identifier: issue.parent.identifier,
						title: issue.parent.title,
					}
				: undefined,
			subIssues:
				childNodes.length > 0
					? childNodes.map((child) => ({
							id: child.id,
							identifier: child.identifier,
							title: child.title,
						}))
					: undefined,
		};
	}

	private transformIssueComments(
		issue: IssueWithCommentsNode,
	): LinearIssue["comments"] {
		return issue.comments.nodes.map((comment) => ({
			id: comment.id,
			body: comment.body,
			embeds: extractEmbeds(comment.body),
			user: comment.user
				? {
						id: comment.user.id,
						name: resolveUserDisplayName(comment.user.id, comment.user.name),
						url: comment.user.url ?? undefined,
					}
				: undefined,
			createdAt: toISOStringOrNow(comment.createdAt),
			updatedAt: toISOStringOrNow(comment.updatedAt),
		}));
	}
}
