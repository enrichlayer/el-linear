/**
 * Typed response shapes for the queries in `./attachments.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 */

/** Mirrors `ATTACHMENT_FRAGMENT` from `src/queries/attachments.ts`. */
export interface AttachmentNode {
	id: string;
	title: string | null;
	url: string;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface CreateAttachmentResponse {
	attachmentCreate: {
		success: boolean;
		attachment: AttachmentNode | null;
	};
}

export interface DeleteAttachmentResponse {
	attachmentDelete: { success: boolean };
}

export interface ListAttachmentsResponse {
	issue: {
		attachments: { nodes: AttachmentNode[] };
	} | null;
}
