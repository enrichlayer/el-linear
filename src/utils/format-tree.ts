/**
 * ASCII tree formatter for `issues tree <ID>` (DEV-4480).
 *
 * Renders a parent → children tree using the same box-drawing prefixes as
 * the standard `tree` Unix utility (`├── `, `└── `, `│   `, `    `). Each
 * line is `<prefix> <identifier> <title> <state-suffix>`, where the
 * state-suffix is `[Done]` / `[Canceled]` for terminal-typed states and
 * omitted otherwise.
 *
 * Pure rendering — does not fetch or filter. The depth bound and the
 * terminal-state exclusion are enforced by the caller before this runs.
 */

import type { IssueTreeNode } from "../queries/issue-tree.js";

const BRANCH_TEE = "├── ";
const BRANCH_END = "└── ";
const VERTICAL = "│   ";
const SPACE = "    ";

export function formatTree(root: IssueTreeNode): string {
	const lines: string[] = [formatNode(root)];
	const kids = root.children?.nodes ?? [];
	for (let i = 0; i < kids.length; i++) {
		appendSubtree(lines, kids[i], "", i === kids.length - 1);
	}
	return lines.join("\n");
}

function appendSubtree(
	lines: string[],
	node: IssueTreeNode,
	prefix: string,
	isLast: boolean,
): void {
	const branch = isLast ? BRANCH_END : BRANCH_TEE;
	lines.push(`${prefix}${branch}${formatNode(node)}`);
	const childPrefix = prefix + (isLast ? SPACE : VERTICAL);
	const kids = node.children?.nodes ?? [];
	for (let i = 0; i < kids.length; i++) {
		appendSubtree(lines, kids[i], childPrefix, i === kids.length - 1);
	}
}

function formatNode(node: IssueTreeNode): string {
	const stateSuffix = node.state ? formatStateSuffix(node.state) : "";
	const assigneeSuffix = node.assignee ? ` (@${node.assignee.name})` : "";
	return `${node.identifier} ${node.title}${stateSuffix}${assigneeSuffix}`;
}

function formatStateSuffix(state: { name: string; type: string }): string {
	// Only annotate terminal-typed states; the renderer is otherwise
	// state-name-agnostic so workspace-custom workflow states (e.g. "In
	// Review") don't get a noisy suffix.
	if (state.type === "completed" || state.type === "canceled") {
		return ` [${state.name}]`;
	}
	return "";
}
