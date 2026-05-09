/**
 * Git branch helpers used by `issues create --branch` and the
 * `issues retrolink` flow.
 *
 * Extracted from `commands/issues.ts` (ALL-938) to keep that file
 * focused on commander wiring + handlers.
 */

import { execFileSync } from "node:child_process";
import { outputWarning } from "../../utils/output.js";

const LINEAR_BRANCH_REGEX = /^([a-zA-Z]+)-(\d+)-(.+)$/;

/**
 * Transform Linear's branchName (e.g. "dev-3549-slug") into our convention:
 * "feature/DEV-3549-slug" — uppercase team key with a configurable prefix.
 */
export function toBranchName(
	linearBranchName: string,
	prefix = "feature/",
): string {
	// Linear branch names look like "dev-123-some-slug"
	// We need to uppercase the team key: "DEV-123-some-slug"
	const match = linearBranchName.match(LINEAR_BRANCH_REGEX);
	if (!match) {
		return `${prefix}${linearBranchName}`;
	}
	const [, teamKey, number, slug] = match;
	return `${prefix}${teamKey.toUpperCase()}-${number}-${slug}`;
}

/**
 * Check out a new git branch. Warns and skips if not in a git repo.
 * Throws if the branch already exists.
 */
export function gitCheckoutBranch(branchName: string): void {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			stdio: "pipe",
		});
	} catch {
		outputWarning("Not inside a git repository — skipping branch checkout.");
		return;
	}
	execFileSync("git", ["checkout", "-b", branchName], { stdio: "pipe" });
}
