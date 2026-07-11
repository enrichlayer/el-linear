import type { Command, OptionValues } from "commander";
import { createGraphQLAttachmentsService } from "../utils/graphql-attachments-service.js";
import { createGraphQLDocumentsService } from "../utils/graphql-documents-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

function extractDocumentIdFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes("linear.app")) {
			return null;
		}
		const pathParts = parsed.pathname.split("/");
		const docIndex = pathParts.indexOf("document");
		if (docIndex === -1 || docIndex >= pathParts.length - 1) {
			return null;
		}
		const docSlug = pathParts[docIndex + 1];
		const lastHyphenIndex = docSlug.lastIndexOf("-");
		if (lastHyphenIndex === -1) {
			return docSlug || null;
		}
		return docSlug.substring(lastHyphenIndex + 1) || null;
	} catch {
		return null;
	}
}

async function handleCreateDocument(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const documentsService = await createGraphQLDocumentsService(rootOpts);
	const linearService = await createLinearService(rootOpts);

	const document = await documentsService.createDocument({
		title: options.title,
		content: options.content,
		projectId: options.project
			? await linearService.resolveProjectId(options.project, options.team)
			: undefined,
		teamId: options.team
			? await linearService.resolveTeamId(options.team)
			: undefined,
		issueId: options.issue
			? await linearService.resolveIssueId(options.issue)
			: undefined,
		icon: options.icon,
		color: options.color,
	});

	if (options.attachTo) {
		const attachmentsService = await createGraphQLAttachmentsService(rootOpts);
		const issueId = await linearService.resolveIssueId(options.attachTo);
		try {
			await attachmentsService.createAttachment({
				issueId,
				url: document.url,
				title: document.title,
			});
		} catch (attachError) {
			const errorMessage =
				attachError instanceof Error
					? attachError.message
					: String(attachError);
			throw new Error(
				`Document created (${document.id}) but failed to attach to issue "${options.attachTo}": ${errorMessage}.`,
			);
		}
	}

	outputSuccess(document);
}

async function handleListDocuments(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const filters = [options.project, options.issue, options.attachedTo].filter(
		Boolean,
	);
	if (filters.length > 1) {
		throw new Error(
			"Cannot combine --project, --issue, and --attached-to. Choose one filter.",
		);
	}

	const rootOpts = getRootOpts(command);
	const documentsService = await createGraphQLDocumentsService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const limit = parsePositiveInt(options.limit || "50", "--limit");
	if (Number.isNaN(limit) || limit < 1) {
		throw new Error(
			`Invalid limit "${options.limit}": must be a positive number`,
		);
	}

	if (options.attachedTo) {
		const attachmentsService = await createGraphQLAttachmentsService(rootOpts);
		const issueId = await linearService.resolveIssueId(options.attachedTo);
		const attachments = await attachmentsService.listAttachments(issueId);
		const documentSlugIds = [
			...new Set(
				attachments
					.map((att) => extractDocumentIdFromUrl(att.url))
					.filter((id: string | null) => id !== null),
			),
		];
		if (documentSlugIds.length === 0) {
			outputSuccess({ data: [], meta: { count: 0 } });
			return;
		}
		const docs = await documentsService.listDocumentsBySlugIds(
			documentSlugIds as string[],
			limit,
		);
		outputSuccess({ data: docs, meta: { count: docs.length } });
		return;
	}

	let projectId: string | undefined;
	if (options.project) {
		projectId = await linearService.resolveProjectId(options.project);
	}
	let issueId: string | undefined;
	if (options.issue) {
		issueId = await linearService.resolveIssueId(options.issue);
	}
	const docs = await documentsService.listDocuments({
		projectId,
		issueId,
		first: limit,
	});
	outputSuccess({ data: docs, meta: { count: docs.length } });
}

export function setupDocumentsCommands(program: Command): void {
	const documents = program
		.command("documents")
		.alias("document")
		.alias("doc")
		.alias("docs")
		.description("Document operations (project-level documentation)");
	documents.action(() => documents.help());

	documents
		.command("create")
		.description("Create a new document")
		.requiredOption("--title <title>", "document title")
		.option("--content <content>", "document content (markdown)")
		.option("--project <project>", "project name or ID")
		.option("--team <team>", "team key or name")
		.option("--icon <icon>", "document icon")
		.option("--color <color>", "icon color")
		.option(
			"--issue <issue>",
			"link document directly to issue (e.g., ABC-123)",
		)
		.option(
			"--attach-to <issue>",
			"also create a URL attachment on issue (e.g., ABC-123)",
		)
		.action(handleAsyncCommand(handleCreateDocument));

	documents
		.command("update <documentId>")
		.description("Update an existing document")
		.option("--title <title>", "new document title")
		.option("--content <content>", "new document content (markdown)")
		.option("--project <project>", "move to different project")
		.option("--icon <icon>", "document icon")
		.option("--color <color>", "icon color")
		.action(
			handleAsyncCommand(
				async (documentId: string, options: OptionValues, command: Command) => {
					const rootOpts = getRootOpts(command);
					const documentsService =
						await createGraphQLDocumentsService(rootOpts);
					const linearService = await createLinearService(rootOpts);
					const input: Record<string, unknown> = {};
					if (options.title) {
						input.title = options.title;
					}
					if (options.content) {
						input.content = options.content;
					}
					if (options.project) {
						input.projectId = await linearService.resolveProjectId(
							options.project,
						);
					}
					if (options.icon) {
						input.icon = options.icon;
					}
					if (options.color) {
						input.color = options.color;
					}
					outputSuccess(
						await documentsService.updateDocument(documentId, input),
					);
				},
			),
		);

	documents
		.command("read <documentId>")
		.description("Read a document")
		.action(
			handleAsyncCommand(
				async (
					documentId: string,
					_options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const documentsService =
						await createGraphQLDocumentsService(rootOpts);
					outputSuccess(await documentsService.getDocument(documentId));
				},
			),
		);

	documents
		.command("list")
		.description("List documents")
		.option("--project <project>", "filter by project name or ID")
		.option(
			"--issue <issue>",
			"filter by direct issue link (set by documents create --issue)",
		)
		.option(
			"--attached-to <issue>",
			"filter by URL attachments (set by documents create --attach-to)",
		)
		.option("-l, --limit <limit>", "maximum number of documents", "50")
		.action(handleAsyncCommand(handleListDocuments));

	documents
		.command("delete <documentId>")
		.description("Delete (trash) a document")
		.action(
			handleAsyncCommand(
				async (
					documentId: string,
					_options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const documentsService =
						await createGraphQLDocumentsService(rootOpts);
					await documentsService.deleteDocument(documentId);
					outputSuccess({ success: true, message: "Document moved to trash" });
				},
			),
		);
}
