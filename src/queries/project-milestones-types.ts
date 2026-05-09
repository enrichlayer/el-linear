/**
 * Typed response shapes for the queries in `./project-milestones.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 *
 * The selection sets vary across queries — some include `description`
 * + `createdAt`, others only the lookup-relevant fields. Modelled as
 * a base `MilestoneBaseRef` with extension shapes per query so each
 * consumer reads only what was actually selected.
 */

import type { IssueNode } from "./issues-types.js";

export interface MilestoneProjectRef {
	id: string;
	name: string;
}

/**
 * Mirrors the milestone selection set in `LIST_PROJECT_MILESTONES_QUERY`
 * — full milestone fields without the project-back-reference.
 */
export interface MilestoneListNode {
	id: string;
	name: string;
	description: string | null;
	targetDate: string | null;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
}

/**
 * Mirrors the milestone selection set in `GET_PROJECT_MILESTONE_BY_ID_QUERY`
 * — list shape + project + issues connection.
 */
export interface MilestoneDetailNode extends MilestoneListNode {
	project: MilestoneProjectRef;
	issues: { nodes: IssueNode[] };
}

/**
 * Mirrors the milestone selection set in `FIND_PROJECT_MILESTONE_BY_NAME_*`
 * — minimal lookup shape with project back-reference.
 */
export interface MilestoneLookupNode {
	id: string;
	name: string;
	targetDate: string | null;
	sortOrder: number;
	project: MilestoneProjectRef;
}

/**
 * Mirrors the milestone selection set on the create / update mutations —
 * list shape + project (no issues connection).
 */
export interface MutatedMilestoneNode extends MilestoneListNode {
	project: MilestoneProjectRef;
}

export interface ListProjectMilestonesResponse {
	project: {
		id: string;
		name: string;
		projectMilestones: { nodes: MilestoneListNode[] };
	} | null;
}

export interface GetProjectMilestoneByIdResponse {
	projectMilestone: MilestoneDetailNode | null;
}

export interface FindProjectMilestoneScopedResponse {
	project: {
		projectMilestones: { nodes: MilestoneLookupNode[] };
	} | null;
}

export interface FindProjectMilestoneGlobalResponse {
	projectMilestones: { nodes: MilestoneLookupNode[] };
}

export interface CreateProjectMilestoneResponse {
	projectMilestoneCreate: {
		success: boolean;
		projectMilestone: MutatedMilestoneNode | null;
	};
}

export interface UpdateProjectMilestoneResponse {
	projectMilestoneUpdate: {
		success: boolean;
		projectMilestone: MutatedMilestoneNode | null;
	};
}
