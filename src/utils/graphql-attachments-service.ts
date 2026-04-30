import {
	CREATE_ATTACHMENT_MUTATION,
	DELETE_ATTACHMENT_MUTATION,
	LIST_ATTACHMENTS_QUERY,
} from "../queries/attachments.js";
import type { GraphQLResponseData, LinearAttachment } from "../types/linear.js";
import type { AuthOptions } from "./auth.js";
import {
	createGraphQLService,
	type GraphQLService,
} from "./graphql-service.js";

function transformAttachment(att: GraphQLResponseData): LinearAttachment {
	return {
		id: att.id as string,
		url: att.url as string,
		title: (att.title as string | undefined) || undefined,
		createdAt: (att.createdAt as string | undefined) || undefined,
		updatedAt: (att.updatedAt as string | undefined) || undefined,
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
		const result = await this.graphqlService.rawRequest(
			CREATE_ATTACHMENT_MUTATION,
			{ input },
		);
		const attachmentCreate = result.attachmentCreate as GraphQLResponseData;
		if (!attachmentCreate.success) {
			throw new Error(
				`Failed to create attachment on issue ${input.issueId} for URL "${input.url}"`,
			);
		}
		return transformAttachment(
			attachmentCreate.attachment as GraphQLResponseData,
		);
	}

	async deleteAttachment(id: string): Promise<boolean> {
		const result = await this.graphqlService.rawRequest(
			DELETE_ATTACHMENT_MUTATION,
			{ id },
		);
		const attachmentDelete = result.attachmentDelete as GraphQLResponseData;
		if (!attachmentDelete.success) {
			throw new Error(`Failed to delete attachment: ${id}`);
		}
		return true;
	}

	async listAttachments(issueId: string): Promise<LinearAttachment[]> {
		const result = await this.graphqlService.rawRequest(
			LIST_ATTACHMENTS_QUERY,
			{ issueId },
		);
		if (!result.issue) {
			throw new Error(`Issue not found: ${issueId}`);
		}
		const issue = result.issue as GraphQLResponseData;
		const attachments = issue.attachments as GraphQLResponseData;
		return (attachments.nodes as GraphQLResponseData[]).map(
			transformAttachment,
		);
	}
}

export function createGraphQLAttachmentsService(
	options: AuthOptions,
): GraphQLAttachmentsService {
	const graphqlService = createGraphQLService(options);
	return new GraphQLAttachmentsService(graphqlService);
}
