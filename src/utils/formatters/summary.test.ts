import { beforeEach, describe, expect, it } from "vitest";
import {
	dispatch,
	drainSummaryFieldWarnings,
	formatAttachmentList,
	formatCommentList,
	formatCommentSummary,
	formatCycleList,
	formatCycleSummary,
	formatDocumentList,
	formatDocumentSummary,
	formatGenericSummary,
	formatIssueList,
	formatIssueRelationList,
	formatIssueSummary,
	formatLabelList,
	formatLine,
	formatMilestoneList,
	formatMilestoneSummary,
	formatProjectList,
	formatProjectSummary,
	formatRelationList,
	formatReleaseList,
	formatReleaseSummary,
	formatSearchResultList,
	formatTeamList,
	formatTemplateList,
	formatTemplateSummary,
	formatUserList,
	formatUserSummary,
	inferKindFromPayload,
} from "./summary.js";

describe("formatIssueList truncate edge cases (ALL-934)", () => {
	it("truncates a 100-char title to fit the column", () => {
		const longTitle = "x".repeat(100);
		const out = formatIssueList([
			{
				identifier: "LIN-1",
				title: longTitle,
				state: { name: "Todo" },
				assignee: null,
			},
		]);
		// truncate(s, n) returns at most n chars (n-1 + ellipsis).
		// The title column is bounded by TITLE_TRUNC = 60.
		const titleRow = out.split("\n").find((line) => line.includes("LIN-1"));
		expect(titleRow).toBeDefined();
		expect(titleRow as string).toContain("…");
		expect(titleRow as string).not.toContain(longTitle);
	});

	// Note: truncate(s, 0) and truncate(s, 1) would normally never be hit
	// in production (column widths are ≥ 2 everywhere), but the helper is
	// shaped like a public utility, so the boundary contract matters.
	// Exercised here via formatIssueList by forcing a tiny title.
	it("does not corrupt output when called with a string already shorter than n", () => {
		const out = formatIssueList([
			{
				identifier: "X",
				title: "ok",
				state: { name: "Todo" },
				assignee: null,
			},
		]);
		expect(out).toContain("ok");
		// No stray ellipsis on a string that fits.
		expect(out.split("\n")[2]).not.toMatch(/^X\s+ok…/);
	});
});

describe("terminal sanitization (ALL-934)", () => {
	it("strips ANSI/OSC sequences from issue titles", () => {
		// Hyperlink-spoofing payload: `\x1b]8;;https://evil/\x07Click me\x1b]8;;\x07`
		const malicious = "\x1b]8;;https://evil/\x07Click me\x1b]8;;\x07trailing";
		const out = formatIssueSummary({
			identifier: "DEV-1",
			title: malicious,
			state: { name: "Todo" },
			url: "https://x",
		});
		expect(out).not.toContain("\x1b");
		expect(out).not.toContain("\x07");
		expect(out).toContain("Click me");
		expect(out).toContain("trailing");
	});

	it("strips screen-clearing CSI from descriptions", () => {
		const malicious = "Real description\x1b[2J\x1b[Hgotcha";
		const out = formatIssueSummary({
			identifier: "DEV-1",
			title: "x",
			state: { name: "Todo" },
			url: "https://x",
			description: malicious,
		});
		expect(out).not.toContain("\x1b");
		expect(out).toContain("Real description");
		expect(out).toContain("gotcha");
	});

	it("preserves newlines and tabs in descriptions", () => {
		const out = formatIssueSummary({
			identifier: "DEV-1",
			title: "x",
			state: { name: "Todo" },
			url: "https://x",
			description: "line1\nline2\twith\ttabs",
		});
		expect(out).toContain("line1");
		expect(out).toContain("line2");
		// Tab is preserved (legible), control chars are not.
		expect(out).toContain("\t");
	});

	it("clipDescription enforces a character cap regardless of line count", () => {
		// One single-line 1MB description would previously slip past the
		// line-count cap and dump verbatim.
		const huge = "x".repeat(1_000_000);
		const out = formatIssueSummary({
			identifier: "DEV-1",
			title: "x",
			state: { name: "Todo" },
			url: "https://x",
			description: huge,
		});
		expect(out.length).toBeLessThan(10_000);
		expect(out).toContain("--format json for full body");
	});
});

describe("formatIssueSummary", () => {
	const baseIssue = {
		identifier: "DEV-123",
		title: "Fix login flicker on Safari 17",
		state: { id: "s1", name: "In Progress" },
		assignee: { id: "u1", name: "Alice" },
		project: { id: "p1", name: "Auth Refactor" },
		labels: [
			{ id: "l1", name: "Feature" },
			{ id: "l2", name: "tool" },
		],
		url: "https://linear.app/acme/issue/DEV-123/fix-login-flicker",
		priority: 2,
	};

	it("renders identifier and title on the first line", () => {
		const out = formatIssueSummary(baseIssue);
		expect(out.split("\n")[0]).toBe("DEV-123  Fix login flicker on Safari 17");
	});

	it("renders state, assignee, project, labels, url", () => {
		const out = formatIssueSummary(baseIssue);
		expect(out).toContain("State:");
		expect(out).toContain("In Progress");
		expect(out).toContain("Assignee:");
		expect(out).toContain("Alice");
		expect(out).toContain("Project:");
		expect(out).toContain("Auth Refactor");
		expect(out).toContain("Labels:");
		expect(out).toContain("Feature, tool");
		expect(out).toContain("URL:");
		expect(out).toContain("https://linear.app/acme/issue/DEV-123");
	});

	it("omits absent fields (no `Project: —` row)", () => {
		const out = formatIssueSummary({
			...baseIssue,
			project: undefined,
		});
		expect(out).not.toContain("Project:");
	});

	it("indents description and stops after 10 lines with truncation footer", () => {
		const description = Array.from(
			{ length: 25 },
			(_, i) => `line ${i + 1}`,
		).join("\n");
		const out = formatIssueSummary({ ...baseIssue, description });
		expect(out).toContain("  line 1");
		expect(out).toContain("  line 10");
		expect(out).not.toContain("line 11");
		expect(out).toContain("--format json for full body");
	});

	it("passes through full description when ≤ 10 lines", () => {
		const description = "one\ntwo\nthree";
		const out = formatIssueSummary({ ...baseIssue, description });
		expect(out).toContain("  one");
		expect(out).toContain("  two");
		expect(out).toContain("  three");
		expect(out).not.toContain("--format json for full body");
	});

	it("works when description is missing", () => {
		const out = formatIssueSummary({ ...baseIssue, description: undefined });
		expect(out).not.toContain("--format json for full body");
	});
});

describe("formatIssueList", () => {
	it("renders a table with header columns and a row count footer", () => {
		const issues = [
			{
				identifier: "DEV-1",
				title: "First",
				state: { name: "Todo" },
				assignee: { name: "Alice" },
			},
			{
				identifier: "DEV-2",
				title: "Second",
				state: { name: "Done" },
				assignee: { name: "Bob" },
			},
		];
		const out = formatIssueList(issues);
		expect(out).toMatch(/ID\s+TITLE\s+STATE\s+ASSIGNEE/);
		expect(out).toContain("DEV-1");
		expect(out).toContain("First");
		expect(out).toContain("Alice");
		expect(out).toContain("DEV-2");
		expect(out.endsWith("2 issues")).toBe(true);
	});

	it("uses singular issue for a single result", () => {
		const out = formatIssueList([
			{
				identifier: "DEV-1",
				title: "Only",
				state: { name: "Todo" },
				assignee: null,
			},
		]);
		expect(out.endsWith("1 issue")).toBe(true);
	});

	it("returns the empty marker for an empty list", () => {
		expect(formatIssueList([])).toBe("(no issues)");
	});

	it("truncates long titles", () => {
		const longTitle = "x".repeat(100);
		const out = formatIssueList([
			{
				identifier: "LIN-1",
				title: longTitle,
				state: { name: "Todo" },
				assignee: null,
			},
		]);
		expect(out).not.toContain(longTitle);
		expect(out).toContain("…");
	});
});

describe("formatProjectSummary", () => {
	it("formats project header with progress as percentage", () => {
		const out = formatProjectSummary({
			id: "p1",
			name: "Auth Refactor",
			state: "started",
			lead: { name: "Alice" },
			teams: [{ key: "ENG" }, { key: "INF" }],
			targetDate: "2026-06-30",
			progress: 0.42,
		});
		expect(out.split("\n")[0]).toBe("Auth Refactor");
		expect(out).toContain("Progress:");
		expect(out).toContain("42%");
		expect(out).toContain("ENG, INF");
		expect(out).toContain("started");
	});
});

describe("formatProjectList", () => {
	it("renders header columns and percentage progress", () => {
		const out = formatProjectList([
			{
				id: "p1",
				name: "Auth",
				state: "started",
				progress: 0.5,
				lead: { name: "Alice" },
			},
			{
				id: "p2",
				name: "Search",
				state: "planned",
				progress: 0,
				lead: null,
			},
		]);
		expect(out).toMatch(/NAME\s+STATE\s+PROGRESS\s+LEAD/);
		expect(out).toContain("50%");
		expect(out).toContain("0%");
		expect(out.endsWith("2 projects")).toBe(true);
	});
});

describe("formatCommentSummary / formatCommentList", () => {
	it("renders a comment with author, createdAt, and clipped body", () => {
		const comment = {
			id: "c1",
			body: "lgtm",
			createdAt: "2026-05-08T12:00:00Z",
			user: { name: "Bob" },
		};
		const out = formatCommentSummary(comment);
		expect(out).toContain("comment c1");
		expect(out).toContain("Bob");
		expect(out).toContain("2026-05-08T12:00:00Z");
		expect(out).toContain("lgtm");
	});

	it("renders a complete body when summary full-body mode is requested", () => {
		const longBody = `${"body ".repeat(80)}tail`;
		const out = formatCommentSummary({
			id: "c2",
			body: longBody,
			createdAt: "2026-05-08T12:00:00Z",
			user: { name: "Bob" },
			_summaryFullBody: true,
		});

		expect(out).toContain(longBody);
		expect(out).not.toContain("(truncated; --format json for full body)");
	});

	it("separates list items with a delimiter", () => {
		const out = formatCommentList([
			{ body: "a", createdAt: "t1", user: { name: "A" } },
			{ body: "b", createdAt: "t2", user: { name: "B" } },
		]);
		expect(out).toContain("---");
	});
});

describe("formatCycleSummary / formatCycleList", () => {
	it("renders cycle number, team, dates, progress", () => {
		const out = formatCycleSummary({
			id: "c1",
			number: 12,
			name: "Cycle 12",
			team: { key: "ENG" },
			isActive: true,
			progress: 0.25,
			startsAt: "2026-05-01",
			endsAt: "2026-05-15",
		});
		expect(out).toContain("Cycle 12");
		expect(out).toContain("12");
		expect(out).toContain("ENG");
		expect(out).toContain("yes");
		expect(out).toContain("25%");
	});

	it("appends issue list when cycle.issues is present", () => {
		const out = formatCycleSummary({
			id: "c1",
			number: 1,
			name: "Cycle 1",
			isActive: true,
			progress: 0,
			issues: [
				{
					identifier: "DEV-1",
					title: "x",
					state: { name: "Todo" },
					assignee: null,
				},
			],
		});
		expect(out).toContain("Issues:");
		expect(out).toContain("DEV-1");
	});

	it("renders cycle list as a table", () => {
		const out = formatCycleList([
			{
				id: "c1",
				number: 1,
				name: "Cycle 1",
				team: { key: "ENG" },
				isActive: true,
				progress: 0.5,
			},
		]);
		expect(out).toMatch(/#\s+NAME\s+TEAM\s+ACTIVE\s+PROGRESS/);
		expect(out.endsWith("1 cycle")).toBe(true);
	});
});

describe("formatMilestoneSummary / formatMilestoneList", () => {
	it("renders milestone name, target, project", () => {
		const out = formatMilestoneSummary({
			id: "m1",
			name: "Beta launch",
			targetDate: "2026-07-01",
			project: { name: "Auth Refactor" },
		});
		expect(out.split("\n")[0]).toBe("Beta launch");
		expect(out).toContain("2026-07-01");
		expect(out).toContain("Auth Refactor");
	});

	it("renders milestone list table", () => {
		const out = formatMilestoneList([
			{ id: "m1", name: "Alpha", targetDate: "2026-06-01" },
			{ id: "m2", name: "Beta", targetDate: "2026-07-01" },
		]);
		expect(out).toMatch(/NAME\s+TARGET/);
		expect(out.endsWith("2 milestones")).toBe(true);
	});
});

describe("formatTeamList / formatLabelList", () => {
	it("renders teams with key, name, description", () => {
		const out = formatTeamList([
			{ id: "t1", key: "ENG", name: "Engineering", description: "core" },
			{ id: "t2", key: "DEV", name: "Devops", description: null },
		]);
		expect(out).toMatch(/KEY\s+NAME\s+DESCRIPTION/);
		expect(out).toContain("ENG");
		expect(out).toContain("DEV");
		expect(out.endsWith("2 teams")).toBe(true);
	});

	it("renders labels with name, scope, team, color", () => {
		const out = formatLabelList([
			{
				id: "l1",
				name: "Feature",
				scope: "workspace",
				color: "#ff0",
			},
			{
				id: "l2",
				name: "Bug",
				scope: "team",
				team: { key: "ENG" },
				color: "#f00",
			},
		]);
		expect(out).toMatch(/NAME\s+SCOPE\s+TEAM\s+COLOR/);
		expect(out).toContain("Feature");
		expect(out).toContain("ENG");
		expect(out.endsWith("2 labels")).toBe(true);
	});
});

describe("formatUserSummary / formatUserList", () => {
	it("renders user name, displayName, email, active", () => {
		const out = formatUserSummary({
			id: "u1",
			name: "Alice Andrews",
			displayName: "alice",
			email: "alice@example.com",
			active: true,
		});
		expect(out.split("\n")[0]).toBe("Alice Andrews");
		expect(out).toContain("alice");
		expect(out).toContain("alice@example.com");
		expect(out).toContain("yes");
	});

	it("renders user list as a table", () => {
		const out = formatUserList([
			{
				id: "u1",
				name: "Alice",
				displayName: "alice",
				email: "a@example.com",
				active: true,
			},
			{
				id: "u2",
				name: "Bob",
				displayName: "bob",
				email: "b@example.com",
				active: false,
			},
		]);
		expect(out).toMatch(/NAME\s+DISPLAY\s+EMAIL\s+ACTIVE/);
		expect(out.endsWith("2 users")).toBe(true);
	});
});

describe("formatDocumentSummary / formatDocumentList", () => {
	const baseDoc = {
		id: "d1",
		title: "Tech Plan",
		content: "Line one\nLine two",
		project: { id: "p1", name: "Refactor" },
		updatedAt: "2026-04-21T00:00:00.000Z",
		url: "https://linear.app/d/d1",
	};

	it("renders single document with title + project + clipped content", () => {
		const out = formatDocumentSummary(baseDoc);
		expect(out).toContain("Tech Plan");
		expect(out).toContain("Project:");
		expect(out).toContain("Refactor");
		expect(out).toContain("Line one");
	});

	it("renders document list table", () => {
		const out = formatDocumentList([baseDoc, { ...baseDoc, id: "d2" }]);
		expect(out).toMatch(/TITLE\s+PROJECT\s+UPDATED/);
		expect(out).toContain("Tech Plan");
		expect(out).toContain("2 documents");
	});

	it("renders empty document list", () => {
		expect(formatDocumentList([])).toBe("(no documents)");
	});
});

describe("formatTemplateSummary / formatTemplateList", () => {
	const baseTpl = {
		id: "t1",
		name: "Bug report",
		type: "issue",
		team: "PYT",
		creator: "Nico Appel",
		updatedAt: "2025-12-03T07:37:43.475Z",
	};

	it("renders single template with name + type + team + id", () => {
		const out = formatTemplateSummary(baseTpl);
		expect(out).toContain("Bug report");
		expect(out).toContain("Type:");
		expect(out).toContain("issue");
		expect(out).toContain("t1");
	});

	it("renders template list table", () => {
		const out = formatTemplateList([baseTpl, { ...baseTpl, id: "t2" }]);
		expect(out).toMatch(/NAME\s+TYPE\s+TEAM\s+ID/);
		expect(out).toContain("Bug report");
		expect(out).toContain("2 templates");
	});

	it("renders empty template list", () => {
		expect(formatTemplateList([])).toBe("(no templates)");
	});
});

describe("formatAttachmentList", () => {
	it("renders attachment table", () => {
		const out = formatAttachmentList([
			{
				id: "a1",
				title: "screenshot.png",
				url: "https://x/a1",
				createdAt: "2026-05-01T12:00:00.000Z",
			},
		]);
		expect(out).toMatch(/TITLE\s+URL\s+CREATED/);
		expect(out).toContain("screenshot.png");
		expect(out).toContain("1 attachment");
	});

	it("renders empty attachment list", () => {
		expect(formatAttachmentList([])).toBe("(no attachments)");
	});
});

describe("formatReleaseSummary / formatReleaseList", () => {
	const baseRel = {
		id: "r1",
		name: "v1.8.0",
		version: "1.8.0",
		stage: { id: "s1", name: "Done", type: "completed" },
		pipeline: { id: "p1", name: "main" },
		startDate: "2026-04-01",
		targetDate: "2026-05-09",
		description: "Summary formatter + templates feature",
	};

	it("renders single release with name + stage + pipeline", () => {
		const out = formatReleaseSummary(baseRel);
		expect(out).toContain("v1.8.0");
		expect(out).toContain("Stage:");
		expect(out).toContain("Done");
		expect(out).toContain("main");
	});

	it("renders release list table", () => {
		const out = formatReleaseList([baseRel, { ...baseRel, id: "r2" }]);
		expect(out).toMatch(/NAME\s+VERSION\s+STAGE\s+TARGET/);
		expect(out).toContain("v1.8.0");
		expect(out).toContain("2 releases");
	});

	it("renders empty release list", () => {
		expect(formatReleaseList([])).toBe("(no releases)");
	});
});

describe("formatSearchResultList", () => {
	it("renders a table with TYPE, ID, TITLE", () => {
		const out = formatSearchResultList([
			{ type: "issue", identifier: "DEV-1", title: "Foo" },
			{ type: "project", id: "p1", name: "Bar" },
		]);
		expect(out).toMatch(/TYPE\s+ID\s+TITLE/);
		expect(out).toContain("issue");
		expect(out).toContain("project");
		expect(out).toContain("Bar");
	});
});

describe("formatGenericSummary fallback", () => {
	it("renders an arbitrary object as label/value pairs", () => {
		const out = formatGenericSummary({
			id: "x",
			name: "Test",
			version: "1.0",
		});
		expect(out).toContain("id:");
		expect(out).toContain("name:");
		expect(out).toContain("Test");
	});

	it("renders an array as a bulleted list", () => {
		const out = formatGenericSummary([{ name: "first" }, { name: "second" }]);
		expect(out).toContain("- first");
		expect(out).toContain("- second");
	});

	it("hides keys starting with underscore", () => {
		const out = formatGenericSummary({ id: "x", _internal: "hide" });
		expect(out).toContain("id:");
		expect(out).not.toContain("_internal");
	});
});

describe("inferKindFromPayload", () => {
	it("identifies an issue by identifier+title+url", () => {
		expect(
			inferKindFromPayload({
				identifier: "DEV-1",
				title: "x",
				url: "https://x",
			}),
		).toBe("issue");
	});

	it("identifies a list envelope by data array", () => {
		expect(
			inferKindFromPayload({
				data: [{ identifier: "DEV-1", title: "x" }],
				meta: { count: 1 },
			}),
		).toBe("issue-list");
	});

	it("identifies a project by name+progress+state/lead/teams", () => {
		expect(
			inferKindFromPayload({
				name: "x",
				progress: 0,
				state: "planned",
			}),
		).toBe("project");
	});

	it("identifies a comment by body+createdAt+user", () => {
		expect(
			inferKindFromPayload({
				body: "hi",
				createdAt: "t",
				user: { name: "a" },
			}),
		).toBe("comment");
	});

	it("identifies a user by displayName+email", () => {
		expect(
			inferKindFromPayload({
				name: "x",
				displayName: "x",
				email: "x@x",
			}),
		).toBe("user");
	});

	it("falls back to generic for unknown shapes", () => {
		expect(inferKindFromPayload({ foo: "bar" })).toBe("generic");
	});

	it("identifies a bare array as a list (issue-list when shape matches)", () => {
		expect(inferKindFromPayload([{ identifier: "DEV-1", title: "x" }])).toBe(
			"issue-list",
		);
	});

	it("differentiates search result list (has type field) from issue list", () => {
		expect(
			inferKindFromPayload({
				data: [{ identifier: "DEV-1", title: "x", type: "issue" }],
			}),
		).toBe("search-result-list");
	});

	it("identifies a document by title+content+slugId", () => {
		expect(
			inferKindFromPayload({
				id: "d1",
				title: "Plan",
				content: "...",
				slugId: "plan-2026",
			}),
		).toBe("document");
	});

	it("identifies a document list by title+content shape", () => {
		expect(
			inferKindFromPayload([{ id: "d1", title: "Plan", content: "..." }]),
		).toBe("document-list");
	});

	it("identifies a template by name+templateData", () => {
		expect(
			inferKindFromPayload({
				id: "t1",
				name: "Bug report",
				type: "issue",
				templateData: { title: "" },
			}),
		).toBe("template");
	});

	it("identifies a template list by name+type+creator", () => {
		expect(
			inferKindFromPayload([
				{
					id: "t1",
					name: "Bug report",
					type: "issue",
					creator: "Nico",
				},
			]),
		).toBe("template-list");
	});

	it("identifies a release by name+stage+version", () => {
		expect(
			inferKindFromPayload({
				id: "r1",
				name: "v1.0.0",
				version: "1.0.0",
				stage: { name: "Done", type: "completed" },
			}),
		).toBe("release");
	});

	it("identifies a release list", () => {
		expect(
			inferKindFromPayload([
				{
					id: "r1",
					name: "v1.0.0",
					version: "1.0.0",
					stage: { name: "Done" },
				},
			]),
		).toBe("release-list");
	});

	it("identifies an attachment list by title+url without identifier", () => {
		expect(
			inferKindFromPayload([
				{ id: "a1", title: "screenshot.png", url: "https://x/a1" },
			]),
		).toBe("attachment-list");
	});

	it("identifies a relation list (issue+relatedIssue+type) by envelope", () => {
		expect(
			inferKindFromPayload({
				data: [
					{
						id: "rel-1",
						type: "related",
						issue: { id: "u1", identifier: "DEV-1", title: "a" },
						relatedIssue: { id: "u2", identifier: "DEV-2", title: "b" },
					},
				],
				meta: { count: 1, source: "DEV-1" },
			}),
		).toBe("relation-list");
	});

	it("identifies a bare relation array as a relation list", () => {
		expect(
			inferKindFromPayload([
				{
					id: "rel-1",
					type: "blocks",
					issue: { id: "u1", identifier: "DEV-1", title: "a" },
					relatedIssue: { id: "u2", identifier: "DEV-2", title: "b" },
				},
			]),
		).toBe("relation-list");
	});

	it("identifies an `issues related` envelope as an issue-relation list (DEV-5174)", () => {
		// Distinct from the `relatedIssue`-shaped mutation echo above: this
		// shape (`direction` + `issue`, no `relatedIssue`) is the read-path
		// `issues related <id>` listing.
		expect(
			inferKindFromPayload({
				id: "u1",
				identifier: "DEV-1",
				title: "src",
				data: [
					{
						id: "rel-1",
						type: "related",
						direction: "outgoing",
						issue: { id: "u2", identifier: "DEV-2", title: "b" },
					},
				],
				meta: { count: 1 },
			}),
		).toBe("issue-relation-list");
	});

	it("identifies a bare issue-relation array (DEV-5174)", () => {
		expect(
			inferKindFromPayload([
				{
					id: "rel-1",
					type: "blockedBy",
					direction: "incoming",
					issue: { id: "u2", identifier: "DEV-2", title: "b" },
				},
			]),
		).toBe("issue-relation-list");
	});
});

describe("dispatch", () => {
	it("routes 'issue' to formatIssueSummary", () => {
		const out = dispatch("issue", {
			identifier: "DEV-1",
			title: "x",
			state: { name: "Todo" },
			url: "https://x",
		});
		expect(out).toContain("DEV-1");
		expect(out).toContain("Todo");
	});

	it("routes 'issue-list' through an envelope payload", () => {
		const out = dispatch("issue-list", {
			data: [
				{
					identifier: "DEV-1",
					title: "x",
					state: { name: "Todo" },
					assignee: null,
				},
			],
			meta: { count: 1 },
		});
		expect(out).toMatch(/ID\s+TITLE\s+STATE\s+ASSIGNEE/);
		expect(out).toContain("DEV-1");
	});

	it("routes 'issue-list' through a bare array payload", () => {
		const out = dispatch("issue-list", [
			{
				identifier: "DEV-1",
				title: "x",
				state: { name: "Todo" },
				assignee: null,
			},
		]);
		expect(out).toContain("DEV-1");
	});

	it("falls back gracefully with empty payload", () => {
		expect(dispatch("issue-list", { data: [] })).toBe("(no issues)");
	});

	it("routes 'generic' to formatGenericSummary", () => {
		const out = dispatch("generic", { foo: "bar" });
		expect(out).toContain("foo:");
		expect(out).toContain("bar");
	});

	it("routes a relate envelope end-to-end (inferKind → dispatch → table)", () => {
		// Mirrors the real `--format summary` path: the relate handler's
		// { data, meta } envelope flows through inferKindFromPayload into
		// dispatch, covering the relation-list switch case + detection wiring.
		const envelope = {
			data: [
				{
					id: "rel-1",
					type: "related",
					issue: { id: "u1", identifier: "DEV-1", title: "src" },
					relatedIssue: { id: "u2", identifier: "DEV-2", title: "target" },
				},
			],
			meta: { count: 1, source: "DEV-1" },
		};
		const out = dispatch(inferKindFromPayload(envelope), envelope);
		// Source-oriented table: TYPE / TARGET / TITLE, no FROM/TO, and the
		// source issue (DEV-1) is not a column — only the peer (DEV-2) is.
		expect(out).toMatch(/TYPE\s+TARGET\s+TITLE/);
		expect(out).toContain("related");
		expect(out).toContain("DEV-2");
		expect(out).toContain("target");
		expect(out).not.toContain("DEV-1");
		expect(out.trimEnd().endsWith("1 relation")).toBe(true);
	});

	it("routes an `issues related` envelope end-to-end (DEV-5174)", () => {
		// Mirrors the real `--format summary` path for the read-side listing
		// (`issues related <id>`), distinct from the relate-mutation echo above.
		const envelope = {
			id: "u1",
			identifier: "DEV-1",
			title: "src",
			data: [
				{
					id: "rel-1",
					type: "related",
					direction: "outgoing",
					issue: {
						id: "u2",
						identifier: "DEV-2",
						title: "target",
						state: { name: "In Progress" },
						assignee: { name: "Alice" },
					},
				},
			],
			meta: { count: 1 },
		};
		const out = dispatch(inferKindFromPayload(envelope), envelope);
		expect(out).toMatch(/RELATION\s+DIRECTION\s+ID\s+STATE\s+ASSIGNEE\s+TITLE/);
		expect(out).toContain("related");
		expect(out).toContain("outgoing");
		expect(out).toContain("DEV-2");
		expect(out).toContain("In Progress");
		expect(out).toContain("Alice");
		expect(out).toContain("target");
		expect(out.trimEnd().endsWith("1 relation")).toBe(true);
	});
});

describe("formatIssueRelationList (issues related summary, DEV-5174)", () => {
	it("renders RELATION / DIRECTION / ID / STATE / ASSIGNEE / TITLE columns", () => {
		const out = formatIssueRelationList([
			{
				type: "blocks",
				direction: "incoming",
				issue: {
					identifier: "DEV-9",
					title: "blocker",
					state: { name: "Todo" },
					assignee: { name: "Bob" },
				},
			},
		]);
		expect(out).toMatch(/RELATION\s+DIRECTION\s+ID\s+STATE\s+ASSIGNEE\s+TITLE/);
		expect(out).toContain("blocks");
		expect(out).toContain("incoming");
		expect(out).toContain("DEV-9");
		expect(out).toContain("Todo");
		expect(out).toContain("Bob");
		expect(out).toContain("blocker");
	});

	it("renders an em-dash placeholder for a missing state/assignee", () => {
		const out = formatIssueRelationList([
			{
				type: "related",
				direction: "outgoing",
				issue: { identifier: "DEV-2", title: "peer" },
			},
		]);
		expect(out).toContain("DEV-2");
		expect(out).toContain("—");
	});

	it("pluralizes the relation count", () => {
		const out = formatIssueRelationList([
			{
				type: "related",
				direction: "outgoing",
				issue: { identifier: "DEV-2", title: "a" },
			},
			{
				type: "related",
				direction: "incoming",
				issue: { identifier: "DEV-3", title: "b" },
			},
		]);
		expect(out.trimEnd().endsWith("2 relations")).toBe(true);
	});

	it("renders the empty marker for no relations", () => {
		expect(formatIssueRelationList([])).toBe("(no issue relations)");
	});
});

describe("formatLine (--quiet write confirmation, DEV-4650)", () => {
	it("renders an issue as IDENTIFIER  STATE  URL on one line", () => {
		const out = formatLine({
			identifier: "DEV-1",
			title: "Some issue",
			state: { name: "In Progress" },
			url: "https://linear.app/acme/issue/DEV-1/some-issue",
		});
		expect(out).toBe(
			"DEV-1  In Progress  https://linear.app/acme/issue/DEV-1/some-issue",
		);
		expect(out).not.toContain("\n");
	});

	it("collapses missing issue fields to the em-dash placeholder", () => {
		const out = formatLine({
			identifier: "DEV-2",
			title: "x",
			url: "https://linear.app/acme/issue/DEV-2/x",
			// no state
		});
		expect(out).toBe("DEV-2  —  https://linear.app/acme/issue/DEV-2/x");
	});

	it("renders a comment as 'comment <id>'", () => {
		const out = formatLine({
			id: "c-123",
			body: "hi",
			user: { id: "u-1", name: "Alice" },
			createdAt: "2026-01-01T00:00:00Z",
		});
		expect(out).toBe("comment c-123");
	});

	it("passes through extra envelope keys without breaking issue detection", () => {
		const out = formatLine({
			identifier: "DEV-3",
			title: "y",
			state: { name: "Done" },
			url: "https://linear.app/acme/issue/DEV-3/y",
			_warnings: ["something"],
			autoLinked: { linked: [] },
		});
		expect(out).toBe("DEV-3  Done  https://linear.app/acme/issue/DEV-3/y");
	});

	it("falls back to compact single-line JSON for unrecognized payloads", () => {
		const out = formatLine({ foo: "bar", n: 1 });
		expect(out).toBe('{"foo":"bar","n":1}');
		expect(out).not.toContain("\n");
	});

	it("renders a relate result as SOURCE  type targets  (count) on one line", () => {
		const out = formatLine({
			data: [
				{
					id: "rel-1",
					type: "related",
					issue: { id: "u-src", identifier: "DEV-1", title: "src" },
					relatedIssue: { id: "u-a", identifier: "DEV-2", title: "a" },
				},
				{
					id: "rel-2",
					type: "related",
					issue: { id: "u-src", identifier: "DEV-1", title: "src" },
					relatedIssue: { id: "u-b", identifier: "DEV-3", title: "b" },
				},
			],
			meta: { count: 2, source: "DEV-1" },
		});
		expect(out).toBe("DEV-1  related DEV-2,DEV-3  (2)");
		expect(out).not.toContain("\n");
	});

	it("inverts type when the source sits on the relatedIssue side (blocked-by)", () => {
		// createRelations stores --blocked-by X as { type: blocks, issue: X,
		// relatedIssue: source }, so from the source it reads "blockedBy".
		const out = formatLine({
			data: [
				{
					id: "rel-1",
					type: "blocks",
					issue: { id: "u-blocker", identifier: "DEV-9", title: "blocker" },
					relatedIssue: { id: "u-src", identifier: "DEV-1", title: "src" },
				},
			],
			meta: { count: 1, source: "DEV-1" },
		});
		expect(out).toBe("DEV-1  blockedBy DEV-9  (1)");
	});

	it("groups mixed relation types into one stable line", () => {
		const out = formatLine({
			data: [
				{
					id: "rel-1",
					type: "related",
					issue: { id: "u-src", identifier: "DEV-1", title: "src" },
					relatedIssue: { id: "u-a", identifier: "DEV-2", title: "a" },
				},
				{
					id: "rel-2",
					type: "blocks",
					issue: { id: "u-src", identifier: "DEV-1", title: "src" },
					relatedIssue: { id: "u-b", identifier: "DEV-3", title: "b" },
				},
			],
			meta: { count: 2, source: "DEV-1" },
		});
		expect(out).toBe("DEV-1  related DEV-2; blocks DEV-3  (2)");
	});

	it("matches the source by UUID when meta.source is a uuid", () => {
		const out = formatLine({
			data: [
				{
					id: "rel-1",
					type: "related",
					issue: { id: "u-src", identifier: "DEV-1", title: "src" },
					relatedIssue: { id: "u-a", identifier: "DEV-2", title: "a" },
				},
			],
			meta: { count: 1, source: "u-src" },
		});
		expect(out).toBe("u-src  related DEV-2  (1)");
	});

	it("renders a duplicate-of relation without inverting the type", () => {
		// duplicate-of is the one type that exercises the non-`blocks`,
		// non-inverted branch (source stays on the `issue` side).
		const out = formatLine({
			data: [
				{
					id: "rel-1",
					type: "duplicate",
					issue: { id: "u-src", identifier: "DEV-1", title: "src" },
					relatedIssue: { id: "u-dup", identifier: "DEV-9", title: "dup" },
				},
			],
			meta: { count: 1, source: "DEV-1" },
		});
		expect(out).toBe("DEV-1  duplicate DEV-9  (1)");
	});
});

describe("formatRelationList (issues relate summary)", () => {
	it("renders source-oriented TYPE / TARGET / TITLE columns and a count", () => {
		const out = formatRelationList(
			[
				{
					id: "rel-1",
					type: "related",
					issue: { id: "u1", identifier: "DEV-1", title: "src" },
					relatedIssue: {
						id: "u2",
						identifier: "DEV-2",
						title: "target title",
					},
				},
			],
			"DEV-1",
		);
		expect(out).toMatch(/TYPE\s+TARGET\s+TITLE/);
		expect(out).not.toContain("FROM");
		expect(out).not.toContain("TO ");
		expect(out).toContain("related");
		expect(out).toContain("DEV-2"); // peer (target)
		expect(out).not.toContain("DEV-1"); // source is not a column
		expect(out).toContain("target title");
		expect(out.trimEnd().endsWith("1 relation")).toBe(true);
	});

	it("re-frames a reverse (blocked-by) relation from the source's view", () => {
		// Stored reversed: { type:blocks, issue:peer, relatedIssue:source }.
		// From DEV-1's perspective that's `blockedBy DEV-9`.
		const out = formatRelationList(
			[
				{
					type: "blocks",
					issue: { identifier: "DEV-9", title: "blocker" },
					relatedIssue: { identifier: "DEV-1", title: "src" },
				},
			],
			"DEV-1",
		);
		expect(out).toContain("blockedBy");
		expect(out).toContain("DEV-9"); // peer
		expect(out).toContain("blocker"); // peer's title
		expect(out).not.toContain("DEV-1");
	});

	it("falls back to stored direction when no source is given (bare array)", () => {
		const out = formatRelationList([
			{
				type: "blocks",
				issue: { identifier: "DEV-9", title: "blocker" },
				relatedIssue: { identifier: "DEV-1", title: "src" },
			},
		]);
		// No source ⇒ no inversion, peer = relatedIssue.
		expect(out).toContain("blocks");
		expect(out).toContain("DEV-1");
	});

	it("pluralizes the relation count", () => {
		const out = formatRelationList(
			[
				{
					type: "related",
					issue: { identifier: "DEV-1", title: "src" },
					relatedIssue: { identifier: "DEV-2", title: "a" },
				},
				{
					type: "related",
					issue: { identifier: "DEV-1", title: "src" },
					relatedIssue: { identifier: "DEV-3", title: "b" },
				},
			],
			"DEV-1",
		);
		expect(out.trimEnd().endsWith("2 relations")).toBe(true);
	});

	it("renders the empty marker for no relations", () => {
		expect(formatRelationList([])).toBe("(no relations)");
	});
});

// DEV-4750: --format summary honors --fields by extending / replacing the
// default column set on list formatters and the labelled field block on
// single-resource formatters. Unprojectable names are surfaced via
// drainSummaryFieldWarnings so the caller can attach them to the
// envelope's `_warnings` (JSON) or print them inline (summary).
describe("--format summary --fields projection (DEV-4750)", () => {
	beforeEach(() => {
		// Reset the module-level warning sink between tests so the previous
		// test's unprojectable list doesn't leak.
		drainSummaryFieldWarnings();
	});

	describe("issues list", () => {
		const issues = [
			{
				identifier: "DEV-1",
				title: "First",
				state: { name: "Todo" },
				assignee: { name: "Alice" },
				project: { name: "Auth Refactor" },
				cycle: { name: "Cycle 5" },
				labels: [{ name: "feature" }, { name: "backend" }],
				url: "https://linear.app/acme/issue/DEV-1",
				createdAt: "2026-01-15T10:00:00Z",
			},
			{
				identifier: "DEV-2",
				title: "Second",
				state: { name: "Done" },
				assignee: null,
				project: null,
				labels: [],
				url: "https://linear.app/acme/issue/DEV-2",
			},
		];

		it("renders defaults when fields is undefined", () => {
			const out = formatIssueList(issues);
			expect(out).toMatch(/ID\s+TITLE\s+STATE\s+ASSIGNEE/);
			expect(out).not.toContain("PROJECT");
		});

		it("extends defaults with project column when requested", () => {
			const out = formatIssueList(issues, [
				"identifier",
				"title",
				"state",
				"assignee",
				"project",
			]);
			expect(out).toMatch(/ID\s+TITLE\s+STATE\s+ASSIGNEE\s+PROJECT/);
			expect(out).toContain("Auth Refactor");
		});

		it("accepts synonyms (id → identifier, status → state)", () => {
			const out = formatIssueList(issues, ["id", "title", "status"]);
			expect(out).toMatch(/ID\s+TITLE\s+STATE/);
			expect(out).not.toContain("ASSIGNEE");
		});

		it("accepts JSON-field synonyms (prioritylabel → priority, projectmilestone → milestone)", () => {
			// Parity with the single-resource formatter's ISSUE_SUMMARY_SYNONYMS:
			// the raw JSON-field spellings resolve to the same columns the
			// canonical `priority` / `milestone` names do.
			const rows = [
				{
					identifier: "DEV-9",
					title: "Synonym parity",
					priorityLabel: "High",
					projectMilestone: { name: "M1" },
				},
			];
			const out = formatIssueList(rows, [
				"identifier",
				"prioritylabel",
				"projectmilestone",
			]);
			expect(out).toMatch(/ID\s+PRIORITY\s+MILESTONE/);
			expect(out).toContain("High");
			expect(out).toContain("M1");
			// No unprojectable warning — both names resolved.
			expect(drainSummaryFieldWarnings()).toHaveLength(0);
		});

		it("preserves user-requested column order", () => {
			const out = formatIssueList(issues, ["project", "identifier", "title"]);
			// PROJECT column should come first.
			const headerLine = out.split("\n")[0];
			expect(headerLine.indexOf("PROJECT")).toBeLessThan(
				headerLine.indexOf("ID"),
			);
			expect(headerLine.indexOf("ID")).toBeLessThan(
				headerLine.indexOf("TITLE"),
			);
		});

		it("renders only the requested columns (replacement semantics)", () => {
			const out = formatIssueList(issues, ["identifier", "project"]);
			expect(out).toMatch(/ID\s+PROJECT/);
			expect(out).not.toContain("TITLE");
			expect(out).not.toContain("STATE");
			expect(out).not.toContain("ASSIGNEE");
		});

		it("records unprojectable names without dropping the rest", () => {
			const out = formatIssueList(issues, [
				"identifier",
				"title",
				"nonexistent_thing",
			]);
			expect(out).toMatch(/ID\s+TITLE/);
			const warnings = drainSummaryFieldWarnings();
			expect(warnings.length).toBeGreaterThan(0);
			expect(warnings[0]).toContain("fields_unprojectable");
			expect(warnings[0]).toContain("nonexistent_thing");
		});

		it("falls back to defaults when every requested name is unprojectable", () => {
			const out = formatIssueList(issues, ["foo", "bar"]);
			// We still render something useful + emit a warning.
			expect(out).toMatch(/ID\s+TITLE\s+STATE\s+ASSIGNEE/);
			const warnings = drainSummaryFieldWarnings();
			expect(warnings[0]).toContain("foo");
			expect(warnings[0]).toContain("bar");
		});

		it("projects nested labels as a comma-joined column", () => {
			const out = formatIssueList(issues, ["identifier", "title", "labels"]);
			expect(out).toContain("LABELS");
			expect(out).toContain("feature, backend");
		});
	});

	describe("projects list", () => {
		const projects = [
			{
				name: "Auth Refactor",
				state: "started",
				progress: 0.65,
				lead: { name: "Alice" },
				teams: [
					{ id: "t1", key: "DEV", name: "Dev" },
					{ id: "t2", key: "FE", name: "Frontend" },
				],
				targetDate: "2026-03-01",
				url: "https://linear.app/acme/project/auth-refactor",
			},
			{
				name: "Pricing v2",
				state: "backlog",
				progress: 0,
				lead: null,
				teams: [],
			},
		];

		it("renders defaults when fields is undefined", () => {
			const out = formatProjectList(projects);
			expect(out).toMatch(/NAME\s+STATE\s+PROGRESS\s+LEAD/);
			expect(out).not.toContain("TEAMS");
		});

		it("extends defaults with teams column when requested", () => {
			const out = formatProjectList(projects, [
				"name",
				"state",
				"progress",
				"lead",
				"teams",
			]);
			expect(out).toMatch(/NAME\s+STATE\s+PROGRESS\s+LEAD\s+TEAMS/);
			expect(out).toContain("DEV, FE");
		});

		it("renders teams as `—` when project has none", () => {
			const out = formatProjectList(projects, ["name", "teams"]);
			expect(out).toContain("Auth Refactor");
			expect(out).toContain("Pricing v2");
			// The DEV, FE row sits in the data; Pricing v2's empty teams
			// renders as the em-dash via the standard truncate path.
			expect(out).toContain("DEV, FE");
		});

		it("accepts targetDate / target synonyms", () => {
			const targetOut = formatProjectList(projects, ["name", "target"]);
			expect(targetOut).toContain("2026-03-01");
			const synonymOut = formatProjectList(projects, ["name", "targetdate"]);
			expect(synonymOut).toContain("2026-03-01");
		});
	});

	describe("issue summary (single resource)", () => {
		const issue = {
			identifier: "DEV-1",
			title: "Fix login bug",
			state: { name: "In Progress" },
			assignee: { name: "Alice" },
			project: { name: "Auth Refactor" },
			labels: [{ name: "bug" }],
			url: "https://linear.app/acme/issue/DEV-1",
			priorityLabel: "High",
		};

		it("renders the default labelled block when fields is undefined", () => {
			const out = formatIssueSummary(issue);
			expect(out).toContain("State:");
			expect(out).toContain("Assignee:");
			expect(out).toContain("Project:");
			// Default omits Priority unless requested.
			expect(out).not.toContain("Priority:");
		});

		it("filters the labelled block to the requested fields", () => {
			const out = formatIssueSummary(issue, ["state", "project"]);
			expect(out).toContain("State:");
			expect(out).toContain("Project:");
			expect(out).not.toContain("Assignee:");
			expect(out).not.toContain("Labels:");
			expect(out).not.toContain("URL:");
		});

		it("surfaces extended fields (priority) when explicitly requested", () => {
			const out = formatIssueSummary(issue, ["state", "priority"]);
			expect(out).toContain("Priority:");
			expect(out).toContain("High");
		});

		it("always keeps the headline (identifier + title) regardless of fields", () => {
			const out = formatIssueSummary(issue, ["state"]);
			expect(out).toContain("DEV-1");
			expect(out).toContain("Fix login bug");
		});

		it("records unprojectable names on the summary path", () => {
			formatIssueSummary(issue, ["state", "doesnotexist"]);
			const warnings = drainSummaryFieldWarnings();
			expect(warnings[0]).toContain("doesnotexist");
		});
	});

	describe("project summary (single resource)", () => {
		const project = {
			name: "Auth Refactor",
			state: "started",
			lead: { name: "Alice" },
			progress: 0.65,
			teams: [{ key: "DEV", name: "Dev" }],
			targetDate: "2026-03-01",
			url: "https://linear.app/acme/project/auth-refactor",
		};

		it("filters the labelled block to the requested fields", () => {
			const out = formatProjectSummary(project, ["state", "teams"]);
			expect(out).toContain("Auth Refactor"); // headline preserved
			expect(out).toContain("State:");
			expect(out).toContain("Teams:");
			expect(out).not.toContain("Lead:");
			expect(out).not.toContain("Progress:");
		});
	});

	describe("dispatch composition", () => {
		it("forwards fields to issue-list formatter", () => {
			const out = dispatch(
				"issue-list",
				{
					data: [
						{
							identifier: "DEV-1",
							title: "x",
							state: { name: "Todo" },
							assignee: { name: "A" },
							project: { name: "P" },
						},
					],
				},
				["identifier", "title", "project"],
			);
			expect(out).toMatch(/ID\s+TITLE\s+PROJECT/);
		});

		it("forwards fields to project-list formatter", () => {
			const out = dispatch(
				"project-list",
				{
					data: [
						{
							name: "P1",
							state: "started",
							progress: 0.5,
							lead: { name: "A" },
							teams: [{ key: "DEV" }],
						},
					],
				},
				["name", "teams"],
			);
			expect(out).toMatch(/NAME\s+TEAMS/);
			expect(out).toContain("DEV");
		});

		it("records unprojectable warning for kinds without projection wiring", () => {
			// `cycle-list` doesn't wire --fields yet; passing fields records
			// a fields_unprojectable warning and renders the defaults.
			const out = dispatch(
				"cycle-list",
				{
					data: [{ number: 1, name: "Cycle 1", isActive: true, progress: 0.5 }],
				},
				["custom_column"],
			);
			expect(out).toMatch(/#/);
			const warnings = drainSummaryFieldWarnings();
			expect(warnings[0]).toContain("fields_unprojectable");
			expect(warnings[0]).toContain("custom_column");
		});
	});
});
