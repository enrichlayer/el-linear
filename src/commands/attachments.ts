import type { Command, OptionValues } from "commander";
import { createFileService } from "../utils/file-service.js";
import { createGraphQLAttachmentsService } from "../utils/graphql-attachments-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

export function setupAttachmentsCommands(program: Command): void {
	const attachments = program
		.command("attachments")
		.description("Manage file attachments on issues.");
	attachments.action(() => attachments.help());

	attachments
		.command("create <issueId>")
		.description("Upload a file and attach it to an issue.")
		.requiredOption("--file <path>", "path to file to upload")
		.option("--title <title>", "attachment title (defaults to filename)")
		.action(
			handleAsyncCommand(
				async (issueId: string, options: OptionValues, command: Command) => {
					const rootOpts = getRootOpts(command);
					const linearService = await createLinearService(rootOpts);
					const resolvedIssueId = await linearService.resolveIssueId(issueId);

					const fileService = await createFileService(rootOpts);
					const uploadResult = await fileService.uploadFile(options.file);
					if (!uploadResult.success) {
						throw new Error(uploadResult.error);
					}

					const attachmentsService =
						await createGraphQLAttachmentsService(rootOpts);
					const attachment = await attachmentsService.createAttachment({
						issueId: resolvedIssueId,
						url: uploadResult.assetUrl,
						title: options.title || uploadResult.filename,
					});

					outputSuccess(attachment);
				},
			),
		);

	attachments
		.command("list <issueId>")
		.description("List attachments on an issue.")
		.option("-l, --limit <number>", "maximum number of attachments", "50")
		.action(
			handleAsyncCommand(
				async (issueId: string, options: OptionValues, command: Command) => {
					const rootOpts = getRootOpts(command);
					const linearService = await createLinearService(rootOpts);
					const resolvedIssueId = await linearService.resolveIssueId(issueId);
					const attachmentsService =
						await createGraphQLAttachmentsService(rootOpts);
					const allAttachments =
						await attachmentsService.listAttachments(resolvedIssueId);
					const limit = parsePositiveInt(options.limit, "--limit");
					const data = allAttachments.slice(0, limit);
					outputSuccess({ data, meta: { count: data.length } });
				},
			),
		);

	attachments
		.command("delete <attachmentId>")
		.description("Delete an attachment.")
		.action(
			handleAsyncCommand(
				async (
					attachmentId: string,
					_options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const attachmentsService =
						await createGraphQLAttachmentsService(rootOpts);
					await attachmentsService.deleteAttachment(attachmentId);
					outputSuccess({ success: true, message: "Attachment deleted" });
				},
			),
		);
}
