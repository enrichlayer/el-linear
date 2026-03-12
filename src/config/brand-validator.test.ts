import { describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({
  loadConfig: () => ({
    brand: {
      name: "Enrich Layer",
      reject: ["EnrichLayer", "enrichlayer", "Enrichlayer", "enrich layer"],
    },
  }),
}));

const { enforceBrandName } = await import("./brand-validator.js");

describe("enforceBrandName", () => {
  it("does not throw for correct brand name", () => {
    expect(() => enforceBrandName("Fix Enrich Layer login bug")).not.toThrow();
  });

  it("does not throw for URLs containing the brand", () => {
    expect(() => enforceBrandName("Visit enrichlayer.com for details")).not.toThrow();
  });

  it("throws in strict mode for misspelling", () => {
    expect(() => enforceBrandName("Fix EnrichLayer login bug", undefined, true)).toThrow(
      "Brand name warning",
    );
  });

  it("warns (stderr) in non-strict mode for misspelling", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    enforceBrandName("Fix EnrichLayer bug");
    expect(spy).toHaveBeenCalledOnce();
    const output = JSON.parse((spy.mock.calls[0][0] as string).trimEnd());
    expect(output.type).toBe("brand_validation");
    expect(output.warnings).toHaveLength(1);
    spy.mockRestore();
  });

  it("checks description too when provided", () => {
    expect(() => enforceBrandName("Good title", "but EnrichLayer in description", true)).toThrow(
      "Brand name warning",
    );
  });

  it("allows enrichlayer in URLs like enrichlayer.co", () => {
    expect(() => enforceBrandName("Go to enrichlayer.co", undefined, true)).not.toThrow();
  });
});
