/**
 * `el-linear branch validate [branch]` — validate that a branch name carries a
 * **real** Linear team prefix, checked against the workspace's actual teams
 * (cached `teams list`) rather than a hand-maintained allowlist.
 *
 * Built so the tools-repo pre-commit gate (`check-linear-branch.sh`) can
 * delegate team-validity here instead of hardcoding a bash regex that drifts
 * (it already did: phantom `CS`, missing `CUS/EMW/NIC/PYT`). Branch *parsing*
 * already lives in `issue-id`/`parseBranchName`; this adds team *validity*.
 *
 * Exit codes (so a caller can distinguish "block" from "fall back"):
 *   0 — valid: a real team, or an exempt branch (main/master/detached/empty)
 *   1 — invalid: parsed a team that isn't a real workspace team, or no Linear ID
 *   2 — indeterminate: the team set couldn't be loaded (offline + cold cache);
 *       lets the caller fall back to its own check rather than hard-block
 *
 * `--exit-zero` reports the JSON verdict but always exits 0 (report-only).
 */

import type { Command, OptionValues } from "commander";
import { loadConfig } from "../config/config.js";
import { cached, resolveCacheTTL } from "../utils/disk-cache.js";
import { createLinearService } from "../utils/linear-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { getCurrentBranch, parseBranchName } from "./issue-id.js";
import { TEAMS_LIST_DEFAULT_LIMIT } from "./teams.js";

// Branches that never carry a Linear ID and must not be blocked. Mirrors the
// exemptions in the tools-repo gate (main/master/detached HEAD/empty).
const EXEMPT_BRANCHES = new Set(["main", "master", "HEAD", ""]);

export function setupBranchCommands(program: Command): void {
	const branch = program.command("branch").description("Branch-name helpers");
	branch.action(() => branch.help());

	branch
		.command("validate [branch]")
		.description(
			"Validate a branch's team prefix against real workspace teams. Exit 0 valid, 1 invalid, 2 indeterminate.",
		)
		.option(
			"--exit-zero",
			"report the verdict as JSON but always exit 0 (report-only)",
			false,
		)
		.action(
			handleAsyncCommand(
				async (
					branchArg: string | undefined,
					options: OptionValues,
					command: Command,
				) => {
					const branchName = branchArg ?? getCurrentBranch();

					if (EXEMPT_BRANCHES.has(branchName)) {
						outputSuccess({
							branch: branchName,
							valid: true,
							team: null,
							issueId: null,
							reason: "exempt",
						});
						return;
					}

					const parsed = parseBranchName(branchName);
					if (!(parsed.issueId && parsed.team)) {
						outputSuccess({
							branch: branchName,
							valid: false,
							team: null,
							issueId: null,
							reason: "no-linear-id",
						});
						if (!options.exitZero) process.exitCode = 1;
						return;
					}

					let teamKeys: string[];
					try {
						const rootOpts = getRootOpts(command);
						const ttl = resolveCacheTTL({
							configTTL: loadConfig().cacheTTLSeconds,
							noCacheFlag: rootOpts.cache === false,
						});
						// Same cache key and limit as `teams list` default — share the entry.
						const teams = await cached(
							`teams-list-limit:${TEAMS_LIST_DEFAULT_LIMIT}`,
							ttl,
							async () => {
								const service = await createLinearService(rootOpts);
								return service.getTeams(TEAMS_LIST_DEFAULT_LIMIT);
							},
						);
						teamKeys = teams.map((t) => t.key);
					} catch {
						// Couldn't load the team set (offline + cold cache). Signal
						// indeterminate so the caller can fall back instead of blocking.
						outputSuccess({
							branch: branchName,
							valid: null,
							team: parsed.team,
							issueId: parsed.issueId,
							reason: "teams-unavailable",
						});
						if (!options.exitZero) process.exitCode = 2;
						return;
					}

					const valid = teamKeys.includes(parsed.team);
					outputSuccess({
						branch: branchName,
						valid,
						team: parsed.team,
						issueId: parsed.issueId,
						reason: valid ? "ok" : "unknown-team",
						...(valid ? {} : { knownTeams: teamKeys }),
					});
					if (!(valid || options.exitZero)) process.exitCode = 1;
				},
			),
		);
}
