import { describe, expect, it } from "vitest";
import { extractDocId, parseGoogleDoc } from "../utils/gdoc-parser.js";

describe("extractDocId", () => {
  it("extracts ID from a full Google Docs URL", () => {
    const url =
      "https://docs.google.com/document/d/1r-Fvi3GwMLFc1u0i9IZ5gB5Wzhr9F7f1dm9bdV1NFVY/edit";
    expect(extractDocId(url)).toBe("1r-Fvi3GwMLFc1u0i9IZ5gB5Wzhr9F7f1dm9bdV1NFVY");
  });

  it("extracts ID from URL with query params", () => {
    const url =
      "https://docs.google.com/document/d/abc123_-XYZ/edit?tab=t.0#heading=h.1";
    expect(extractDocId(url)).toBe("abc123_-XYZ");
  });

  it("returns bare ID unchanged", () => {
    expect(extractDocId("1r-Fvi3GwMLFc1u0i9IZ5gB5Wzhr9F7f1dm9bdV1NFVY")).toBe(
      "1r-Fvi3GwMLFc1u0i9IZ5gB5Wzhr9F7f1dm9bdV1NFVY",
    );
  });
});

describe("parseGoogleDoc", () => {
  it("returns empty string for empty doc", () => {
    expect(parseGoogleDoc({ body: { content: [] } })).toBe("");
  });

  it("converts a simple paragraph", () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [{ textRun: { content: "Hello world\n" } }],
              paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
            },
          },
        ],
      },
    };
    expect(parseGoogleDoc(doc)).toBe("Hello world\n");
  });

  it("converts headings", () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [{ textRun: { content: "Title\n" } }],
              paragraphStyle: { namedStyleType: "HEADING_1" },
            },
          },
          {
            paragraph: {
              elements: [{ textRun: { content: "Subtitle\n" } }],
              paragraphStyle: { namedStyleType: "HEADING_2" },
            },
          },
        ],
      },
    };
    const result = parseGoogleDoc(doc);
    expect(result).toContain("# Title");
    expect(result).toContain("## Subtitle");
  });

  it("formats bold and italic text", () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [
                { textRun: { content: "normal " } },
                { textRun: { content: "bold", textStyle: { bold: true } } },
                { textRun: { content: " " } },
                { textRun: { content: "italic", textStyle: { italic: true } } },
                { textRun: { content: " " } },
                {
                  textRun: {
                    content: "both",
                    textStyle: { bold: true, italic: true },
                  },
                },
                { textRun: { content: "\n" } },
              ],
              paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
            },
          },
        ],
      },
    };
    const result = parseGoogleDoc(doc);
    expect(result).toContain("**bold**");
    expect(result).toContain("*italic*");
    expect(result).toContain("***both***");
  });

  it("formats links", () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [
                {
                  textRun: {
                    content: "click here",
                    textStyle: { link: { url: "https://example.com" } },
                  },
                },
                { textRun: { content: "\n" } },
              ],
              paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
            },
          },
        ],
      },
    };
    expect(parseGoogleDoc(doc)).toContain("[click here](https://example.com)");
  });

  it("converts bullet lists", () => {
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [{ textRun: { content: "Item one\n" } }],
              bullet: { nestingLevel: 0, listId: "list1" },
            },
          },
          {
            paragraph: {
              elements: [{ textRun: { content: "Nested item\n" } }],
              bullet: { nestingLevel: 1, listId: "list1" },
            },
          },
        ],
      },
    };
    const result = parseGoogleDoc(doc);
    expect(result).toContain("- Item one\n");
    expect(result).toContain("  - Nested item\n");
  });

  it("converts tables", () => {
    const doc = {
      body: {
        content: [
          {
            table: {
              tableRows: [
                {
                  tableCells: [
                    {
                      content: [
                        {
                          paragraph: {
                            elements: [{ textRun: { content: "A\n" } }],
                          },
                        },
                      ],
                    },
                    {
                      content: [
                        {
                          paragraph: {
                            elements: [{ textRun: { content: "B\n" } }],
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    };
    expect(parseGoogleDoc(doc)).toContain("| A | B |");
  });
});
