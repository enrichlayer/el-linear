import { Kind, parse, visit } from "graphql";
import { describe, expect, it } from "vitest";
import {
	CREATE_DOCUMENT_MUTATION,
	DELETE_DOCUMENT_MUTATION,
	GET_DOCUMENT_QUERY,
	LIST_DOCUMENTS_QUERY,
	UPDATE_DOCUMENT_MUTATION,
} from "./documents.js";

/** Extract variable names from a GraphQL query string */
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

/** Get the operation type (query/mutation) */
function getOperationType(query: string): string {
	const doc = parse(query);
	const def = doc.definitions[0];
	return def.kind === Kind.OPERATION_DEFINITION ? def.operation : "unknown";
}

/** Check if a query contains a specific field */
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

describe("CREATE_DOCUMENT_MUTATION", () => {
	it("is a valid GraphQL mutation", () => {
		expect(() => parse(CREATE_DOCUMENT_MUTATION)).not.toThrow();
		expect(getOperationType(CREATE_DOCUMENT_MUTATION)).toBe("mutation");
	});

	it("accepts input variable", () => {
		expect(extractVariables(CREATE_DOCUMENT_MUTATION)).toEqual(["input"]);
	});

	it("returns success and document fields", () => {
		expect(containsField(CREATE_DOCUMENT_MUTATION, "success")).toBe(true);
		expect(containsField(CREATE_DOCUMENT_MUTATION, "title")).toBe(true);
		expect(containsField(CREATE_DOCUMENT_MUTATION, "content")).toBe(true);
		expect(containsField(CREATE_DOCUMENT_MUTATION, "url")).toBe(true);
	});

	it("includes creator info", () => {
		expect(containsField(CREATE_DOCUMENT_MUTATION, "creator")).toBe(true);
	});

	it("includes project and issue associations", () => {
		expect(containsField(CREATE_DOCUMENT_MUTATION, "project")).toBe(true);
		expect(containsField(CREATE_DOCUMENT_MUTATION, "issue")).toBe(true);
	});
});

describe("UPDATE_DOCUMENT_MUTATION", () => {
	it("is a valid GraphQL mutation", () => {
		expect(() => parse(UPDATE_DOCUMENT_MUTATION)).not.toThrow();
		expect(getOperationType(UPDATE_DOCUMENT_MUTATION)).toBe("mutation");
	});

	it("accepts id and input variables", () => {
		const vars = extractVariables(UPDATE_DOCUMENT_MUTATION);
		expect(vars).toContain("id");
		expect(vars).toContain("input");
	});

	it("returns success", () => {
		expect(containsField(UPDATE_DOCUMENT_MUTATION, "success")).toBe(true);
	});
});

describe("GET_DOCUMENT_QUERY", () => {
	it("is a valid GraphQL query", () => {
		expect(() => parse(GET_DOCUMENT_QUERY)).not.toThrow();
		expect(getOperationType(GET_DOCUMENT_QUERY)).toBe("query");
	});

	it("accepts id variable", () => {
		expect(extractVariables(GET_DOCUMENT_QUERY)).toEqual(["id"]);
	});

	it("returns full document fields", () => {
		expect(containsField(GET_DOCUMENT_QUERY, "id")).toBe(true);
		expect(containsField(GET_DOCUMENT_QUERY, "title")).toBe(true);
		expect(containsField(GET_DOCUMENT_QUERY, "content")).toBe(true);
		expect(containsField(GET_DOCUMENT_QUERY, "slugId")).toBe(true);
		expect(containsField(GET_DOCUMENT_QUERY, "url")).toBe(true);
		expect(containsField(GET_DOCUMENT_QUERY, "icon")).toBe(true);
		expect(containsField(GET_DOCUMENT_QUERY, "color")).toBe(true);
		expect(containsField(GET_DOCUMENT_QUERY, "createdAt")).toBe(true);
		expect(containsField(GET_DOCUMENT_QUERY, "updatedAt")).toBe(true);
	});
});

describe("LIST_DOCUMENTS_QUERY", () => {
	it("is a valid GraphQL query", () => {
		expect(() => parse(LIST_DOCUMENTS_QUERY)).not.toThrow();
		expect(getOperationType(LIST_DOCUMENTS_QUERY)).toBe("query");
	});

	it("supports pagination and filtering", () => {
		const vars = extractVariables(LIST_DOCUMENTS_QUERY);
		expect(vars).toContain("first");
		expect(vars).toContain("filter");
	});

	it("uses nodes wrapper for documents connection", () => {
		expect(containsField(LIST_DOCUMENTS_QUERY, "documents")).toBe(true);
		expect(LIST_DOCUMENTS_QUERY).toContain("nodes");
	});
});

describe("DELETE_DOCUMENT_MUTATION", () => {
	it("is a valid GraphQL mutation", () => {
		expect(() => parse(DELETE_DOCUMENT_MUTATION)).not.toThrow();
		expect(getOperationType(DELETE_DOCUMENT_MUTATION)).toBe("mutation");
	});

	it("accepts id variable", () => {
		expect(extractVariables(DELETE_DOCUMENT_MUTATION)).toEqual(["id"]);
	});

	it("returns success", () => {
		expect(containsField(DELETE_DOCUMENT_MUTATION, "success")).toBe(true);
	});

	it("does not return document fields (delete is fire-and-forget)", () => {
		expect(containsField(DELETE_DOCUMENT_MUTATION, "title")).toBe(false);
		expect(containsField(DELETE_DOCUMENT_MUTATION, "content")).toBe(false);
	});
});

describe("document fragment consistency", () => {
	it("all document queries share the same fields", () => {
		const sharedFields = [
			"id",
			"title",
			"content",
			"slugId",
			"url",
			"icon",
			"color",
			"createdAt",
			"updatedAt",
		];
		const queries = [
			CREATE_DOCUMENT_MUTATION,
			UPDATE_DOCUMENT_MUTATION,
			GET_DOCUMENT_QUERY,
			LIST_DOCUMENTS_QUERY,
		];

		for (const query of queries) {
			for (const field of sharedFields) {
				expect(containsField(query, field), `${field} missing in query`).toBe(
					true,
				);
			}
		}
	});
});
