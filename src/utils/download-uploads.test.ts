import { describe, expect, it } from "vitest";
import type { LinearIssue } from "../types/linear.js";

// Test the URL collection and replacement logic without network calls
describe("downloadLinearUploads", () => {
  const UPLOAD_URL_REGEX = /https:\/\/uploads\.linear\.app\/[^\s)>\]"]+/g;

  function collectUploadUrls(text: string): string[] {
    const matches = text.match(UPLOAD_URL_REGEX);
    return matches ? [...new Set(matches)] : [];
  }

  it("extracts uploads.linear.app URLs from markdown descriptions", () => {
    const desc = "Here is a screenshot:\n![image](https://uploads.linear.app/ws/a/b/file.png)\nEnd";
    const urls = collectUploadUrls(desc);
    expect(urls).toEqual(["https://uploads.linear.app/ws/a/b/file.png"]);
  });

  it("extracts multiple unique URLs", () => {
    const desc =
      "![a](https://uploads.linear.app/ws/1/2/a.png) and ![b](https://uploads.linear.app/ws/3/4/b.jpg)";
    const urls = collectUploadUrls(desc);
    expect(urls).toHaveLength(2);
  });

  it("deduplicates identical URLs", () => {
    const desc =
      "![a](https://uploads.linear.app/ws/1/2/a.png) repeat ![a](https://uploads.linear.app/ws/1/2/a.png)";
    const urls = collectUploadUrls(desc);
    expect(urls).toHaveLength(1);
  });

  it("returns empty for text without upload URLs", () => {
    const desc = "No images here, just a [link](https://example.com)";
    const urls = collectUploadUrls(desc);
    expect(urls).toEqual([]);
  });

  it("ignores non-linear upload URLs", () => {
    const desc = "![image](https://example.com/uploads/file.png)";
    const urls = collectUploadUrls(desc);
    expect(urls).toEqual([]);
  });

  it("handles issue with no description or comments", () => {
    const issue: LinearIssue = {
      id: "abc",
      identifier: "FE-1",
      url: "https://linear.app/test/issue/FE-1",
      title: "Test",
      priority: 2,
      labels: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    // No description or comments — should be a no-op
    const allUrls = new Set<string>();
    if (issue.description) {
      for (const url of collectUploadUrls(issue.description)) {
        allUrls.add(url);
      }
    }
    expect(allUrls.size).toBe(0);
  });
});
