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

/**
 * Raw GraphQL is used here instead of `LinearService` / `client.team(id)`
 * because we need three connections (projects, members, labels) in a
 * single round-trip, gated on which fields the validator actually flagged
 * as missing. Going through the SDK would mean three sequential
 * `.projects()` / `.members()` / `.labels()` calls (the SDK's
 * connection-resolver promises don't batch), which doubles the
 * worst-case latency of an already-on-the-error-path enrichment.
 *
 * Per CLAUDE.md "prefer @linear/sdk over raw GraphQL" rule: this is the
 * "batching with @include directives" exception. Revisit if `@linear/sdk`
 * ever exposes a multi-connection batch helper.
 */
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
 * Best shell-safe token to identify this user on the command line.
 *
 * Preference order:
 *   1. Config alias (always single-token, e.g. "dima")
 *   2. Email (stable, no spaces, no shell metacharacters)
 *   3. POSIX-quoted displayName (last resort — single-quoted via
 *      `shellQuote` so a name like `Kamal M`, `O'Brien`, or one
 *      containing `$`/backtick/`\\` doesn't get split or expanded by
 *      the shell on retry).
 *
 * The retryability is the point: the suggestion must paste back into the
 * same `el-linear issues create ... --assignee <token>` without further
 * escaping by the caller. The displayName branch uses the same POSIX
 * single-quote helper as the rest of the retry command so the escaping
 * contract is uniform — no asymmetric "quote with double quotes here,
 * single quotes there" trap for future maintainers.
 */
function bestAssigneeToken(
	name: string,
	displayName: string | undefined,
	email: string | undefined,
): string {
	const config = loadConfig();
	for (const [alias, configName] of Object.entries(config.members.aliases)) {
		if (configName.toLowerCase() === name.toLowerCase()) {
			return alias;
		}
	}
	if (email && email.trim().length > 0) {
		return email;
	}
	const label = displayName || name;
	if (/\s/.test(label) || /['"`$\\]/.test(label)) {
		return shellQuote(label);
	}
	return label;
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
		.map(
			(m) =>
				`    --assignee ${bestAssigneeToken(m.name, m.displayName, m.email)}`,
		);
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

	// Append a single copy-pasteable retry command after the last enriched
	// error, so the agent has one concrete line to run instead of having to
	// stitch together fragments from each error's suggestion block.
	const retry = formatRetryCommand({
		title: options.title,
		team: options.team,
		classifications,
		projects,
		members,
		labels,
		typeLabels,
		inferred,
	});
	if (retry) {
		const lastIdx = result.errors.length - 1;
		result.errors[lastIdx] = `${result.errors[lastIdx]}\n\n${retry}`;
	}
}

/**
 * Pattern for the `Project "X" not found` error shape thrown by
 * `LinearService.resolveProjectId` (both name and slug-id paths) and the
 * batched issues-service project resolver. Matches the message body and
 * captures the user's original input so the synthesized enrichment error
 * can reference it.
 *
 * Start-anchored to avoid a false-positive when the substring appears
 * inside an unrelated error. Greedy `.+` with `\.?` tail handles project
 * names that themselves contain quotes — the regex backtracks from the
 * final `" not found.` to find the longest valid identifier (`notFoundError`
 * always ends with a period, so the tail is a stable terminator).
 */
const PROJECT_NOT_FOUND_PATTERN = /^Project "(.+)" not found\.?/;

/**
 * Enrich a project resolver failure ({@link PROJECT_NOT_FOUND_PATTERN})
 * with the same team-scoped suggestions that {@link enrichValidationErrors}
 * appends to `Missing --project` validation errors. Returns the original
 * message unchanged if the error doesn't match or `--team` is unknown.
 *
 * The validation path covers "user forgot `--project`"; this path covers
 * "user pasted a URL/slug/name that didn't resolve" — same recovery hints
 * apply in both cases. Synthesizes a `Missing --project: …` error string
 * so the existing classifier and suggestion code can be reused without
 * special-casing the resolver shape.
 *
 * Best-effort like `enrichValidationErrors`: any failure (network, unknown
 * team, GraphQL error) returns the original message unchanged. The caller
 * is expected to rethrow with the returned message.
 */
export async function enrichProjectResolverError(
	originalMessage: string,
	options: EnrichOptions,
	services: { graphQLService: GraphQLService; linearService: LinearService },
): Promise<string> {
	const match = originalMessage.match(PROJECT_NOT_FOUND_PATTERN);
	if (!match || !options.team) {
		return originalMessage;
	}
	const projectInput = match[1];

	const synthetic: ValidationResult = {
		errors: [
			`Missing --project: "${projectInput}" did not resolve to any project on team ${options.team}.`,
		],
		warnings: [],
		normalizedLabels: null,
	};

	try {
		await enrichValidationErrors(synthetic, options, services);
	} catch {
		return originalMessage;
	}

	// If enrichment didn't actually append a suggestions block, fall back
	// to the original — better a clean error than a stuttering one with
	// just the synthetic preamble and no concrete options.
	if (
		synthetic.errors.length === 0 ||
		!synthetic.errors[0].includes("Suggestions")
	) {
		return originalMessage;
	}

	return synthetic.errors[0];
}

interface RetryContext {
	classifications: ReturnType<typeof classifyError>[];
	inferred: { verb: string; type: string } | null;
	labels: GqlNode[];
	members: GqlNode[];
	projects: GqlNode[];
	team: string | undefined;
	title: string | undefined;
	typeLabels: string[];
}

/**
 * Build one copy-pasteable `el-linear issues create ...` command using the
 * top-ranked suggestion for each missing field. Returns null when there's
 * nothing useful to retry with (no team, or every suggestion source was empty).
 *
 * All values are shell-quoted with single quotes (POSIX), so titles, project
 * names, and display names with spaces or special characters paste safely.
 */
function formatRetryCommand(ctx: RetryContext): string | null {
	if (!ctx.team) {
		return null;
	}
	const parts: string[] = ["el-linear issues create"];
	parts.push(shellQuote(ctx.title ?? "<title>"));
	parts.push(`--team ${shellQuote(ctx.team)}`);

	const missing = new Set(
		ctx.classifications.filter((c): c is NonNullable<typeof c> => c !== null),
	);

	if (missing.has("project")) {
		const top = ctx.projects.find((p) => p.name);
		if (!top?.name) {
			return null;
		}
		parts.push(`--project ${shellQuote(top.name)}`);
	}

	if (missing.has("assignee")) {
		const top = ctx.members.find((m) => m.name);
		if (!top?.name) {
			return null;
		}
		// Token is already shell-safe (alias, email, or pre-quoted display name).
		parts.push(
			`--assignee ${bestAssigneeToken(top.name, top.displayName, top.email)}`,
		);
	}

	if (missing.has("labels") || missing.has("type-label")) {
		const typeLabel =
			ctx.inferred && ctx.typeLabels.includes(ctx.inferred.type)
				? ctx.inferred.type
				: ctx.typeLabels[0];
		if (!typeLabel) {
			return null;
		}
		const domain = pickDomainHint(ctx.labels, ctx.typeLabels);
		const labelArg =
			domain === "<domain>" ? typeLabel : `${typeLabel},${domain}`;
		parts.push(`--labels ${shellQuote(labelArg)}`);
	}

	parts.push("--description '<describe the change and the motivation>'");

	return `  Retry with:\n    ${parts.join(" ")}`;
}

/** POSIX single-quote escape: 'foo' → 'foo', it's → 'it'\''s'. */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
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
	if (kind === "labels" || kind === "type-label") {
		// Both branches benefit from the verb→type inference hint plus
		// the canonical-types + domain-labels suggestion block. Sharing
		// the decorator keeps them in lockstep: a user who passed a
		// non-type label (type-label error) sees the same "title verb
		// suggests type X" guidance as one who passed no labels at all.
		return decorateLabelsError(message, ctx);
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
