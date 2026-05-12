import type { Command, OptionValues } from "commander";
import {
	resolveAssignee,
	resolveLabels,
	resolveTeam,
} from "../config/resolver.js";
import type { LinearIssue } from "../types/linear.js";
import type { SearchIssueArgs } from "../utils/graphql-issues-service.js";
import { createIssuesService } from "../utils/issues-service-bootstrap.js";
import { logger } from "../utils/logger.js";
import {
	handleAsyncCommand,
	outputSuccess,
	outputWarning,
} from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { splitList } from "../utils/validators.js";

interface BatchResult {
	error?: string;
	identifier: string;
	success: boolean;
}

/**
 * Parse the --filter string into structured search arguments.
 * Format: "status:Backlog team:DEV label:Bug assignee:Alice project:Sprint12"
 */
function parseFilterString(filter: string): Record<string, string> {
	const result: Record<string, string> = {};
	const parts = filter.match(/(\w+):("[^"]+"|[^\s]+)/g);
	if (!parts) {
		throw new Error(
			`Invalid filter format: "${filter}". ` +
				'Expected key:value pairs, e.g. "status:Backlog team:DEV label:Bug"',
		);
	}
	for (const part of parts) {
		const colonIndex = part.indexOf(":");
		const key = part.slice(0, colonIndex);
		const value = part.slice(colonIndex + 1).replace(/^"|"$/g, "");
		result[key] = value;
	}
	return result;
}

/**
 * Resolve issue identifiers from --issues or --filter.
 * Returns LinearIssue[] so we can show a preview.
 */
async function resolveTargetIssues(
	options: OptionValues,
	rootOpts: Record<string, unknown>,
): Promise<LinearIssue[]> {
	const { issuesService } = await createIssuesService(rootOpts);

	if (options.issues) {
		const ids = splitList(options.issues);
		return Promise.all(ids.map((id) => issuesService.getIssueById(id)));
	}

	if (options.filter) {
		const filters = parseFilterString(options.filter);
		// Typed as SearchIssueArgs (not Record<string, unknown>) so a future
		// rename of any field — like the DEV-4068 T4 `projectId` → `project`
		// migration — surfaces here at compile time instead of silently
		// dropping the filter.
		const searchArgs: SearchIssueArgs = {
			teamId: filters.team ? resolveTeam(filters.team) : undefined,
			assigneeId: filters.assignee
				? await resolveAssignee(filters.assignee, rootOpts)
				: undefined,
			project: filters.project
				? { kind: "id", id: filters.project }
				: undefined,
			labelNames: filters.label ? splitList(filters.label) : undefined,
			status: filters.status ? splitList(filters.status) : undefined,
			limit: 50,
		};
		return issuesService.searchIssues(searchArgs);
	}

	throw new Error(
		"Specify --issues (comma-separated IDs) or --filter to select issues.",
	);
}

/**
 * Print a preview table of issues that will be affected.
 * Returns false if no issues were found.
 */
function printPreview(issues: LinearIssue[], action: string): boolean {
	if (issues.length === 0) {
		logger.error("No issues matched the given criteria.");
		return false;
	}

	logger.error(`\n${action}\n`);
	logger.error(`  ${"Identifier".padEnd(14)} ${"Status".padEnd(16)} Title`);
	logger.error(`  ${"─".repeat(14)} ${"─".repeat(16)} ${"─".repeat(40)}`);
	for (const issue of issues) {
		const id = issue.identifier.padEnd(14);
		const status = (issue.state?.name ?? "—").padEnd(16);
		const title =
			issue.title.length > 50 ? `${issue.title.slice(0, 47)}...` : issue.title;
		logger.error(`  ${id} ${status} ${title}`);
	}
	logger.error(
		`\n  ${issues.length} issue${issues.length === 1 ? "" : "s"} will be affected.\n`,
	);
	return true;
}

/**
 * Execute a batch operation on each issue, collecting results.
 */
async function executeBatch(
	issues: LinearIssue[],
	operation: (issue: LinearIssue) => Promise<LinearIssue>,
): Promise<{ results: BatchResult[] }> {
	const results: BatchResult[] = [];

	for (const issue of issues) {
		try {
			await operation(issue);
			results.push({ identifier: issue.identifier, success: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			results.push({
				identifier: issue.identifier,
				success: false,
				error: message,
			});
		}
	}

	return { results };
}

async function handleBatchAssign(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);

	if (!options.assignee) {
		throw new Error("--assignee is required.");
	}

	const issues = await resolveTargetIssues(options, rootOpts);
	const assigneeId = await resolveAssignee(options.assignee, rootOpts);

	if (!options.yes) {
		const hasPreview = printPreview(
			issues,
			`Assign ${issues.length} issues to "${options.assignee}":`,
		);
		if (!hasPreview) {
			return;
		}
		outputWarning("Dry run — pass --yes to execute.");
		outputSuccess({
			dryRun: true,
			action: "assign",
			assignee: options.assignee,
			issues: issues.map((i) => i.identifier),
			count: issues.length,
		});
		return;
	}

	const { issuesService } = await createIssuesService(rootOpts);

	const { results } = await executeBatch(issues, (issue) =>
		issuesService.updateIssue({ id: issue.identifier, assigneeId }, "adding"),
	);

	outputSuccess({
		action: "assign",
		assignee: options.assignee,
		results,
		meta: {
			total: results.length,
			succeeded: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length,
		},
	});
}

async function handleBatchLabel(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);

	if (!(options.add || options.remove)) {
		throw new Error("Specify --add and/or --remove for labels.");
	}

	const issues = await resolveTargetIssues(options, rootOpts);
	const addLabels = options.add ? splitList(options.add) : [];
	const removeLabels = options.remove ? splitList(options.remove) : [];

	const actionParts: string[] = [];
	if (addLabels.length > 0) {
		actionParts.push(`add [${addLabels.join(", ")}]`);
	}
	if (removeLabels.length > 0) {
		actionParts.push(`remove [${removeLabels.join(", ")}]`);
	}
	const actionDesc = `Labels: ${actionParts.join(", ")} on ${issues.length} issues:`;

	if (!options.yes) {
		const hasPreview = printPreview(issues, actionDesc);
		if (!hasPreview) {
			return;
		}
		outputWarning("Dry run — pass --yes to execute.");
		outputSuccess({
			dryRun: true,
			action: "label",
			add: addLabels,
			remove: removeLabels,
			issues: issues.map((i) => i.identifier),
			count: issues.length,
		});
		return;
	}

	const { issuesService } = await createIssuesService(rootOpts);

	const removeLower = removeLabels.map((l) => l.toLowerCase());

	const { results } = await executeBatch(issues, (issue) => {
		// Filter out labels to remove (by name, case-insensitive)
		const keepIds = issue.labels
			.filter((l) => !removeLower.includes(l.name.toLowerCase()))
			.map((l) => l.id);

		// Resolve labels to add (may be names that need resolution)
		const teamKey = issue.team?.key;
		const addIds = teamKey ? resolveLabels(addLabels, teamKey) : addLabels;

		// Merge: keep existing (minus removed) + add new (avoiding duplicates)
		const finalLabelIds = [...keepIds];
		for (const id of addIds) {
			if (!finalLabelIds.includes(id)) {
				finalLabelIds.push(id);
			}
		}

		return issuesService.updateIssue(
			{ id: issue.identifier, labelIds: finalLabelIds },
			"overwriting",
		);
	});

	outputSuccess({
		action: "label",
		add: addLabels,
		remove: removeLabels,
		results,
		meta: {
			total: results.length,
			succeeded: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length,
		},
	});
}

async function handleBatchMove(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);

	if (!options.project) {
		throw new Error("--project is required.");
	}

	const issues = await resolveTargetIssues(options, rootOpts);

	if (!options.yes) {
		const hasPreview = printPreview(
			issues,
			`Move ${issues.length} issues to project "${options.project}":`,
		);
		if (!hasPreview) {
			return;
		}
		outputWarning("Dry run — pass --yes to execute.");
		outputSuccess({
			dryRun: true,
			action: "move",
			project: options.project,
			issues: issues.map((i) => i.identifier),
			count: issues.length,
		});
		return;
	}

	const { issuesService } = await createIssuesService(rootOpts);

	const { results } = await executeBatch(issues, (issue) =>
		issuesService.updateIssue(
			{ id: issue.identifier, projectId: options.project },
			"adding",
		),
	);

	outputSuccess({
		action: "move",
		project: options.project,
		results,
		meta: {
			total: results.length,
			succeeded: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length,
		},
	});
}

async function handleBatchStatus(
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);

	if (!options.status) {
		throw new Error("--status is required.");
	}

	const issues = await resolveTargetIssues(options, rootOpts);

	if (!options.yes) {
		const hasPreview = printPreview(
			issues,
			`Change status to "${options.status}" on ${issues.length} issues:`,
		);
		if (!hasPreview) {
			return;
		}
		outputWarning("Dry run — pass --yes to execute.");
		outputSuccess({
			dryRun: true,
			action: "status",
			status: options.status,
			issues: issues.map((i) => i.identifier),
			count: issues.length,
		});
		return;
	}

	const { issuesService } = await createIssuesService(rootOpts);

	const { results } = await executeBatch(issues, (issue) =>
		issuesService.updateIssue(
			{ id: issue.identifier, statusId: options.status },
			"adding",
		),
	);

	outputSuccess({
		action: "status",
		status: options.status,
		results,
		meta: {
			total: results.length,
			succeeded: results.filter((r) => r.success).length,
			failed: results.filter((r) => !r.success).length,
		},
	});
}

export function setupBatchCommands(program: Command): void {
	const batch = program
		.command("batch")
		.description("Batch operations on multiple issues");
	batch.action(() => batch.help());

	batch
		.command("assign")
		.description("Assign multiple issues to a user")
		.option(
			"--issues <issues>",
			"comma-separated issue IDs (e.g. DEV-100,DEV-101)",
		)
		.option(
			"--filter <filter>",
			'query filter (e.g. "status:Backlog team:DEV label:Bug")',
		)
		.requiredOption("--assignee <assignee>", "assignee (name, alias, or UUID)")
		.option("--yes", "skip confirmation preview and execute immediately")
		.action(handleAsyncCommand(handleBatchAssign));

	batch
		.command("label")
		.description("Add or remove labels on multiple issues")
		.option(
			"--issues <issues>",
			"comma-separated issue IDs (e.g. DEV-100,DEV-101)",
		)
		.option(
			"--filter <filter>",
			'query filter (e.g. "status:Backlog team:DEV label:Bug")',
		)
		.option("--add <labels>", "labels to add (comma-separated names)")
		.option("--remove <labels>", "labels to remove (comma-separated names)")
		.option("--yes", "skip confirmation preview and execute immediately")
		.action(handleAsyncCommand(handleBatchLabel));

	batch
		.command("move")
		.description("Move multiple issues to a project")
		.option(
			"--issues <issues>",
			"comma-separated issue IDs (e.g. DEV-100,DEV-101)",
		)
		.option(
			"--filter <filter>",
			'query filter (e.g. "status:Backlog team:DEV label:Bug")',
		)
		.requiredOption("--project <project>", "project name or ID")
		.option("--yes", "skip confirmation preview and execute immediately")
		.action(handleAsyncCommand(handleBatchMove));

	batch
		.command("status")
		.description("Change status on multiple issues")
		.option(
			"--issues <issues>",
			"comma-separated issue IDs (e.g. DEV-100,DEV-101)",
		)
		.option(
			"--filter <filter>",
			'query filter (e.g. "status:Backlog team:DEV label:Bug")',
		)
		.requiredOption("-s, --status <status>", "new status name or ID")
		.option("--yes", "skip confirmation preview and execute immediately")
		.action(handleAsyncCommand(handleBatchStatus));
}
