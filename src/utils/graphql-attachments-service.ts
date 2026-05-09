import {
	CREATE_ATTACHMENT_MUTATION,
	DELETE_ATTACHMENT_MUTATION,
	LIST_ATTACHMENTS_QUERY,
} from "../queries/attachments.js";
import type {
	AttachmentNode,
	CreateAttachmentResponse,
	DeleteAttachmentResponse,
	ListAttachmentsResponse,
} from "../queries/attachments-types.js";
import type { LinearAttachment } from "../types/linear.js";
import type { AuthOptions } from "./auth.js";
import {
	createGraphQLService,
	type GraphQLService,
} from "./graphql-service.js";

function transformAttachment(att: AttachmentNode): LinearAttachment {
	return {
		id: att.id,
		url: att.url,
		title: att.title ?? undefined,
		createdAt: att.createdAt ?? undefined,
		updatedAt: att.updatedAt ?? undefined,
	};
}

class GraphQLAttachmentsService {
	private readonly graphqlService: GraphQLService;

	constructor(graphqlService: GraphQLService) {
		this.graphqlService = graphqlService;
	}

	async createAttachment(
		input: Record<string, unknown>,
	): Promise<LinearAttachment> {
		const result =
			await this.graphqlService.rawRequest<CreateAttachmentResponse>(
				CREATE_ATTACHMENT_MUTATION,
				{ input },
			);
		const attachmentCreate = result.attachmentCreate;
		if (!attachmentCreate.success || !attachmentCreate.attachment) {
			throw new Error(
				`Failed to create attachment on issue ${input.issueId} for URL "${input.url}"`,
			);
		}
		return transformAttachment(attachmentCreate.attachment);
	}

	async deleteAttachment(id: string): Promise<boolean> {
		const result =
			await this.graphqlService.rawRequest<DeleteAttachmentResponse>(
				DELETE_ATTACHMENT_MUTATION,
				{ id },
			);
		if (!result.attachmentDelete.success) {
			throw new Error(`Failed to delete attachment: ${id}`);
		}
		return true;
	}

	async listAttachments(issueId: string): Promise<LinearAttachment[]> {
		const result =
			await this.graphqlService.rawRequest<ListAttachmentsResponse>(
				LIST_ATTACHMENTS_QUERY,
				{ issueId },
			);
		if (!result.issue) {
			throw new Error(`Issue not found: ${issueId}`);
		}
		return result.issue.attachments.nodes.map(transformAttachment);
	}
}

export async function createGraphQLAttachmentsService(
	options: AuthOptions,
): Promise<GraphQLAttachmentsService> {
	const graphqlService = await createGraphQLService(options);
	return new GraphQLAttachmentsService(graphqlService);
}
