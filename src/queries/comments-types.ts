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

/**
 * Comment shape returned by the standalone comment queries:
 * `LIST_COMMENTS_QUERY`, `CREATE_COMMENT_MUTATION`, and (with `issue`
 * overlay) `UPDATE_COMMENT_MUTATION`. Distinct from
 * `issues-types.ts:IssueCommentNode`, which is the embedded-in-issue
 * shape — that one allows `user: null`, this one does not (a standalone
 * comment without an author isn't a valid Linear state). The two were
 * a single `CommentNode` interface pre-DEV-4068 T2, but with incompatible
 * `user` shapes — renamed to disambiguate the per-context contract.
 */
export interface CommentResourceNode {
	id: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	user: CommentUserRef;
}

interface UpdatedCommentResourceNode extends CommentResourceNode {
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
