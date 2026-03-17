import { Kind, parse, visit } from "graphql";
import { describe, expect, it } from "vitest";
import {
  CREATE_ATTACHMENT_MUTATION,
  DELETE_ATTACHMENT_MUTATION,
  LIST_ATTACHMENTS_QUERY,
} from "./attachments.js";
import {
  CREATE_COMMENT_MUTATION,
  LIST_COMMENTS_QUERY,
  UPDATE_COMMENT_MUTATION,
} from "./comments.js";
import { COMPLETE_ISSUE_FRAGMENT, COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT } from "./common.js";
import { FIND_CYCLE_GLOBAL_QUERY, FIND_CYCLE_SCOPED_QUERY } from "./cycles.js";
import {
  CREATE_DOCUMENT_MUTATION,
  DELETE_DOCUMENT_MUTATION,
  GET_DOCUMENT_QUERY,
  LIST_DOCUMENTS_QUERY,
  UPDATE_DOCUMENT_MUTATION,
} from "./documents.js";
import { INTROSPECT_ROOT_QUERY, INTROSPECT_TYPE_QUERY } from "./introspect.js";
import {
  BATCH_RESOLVE_FOR_CREATE_QUERY,
  BATCH_RESOLVE_FOR_SEARCH_QUERY,
  BATCH_RESOLVE_FOR_UPDATE_QUERY,
  buildResolveLabelsByNameQuery,
  CREATE_ISSUE_MUTATION,
  FILTERED_SEARCH_ISSUES_QUERY,
  GET_ISSUE_BY_ID_QUERY,
  GET_ISSUE_BY_IDENTIFIER_QUERY,
  GET_ISSUE_STATE_HISTORY_QUERY,
  GET_ISSUE_TEAM_QUERY,
  GET_ISSUES_QUERY,
  ISSUE_RELATION_CREATE_MUTATION,
  SCAN_ISSUES_QUERY,
  SEARCH_ISSUES_QUERY,
  UPDATE_ISSUE_MUTATION,
} from "./issues.js";
import {
  CREATE_LABEL_MUTATION,
  FIND_PARENT_LABEL_QUERY,
  RESTORE_LABEL_MUTATION,
  RETIRE_LABEL_MUTATION,
} from "./labels.js";
import {
  CREATE_PROJECT_MILESTONE_MUTATION,
  FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL,
  FIND_PROJECT_MILESTONE_BY_NAME_SCOPED,
  GET_PROJECT_MILESTONE_BY_ID_QUERY,
  LIST_PROJECT_MILESTONES_QUERY,
  UPDATE_PROJECT_MILESTONE_MUTATION,
} from "./project-milestones.js";
import {
  GET_PROJECT_QUERY,
  GET_PROJECT_TEAM_ISSUES_QUERY,
  PROJECT_BY_ID_QUERY,
  TEAM_LOOKUP_QUERY,
  UPDATE_PROJECT_MUTATION,
} from "./projects.js";
import {
  CREATE_RELEASE_MUTATION,
  GET_RELEASE_BY_ID_QUERY,
  GET_RELEASE_PIPELINES_QUERY,
  GET_RELEASES_QUERY,
} from "./releases.js";
import { SEMANTIC_SEARCH_QUERY } from "./search.js";
import { TEMPLATE_BY_ID_QUERY, TEMPLATES_LIST_QUERY } from "./templates.js";

/**
 * Known Linear API fields that return Connection types (paginated).
 * Queries must access these via `fieldName { nodes { ... } }`.
 *
 * When adding a new connection field to a query, add it here too —
 * the test will catch any missing `nodes` wrapper.
 */
const CONNECTION_FIELDS = new Set([
  "attachments",
  "children",
  "comments",
  "cycles",
  "documents",
  "issueLabels",
  "issues",
  "labels",
  "milestones",
  "parentIssues",
  "projectMilestones",
  "projects",
  "releases",
  "releasePipelines",
  "searchIssues",
  "stages",
  "stateHistory",
  "teams",
  "users",
]);

/**
 * All exported query/mutation constants, mapped by name.
 * When you add a new query export, add it here — the coverage test below
 * will fail if you forget.
 */
const ALL_QUERIES: [string, string][] = [
  // common.ts (fragments — wrapped in dummy query for parsing)
  ["COMPLETE_ISSUE_FRAGMENT", `query Dummy { issue { ${COMPLETE_ISSUE_FRAGMENT} } }`],
  [
    "COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT",
    `query Dummy { issue { ${COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT} } }`,
  ],

  // attachments.ts
  ["CREATE_ATTACHMENT_MUTATION", CREATE_ATTACHMENT_MUTATION],
  ["DELETE_ATTACHMENT_MUTATION", DELETE_ATTACHMENT_MUTATION],
  ["LIST_ATTACHMENTS_QUERY", LIST_ATTACHMENTS_QUERY],

  // cycles.ts
  ["FIND_CYCLE_SCOPED_QUERY", FIND_CYCLE_SCOPED_QUERY],
  ["FIND_CYCLE_GLOBAL_QUERY", FIND_CYCLE_GLOBAL_QUERY],

  // documents.ts
  ["CREATE_DOCUMENT_MUTATION", CREATE_DOCUMENT_MUTATION],
  ["UPDATE_DOCUMENT_MUTATION", UPDATE_DOCUMENT_MUTATION],
  ["GET_DOCUMENT_QUERY", GET_DOCUMENT_QUERY],
  ["LIST_DOCUMENTS_QUERY", LIST_DOCUMENTS_QUERY],
  ["DELETE_DOCUMENT_MUTATION", DELETE_DOCUMENT_MUTATION],

  // issues.ts
  ["GET_ISSUES_QUERY", GET_ISSUES_QUERY],
  ["SEARCH_ISSUES_QUERY", SEARCH_ISSUES_QUERY],
  ["FILTERED_SEARCH_ISSUES_QUERY", FILTERED_SEARCH_ISSUES_QUERY],
  ["BATCH_RESOLVE_FOR_SEARCH_QUERY", BATCH_RESOLVE_FOR_SEARCH_QUERY],
  ["GET_ISSUE_BY_ID_QUERY", GET_ISSUE_BY_ID_QUERY],
  ["GET_ISSUE_BY_IDENTIFIER_QUERY", GET_ISSUE_BY_IDENTIFIER_QUERY],
  ["BATCH_RESOLVE_FOR_UPDATE_QUERY", BATCH_RESOLVE_FOR_UPDATE_QUERY],
  ["CREATE_ISSUE_MUTATION", CREATE_ISSUE_MUTATION],
  ["UPDATE_ISSUE_MUTATION", UPDATE_ISSUE_MUTATION],
  ["BATCH_RESOLVE_FOR_CREATE_QUERY", BATCH_RESOLVE_FOR_CREATE_QUERY],
  ["GET_ISSUE_STATE_HISTORY_QUERY", GET_ISSUE_STATE_HISTORY_QUERY],
  ["GET_ISSUE_TEAM_QUERY", GET_ISSUE_TEAM_QUERY],
  ["ISSUE_RELATION_CREATE_MUTATION", ISSUE_RELATION_CREATE_MUTATION],
  ["buildResolveLabelsByNameQuery", buildResolveLabelsByNameQuery(["bug"]).query],
  ["SCAN_ISSUES_QUERY", SCAN_ISSUES_QUERY],

  // labels.ts
  ["FIND_PARENT_LABEL_QUERY", FIND_PARENT_LABEL_QUERY],
  ["CREATE_LABEL_MUTATION", CREATE_LABEL_MUTATION],
  ["RETIRE_LABEL_MUTATION", RETIRE_LABEL_MUTATION],
  ["RESTORE_LABEL_MUTATION", RESTORE_LABEL_MUTATION],

  // project-milestones.ts
  ["LIST_PROJECT_MILESTONES_QUERY", LIST_PROJECT_MILESTONES_QUERY],
  ["GET_PROJECT_MILESTONE_BY_ID_QUERY", GET_PROJECT_MILESTONE_BY_ID_QUERY],
  ["FIND_PROJECT_MILESTONE_BY_NAME_SCOPED", FIND_PROJECT_MILESTONE_BY_NAME_SCOPED],
  ["FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL", FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL],
  ["CREATE_PROJECT_MILESTONE_MUTATION", CREATE_PROJECT_MILESTONE_MUTATION],
  ["UPDATE_PROJECT_MILESTONE_MUTATION", UPDATE_PROJECT_MILESTONE_MUTATION],

  // projects.ts
  ["TEAM_LOOKUP_QUERY", TEAM_LOOKUP_QUERY],
  ["PROJECT_BY_ID_QUERY", PROJECT_BY_ID_QUERY],
  ["GET_PROJECT_QUERY", GET_PROJECT_QUERY],
  ["GET_PROJECT_TEAM_ISSUES_QUERY", GET_PROJECT_TEAM_ISSUES_QUERY],
  ["UPDATE_PROJECT_MUTATION", UPDATE_PROJECT_MUTATION],

  // releases.ts
  ["GET_RELEASES_QUERY", GET_RELEASES_QUERY],
  ["GET_RELEASE_BY_ID_QUERY", GET_RELEASE_BY_ID_QUERY],
  ["CREATE_RELEASE_MUTATION", CREATE_RELEASE_MUTATION],
  ["GET_RELEASE_PIPELINES_QUERY", GET_RELEASE_PIPELINES_QUERY],

  // comments.ts
  ["CREATE_COMMENT_MUTATION", CREATE_COMMENT_MUTATION],
  ["LIST_COMMENTS_QUERY", LIST_COMMENTS_QUERY],
  ["UPDATE_COMMENT_MUTATION", UPDATE_COMMENT_MUTATION],

  // search.ts
  ["SEMANTIC_SEARCH_QUERY", SEMANTIC_SEARCH_QUERY],

  // templates.ts
  ["TEMPLATES_LIST_QUERY", TEMPLATES_LIST_QUERY],
  ["TEMPLATE_BY_ID_QUERY", TEMPLATE_BY_ID_QUERY],

  // introspect.ts
  ["INTROSPECT_TYPE_QUERY", INTROSPECT_TYPE_QUERY],
  ["INTROSPECT_ROOT_QUERY", INTROSPECT_ROOT_QUERY],
];

/**
 * Walk a GraphQL AST and find Connection fields that are missing `nodes { ... }`.
 */
function findConnectionFieldsWithoutNodes(queryName: string, queryString: string): string[] {
  const violations: string[] = [];
  const doc = parse(queryString);

  visit(doc, {
    Field(node) {
      const fieldName = node.name.value;

      if (!CONNECTION_FIELDS.has(fieldName)) {
        return;
      }

      if (!node.selectionSet) {
        violations.push(`"${queryName}": connection field "${fieldName}" has no selection set`);
        return;
      }

      const hasNodes = node.selectionSet.selections.some(
        (sel) => sel.kind === Kind.FIELD && sel.name.value === "nodes",
      );
      if (!hasNodes) {
        violations.push(
          `"${queryName}": connection field "${fieldName}" missing "nodes { ... }" wrapper`,
        );
      }
    },
  });

  return violations;
}

describe("GraphQL query validation", () => {
  it.each(ALL_QUERIES)("%s: connection fields use nodes wrapper", (name, query) => {
    const violations = findConnectionFieldsWithoutNodes(name, query);
    expect(violations).toEqual([]);
  });

  it("all queries parse without errors", () => {
    for (const [name, query] of ALL_QUERIES) {
      expect(() => parse(query), `Query "${name}" failed to parse`).not.toThrow();
    }
  });

  it("all query module exports are covered", async () => {
    const queryModules = await Promise.all([
      import("./attachments.js"),
      import("./comments.js"),
      import("./common.js"),
      import("./cycles.js"),
      import("./documents.js"),
      import("./issues.js"),
      import("./labels.js"),
      import("./project-milestones.js"),
      import("./projects.js"),
      import("./releases.js"),
      import("./search.js"),
    ]);

    const allExportNames = queryModules.flatMap((mod) =>
      Object.keys(mod).filter((k) => typeof (mod as Record<string, unknown>)[k] === "string"),
    );

    const testedNames = new Set(ALL_QUERIES.map(([name]) => name));
    const untested = allExportNames.filter((name) => !testedNames.has(name));

    expect(
      untested,
      `Untested query exports: ${untested.join(", ")}. Add them to ALL_QUERIES in graphql-queries.test.ts`,
    ).toEqual([]);
  });
});

/** Helper: extract variable names from a GraphQL query string */
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

/** Helper: get the operation type (query/mutation) */
function getOperationType(query: string): string {
  const doc = parse(query);
  const def = doc.definitions[0];
  return def.kind === Kind.OPERATION_DEFINITION ? def.operation : "unknown";
}

/** Helper: check if a query string contains a field name at any depth */
function containsField(query: string, fieldName: string): boolean {
  const doc = parse(query);
  let found = false;
  visit(doc, {
    Field(node) {
      if (node.name.value === fieldName) {
        found = true;
      }
    },
  });
  return found;
}

describe("common.ts — fragment composition", () => {
  it("COMPLETE_ISSUE_FRAGMENT includes all core fields", () => {
    const coreFields = [
      "id",
      "identifier",
      "title",
      "description",
      "priority",
      "estimate",
      "url",
      "createdAt",
      "updatedAt",
      "branchName",
    ];
    for (const field of coreFields) {
      expect(COMPLETE_ISSUE_FRAGMENT).toContain(field);
    }
  });

  it("COMPLETE_ISSUE_FRAGMENT includes relation fields", () => {
    const relations = [
      "state",
      "assignee",
      "team",
      "project",
      "labels",
      "cycle",
      "projectMilestone",
      "parent",
      "children",
    ];
    for (const field of relations) {
      expect(COMPLETE_ISSUE_FRAGMENT).toContain(field);
    }
  });

  it("COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT extends COMPLETE_ISSUE_FRAGMENT", () => {
    expect(COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT).toContain("comments");
    expect(COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT).toContain("body");
  });
});

describe("attachments.ts — queries and mutations", () => {
  it("CREATE_ATTACHMENT_MUTATION is a mutation with input variable", () => {
    expect(getOperationType(CREATE_ATTACHMENT_MUTATION)).toBe("mutation");
    expect(extractVariables(CREATE_ATTACHMENT_MUTATION)).toEqual(["input"]);
    expect(containsField(CREATE_ATTACHMENT_MUTATION, "success")).toBe(true);
  });

  it("DELETE_ATTACHMENT_MUTATION uses id variable", () => {
    expect(getOperationType(DELETE_ATTACHMENT_MUTATION)).toBe("mutation");
    expect(extractVariables(DELETE_ATTACHMENT_MUTATION)).toEqual(["id"]);
    expect(containsField(DELETE_ATTACHMENT_MUTATION, "success")).toBe(true);
  });

  it("LIST_ATTACHMENTS_QUERY is a query with issueId", () => {
    expect(getOperationType(LIST_ATTACHMENTS_QUERY)).toBe("query");
    expect(extractVariables(LIST_ATTACHMENTS_QUERY)).toEqual(["issueId"]);
  });
});

describe("cycles.ts — scoped vs global", () => {
  it("scoped query requires both name and teamId", () => {
    expect(extractVariables(FIND_CYCLE_SCOPED_QUERY)).toContain("name");
    expect(extractVariables(FIND_CYCLE_SCOPED_QUERY)).toContain("teamId");
  });

  it("global query requires only name", () => {
    const vars = extractVariables(FIND_CYCLE_GLOBAL_QUERY);
    expect(vars).toEqual(["name"]);
  });

  it("both queries return cycle scheduling fields", () => {
    for (const query of [FIND_CYCLE_SCOPED_QUERY, FIND_CYCLE_GLOBAL_QUERY]) {
      expect(containsField(query, "isActive")).toBe(true);
      expect(containsField(query, "isNext")).toBe(true);
      expect(containsField(query, "isPrevious")).toBe(true);
    }
  });
});

describe("documents.ts — CRUD operations", () => {
  it("all mutations return success", () => {
    for (const mutation of [
      CREATE_DOCUMENT_MUTATION,
      UPDATE_DOCUMENT_MUTATION,
      DELETE_DOCUMENT_MUTATION,
    ]) {
      expect(getOperationType(mutation)).toBe("mutation");
      expect(containsField(mutation, "success")).toBe(true);
    }
  });

  it("GET_DOCUMENT_QUERY uses id variable", () => {
    expect(getOperationType(GET_DOCUMENT_QUERY)).toBe("query");
    expect(extractVariables(GET_DOCUMENT_QUERY)).toContain("id");
  });

  it("LIST_DOCUMENTS_QUERY supports pagination and filtering", () => {
    const vars = extractVariables(LIST_DOCUMENTS_QUERY);
    expect(vars).toContain("first");
    expect(vars).toContain("filter");
  });

  it("document queries include content and metadata", () => {
    for (const query of [GET_DOCUMENT_QUERY, LIST_DOCUMENTS_QUERY]) {
      expect(containsField(query, "content")).toBe(true);
      expect(containsField(query, "creator")).toBe(true);
    }
  });
});

describe("issues.ts — queries and mutations", () => {
  it("GET_ISSUES_QUERY filters out completed issues", () => {
    expect(GET_ISSUES_QUERY).toContain('neq: "completed"');
  });

  it("SEARCH_ISSUES_QUERY uses term variable", () => {
    expect(extractVariables(SEARCH_ISSUES_QUERY)).toContain("term");
    expect(extractVariables(SEARCH_ISSUES_QUERY)).toContain("first");
  });

  it("BATCH_RESOLVE_FOR_SEARCH_QUERY resolves teams, projects, and users", () => {
    const vars = extractVariables(BATCH_RESOLVE_FOR_SEARCH_QUERY);
    expect(vars).toContain("teamKey");
    expect(vars).toContain("projectName");
    expect(vars).toContain("assigneeEmail");
    expect(containsField(BATCH_RESOLVE_FOR_SEARCH_QUERY, "teams")).toBe(true);
    expect(containsField(BATCH_RESOLVE_FOR_SEARCH_QUERY, "projects")).toBe(true);
    expect(containsField(BATCH_RESOLVE_FOR_SEARCH_QUERY, "users")).toBe(true);
  });

  it("BATCH_RESOLVE_FOR_CREATE_QUERY resolves teams, projects, milestones, and parent", () => {
    const vars = extractVariables(BATCH_RESOLVE_FOR_CREATE_QUERY);
    expect(vars).toContain("teamKey");
    expect(vars).toContain("projectName");
    expect(vars).toContain("milestoneName");
    expect(vars).toContain("parentTeamKey");
    expect(vars).toContain("parentIssueNumber");
  });

  it("BATCH_RESOLVE_FOR_UPDATE_QUERY resolves projects, milestones, and issue", () => {
    const vars = extractVariables(BATCH_RESOLVE_FOR_UPDATE_QUERY);
    expect(vars).toContain("projectName");
    expect(vars).toContain("milestoneName");
    expect(vars).toContain("teamKey");
    expect(vars).toContain("issueNumber");
  });

  it("buildResolveLabelsByNameQuery fetches labels with group and team info", () => {
    const { query } = buildResolveLabelsByNameQuery(["bug", "feature"]);
    expect(containsField(query, "issueLabels")).toBe(true);
    expect(containsField(query, "isGroup")).toBe(true);
    expect(query).toContain("eqIgnoreCase");
  });

  it("GET_ISSUE_BY_IDENTIFIER_QUERY uses teamKey and number", () => {
    const vars = extractVariables(GET_ISSUE_BY_IDENTIFIER_QUERY);
    expect(vars).toContain("teamKey");
    expect(vars).toContain("number");
  });

  it("GET_ISSUE_STATE_HISTORY_QUERY returns stateHistory with timing", () => {
    expect(containsField(GET_ISSUE_STATE_HISTORY_QUERY, "stateHistory")).toBe(true);
    expect(containsField(GET_ISSUE_STATE_HISTORY_QUERY, "startedAt")).toBe(true);
    expect(containsField(GET_ISSUE_STATE_HISTORY_QUERY, "endedAt")).toBe(true);
  });

  it("mutations use Input types and return success", () => {
    for (const mutation of [CREATE_ISSUE_MUTATION, UPDATE_ISSUE_MUTATION]) {
      expect(getOperationType(mutation)).toBe("mutation");
      expect(containsField(mutation, "success")).toBe(true);
    }
  });

  it("ISSUE_RELATION_CREATE_MUTATION returns both sides of the relation", () => {
    expect(containsField(ISSUE_RELATION_CREATE_MUTATION, "issue")).toBe(true);
    expect(containsField(ISSUE_RELATION_CREATE_MUTATION, "relatedIssue")).toBe(true);
    expect(containsField(ISSUE_RELATION_CREATE_MUTATION, "type")).toBe(true);
  });
});

describe("labels.ts — CRUD and lifecycle", () => {
  it("FIND_PARENT_LABEL_QUERY scopes by name and teamId", () => {
    const vars = extractVariables(FIND_PARENT_LABEL_QUERY);
    expect(vars).toContain("name");
    expect(vars).toContain("teamId");
    expect(containsField(FIND_PARENT_LABEL_QUERY, "isGroup")).toBe(true);
  });

  it("CREATE_LABEL_MUTATION returns label with team and parent", () => {
    expect(getOperationType(CREATE_LABEL_MUTATION)).toBe("mutation");
    expect(containsField(CREATE_LABEL_MUTATION, "team")).toBe(true);
    expect(containsField(CREATE_LABEL_MUTATION, "parent")).toBe(true);
  });

  it("RETIRE_LABEL_MUTATION returns retiredAt timestamp", () => {
    expect(containsField(RETIRE_LABEL_MUTATION, "retiredAt")).toBe(true);
  });

  it("RESTORE_LABEL_MUTATION does not return retiredAt", () => {
    expect(containsField(RESTORE_LABEL_MUTATION, "retiredAt")).toBe(false);
  });
});

describe("project-milestones.ts — scoped vs global and CRUD", () => {
  it("scoped query requires projectId", () => {
    expect(extractVariables(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED)).toContain("projectId");
    expect(extractVariables(FIND_PROJECT_MILESTONE_BY_NAME_SCOPED)).toContain("name");
  });

  it("global query requires only name", () => {
    expect(extractVariables(FIND_PROJECT_MILESTONE_BY_NAME_GLOBAL)).toEqual(["name"]);
  });

  it("LIST_PROJECT_MILESTONES_QUERY uses projectId and pagination", () => {
    const vars = extractVariables(LIST_PROJECT_MILESTONES_QUERY);
    expect(vars).toContain("projectId");
    expect(vars).toContain("first");
  });

  it("GET_PROJECT_MILESTONE_BY_ID_QUERY includes issues", () => {
    expect(containsField(GET_PROJECT_MILESTONE_BY_ID_QUERY, "issues")).toBe(true);
    expect(extractVariables(GET_PROJECT_MILESTONE_BY_ID_QUERY)).toContain("issuesFirst");
  });

  it("CREATE_PROJECT_MILESTONE_MUTATION accepts name, description, targetDate", () => {
    const vars = extractVariables(CREATE_PROJECT_MILESTONE_MUTATION);
    expect(vars).toContain("projectId");
    expect(vars).toContain("name");
    expect(vars).toContain("description");
    expect(vars).toContain("targetDate");
  });

  it("UPDATE_PROJECT_MILESTONE_MUTATION accepts sortOrder", () => {
    expect(extractVariables(UPDATE_PROJECT_MILESTONE_MUTATION)).toContain("sortOrder");
  });
});

describe("projects.ts — queries and mutations", () => {
  it("GET_PROJECT_QUERY filters by name case-insensitively", () => {
    expect(GET_PROJECT_QUERY).toContain("eqIgnoreCase");
  });

  it("GET_PROJECT_TEAM_ISSUES_QUERY scopes by projectId and teamId", () => {
    const vars = extractVariables(GET_PROJECT_TEAM_ISSUES_QUERY);
    expect(vars).toContain("projectId");
    expect(vars).toContain("teamId");
  });

  it("UPDATE_PROJECT_MUTATION returns teams", () => {
    expect(getOperationType(UPDATE_PROJECT_MUTATION)).toBe("mutation");
    expect(containsField(UPDATE_PROJECT_MUTATION, "teams")).toBe(true);
  });
});

describe("releases.ts — queries and mutations", () => {
  it("GET_RELEASES_QUERY supports pagination and filtering", () => {
    const vars = extractVariables(GET_RELEASES_QUERY);
    expect(vars).toContain("first");
    expect(vars).toContain("filter");
  });

  it("GET_RELEASE_BY_ID_QUERY includes documents", () => {
    expect(containsField(GET_RELEASE_BY_ID_QUERY, "documents")).toBe(true);
  });

  it("release queries include stage and pipeline", () => {
    for (const query of [GET_RELEASES_QUERY, GET_RELEASE_BY_ID_QUERY, CREATE_RELEASE_MUTATION]) {
      expect(containsField(query, "stage")).toBe(true);
      expect(containsField(query, "pipeline")).toBe(true);
    }
  });

  it("GET_RELEASE_PIPELINES_QUERY returns stages within pipelines", () => {
    expect(containsField(GET_RELEASE_PIPELINES_QUERY, "stages")).toBe(true);
  });
});

describe("comments.ts — list and update", () => {
  it("LIST_COMMENTS_QUERY uses issueId and optional pagination", () => {
    const vars = extractVariables(LIST_COMMENTS_QUERY);
    expect(vars).toContain("issueId");
    expect(vars).toContain("first");
  });

  it("LIST_COMMENTS_QUERY orders by createdAt", () => {
    expect(LIST_COMMENTS_QUERY).toContain("orderBy: createdAt");
  });

  it("comment queries include user with displayName", () => {
    for (const query of [LIST_COMMENTS_QUERY, UPDATE_COMMENT_MUTATION]) {
      expect(containsField(query, "displayName")).toBe(true);
    }
  });
});

describe("search.ts — semantic search", () => {
  it("SEMANTIC_SEARCH_QUERY accepts query, maxResults, and filters", () => {
    const vars = extractVariables(SEMANTIC_SEARCH_QUERY);
    expect(vars).toContain("query");
    expect(vars).toContain("maxResults");
    expect(vars).toContain("filters");
  });

  it("returns results for multiple entity types", () => {
    expect(containsField(SEMANTIC_SEARCH_QUERY, "issue")).toBe(true);
    expect(containsField(SEMANTIC_SEARCH_QUERY, "project")).toBe(true);
    expect(containsField(SEMANTIC_SEARCH_QUERY, "initiative")).toBe(true);
    expect(containsField(SEMANTIC_SEARCH_QUERY, "document")).toBe(true);
  });
});
