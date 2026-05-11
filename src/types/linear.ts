/**
 * Core entity types returned by el-linear service methods.
 * These represent the public API surface — GraphQL responses are
 * transformed into these shapes at the service boundary.
 */

// -- Shared reference types (used as nested objects) --

interface TeamRef {
	id: string;
	key: string;
	name: string;
}

interface UserRef {
	id: string;
	name: string;
	url?: string;
}

interface StateRef {
	id: string;
	name: string;
}

interface ProjectRef {
	id: string;
	name: string;
}

interface LabelRef {
	id: string;
	name: string;
}

interface CycleRef {
	id: string;
	name: string;
	number: number;
}

interface MilestoneRef {
	id: string;
	name: string;
	targetDate?: string;
}

interface IssueRef {
	id: string;
	identifier: string;
	title: string;
}

// -- Full entity types --

export interface LinearTeam {
	description: string | null;
	id: string;
	key: string;
	name: string;
}

export interface LinearUser {
	active: boolean;
	displayName: string;
	email: string;
	id: string;
	name: string;
}

export interface LinearLabel {
	color: string;
	group?: LabelRef;
	id: string;
	name: string;
	scope: "team" | "workspace";
	team?: TeamRef;
}

export interface LinearProject {
	createdAt: string;
	description?: string;
	id: string;
	lead?: UserRef;
	name: string;
	progress: number;
	state: string;
	targetDate?: string;
	teams: TeamRef[];
	updatedAt: string;
}

export interface LinearComment {
	body: string;
	createdAt: string;
	embeds?: import("../utils/embed-parser.js").Embed[];
	id: string;
	updatedAt: string;
	user?: UserRef;
}

export interface LinearIssue {
	assignee?: UserRef;
	branchName?: string;
	comments?: LinearComment[];
	createdAt: string;
	cycle?: CycleRef;
	description?: string;
	dueDate?: string;
	embeds?: import("../utils/embed-parser.js").Embed[];
	estimate?: number;
	id: string;
	identifier: string;
	labels: LabelRef[];
	parentIssue?: IssueRef;
	priority: number;
	project?: ProjectRef;
	projectMilestone?: MilestoneRef;
	state?: StateRef;
	subIssues?: IssueRef[];
	summary?: string;
	team?: TeamRef;
	title: string;
	updatedAt: string;
	url: string;
}

export interface LinearCycleSummary {
	endsAt?: string;
	id: string;
	isActive: boolean;
	isNext?: boolean;
	isPrevious?: boolean;
	issueCountHistory?: number[];
	name?: string;
	number: number;
	progress: number;
	startsAt?: string;
	team?: TeamRef;
}

export interface LinearCycleDetail extends LinearCycleSummary {
	issues: LinearIssue[];
}

export interface LinearDocument {
	color?: string;
	content?: string;
	createdAt?: string;
	creator?: UserRef;
	icon?: string;
	id: string;
	issue?: IssueRef;
	project?: ProjectRef;
	slugId?: string;
	title: string;
	updatedAt?: string;
	url?: string;
}

export interface LinearAttachment {
	createdAt?: string;
	id: string;
	title?: string;
	updatedAt?: string;
	url: string;
}

export interface LinearIssueRelation {
	id: string;
	issue: IssueRef;
	relatedIssue: IssueRef;
	type: string;
}

export interface LinearRelease {
	canceledAt?: string;
	completedAt?: string;
	createdAt: string;
	description?: string;
	documents?: { id: string; title: string; slugId: string }[];
	id: string;
	name: string;
	pipeline?: { id: string; name: string };
	stage?: { id: string; name: string; type: string };
	startDate?: string;
	startedAt?: string;
	targetDate?: string;
	updatedAt: string;
	url?: string;
	version?: string;
}

export interface IssueStateSpan {
	endedAt?: string;
	startedAt: string;
	state: StateRef & { type: string };
}

// -- File operation result (discriminated union) --

export type FileDownloadResult =
	| { success: true; filePath: string }
	| { success: false; error: string; statusCode?: number };

export type FileUploadResult =
	| { success: true; assetUrl: string; filename: string }
	| { success: false; error: string; statusCode?: number };

// -- GraphQL variables --

export type GraphQLVariables = Record<string, unknown>;

/** Primitive values that appear in GraphQL JSON responses. */
type GraphQLPrimitive = string | number | boolean | null | undefined;

/** Union of all value types in a raw GraphQL response. */
type GraphQLValue =
	| GraphQLPrimitive
	| GraphQLResponseData
	| GraphQLResponseData[];

/**
 * Recursive index type for raw GraphQL responses.
 *
 * **Prefer per-query response types** (see `src/queries/*-types.ts`)
 * over `GraphQLResponseData` for any new consumer. ALL-937 swept the
 * old service/command consumers; this type is kept as the fallback
 * for the few generic transports (e.g. `graphql-service.rawRequest`'s
 * default generic). Don't reach for `as GraphQLResponseData` to skip
 * a typed shape — the per-query types catch query/consumer drift at
 * compile time. This type cannot.
 */
export interface GraphQLResponseData {
	[key: string]: GraphQLValue;
}
