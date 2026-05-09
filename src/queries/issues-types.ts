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

/** A reference to a related entity — id + display fields. */
export interface IdNameRef {
	id: string;
	name: string;
}

export interface IdKeyNameRef {
	id: string;
	key: string;
	name: string;
}

export interface IdIdentifierTitleRef {
	id: string;
	identifier: string;
	title: string;
}

export interface AssigneeNode {
	id: string;
	name: string;
	url?: string;
}

export interface CommentNode {
	id: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	user: AssigneeNode | null;
}

export interface CycleNode {
	id: string;
	name: string | null;
	number: number;
}

export interface ProjectMilestoneNode {
	id: string;
	name: string;
	targetDate: string | null;
}

export interface IssueSummary {
	content: unknown;
	generationStatus: "completed" | "pending" | "failed" | string;
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
	priority: number;
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
	comments: { nodes: CommentNode[] };
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

/**
 * Response shape for `FILTERED_SEARCH_ISSUES_QUERY`. Same shape as
 * `GetIssuesResponse` (both return `issues.nodes`) but kept as a
 * named alias so the call site documents intent.
 */
export type FilteredSearchIssuesResponse = GetIssuesResponse;

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
	priority: number | null;
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
