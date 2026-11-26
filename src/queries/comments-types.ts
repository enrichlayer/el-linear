/**
 * Typed response shapes for the queries in `./comments.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 */

interface CommentUserRef {
	id: string;
	name: string;
	displayName: string | null;
	url: string | null;
}

/** Standalone comments can be authored by a human, integration, or external user. */
export interface CommentResourceNode {
	id: string;
	body: string;
	url?: string | null;
	createdAt: string;
	updatedAt: string;
	user: CommentUserRef | null;
	botActor?: { name: string | null } | null;
	externalUser?: { name: string | null } | null;
}

interface UpdatedCommentResourceNode extends CommentResourceNode {
	issue: {
		id: string;
		identifier: string;
	} | null;
}

interface ReadCommentResourceNode extends CommentResourceNode {
	issue: {
		id: string;
		identifier: string;
	} | null;
}

export interface ListCommentsResponse {
	issue: {
		id: string;
		identifier: string;
		comments: { nodes: CommentResourceNode[] };
	} | null;
}

export interface GetCommentResponse {
	comment: ReadCommentResourceNode | null;
}

export interface CreateCommentResponse {
	commentCreate: {
		success: boolean;
		comment: CommentResourceNode | null;
	};
}

export interface UpdateCommentResponse {
	commentUpdate: {
		success: boolean;
		comment: UpdatedCommentResourceNode | null;
	};
}

export interface DeleteCommentResponse {
	commentDelete: {
		success: boolean;
	};
}
