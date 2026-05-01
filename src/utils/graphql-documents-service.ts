import {
	CREATE_DOCUMENT_MUTATION,
	DELETE_DOCUMENT_MUTATION,
	GET_DOCUMENT_QUERY,
	LIST_DOCUMENTS_QUERY,
	UPDATE_DOCUMENT_MUTATION,
} from "../queries/documents.js";
import type { GraphQLResponseData, LinearDocument } from "../types/linear.js";
import type { AuthOptions } from "./auth.js";
import {
	createGraphQLService,
	type GraphQLService,
} from "./graphql-service.js";

function transformDocument(doc: GraphQLResponseData): LinearDocument {
	const creator = doc.creator as GraphQLResponseData | undefined;
	const project = doc.project as GraphQLResponseData | undefined;
	const issue = doc.issue as GraphQLResponseData | undefined;
	return {
		id: doc.id as string,
		title: doc.title as string,
		content: (doc.content as string | undefined) || undefined,
		color: (doc.color as string | undefined) || undefined,
		icon: (doc.icon as string | undefined) || undefined,
		slugId: (doc.slugId as string | undefined) || undefined,
		url: (doc.url as string | undefined) || undefined,
		creator: creator
			? { id: creator.id as string, name: creator.name as string }
			: undefined,
		project: project
			? { id: project.id as string, name: project.name as string }
			: undefined,
		issue: issue
			? {
					id: issue.id as string,
					identifier: issue.identifier as string,
					title: issue.title as string,
				}
			: undefined,
		createdAt: (doc.createdAt as string | undefined) || undefined,
		updatedAt: (doc.updatedAt as string | undefined) || undefined,
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
		const result = await this.graphqlService.rawRequest(
			CREATE_DOCUMENT_MUTATION,
			{ input },
		);
		const createData = result.documentCreate as GraphQLResponseData;
		if (!createData.success) {
			throw new Error(
				`Failed to create document "${input.title}"${input.projectId ? ` in project ${input.projectId}` : ""}${input.teamId ? ` for team ${input.teamId}` : ""}`,
			);
		}
		return transformDocument(createData.document as GraphQLResponseData);
	}

	async updateDocument(
		id: string,
		input: Record<string, unknown>,
	): Promise<LinearDocument> {
		const result = await this.graphqlService.rawRequest(
			UPDATE_DOCUMENT_MUTATION,
			{ id, input },
		);
		const updateData = result.documentUpdate as GraphQLResponseData;
		if (!updateData.success) {
			throw new Error(`Failed to update document: ${id}`);
		}
		return transformDocument(updateData.document as GraphQLResponseData);
	}

	async getDocument(id: string): Promise<LinearDocument> {
		const result = await this.graphqlService.rawRequest(GET_DOCUMENT_QUERY, {
			id,
		});
		if (!result.document) {
			throw new Error(`Document not found: ${id}`);
		}
		return transformDocument(result.document as GraphQLResponseData);
	}

	async listDocuments(options?: {
		projectId?: string;
		first?: number;
	}): Promise<LinearDocument[]> {
		const filter = options?.projectId
			? { project: { id: { eq: options.projectId } } }
			: undefined;
		const result = await this.graphqlService.rawRequest(LIST_DOCUMENTS_QUERY, {
			first: options?.first ?? 50,
			filter,
		});
		return (
			(result.documents as GraphQLResponseData).nodes as GraphQLResponseData[]
		).map(transformDocument);
	}

	async deleteDocument(id: string): Promise<boolean> {
		const result = await this.graphqlService.rawRequest(
			DELETE_DOCUMENT_MUTATION,
			{ id },
		);
		const deleteData = result.documentDelete as GraphQLResponseData;
		if (!deleteData.success) {
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
		const result = await this.graphqlService.rawRequest(LIST_DOCUMENTS_QUERY, {
			first: limit ?? slugIds.length,
			filter,
		});
		return (
			(result.documents as GraphQLResponseData).nodes as GraphQLResponseData[]
		).map(transformDocument);
	}
}

export function createGraphQLDocumentsService(
	options: AuthOptions,
): GraphQLDocumentsService {
	const graphqlService = createGraphQLService(options);
	return new GraphQLDocumentsService(graphqlService);
}
