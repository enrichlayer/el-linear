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
 *
 * Returns `true` if the branch was actually checked out, `false` if the
 * checkout was skipped (not in a git repo). Callers gate follow-on work
 * (e.g. writing the `branch.<branch>.linearIssue` marker) on the result so
 * they don't emit a second, contradictory warning about a branch that was
 * never created.
 */
export function gitCheckoutBranch(branchName: string): boolean {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			stdio: "pipe",
		});
	} catch {
		outputWarning("Not inside a git repository — skipping branch checkout.");
		return false;
	}
	// `--` separates the new-branch name from any ref. Without it, a
	// branch name starting with `-` (server bug, malicious team member
	// crafting an issue title that survives slugification, or a forked
	// Linear-compatible API) would be parsed as a git flag rather than
	// a ref. The default `feature/` prefix from `toBranchName` already
	// blocks the common case, but the prefix is configurable — empty-
	// prefix callers would lose the defense without this terminator.
	// Defense-in-depth (DEV-4064).
	execFileSync("git", ["checkout", "-b", branchName, "--"], { stdio: "pipe" });
	return true;
}

// First Linear-style identifier token in a branch name, in any position, so
// it survives a configurable prefix (`feature/DEV-123-slug`) and the bare
// Linear shape (`dev-123-slug`). Anchored on a non-word boundary so it
// doesn't match mid-token.
const BRANCH_IDENTIFIER_REGEX =
	/(?:^|[^A-Za-z0-9])([A-Za-z]+-\d+)(?![A-Za-z0-9])/;

/**
 * Extract the canonical (uppercase) Linear identifier embedded in a branch
 * name — `feature/DEV-4293-slug` → `DEV-4293`, `dev-4293-slug` → `DEV-4293`.
 * Returns null when the branch carries no identifier token.
 */
export function extractIssueIdentifierFromBranch(
	branch: string,
): string | null {
	const match = branch.match(BRANCH_IDENTIFIER_REGEX);
	return match ? match[1].toUpperCase() : null;
}

/**
 * Record the Linear issue a branch implements as durable git metadata:
 * `git config branch.<branch>.linearIssue <identifier>`. This is the signal
 * DEV-4241's PreToolUse hook reads to confirm a workflow was established
 * before allowing tracked-file edits — far more robust than parsing the
 * branch name shape (which legitimately varies: `dev-4083-slug`,
 * `fe-630-slug`, `emw-280-slug`), and it stays fast + offline (a local
 * git config read, no API call).
 *
 * Best-effort by design: a failure to write the marker must never abort the
 * issue-creation flow that triggered it. Callers in a known-good repo
 * context wrap this and warn on failure; the standalone `mark-branch`
 * command does its own repo/branch validation first so it can surface a
 * clear error instead.
 *
 * No `--` ref-terminator (unlike the checkout/rename calls above): `git
 * config <key> <value>` takes exactly two positional operands, the key is
 * always our `branch.`-prefixed literal, and a value beginning with `-` is
 * stored verbatim rather than parsed as a flag — so there's no
 * flag-injection surface to defend here.
 */
export function setBranchLinearIssue(branch: string, identifier: string): void {
	execFileSync("git", ["config", `branch.${branch}.linearIssue`, identifier], {
		stdio: "pipe",
	});
}

/**
 * Read back the `branch.<branch>.linearIssue` marker, or null when unset.
 */
export function getBranchLinearIssue(branch: string): string | null {
	try {
		return execFileSync(
			"git",
			["config", "--get", `branch.${branch}.linearIssue`],
			{ stdio: "pipe" },
		)
			.toString()
			.trim();
	} catch {
		return null;
	}
}

/**
 * Current branch's short name, or null when detached / not in a repo.
 *
 * Uses `symbolic-ref` rather than `rev-parse --abbrev-ref`: the former
 * resolves the name even on an unborn branch (fresh repo, no commits yet)
 * and still fails — yielding null — on a detached HEAD, which is exactly
 * the "no named branch" signal callers want.
 */
export function currentGitBranch(): string | null {
	try {
		return execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
			stdio: "pipe",
		})
			.toString()
			.trim();
	} catch {
		return null;
	}
}
