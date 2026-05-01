import { createGraphQLService } from "../utils/graphql-service.js";
import { outputWarning } from "../utils/output.js";
import { isUuid, isUuidPrefix } from "../utils/uuid.js";
import { loadConfig } from "./config.js";

/**
 * Resolve a team key/name/alias to its UUID.
 * Case-insensitive: "fe" → FE UUID, "frontend" → FE UUID via alias.
 */
export function resolveTeam(input: string): string {
	if (isUuid(input)) {
		return input;
	}

	const config = loadConfig();
	const upper = input.toUpperCase();
	const lower = input.toLowerCase();

	// Check direct key match (case-insensitive)
	if (config.teams[upper]) {
		return config.teams[upper];
	}

	// Check aliases (case-insensitive) → resolve to team key → then to UUID
	for (const [alias, teamKey] of Object.entries(config.teamAliases)) {
		if (alias.toLowerCase() === lower) {
			const uuid = config.teams[teamKey.toUpperCase()];
			if (uuid) {
				return uuid;
			}
		}
	}

	// Return input as-is for API resolution
	return input;
}

/**
 * Resolve a member name/alias/handle to their UUID.
 * Supports: "bob" → alias, "Alice" → name, "@alice-handle" → gitlab handle. Case-insensitive.
 */
export function resolveMember(input: string): string {
	if (isUuid(input)) {
		return input;
	}

	const config = loadConfig();
	// Strip leading @ (common in git/platform handles)
	const cleaned = input.startsWith("@") ? input.slice(1) : input;
	const lower = cleaned.toLowerCase();

	// Check aliases first (case-insensitive)
	for (const [alias, name] of Object.entries(config.members.aliases)) {
		if (alias.toLowerCase() === lower) {
			const uuid = config.members.uuids[name];
			if (uuid) {
				return uuid;
			}
		}
	}

	// Check platform handles (gitlab, github, etc.)
	for (const handleMap of Object.values(config.members.handles)) {
		for (const [handle, name] of Object.entries(handleMap)) {
			if (handle.toLowerCase() === lower) {
				const uuid = config.members.uuids[name];
				if (uuid) {
					return uuid;
				}
			}
		}
	}

	// Check direct name match (case-insensitive) — e.g., "David"
	for (const [name, uuid] of Object.entries(config.members.uuids)) {
		if (name.toLowerCase() === lower) {
			return uuid;
		}
	}

	// Check full names (case-insensitive) — e.g., "David Doe"
	if (config.members.fullNames) {
		for (const [uuid, fullName] of Object.entries(config.members.fullNames)) {
			if (fullName.toLowerCase() === lower) {
				return uuid;
			}
		}

		// Partial match on full names — e.g., "doe" matches "David Doe"
		for (const [uuid, fullName] of Object.entries(config.members.fullNames)) {
			const parts = fullName.toLowerCase().split(/\s+/);
			if (parts.some((part) => part === lower)) {
				return uuid;
			}
		}
	}

	// Return input as-is for API resolution
	return input;
}

/**
 * Resolve an assignee input to a UUID, supporting "me" to refer to the API token owner.
 * Falls back to resolveMember for all other inputs.
 */
export async function resolveAssignee(
	input: string,
	rootOpts: Record<string, unknown>,
): Promise<string> {
	if (input.toLowerCase() === "me") {
		const graphQLService = createGraphQLService(rootOpts);
		const result = await graphQLService.rawRequest("{ viewer { id } }");
		const viewer = result.viewer as Record<string, unknown> | undefined;
		if (!viewer?.id) {
			throw new Error(
				'Could not resolve "me" — viewer query returned no user. Check your API token.',
			);
		}
		return viewer.id as string;
	}
	return resolveMember(input);
}

/**
 * Resolve a user's display name from their UUID via config fullNames map.
 * Returns the full name if found, otherwise returns the original name.
 */
export function resolveUserDisplayName(id: string, name: string): string {
	const config = loadConfig();
	return config.members.fullNames[id] || name;
}

/**
 * Look up a label name in a label map (case-insensitive).
 * Returns the UUID if valid, null if found but invalid/truncated, undefined if not found.
 */
function lookupLabel(
	labelMap: Record<string, string>,
	lower: string,
	context?: string,
): string | null | undefined {
	for (const [labelName, uuid] of Object.entries(labelMap)) {
		if (labelName.toLowerCase() !== lower) {
			continue;
		}
		if (isUuid(uuid)) {
			return uuid;
		}
		if (isUuidPrefix(uuid)) {
			const scope = context ? ` (${context})` : "";
			outputWarning(
				`Config label "${labelName}"${scope} has truncated UUID "${uuid}". Falling back to API resolution.`,
			);
		}
		return null;
	}
	return undefined;
}

/** Common label abbreviations → canonical names */
const LABEL_ALIASES: Record<string, string> = {
	docs: "documentation",
	doc: "documentation",
	feat: "feature-request",
	infra: "infrastructure",
	fe: "frontend",
	be: "backend",
	ci: "ci/cd",
};

/**
 * Resolve a label name to its UUID for a specific team.
 * Checks workspace-level labels first, then team-scoped labels.
 * Falls back to alias resolution and prefix matching.
 */
function resolveLabel(name: string, teamKey?: string): string | null {
	if (isUuid(name)) {
		return name;
	}

	const config = loadConfig();
	const lower = name.toLowerCase();

	const workspace = lookupLabel(config.labels.workspace, lower);
	if (workspace !== undefined) {
		return workspace;
	}

	if (teamKey) {
		const upper = teamKey.toUpperCase();
		const teamLabels = config.labels.teams[upper];
		if (teamLabels) {
			const team = lookupLabel(teamLabels, lower, `team ${upper}`);
			if (team !== undefined) {
				return team;
			}
		}
	}

	// Try alias resolution — e.g., "docs" → "documentation"
	const aliased = LABEL_ALIASES[lower];
	if (aliased) {
		return resolveLabel(aliased, teamKey);
	}

	return null;
}

/**
 * Resolve labels for a team, returning UUIDs for known labels.
 * Unknown labels are returned as-is for API resolution.
 */
export function resolveLabels(names: string[], teamKey?: string): string[] {
	return names.map((name) => {
		const resolved = resolveLabel(name, teamKey);
		return resolved || name;
	});
}
