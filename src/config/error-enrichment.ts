/**
 * Validation error enrichment.
 *
 * When `validateIssueCreation` flags a missing required field AND `--team`
 * is set, this module fetches concrete team-scoped suggestions (active
 * projects, active members, valid labels) and appends a "Suggestions:" block
 * to each relevant error message.
 *
 * Goal: reduce the agent's loop time. A single error should carry enough
 * concrete options that the agent can rebuild a complete retry command
 * without follow-up `projects list` / `users list` / `labels list` calls.
 *
 * Latency budget: enrichment only runs on the validation-fail path. The
 * success path is unchanged. Fetches run in parallel and only for the fields
 * that are actually missing.
 */

import type { GraphQLService } from "../utils/graphql-service.js";
import type { LinearService } from "../utils/linear-service.js";
import { isUuid } from "../utils/uuid.js";
import { loadConfig } from "./config.js";
import {
	getCanonicalTypeLabels,
	inferTypeFromTitle,
	type ValidationResult,
} from "./issue-validation.js";
import { resolveTeam } from "./resolver.js";

interface GqlNode {
	active?: boolean;
	displayName?: string;
	email?: string;
	id: string;
	isGroup?: boolean;
	name?: string;
	state?: string;
}

interface GqlConnection {
	nodes: GqlNode[];
}

interface GqlTeamResult {
	team: {
		id: string;
		key: string;
		name: string;
		projects?: GqlConnection;
		members?: GqlConnection;
		labels?: GqlConnection;
	} | null;
}

const TEAM_SUGGESTIONS_QUERY = `
  query TeamSuggestions(
    $teamId: String!
    $includeProjects: Boolean!
    $includeMembers: Boolean!
    $includeLabels: Boolean!
  ) {
    team(id: $teamId) {
      id
      key
      name
      projects(
        filter: { state: { in: ["started", "backlog", "planned"] } }
        orderBy: updatedAt
        first: 5
      ) @include(if: $includeProjects) {
        nodes { id name state }
      }
      members(
        filter: { active: { eq: true } }
        first: 8
      ) @include(if: $includeMembers) {
        nodes { id name displayName email active }
      }
      labels(first: 50) @include(if: $includeLabels) {
        nodes { id name isGroup }
      }
    }
  }
`;

/**
 * What kind of "missing field" each error represents, derived from the
 * error message prefix. Returns null for errors we don't enrich.
 */
function classifyError(
	error: string,
): "project" | "assignee" | "labels" | "type-label" | null {
	if (error.startsWith("Missing --project")) {
		return "project";
	}
	if (error.startsWith("Missing --assignee")) {
		return "assignee";
	}
	if (error.startsWith("Missing --labels")) {
		return "labels";
	}
	if (error.startsWith("Missing type label")) {
		return "type-label";
	}
	return null;
}

interface EnrichOptions {
	team?: string;
	title?: string;
}

/**
 * Resolve the team input to a Linear UUID.
 * Tries the synchronous config-based resolver first (no API call). Falls back
 * to LinearService.resolveTeamId for inputs not in config.
 */
async function resolveTeamUuid(
	team: string,
	linearService: LinearService,
): Promise<string | null> {
	const resolved = resolveTeam(team);
	if (isUuid(resolved)) {
		return resolved;
	}
	try {
		return await linearService.resolveTeamId(team);
	} catch {
		return null;
	}
}

/**
 * Look up an alias for a member name from config. Falls back to displayName
 * (or name) when no alias is configured.
 */
function aliasOrDisplay(name: string, displayName?: string): string {
	const config = loadConfig();
	for (const [alias, configName] of Object.entries(config.members.aliases)) {
		if (configName.toLowerCase() === name.toLowerCase()) {
			return alias;
		}
	}
	return displayName || name;
}

function formatProjectSuggestions(projects: GqlNode[]): string {
	if (projects.length === 0) {
		return "  Suggestions: no active projects found on this team.";
	}
	const lines = projects
		.filter((p): p is GqlNode & { name: string } => Boolean(p.name))
		.map((p) => `    --project "${p.name}"`);
	return `  Suggestions (top active projects on this team):\n${lines.join("\n")}`;
}

function formatAssigneeSuggestions(members: GqlNode[]): string {
	if (members.length === 0) {
		return "  Suggestions: no active members found on this team.";
	}
	const lines = members
		.filter((m): m is GqlNode & { name: string } => Boolean(m.name))
		.map((m) => `    --assignee ${aliasOrDisplay(m.name, m.displayName)}`);
	return `  Suggestions (active team members):\n${lines.join("\n")}`;
}

interface LabelSuggestionContext {
	inferred: { verb: string; type: string } | null;
	labels: GqlNode[];
	typeLabels: string[];
}

function formatLabelSuggestions(ctx: LabelSuggestionContext): string {
	const { labels, typeLabels, inferred } = ctx;

	// Domain labels = team labels that are NOT type labels and NOT groups.
	const typeSet = new Set(typeLabels.map((t) => t.toLowerCase()));
	const domainLabels = labels
		.filter((l) => !l.isGroup && l.name)
		.filter((l) => !typeSet.has((l.name as string).toLowerCase()))
		.slice(0, 5)
		.map((l) => l.name as string);

	// Order type labels: inferred type first if it matches one of typeLabels.
	let orderedTypes = [...typeLabels];
	if (inferred && typeLabels.includes(inferred.type)) {
		orderedTypes = [
			inferred.type,
			...typeLabels.filter((t) => t !== inferred.type),
		];
	}

	const typeLines = orderedTypes
		.slice(0, 5)
		.map((t) =>
			inferred && t === inferred.type
				? `    ${t}    # inferred from title verb "${inferred.verb}"`
				: `    ${t}`,
		);

	const out: string[] = [];
	out.push("  Suggestions:");
	out.push("    Valid type labels (pick one):");
	out.push(...typeLines.map((l) => `  ${l}`));
	if (domainLabels.length > 0) {
		out.push(
			`    Common domain labels on this team: ${domainLabels.join(", ")}`,
		);
	}
	return out.join("\n");
}

/**
 * Enrich validation errors with team-scoped suggestions.
 *
 * Mutates `result.errors` in place — each enrichable error gets a
 * "Suggestions:" block appended. Verb→type inference is added as a prefixed
 * "Inferred from title:" line on the `--labels` missing error.
 *
 * No-op when `--team` is not set or when there are no errors to enrich.
 * Safe to call on the failure path only — never invoked when validation
 * passes, so the success path's latency is unchanged.
 *
 * Failures (network, unknown team) are swallowed: enrichment is a best-effort
 * UX hint, not part of the validation contract.
 */
export async function enrichValidationErrors(
	result: ValidationResult,
	options: EnrichOptions,
	services: { graphQLService: GraphQLService; linearService: LinearService },
): Promise<void> {
	if (!options.team || result.errors.length === 0) {
		return;
	}

	// Figure out which suggestion types we actually need.
	const classifications = result.errors.map(classifyError);
	const needProjects = classifications.includes("project");
	const needMembers = classifications.includes("assignee");
	const needLabels =
		classifications.includes("labels") ||
		classifications.includes("type-label");

	if (!(needProjects || needMembers || needLabels)) {
		return;
	}

	// Resolve team to UUID. Bail if we can't — no enrichment possible.
	const teamId = await resolveTeamUuid(options.team, services.linearService);
	if (!teamId) {
		return;
	}

	// Single batched query, only fetching the connections we need.
	let teamData: GqlTeamResult["team"];
	try {
		const res = await services.graphQLService.rawRequest<GqlTeamResult>(
			TEAM_SUGGESTIONS_QUERY,
			{
				teamId,
				includeProjects: needProjects,
				includeMembers: needMembers,
				includeLabels: needLabels,
			},
		);
		teamData = res.team;
	} catch {
		return; // best-effort
	}

	if (!teamData) {
		return;
	}

	const projects = teamData.projects?.nodes ?? [];
	const members = teamData.members?.nodes ?? [];
	const labels = teamData.labels?.nodes ?? [];
	const typeLabels = getCanonicalTypeLabels();
	const inferred = options.title ? inferTypeFromTitle(options.title) : null;

	for (let i = 0; i < result.errors.length; i++) {
		result.errors[i] = decorateError(result.errors[i], classifications[i], {
			projects,
			members,
			labels,
			typeLabels,
			inferred,
		});
	}
}

interface DecorateContext {
	inferred: { verb: string; type: string } | null;
	labels: GqlNode[];
	members: GqlNode[];
	projects: GqlNode[];
	typeLabels: string[];
}

/**
 * Apply suggestion blocks to a single error message based on its classification.
 * Extracted from enrichValidationErrors to keep that orchestrator small.
 */
function decorateError(
	message: string,
	kind: ReturnType<typeof classifyError>,
	ctx: DecorateContext,
): string {
	if (kind === "project") {
		return `${message}\n${formatProjectSuggestions(ctx.projects)}`;
	}
	if (kind === "assignee") {
		return `${message}\n${formatAssigneeSuggestions(ctx.members)}`;
	}
	if (kind === "labels") {
		return decorateLabelsError(message, ctx);
	}
	if (kind === "type-label") {
		return `${message}\n${formatLabelSuggestions(ctx)}`;
	}
	return message;
}

/**
 * Decorate a "Missing --labels" error with a verb-inference hint (when
 * applicable) plus the standard label suggestions block.
 *
 * Inference is a hint only — the agent must still pass --labels explicitly.
 * We do not auto-apply labels.
 */
function decorateLabelsError(message: string, ctx: DecorateContext): string {
	let body = message;
	if (ctx.inferred && ctx.typeLabels.includes(ctx.inferred.type)) {
		const domainHint = pickDomainHint(ctx.labels, ctx.typeLabels);
		const hint = `Inferred from title: type label "${ctx.inferred.type}" (title starts with "${ctx.inferred.verb}") — suggested: --labels "${ctx.inferred.type},${domainHint}"`;
		body = `${hint}\n${body}`;
	}
	return `${body}\n${formatLabelSuggestions(ctx)}`;
}

/** First non-type, non-team-key label as a placeholder, or "<domain>". */
function pickDomainHint(labels: GqlNode[], typeLabels: string[]): string {
	const typeSet = new Set(typeLabels.map((t) => t.toLowerCase()));
	const teamLikeKeys = new Set(["dev", "fe", "be"]);
	const candidate = labels
		.filter((l) => !l.isGroup && l.name)
		.map((l) => l.name as string)
		.find(
			(n) =>
				!(typeSet.has(n.toLowerCase()) || teamLikeKeys.has(n.toLowerCase())),
		);
	return candidate ?? "<domain>";
}
