/**
 * Human-readable summary formatters for the `--format summary` output mode.
 *
 * These are pure functions: each takes the same shape that the JSON output
 * path receives (a single resource object or a `{ data, meta }` envelope)
 * and returns a plain string suitable for terminal display.
 *
 * Why this exists: every consumer (humans and LLMs) was piping
 * `el-linear ... | python -c 'json.load(...)'` or jq-based extraction to
 * pull out title/state/assignee. This codifies that recurring shape as a
 * first-class output mode, so callers don't reinvent it in shell.
 *
 * The summary format is intentionally stable — it's a contract, not a
 * pretty-print. Field ordering and labels should not change across
 * patch releases without a CHANGELOG entry.
 */

const TITLE_TRUNC = 60;
const DESCRIPTION_LINE_LIMIT = 10;
const TRUNC_FOOTER = "... (truncated; --format json for full body)";

// ── tiny helpers ───────────────────────────────────────────────

function truncate(s: string, n: number): string {
	if (s.length <= n) return s;
	return `${s.slice(0, n - 1)}…`;
}

function pad(s: string, n: number): string {
	if (s.length >= n) return s;
	return s + " ".repeat(n - s.length);
}

function indent(text: string, prefix = "  "): string {
	return text
		.split("\n")
		.map((line) => prefix + line)
		.join("\n");
}

function clipDescription(body: string | undefined): string | null {
	if (!body) return null;
	const lines = body.split("\n");
	if (lines.length <= DESCRIPTION_LINE_LIMIT) {
		return indent(body);
	}
	return `${indent(lines.slice(0, DESCRIPTION_LINE_LIMIT).join("\n"))}\n${indent(TRUNC_FOOTER)}`;
}

function s(v: unknown): string {
	if (v === null || v === undefined || v === "") return "—";
	return String(v);
}

function asObj(v: unknown): Record<string, unknown> | null {
	if (v && typeof v === "object" && !Array.isArray(v)) {
		return v as Record<string, unknown>;
	}
	return null;
}

function getName(v: unknown): string {
	const o = asObj(v);
	if (!o) return s(v);
	const candidate =
		o.name ?? o.displayName ?? o.title ?? o.key ?? o.identifier ?? null;
	return s(candidate);
}

function joinLabels(v: unknown): string {
	if (!Array.isArray(v) || v.length === 0) return "";
	return v
		.map((l) => {
			const o = asObj(l);
			return o ? s(o.name) : s(l);
		})
		.filter((x) => x && x !== "—")
		.join(", ");
}

// ── header rendering for single-resource summaries ─────────────

interface HeaderField {
	label: string;
	value: string;
}

/**
 * Render a list of label/value pairs with the labels right-padded so values
 * align in a column. Empty / missing values are dropped before render so
 * the summary doesn't show "Project: —" rows for resources where a field
 * isn't applicable.
 */
function renderHeader(fields: HeaderField[]): string {
	const visible = fields.filter((f) => f.value && f.value !== "—");
	if (visible.length === 0) return "";
	const labelWidth = Math.max(...visible.map((f) => f.label.length)) + 1;
	return visible
		.map((f) => `${pad(`${f.label}:`, labelWidth + 1)} ${f.value}`)
		.join("\n");
}

// ── issues ─────────────────────────────────────────────────────

export function formatIssueSummary(issue: Record<string, unknown>): string {
	const identifier = s(issue.identifier);
	const title = s(issue.title);
	const headerLine = `${identifier}  ${title}`;

	const fields: HeaderField[] = [
		{ label: "State", value: getName(issue.state) },
		{ label: "Assignee", value: getName(issue.assignee) },
		{ label: "Project", value: getName(issue.project) },
		{ label: "Cycle", value: getName(issue.cycle) },
		{ label: "Milestone", value: getName(issue.projectMilestone) },
		{ label: "Labels", value: joinLabels(issue.labels) },
		{ label: "URL", value: s(issue.url) },
	];

	const header = renderHeader(fields);
	const body = clipDescription(issue.description as string | undefined);

	const parts = [headerLine, header];
	if (body) parts.push("", body);
	return parts.filter((p) => p !== "").join("\n");
}

export function formatIssueList(issues: unknown[]): string {
	if (issues.length === 0) return "(no issues)";
	const rows = issues.map((raw) => {
		const i = asObj(raw) ?? {};
		return {
			id: s(i.identifier),
			title: truncate(s(i.title), TITLE_TRUNC),
			state: getName(i.state),
			assignee: getName(i.assignee),
		};
	});
	const idW = Math.max(2, ...rows.map((r) => r.id.length));
	const titleW = Math.min(
		TITLE_TRUNC,
		Math.max(5, ...rows.map((r) => r.title.length)),
	);
	const stateW = Math.max(5, ...rows.map((r) => r.state.length));
	const assigneeW = Math.max(8, ...rows.map((r) => r.assignee.length));
	const header = `${pad("ID", idW)}  ${pad("TITLE", titleW)}  ${pad("STATE", stateW)}  ${pad("ASSIGNEE", assigneeW)}`;
	const sep = "-".repeat(header.length);
	const body = rows
		.map(
			(r) =>
				`${pad(r.id, idW)}  ${pad(r.title, titleW)}  ${pad(r.state, stateW)}  ${pad(r.assignee, assigneeW)}`,
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n\n${rows.length} issue${rows.length === 1 ? "" : "s"}`;
}

// ── projects ───────────────────────────────────────────────────

export function formatProjectSummary(project: Record<string, unknown>): string {
	const name = s(project.name);
	const headerLine = name;

	const teams = (() => {
		const t = project.teams;
		if (!Array.isArray(t) || t.length === 0) return "";
		return t
			.map((team) => {
				const o = asObj(team);
				return o ? s(o.key ?? o.name) : s(team);
			})
			.join(", ");
	})();

	const progress =
		typeof project.progress === "number"
			? `${Math.round((project.progress as number) * 100)}%`
			: "";

	const fields: HeaderField[] = [
		{ label: "State", value: s(project.state) },
		{ label: "Lead", value: getName(project.lead) },
		{ label: "Teams", value: teams },
		{ label: "Target", value: s(project.targetDate) },
		{ label: "Progress", value: progress },
		{ label: "URL", value: s(project.url) },
	];
	const header = renderHeader(fields);
	const body = clipDescription(project.description as string | undefined);

	const parts = [headerLine, header];
	if (body) parts.push("", body);
	return parts.filter((p) => p !== "").join("\n");
}

export function formatProjectList(projects: unknown[]): string {
	if (projects.length === 0) return "(no projects)";
	const rows = projects.map((raw) => {
		const p = asObj(raw) ?? {};
		const progress =
			typeof p.progress === "number"
				? `${Math.round((p.progress as number) * 100)}%`
				: "—";
		return {
			name: truncate(s(p.name), TITLE_TRUNC),
			state: s(p.state),
			progress,
			lead: getName(p.lead),
		};
	});
	const nameW = Math.max(4, ...rows.map((r) => r.name.length));
	const stateW = Math.max(5, ...rows.map((r) => r.state.length));
	const progW = Math.max(8, ...rows.map((r) => r.progress.length));
	const leadW = Math.max(4, ...rows.map((r) => r.lead.length));
	const header = `${pad("NAME", nameW)}  ${pad("STATE", stateW)}  ${pad("PROGRESS", progW)}  ${pad("LEAD", leadW)}`;
	const sep = "-".repeat(header.length);
	const body = rows
		.map(
			(r) =>
				`${pad(r.name, nameW)}  ${pad(r.state, stateW)}  ${pad(r.progress, progW)}  ${pad(r.lead, leadW)}`,
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n\n${rows.length} project${rows.length === 1 ? "" : "s"}`;
}

// ── comments ───────────────────────────────────────────────────

export function formatCommentSummary(comment: Record<string, unknown>): string {
	const author = getName(comment.user);
	const createdAt = s(comment.createdAt);
	const body = clipDescription(comment.body as string | undefined);
	const headerLine = `${author}  ${createdAt}`;
	const parts = [headerLine];
	if (body) parts.push("", body);
	return parts.join("\n");
}

export function formatCommentList(comments: unknown[]): string {
	if (comments.length === 0) return "(no comments)";
	return comments
		.map((c) => {
			const obj = asObj(c) ?? {};
			return formatCommentSummary(obj);
		})
		.join("\n\n---\n\n");
}

// ── cycles ─────────────────────────────────────────────────────

export function formatCycleSummary(cycle: Record<string, unknown>): string {
	const name = s(cycle.name ?? `Cycle ${s(cycle.number)}`);
	const headerLine = name;
	const progress =
		typeof cycle.progress === "number"
			? `${Math.round((cycle.progress as number) * 100)}%`
			: "";
	const fields: HeaderField[] = [
		{ label: "Number", value: s(cycle.number) },
		{ label: "Team", value: getName(cycle.team) },
		{ label: "Active", value: cycle.isActive ? "yes" : "" },
		{ label: "Starts", value: s(cycle.startsAt) },
		{ label: "Ends", value: s(cycle.endsAt) },
		{ label: "Progress", value: progress },
	];
	const header = renderHeader(fields);

	// If this is a cycle "read" payload, it includes issues — append a list.
	const issues = cycle.issues;
	let issuesBlock = "";
	if (Array.isArray(issues) && issues.length > 0) {
		issuesBlock = `\n\nIssues:\n${formatIssueList(issues)}`;
	}

	return `${headerLine}\n${header}${issuesBlock}`;
}

export function formatCycleList(cycles: unknown[]): string {
	if (cycles.length === 0) return "(no cycles)";
	const rows = cycles.map((raw) => {
		const c = asObj(raw) ?? {};
		const progress =
			typeof c.progress === "number"
				? `${Math.round((c.progress as number) * 100)}%`
				: "—";
		return {
			number: s(c.number),
			name: truncate(s(c.name ?? `Cycle ${s(c.number)}`), 40),
			team: getName(c.team),
			active: c.isActive ? "yes" : "no",
			progress,
		};
	});
	const numW = Math.max(2, ...rows.map((r) => r.number.length));
	const nameW = Math.max(4, ...rows.map((r) => r.name.length));
	const teamW = Math.max(4, ...rows.map((r) => r.team.length));
	const activeW = 6;
	const progW = Math.max(8, ...rows.map((r) => r.progress.length));
	const header = `${pad("#", numW)}  ${pad("NAME", nameW)}  ${pad("TEAM", teamW)}  ${pad("ACTIVE", activeW)}  ${pad("PROGRESS", progW)}`;
	const sep = "-".repeat(header.length);
	const body = rows
		.map(
			(r) =>
				`${pad(r.number, numW)}  ${pad(r.name, nameW)}  ${pad(r.team, teamW)}  ${pad(r.active, activeW)}  ${pad(r.progress, progW)}`,
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n\n${rows.length} cycle${rows.length === 1 ? "" : "s"}`;
}

// ── milestones ─────────────────────────────────────────────────

export function formatMilestoneSummary(
	milestone: Record<string, unknown>,
): string {
	const name = s(milestone.name);
	const fields: HeaderField[] = [
		{ label: "Target", value: s(milestone.targetDate) },
		{ label: "Project", value: getName(milestone.project) },
		{ label: "Sort", value: s(milestone.sortOrder) },
	];
	const header = renderHeader(fields);
	const body = clipDescription(milestone.description as string | undefined);
	const parts = [name, header];
	if (body) parts.push("", body);
	return parts.filter((p) => p !== "").join("\n");
}

export function formatMilestoneList(milestones: unknown[]): string {
	if (milestones.length === 0) return "(no milestones)";
	const rows = milestones.map((raw) => {
		const m = asObj(raw) ?? {};
		return {
			name: truncate(s(m.name), TITLE_TRUNC),
			target: s(m.targetDate),
			project: getName(m.project),
		};
	});
	const nameW = Math.max(4, ...rows.map((r) => r.name.length));
	const targetW = Math.max(6, ...rows.map((r) => r.target.length));
	const projW = Math.max(7, ...rows.map((r) => r.project.length));
	const header = `${pad("NAME", nameW)}  ${pad("TARGET", targetW)}  ${pad("PROJECT", projW)}`;
	const sep = "-".repeat(header.length);
	const body = rows
		.map(
			(r) =>
				`${pad(r.name, nameW)}  ${pad(r.target, targetW)}  ${pad(r.project, projW)}`,
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n\n${rows.length} milestone${rows.length === 1 ? "" : "s"}`;
}

// ── teams ──────────────────────────────────────────────────────

export function formatTeamList(teams: unknown[]): string {
	if (teams.length === 0) return "(no teams)";
	const rows = teams.map((raw) => {
		const t = asObj(raw) ?? {};
		return {
			key: s(t.key),
			name: truncate(s(t.name), TITLE_TRUNC),
			description: truncate(s(t.description), 60),
		};
	});
	const keyW = Math.max(3, ...rows.map((r) => r.key.length));
	const nameW = Math.max(4, ...rows.map((r) => r.name.length));
	const descW = Math.max(11, ...rows.map((r) => r.description.length));
	const header = `${pad("KEY", keyW)}  ${pad("NAME", nameW)}  ${pad("DESCRIPTION", descW)}`;
	const sep = "-".repeat(header.length);
	const body = rows
		.map(
			(r) =>
				`${pad(r.key, keyW)}  ${pad(r.name, nameW)}  ${pad(r.description, descW)}`,
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n\n${rows.length} team${rows.length === 1 ? "" : "s"}`;
}

// ── labels ─────────────────────────────────────────────────────

export function formatLabelList(labels: unknown[]): string {
	if (labels.length === 0) return "(no labels)";
	const rows = labels.map((raw) => {
		const l = asObj(raw) ?? {};
		return {
			name: truncate(s(l.name), TITLE_TRUNC),
			scope: s(l.scope),
			team: l.team ? getName(l.team) : "",
			color: s(l.color),
		};
	});
	const nameW = Math.max(4, ...rows.map((r) => r.name.length));
	const scopeW = Math.max(5, ...rows.map((r) => r.scope.length));
	const teamW = Math.max(4, ...rows.map((r) => r.team.length));
	const colorW = Math.max(5, ...rows.map((r) => r.color.length));
	const header = `${pad("NAME", nameW)}  ${pad("SCOPE", scopeW)}  ${pad("TEAM", teamW)}  ${pad("COLOR", colorW)}`;
	const sep = "-".repeat(header.length);
	const body = rows
		.map(
			(r) =>
				`${pad(r.name, nameW)}  ${pad(r.scope, scopeW)}  ${pad(r.team, teamW)}  ${pad(r.color, colorW)}`,
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n\n${rows.length} label${rows.length === 1 ? "" : "s"}`;
}

// ── users ──────────────────────────────────────────────────────

export function formatUserSummary(user: Record<string, unknown>): string {
	const name = s(user.name);
	const fields: HeaderField[] = [
		{ label: "Display name", value: s(user.displayName) },
		{ label: "Email", value: s(user.email) },
		{ label: "Active", value: user.active === false ? "no" : "yes" },
	];
	const header = renderHeader(fields);
	return `${name}\n${header}`;
}

export function formatUserList(users: unknown[]): string {
	if (users.length === 0) return "(no users)";
	const rows = users.map((raw) => {
		const u = asObj(raw) ?? {};
		return {
			name: truncate(s(u.name), 30),
			displayName: truncate(s(u.displayName), 25),
			email: truncate(s(u.email), 40),
			active: u.active === false ? "no" : "yes",
		};
	});
	const nameW = Math.max(4, ...rows.map((r) => r.name.length));
	const dispW = Math.max(7, ...rows.map((r) => r.displayName.length));
	const emailW = Math.max(5, ...rows.map((r) => r.email.length));
	const activeW = 6;
	const header = `${pad("NAME", nameW)}  ${pad("DISPLAY", dispW)}  ${pad("EMAIL", emailW)}  ${pad("ACTIVE", activeW)}`;
	const sep = "-".repeat(header.length);
	const body = rows
		.map(
			(r) =>
				`${pad(r.name, nameW)}  ${pad(r.displayName, dispW)}  ${pad(r.email, emailW)}  ${pad(r.active, activeW)}`,
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n\n${rows.length} user${rows.length === 1 ? "" : "s"}`;
}

// ── search-results (cross-resource) ────────────────────────────

export function formatSearchResultList(results: unknown[]): string {
	if (results.length === 0) return "(no results)";
	const rows = results.map((raw) => {
		const r = asObj(raw) ?? {};
		const id = s(r.identifier ?? r.id);
		return {
			type: s(r.type),
			id: truncate(id, 18),
			title: truncate(s(r.title ?? r.name), TITLE_TRUNC),
		};
	});
	const typeW = Math.max(4, ...rows.map((r) => r.type.length));
	const idW = Math.max(2, ...rows.map((r) => r.id.length));
	const titleW = Math.max(5, ...rows.map((r) => r.title.length));
	const header = `${pad("TYPE", typeW)}  ${pad("ID", idW)}  ${pad("TITLE", titleW)}`;
	const sep = "-".repeat(header.length);
	const body = rows
		.map(
			(r) =>
				`${pad(r.type, typeW)}  ${pad(r.id, idW)}  ${pad(r.title, titleW)}`,
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n\n${rows.length} result${rows.length === 1 ? "" : "s"}`;
}

// ── fallback ───────────────────────────────────────────────────

/**
 * Generic fallback for resources we don't have a dedicated formatter for
 * yet (e.g. profile/config/template/document). Renders any object as a
 * label-padded key/value block, with a "..." footer hinting at JSON for
 * the full payload. Lists fall back to a simple bulleted list.
 */
export function formatGenericSummary(value: unknown): string {
	if (Array.isArray(value)) {
		if (value.length === 0) return "(empty)";
		return value
			.map((v) => `- ${formatGenericInline(v)}`)
			.concat([`\n${value.length} item${value.length === 1 ? "" : "s"}`])
			.join("\n");
	}
	const obj = asObj(value);
	if (!obj) return s(value);
	const fields: HeaderField[] = Object.entries(obj)
		.filter(([k]) => !k.startsWith("_"))
		.map(([k, v]) => ({ label: k, value: formatGenericInline(v) }));
	return renderHeader(fields);
}

function formatGenericInline(v: unknown): string {
	if (v === null || v === undefined) return "—";
	if (Array.isArray(v)) {
		if (v.length === 0) return "(empty)";
		const inner = v
			.slice(0, 5)
			.map((item) => {
				const o = asObj(item);
				if (o) return s(o.name ?? o.identifier ?? o.id);
				return s(item);
			})
			.join(", ");
		return v.length > 5 ? `${inner}, … (${v.length} total)` : inner;
	}
	const o = asObj(v);
	if (o) return s(o.name ?? o.displayName ?? o.identifier ?? o.id ?? "{…}");
	if (typeof v === "string" && v.length > 80) {
		return `${v.slice(0, 80)}…`;
	}
	return s(v);
}

// ── dispatch ───────────────────────────────────────────────────

export type ResourceKind =
	| "issue"
	| "issue-list"
	| "project"
	| "project-list"
	| "comment"
	| "comment-list"
	| "cycle"
	| "cycle-list"
	| "milestone"
	| "milestone-list"
	| "team-list"
	| "label-list"
	| "user"
	| "user-list"
	| "search-result-list"
	| "empty-list"
	| "generic";

/**
 * Heuristic — used by the central `outputSuccess` path which doesn't know
 * which command produced the payload. Looks at the shape of the data to
 * pick a formatter.
 *
 * Single-resource detection: uses signature fields (e.g. `identifier` +
 * `state` for issues, `name` + `progress` for projects). When a payload
 * doesn't match any known shape we fall through to `formatGenericSummary`.
 */
export function inferKindFromPayload(value: unknown): ResourceKind {
	if (Array.isArray(value)) {
		return inferListKind(value);
	}
	const obj = asObj(value);
	if (!obj) return "generic";

	// list envelope: { data: [...], meta: {...} }
	if (Array.isArray(obj.data)) {
		return inferListKind(obj.data, obj);
	}

	// single resource
	if ("identifier" in obj && "title" in obj && "url" in obj) return "issue";
	if (
		"name" in obj &&
		"progress" in obj &&
		("state" in obj || "lead" in obj || "teams" in obj)
	)
		return "project";
	if ("body" in obj && "createdAt" in obj && "user" in obj) return "comment";
	if (
		("number" in obj || "isActive" in obj) &&
		("startsAt" in obj || "endsAt" in obj || "issues" in obj)
	)
		return "cycle";
	if ("targetDate" in obj && "name" in obj && !("teams" in obj))
		return "milestone";
	if ("displayName" in obj && "email" in obj) return "user";

	return "generic";
}

function inferListKind(
	items: unknown[],
	envelope?: Record<string, unknown>,
): ResourceKind {
	if (items.length === 0) {
		// empty list — try to infer from meta hints, else render a
		// generic "(no results)" marker. We avoid falling through to
		// "generic" because that renders the envelope keys (data, meta)
		// rather than treating the payload as the empty list it is.
		const hint = asObj(envelope?.meta)?.kind;
		if (typeof hint === "string") return mapHint(hint);
		return "empty-list";
	}
	const sample = asObj(items[0]) ?? {};
	if ("identifier" in sample && "title" in sample) {
		// could be issue or search result
		if ("type" in sample) return "search-result-list";
		return "issue-list";
	}
	if ("body" in sample && "createdAt" in sample) return "comment-list";
	if ("progress" in sample && "name" in sample) {
		if ("startsAt" in sample || "endsAt" in sample) return "cycle-list";
		return "project-list";
	}
	if ("targetDate" in sample && "name" in sample) return "milestone-list";
	if ("key" in sample && "name" in sample) return "team-list";
	if ("color" in sample && "scope" in sample) return "label-list";
	if ("displayName" in sample && "email" in sample) return "user-list";
	return "generic";
}

function mapHint(kind: string): ResourceKind {
	const known: Record<string, ResourceKind> = {
		issue: "issue-list",
		issues: "issue-list",
		project: "project-list",
		projects: "project-list",
		cycle: "cycle-list",
		cycles: "cycle-list",
		milestone: "milestone-list",
		milestones: "milestone-list",
		team: "team-list",
		teams: "team-list",
		label: "label-list",
		labels: "label-list",
		user: "user-list",
		users: "user-list",
		comment: "comment-list",
		comments: "comment-list",
	};
	return known[kind.toLowerCase()] ?? "generic";
}

/**
 * Central dispatch: given a resource kind and payload, return the
 * formatted string. The payload for list kinds may be either the raw
 * array or a `{ data: [...] }` envelope — both are handled.
 */
export function dispatch(kind: ResourceKind, payload: unknown): string {
	const obj = asObj(payload);
	const list = (() => {
		if (Array.isArray(payload)) return payload;
		if (obj && Array.isArray(obj.data)) return obj.data;
		return null;
	})();

	switch (kind) {
		case "issue":
			return formatIssueSummary((obj ?? {}) as Record<string, unknown>);
		case "issue-list":
			return formatIssueList(list ?? []);
		case "project":
			return formatProjectSummary((obj ?? {}) as Record<string, unknown>);
		case "project-list":
			return formatProjectList(list ?? []);
		case "comment":
			return formatCommentSummary((obj ?? {}) as Record<string, unknown>);
		case "comment-list":
			return formatCommentList(list ?? []);
		case "cycle":
			return formatCycleSummary((obj ?? {}) as Record<string, unknown>);
		case "cycle-list":
			return formatCycleList(list ?? []);
		case "milestone":
			return formatMilestoneSummary((obj ?? {}) as Record<string, unknown>);
		case "milestone-list":
			return formatMilestoneList(list ?? []);
		case "team-list":
			return formatTeamList(list ?? []);
		case "label-list":
			return formatLabelList(list ?? []);
		case "user":
			return formatUserSummary((obj ?? {}) as Record<string, unknown>);
		case "user-list":
			return formatUserList(list ?? []);
		case "search-result-list":
			return formatSearchResultList(list ?? []);
		case "empty-list":
			return "(no results)";
		case "generic":
			return formatGenericSummary(payload);
	}
}
