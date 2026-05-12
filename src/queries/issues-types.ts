/**
 * Typed response shapes for the GraphQL queries in `./issues.ts`.
 *
 * Pre-fix, every consumer used `GraphQLResponseData` (a recursive
 * `Record<string, unknown>`) and re-cast every field with `as
 * string` / `as GraphQLResponseData`. A renamed Linear field would
 * silently produce `undefined` at runtime; transformers had no
 * compile-time check that they were reading the fields the queries
 * actually requested.
 *
 * These interfaces mirror the shape of `COMPLETE_ISSUE_FRAGMENT` /
 * `COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT` (defined in
 * `./common.ts`) so the transformer can consume a typed node and
 * the compiler catches drift between query and consumer.
 *
 * Pattern for adding new types: define a `Foo` node interface +
 * a `GetFooResponse` (or list-shape) wrapper. Co-locate them in
 * this file or a sibling `*-types.ts` so they live next to the
 * query string.
 *
 * Refs ALL-937.
 */

import type { LinearPriority } from "../types/linear.js";

/** A reference to a related entity — id + display fields. */
interface IdNameRef {
	id: string;
	name: string;
}

interface IdKeyNameRef {
	id: string;
	key: string;
	name: string;
}

interface IdIdentifierTitleRef {
	id: string;
	identifier: string;
	title: string;
}

interface AssigneeNode {
	id: string;
	name: string;
	url?: string;
}

/**
 * Comment shape as embedded inside `COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT`
 * (i.e. comments fetched as part of an issue query). Distinct from
 * `comments-types.ts:CommentResourceNode`, which is the shape returned by
 * the standalone comment queries (`LIST_COMMENTS_QUERY`,
 * `CREATE_COMMENT_MUTATION`, `UPDATE_COMMENT_MUTATION`). The two have
 * incompatible `user` shapes — this one allows `null` and uses the
 * issue-page \"assignee\"-style fields, while the standalone resource
 * shape always populates `user` and includes the comment-author-only
 * `CommentUserRef` fields (DEV-4068 T2).
 */
export interface IssueCommentNode {
	id: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	user: AssigneeNode | null;
}

interface CycleNode {
	id: string;
	name: string | null;
	number: number;
}

interface ProjectMilestoneNode {
	id: string;
	name: string;
	targetDate: string | null;
}

/**
 * Linear's documented generation states for issue summaries. If Linear
 * adds a new state in the future the runtime API would deserialize the
 * new string verbatim — TypeScript wouldn't catch the divergence, but
 * the typical `=== "completed"` check keeps working safely. Widen the
 * union here when Linear documents a new state.
 */
type IssueSummaryGenerationStatus = "completed" | "pending" | "failed";

interface IssueSummary {
	content: unknown;
	generationStatus: IssueSummaryGenerationStatus;
}

/**
 * Mirrors `COMPLETE_ISSUE_FRAGMENT` from `src/queries/common.ts`.
 * The transformer in `graphql-issues-service.ts` reads these
 * fields. Keep the shapes in lock-step — if you add a field to
 * the fragment, add it here.
 */
export interface IssueNode {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	summary: IssueSummary | null;
	branchName: string;
	priority: LinearPriority;
	estimate: number | null;
	dueDate: string | null;
	url: string;
	createdAt: string;
	updatedAt: string;
	state: IdNameRef | null;
	assignee: AssigneeNode | null;
	team: IdKeyNameRef | null;
	project: IdNameRef | null;
	labels: { nodes: IdNameRef[] };
	cycle: CycleNode | null;
	projectMilestone: ProjectMilestoneNode | null;
	parent: IdIdentifierTitleRef | null;
	children: { nodes: IdIdentifierTitleRef[] };
}

/**
 * Mirrors `COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT` — same as
 * `IssueNode` but with the comments connection materialized.
 */
export interface IssueWithCommentsNode extends IssueNode {
	comments: { nodes: IssueCommentNode[] };
}

/** Response shape for `GET_ISSUE_BY_ID_QUERY`. */
export interface GetIssueByIdResponse {
	issue: IssueWithCommentsNode | null;
}

/** Response shape for `GET_ISSUE_BY_IDENTIFIER_QUERY`. */
export interface GetIssueByIdentifierResponse {
	issues: { nodes: IssueWithCommentsNode[] };
}

/** Response shape for `GET_ISSUES_QUERY`. */
export interface GetIssuesResponse {
	issues: { nodes: IssueNode[] };
}

/** Response shape for `SEARCH_ISSUES_QUERY` (full-text). */
export interface SearchIssuesResponse {
	searchIssues: { nodes: IssueNode[] };
}

/** Response shape for `CREATE_ISSUE_MUTATION`. */
export interface CreateIssueResponse {
	issueCreate: {
		success: boolean;
		issue: IssueNode | null;
	};
}

/** Response shape for `UPDATE_ISSUE_MUTATION`. */
export interface UpdateIssueResponse {
	issueUpdate: {
		success: boolean;
		issue: IssueNode | null;
	};
}

export interface IssueArchiveEntity {
	id: string;
}

interface IssueArchivePayload {
	success: boolean;
	lastSyncId: number;
	entity: IssueArchiveEntity | null;
}

/** Response shape for `ARCHIVE_ISSUE_MUTATION`. */
export interface ArchiveIssueResponse {
	issueArchive: IssueArchivePayload;
}

/** Response shape for `DELETE_ISSUE_MUTATION`. */
export interface DeleteIssueResponse {
	issueDelete: IssueArchivePayload;
}

/** Response shape for `GET_ISSUE_TEAM_QUERY`. */
export interface GetIssueTeamResponse {
	issue: {
		team: { id: string } | null;
	} | null;
}

/**
 * Issue summary returned by `GET_ISSUE_RELATIONS_QUERY` on the
 * `relatedIssue` / `issue` peer of each relation. Smaller than
 * `IssueNode` — just enough to display a sidebar entry.
 */
export interface RelationPeerNode {
	id: string;
	identifier: string;
	title: string;
	state: { id: string; name: string } | null;
	priority: LinearPriority | null;
	assignee: { id: string; name: string } | null;
	team: { id: string; key: string; name: string } | null;
}

export interface RelationOutgoingNode {
	id: string;
	type: string;
	relatedIssue: RelationPeerNode | null;
}

export interface RelationIncomingNode {
	id: string;
	type: string;
	issue: RelationPeerNode | null;
}

// ── BATCH_RESOLVE_FOR_{CREATE,SEARCH,UPDATE} response shapes ────
//
// The three batch-resolve queries select overlapping but distinct
// subsets of the same entities (teams, projects, milestones, users,
// issues, labels). The service merges the chosen batch query result
// with a separate label-resolution query result into a single
// `resolveResult` blob threaded through ~10 helper methods.
//
// Rather than three rigid types + force-casts at the merge points,
// we model a single `BatchResolveResult` whose fields are all
// optional — each consumer reads only the fields its query selected,
// missing fields show up as `undefined` (the existing helpers
// already handle that path with `?.nodes ?? []`).
//
// The per-query response wrappers below are typed exactly to what
// each query selects, so the rawRequest call sites stay strict.

export interface BatchResolveProjectMilestoneRef {
	id: string;
	name: string;
}

interface BatchResolveProjectNode {
	id: string;
	name: string;
	/** Present on `BATCH_RESOLVE_FOR_CREATE_QUERY`. */
	teams?: { nodes: { id: string; key: string }[] };
	/** Present on `BATCH_RESOLVE_FOR_CREATE_QUERY` and `BATCH_RESOLVE_FOR_UPDATE_QUERY`. */
	projectMilestones?: { nodes: BatchResolveProjectMilestoneRef[] };
}

export interface BatchResolveLabelNode {
	id: string;
	name: string;
	isGroup: boolean;
	team: { id: string } | null;
}

interface BatchResolveIssueForUpdate {
	id: string;
	identifier: string;
	team: { id: string; key: string } | null;
	labels: { nodes: { id: string; name: string }[] };
	project: {
		id: string;
		projectMilestones: { nodes: BatchResolveProjectMilestoneRef[] };
	} | null;
}

export interface BatchResolveForCreateResponse {
	teams: { nodes: { id: string; key: string; name: string }[] };
	projects: { nodes: BatchResolveProjectNode[] };
	milestones: { nodes: BatchResolveProjectMilestoneRef[] };
	parentIssues: { nodes: { id: string; identifier: string }[] };
}

export interface BatchResolveForSearchResponse {
	teams: { nodes: { id: string; key: string; name: string }[] };
	projects: { nodes: BatchResolveProjectNode[] };
	users: { nodes: { id: string; name: string; email: string }[] };
}

export interface BatchResolveForUpdateResponse {
	projects: { nodes: BatchResolveProjectNode[] };
	milestones: { nodes: BatchResolveProjectMilestoneRef[] };
	issues: { nodes: BatchResolveIssueForUpdate[] };
}

export interface ResolveLabelsByNameResponse {
	labels: { nodes: BatchResolveLabelNode[] };
}

/**
 * Merged blob threaded through the field-resolution helpers. All
 * fields are optional because the helpers don't know which batch
 * query produced the result — they read only what they need.
 */
export interface BatchResolveResult {
	teams?: { nodes: { id: string; key: string; name: string }[] };
	projects?: { nodes: BatchResolveProjectNode[] };
	milestones?: { nodes: BatchResolveProjectMilestoneRef[] };
	parentIssues?: { nodes: { id: string; identifier: string }[] };
	users?: { nodes: { id: string; name: string; email: string }[] };
	issues?: { nodes: BatchResolveIssueForUpdate[] };
	labels?: { nodes: BatchResolveLabelNode[] };
}

/** Response shape for `GET_ISSUE_RELATIONS_QUERY`. */
export interface GetIssueRelationsResponse {
	issue: {
		id: string;
		identifier: string;
		title: string;
		description: string | null;
		relations: { nodes: RelationOutgoingNode[] };
		inverseRelations: { nodes: RelationIncomingNode[] };
	} | null;
}

/**
 * Response shape for `ISSUE_RELATION_CREATE_MUTATION`. The relation
 * carries both `issue` and `relatedIssue` peers because the caller
 * decides which side to display based on `reverse`.
 */
export interface IssueRelationCreateResponse {
	issueRelationCreate: {
		success: boolean;
		issueRelation: {
			id: string;
			type: string;
			issue: { id: string; identifier: string; title: string };
			relatedIssue: { id: string; identifier: string; title: string };
		} | null;
	};
}

/** Response shape for `SCAN_ISSUES_QUERY`. */
export interface ScanIssuesResponse {
	issues: {
		nodes: { id: string; identifier: string; description: string | null }[];
	};
}

interface IssueStateSpanNode {
	state: { id: string; name: string; type: string };
	startedAt: string;
	endedAt: string | null;
}

/** Response shape for `GET_ISSUE_STATE_HISTORY_QUERY`. */
export interface GetIssueStateHistoryResponse {
	issue: {
		id: string;
		identifier: string;
		title: string;
		stateHistory: { nodes: IssueStateSpanNode[] };
	} | null;
}
