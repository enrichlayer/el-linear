import { loadConfig } from "./config.js";

/**
 * Determine the default status based on issue attributes.
 *
 * Rules:
 * - Explicit status always wins (return as-is)
 * - Has assignee + project → "Todo"
 * - Missing assignee OR project → "Triage"
 */
export function resolveDefaultStatus(opts: {
	explicitStatus?: string;
	hasAssignee: boolean;
	hasProject: boolean;
}): string | undefined {
	// Explicit status always wins
	if (opts.explicitStatus) {
		return opts.explicitStatus;
	}

	const config = loadConfig();

	if (opts.hasAssignee && opts.hasProject) {
		return config.statusDefaults.withAssigneeAndProject;
	}

	return config.statusDefaults.noProject;
}
