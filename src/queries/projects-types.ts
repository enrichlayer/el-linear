/**
 * Typed response shapes for the queries in `./projects.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 */

export interface ProjectTeamRef {
	id: string;
	key: string;
	name: string;
}

export interface ProjectBaseNode {
	id: string;
	name: string;
	teams: { nodes: ProjectTeamRef[] };
}

/**
 * Mirrors the project selection set used by `SEARCH_PROJECTS_BY_NAME_QUERY`
 * and `CREATE_PROJECT_MUTATION` — base fields + state.
 */
export interface ProjectWithStateNode extends ProjectBaseNode {
	state: string;
}

export interface ProjectIssueRef {
	id: string;
	identifier: string;
	title: string;
}

export interface ProjectWithIssuesNode extends ProjectBaseNode {
	issues: { nodes: ProjectIssueRef[] };
}

export interface ProjectByIdResponse {
	project: ProjectBaseNode | null;
}

export interface GetProjectResponse {
	projects: { nodes: ProjectBaseNode[] };
}

export interface GetProjectTeamIssuesResponse {
	project: ProjectWithIssuesNode | null;
}

export interface SearchProjectsByNameResponse {
	projects: { nodes: ProjectWithStateNode[] };
}

export interface CreateProjectResponse {
	projectCreate: {
		success: boolean;
		project: ProjectWithStateNode | null;
	};
}

export interface UpdateProjectResponse {
	projectUpdate: {
		success: boolean;
		project: ProjectBaseNode | null;
	};
}

export interface ProjectArchiveEntity {
	id: string;
}

export interface ProjectArchivePayload {
	success: boolean;
	lastSyncId: number;
	entity: ProjectArchiveEntity | null;
}

export interface ArchiveProjectResponse {
	projectArchive: ProjectArchivePayload;
}

export interface DeleteProjectResponse {
	projectDelete: ProjectArchivePayload;
}
