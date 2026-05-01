import { execFileSync } from "node:child_process";
import type { Command } from "commander";
import { extractDocId, parseGoogleDoc } from "../utils/gdoc-parser.js";
import { handleAsyncCommand } from "../utils/output.js";

export function setupGdocCommands(program: Command): void {
	program
		.command("gdoc <docIdOrUrl>")
		.description("Convert a Google Doc to Markdown (requires gws CLI).")
		.addHelpText(
			"after",
			"\nAccepts a Google Doc ID or full URL.\nRequires gws CLI: npm install -g @googleworkspace/cli",
		)
		.action(
			handleAsyncCommand(async (docIdOrUrl: string) => {
				const docId = extractDocId(docIdOrUrl);

				let stdout: string;
				try {
					stdout = execFileSync(
						"gws",
						[
							"docs",
							"documents",
							"get",
							"--params",
							JSON.stringify({ documentId: docId }),
						],
						{
							encoding: "utf-8",
							timeout: 30_000,
							stdio: ["pipe", "pipe", "pipe"],
						},
					);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					if (msg.includes("ENOENT")) {
						throw new Error(
							"gws CLI not found. Install it: npm install -g @googleworkspace/cli && gws auth login",
						);
					}
					throw new Error(`Failed to fetch Google Doc: ${msg}`);
				}

				const doc = JSON.parse(stdout);
				const markdown = parseGoogleDoc(doc);
				// Output raw markdown to stdout (not JSON) so it's pipeable
				process.stdout.write(markdown);
			}),
		);
}
