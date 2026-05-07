import type { Command, OptionValues } from "commander";
import { createFileService } from "../utils/file-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";

export function setupEmbedsCommands(program: Command): void {
	const embeds = program
		.command("embeds")
		.description("Upload and download files from Linear storage.");
	embeds.action(() => embeds.help());

	embeds
		.command("download <url>")
		.description("Download a file from Linear storage.")
		.option("--output <path>", "output file path")
		.option("--overwrite", "overwrite existing file", false)
		.action(
			handleAsyncCommand(
				async (url: string, options: OptionValues, command: Command) => {
					const fileService = await createFileService(getRootOpts(command));
					const result = await fileService.downloadFile(url, {
						output: options.output,
						overwrite: options.overwrite,
					});
					if (result.success) {
						outputSuccess({
							success: true,
							filePath: result.filePath,
							message: `File downloaded successfully to ${result.filePath}`,
						});
					} else {
						const error: Record<string, string | number | boolean> = {
							success: false,
							error: result.error,
						};
						if (result.statusCode) {
							error.statusCode = result.statusCode;
						}
						outputSuccess(error);
					}
				},
			),
		);

	embeds
		.command("upload <file>")
		.description("Upload a file to Linear storage.")
		.action(
			handleAsyncCommand(
				async (filePath: string, _options: OptionValues, command: Command) => {
					const fileService = await createFileService(getRootOpts(command));
					const result = await fileService.uploadFile(filePath);
					if (result.success) {
						outputSuccess({
							success: true,
							assetUrl: result.assetUrl,
							filename: result.filename,
							message: `File uploaded successfully: ${result.assetUrl}`,
						});
					} else {
						const error: Record<string, string | number | boolean> = {
							success: false,
							error: result.error,
						};
						if (result.statusCode) {
							error.statusCode = result.statusCode;
						}
						outputSuccess(error);
					}
				},
			),
		);
}
