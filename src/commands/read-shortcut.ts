import type { Command } from "commander";
import { downloadLinearUploads } from "../utils/download-uploads.js";
import { extractField } from "../utils/extract-field.js";
import { createFileService } from "../utils/file-service.js";
import { createIssuesService } from "../utils/issues-service-bootstrap.js";
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
		.option(
			"--field <name>",
			'Extract a single named section from the issue description (e.g. "Done when"). ' +
				"Matches H2/H3 headers and bold pseudo-headers case-insensitively. " +
				"Outputs the section text only — no JSON envelope.",
		)
		.addHelpText(
			"after",
			'\nExamples:\n  el-linear read ADM-652\n  el-linear get DEV-123 DEV-456\n  el-linear ADM-652          (auto-detected)\n  el-linear read DEV-123 --field "Done when"   (just that section)',
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

/**
 * Shared `issues read` body — exported so the top-level shortcut and
 * `issues read` (in `commands/issues.ts`) both call one implementation
 * instead of carrying byte-equivalent duplicates. ALL-938 cleanup.
 */
export async function readIssues(
	issueIds: string[],
	options: Record<string, unknown>,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const { issuesService } = await createIssuesService(rootOpts);
	const fileService = await createFileService(rootOpts);

	const fieldName = typeof options.field === "string" ? options.field : null;

	// --field is single-issue only. With multiple issues, a section
	// extraction can't sensibly fan out to N different bodies — the
	// caller almost always wants one section from one issue.
	if (fieldName && issueIds.length > 1) {
		throw new Error(
			"--field is single-issue only; pass exactly one issueId. " +
				"For multiple issues, drop --field and use --jq or --format summary.",
		);
	}

	if (issueIds.length === 1) {
		const issue = await issuesService.getIssueById(issueIds[0]);
		const resolved = await downloadLinearUploads(issue, fileService);
		if (fieldName) {
			const section = extractField(resolved.description ?? "", fieldName);
			if (section === null) {
				// Print nothing to stdout, exit non-zero with a stderr hint.
				// Mirrors `grep` semantics for "not found" — scripts can
				// branch on the exit code.
				process.stderr.write(
					`el-linear: section "${fieldName}" not found in ${resolved.identifier}'s description\n`,
				);
				process.exit(1);
			}
			process.stdout.write(`${section}\n`);
			return;
		}
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
