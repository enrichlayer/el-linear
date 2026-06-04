import type { Command } from "commander";
import { downloadLinearUploads } from "../utils/download-uploads.js";
import { extractField, extractFields } from "../utils/extract-field.js";
import { createFileService } from "../utils/file-service.js";
import { createIssuesService } from "../utils/issues-service-bootstrap.js";
import {
	handleAsyncCommand,
	outputSuccess,
	outputWarning,
} from "../utils/output.js";
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
		.option(
			"--sections <names>",
			'Extract multiple named description sections in one call (comma-separated, e.g. "Done when,Out of scope,Steps"). ' +
				"Single-issue only. Returns a JSON envelope { identifier, sections: { name -> text|null } }; missing sections appear as null + a _warnings entry. " +
				"Sibling of --field (singular). Named --sections rather than --fields because the program already has a global --fields for output-key filtering.",
		)
		.addHelpText(
			"after",
			'\nExamples:\n  el-linear read ADM-652\n  el-linear get DEV-123 DEV-456\n  el-linear ADM-652          (auto-detected)\n  el-linear read DEV-123 --field "Done when"   (just that section)\n  el-linear read DEV-123 --sections "Done when,Out of scope"',
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
	const sectionsRaw =
		typeof options.sections === "string" ? options.sections : null;

	if (fieldName && sectionsRaw) {
		throw new Error(
			"--field and --sections are mutually exclusive. Use --field for a single section (plain-text output) or --sections for multiple (JSON map).",
		);
	}

	// Both --field and --sections are single-issue only — section extraction
	// can't sensibly fan out to N different bodies, the caller almost always
	// wants the named sections of one issue.
	if ((fieldName || sectionsRaw) && issueIds.length > 1) {
		throw new Error(
			"--field / --sections are single-issue only; pass exactly one issueId. " +
				"For multiple issues, drop the section flags and use --jq or --format summary.",
		);
	}

	// Parse the comma-separated --sections list once. Preserve the caller's
	// order, trim each entry, and drop empties so trailing commas don't
	// surface as ghost "" sections.
	const sectionNames: string[] | null = sectionsRaw
		? sectionsRaw
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
		: null;
	if (sectionNames !== null && sectionNames.length === 0) {
		throw new Error(
			"--sections was empty after trimming. Pass a comma-separated list of section names.",
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
		if (sectionNames !== null) {
			const sectionsMap = extractFields(
				resolved.description ?? "",
				sectionNames,
			);
			const sections: Record<string, string | null> = {};
			const missing: string[] = [];
			for (const [name, text] of sectionsMap) {
				sections[name] = text;
				if (text === null) missing.push(name);
			}
			for (const name of missing) {
				outputWarning(
					`section "${name}" not found in ${resolved.identifier}'s description`,
				);
			}
			outputSuccess({
				identifier: resolved.identifier,
				sections,
			});
			return;
		}
		outputSuccess(resolved);
	} else {
		// DEV-4477: one batched GraphQL call instead of N parallel single-issue
		// queries. The service preserves input order and throws notFoundError
		// on any missing ref. Attachment download still fans out per-issue —
		// that's HTTP, not GraphQL, and downloadLinearUploads is a no-op when
		// there's nothing to download.
		const issues = await issuesService.getIssuesByRefs(issueIds);
		const results = await Promise.all(
			issues.map((issue) => downloadLinearUploads(issue, fileService)),
		);
		outputSuccess(results);
	}
}
