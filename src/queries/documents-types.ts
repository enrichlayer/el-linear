/**
 * Typed response shapes for the queries in `./documents.ts`.
 *
 * Mirrors `DOCUMENT_FRAGMENT` so the consumer in
 * `graphql-documents-service.ts` can read fields without recursive
 * `Record<string, unknown>` casts. See `./issues-types.ts` for the
 * full rationale and pattern (ALL-937).
 */

interface DocumentCreatorRef {
	id: string;
	name: string;
}

interface DocumentProjectRef {
	id: string;
	name: string;
}

interface DocumentIssueRef {
	id: string;
	identifier: string;
	title: string;
}

/** Mirrors `DOCUMENT_FRAGMENT` from `src/queries/documents.ts`. */
export interface DocumentNode {
	id: string;
	title: string;
	content: string | null;
	slugId: string | null;
	url: string | null;
	icon: string | null;
	color: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	creator: DocumentCreatorRef | null;
	project: DocumentProjectRef | null;
	issue: DocumentIssueRef | null;
}

export interface CreateDocumentResponse {
	documentCreate: {
		success: boolean;
		document: DocumentNode | null;
	};
}

export interface UpdateDocumentResponse {
	documentUpdate: {
		success: boolean;
		document: DocumentNode | null;
	};
}

export interface GetDocumentResponse {
	document: DocumentNode | null;
}

export interface ListDocumentsResponse {
	documents: { nodes: DocumentNode[] };
}

export interface DeleteDocumentResponse {
	documentDelete: { success: boolean };
}
