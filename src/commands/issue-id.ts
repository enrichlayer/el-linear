/**
 * `el-linear issue-id` — extract the Linear issue ID from the current
 * git branch (or any branch passed as an argument).
 *
 * Replaces the regex that was duplicated across 4 skills: commit-guard,
 * glab-commit-push-mr, stray-file-triage, git-branch-from-linear. Each
 * had its own copy of `feature/(DEV|ALL|...)-\d+-...` parsing.
 *
 * Output (when issueId found):
 *   { branch, issueId: "DEV-3900", team: "DEV", number: 3900, slug: "..." }
 * Output (when no match):
 *   { branch, issueId: null, team: null, number: null, slug: null }
 *
 * `--fetch` (optional): also fetches the issue from Linear and includes
 * { title, description, state, assignee }. Skip when you only need the
 * parsed ID — saves an API round-trip.
 */

import { spawnSync } from "node:child_process";
import type { Command, OptionValues } from "commander";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

// Branch naming conventions — kept in sync with branch-name validators
// elsewhere in the workspace. Any addition here is the single point of
// truth that all skills rely on.
const BRANCH_RE =
	/^(?:feature|fix|chore|refactor|dev)[-/]([A-Z]{2,4})-(\d+)(?:[-/](.*))?$/i;

interface ParsedBranch {
	branch: string;
	issueId: string | null;
	number: number | null;
	slug: string | null;
	team: string | null;
}

export function parseBranchName(branch: string): ParsedBranch {
	const m = branch.match(BRANCH_RE);
	if (!m) {
		return { branch, issueId: null, team: null, number: null, slug: null };
	}
	const team = m[1].toUpperCase();
	const number = Number.parseInt(m[2], 10);
	return {
		branch,
		issueId: `${team}-${number}`,
		team,
		number,
		slug: m[3] ?? null,
	};
}

function getCurrentBranch(): string {
	const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(
			`git rev-parse failed: ${result.stderr.trim() || "non-zero exit"}`,
		);
	}
	return result.stdout.trim();
}

const ISSUE_QUERY = /* GraphQL */ `
  query IssueByIdentifier($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      branchName
      state { name type }
      assignee { id name email }
    }
  }
`;

export function setupIssueIdCommand(program: Command): void {
	program
		.command("issue-id [branch]")
		.description(
			"Extract the Linear issue ID from a git branch name (defaults to current branch). Use --fetch to also pull the issue from Linear.",
		)
		.option("--fetch", "also fetch issue title/description/state from Linear")
		.action(
			handleAsyncCommand(
				async (
					branchArg: string | undefined,
					options: OptionValues,
					command: Command,
				) => {
					const branch = branchArg ?? getCurrentBranch();
					const parsed = parseBranchName(branch);

					if (!(options.fetch && parsed.issueId)) {
						outputSuccess(parsed);
						return;
					}

					const rootOpts = command.parent?.opts() ?? {};
					const service = await createGraphQLService({
						apiToken: rootOpts.apiToken,
					});
					const result = await service.rawRequest<{
						issue: {
							id: string;
							identifier: string;
							title: string;
							description: string;
							branchName: string;
							state: { name: string; type: string };
							assignee: { id: string; name: string; email: string } | null;
						} | null;
					}>(ISSUE_QUERY, { id: parsed.issueId });

					outputSuccess({ ...parsed, issue: result.issue ?? null });
				},
			),
		);
}
