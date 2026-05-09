import { describe, expect, it } from "vitest";
import {
	dispatch,
	formatAttachmentList,
	formatCommentList,
	formatCommentSummary,
	formatCycleList,
	formatCycleSummary,
	formatDocumentList,
	formatDocumentSummary,
	formatGenericSummary,
	formatIssueList,
	formatIssueSummary,
	formatLabelList,
	formatMilestoneList,
	formatMilestoneSummary,
	formatProjectList,
	formatProjectSummary,
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
		expect(out).toContain("Bob");
		expect(out).toContain("2026-05-08T12:00:00Z");
		expect(out).toContain("lgtm");
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
});
