import { describe, expect, it } from "vitest";
import { wrapIssueReferencesAsLinks } from "./issue-reference-wrapper.js";

const valid = (...ids: string[]): Set<string> => new Set(ids);
const W = "acme";
const url = (id: string) => `https://linear.app/${W}/issue/${id}/`;

describe("wrapIssueReferencesAsLinks", () => {
  it("wraps a single bare identifier", () => {
    expect(wrapIssueReferencesAsLinks("see DEV-100 for details", valid("DEV-100"), W)).toBe(
      `see [DEV-100](${url("DEV-100")}) for details`,
    );
  });

  it("wraps multiple identifiers in one pass", () => {
    expect(
      wrapIssueReferencesAsLinks("DEV-100 and EMW-258", valid("DEV-100", "EMW-258"), W),
    ).toBe(`[DEV-100](${url("DEV-100")}) and [EMW-258](${url("EMW-258")})`);
  });

  it("skips identifiers not in the valid set (e.g. ISO-1424 false positives)", () => {
    expect(
      wrapIssueReferencesAsLinks("real DEV-100 vs ISO-1424", valid("DEV-100"), W),
    ).toBe(`real [DEV-100](${url("DEV-100")}) vs ISO-1424`);
  });

  it("returns text unchanged when valid set is empty", () => {
    expect(wrapIssueReferencesAsLinks("DEV-100 EMW-258", valid(), W)).toBe("DEV-100 EMW-258");
  });

  it("returns empty string unchanged", () => {
    expect(wrapIssueReferencesAsLinks("", valid("DEV-100"), W)).toBe("");
  });

  it("does not wrap inside fenced code blocks", () => {
    const text = ["before DEV-100", "```", "log: DEV-200 inside fence", "```", "after DEV-300"].join(
      "\n",
    );
    const result = wrapIssueReferencesAsLinks(text, valid("DEV-100", "DEV-200", "DEV-300"), W);
    expect(result).toContain(`[DEV-100](${url("DEV-100")})`);
    expect(result).toContain(`[DEV-300](${url("DEV-300")})`);
    expect(result).toContain("DEV-200 inside fence"); // bare, unchanged
    expect(result).not.toContain(`[DEV-200]`);
  });

  it("does not wrap inside inline backticks", () => {
    const text = "see `DEV-100` for context, also DEV-200";
    expect(wrapIssueReferencesAsLinks(text, valid("DEV-100", "DEV-200"), W)).toBe(
      `see \`DEV-100\` for context, also [DEV-200](${url("DEV-200")})`,
    );
  });

  it("does not double-wrap an existing markdown link", () => {
    const text = `already [DEV-100](${url("DEV-100")}), but DEV-200 is bare`;
    expect(wrapIssueReferencesAsLinks(text, valid("DEV-100", "DEV-200"), W)).toBe(
      `already [DEV-100](${url("DEV-100")}), but [DEV-200](${url("DEV-200")}) is bare`,
    );
  });

  it("does not wrap inside the URL portion of an existing markdown link", () => {
    // The link's URL contains DEV-100 but the visible text says "Issue link"
    const text = `[Issue link](${url("DEV-100")}) and bare DEV-200`;
    const result = wrapIssueReferencesAsLinks(text, valid("DEV-100", "DEV-200"), W);
    // DEV-100 should NOT be re-wrapped — it lives only inside the existing link's url
    expect(result).toContain(`[Issue link](${url("DEV-100")})`);
    expect(result).toContain(`[DEV-200](${url("DEV-200")})`);
    // ensure we didn't wrap the url-embedded DEV-100 a second time
    expect(result.match(new RegExp(`\\[DEV-100\\]`, "g"))?.length ?? 0).toBe(0);
  });

  it("does not wrap inside angle-bracket autolinks", () => {
    const text = `<https://example.com/DEV-100> and DEV-200`;
    expect(wrapIssueReferencesAsLinks(text, valid("DEV-100", "DEV-200"), W)).toBe(
      `<https://example.com/DEV-100> and [DEV-200](${url("DEV-200")})`,
    );
  });

  it("idempotent: running twice produces the same result", () => {
    const text = "see DEV-100 and DEV-200";
    const once = wrapIssueReferencesAsLinks(text, valid("DEV-100", "DEV-200"), W);
    const twice = wrapIssueReferencesAsLinks(once, valid("DEV-100", "DEV-200"), W);
    expect(twice).toBe(once);
  });

  it("wraps identifiers outside bare URLs but leaves them alone inside", () => {
    const text = "bug at https://github.com/foo/bar where DEV-100 is broken";
    expect(wrapIssueReferencesAsLinks(text, valid("DEV-100"), W)).toBe(
      `bug at https://github.com/foo/bar where [DEV-100](${url("DEV-100")}) is broken`,
    );
  });

  it("does not wrap identifiers embedded inside bare URLs (would split the URL)", () => {
    // The bare URL contains DEV-100 in its path. Wrapping would produce
    // "https://example.com/[DEV-100](...)" which renders as a broken URL.
    const text = "see https://example.com/DEV-100/foo and bare DEV-200";
    expect(wrapIssueReferencesAsLinks(text, valid("DEV-100", "DEV-200"), W)).toBe(
      `see https://example.com/DEV-100/foo and bare [DEV-200](${url("DEV-200")})`,
    );
  });

  it("preserves trailing punctuation", () => {
    expect(
      wrapIssueReferencesAsLinks("DEV-100, DEV-200; and DEV-300.", valid("DEV-100", "DEV-200", "DEV-300"), W),
    ).toBe(
      `[DEV-100](${url("DEV-100")}), [DEV-200](${url("DEV-200")}); and [DEV-300](${url("DEV-300")}).`,
    );
  });

  it("handles repeated occurrences of the same id", () => {
    expect(
      wrapIssueReferencesAsLinks("DEV-100 then DEV-100 again", valid("DEV-100"), W),
    ).toBe(`[DEV-100](${url("DEV-100")}) then [DEV-100](${url("DEV-100")}) again`);
  });
});
