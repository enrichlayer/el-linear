export interface CatalogTeamRef {
	id: string;
	key: string;
	name: string;
}

export interface CatalogProjectNode {
	id: string;
	name: string;
	description: string | null;
	state: string;
	progress: number;
	targetDate: string | null;
	createdAt: string;
	updatedAt: string;
	lead: { id: string; name: string } | null;
	teams: { nodes: CatalogTeamRef[] };
}

export interface CatalogPageInfo {
	hasNextPage: boolean;
	endCursor: string | null;
}

export interface ProjectCatalogConnection {
	nodes: CatalogProjectNode[];
	pageInfo: CatalogPageInfo;
}

export interface GetProjectsCatalogResponse {
	projects: ProjectCatalogConnection | null;
	team: { projects: ProjectCatalogConnection } | null;
}

export interface CatalogLabelNode {
	id: string;
	name: string;
	color: string;
	isGroup: boolean;
	parent: { id: string; name: string } | null;
	team: CatalogTeamRef | null;
}

export interface GetLabelsCatalogResponse {
	issueLabels: { nodes: CatalogLabelNode[] };
}

export interface CatalogCycleNode {
	id: string;
	name: string | null;
	number: number;
	startsAt: string | null;
	endsAt: string | null;
	isActive: boolean;
	isPrevious: boolean;
	isNext: boolean;
	progress: number;
	issueCountHistory: number[] | null;
	team: CatalogTeamRef | null;
}

export interface GetCyclesCatalogResponse {
	cycles: { nodes: CatalogCycleNode[] };
}

export interface CatalogIssueNode {
	id: string;
	identifier: string;
	url: string;
	title: string;
	description: string | null;
	priority: number;
	estimate: number | null;
	createdAt: string;
	updatedAt: string;
	state: { id: string; name: string } | null;
	assignee: { id: string; name: string } | null;
	team: CatalogTeamRef | null;
	project: { id: string; name: string } | null;
	labels: { nodes: Array<{ id: string; name: string }> };
}

export interface GetCycleDetailResponse {
	cycle:
		| (CatalogCycleNode & {
				issues: { nodes: CatalogIssueNode[] };
		  })
		| null;
}

export interface ResolveProjectCatalogResponse {
	projects: {
		nodes: Array<{
			id: string;
			name: string;
			teams: { nodes: CatalogTeamRef[] };
		}>;
	} | null;
	team: {
		projects: {
			nodes: Array<{
				id: string;
				name: string;
				teams: { nodes: CatalogTeamRef[] };
			}>;
		};
	} | null;
}
