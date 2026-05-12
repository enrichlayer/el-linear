/**
 * Step 2 of the wizard: workspace defaults.
 *
 * Auto-fetches the Linear workspace urlKey (no prompt) since it's deterministic.
 * Lets the user pick a default team, optional. Skip-by-default.
 */

import { confirm, select } from "@inquirer/prompts";
import { GraphQLService } from "../../utils/graphql-service.js";
import type { WizardConfig } from "./shared.js";

const TEAMS_QUERY = /* GraphQL */ `
  query InitTeams {
    teams(first: 100) {
      nodes {
        id
        key
        name
      }
    }
  }
`;

interface TeamsResponse {
	teams: { nodes: Array<{ id: string; key: string; name: string }> };
}

interface WorkspaceStepResult {
	workspaceUrlKey: string;
	defaultTeam: string | undefined;
	teams: Record<string, string>;
}

/**
 * Run the workspace step. Reads existing config to default the team picker
 * to the current default. Returns values to merge into the on-disk config.
 *
 * No-op safe: if the user keeps everything as-is, returns values that match
 * the existing config exactly.
 */
export async function runWorkspaceStep(
	token: string,
	workspaceUrlKey: string,
	existing: WizardConfig,
): Promise<WorkspaceStepResult> {
	const service = new GraphQLService({ apiKey: token });

	// Fetch teams once so we can populate both the picker and the cached id map.
	const data = await service.rawRequest<TeamsResponse>(TEAMS_QUERY);
	const teams = data?.teams?.nodes ?? [];
	const teamMap: Record<string, string> = {};
	for (const t of teams) {
		teamMap[t.key] = t.id;
	}

	console.log(`  Workspace: ${workspaceUrlKey} (${teams.length} teams)`);

	const currentDefault = existing.defaultTeam || "";
	// `change` reflects what the user agreed to: `true` means "open the picker
	// and change the default team", `false` means "leave the existing config
	// alone". Default false makes pressing enter a no-op (keep-as-is).
	const change = await confirm({
		message: currentDefault
			? `Current default team: ${currentDefault}. Change it?`
			: "Set a default team for new issues?",
		default: false,
	});

	if (!change) {
		return {
			workspaceUrlKey,
			defaultTeam: currentDefault || undefined,
			teams: teamMap,
		};
	}

	if (teams.length === 0) {
		console.log(
			"  No teams visible to this token. Skipping default-team picker.",
		);
		return {
			workspaceUrlKey,
			defaultTeam: currentDefault || undefined,
			teams: teamMap,
		};
	}

	const choice = await select<string | "__skip">({
		message: "Default team:",
		choices: [
			...teams.map((t) => ({
				name: `${t.key}${t.name && t.name !== t.key ? ` — ${t.name}` : ""}`,
				value: t.key,
			})),
			{ name: "(no default — pick per-issue)", value: "__skip" as const },
		],
		default: currentDefault || teams[0]?.key,
	});

	return {
		workspaceUrlKey,
		defaultTeam: choice === "__skip" ? undefined : choice,
		teams: teamMap,
	};
}
