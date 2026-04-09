import { parse, Kind, visit } from "graphql";
import { describe, expect, it } from "vitest";
import {
	BATCH_RESOLVE_FOR_CREATE_QUERY,
	BATCH_RESOLVE_FOR_SEARCH_QUERY,
	BATCH_RESOLVE_FOR_UPDATE_QUERY,
	buildResolveLabelsByNameQuery,
	CREATE_ISSUE_MUTATION,
	FILTERED_SEARCH_ISSUES_QUERY,
	GET_ISSUE_BY_ID_QUERY,
	GET_ISSUE_BY_IDENTIFIER_QUERY,
	GET_ISSUE_RELATIONS_QUERY,
	GET_ISSUE_STATE_HISTORY_QUERY,
	GET_ISSUE_TEAM_QUERY,
	GET_ISSUES_QUERY,
	ISSUE_RELATION_CREATE_MUTATION,
	SCAN_ISSUES_QUERY,
	SEARCH_ISSUES_QUERY,
	UPDATE_ISSUE_MUTATION,
} from "./issues.js";

function extractVariables(query: string): string[] {
	const doc = parse(query);
	const vars: string[] = [];
	visit(doc, {
		VariableDefinition(node) {
			vars.push(node.variable.name.value);
		},
	});
	return vars;
}

function getOperationType(query: string): string {
	const doc = parse(query);
	const def = doc.definitions[0];
	return def.kind === Kind.OPERATION_DEFINITION ? def.operation : "unknown";
}

function containsField(query: string, fieldName: string): boolean {
	const doc = parse(query);
	let found = false;
	visit(doc, {
		Field(node) {
			if (node.name.value === fieldName) found = true;
		},
	});
	return found;
}

describe("GET_ISSUES_QUERY", () => {
	it("parses as a valid query", () => {
		expect(() => parse(GET_ISSUES_QUERY)).not.toThrow();
		expect(getOperationType(GET_ISSUES_QUERY)).toBe("query");
	});

	it("filters out completed issues", () => {
		expect(GET_ISSUES_QUERY).toContain('neq: "completed"');
	});

	it("supports pagination and ordering", () => {
		const vars = extractVariables(GET_ISSUES_QUERY);
		expect(vars).toContain("first");
		expect(vars).toContain("orderBy");
	});
});

describe("SEARCH_ISSUES_QUERY", () => {
	it("accepts term and first variables", () => {
		const vars = extractVariables(SEARCH_ISSUES_QUERY);
		expect(vars).toContain("term");
		expect(vars).toContain("first");
	});

	it("excludes archived issues", () => {
		expect(SEARCH_ISSUES_QUERY).toContain("includeArchived: false");
	});
});

describe("FILTERED_SEARCH_ISSUES_QUERY", () => {
	it("accepts filter, first, and orderBy", () => {
		const vars = extractVariables(FILTERED_SEARCH_ISSUES_QUERY);
		expect(vars).toContain("first");
		expect(vars).toContain("filter");
		expect(vars).toContain("orderBy");
	});
});

describe("BATCH_RESOLVE_FOR_SEARCH_QUERY", () => {
	it("resolves teams, projects, and users in a single query", () => {
		const vars = extractVariables(BATCH_RESOLVE_FOR_SEARCH_QUERY);
		expect(vars).toContain("teamKey");
		expect(vars).toContain("teamName");
		expect(vars).toContain("projectName");
		expect(vars).toContain("assigneeEmail");
	});

	it("returns teams, projects, and users data", () => {
		expect(containsField(BATCH_RESOLVE_FOR_SEARCH_QUERY, "teams")).toBe(true);
		expect(containsField(BATCH_RESOLVE_FOR_SEARCH_QUERY, "projects")).toBe(true);
		expect(containsField(BATCH_RESOLVE_FOR_SEARCH_QUERY, "users")).toBe(true);
	});
});

describe("GET_ISSUE_BY_ID_QUERY", () => {
	it("accepts id variable", () => {
		expect(extractVariables(GET_ISSUE_BY_ID_QUERY)).toContain("id");
	});

	it("includes comments (uses COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT)", () => {
		expect(containsField(GET_ISSUE_BY_ID_QUERY, "comments")).toBe(true);
	});
});

describe("GET_ISSUE_BY_IDENTIFIER_QUERY", () => {
	it("uses teamKey and number for lookup", () => {
		const vars = extractVariables(GET_ISSUE_BY_IDENTIFIER_QUERY);
		expect(vars).toContain("teamKey");
		expect(vars).toContain("number");
	});
});

describe("BATCH_RESOLVE_FOR_UPDATE_QUERY", () => {
	it("resolves projects, milestones, and issue by identifier", () => {
		const vars = extractVariables(BATCH_RESOLVE_FOR_UPDATE_QUERY);
		expect(vars).toContain("projectName");
		expect(vars).toContain("teamKey");
		expect(vars).toContain("issueNumber");
		expect(vars).toContain("milestoneName");
	});

	it("returns existing labels on the issue", () => {
		expect(containsField(BATCH_RESOLVE_FOR_UPDATE_QUERY, "labels")).toBe(true);
	});
});

describe("CREATE_ISSUE_MUTATION", () => {
	it("is a mutation", () => {
		expect(getOperationType(CREATE_ISSUE_MUTATION)).toBe("mutation");
	});

	it("accepts input variable", () => {
		expect(extractVariables(CREATE_ISSUE_MUTATION)).toEqual(["input"]);
	});

	it("returns success and issue data", () => {
		expect(containsField(CREATE_ISSUE_MUTATION, "success")).toBe(true);
		expect(containsField(CREATE_ISSUE_MUTATION, "identifier")).toBe(true);
	});
});

describe("UPDATE_ISSUE_MUTATION", () => {
	it("is a mutation with id and input", () => {
		expect(getOperationType(UPDATE_ISSUE_MUTATION)).toBe("mutation");
		const vars = extractVariables(UPDATE_ISSUE_MUTATION);
		expect(vars).toContain("id");
		expect(vars).toContain("input");
	});
});

describe("BATCH_RESOLVE_FOR_CREATE_QUERY", () => {
	it("resolves teams, projects, milestones, and parent issues", () => {
		const vars = extractVariables(BATCH_RESOLVE_FOR_CREATE_QUERY);
		expect(vars).toContain("teamKey");
		expect(vars).toContain("teamName");
		expect(vars).toContain("projectName");
		expect(vars).toContain("parentTeamKey");
		expect(vars).toContain("parentIssueNumber");
		expect(vars).toContain("milestoneName");
	});

	it("returns project milestones for inline resolution", () => {
		expect(containsField(BATCH_RESOLVE_FOR_CREATE_QUERY, "projectMilestones")).toBe(true);
	});
});

describe("buildResolveLabelsByNameQuery", () => {
	it("generates query for a single label", () => {
		const { query, variables } = buildResolveLabelsByNameQuery(["bug"]);
		expect(() => parse(query)).not.toThrow();
		expect(variables).toEqual({ label0: "bug" });
		expect(query).toContain("$label0: String!");
		expect(query).toContain("eqIgnoreCase");
	});

	it("generates query for multiple labels", () => {
		const { query, variables } = buildResolveLabelsByNameQuery(["bug", "feature", "enhancement"]);
		expect(() => parse(query)).not.toThrow();
		expect(variables).toEqual({
			label0: "bug",
			label1: "feature",
			label2: "enhancement",
		});
		expect(query).toContain("$label0: String!");
		expect(query).toContain("$label1: String!");
		expect(query).toContain("$label2: String!");
	});

	it("returns isGroup and team fields for disambiguation", () => {
		const { query } = buildResolveLabelsByNameQuery(["bug"]);
		expect(containsField(query, "isGroup")).toBe(true);
		expect(containsField(query, "team")).toBe(true);
	});

	it("uses issueLabels with proper filter structure", () => {
		const { query } = buildResolveLabelsByNameQuery(["a", "b"]);
		expect(query).toContain("issueLabels");
		expect(query).toContain("or:");
	});

	it("handles labels with special characters", () => {
		const { query, variables } = buildResolveLabelsByNameQuery(["P0 - Critical", "won't fix"]);
		expect(() => parse(query)).not.toThrow();
		expect(variables.label0).toBe("P0 - Critical");
		expect(variables.label1).toBe("won't fix");
	});
});

describe("GET_ISSUE_STATE_HISTORY_QUERY", () => {
	it("returns state history with timing info", () => {
		expect(containsField(GET_ISSUE_STATE_HISTORY_QUERY, "stateHistory")).toBe(true);
		expect(containsField(GET_ISSUE_STATE_HISTORY_QUERY, "startedAt")).toBe(true);
		expect(containsField(GET_ISSUE_STATE_HISTORY_QUERY, "endedAt")).toBe(true);
	});
});

describe("GET_ISSUE_TEAM_QUERY", () => {
	it("fetches only the team for an issue", () => {
		expect(extractVariables(GET_ISSUE_TEAM_QUERY)).toContain("issueId");
		expect(containsField(GET_ISSUE_TEAM_QUERY, "team")).toBe(true);
		// Should NOT contain full issue fields
		expect(containsField(GET_ISSUE_TEAM_QUERY, "title")).toBe(false);
	});
});

describe("ISSUE_RELATION_CREATE_MUTATION", () => {
	it("is a mutation", () => {
		expect(getOperationType(ISSUE_RELATION_CREATE_MUTATION)).toBe("mutation");
	});

	it("returns both sides of the relation", () => {
		expect(containsField(ISSUE_RELATION_CREATE_MUTATION, "issue")).toBe(true);
		expect(containsField(ISSUE_RELATION_CREATE_MUTATION, "relatedIssue")).toBe(true);
		expect(containsField(ISSUE_RELATION_CREATE_MUTATION, "type")).toBe(true);
	});
});

describe("GET_ISSUE_RELATIONS_QUERY", () => {
	it("fetches both relations and inverseRelations", () => {
		expect(containsField(GET_ISSUE_RELATIONS_QUERY, "relations")).toBe(true);
		expect(containsField(GET_ISSUE_RELATIONS_QUERY, "inverseRelations")).toBe(true);
	});
});

describe("SCAN_ISSUES_QUERY", () => {
	it("supports filter and pagination", () => {
		const vars = extractVariables(SCAN_ISSUES_QUERY);
		expect(vars).toContain("filter");
		expect(vars).toContain("first");
	});

	it("returns minimal fields for scanning", () => {
		expect(containsField(SCAN_ISSUES_QUERY, "id")).toBe(true);
		expect(containsField(SCAN_ISSUES_QUERY, "identifier")).toBe(true);
		expect(containsField(SCAN_ISSUES_QUERY, "description")).toBe(true);
		// Should NOT have heavy fields like comments
		expect(containsField(SCAN_ISSUES_QUERY, "comments")).toBe(false);
	});
});
