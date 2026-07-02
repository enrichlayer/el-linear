/**
 * Typed response shapes for the queries in `./project-updates.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 *
 * All three queries (create / list / read) select the same
 * `PROJECT_UPDATE_FRAGMENT`, so one node shape covers every consumer.
 */

export type ProjectUpdateHealth = "onTrack" | "atRisk" | "offTrack";

interface ProjectUpdateProjectRef {
	id: string;
	name: string;
}

interface ProjectUpdateUserRef {
	id: string;
	name: string;
	displayName: string | null;
}

/**
 * Mirrors `PROJECT_UPDATE_FRAGMENT` — the full selection set shared by the
 * create mutation, the project-scoped list, and the by-id read.
 */
export interface ProjectUpdateNode {
	id: string;
	body: string | null;
	health: ProjectUpdateHealth | null;
	url: string | null;
	slugId: string | null;
	createdAt: string;
	updatedAt: string;
	editedAt: string | null;
	user: ProjectUpdateUserRef | null;
	project: ProjectUpdateProjectRef | null;
}

export interface CreateProjectUpdateResponse {
	projectUpdateCreate: {
		success: boolean;
		projectUpdate: ProjectUpdateNode | null;
	};
}

export interface ListProjectUpdatesResponse {
	project: {
		id: string;
		name: string;
		projectUpdates: { nodes: ProjectUpdateNode[] };
	} | null;
}

export interface GetProjectUpdateByIdResponse {
	projectUpdate: ProjectUpdateNode | null;
}
