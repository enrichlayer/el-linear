import { describe, expect, it } from "vitest";
import type { LinearIssue } from "../types/linear.js";
import { formatCsv, formatMarkdown, formatTable } from "./table-formatter.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "DEV-100",
    title: "Test issue",
    url: "https://linear.app/verticalint/issue/DEV-100",
    priority: 2,
    state: { id: "s1", name: "In Progress", type: "started" },
    team: { id: "t1", key: "DEV", name: "Dev" },
    assignee: { id: "u1", name: "Alice" },
    project: { id: "p1", name: "My Project" },
    labels: [{ id: "l1", name: "feature" }],
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    ...overrides,
  } as LinearIssue;
}

describe("formatTable", () => {
  it("renders a table with default columns", () => {
    const output = formatTable([makeIssue()]);
    expect(output).toContain("DEV-100");
    expect(output).toContain("Test issue");
    expect(output).toContain("In Progress");
    expect(output).toContain("Alice");
    expect(output).toContain("My Project");
  });

  it("renders header and separator lines", () => {
    const lines = formatTable([makeIssue()]).split("\n");
    expect(lines.length).toBe(3); // header, separator, 1 row
    expect(lines[1]).toMatch(/^─+/);
  });

  it("supports custom field selection", () => {
    const output = formatTable([makeIssue()], ["identifier", "team"]);
    expect(output).toContain("DEV-100");
    expect(output).toContain("DEV");
    // Title not in selected fields
    const lines = output.split("\n");
    expect(lines[0]).not.toContain("Title");
  });

  it("handles missing assignee", () => {
    const output = formatTable([makeIssue({ assignee: undefined })]);
    expect(output).toContain("—");
  });

  it("returns message for invalid columns", () => {
    const output = formatTable([makeIssue()], ["nonexistent"]);
    expect(output).toBe("No valid columns specified.");
  });

  it("renders multiple rows", () => {
    const issues = [
      makeIssue({ identifier: "DEV-1" }),
      makeIssue({ identifier: "DEV-2" }),
      makeIssue({ identifier: "DEV-3" }),
    ];
    const lines = formatTable(issues).split("\n");
    expect(lines.length).toBe(5); // header + separator + 3 rows
  });
});

describe("formatCsv", () => {
  it("renders CSV with header and data row", () => {
    const output = formatCsv([makeIssue()]);
    const lines = output.split("\n");
    expect(lines[0]).toBe("ID,Title,Status,Priority,Assignee,Project");
    expect(lines[1]).toContain("DEV-100");
    expect(lines[1]).toContain("Test issue");
  });

  it("escapes values containing commas", () => {
    const output = formatCsv([makeIssue({ title: "Fix bug, urgently" })]);
    expect(output).toContain('"Fix bug, urgently"');
  });

  it("escapes values containing double quotes", () => {
    const output = formatCsv([makeIssue({ title: 'Say "hello"' })]);
    expect(output).toContain('"Say ""hello"""');
  });

  it("supports custom field selection", () => {
    const output = formatCsv([makeIssue()], ["identifier", "status"]);
    const lines = output.split("\n");
    expect(lines[0]).toBe("ID,Status");
  });
});

describe("formatMarkdown", () => {
  it("renders a markdown table with header and divider", () => {
    const output = formatMarkdown([makeIssue()]);
    const lines = output.split("\n");
    expect(lines[0]).toMatch(/^\| .+ \|$/);
    expect(lines[1]).toMatch(/^\| ---/);
    expect(lines[2]).toContain("DEV-100");
  });

  it("renders issue link in identifier column", () => {
    const output = formatMarkdown([makeIssue()]);
    expect(output).toContain("[DEV-100](https://linear.app/verticalint/issue/DEV-100)");
  });

  it("escapes pipe characters in cell content", () => {
    const output = formatMarkdown([makeIssue({ title: "A | B" })]);
    expect(output).toContain("A \\| B");
  });

  it("handles missing project gracefully", () => {
    const output = formatMarkdown([makeIssue({ project: undefined })]);
    expect(output).toContain("—");
  });

  it("renders labels column", () => {
    const output = formatMarkdown([makeIssue()], ["identifier", "labels"]);
    expect(output).toContain("feature");
  });

  it("returns message for invalid columns", () => {
    const output = formatMarkdown([makeIssue()], ["nonexistent"]);
    expect(output).toBe("No valid columns specified.");
  });
});
