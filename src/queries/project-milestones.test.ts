import { parse, Kind, visit } from "graphql";
import { describe, expect, it } from "vitest";
import {
	CREATE_PROJECT_MILESTONE_MUTATION,
	FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL,
	FIND_PROJECT_MILESTONE_BY_NAME_SCOPED,
	GET_PROJECT_MILESTONE_BY_ID_QUERY,
	LIST_PROJECT_MILESTONES_QUERY,
	UPDATE_PROJECT_MILESTONE_MUTATION,
} from "./project-milestones.js";

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

describe("LIST_PROJECT_MILESTONES_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(LIST_PROJECT_MILESTONES_QUERY)).not.toThrow();
		expect(getOperationType(LIST_PROJECT_MILESTONES_QUERY)).toBe("query");
	});

	it("requires projectId and pagination", () => {
		const vars = extractVariables(LIST_PROJECT_MILESTONES_QUERY);
		expect(vars).toContain("projectId");
		expect(vars).toContain("first");
	});

	it("returns milestone metadata fields", () => {
		expect(containsField(LIST_PROJECT_MILESTONES_QUERY, "name")).toBe(true);
		expect(containsField(LIST_PROJECT_MILESTONES_QUERY, "description")).toBe(true);
		expect(containsField(LIST_PROJECT_MILESTONES_QUERY, "targetDate")).toBe(true);
		expect(containsField(LIST_PROJECT_MILESTONES_QUERY, "sortOrder")).toBe(true);
	});
});

describe("GET_PROJECT_MILESTONE_BY_ID_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(GET_PROJECT_MILESTONE_BY_ID_QUERY)).not.toThrow();
		expect(getOperationType(GET_PROJECT_MILESTONE_BY_ID_QUERY)).toBe("query");
	});

	it("accepts id and optional issuesFirst for pagination", () => {
		const vars = extractVariables(GET_PROJECT_MILESTONE_BY_ID_QUERY);
		expect(vars).toContain("id");
		expect(vars).toContain("issuesFirst");
	});

	it("includes associated issues", () => {
		expect(containsField(GET_PROJECT_MILESTONE_BY_ID_QUERY, "issues")).toBe(true);
	});

	it("includes parent project info", () => {
		expect(containsField(GET_PROJECT_MILESTONE_BY_ID_QUERY, "project")).toBe(true);
	});
});

describe("FIND_PROJECT_MILESTONE_BY_NAME_SCOPED", () => {
	it("is a valid query", () => {
		expect(() => parse(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED)).not.toThrow();
	});

	it("requires both name and projectId", () => {
		const vars = extractVariables(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED);
		expect(vars).toContain("name");
		expect(vars).toContain("projectId");
	});

	it("filters by exact name match", () => {
		expect(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED).toContain("eq: $name");
	});

	it("returns project association", () => {
		expect(containsField(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED, "project")).toBe(true);
	});
});

describe("FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL", () => {
	it("is a valid query", () => {
		expect(() => parse(FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL)).not.toThrow();
	});

	it("requires only name (no projectId)", () => {
		const vars = extractVariables(FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL);
		expect(vars).toEqual(["name"]);
	});

	it("returns project association for disambiguation", () => {
		expect(containsField(FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL, "project")).toBe(true);
	});
});

describe("CREATE_PROJECT_MILESTONE_MUTATION", () => {
	it("is a valid mutation", () => {
		expect(() => parse(CREATE_PROJECT_MILESTONE_MUTATION)).not.toThrow();
		expect(getOperationType(CREATE_PROJECT_MILESTONE_MUTATION)).toBe("mutation");
	});

	it("requires projectId and name, optional description and targetDate", () => {
		const vars = extractVariables(CREATE_PROJECT_MILESTONE_MUTATION);
		expect(vars).toContain("projectId");
		expect(vars).toContain("name");
		expect(vars).toContain("description");
		expect(vars).toContain("targetDate");
	});

	it("returns success and full milestone data", () => {
		expect(containsField(CREATE_PROJECT_MILESTONE_MUTATION, "success")).toBe(true);
		expect(containsField(CREATE_PROJECT_MILESTONE_MUTATION, "name")).toBe(true);
		expect(containsField(CREATE_PROJECT_MILESTONE_MUTATION, "project")).toBe(true);
	});
});

describe("UPDATE_PROJECT_MILESTONE_MUTATION", () => {
	it("is a valid mutation", () => {
		expect(() => parse(UPDATE_PROJECT_MILESTONE_MUTATION)).not.toThrow();
		expect(getOperationType(UPDATE_PROJECT_MILESTONE_MUTATION)).toBe("mutation");
	});

	it("accepts id and optional update fields", () => {
		const vars = extractVariables(UPDATE_PROJECT_MILESTONE_MUTATION);
		expect(vars).toContain("id");
		expect(vars).toContain("name");
		expect(vars).toContain("description");
		expect(vars).toContain("targetDate");
		expect(vars).toContain("sortOrder");
	});

	it("returns success and updated milestone", () => {
		expect(containsField(UPDATE_PROJECT_MILESTONE_MUTATION, "success")).toBe(true);
		expect(containsField(UPDATE_PROJECT_MILESTONE_MUTATION, "updatedAt")).toBe(true);
	});
});

describe("scoped vs global milestone queries", () => {
	it("scoped query accesses milestones through project", () => {
		// Scoped uses project(id:) -> projectMilestones
		expect(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED).toContain("project(id: $projectId)");
	});

	it("global query accesses projectMilestones directly", () => {
		expect(FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL).toContain("projectMilestones(");
	});

	it("both return the same fields", () => {
		const sharedFields = ["id", "name", "targetDate", "sortOrder"];
		for (const field of sharedFields) {
			expect(
				containsField(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED, field),
				`scoped missing ${field}`,
			).toBe(true);
			expect(
				containsField(FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL, field),
				`global missing ${field}`,
			).toBe(true);
		}
	});
});
