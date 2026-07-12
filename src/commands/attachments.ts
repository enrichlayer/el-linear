import { basename } from "node:path";
import type { Command, OptionValues } from "commander";
import type { LinearAttachment } from "../types/linear.js";
import { createFileService } from "../utils/file-service.js";
import { createGraphQLAttachmentsService } from "../utils/graphql-attachments-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

function selectAttachment(
	attachments: LinearAttachment[],
	selector: string,
): LinearAttachment {
	const idMatch = attachments.find((attachment) => attachment.id === selector);
	if (idMatch) return idMatch;

	const matches = attachments.filter(
		(attachment) =>
			attachment.title === selector || attachment.url === selector,
	);
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) {
		throw new Error(
			`Multiple attachments are titled "${selector}"; select one by attachment ID.`,
		);
	}
	throw new Error(
		`Attachment "${selector}" was not found. Run attachments list <issueId> to see attachment IDs and titles.`,
	);
}

async function resolveAttachment(
	issueId: string,
	selector: string,
	rootOpts: ReturnType<typeof getRootOpts>,
): Promise<LinearAttachment> {
	const linearService = await createLinearService(rootOpts);
	const resolvedIssueId = await linearService.resolveIssueId(issueId);
	const attachmentsService = await createGraphQLAttachmentsService(rootOpts);
	return selectAttachment(
		await attachmentsService.listAttachments(resolvedIssueId),
		selector,
	);
}

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
		.command("read <issueId> <attachment>")
		.description("Write a text attachment to stdout by ID, title, or URL.")
		.action(
			handleAsyncCommand(
				async (
					issueId: string,
					selector: string,
					_options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const attachment = await resolveAttachment(
						issueId,
						selector,
						rootOpts,
					);
					const fileService = await createFileService(rootOpts);
					const result = await fileService.readTextFile(attachment.url);
					if (!result.success) throw new Error(result.error);
					process.stdout.write(result.content);
					if (!result.content.endsWith("\n")) process.stdout.write("\n");
				},
			),
		);

	attachments
		.command("download <issueId> <attachment>")
		.description("Download an attachment by ID, title, or URL.")
		.option("--output <path>", "output file path")
		.option("--overwrite", "overwrite existing file", false)
		.action(
			handleAsyncCommand(
				async (
					issueId: string,
					selector: string,
					options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const attachment = await resolveAttachment(
						issueId,
						selector,
						rootOpts,
					);
					const fileService = await createFileService(rootOpts);
					const titleBasename = attachment.title
						? basename(attachment.title)
						: undefined;
					const defaultOutput =
						titleBasename && ![".", ".."].includes(titleBasename)
							? titleBasename
							: undefined;
					const result = await fileService.downloadFile(attachment.url, {
						output: options.output ?? defaultOutput,
						overwrite: options.overwrite,
					});
					if (!result.success) throw new Error(result.error);
					outputSuccess({
						success: true,
						filePath: result.filePath,
						message: `Attachment downloaded to ${result.filePath}`,
					});
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
