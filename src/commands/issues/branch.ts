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

/**
 * Local bookmark names at `revset`, or `[]` when jj cannot answer.
 *
 * `local_bookmarks`, NOT `bookmarks`. The two names mean different things in
 * jj's two languages and the mistake is silent: the REVSET `bookmarks()` is
 * local-only, but the TEMPLATE keyword `bookmarks` also emits REMOTE bookmarks
 * as `name@remote`. Using the wrong one resolves the branch to `name@origin`,
 * which is not a branch anyone is on -- and `mark-branch` would then write its
 * marker under that name. Carried deliberately from DEV-8469.
 *
 * The template is `local_bookmarks ++ "\n"` as jj's templating language sees
 * it, so the BACKSLASH has to survive this TypeScript literal -- hence the
 * doubling. Writing a real newline would embed one inside jj's own string.
 *
 * `jj log` is a read verb: it cannot alter history, the working copy, the
 * operation log, or any remote.
 */
function jjBookmarksAt(revset: string): string[] {
	try {
		return execFileSync(
			"jj",
			["log", "-r", revset, "--no-graph", "-T", 'local_bookmarks ++ "\\n"'],
			{ stdio: "pipe", timeout: 5000 },
		)
			.toString()
			.trim()
			.split(/\s+/)
			.filter((name) => name.length > 0);
	} catch {
		// jj absent, not a jj repo, or the revset resolved to nothing. All three
		// mean "jj does not name this work", which the caller treats as null.
		return [];
	}
}

/**
 * The revsets asked, nearest-first, mirroring DEV-8469's monorepo resolver
 * rung for rung. Each is deliberately the revset it is, and the reasons differ.
 */
const JJ_BOOKMARK_REVSETS = [
	// 1. A bookmark on the working-copy commit itself -- the state immediately
	//    after `jj bookmark create`, and the only rung a plain linear workflow
	//    ever needs.
	"@",
	// 2. The nearest bookmark in `@`'s ancestry. `heads(...)` is what makes it
	//    NEAREST: without it a long stack returns every ancestor bookmark, which
	//    this resolver would read as ambiguous and refuse (DEV-8469).
	"heads(bookmarks() & ::@)",
	// 3. A bookmark elsewhere on this stack. `@-::` is "descendants of `@`'s
	//    parent", which is the only rung that reaches a SIBLING -- where jj's own
	//    recommended conflict-resolution flow leaves `@`, and the case the
	//    original DEV-8220 design missed.
	//
	//    NOT the obvious-looking `mutable()`: that depends on the
	//    `immutable_heads`/`trunk()` configuration, and `trunk()` silently
	//    degrades to `root()` whenever `main@origin` is absent -- the normal state
	//    of a `--single-branch` pilot clone. A resolver whose correctness depends
	//    on configuration that is broken by default is not a resolver (DEV-8469).
	"bookmarks() & @-::",
] as const;

/**
 * The jj bookmark naming the current work, or `null` when there is not exactly
 * one -- a FALLBACK for `currentGitBranch()`, never a replacement.
 *
 * WHY THIS EXISTS. In a colocated jj repo `.git/HEAD` points at `@`'s PARENT,
 * so from the first `jj new` onward git reports a detached HEAD and
 * `currentGitBranch()` correctly returns null -- while a jj bookmark names the
 * work perfectly well. Without this, `issues mark-branch` is simply unusable
 * inside a jj pilot clone (DEV-8479).
 *
 * WHY A LOCAL COPY rather than importing the monorepo's resolver: el-linear
 * ships from a separate MIT repository with four lean runtime dependencies, and
 * `@enrichlayer/shared-contracts` is a broad internal contract surface that is
 * deliberately not published. This duplicates one rung-ladder, not a module.
 * The tools-side note in `docs/jj-working-layer.md` records the duplication so
 * it is findable rather than discovered later as drift.
 *
 * THE LADDER is JJ_BOOKMARK_REVSETS above, nearest-first: each rung is more
 * specific than the next, so the first rung that answers wins. The reasoning
 * for each revset sits on the revset itself.
 *
 * AMBIGUITY IS NULL, not a guess. When a rung returns more than one bookmark
 * there is no basis for choosing, and `mark-branch` would write its marker
 * under the wrong name. Falling through to a LATER rung would be worse still --
 * it would answer with a bookmark strictly less relevant than the ambiguous
 * ones. So the ladder stops and the caller fails loudly, which is el-linear's
 * existing posture for "no named branch".
 */
export function currentJjBookmark(): string | null {
	for (const revset of JJ_BOOKMARK_REVSETS) {
		const names = jjBookmarksAt(revset);
		if (names.length === 1) {
			return names[0];
		}
		if (names.length > 1) {
			return null;
		}
	}
	return null;
}
