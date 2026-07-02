import { Kind, parse, visit } from "graphql";
import { describe, expect, it } from "vitest";
import {
	CREATE_PROJECT_UPDATE_MUTATION,
	GET_PROJECT_UPDATE_BY_ID_QUERY,
	LIST_PROJECT_UPDATES_QUERY,
} from "./project-updates.js";

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

describe("CREATE_PROJECT_UPDATE_MUTATION", () => {
	it("is a valid mutation", () => {
		expect(() => parse(CREATE_PROJECT_UPDATE_MUTATION)).not.toThrow();
		expect(getOperationType(CREATE_PROJECT_UPDATE_MUTATION)).toBe("mutation");
	});

	it("takes a single input variable", () => {
		expect(extractVariables(CREATE_PROJECT_UPDATE_MUTATION)).toEqual(["input"]);
	});

	it("selects success and the update health + url", () => {
		expect(containsField(CREATE_PROJECT_UPDATE_MUTATION, "success")).toBe(true);
		expect(containsField(CREATE_PROJECT_UPDATE_MUTATION, "health")).toBe(true);
		expect(containsField(CREATE_PROJECT_UPDATE_MUTATION, "url")).toBe(true);
	});
});

describe("LIST_PROJECT_UPDATES_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(LIST_PROJECT_UPDATES_QUERY)).not.toThrow();
		expect(getOperationType(LIST_PROJECT_UPDATES_QUERY)).toBe("query");
	});

	it("requires projectId and pagination", () => {
		const vars = extractVariables(LIST_PROJECT_UPDATES_QUERY);
		expect(vars).toContain("projectId");
		expect(vars).toContain("first");
	});

	it("reads the project's projectUpdates connection", () => {
		expect(containsField(LIST_PROJECT_UPDATES_QUERY, "projectUpdates")).toBe(
			true,
		);
	});
});

describe("GET_PROJECT_UPDATE_BY_ID_QUERY", () => {
	it("is a valid query", () => {
		expect(() => parse(GET_PROJECT_UPDATE_BY_ID_QUERY)).not.toThrow();
		expect(getOperationType(GET_PROJECT_UPDATE_BY_ID_QUERY)).toBe("query");
	});

	it("accepts an id variable", () => {
		expect(extractVariables(GET_PROJECT_UPDATE_BY_ID_QUERY)).toContain("id");
	});
});
