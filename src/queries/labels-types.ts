/**
 * Typed response shapes for the queries in `./labels.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 */

export interface LabelTeamRef {
	id: string;
	key: string;
	name: string;
}

export interface LabelParentRef {
	id: string;
	name: string;
}

/** Mirrors the issueLabel selection set on `CREATE_LABEL_MUTATION`. */
export interface CreatedLabelNode {
	id: string;
	name: string;
	color: string;
	team: LabelTeamRef | null;
	parent: LabelParentRef | null;
}

/** Mirrors the issueLabel selection set on `RETIRE_LABEL_MUTATION`. */
export interface RetiredLabelNode {
	id: string;
	name: string;
	color: string;
	retiredAt: string | null;
	team: LabelTeamRef | null;
}

/** Mirrors the issueLabel selection set on `RESTORE_LABEL_MUTATION`. */
export interface RestoredLabelNode {
	id: string;
	name: string;
	color: string;
	team: LabelTeamRef | null;
}

export interface ParentLabelNode {
	id: string;
	name: string;
	isGroup: boolean;
}

export interface FindParentLabelResponse {
	issueLabels: { nodes: ParentLabelNode[] };
}

export interface CreateLabelResponse {
	issueLabelCreate: {
		success: boolean;
		issueLabel: CreatedLabelNode | null;
	};
}

export interface RetireLabelResponse {
	issueLabelRetire: {
		success: boolean;
		issueLabel: RetiredLabelNode | null;
	};
}

export interface RestoreLabelResponse {
	issueLabelRestore: {
		success: boolean;
		issueLabel: RestoredLabelNode | null;
	};
}
