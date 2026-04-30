import pc from "picocolors";
import type { LinearIssue } from "../types/linear.js";
import { PRIORITY_LABELS } from "./validators.js";

interface ColumnDef {
	colorize?: (value: string, issue: LinearIssue) => string;
	extract: (issue: LinearIssue) => string;
	header: string;
	key: string;
	width: number;
}

// ── Status colors ──────────────────────────────────────────────

const STATUS_COLORS: Record<string, (s: string) => string> = {
	triage: pc.magenta,
	backlog: pc.dim,
	todo: pc.white,
	"in progress": pc.cyan,
	"in review": pc.blue,
	done: pc.green,
	canceled: (s) => pc.dim(pc.strikethrough(s)),
	cancelled: (s) => pc.dim(pc.strikethrough(s)),
	duplicate: (s) => pc.dim(pc.strikethrough(s)),
};

function colorizeStatus(value: string): string {
	const fn = STATUS_COLORS[value.toLowerCase()];
	return fn ? fn(value) : value;
}

// ── Priority formatting ────────────────────────────────────────

const PRIORITY_PREFIX: Record<number, string> = {
	0: "",
	1: "▲▲▲ ",
	2: "▲▲  ",
	3: "▲   ",
	4: "▽   ",
};

const PRIORITY_COLORS: Record<number, (s: string) => string> = {
	0: pc.dim,
	1: (s) => pc.red(pc.bold(s)),
	2: pc.yellow,
	3: pc.cyan,
	4: pc.dim,
};

function extractPriority(issue: LinearIssue): string {
	const label = PRIORITY_LABELS[issue.priority] ?? "—";
	const prefix = PRIORITY_PREFIX[issue.priority] ?? "";
	return `${prefix}${label}`;
}

function colorizePriority(value: string, issue: LinearIssue): string {
	const fn = PRIORITY_COLORS[issue.priority];
	return fn ? fn(value) : value;
}

// ── Hyperlinks ─────────────────────────────────────────────────

function hyperlink(text: string, url: string): string {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

// ── Column definitions ─────────────────────────────────────────

const ALL_COLUMNS: Record<string, ColumnDef> = {
	identifier: {
		key: "identifier",
		header: "ID",
		width: 10,
		extract: (i) => i.identifier,
		colorize: (value, issue) => hyperlink(value, issue.url),
	},
	title: {
		key: "title",
		header: "Title",
		width: 55,
		extract: (i) => i.title,
	},
	status: {
		key: "status",
		header: "Status",
		width: 14,
		extract: (i) => i.state?.name ?? "—",
		colorize: (v) => colorizeStatus(v),
	},
	priority: {
		key: "priority",
		header: "Priority",
		width: 16,
		extract: extractPriority,
		colorize: colorizePriority,
	},
	assignee: {
		key: "assignee",
		header: "Assignee",
		width: 20,
		extract: (i) => {
			if (!i.assignee) {
				return "—";
			}
			const name = i.assignee.name;
			const atIdx = name.indexOf("@");
			return atIdx > 0 ? name.slice(0, atIdx) : name;
		},
	},
	project: {
		key: "project",
		header: "Project",
		width: 28,
		extract: (i) => i.project?.name ?? "—",
	},
	team: {
		key: "team",
		header: "Team",
		width: 6,
		extract: (i) => i.team?.key ?? "—",
	},
	labels: {
		key: "labels",
		header: "Labels",
		width: 25,
		extract: (i) => i.labels.map((l) => l.name).join(", ") || "—",
	},
	updated: {
		key: "updated",
		header: "Updated",
		width: 12,
		extract: (i) => i.updatedAt.slice(0, 10),
	},
};

const DEFAULT_COLUMNS = [
	"identifier",
	"title",
	"status",
	"priority",
	"assignee",
	"project",
];

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) {
		return str;
	}
	return `${str.slice(0, maxLen - 1)}…`;
}

function pad(str: string, width: number): string {
	const truncated = truncate(str, width);
	return truncated + " ".repeat(Math.max(0, width - truncated.length));
}

export function formatTable(
	issues: LinearIssue[],
	fieldNames?: string[],
): string {
	const columnKeys = fieldNames ?? DEFAULT_COLUMNS;
	const columns = columnKeys
		.map((key) => ALL_COLUMNS[key])
		.filter((col): col is ColumnDef => col !== undefined);

	if (columns.length === 0) {
		return "No valid columns specified.";
	}

	const header = columns.map((col) => pad(col.header, col.width)).join("  ");
	const separator = columns.map((col) => "─".repeat(col.width)).join("──");

	const rows = issues.map((issue) =>
		columns
			.map((col) => {
				const padded = pad(col.extract(issue), col.width);
				return col.colorize ? col.colorize(padded, issue) : padded;
			})
			.join("  "),
	);

	return [header, separator, ...rows].join("\n");
}

export function formatCsv(
	issues: LinearIssue[],
	fieldNames?: string[],
): string {
	const columnKeys = fieldNames ?? DEFAULT_COLUMNS;
	const columns = columnKeys
		.map((key) => ALL_COLUMNS[key])
		.filter((col): col is ColumnDef => col !== undefined);

	const header = columns.map((col) => col.header).join(",");
	const rows = issues.map((issue) =>
		columns
			.map((col) => {
				const value = col.extract(issue);
				return value.includes(",") || value.includes('"')
					? `"${value.replace(/"/g, '""')}"`
					: value;
			})
			.join(","),
	);

	return [header, ...rows].join("\n");
}

// ── Markdown formatting ────────────────────────────────────────

const STATUS_MD: Record<string, (s: string) => string> = {
	triage: (s) => `**${s}**`,
	backlog: (s) => s,
	todo: (s) => s,
	"in progress": (s) => `**${s}**`,
	"in review": (s) => `*${s}*`,
	done: (s) => `~~${s}~~`,
	canceled: (s) => `~~${s}~~`,
	cancelled: (s) => `~~${s}~~`,
	duplicate: (s) => `~~${s}~~`,
};

const PRIORITY_MD: Record<number, string> = {
	0: "—",
	1: "**‼ Urgent**",
	2: "**! High**",
	3: "Medium",
	4: "Low",
};

interface MarkdownColumnDef {
	align?: "left" | "right";
	extract: (issue: LinearIssue) => string;
	header: string;
}

const MD_COLUMNS: Record<string, MarkdownColumnDef> = {
	identifier: {
		header: "Issue",
		extract: (i) => `[${i.identifier}](${i.url})`,
	},
	title: {
		header: "Title",
		extract: (i) => i.title,
	},
	status: {
		header: "Status",
		extract: (i) => {
			const name = i.state?.name ?? "—";
			const fn = STATUS_MD[name.toLowerCase()];
			return fn ? fn(name) : name;
		},
	},
	priority: {
		header: "Priority",
		extract: (i) => PRIORITY_MD[i.priority] ?? "—",
	},
	assignee: {
		header: "Assignee",
		extract: (i) => {
			if (!i.assignee) {
				return "—";
			}
			const name = i.assignee.name;
			const atIdx = name.indexOf("@");
			return atIdx > 0 ? name.slice(0, atIdx) : name;
		},
	},
	project: {
		header: "Project",
		extract: (i) => i.project?.name ?? "—",
	},
	team: {
		header: "Team",
		extract: (i) => i.team?.key ?? "—",
	},
	labels: {
		header: "Labels",
		extract: (i) => i.labels.map((l) => l.name).join(", ") || "—",
	},
	updated: {
		header: "Updated",
		extract: (i) => i.updatedAt.slice(0, 10),
	},
};

function escapeMarkdownCell(str: string): string {
	return str.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formatMarkdown(
	issues: LinearIssue[],
	fieldNames?: string[],
): string {
	const columnKeys = fieldNames ?? DEFAULT_COLUMNS;
	const columns = columnKeys
		.map((key) => MD_COLUMNS[key])
		.filter((col): col is MarkdownColumnDef => col !== undefined);

	if (columns.length === 0) {
		return "No valid columns specified.";
	}

	const header = `| ${columns.map((col) => col.header).join(" | ")} |`;
	const divider = `| ${columns.map((col) => (col.align === "right" ? "---:" : "---")).join(" | ")} |`;
	const rows = issues.map(
		(issue) =>
			`| ${columns.map((col) => escapeMarkdownCell(col.extract(issue))).join(" | ")} |`,
	);

	return [header, divider, ...rows].join("\n");
}
