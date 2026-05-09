/**
 * Typed response shapes for the queries in `./comments.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 */

export interface CommentUserRef {
	id: string;
	name: string;
	displayName: string | null;
	url: string | null;
}

/**
 * Mirrors the comment selection set used by `LIST_COMMENTS_QUERY`,
 * `CREATE_COMMENT_MUTATION`, and (with `issue` overlay)
 * `UPDATE_COMMENT_MUTATION`.
 */
export interface CommentNode {
	id: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	user: CommentUserRef;
}

export interface UpdatedCommentNode extends CommentNode {
	issue: {
		id: string;
		identifier: string;
	} | null;
}

export interface ListCommentsResponse {
	issue: {
		id: string;
		identifier: string;
		comments: { nodes: CommentNode[] };
	} | null;
}

export interface CreateCommentResponse {
	commentCreate: {
		success: boolean;
		comment: CommentNode | null;
	};
}

export interface UpdateCommentResponse {
	commentUpdate: {
		success: boolean;
		comment: UpdatedCommentNode | null;
	};
}
