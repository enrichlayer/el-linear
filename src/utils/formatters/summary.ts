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
const DESCRIPTION_CHAR_LIMIT = 4096;
const TRUNC_FOOTER = "... (truncated; --format json for full body)";

// ── tiny helpers ───────────────────────────────────────────────

/**
 * Strip terminal control sequences from a string so the summary
 * formatter cannot be hijacked by attacker-controlled content
 * (issue/comment titles set by anyone with workspace write access).
 *
 * Removes:
 *
 * - C0 control bytes (0x00–0x1F) except `\t` (kept for legible
 *   embedded tabs) and `\n` (callers like `clipDescription` rely on
 *   it). `\x1B` (ESC) — the start byte for CSI / OSC / DCS / SS3
 *   sequences — is dropped along with the rest of C0.
 * - DEL (0x7F).
 * - C1 control bytes (0x80–0x9F).
 *
 * This is conservative — anything that would tell a terminal to move
 * the cursor, switch screens, set a hyperlink target, change palette,
 * etc. is silently dropped. Visible Unicode (including emoji and CJK)
 * passes through untouched.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex is the sanitizer.
const TERMINAL_CONTROL_RE = /[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;
function sanitizeForTerminal(value: string): string {
	return value.replace(TERMINAL_CONTROL_RE, "");
}

function truncate(s: string, n: number): string {
	// truncate(s, n<=0) → "" (no room even for an ellipsis)
	// truncate(s, 1)    → "…"
	// truncate(s, n>=2) → first n-1 characters + ellipsis
	// Width math elsewhere assumes the result is ≤ n characters; this
	// keeps the contract honest at the small-n boundary.
	if (s.length <= n) return s;
	if (n <= 0) return "";
	if (n === 1) return "…";
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
	const sanitized = sanitizeForTerminal(body);
	// Char cap first: a 5MB description with no newlines would otherwise
	// pass the line-count check unchanged and dump verbatim to stdout.
	let clipped = sanitized;
	let charClipped = false;
	if (clipped.length > DESCRIPTION_CHAR_LIMIT) {
		clipped = clipped.slice(0, DESCRIPTION_CHAR_LIMIT);
		charClipped = true;
	}
	const lines = clipped.split("\n");
	if (lines.length <= DESCRIPTION_LINE_LIMIT && !charClipped) {
		return indent(clipped);
	}
	const kept = lines.slice(0, DESCRIPTION_LINE_LIMIT).join("\n");
	return `${indent(kept)}\n${indent(TRUNC_FOOTER)}`;
}

function s(v: unknown): string {
	if (v === null || v === undefined || v === "") return "—";
	return sanitizeForTerminal(String(v));
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

// ── shared list-table renderer ─────────────────────────────────

interface ColumnDef<T> {
	/** Column header (uppercased — e.g. "ID", "TITLE"). */
	header: string;
	/** Minimum width. Header label is auto-included; this is the floor. */
	minWidth: number;
	/** Optional cap; values longer than this get truncated with an ellipsis. */
	maxWidth?: number;
	/** Pull the column's string value from one row. */
	extract: (row: T) => string;
}

/**
 * Per-resource projection lookup used by `--fields` on `--format summary`
 * (DEV-4750). `selectColumns` matches each user-requested name against the
 * `defaults` set first (by case-insensitive header **or** synonym map),
 * then against the `extras` map for additional projectable columns.
 *
 * Unknown names fall through into `unprojectable[]` so the caller can warn
 * deterministically (e.g. `--fields project,foo` on a resource where `foo`
 * has no column definition).
 */
interface ColumnProjection<T> {
	/** Default column set rendered when `--fields` is not provided. */
	defaults: ColumnDef<T>[];
	/** Optional projectable columns, keyed by lowercased canonical name. */
	extras?: Record<string, ColumnDef<T>>;
	/**
	 * Map of user-requested names → canonical names. Lets a request for
	 * `id` resolve to `ID`, `status` to `STATE`, `name` to `NAME`, etc.
	 * Keys and values are lowercased.
	 */
	synonyms?: Record<string, string>;
}

/**
 * Select the ordered column set for a `--fields` request. Returns
 * `{ columns, unprojectable }` so the caller can render and warn.
 *
 * Resolution order per requested name (case-insensitive):
 *
 * 1. Synonym lookup (`status` → `state`, `id` → `identifier`).
 * 2. Match against a `defaults` column header.
 * 3. Match against an `extras` entry.
 * 4. Otherwise → `unprojectable`.
 *
 * The returned columns preserve the order the user requested. This is the
 * contract: `--fields project,identifier,title` renders `PROJECT  ID  TITLE`.
 */
function selectColumns<T>(
	projection: ColumnProjection<T>,
	requested: string[],
): { columns: ColumnDef<T>[]; unprojectable: string[] } {
	const columns: ColumnDef<T>[] = [];
	const unprojectable: string[] = [];
	const synonyms = projection.synonyms ?? {};
	const extras = projection.extras ?? {};
	// Build a lowercased default-header lookup once.
	const defaultByHeader = new Map<string, ColumnDef<T>>();
	for (const col of projection.defaults) {
		defaultByHeader.set(col.header.toLowerCase(), col);
	}
	for (const raw of requested) {
		const name = raw.trim().toLowerCase();
		if (!name) continue;
		const canonical = synonyms[name] ?? name;
		const fromDefaults = defaultByHeader.get(canonical);
		if (fromDefaults) {
			columns.push(fromDefaults);
			continue;
		}
		const fromExtras = extras[canonical];
		if (fromExtras) {
			columns.push(fromExtras);
			continue;
		}
		unprojectable.push(raw);
	}
	return { columns, unprojectable };
}

/**
 * Filter the single-resource HeaderField list by user-requested field
 * names (DEV-4750). Matches each requested name against the field's
 * lowercased label and an optional synonym map. Unknown names are
 * reported in `unprojectable[]`.
 *
 * Order of the returned fields preserves the user's request order. The
 * implicit headline (identifier line for issues, name for projects) is
 * the caller's responsibility — `--fields` only filters the labelled
 * key/value block beneath it.
 */
function selectHeaderFields(
	defaults: HeaderField[],
	requested: string[],
	synonyms: Record<string, string> = {},
): { fields: HeaderField[]; unprojectable: string[] } {
	const byLabel = new Map<string, HeaderField>();
	for (const f of defaults) {
		byLabel.set(f.label.toLowerCase(), f);
	}
	const fields: HeaderField[] = [];
	const unprojectable: string[] = [];
	for (const raw of requested) {
		const name = raw.trim().toLowerCase();
		if (!name) continue;
		const canonical = synonyms[name] ?? name;
		const match = byLabel.get(canonical);
		if (match) {
			fields.push(match);
		} else {
			unprojectable.push(raw);
		}
	}
	return { fields, unprojectable };
}

/**
 * Module-level sink for unprojectable `--fields` names surfaced from the
 * summary formatters. The output dispatcher (`outputSuccess` in
 * `utils/output.ts`) drains this between renders and forwards them to
 * `outputWarning` so they ride out on the next JSON envelope's
 * `_warnings`. Kept here rather than in output.ts so the formatter stays
 * the single source of truth on what is and isn't projectable.
 *
 * Internal — consumers should call `drainSummaryFieldWarnings()`.
 */
const summaryFieldWarnings: string[] = [];

function recordUnprojectable(resource: string, names: string[]): void {
	if (names.length === 0) return;
	summaryFieldWarnings.push(
		`fields_unprojectable: --format summary on ${resource} does not project ${names.join(", ")}; ` +
			`use --format json --fields ${names.join(",")} or omit the field(s).`,
	);
}

/**
 * Drain the formatter-level `_warnings` buffer. Returns the collected
 * warnings and resets the queue. Called by `outputSuccess` after every
 * summary render to surface unprojectable-field hints to scripts.
 */
export function drainSummaryFieldWarnings(): string[] {
	const out = [...summaryFieldWarnings];
	summaryFieldWarnings.length = 0;
	return out;
}

interface RenderTableOptions {
	/** Returned verbatim when `rows` is empty (e.g. "(no issues)"). */
	emptyText: string;
	/** Singular form of the row noun for the footer ("issue", "team", ...). */
	itemNoun: string;
}

/**
 * Render a list of rows as a fixed-width text table with a header,
 * separator, body, and "<N> <noun>s" footer.
 *
 * Subsumes the formatXList family in this file — each one used to
 * inline its own column-width math, header/separator wiring, and
 * footer pluralization. Centralizing here cuts ~340 lines of
 * mechanical boilerplate to a single 30-line helper plus per-resource
 * column declarations.
 */
function renderTable<T>(
	rows: T[],
	columns: ColumnDef<T>[],
	options: RenderTableOptions,
): string {
	if (rows.length === 0) return options.emptyText;

	// Extract values once per row so we don't re-evaluate `extract` for
	// the width pass and the body pass.
	const values: string[][] = rows.map((row) =>
		columns.map((col) => {
			const raw = col.extract(row);
			return col.maxWidth ? truncate(raw, col.maxWidth) : raw;
		}),
	);

	const widths = columns.map((col, i) => {
		const fromRows = values.reduce(
			(max, row) => Math.max(max, row[i].length),
			0,
		);
		const computed = Math.max(col.minWidth, col.header.length, fromRows);
		return col.maxWidth ? Math.min(col.maxWidth, computed) : computed;
	});

	const header = columns.map((col, i) => pad(col.header, widths[i])).join("  ");
	const sep = "-".repeat(header.length);
	const body = values
		.map((row) => row.map((v, i) => pad(v, widths[i])).join("  "))
		.join("\n");
	const noun = `${rows.length} ${options.itemNoun}${rows.length === 1 ? "" : "s"}`;
	return `${header}\n${sep}\n${body}\n\n${noun}`;
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

/**
 * Map a user-requested field name → the canonical lookup key used by
 * `selectColumns` for the issues *list* formatter. Canonical keys are
 * the lowercased column header (`id`, `title`, `state`, `assignee`)
 * for defaults; extras are looked up by their key in
 * `ISSUE_LIST_EXTRAS`.
 *
 * `identifier` (the JSON key) → `id` (the column header). `status` and
 * `owner` are natural-language aliases for `state` and `assignee`.
 */
const ISSUE_LIST_SYNONYMS: Record<string, string> = {
	identifier: "id",
	status: "state",
	owner: "assignee",
};

/**
 * Map a user-requested field name → the canonical lowercased label used
 * by the single-resource issue formatter. Single-resource labels are
 * full words (`Created`, `Updated`), so `createdat` / `updatedat`
 * (JSON-field spellings) need mapping. `status` / `owner` carry over.
 */
const ISSUE_SUMMARY_SYNONYMS: Record<string, string> = {
	status: "state",
	owner: "assignee",
	createdat: "created",
	updatedat: "updated",
	prioritylabel: "priority",
	projectmilestone: "milestone",
};

function buildIssueHeaderFields(issue: Record<string, unknown>): HeaderField[] {
	return [
		{ label: "State", value: getName(issue.state) },
		{ label: "Assignee", value: getName(issue.assignee) },
		{ label: "Project", value: getName(issue.project) },
		{ label: "Cycle", value: getName(issue.cycle) },
		{ label: "Milestone", value: getName(issue.projectMilestone) },
		{ label: "Labels", value: joinLabels(issue.labels) },
		{ label: "Priority", value: s(issue.priorityLabel ?? issue.priority) },
		{ label: "Estimate", value: s(issue.estimate) },
		{ label: "Created", value: s(issue.createdAt) },
		{ label: "Updated", value: s(issue.updatedAt) },
		{ label: "URL", value: s(issue.url) },
	];
}

export function formatIssueSummary(
	issue: Record<string, unknown>,
	fields?: string[],
): string {
	const identifier = s(issue.identifier);
	const title = s(issue.title);
	const headerLine = `${identifier}  ${title}`;

	const allFields = buildIssueHeaderFields(issue);
	let headerFields: HeaderField[];
	if (fields && fields.length > 0) {
		// `identifier` / `title` make up the implicit headline above —
		// strip them from the user's request so a `--fields title,state`
		// doesn't try to render "Title:" inside the labelled block.
		const filtered = fields.filter((f) => {
			const name = f.trim().toLowerCase();
			return name !== "identifier" && name !== "id" && name !== "title";
		});
		const selected = selectHeaderFields(
			allFields,
			filtered,
			ISSUE_SUMMARY_SYNONYMS,
		);
		recordUnprojectable("issue", selected.unprojectable);
		headerFields = selected.fields;
	} else {
		// Default issue summary historically omits priority / estimate / dates —
		// keep that surface stable unless the caller asks for those columns.
		const defaultLabels = new Set([
			"state",
			"assignee",
			"project",
			"cycle",
			"milestone",
			"labels",
			"url",
		]);
		headerFields = allFields.filter((f) =>
			defaultLabels.has(f.label.toLowerCase()),
		);
	}

	const header = renderHeader(headerFields);
	const body = clipDescription(issue.description as string | undefined);

	const parts = [headerLine, header];
	if (body) parts.push("", body);
	return parts.filter((p) => p !== "").join("\n");
}

const ISSUE_LIST_DEFAULTS: ColumnDef<Record<string, unknown>>[] = [
	{ header: "ID", minWidth: 2, extract: (i) => s(i.identifier) },
	{
		header: "TITLE",
		minWidth: 5,
		maxWidth: TITLE_TRUNC,
		extract: (i) => s(i.title),
	},
	{ header: "STATE", minWidth: 5, extract: (i) => getName(i.state) },
	{
		header: "ASSIGNEE",
		minWidth: 8,
		extract: (i) => getName(i.assignee),
	},
];

const ISSUE_LIST_EXTRAS: Record<string, ColumnDef<Record<string, unknown>>> = {
	project: {
		header: "PROJECT",
		minWidth: 7,
		maxWidth: 40,
		extract: (i) => getName(i.project),
	},
	cycle: {
		header: "CYCLE",
		minWidth: 5,
		maxWidth: 20,
		extract: (i) => getName(i.cycle),
	},
	milestone: {
		header: "MILESTONE",
		minWidth: 9,
		maxWidth: 30,
		extract: (i) => getName(i.projectMilestone),
	},
	labels: {
		header: "LABELS",
		minWidth: 6,
		maxWidth: 40,
		extract: (i) => joinLabels(i.labels),
	},
	url: {
		header: "URL",
		minWidth: 3,
		maxWidth: 60,
		extract: (i) => s(i.url),
	},
	priority: {
		header: "PRIORITY",
		minWidth: 8,
		extract: (i) => s(i.priorityLabel ?? i.priority),
	},
	estimate: {
		header: "ESTIMATE",
		minWidth: 8,
		extract: (i) => s(i.estimate),
	},
	createdat: {
		header: "CREATED",
		minWidth: 7,
		extract: (i) => s(i.createdAt).slice(0, 10),
	},
	updatedat: {
		header: "UPDATED",
		minWidth: 7,
		extract: (i) => s(i.updatedAt).slice(0, 10),
	},
	team: {
		header: "TEAM",
		minWidth: 4,
		extract: (i) => {
			// issues carry team as either {key, name} or a bare key string.
			const team = i.team;
			const o = asObj(team);
			if (o) return s(o.key ?? o.name);
			return s(team);
		},
	},
};

export function formatIssueList(issues: unknown[], fields?: string[]): string {
	const rows = issues.map((raw) => asObj(raw) ?? {});
	let columns = ISSUE_LIST_DEFAULTS;
	if (fields && fields.length > 0) {
		const selected = selectColumns(
			{
				defaults: ISSUE_LIST_DEFAULTS,
				extras: ISSUE_LIST_EXTRAS,
				synonyms: ISSUE_LIST_SYNONYMS,
			},
			fields,
		);
		recordUnprojectable("issues list", selected.unprojectable);
		// If every requested name was unprojectable, fall back to defaults
		// so the user still sees something useful with the warning attached.
		columns =
			selected.columns.length > 0 ? selected.columns : ISSUE_LIST_DEFAULTS;
	}
	return renderTable(rows, columns, {
		emptyText: "(no issues)",
		itemNoun: "issue",
	});
}

// ── projects ───────────────────────────────────────────────────

const PROJECT_SYNONYMS: Record<string, string> = {
	targetdate: "target",
};

function joinTeamKeys(value: unknown): string {
	if (!Array.isArray(value) || value.length === 0) return "";
	return value
		.map((team) => {
			const o = asObj(team);
			return o ? s(o.key ?? o.name) : s(team);
		})
		.filter((x) => x && x !== "—")
		.join(", ");
}

export function formatProjectSummary(
	project: Record<string, unknown>,
	fields?: string[],
): string {
	const name = s(project.name);
	const headerLine = name;

	const teams = joinTeamKeys(project.teams);

	const progress =
		typeof project.progress === "number"
			? `${Math.round((project.progress as number) * 100)}%`
			: "";

	const allFields: HeaderField[] = [
		{ label: "State", value: s(project.state) },
		{ label: "Lead", value: getName(project.lead) },
		{ label: "Teams", value: teams },
		{ label: "Target", value: s(project.targetDate) },
		{ label: "Progress", value: progress },
		{ label: "URL", value: s(project.url) },
	];

	let headerFields: HeaderField[];
	if (fields && fields.length > 0) {
		// `name` is the implicit headline above; drop it from the request
		// so a user passing `--fields name,teams` doesn't render "Name:" in
		// the labelled block beneath.
		const filtered = fields.filter((f) => f.trim().toLowerCase() !== "name");
		const selected = selectHeaderFields(allFields, filtered, PROJECT_SYNONYMS);
		recordUnprojectable("project", selected.unprojectable);
		headerFields = selected.fields;
	} else {
		headerFields = allFields;
	}

	const header = renderHeader(headerFields);
	const body = clipDescription(project.description as string | undefined);

	const parts = [headerLine, header];
	if (body) parts.push("", body);
	return parts.filter((p) => p !== "").join("\n");
}

function pct(value: unknown): string {
	return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

const PROJECT_LIST_DEFAULTS: ColumnDef<Record<string, unknown>>[] = [
	{
		header: "NAME",
		minWidth: 4,
		maxWidth: TITLE_TRUNC,
		extract: (p) => s(p.name),
	},
	{ header: "STATE", minWidth: 5, extract: (p) => s(p.state) },
	{ header: "PROGRESS", minWidth: 8, extract: (p) => pct(p.progress) },
	{ header: "LEAD", minWidth: 4, extract: (p) => getName(p.lead) },
];

const PROJECT_LIST_EXTRAS: Record<
	string,
	ColumnDef<Record<string, unknown>>
> = {
	teams: {
		header: "TEAMS",
		minWidth: 5,
		maxWidth: 30,
		extract: (p) => joinTeamKeys(p.teams),
	},
	target: {
		header: "TARGET",
		minWidth: 6,
		extract: (p) => s(p.targetDate),
	},
	url: {
		header: "URL",
		minWidth: 3,
		maxWidth: 60,
		extract: (p) => s(p.url),
	},
	updatedat: {
		header: "UPDATED",
		minWidth: 7,
		extract: (p) => s(p.updatedAt).slice(0, 10),
	},
};

export function formatProjectList(
	projects: unknown[],
	fields?: string[],
): string {
	const rows = projects.map((raw) => asObj(raw) ?? {});
	let columns = PROJECT_LIST_DEFAULTS;
	if (fields && fields.length > 0) {
		const selected = selectColumns(
			{
				defaults: PROJECT_LIST_DEFAULTS,
				extras: PROJECT_LIST_EXTRAS,
				synonyms: PROJECT_SYNONYMS,
			},
			fields,
		);
		recordUnprojectable("projects list", selected.unprojectable);
		columns =
			selected.columns.length > 0 ? selected.columns : PROJECT_LIST_DEFAULTS;
	}
	return renderTable(rows, columns, {
		emptyText: "(no projects)",
		itemNoun: "project",
	});
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
	return renderTable(
		cycles.map((raw) => asObj(raw) ?? {}),
		[
			{ header: "#", minWidth: 2, extract: (c) => s(c.number) },
			{
				header: "NAME",
				minWidth: 4,
				maxWidth: 40,
				extract: (c) => s(c.name ?? `Cycle ${s(c.number)}`),
			},
			{ header: "TEAM", minWidth: 4, extract: (c) => getName(c.team) },
			{
				header: "ACTIVE",
				minWidth: 6,
				extract: (c) => (c.isActive ? "yes" : "no"),
			},
			{ header: "PROGRESS", minWidth: 8, extract: (c) => pct(c.progress) },
		],
		{ emptyText: "(no cycles)", itemNoun: "cycle" },
	);
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
	return renderTable(
		milestones.map((raw) => asObj(raw) ?? {}),
		[
			{
				header: "NAME",
				minWidth: 4,
				maxWidth: TITLE_TRUNC,
				extract: (m) => s(m.name),
			},
			{ header: "TARGET", minWidth: 6, extract: (m) => s(m.targetDate) },
			{ header: "PROJECT", minWidth: 7, extract: (m) => getName(m.project) },
		],
		{ emptyText: "(no milestones)", itemNoun: "milestone" },
	);
}

// ── teams ──────────────────────────────────────────────────────

export function formatTeamList(teams: unknown[]): string {
	return renderTable(
		teams.map((raw) => asObj(raw) ?? {}),
		[
			{ header: "KEY", minWidth: 3, extract: (t) => s(t.key) },
			{
				header: "NAME",
				minWidth: 4,
				maxWidth: TITLE_TRUNC,
				extract: (t) => s(t.name),
			},
			{
				header: "DESCRIPTION",
				minWidth: 11,
				maxWidth: 60,
				extract: (t) => s(t.description),
			},
		],
		{ emptyText: "(no teams)", itemNoun: "team" },
	);
}

// ── labels ─────────────────────────────────────────────────────

export function formatLabelList(labels: unknown[]): string {
	return renderTable(
		labels.map((raw) => asObj(raw) ?? {}),
		[
			{
				header: "NAME",
				minWidth: 4,
				maxWidth: TITLE_TRUNC,
				extract: (l) => s(l.name),
			},
			{ header: "SCOPE", minWidth: 5, extract: (l) => s(l.scope) },
			{
				header: "TEAM",
				minWidth: 4,
				extract: (l) => (l.team ? getName(l.team) : ""),
			},
			{ header: "COLOR", minWidth: 5, extract: (l) => s(l.color) },
		],
		{ emptyText: "(no labels)", itemNoun: "label" },
	);
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
	return renderTable(
		users.map((raw) => asObj(raw) ?? {}),
		[
			{ header: "NAME", minWidth: 4, maxWidth: 30, extract: (u) => s(u.name) },
			{
				header: "DISPLAY",
				minWidth: 7,
				maxWidth: 25,
				extract: (u) => s(u.displayName),
			},
			{
				header: "EMAIL",
				minWidth: 5,
				maxWidth: 40,
				extract: (u) => s(u.email),
			},
			{
				header: "ACTIVE",
				minWidth: 6,
				extract: (u) => (u.active === false ? "no" : "yes"),
			},
		],
		{ emptyText: "(no users)", itemNoun: "user" },
	);
}

// ── documents ──────────────────────────────────────────────────

export function formatDocumentSummary(doc: Record<string, unknown>): string {
	const title = s(doc.title);
	const fields: HeaderField[] = [
		{ label: "Project", value: getName(doc.project) },
		{ label: "Issue", value: getName(doc.issue) },
		{ label: "Creator", value: getName(doc.creator) },
		{ label: "Updated", value: s(doc.updatedAt) },
		{ label: "URL", value: s(doc.url) },
	];
	const header = renderHeader(fields);
	const body = clipDescription(doc.content as string | undefined);
	const parts = [title, header];
	if (body) parts.push("", body);
	return parts.filter((p) => p !== "").join("\n");
}

export function formatDocumentList(docs: unknown[]): string {
	return renderTable(
		docs.map((raw) => asObj(raw) ?? {}),
		[
			{
				header: "TITLE",
				minWidth: 5,
				maxWidth: TITLE_TRUNC,
				extract: (d) => s(d.title),
			},
			{ header: "PROJECT", minWidth: 7, extract: (d) => getName(d.project) },
			{
				header: "UPDATED",
				minWidth: 7,
				extract: (d) => s(d.updatedAt).slice(0, 10),
			},
		],
		{ emptyText: "(no documents)", itemNoun: "document" },
	);
}

// ── templates ──────────────────────────────────────────────────

export function formatTemplateSummary(tpl: Record<string, unknown>): string {
	const name = s(tpl.name);
	const fields: HeaderField[] = [
		{ label: "Type", value: s(tpl.type) },
		{ label: "Team", value: getName(tpl.team) },
		{ label: "Creator", value: getName(tpl.creator) },
		{ label: "Updated", value: s(tpl.updatedAt) },
		{ label: "ID", value: s(tpl.id) },
	];
	const header = renderHeader(fields);
	const body = clipDescription(tpl.description as string | undefined);
	const parts = [name, header];
	if (body) parts.push("", body);
	return parts.filter((p) => p !== "").join("\n");
}

export function formatTemplateList(tpls: unknown[]): string {
	return renderTable(
		tpls.map((raw) => asObj(raw) ?? {}),
		[
			{
				header: "NAME",
				minWidth: 4,
				maxWidth: TITLE_TRUNC,
				extract: (t) => s(t.name),
			},
			{ header: "TYPE", minWidth: 4, extract: (t) => s(t.type) },
			{ header: "TEAM", minWidth: 4, extract: (t) => getName(t.team) },
			{ header: "ID", minWidth: 2, extract: (t) => s(t.id) },
		],
		{ emptyText: "(no templates)", itemNoun: "template" },
	);
}

// ── attachments ────────────────────────────────────────────────

export function formatAttachmentList(attachments: unknown[]): string {
	return renderTable(
		attachments.map((raw) => asObj(raw) ?? {}),
		[
			{
				header: "TITLE",
				minWidth: 5,
				maxWidth: TITLE_TRUNC,
				extract: (a) => s(a.title),
			},
			{ header: "URL", minWidth: 3, maxWidth: 60, extract: (a) => s(a.url) },
			{
				header: "CREATED",
				minWidth: 7,
				extract: (a) => s(a.createdAt).slice(0, 10),
			},
		],
		{ emptyText: "(no attachments)", itemNoun: "attachment" },
	);
}

// ── releases ───────────────────────────────────────────────────

export function formatReleaseSummary(release: Record<string, unknown>): string {
	const name = s(release.name);
	const stage = asObj(release.stage);
	const fields: HeaderField[] = [
		{ label: "Version", value: s(release.version) },
		{ label: "Stage", value: stage ? s(stage.name) : "" },
		{ label: "Pipeline", value: getName(release.pipeline) },
		{ label: "Start", value: s(release.startDate) },
		{ label: "Target", value: s(release.targetDate) },
		{ label: "URL", value: s(release.url) },
	];
	const header = renderHeader(fields);
	const body = clipDescription(release.description as string | undefined);
	const parts = [name, header];
	if (body) parts.push("", body);
	return parts.filter((p) => p !== "").join("\n");
}

export function formatReleaseList(releases: unknown[]): string {
	return renderTable(
		releases.map((raw) => asObj(raw) ?? {}),
		[
			{
				header: "NAME",
				minWidth: 4,
				maxWidth: TITLE_TRUNC,
				extract: (r) => s(r.name),
			},
			{ header: "VERSION", minWidth: 7, extract: (r) => s(r.version) },
			{
				header: "STAGE",
				minWidth: 5,
				extract: (r) => {
					const stage = asObj(r.stage);
					return stage ? s(stage.name) : "—";
				},
			},
			{ header: "TARGET", minWidth: 6, extract: (r) => s(r.targetDate) },
		],
		{ emptyText: "(no releases)", itemNoun: "release" },
	);
}

// ── search-results (cross-resource) ────────────────────────────

export function formatSearchResultList(results: unknown[]): string {
	return renderTable(
		results.map((raw) => asObj(raw) ?? {}),
		[
			{ header: "TYPE", minWidth: 4, extract: (r) => s(r.type) },
			{
				header: "ID",
				minWidth: 2,
				maxWidth: 18,
				extract: (r) => s(r.identifier ?? r.id),
			},
			{
				header: "TITLE",
				minWidth: 5,
				maxWidth: TITLE_TRUNC,
				extract: (r) => s(r.title ?? r.name),
			},
		],
		{ emptyText: "(no results)", itemNoun: "result" },
	);
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
		// Route through sanitizeForTerminal (via `s()`) before slicing so that
		// long strings from the generic-fallback path can't smuggle ANSI
		// escapes (cursor moves, clear-screen, OSC 8 hyperlinks) into the
		// user's terminal. Every other branch in this function already goes
		// through `s()`; this one previously didn't.
		return `${s(v).slice(0, 80)}…`;
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
	| "document"
	| "document-list"
	| "template"
	| "template-list"
	| "attachment-list"
	| "release"
	| "release-list"
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
		return inferListKind(obj.data);
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
	if ("title" in obj && "content" in obj && "slugId" in obj) return "document";
	if ("name" in obj && "templateData" in obj) return "template";
	if (
		"name" in obj &&
		"stage" in obj &&
		("version" in obj || "pipeline" in obj)
	)
		return "release";
	if ("targetDate" in obj && "name" in obj && !("teams" in obj))
		return "milestone";
	if ("displayName" in obj && "email" in obj) return "user";

	return "generic";
}

function inferListKind(items: unknown[]): ResourceKind {
	if (items.length === 0) {
		// Empty list — render a generic "(no results)" marker. We avoid
		// falling through to "generic" because that renders envelope
		// keys (data, meta) rather than treating the payload as the
		// empty list it is.
		return "empty-list";
	}
	const sample = asObj(items[0]) ?? {};
	if ("identifier" in sample && "title" in sample) {
		// could be issue or search result
		if ("type" in sample && !("templateData" in sample)) {
			return "search-result-list";
		}
		return "issue-list";
	}
	if ("body" in sample && "createdAt" in sample) return "comment-list";
	if ("progress" in sample && "name" in sample) {
		if ("startsAt" in sample || "endsAt" in sample) return "cycle-list";
		return "project-list";
	}
	if ("title" in sample && ("content" in sample || "slugId" in sample))
		return "document-list";
	// templates always have type + name; some include team / templateData
	if (
		"name" in sample &&
		"type" in sample &&
		("templateData" in sample || "creator" in sample)
	)
		return "template-list";
	// releases: name + stage, typically with version or pipeline
	if (
		"name" in sample &&
		"stage" in sample &&
		("version" in sample || "pipeline" in sample)
	)
		return "release-list";
	if ("title" in sample && "url" in sample && !("identifier" in sample))
		return "attachment-list";
	if ("targetDate" in sample && "name" in sample) return "milestone-list";
	if ("key" in sample && "name" in sample) return "team-list";
	if ("color" in sample && "scope" in sample) return "label-list";
	if ("displayName" in sample && "email" in sample) return "user-list";
	return "generic";
}

/**
 * Resources where `--fields` projection is wired through to the formatter
 * (DEV-4750). For any other kind, passing `--fields` records a
 * deterministic unprojectable warning and renders the default summary.
 */
const FIELDS_PROJECTED: ReadonlySet<ResourceKind> = new Set([
	"issue",
	"issue-list",
	"project",
	"project-list",
]);

/**
 * Central dispatch: given a resource kind, payload, and optional `--fields`
 * projection list, return the formatted string. The payload for list kinds
 * may be either the raw array or a `{ data: [...] }` envelope — both are
 * handled.
 *
 * `fields` is forwarded to formatters that wire `--fields` projection
 * (issues, projects). For other kinds it's an opt-out path: we emit a
 * `fields_unprojectable` warning and render defaults. The eventual
 * direction is to wire projection through every list formatter; until
 * then the warning gives consumers a deterministic signal instead of
 * silently ignoring their flag.
 */
export function dispatch(
	kind: ResourceKind,
	payload: unknown,
	fields?: string[],
): string {
	const obj = asObj(payload);
	const list = (() => {
		if (Array.isArray(payload)) return payload;
		if (obj && Array.isArray(obj.data)) return obj.data;
		return null;
	})();

	const hasFields = Boolean(fields && fields.length > 0);
	if (hasFields && !FIELDS_PROJECTED.has(kind)) {
		recordUnprojectable(
			kind === "generic" ? "this resource" : kind,
			fields as string[],
		);
	}

	switch (kind) {
		case "issue":
			return formatIssueSummary((obj ?? {}) as Record<string, unknown>, fields);
		case "issue-list":
			return formatIssueList(list ?? [], fields);
		case "project":
			return formatProjectSummary(
				(obj ?? {}) as Record<string, unknown>,
				fields,
			);
		case "project-list":
			return formatProjectList(list ?? [], fields);
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
		case "document":
			return formatDocumentSummary((obj ?? {}) as Record<string, unknown>);
		case "document-list":
			return formatDocumentList(list ?? []);
		case "template":
			return formatTemplateSummary((obj ?? {}) as Record<string, unknown>);
		case "template-list":
			return formatTemplateList(list ?? []);
		case "attachment-list":
			return formatAttachmentList(list ?? []);
		case "release":
			return formatReleaseSummary((obj ?? {}) as Record<string, unknown>);
		case "release-list":
			return formatReleaseList(list ?? []);
		case "search-result-list":
			return formatSearchResultList(list ?? []);
		case "empty-list":
			return "(no results)";
		case "generic":
			return formatGenericSummary(payload);
	}
}

/**
 * One-line confirmation render for the `--quiet` write path.
 *
 * Writes (`issues create|update`, `comments create|update`) otherwise emit
 * the full JSON envelope; agents then `grep` it for the identifier / state /
 * url. `--quiet` routes the same payload here so the caller gets exactly one
 * machine-stable line and nothing else.
 *
 * - issue   → `IDENTIFIER  STATE  URL` (two-space separated, matching the
 *             summary header style). Empty fields collapse to `-`.
 * - comment → `comment <id>` (the create/update mutation doesn't fetch a url
 *             or the parent identifier, so the id — what you need to edit or
 *             reference the comment — is the stable handle).
 * - anything else → compact single-line JSON, so the contract ("one line,
 *             always parseable") holds even for payloads with no dedicated
 *             shape.
 */
export function formatLine(payload: unknown): string {
	const kind = inferKindFromPayload(payload);
	const obj = asObj(payload);
	if (kind === "issue" && obj) {
		// s()/getName() already render missing values as the em-dash placeholder
		// used throughout the summary formatter, keeping --quiet consistent.
		return `${s(obj.identifier)}  ${getName(obj.state)}  ${s(obj.url)}`;
	}
	if (kind === "comment" && obj) {
		return `comment ${s(obj.id)}`;
	}
	return JSON.stringify(payload);
}
