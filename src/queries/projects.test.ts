import { Kind, parse, visit } from "graphql";
import { describe, expect, it } from "vitest";
import {
	CREATE_PROJECT_MUTATION,
	GET_PROJECT_QUERY,
	GET_PROJECT_TEAM_ISSUES_QUERY,
	PROJECT_BY_ID_QUERY,
	SEARCH_PROJECTS_BY_NAME_QUERY,
	TEAM_LOOKUP_QUERY,
	UPDATE_PROJECT_MUTATION,
} from "./projects.js";

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

describe("TEAM_LOOKUP_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(TEAM_LOOKUP_QUERY)).not.toThrow();
		expect(getOperationType(TEAM_LOOKUP_QUERY)).toBe("query");
	});

	it("accepts key variable", () => {
		expect(extractVariables(TEAM_LOOKUP_QUERY)).toEqual(["key"]);
	});

	it("matches by key or name using or filter", () => {
		expect(TEAM_LOOKUP_QUERY).toContain("or:");
		expect(TEAM_LOOKUP_QUERY).toContain("key:");
		expect(TEAM_LOOKUP_QUERY).toContain("name:");
	});

	it("returns id, key, and name", () => {
		expect(containsField(TEAM_LOOKUP_QUERY, "id")).toBe(true);
		expect(containsField(TEAM_LOOKUP_QUERY, "key")).toBe(true);
		expect(containsField(TEAM_LOOKUP_QUERY, "name")).toBe(true);
	});
});

describe("PROJECT_BY_ID_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(PROJECT_BY_ID_QUERY)).not.toThrow();
		expect(getOperationType(PROJECT_BY_ID_QUERY)).toBe("query");
	});

	it("accepts id variable", () => {
		expect(extractVariables(PROJECT_BY_ID_QUERY)).toEqual(["id"]);
	});

	it("includes teams", () => {
		expect(containsField(PROJECT_BY_ID_QUERY, "teams")).toBe(true);
	});
});

describe("GET_PROJECT_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(GET_PROJECT_QUERY)).not.toThrow();
	});

	it("accepts name variable", () => {
		expect(extractVariables(GET_PROJECT_QUERY)).toEqual(["name"]);
	});

	it("uses case-insensitive name matching", () => {
		expect(GET_PROJECT_QUERY).toContain("eqIgnoreCase");
	});

	it("returns project with teams", () => {
		expect(containsField(GET_PROJECT_QUERY, "teams")).toBe(true);
	});
});

describe("GET_PROJECT_TEAM_ISSUES_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(GET_PROJECT_TEAM_ISSUES_QUERY)).not.toThrow();
	});

	it("scopes by projectId and teamId", () => {
		const vars = extractVariables(GET_PROJECT_TEAM_ISSUES_QUERY);
		expect(vars).toContain("projectId");
		expect(vars).toContain("teamId");
	});

	it("returns issues filtered by team", () => {
		expect(containsField(GET_PROJECT_TEAM_ISSUES_QUERY, "issues")).toBe(true);
		expect(containsField(GET_PROJECT_TEAM_ISSUES_QUERY, "identifier")).toBe(
			true,
		);
		expect(containsField(GET_PROJECT_TEAM_ISSUES_QUERY, "title")).toBe(true);
	});
});

describe("SEARCH_PROJECTS_BY_NAME_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(SEARCH_PROJECTS_BY_NAME_QUERY)).not.toThrow();
	});

	it("uses case-insensitive contains matching", () => {
		expect(SEARCH_PROJECTS_BY_NAME_QUERY).toContain("containsIgnoreCase");
	});

	it("returns up to 10 results", () => {
		expect(SEARCH_PROJECTS_BY_NAME_QUERY).toContain("first: 10");
	});

	it("includes state field for filtering active/archived", () => {
		expect(containsField(SEARCH_PROJECTS_BY_NAME_QUERY, "state")).toBe(true);
	});
});

describe("CREATE_PROJECT_MUTATION", () => {
	it("is a valid mutation", () => {
		expect(() => parse(CREATE_PROJECT_MUTATION)).not.toThrow();
		expect(getOperationType(CREATE_PROJECT_MUTATION)).toBe("mutation");
	});

	it("accepts input variable", () => {
		expect(extractVariables(CREATE_PROJECT_MUTATION)).toEqual(["input"]);
	});

	it("returns success and project with teams", () => {
		expect(containsField(CREATE_PROJECT_MUTATION, "success")).toBe(true);
		expect(containsField(CREATE_PROJECT_MUTATION, "teams")).toBe(true);
		expect(containsField(CREATE_PROJECT_MUTATION, "state")).toBe(true);
	});
});

describe("UPDATE_PROJECT_MUTATION", () => {
	it("is a valid mutation", () => {
		expect(() => parse(UPDATE_PROJECT_MUTATION)).not.toThrow();
		expect(getOperationType(UPDATE_PROJECT_MUTATION)).toBe("mutation");
	});

	it("accepts id and input variables", () => {
		const vars = extractVariables(UPDATE_PROJECT_MUTATION);
		expect(vars).toContain("id");
		expect(vars).toContain("input");
	});

	it("returns success and updated project", () => {
		expect(containsField(UPDATE_PROJECT_MUTATION, "success")).toBe(true);
		expect(containsField(UPDATE_PROJECT_MUTATION, "teams")).toBe(true);
	});
});

describe("all project queries parse without errors", () => {
	const queries = {
		TEAM_LOOKUP_QUERY,
		PROJECT_BY_ID_QUERY,
		GET_PROJECT_QUERY,
		GET_PROJECT_TEAM_ISSUES_QUERY,
		SEARCH_PROJECTS_BY_NAME_QUERY,
		CREATE_PROJECT_MUTATION,
		UPDATE_PROJECT_MUTATION,
	};

	it.each(Object.entries(queries))("%s is valid GraphQL", (_name, query) => {
		expect(() => parse(query)).not.toThrow();
	});
});
