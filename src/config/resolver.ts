import { createGraphQLService } from "../utils/graphql-service.js";
import { outputWarning } from "../utils/output.js";
import { isUuid, isUuidPrefix } from "../utils/uuid.js";
import { loadConfig } from "./config.js";
import { resolveViaCommand } from "./identity-resolver.js";
import {
	isRegistryConfigured,
	resolveViaRegistry,
} from "./registry-resolve.js";

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
		const graphQLService = await createGraphQLService(rootOpts);
		const result = await graphQLService.rawRequest<{
			viewer: { id: string } | null;
		}>("{ viewer { id } }");
		if (!result.viewer?.id) {
			throw new Error(
				'Could not resolve "me" — viewer query returned no user. Check your API token.',
			);
		}
		return result.viewer.id;
	}
	return resolveMemberWithRegistry(input);
}

/**
 * Resolve a member identifier (alias / handle / name) to a UUID. The shared
 * async resolution path behind `--assignee` and `--delegate` (DEV-4871 /
 * DEV-4872 / DEV-5628).
 *
 * Order, most authoritative first:
 *
 *   1. **The identity-resolver hook** (`identity.resolver`, DEV-5628) — an
 *      operator-supplied command. This is the one to reach for: it can answer
 *      for aliases and cross-system handles Linear has never heard of, and it
 *      owns its own credentials, so el-linear carries no auth scheme.
 *   2. **The HTTP registry** (`EL_IDENTITY_URL`, DEV-4871) — the older,
 *      env-gated path. Superseded by (1), which needs no URL or CF-Access
 *      credentials in the environment. Kept because it ships and someone may
 *      rely on it.
 *   3. **The bundled config** (`resolveMember`) — a local lookup table.
 *
 * All three are optional. With none of them, `resolveMember` hands the raw input
 * back and Linear's own user lookup resolves it (`LinearService.resolveUserId`
 * matches email → displayName → name), which is why an install with no config at
 * all still works.
 *
 * Fail-open throughout: a miss or a failure at any layer falls through to the
 * next. Never throws.
 */
export async function resolveMemberWithRegistry(
	input: string,
): Promise<string> {
	// UUIDs are already canonical — don't spend a subprocess on them.
	if (isUuid(input)) {
		return input;
	}

	const viaCommand = resolveViaCommand(input, loadConfig());
	if (viaCommand) {
		return viaCommand;
	}

	if (isRegistryConfigured()) {
		const viaRegistry = await resolveViaRegistry(input);
		if (viaRegistry) {
			return viaRegistry;
		}
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
 *
 * Labels that don't map to a config UUID are returned as their canonical
 * (alias-expanded) name — e.g. `docs` becomes `documentation` — so the
 * API-side resolver matches the right label rather than auto-creating one
 * under the abbreviation. Pass no `teamKey` to defer team-scoped labels to
 * API resolution: a team-scoped config UUID is only valid for that team,
 * so resolving it here is wrong whenever the team is decided later (e.g.
 * the create flow auto-switches the team to match the project).
 */
export function resolveLabels(names: string[], teamKey?: string): string[] {
	return names.map((name) => {
		const resolved = resolveLabel(name, teamKey);
		return resolved || LABEL_ALIASES[name.toLowerCase()] || name;
	});
}
