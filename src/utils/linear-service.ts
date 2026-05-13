import { type IssueLabel, LinearClient } from "@linear/sdk";
import type { LinearCredential } from "../auth/linear-credential.js";
import { getActiveAuth } from "../auth/token-resolver.js";
import { resolveUserDisplayName } from "../config/resolver.js";
import type {
	LinearComment,
	LinearCycleDetail,
	LinearCycleSummary,
	LinearIssue,
	LinearLabel,
	LinearPriority,
	LinearProject,
	LinearTeam,
	LinearUser,
} from "../types/linear.js";
import type { AuthOptions } from "./auth.js";
import { toISOStringOrNow, toISOStringOrUndefined } from "./date-format.js";
import { multipleMatchesError, notFoundError } from "./error-messages.js";
import { parseIssueIdentifier } from "./identifier-parser.js";
import { parseProjectSlugId } from "./project-slug.js";
import { isUuid } from "./uuid.js";

const DEFAULT_CYCLE_PAGINATION_LIMIT = 250;

// The Linear SDK types don't accept string orderBy values, but the API does.
// This helper avoids repeating the double-cast at every call site.
function sdkOrderBy<T>(field: string): T {
	return field as unknown as T;
}

// Filter-building helpers for Linear SDK queries.
function eqFilter(value: unknown): { eq: unknown } {
	return { eq: value };
}

function teamIdFilter(teamId: string): { id: { eq: string } } {
	return { id: { eq: teamId } };
}

function nonEmptyFilter(
	filter: Record<string, unknown>,
): Record<string, unknown> | undefined {
	return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Constructor arg for `LinearService`. Re-exported alias of the shared
 * `LinearCredential` union (`{ apiKey } | { oauthToken }`). See
 * `src/auth/linear-credential.ts` for the contract. The bare-string
 * legacy arm was dropped in DEV-4068 T7.
 */
export type LinearServiceAuth = LinearCredential;

function buildLinearClient(auth: LinearServiceAuth): LinearClient {
	if ("oauthToken" in auth) {
		// Linear's SDK natively supports OAuth via the `accessToken` option,
		// which causes the underlying transport to send
		// `Authorization: Bearer <token>` instead of the personal-token shape.
		return new LinearClient({ accessToken: auth.oauthToken });
	}
	return new LinearClient({ apiKey: auth.apiKey });
}

export class LinearService {
	private readonly client: LinearClient;

	constructor(auth: LinearServiceAuth) {
		this.client = buildLinearClient(auth);
	}

	async resolveIssueId(issueId: string): Promise<string> {
		if (isUuid(issueId)) {
			return issueId;
		}
		const { teamKey, issueNumber } = parseIssueIdentifier(issueId);
		const issues = await this.client.issues({
			filter: {
				number: { eq: issueNumber },
				team: { key: { eq: teamKey } },
			},
			first: 1,
		});
		if (issues.nodes.length === 0) {
			throw notFoundError("Issue", issueId);
		}
		return issues.nodes[0].id;
	}

	async getTeams(limit = 100): Promise<LinearTeam[]> {
		const teamsConnection = await this.client.teams({ first: limit });
		const teams = teamsConnection.nodes.map((team) => ({
			id: team.id,
			key: team.key,
			name: team.name,
			description: team.description || null,
		}));
		return teams.sort((a, b) => a.name.localeCompare(b.name));
	}

	async resolveUserId(nameOrEmailOrId: string): Promise<string> {
		if (isUuid(nameOrEmailOrId)) {
			return nameOrEmailOrId;
		}
		if (nameOrEmailOrId.includes("@")) {
			const byEmail = await this.client.users({
				filter: { email: { eq: nameOrEmailOrId } },
				first: 1,
			});
			if (byEmail.nodes.length > 0) {
				return byEmail.nodes[0].id;
			}
			throw notFoundError("User", nameOrEmailOrId);
		}
		const byDisplay = await this.client.users({
			filter: { displayName: { eqIgnoreCase: nameOrEmailOrId } },
			first: 5,
		});
		if (byDisplay.nodes.length === 1) {
			return byDisplay.nodes[0].id;
		}
		if (byDisplay.nodes.length > 1) {
			throw multipleMatchesError(
				"User",
				nameOrEmailOrId,
				byDisplay.nodes.map((u) => `${u.displayName} (${u.email})`),
				"use the full email or UUID instead",
			);
		}
		const byName = await this.client.users({
			filter: { name: { containsIgnoreCase: nameOrEmailOrId } },
			first: 5,
		});
		if (byName.nodes.length === 1) {
			return byName.nodes[0].id;
		}
		if (byName.nodes.length > 1) {
			throw multipleMatchesError(
				"User",
				nameOrEmailOrId,
				byName.nodes.map((u) => `${u.name} (${u.email})`),
				"use the full email or UUID instead",
			);
		}
		throw notFoundError("User", nameOrEmailOrId);
	}

	async getUsers(
		activeOnly?: boolean,
		limit = 100,
		nameFilter?: string,
	): Promise<LinearUser[]> {
		const filter: Record<string, unknown> = {};
		if (activeOnly) {
			filter.active = eqFilter(true);
		}
		if (nameFilter) {
			filter.name = { containsIgnoreCase: nameFilter };
		}
		const usersConnection = await this.client.users({
			filter: nonEmptyFilter(filter),
			first: limit,
		});
		const users = usersConnection.nodes.map((user) => ({
			id: user.id,
			name: user.name,
			displayName: user.displayName,
			email: user.email,
			active: user.active,
		}));
		return users.sort((a, b) => a.name.localeCompare(b.name));
	}

	async getProjects(
		limit = 100,
		options: {
			nameFilter?: string;
			states?: string[];
			excludeStates?: string[];
		} = {},
	): Promise<LinearProject[]> {
		const filter: Record<string, unknown> = {};
		if (options.nameFilter) {
			filter.name = { containsIgnoreCase: options.nameFilter };
		}
		if (options.states && options.states.length > 0) {
			filter.state = { in: options.states };
		} else if (options.excludeStates && options.excludeStates.length > 0) {
			filter.state = { nin: options.excludeStates };
		}
		const projects = await this.client.projects({
			filter: nonEmptyFilter(filter),
			first: limit,
			orderBy: sdkOrderBy("updatedAt"),
			includeArchived: false,
		});
		const projectsWithData = await Promise.all(
			projects.nodes.map(async (project) => {
				const [teams, lead] = await Promise.all([
					project.teams(),
					project.lead,
				]);
				return { project, teams, lead };
			}),
		);
		return projectsWithData.map(({ project, teams, lead }) => ({
			id: project.id,
			name: project.name,
			description: project.description || undefined,
			state: project.state,
			progress: project.progress,
			teams: teams.nodes.map((team) => ({
				id: team.id,
				key: team.key,
				name: team.name,
			})),
			lead: lead ? { id: lead.id, name: lead.name } : undefined,
			targetDate: toISOStringOrUndefined(project.targetDate),
			createdAt: toISOStringOrNow(project.createdAt),
			updatedAt: toISOStringOrNow(project.updatedAt),
		}));
	}

	async resolveTeamId(teamKeyOrNameOrId: string): Promise<string> {
		if (isUuid(teamKeyOrNameOrId)) {
			return teamKeyOrNameOrId;
		}

		// 1. Exact match via server-side filter (case-sensitive key, case-insensitive name)
		const byKey = await this.client.teams({
			filter: { key: { eq: teamKeyOrNameOrId.toUpperCase() } },
			first: 1,
		});
		if (byKey.nodes.length > 0) {
			return byKey.nodes[0].id;
		}
		const byName = await this.client.teams({
			filter: { name: { eqIgnoreCase: teamKeyOrNameOrId } },
			first: 1,
		});
		if (byName.nodes.length > 0) {
			return byName.nodes[0].id;
		}

		// 2. No exact match — fetch all teams for prefix matching
		let page = await this.client.teams({ first: 50 });
		const allNodes = [...page.nodes];
		while (page.pageInfo.hasNextPage) {
			page = await page.fetchNext();
			allNodes.push(...page.nodes);
		}
		const input = teamKeyOrNameOrId.toLowerCase();

		const prefixMatches = allNodes.filter(
			(team) =>
				team.key.toLowerCase().startsWith(input) ||
				team.name.toLowerCase().startsWith(input),
		);

		if (prefixMatches.length === 1) {
			return prefixMatches[0].id;
		}

		if (prefixMatches.length > 1) {
			throw multipleMatchesError(
				"team",
				teamKeyOrNameOrId,
				prefixMatches.map((t) => `${t.key} (${t.name})`),
				"use a more specific prefix or the full team key",
			);
		}

		// 3. No match
		const available = allNodes.map((t) => `${t.key} (${t.name})`);
		throw notFoundError(
			"Team",
			teamKeyOrNameOrId,
			undefined,
			`\n  Available teams: ${available.join(", ")}`,
		);
	}

	async resolveStatusId(statusName: string, teamId?: string): Promise<string> {
		if (isUuid(statusName)) {
			return statusName;
		}
		const filter: Record<string, unknown> = {
			name: { eqIgnoreCase: statusName },
		};
		if (teamId) {
			filter.team = teamIdFilter(teamId);
		}
		const statuses = await this.client.workflowStates({
			filter,
			first: 1,
		});
		if (statuses.nodes.length === 0) {
			// Fallback: if "Triage" not found, try "Backlog" as a safe default
			if (statusName.toLowerCase() === "triage" && teamId) {
				const fallback = await this.client.workflowStates({
					filter: {
						name: { eqIgnoreCase: "Backlog" },
						team: teamIdFilter(teamId),
					},
					first: 1,
				});
				if (fallback.nodes.length > 0) {
					return fallback.nodes[0].id;
				}
			}
			throw notFoundError(
				"Status",
				statusName,
				teamId ? `for team ${teamId}` : undefined,
			);
		}
		return statuses.nodes[0].id;
	}

	private async buildLabelData(
		label: IssueLabel,
		scope: "team" | "workspace",
		team?: { id: string; key: string; name: string },
	): Promise<LinearLabel> {
		const parent = await label.parent;
		const labelData: LinearLabel = {
			id: label.id,
			name: label.name,
			color: label.color,
			scope,
			team,
		};
		if (parent) {
			const parentLabel = await this.client.issueLabel(parent.id);
			labelData.group = { id: parent.id, name: parentLabel.name };
		}
		return labelData;
	}

	async getLabels(
		teamFilter?: string,
		limit = 100,
		nameFilter?: string,
	): Promise<{ labels: LinearLabel[] }> {
		const labels: LinearLabel[] = [];
		const labelFilter: Record<string, unknown> = {};
		if (nameFilter) {
			labelFilter.name = { containsIgnoreCase: nameFilter };
		}
		if (teamFilter) {
			const teamId = await this.resolveTeamId(teamFilter);
			const team = await this.client.team(teamId);
			labelFilter.team = teamIdFilter(teamId);
			const teamLabels = await this.client.issueLabels({
				filter: labelFilter,
				first: limit,
			});
			const teamRef = { id: team.id, key: team.key, name: team.name };
			for (const label of teamLabels.nodes) {
				if (label.isGroup) {
					continue;
				}
				labels.push(await this.buildLabelData(label, "team", teamRef));
			}
		} else {
			const allLabels = await this.client.issueLabels({
				filter: nonEmptyFilter(labelFilter),
				first: limit,
			});
			for (const label of allLabels.nodes) {
				if (label.isGroup) {
					continue;
				}
				const team = await label.team;
				const scope = team ? "team" : "workspace";
				const teamRef = team
					? { id: team.id, key: team.key, name: team.name }
					: undefined;
				labels.push(await this.buildLabelData(label, scope, teamRef));
			}
		}
		return { labels };
	}

	async createComment(args: {
		issueId: string;
		body: string;
	}): Promise<LinearComment> {
		const payload = await this.client.createComment({
			issueId: args.issueId,
			body: args.body,
		});
		if (!payload.success) {
			throw new Error("Failed to create comment");
		}
		const comment = await payload.comment;
		if (!comment) {
			throw new Error("Failed to retrieve created comment");
		}
		const user = await comment.user;
		if (!user) {
			throw new Error("Failed to retrieve comment user information");
		}
		return {
			id: comment.id,
			body: comment.body,
			user: {
				id: user.id,
				name: resolveUserDisplayName(user.id, user.name),
				url: user.url || undefined,
			},
			createdAt: comment.createdAt.toISOString(),
			updatedAt: comment.updatedAt.toISOString(),
		};
	}

	async getCycles(
		teamFilter?: string,
		activeOnly?: boolean,
		limit?: number,
	): Promise<LinearCycleSummary[]> {
		const filter: Record<string, unknown> = {};
		if (teamFilter) {
			const teamId = await this.resolveTeamId(teamFilter);
			filter.team = teamIdFilter(teamId);
		}
		if (activeOnly) {
			filter.isActive = eqFilter(true);
		}
		const cyclesConnection = await this.client.cycles({
			filter: nonEmptyFilter(filter),
			orderBy: sdkOrderBy("createdAt"),
			first: limit ?? DEFAULT_CYCLE_PAGINATION_LIMIT,
		});
		const cyclesWithData = await Promise.all(
			cyclesConnection.nodes.map(async (cycle) => {
				const team = await cycle.team;
				return {
					id: cycle.id,
					name: cycle.name ?? undefined,
					number: cycle.number,
					startsAt: toISOStringOrUndefined(cycle.startsAt),
					endsAt: toISOStringOrUndefined(cycle.endsAt),
					isActive: cycle.isActive,
					isPrevious: cycle.isPrevious,
					isNext: cycle.isNext,
					progress: cycle.progress,
					issueCountHistory: cycle.issueCountHistory,
					team: team
						? { id: team.id, key: team.key, name: team.name }
						: undefined,
				};
			}),
		);
		return cyclesWithData;
	}

	async getCycleById(
		cycleId: string,
		issuesLimit = 50,
	): Promise<LinearCycleDetail> {
		const cycle = await this.client.cycle(cycleId);
		const [team, issuesConnection] = await Promise.all([
			cycle.team,
			cycle.issues({ first: issuesLimit }),
		]);
		const issues: LinearIssue[] = [];
		for (const issue of issuesConnection.nodes) {
			const [state, assignee, issueTeam, project, labels] = await Promise.all([
				issue.state,
				issue.assignee,
				issue.team,
				issue.project,
				issue.labels(),
			]);
			issues.push({
				id: issue.id,
				identifier: issue.identifier,
				url: issue.url,
				title: issue.title,
				description: issue.description || undefined,
				// Linear SDK types `priority` as `number`; the GraphQL schema only
				// emits 0-4, so the cast is safe and the runtime range is
				// guaranteed by Linear's server-side schema.
				priority: issue.priority as LinearPriority,
				estimate: issue.estimate || undefined,
				state: state ? { id: state.id, name: state.name } : undefined,
				assignee: assignee
					? { id: assignee.id, name: assignee.name }
					: undefined,
				team: issueTeam
					? { id: issueTeam.id, key: issueTeam.key, name: issueTeam.name }
					: undefined,
				project: project ? { id: project.id, name: project.name } : undefined,
				labels: labels.nodes.map((label) => ({
					id: label.id,
					name: label.name,
				})),
				createdAt: toISOStringOrNow(issue.createdAt),
				updatedAt: toISOStringOrNow(issue.updatedAt),
			});
		}
		return {
			id: cycle.id,
			name: cycle.name ?? undefined,
			number: cycle.number,
			startsAt: toISOStringOrUndefined(cycle.startsAt),
			endsAt: toISOStringOrUndefined(cycle.endsAt),
			isActive: cycle.isActive,
			progress: cycle.progress,
			issueCountHistory: cycle.issueCountHistory,
			team: team ? { id: team.id, key: team.key, name: team.name } : undefined,
			issues,
		};
	}

	async resolveCycleId(
		cycleNameOrId: string,
		teamFilter?: string,
	): Promise<string> {
		if (isUuid(cycleNameOrId)) {
			return cycleNameOrId;
		}
		const filter: Record<string, unknown> = {
			name: { eq: cycleNameOrId },
		};
		if (teamFilter) {
			const teamId = await this.resolveTeamId(teamFilter);
			filter.team = teamIdFilter(teamId);
		}
		const cyclesConnection = await this.client.cycles({
			filter,
			first: 10,
		});
		const cyclesData = cyclesConnection.nodes;
		const nodes: Array<{
			id: string;
			name: string | undefined;
			number: number;
			startsAt: string | undefined;
			isActive: boolean;
			isNext: boolean;
			isPrevious: boolean;
			team: { id: string; key: string; name: string } | undefined;
		}> = [];
		for (const cycle of cyclesData) {
			const team = await cycle.team;
			nodes.push({
				id: cycle.id,
				name: cycle.name ?? undefined,
				number: cycle.number,
				startsAt: toISOStringOrUndefined(cycle.startsAt),
				isActive: cycle.isActive,
				isNext: cycle.isNext,
				isPrevious: cycle.isPrevious,
				team: team
					? { id: team.id, key: team.key, name: team.name }
					: undefined,
			});
		}
		if (nodes.length === 0) {
			throw notFoundError(
				"Cycle",
				cycleNameOrId,
				teamFilter ? `for team ${teamFilter}` : undefined,
			);
		}
		let chosen = nodes.find((n) => n.isActive);
		if (!chosen) {
			chosen = nodes.find((n) => n.isNext);
		}
		if (!chosen) {
			chosen = nodes.find((n) => n.isPrevious);
		}
		if (!chosen && nodes.length === 1) {
			chosen = nodes[0];
		}
		if (!chosen) {
			const matches = nodes.map(
				(n) => `${n.id} (${n.team?.key || "?"} / #${n.number} / ${n.startsAt})`,
			);
			throw multipleMatchesError(
				"cycle",
				cycleNameOrId,
				matches,
				"use an ID or scope with --team",
			);
		}
		return chosen.id;
	}

	async resolveProjectId(projectInput: string): Promise<string> {
		if (isUuid(projectInput)) {
			return projectInput;
		}
		const slugId = parseProjectSlugId(projectInput);
		if (slugId) {
			const bySlug = await this.client.projects({
				filter: { slugId: { eq: slugId } } as Record<string, unknown>,
				first: 1,
			});
			if (bySlug.nodes.length > 0) {
				return bySlug.nodes[0].id;
			}
			// Slug-id form was syntactically valid but didn't match a project
			// — fall through to name resolution would be misleading (the user
			// clearly pasted a URL/slug, not a name). Throw the same shape of
			// not-found error as the name path.
			throw notFoundError("Project", projectInput);
		}
		const filter = { name: { eqIgnoreCase: projectInput } };
		const projectsConnection = await this.client.projects({
			filter,
			first: 1,
		});
		if (projectsConnection.nodes.length === 0) {
			throw notFoundError("Project", projectInput);
		}
		return projectsConnection.nodes[0].id;
	}

	/**
	 * Normalize a user-supplied project input to a UUID when the input is
	 * a URL or slug-id form. Pass-through for UUIDs and plain names — the
	 * latter stays a name so downstream batch-resolve queries can fold the
	 * lookup into their single round-trip.
	 *
	 * Used by callers that route project resolution through a separate
	 * batch-resolve step (e.g. `GraphqlIssuesService.createIssue`) — they
	 * can pre-normalize URL/slug inputs to UUIDs so the batch query's
	 * `name eqIgnoreCase` filter doesn't have to learn the URL/slug shape.
	 */
	async normalizeProjectInput(projectInput: string): Promise<string> {
		if (isUuid(projectInput)) {
			return projectInput;
		}
		if (parseProjectSlugId(projectInput)) {
			return this.resolveProjectId(projectInput);
		}
		return projectInput;
	}
}

export async function createLinearService(
	options: AuthOptions,
): Promise<LinearService> {
	const auth = await getActiveAuth(options);
	if (auth.kind === "oauth") {
		return new LinearService({ oauthToken: auth.token });
	}
	return new LinearService({ apiKey: auth.token });
}
