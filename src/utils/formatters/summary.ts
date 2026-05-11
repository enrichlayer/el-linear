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
	return renderTable(
		issues.map((raw) => asObj(raw) ?? {}),
		[
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
		],
		{ emptyText: "(no issues)", itemNoun: "issue" },
	);
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

function pct(value: unknown): string {
	return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

export function formatProjectList(projects: unknown[]): string {
	return renderTable(
		projects.map((raw) => asObj(raw) ?? {}),
		[
			{
				header: "NAME",
				minWidth: 4,
				maxWidth: TITLE_TRUNC,
				extract: (p) => s(p.name),
			},
			{ header: "STATE", minWidth: 5, extract: (p) => s(p.state) },
			{ header: "PROGRESS", minWidth: 8, extract: (p) => pct(p.progress) },
			{ header: "LEAD", minWidth: 4, extract: (p) => getName(p.lead) },
		],
		{ emptyText: "(no projects)", itemNoun: "project" },
	);
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
