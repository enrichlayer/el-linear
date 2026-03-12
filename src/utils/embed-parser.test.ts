import { describe, expect, it } from "vitest";
import { extractEmbeds, extractFilenameFromUrl, isLinearUploadUrl } from "./embed-parser.js";

describe("isLinearUploadUrl", () => {
  it("returns true for uploads.linear.app URLs", () => {
    expect(isLinearUploadUrl("https://uploads.linear.app/abc/def.png")).toBe(true);
  });

  it("returns false for other URLs", () => {
    expect(isLinearUploadUrl("https://example.com/image.png")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLinearUploadUrl("")).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isLinearUploadUrl("not-a-url")).toBe(false);
  });
});

describe("extractFilenameFromUrl", () => {
  it("extracts filename from URL path", () => {
    expect(extractFilenameFromUrl("https://uploads.linear.app/abc/screenshot.png")).toBe(
      "screenshot.png",
    );
  });

  it("returns 'download' for invalid URL", () => {
    expect(extractFilenameFromUrl("not-a-url")).toBe("download");
  });

  it("returns 'download' for URL with trailing slash", () => {
    expect(extractFilenameFromUrl("https://example.com/")).toBe("download");
  });
});

describe("extractEmbeds", () => {
  it("returns empty array for null content", () => {
    expect(extractEmbeds(null)).toEqual([]);
  });

  it("returns empty array for undefined content", () => {
    expect(extractEmbeds(undefined)).toEqual([]);
  });

  it("returns empty array for content with no embeds", () => {
    expect(extractEmbeds("just plain text")).toEqual([]);
  });

  it("extracts image embeds from Linear upload URLs", () => {
    const content = "![screenshot](https://uploads.linear.app/abc/img.png)";
    const result = extractEmbeds(content);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("screenshot");
    expect(result[0].url).toBe("https://uploads.linear.app/abc/img.png");
  });

  it("ignores non-Linear image URLs", () => {
    const content = "![img](https://example.com/img.png)";
    expect(extractEmbeds(content)).toEqual([]);
  });

  it("extracts link embeds from Linear upload URLs", () => {
    const content = "[download file](https://uploads.linear.app/abc/doc.pdf)";
    const result = extractEmbeds(content);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("download file");
  });

  it("ignores URLs inside inline code", () => {
    const content = "`![img](https://uploads.linear.app/abc/img.png)`";
    expect(extractEmbeds(content)).toEqual([]);
  });

  it("ignores URLs inside code blocks", () => {
    const content = "```\n![img](https://uploads.linear.app/abc/img.png)\n```";
    expect(extractEmbeds(content)).toEqual([]);
  });
});
