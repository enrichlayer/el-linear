/**
 * Typed response shapes for the queries in `./releases.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 */

interface ReleaseStageRef {
	id: string;
	name: string;
	type: string;
	color: string | null;
}

interface ReleasePipelineRef {
	id: string;
	name: string;
}

interface ReleaseDocumentRef {
	id: string;
	title: string;
	slugId: string;
}

/** Mirrors the release selection set used by `GET_RELEASES_QUERY`. */
export interface ReleaseListNode {
	id: string;
	name: string;
	description: string | null;
	version: string | null;
	url: string | null;
	startDate: string | null;
	targetDate: string | null;
	startedAt: string | null;
	completedAt: string | null;
	canceledAt: string | null;
	stage: ReleaseStageRef | null;
	pipeline: ReleasePipelineRef | null;
	createdAt: string;
	updatedAt: string;
}

/** Mirrors `GET_RELEASE_BY_ID_QUERY` — adds `documents`. */
export interface ReleaseDetailNode extends ReleaseListNode {
	documents: { nodes: ReleaseDocumentRef[] };
}

/**
 * Mirrors the release selection set on `CREATE_RELEASE_MUTATION` —
 * a subset of `ReleaseListNode` (no startDate/targetDate/lifecycle
 * timestamps; no documents).
 */
export interface CreatedReleaseNode {
	id: string;
	name: string;
	description: string | null;
	version: string | null;
	url: string | null;
	stage: ReleaseStageRef | null;
	pipeline: ReleasePipelineRef | null;
	createdAt: string;
	updatedAt: string;
}

interface ReleasePipelineNode {
	id: string;
	name: string;
	stages: { nodes: ReleaseStageRef[] };
}

export interface GetReleasesResponse {
	releases: { nodes: ReleaseListNode[] };
}

export interface GetReleaseByIdResponse {
	release: ReleaseDetailNode | null;
}

export interface CreateReleaseResponse {
	releaseCreate: {
		success: boolean;
		release: CreatedReleaseNode | null;
	};
}

export interface GetReleasePipelinesResponse {
	releasePipelines: { nodes: ReleasePipelineNode[] };
}
