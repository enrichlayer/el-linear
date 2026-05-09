import {
	CREATE_DOCUMENT_MUTATION,
	DELETE_DOCUMENT_MUTATION,
	GET_DOCUMENT_QUERY,
	LIST_DOCUMENTS_QUERY,
	UPDATE_DOCUMENT_MUTATION,
} from "../queries/documents.js";
import type {
	CreateDocumentResponse,
	DeleteDocumentResponse,
	DocumentNode,
	GetDocumentResponse,
	ListDocumentsResponse,
	UpdateDocumentResponse,
} from "../queries/documents-types.js";
import type { LinearDocument } from "../types/linear.js";
import type { AuthOptions } from "./auth.js";
import {
	createGraphQLService,
	type GraphQLService,
} from "./graphql-service.js";

function transformDocument(doc: DocumentNode): LinearDocument {
	return {
		id: doc.id,
		title: doc.title,
		content: doc.content ?? undefined,
		color: doc.color ?? undefined,
		icon: doc.icon ?? undefined,
		slugId: doc.slugId ?? undefined,
		url: doc.url ?? undefined,
		creator: doc.creator
			? { id: doc.creator.id, name: doc.creator.name }
			: undefined,
		project: doc.project
			? { id: doc.project.id, name: doc.project.name }
			: undefined,
		issue: doc.issue
			? {
					id: doc.issue.id,
					identifier: doc.issue.identifier,
					title: doc.issue.title,
				}
			: undefined,
		createdAt: doc.createdAt ?? undefined,
		updatedAt: doc.updatedAt ?? undefined,
	};
}

class GraphQLDocumentsService {
	private readonly graphqlService: GraphQLService;

	constructor(graphqlService: GraphQLService) {
		this.graphqlService = graphqlService;
	}

	async createDocument(
		input: Record<string, unknown>,
	): Promise<LinearDocument> {
		const result = await this.graphqlService.rawRequest<CreateDocumentResponse>(
			CREATE_DOCUMENT_MUTATION,
			{ input },
		);
		const createData = result.documentCreate;
		if (!createData.success || !createData.document) {
			throw new Error(
				`Failed to create document "${input.title}"${input.projectId ? ` in project ${input.projectId}` : ""}${input.teamId ? ` for team ${input.teamId}` : ""}`,
			);
		}
		return transformDocument(createData.document);
	}

	async updateDocument(
		id: string,
		input: Record<string, unknown>,
	): Promise<LinearDocument> {
		const result = await this.graphqlService.rawRequest<UpdateDocumentResponse>(
			UPDATE_DOCUMENT_MUTATION,
			{ id, input },
		);
		const updateData = result.documentUpdate;
		if (!updateData.success || !updateData.document) {
			throw new Error(`Failed to update document: ${id}`);
		}
		return transformDocument(updateData.document);
	}

	async getDocument(id: string): Promise<LinearDocument> {
		const result = await this.graphqlService.rawRequest<GetDocumentResponse>(
			GET_DOCUMENT_QUERY,
			{ id },
		);
		if (!result.document) {
			throw new Error(`Document not found: ${id}`);
		}
		return transformDocument(result.document);
	}

	async listDocuments(options?: {
		projectId?: string;
		first?: number;
	}): Promise<LinearDocument[]> {
		const filter = options?.projectId
			? { project: { id: { eq: options.projectId } } }
			: undefined;
		const result = await this.graphqlService.rawRequest<ListDocumentsResponse>(
			LIST_DOCUMENTS_QUERY,
			{
				first: options?.first ?? 50,
				filter,
			},
		);
		return result.documents.nodes.map(transformDocument);
	}

	async deleteDocument(id: string): Promise<boolean> {
		const result = await this.graphqlService.rawRequest<DeleteDocumentResponse>(
			DELETE_DOCUMENT_MUTATION,
			{ id },
		);
		if (!result.documentDelete.success) {
			throw new Error(`Failed to delete document: ${id}`);
		}
		return true;
	}

	async listDocumentsBySlugIds(
		slugIds: string[],
		limit?: number,
	): Promise<LinearDocument[]> {
		if (slugIds.length === 0) {
			return [];
		}
		const filter = {
			or: slugIds.map((slugId) => ({ slugId: { eq: slugId } })),
		};
		const result = await this.graphqlService.rawRequest<ListDocumentsResponse>(
			LIST_DOCUMENTS_QUERY,
			{
				first: limit ?? slugIds.length,
				filter,
			},
		);
		return result.documents.nodes.map(transformDocument);
	}
}

export async function createGraphQLDocumentsService(
	options: AuthOptions,
): Promise<GraphQLDocumentsService> {
	const graphqlService = await createGraphQLService(options);
	return new GraphQLDocumentsService(graphqlService);
}
