import { describe, expect, it } from "vitest";
import type { IssueTreeNode } from "../queries/issue-tree.js";
import { formatTree } from "./format-tree.js";

function node(
	identifier: string,
	title: string,
	opts: {
		state?: { name: string; type: string };
		assignee?: string;
		children?: IssueTreeNode[];
	} = {},
): IssueTreeNode {
	return {
		id: `id-${identifier}`,
		identifier,
		title,
		state: opts.state ? { id: "s", ...opts.state } : null,
		assignee: opts.assignee ? { id: "u", name: opts.assignee } : null,
		children: opts.children ? { nodes: opts.children } : undefined,
	};
}

describe("formatTree", () => {
	it("renders a single root with no children", () => {
		expect(formatTree(node("DEV-1", "Root"))).toBe("DEV-1 Root");
	});

	it("renders one level of children with box-drawing prefixes", () => {
		const tree = node("DEV-1", "Root", {
			children: [node("DEV-2", "Child A"), node("DEV-3", "Child B")],
		});
		expect(formatTree(tree)).toBe(
			["DEV-1 Root", "├── DEV-2 Child A", "└── DEV-3 Child B"].join("\n"),
		);
	});

	it("renders multi-level nesting with continuation pipes", () => {
		const tree = node("DEV-1", "Root", {
			children: [
				node("DEV-2", "A", {
					children: [node("DEV-4", "A1"), node("DEV-5", "A2")],
				}),
				node("DEV-3", "B"),
			],
		});
		expect(formatTree(tree)).toBe(
			[
				"DEV-1 Root",
				"├── DEV-2 A",
				"│   ├── DEV-4 A1",
				"│   └── DEV-5 A2",
				"└── DEV-3 B",
			].join("\n"),
		);
	});

	it("annotates terminal states only (completed / canceled)", () => {
		const tree = node("DEV-1", "Root", {
			children: [
				node("DEV-2", "Done one", {
					state: { name: "Done", type: "completed" },
				}),
				node("DEV-3", "Canceled one", {
					state: { name: "Canceled", type: "canceled" },
				}),
				node("DEV-4", "In flight", {
					state: { name: "In Progress", type: "started" },
				}),
				node("DEV-5", "Backlog", {
					state: { name: "Backlog", type: "backlog" },
				}),
			],
		});
		expect(formatTree(tree)).toBe(
			[
				"DEV-1 Root",
				"├── DEV-2 Done one [Done]",
				"├── DEV-3 Canceled one [Canceled]",
				"├── DEV-4 In flight",
				"└── DEV-5 Backlog",
			].join("\n"),
		);
	});

	it("appends @assignee when present", () => {
		const tree = node("DEV-1", "Root", { assignee: "Alice" });
		expect(formatTree(tree)).toBe("DEV-1 Root (@Alice)");
	});
});
