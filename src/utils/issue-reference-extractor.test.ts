import { describe, expect, it } from "vitest";
import { extractIssueReferences, type IssueReference } from "./issue-reference-extractor.js";

const related = (id: string): IssueReference => ({
  identifier: id,
  type: "related",
  reverse: false,
});
const blocks = (id: string, reverse = false): IssueReference => ({
  identifier: id,
  type: "blocks",
  reverse,
});
const duplicate = (id: string, reverse = false): IssueReference => ({
  identifier: id,
  type: "duplicate",
  reverse,
});

describe("extractIssueReferences", () => {
  it("extracts a single identifier from prose as related by default", () => {
    expect(extractIssueReferences("based on DEV-3592, we should...")).toEqual([
      related("DEV-3592"),
    ]);
  });

  it("extracts multiple distinct identifiers", () => {
    expect(extractIssueReferences("see DEV-100 and EMW-258, also INF-9")).toEqual([
      related("DEV-100"),
      related("EMW-258"),
      related("INF-9"),
    ]);
  });

  it("deduplicates repeated identifiers", () => {
    expect(extractIssueReferences("DEV-100 again DEV-100 once more DEV-100")).toEqual([
      related("DEV-100"),
    ]);
  });

  it("returns empty array for text without identifiers", () => {
    expect(extractIssueReferences("nothing to see here")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractIssueReferences("")).toEqual([]);
  });

  it("excludes the self identifier", () => {
    expect(extractIssueReferences("see EMW-258 and DEV-3592", "EMW-258")).toEqual([
      related("DEV-3592"),
    ]);
  });

  it("strips fenced code blocks (triple backticks)", () => {
    const text = [
      "real reference: DEV-100",
      "```",
      "log: BUILD-12345 not a real reference",
      "```",
      "another: DEV-200",
    ].join("\n");
    expect(extractIssueReferences(text)).toEqual([related("DEV-100"), related("DEV-200")]);
  });

  it("strips fenced code blocks (tildes)", () => {
    const text = [
      "real: DEV-100",
      "~~~",
      "ENV-999 inside tilde fence",
      "~~~",
      "real: DEV-200",
    ].join("\n");
    expect(extractIssueReferences(text)).toEqual([related("DEV-100"), related("DEV-200")]);
  });

  it("matches identifiers inside inline backticks", () => {
    expect(extractIssueReferences("see `EMW-258` for context")).toEqual([related("EMW-258")]);
  });

  it("does not match lowercase team keys", () => {
    expect(extractIssueReferences("dev-100 isn't a Linear identifier")).toEqual([]);
  });

  it("matches identifiers embedded in URLs", () => {
    expect(extractIssueReferences("https://linear.app/foo/issue/DEV-3592/title-slug")).toEqual([
      related("DEV-3592"),
    ]);
  });

  it("matches alphanumeric team keys", () => {
    expect(extractIssueReferences("legacy team: A1B-42")).toEqual([related("A1B-42")]);
  });

  it("does not match numeric-only suffixes glued to other words", () => {
    expect(extractIssueReferences("FOO-bar-123 is not a match")).toEqual([]);
  });

  it("ignores trailing punctuation", () => {
    expect(extractIssueReferences("see DEV-100, DEV-200; also DEV-300.")).toEqual([
      related("DEV-100"),
      related("DEV-200"),
      related("DEV-300"),
    ]);
  });

  // ---- prose-based relation inference ----

  it("infers blockedBy from 'blocked by'", () => {
    expect(extractIssueReferences("blocked by DEV-100")).toEqual([blocks("DEV-100", true)]);
  });

  it("infers blockedBy from 'depends on'", () => {
    expect(extractIssueReferences("This depends on DEV-100")).toEqual([blocks("DEV-100", true)]);
  });

  it("infers blockedBy from 'waiting on'", () => {
    expect(extractIssueReferences("Currently waiting on EMW-200")).toEqual([
      blocks("EMW-200", true),
    ]);
  });

  it("infers blocks from 'blocks'", () => {
    expect(extractIssueReferences("This blocks DEV-100")).toEqual([blocks("DEV-100", false)]);
  });

  it("infers blocks from 'prerequisite for'", () => {
    expect(extractIssueReferences("This is a prerequisite for DEV-100")).toEqual([
      blocks("DEV-100", false),
    ]);
  });

  it("infers blocks from 'prerequisite of'", () => {
    expect(extractIssueReferences("Listed as prerequisite of DEV-100")).toEqual([
      blocks("DEV-100", false),
    ]);
  });

  it("infers duplicate from 'duplicates'", () => {
    expect(extractIssueReferences("This duplicates DEV-50")).toEqual([duplicate("DEV-50", false)]);
  });

  it("infers duplicate from 'duplicate of'", () => {
    expect(extractIssueReferences("This is a duplicate of DEV-50")).toEqual([
      duplicate("DEV-50", false),
    ]);
  });

  it("infers duplicate from 'dup of'", () => {
    expect(extractIssueReferences("dup of DEV-50")).toEqual([duplicate("DEV-50", false)]);
  });

  it("infers reversed duplicate from 'duplicated by'", () => {
    expect(extractIssueReferences("This was duplicated by EMW-100")).toEqual([
      duplicate("EMW-100", true),
    ]);
  });

  it("keyword detection is case-insensitive", () => {
    expect(extractIssueReferences("Blocked By DEV-100")).toEqual([blocks("DEV-100", true)]);
    expect(extractIssueReferences("DUPLICATES DEV-50")).toEqual([duplicate("DEV-50", false)]);
  });

  it("upgrades from related to a stronger inference when the same id repeats", () => {
    // first occurrence is bare (related), second is "blocked by" — stronger wins
    expect(extractIssueReferences("see DEV-100; later, blocked by DEV-100")).toEqual([
      blocks("DEV-100", true),
    ]);
  });

  it("does not downgrade from a stronger inference back to related", () => {
    // first occurrence "blocked by", second is bare — first wins
    expect(extractIssueReferences("blocked by DEV-100; see also DEV-100 elsewhere")).toEqual([
      blocks("DEV-100", true),
    ]);
  });

  it("handles mixed types in one description", () => {
    const text =
      "based on DEV-3592, this duplicates DEV-50, and is blocked by DEV-100, also see EMW-9";
    expect(extractIssueReferences(text)).toEqual([
      related("DEV-3592"),
      duplicate("DEV-50", false),
      blocks("DEV-100", true),
      related("EMW-9"),
    ]);
  });

  it("does not misattribute keyword across line breaks beyond the window", () => {
    // The keyword and the identifier are far apart — should be related, not blocks
    const text =
      "blocked by something not described here.\n\nLater, in another paragraph, we mention DEV-100 in passing.";
    expect(extractIssueReferences(text)).toEqual([related("DEV-100")]);
  });

  // Regression guard for the bug Nico flagged on MR !428: when the identifier is already
  // wrapped as a markdown link, the inserted `[` between the keyword and the identifier
  // breaks the trailing-whitespace anchor in the keyword regex, and inference falls back
  // to "related". Callers MUST pass the pre-wrap text to keep type inference correct.
  it("does NOT infer relation type when identifier is already markdown-wrapped (caller must pass pre-wrap text)", () => {
    expect(
      extractIssueReferences("blocked by [DEV-100](https://linear.app/x/issue/DEV-100/)"),
    ).toEqual([related("DEV-100")]);
    expect(
      extractIssueReferences("this duplicates [DEV-50](https://linear.app/x/issue/DEV-50/)"),
    ).toEqual([related("DEV-50")]);
  });
});
