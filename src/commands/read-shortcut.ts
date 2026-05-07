import type { Command } from "commander";
import { downloadLinearUploads } from "../utils/download-uploads.js";
import { createFileService } from "../utils/file-service.js";
import { GraphQLIssuesService } from "../utils/graphql-issues-service.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";

/**
 * Issue ID pattern: 1-5 uppercase letters, dash, 1+ digits (e.g. ADM-652, DEV-12).
 */
const ISSUE_ID_PATTERN = /^[A-Z]{1,5}-\d+$/;

/**
 * Registers a top-level `read` command and a catch-all that auto-detects
 * issue identifiers so `el-linear ADM-652` works without the `issues read` prefix.
 */
export function setupReadShortcut(program: Command): void {
	// Top-level `read` / `get` / `view` / `show` command
	program
		.command("read <issueId...>")
		.alias("get")
		.alias("view")
		.alias("show")
		.description("Shortcut for `issues read`. Get issue details by identifier.")
		.addHelpText(
			"after",
			"\nExamples:\n  el-linear read ADM-652\n  el-linear get DEV-123 DEV-456\n  el-linear ADM-652          (auto-detected)",
		)
		.action(handleAsyncCommand(readIssues));

	// Catch-all: if argv looks like `el-linear ADM-652 [DEV-123 ...]`, run read
	const originalParse = program.parse.bind(program);
	program.parse = (
		argv?: readonly string[],
		parseOptions?: { from: "node" | "electron" | "user" },
	) => {
		const args = argv ?? process.argv;
		const userArgs = args.slice(2); // skip node + script

		// Only intercept when every positional arg looks like an issue ID
		// and there are no flags (to avoid hijacking other commands)
		const positionals = userArgs.filter((a) => !a.startsWith("-"));
		const flags = userArgs.filter((a) => a.startsWith("-"));
		const onlyCompatFlags = flags.every(
			(f) => f === "--json" || f.startsWith("--api-token"),
		);

		if (
			positionals.length > 0 &&
			positionals.every((a) => ISSUE_ID_PATTERN.test(a)) &&
			onlyCompatFlags
		) {
			// Check the first positional isn't a known command
			const knownCommands = new Set(
				program.commands
					.map((c) => c.name())
					.concat(program.commands.flatMap((c) => c.aliases())),
			);
			if (!knownCommands.has(positionals[0])) {
				// Rewrite to `read <ids...>`
				const rewritten = [...args.slice(0, 2), "read", ...userArgs];
				return originalParse(rewritten, parseOptions);
			}
		}

		return originalParse(argv, parseOptions);
	};
}

async function readIssues(
	issueIds: string[],
	_options: Record<string, unknown>,
	command: Command,
) {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const issuesService = new GraphQLIssuesService(graphQLService, linearService);
	const fileService = await createFileService(rootOpts);
	if (issueIds.length === 1) {
		const issue = await issuesService.getIssueById(issueIds[0]);
		const resolved = await downloadLinearUploads(issue, fileService);
		outputSuccess(resolved);
	} else {
		const results = await Promise.all(
			issueIds.map(async (id) => {
				const issue = await issuesService.getIssueById(id);
				return downloadLinearUploads(issue, fileService);
			}),
		);
		outputSuccess(results);
	}
}
