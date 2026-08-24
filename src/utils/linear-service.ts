import { LinearClient } from "@linear/sdk";
import type { LinearCredential } from "../auth/linear-credential.js";
import {
	ensureFreshAccessToken,
	getActiveAuth,
} from "../auth/token-resolver.js";
import { resolveUserDisplayName } from "../config/resolver.js";
import {
	GET_CYCLE_DETAIL_QUERY,
	GET_CYCLES_CATALOG_QUERY,
	GET_LABELS_CATALOG_QUERY,
	GET_PROJECTS_CATALOG_QUERY,
	RESOLVE_PROJECT_QUERY,
} from "../queries/catalog.js";
import type {
	CatalogCycleNode,
	CatalogIssueNode,
	CatalogProjectNode,
	GetCycleDetailResponse,
	GetCyclesCatalogResponse,
	GetLabelsCatalogResponse,
	GetProjectsCatalogResponse,
	ResolveProjectCatalogResponse,
} from "../queries/catalog-types.js";
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
import { GraphQLService, instrumentLinearClient } from "./graphql-service.js";
import { parseIssueIdentifier } from "./identifier-parser.js";
import {
	graphQLErrorHttpStatus,
	toLinearGraphQLError,
} from "./linear-graphql-error.js";
import { parseProjectSlugId } from "./project-slug.js";
import {
	createOAuthProfileRateLimitAdmission,
	type RateLimitAdmission,
} from "./rate-limit-admission.js";
import { isUuid } from "./uuid.js";

const DEFAULT_CYCLE_PAGINATION_LIMIT = 250;

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

function projectFromCatalog(project: CatalogProjectNode): LinearProject {
	return {
		id: project.id,
		name: project.name,
		description: project.description || undefined,
		state: project.state,
		progress: project.progress,
		teams: project.teams.nodes,
		lead: project.lead ?? undefined,
		targetDate: toISOStringOrUndefined(project.targetDate),
		createdAt: toISOStringOrNow(project.createdAt),
		updatedAt: toISOStringOrNow(project.updatedAt),
	};
}

function cycleFromCatalog(cycle: CatalogCycleNode): LinearCycleSummary {
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
		issueCountHistory: cycle.issueCountHistory ?? undefined,
		team: cycle.team ?? undefined,
	};
}

function issueFromCatalog(issue: CatalogIssueNode): LinearIssue {
	return {
		id: issue.id,
		identifier: issue.identifier,
		url: issue.url,
		title: issue.title,
		description: issue.description || undefined,
		priority: issue.priority as LinearPriority,
		estimate: issue.estimate || undefined,
		state: issue.state ?? undefined,
		assignee: issue.assignee ?? undefined,
		team: issue.team ?? undefined,
		project: issue.project ?? undefined,
		labels: issue.labels.nodes,
		createdAt: toISOStringOrNow(issue.createdAt),
		updatedAt: toISOStringOrNow(issue.updatedAt),
	};
}

/**
 * Constructor arg for `LinearService`. Re-exported alias of the shared
 * `LinearCredential` union (`{ apiKey } | { oauthToken }`). See
 * `src/auth/linear-credential.ts` for the contract. The bare-string
 * legacy arm was dropped in DEV-4068 T7.
 */
export type LinearServiceAuth = LinearCredential;

type LinearSdkRequest = <Response, Variables extends Record<string, unknown>>(
	document: string,
	variables?: Variables,
) => Promise<Response>;

interface ClassifiableSdkClient {
	_request?: LinearSdkRequest;
}

interface RenewableSdkTransport {
	request<T>(
		document: unknown,
		variables?: Record<string, unknown>,
		requestHeaders?: Record<string, string>,
	): Promise<T>;
	setHeader(name: string, value: string): void;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error !== null) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return String(error);
}

/**
 * Classify every generated SDK operation after the SDK has normalized its raw
 * transport rejection. Patching `client.client.request` is too early: the
 * LinearClient constructor wraps that transport with `parseLinearError`, which
 * would immediately strip our additive classification fields again. Keeping
 * the wrapper here (rather than guessing in `outputError`) also leaves local
 * validation and not-found errors unclassified.
 */
export function instrumentLinearGraphQLErrorClassification(
	client: LinearClient,
): LinearClient {
	const sdk = client as unknown as ClassifiableSdkClient;
	if (!sdk._request) return client;
	const originalRequest = sdk._request.bind(sdk);
	sdk._request = async <Response, Variables extends Record<string, unknown>>(
		document: string,
		variables?: Variables,
	): Promise<Response> => {
		try {
			return await originalRequest<Response, Variables>(document, variables);
		} catch (error) {
			throw toLinearGraphQLError(error, errorMessage(error));
		}
	};
	return client;
}

export function instrumentClientCredentialsRenewal(
	client: LinearClient,
	renewAccessToken?: () => Promise<string>,
): LinearClient {
	if (!renewAccessToken) return client;
	const transport = (client as unknown as { client?: RenewableSdkTransport })
		.client;
	if (!transport?.request || !transport.setHeader) return client;
	const originalRequest = transport.request.bind(transport);
	transport.request = async <T>(
		document: unknown,
		variables?: Record<string, unknown>,
		requestHeaders?: Record<string, string>,
	): Promise<T> => {
		try {
			return await originalRequest<T>(document, variables, requestHeaders);
		} catch (error) {
			if (graphQLErrorHttpStatus(error) !== 401) throw error;
			const token = await renewAccessToken();
			transport.setHeader("authorization", `Bearer ${token}`);
			return originalRequest<T>(document, variables, requestHeaders);
		}
	};
	return client;
}

function buildLinearClient(
	auth: LinearServiceAuth,
	admission?: RateLimitAdmission,
	renewAccessToken?: () => Promise<string>,
): LinearClient {
	if ("oauthToken" in auth) {
		return instrumentLinearGraphQLErrorClassification(
			instrumentClientCredentialsRenewal(
				instrumentLinearClient(
					new LinearClient({ accessToken: auth.oauthToken }),
					auth,
					{ admission },
				),
				renewAccessToken,
			),
		);
	}
	return instrumentLinearGraphQLErrorClassification(
		instrumentLinearClient(new LinearClient({ apiKey: auth.apiKey }), auth, {
			admission,
		}),
	);
}

export class LinearService {
	private readonly client: LinearClient;
	private readonly graphQLService: GraphQLService;

	constructor(
		auth: LinearServiceAuth,
		options: {
			admission?: RateLimitAdmission;
			graphQLService?: GraphQLService;
			renewAccessToken?: () => Promise<string>;
		} = {},
	) {
		this.client = buildLinearClient(
			auth,
			options.admission,
			options.renewAccessToken,
		);
		this.graphQLService =
			options.graphQLService ??
			new GraphQLService(auth, {
				admission: options.admission,
				renewAccessToken: options.renewAccessToken,
			});
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

	/**
	 * Single-user lookup by UUID, email, or name (DEV-5612) — the natural
	 * complement to `getUsers`/`users list`, so identifying one actor (e.g. an
	 * unrecognized member surfaced by the alias wizard) doesn't require
	 * dumping the whole workspace. Resolution/ambiguity semantics match every
	 * other `--assignee`-style lookup in the CLI via {@link resolveUserId}.
	 */
	async getUser(nameOrEmailOrId: string): Promise<LinearUser> {
		const id = await this.resolveUserId(nameOrEmailOrId);
		const user = await this.client.user(id);
		return {
			id: user.id,
			name: user.name,
			displayName: user.displayName,
			email: user.email,
			active: user.active,
		};
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
			/** Resolved team UUID — applied as a server-side filter before pagination. */
			teamId?: string;
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
		const unlimited = limit === 0;
		const projectNodes: CatalogProjectNode[] = [];
		let after: string | null = null;
		do {
			const response: GetProjectsCatalogResponse =
				await this.graphQLService.rawRequest<GetProjectsCatalogResponse>(
					GET_PROJECTS_CATALOG_QUERY,
					{
						filter: nonEmptyFilter(filter),
						teamId: options.teamId ?? "",
						teamScoped: Boolean(options.teamId),
						first: unlimited ? 250 : limit,
						after,
					},
				);
			const page: GetProjectsCatalogResponse["projects"] | undefined =
				options.teamId ? response.team?.projects : response.projects;
			if (!page) {
				throw new Error(
					options.teamId
						? `Linear project catalog omitted team ${options.teamId}`
						: "Linear project catalog omitted the projects connection",
				);
			}
			projectNodes.push(...page.nodes);
			after =
				unlimited && page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
		} while (after);
		return projectNodes.map(projectFromCatalog);
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

	async getLabels(
		teamFilter?: string,
		limit = 100,
		nameFilter?: string,
	): Promise<{ labels: LinearLabel[] }> {
		const labelFilter: Record<string, unknown> = {};
		if (nameFilter) {
			labelFilter.name = { containsIgnoreCase: nameFilter };
		}
		if (teamFilter) {
			const teamId = await this.resolveTeamId(teamFilter);
			labelFilter.team = teamIdFilter(teamId);
		}
		const response =
			await this.graphQLService.rawRequest<GetLabelsCatalogResponse>(
				GET_LABELS_CATALOG_QUERY,
				{ filter: nonEmptyFilter(labelFilter), first: limit },
			);
		const labels: LinearLabel[] = response.issueLabels.nodes
			.filter((label) => !label.isGroup)
			.map((label) => ({
				id: label.id,
				name: label.name,
				color: label.color,
				scope: label.team ? "team" : "workspace",
				team: label.team ?? undefined,
				group: label.parent ?? undefined,
			}));
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
		const response =
			await this.graphQLService.rawRequest<GetCyclesCatalogResponse>(
				GET_CYCLES_CATALOG_QUERY,
				{
					filter: nonEmptyFilter(filter),
					first: limit ?? DEFAULT_CYCLE_PAGINATION_LIMIT,
				},
			);
		return response.cycles.nodes.map(cycleFromCatalog);
	}

	async getCycleById(
		cycleId: string,
		issuesLimit = 50,
	): Promise<LinearCycleDetail> {
		const response =
			await this.graphQLService.rawRequest<GetCycleDetailResponse>(
				GET_CYCLE_DETAIL_QUERY,
				{ id: cycleId, issuesFirst: issuesLimit },
			);
		const cycle = response.cycle;
		if (!cycle) throw notFoundError("Cycle", cycleId);
		return {
			...cycleFromCatalog(cycle),
			issues: cycle.issues.nodes.map(issueFromCatalog),
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
		const response =
			await this.graphQLService.rawRequest<GetCyclesCatalogResponse>(
				GET_CYCLES_CATALOG_QUERY,
				{ filter, first: 10 },
			);
		const cyclesData = response.cycles.nodes;
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
			nodes.push({
				id: cycle.id,
				name: cycle.name ?? undefined,
				number: cycle.number,
				startsAt: toISOStringOrUndefined(cycle.startsAt),
				isActive: cycle.isActive,
				isNext: cycle.isNext,
				isPrevious: cycle.isPrevious,
				team: cycle.team ?? undefined,
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

	/**
	 * Resolve a user-supplied project identifier to a UUID.
	 *
	 * Inputs (in order): UUID (pass-through), Linear URL or slug-id pair
	 * (unique by slug, resolved via `slugId` filter), or a plain name (case
	 * insensitive). DEV-4103: when a name resolution returns multiple matches
	 * across teams, the resolver disambiguates by `--team` when provided and
	 * throws an `ambiguous project` error otherwise — replacing the prior
	 * silent `first: 1` pick that could cross team boundaries.
	 *
	 * `teamInput` is the same string a user would pass to `--team`
	 * (key / name / UUID); it is resolved here when present so callers don't
	 * have to double-resolve.
	 */
	async resolveProjectId(
		projectInput: string,
		teamInput?: string,
	): Promise<string> {
		if (isUuid(projectInput)) {
			return projectInput;
		}
		const slugId = parseProjectSlugId(projectInput);
		if (slugId) {
			// `as Record<string, unknown>` — `@linear/sdk`'s typed ProjectFilter
			// lags Linear's schema and doesn't yet expose `slugId`. The field is
			// present on the server; the cast is here until the SDK ships the
			// typing. Don't "clean up" without verifying the typed shape exists.
			//
			// `includeArchived: true` — URLs in the wild often point at archived
			// projects (someone digs up an old link); silently 404-ing them is
			// worse than resolving to an archived project, which the caller can
			// inspect via the returned UUID. Name resolution stays active-only
			// because names collide more readily than slug-ids do.
			const bySlug =
				await this.graphQLService.rawRequest<ResolveProjectCatalogResponse>(
					RESOLVE_PROJECT_QUERY,
					{
						filter: { slugId: { eq: slugId } },
						teamId: "",
						teamScoped: false,
						includeArchived: true,
					},
				);
			if (bySlug.projects?.nodes.length) {
				return bySlug.projects.nodes[0].id;
			}
			// Slug-id form was syntactically valid but didn't match a project
			// — fall through to name resolution would be misleading (the user
			// clearly pasted a URL/slug, not a name). Throw the same shape of
			// not-found error as the name path.
			throw notFoundError("Project", projectInput);
		}
		// DEV-4103: scope by team when provided so a name shared across teams
		// doesn't resolve to a different team's project. DEV-5325: the scoping
		// goes through `Team.projects` (same as `getProjects`) — ProjectFilter
		// rejects a `teams` relation filter against the live schema.
		const teamId = teamInput ? await this.resolveTeamId(teamInput) : undefined;
		const filter: Record<string, unknown> = {
			name: { eqIgnoreCase: projectInput },
		};
		// `first: 5` is wide enough to detect ambiguity (same name across
		// multiple teams) without paying for a deeper page. Linear's UI caps
		// effective project-name collisions at a handful in practice; if a
		// workspace ever exceeds this we'll see it as a still-ambiguous error
		// listing the first 5 teams — better than a silent wrong pick.
		const response =
			await this.graphQLService.rawRequest<ResolveProjectCatalogResponse>(
				RESOLVE_PROJECT_QUERY,
				{
					filter,
					teamId: teamId ?? "",
					teamScoped: Boolean(teamId),
					includeArchived: false,
				},
			);
		const projects = teamId
			? response.team?.projects.nodes
			: response.projects?.nodes;
		if (!projects?.length) {
			const context = teamInput ? `on team "${teamInput}"` : undefined;
			throw notFoundError("Project", projectInput, context);
		}
		if (projects.length === 1) {
			return projects[0].id;
		}
		const descriptions = projects.map(
			(project) =>
				`${project.id} (teams: ${project.teams.nodes.map((team) => team.key).join(", ") || "none"})`,
		);
		throw multipleMatchesError(
			"project",
			projectInput,
			descriptions,
			"scope with --team, or pass the project URL/slug-id",
		);
	}

	/**
	 * Resolve a `--status` value on `projects update` to a `ProjectStatus` id
	 * (DEV-7021). Project statuses are a workspace-configurable set (Linear
	 * Settings → Workflow → Projects) — there is no fixed enum to validate
	 * against client-side, unlike `VALID_PROJECT_STATES` in `commands/projects.ts`
	 * (which enumerates the *type* group, not the individual named statuses).
	 * `client.projectStatuses()` has no server-side name filter, so we fetch the
	 * workspace's full set (small in practice — a handful of statuses) and match
	 * case-insensitively. On a miss, list the workspace's actual status names
	 * rather than surfacing Linear's raw `statusId` mutation error, which names
	 * the *type* (e.g. "paused") instead of a status a caller could have typed.
	 *
	 * Mirrors `resolveTeamId`'s not-found shape (`Available teams: ...`) rather
	 * than `resolveStatusId`'s (which omits the list) — this is the "workspace-
	 * configurable set with candidates on a miss" precedent to follow.
	 */
	async resolveProjectStatusId(statusName: string): Promise<string> {
		if (isUuid(statusName)) {
			return statusName;
		}
		const statuses = await this.client.projectStatuses({ first: 250 });
		const match = statuses.nodes.find(
			(s) => s.name.toLowerCase() === statusName.toLowerCase(),
		);
		if (!match) {
			const available = statuses.nodes.map((s) => s.name);
			throw notFoundError(
				"Project status",
				statusName,
				undefined,
				`\n  Available statuses: ${available.join(", ")}`,
			);
		}
		return match.id;
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
		const credential = { oauthToken: auth.token } as const;
		return new LinearService(credential, {
			admission: createOAuthProfileRateLimitAdmission(
				credential,
				auth.oauth.clientId,
				auth.oauth.viewerId,
			),
			renewAccessToken:
				auth.oauth.grantType === "client_credentials"
					? async () =>
							(
								await ensureFreshAccessToken(auth.oauth, {
									forceOAuthRenewal: true,
								})
							).accessToken
					: undefined,
		});
	}
	return new LinearService({ apiKey: auth.token });
}
