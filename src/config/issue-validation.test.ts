import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock config — validation enabled by default in tests
const mockConfig: Record<string, unknown> = {
  validation: {
    enabled: true,
    typeLabels: ["bug", "feature", "refactor", "chore", "spike"],
  },
};

vi.mock("./config.js", () => ({
  loadConfig: vi.fn().mockImplementation(() => mockConfig),
}));

// Mock outputWarning to avoid side effects
vi.mock("../utils/output.js", () => ({
  outputWarning: vi.fn(),
}));

const { validateIssueCreation, normalizeLabel, enforceValidation } = await import(
  "./issue-validation.js"
);

describe("normalizeLabel", () => {
  it("normalizes capitalized type labels to lowercase", () => {
    expect(normalizeLabel("Bug")).toBe("bug");
    expect(normalizeLabel("Feature")).toBe("feature");
    expect(normalizeLabel("Refactor")).toBe("refactor");
    expect(normalizeLabel("Chore")).toBe("chore");
    expect(normalizeLabel("Spike")).toBe("spike");
  });

  it("normalizes common aliases", () => {
    expect(normalizeLabel("feature-request")).toBe("feature");
    expect(normalizeLabel("bug-report")).toBe("bug");
    expect(normalizeLabel("enhancement")).toBe("feature");
  });

  it("does not alias 'research' to 'spike'", () => {
    expect(normalizeLabel("research")).toBe("research");
  });

  it("passes through unknown labels unchanged", () => {
    expect(normalizeLabel("backend")).toBe("backend");
    expect(normalizeLabel("frontend")).toBe("frontend");
    expect(normalizeLabel("infrastructure")).toBe("infrastructure");
  });

  it("passes through already-canonical labels", () => {
    expect(normalizeLabel("bug")).toBe("bug");
    expect(normalizeLabel("feature")).toBe("feature");
  });
});

describe("validateIssueCreation", () => {
  describe("when validation is enabled", () => {
    it("passes with valid input", () => {
      const result = validateIssueCreation({
        labels: ["bug", "backend"],
        description:
          "## Why we need this\n\nThe auth token refresh logic fails silently when the server returns a 503.",
        title: "Fix auth token refresh on 503 errors",
      });

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("errors when no labels provided", () => {
      const result = validateIssueCreation({
        labels: null,
        description: "Some description that is long enough to pass the minimum length check.",
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Missing --labels");
      expect(result.errors[0]).toContain("type label");
    });

    it("errors when labels provided but no type label", () => {
      const result = validateIssueCreation({
        labels: ["backend", "frontend"],
        description:
          "## Why we need this\n\nDescription that is definitely long enough to pass.",
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Missing type label");
      expect(result.errors[0]).toContain("backend, frontend");
    });

    it("errors when multiple type labels provided", () => {
      const result = validateIssueCreation({
        labels: ["bug", "feature", "backend"],
        description:
          "## Why we need this\n\nDescription that is definitely long enough to pass.",
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Multiple type labels");
      expect(result.errors[0]).toContain("bug, feature");
    });

    it("errors when description is missing", () => {
      const result = validateIssueCreation({
        labels: ["bug", "backend"],
        description: undefined,
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Missing --description");
    });

    it("errors when description is empty", () => {
      const result = validateIssueCreation({
        labels: ["bug"],
        description: "   ",
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Missing --description");
    });

    it("warns when description is short", () => {
      const result = validateIssueCreation({
        labels: ["bug"],
        description: "## Why\n\nShort.",
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("characters"))).toBe(true);
    });

    it("warns when no why section detected", () => {
      const result = validateIssueCreation({
        labels: ["bug", "backend"],
        description:
          "The auth token refresh logic fails silently when the server returns a 503. This needs to be fixed.",
        title: "Fix auth token refresh",
      });

      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("Why we need this"))).toBe(true);
    });

    it("detects why section variants", () => {
      const variants = [
        "## Why we need this\n\nReason here.",
        "## Why\n\nReason here but longer.",
        "**Why**: we need this because of reasons and more reasons.",
        "## Background\n\nThis provides context for the change and its necessity.",
        "## Motivation\n\nThe motivation for this change is clear and important.",
        "Context: this is needed because of the following reasons and more.",
      ];

      for (const desc of variants) {
        // Pad short descriptions
        const paddedDesc = desc.length < 50 ? desc + " ".repeat(50 - desc.length) + "padding" : desc;
        const result = validateIssueCreation({
          labels: ["feature"],
          description: paddedDesc,
          title: "Add new feature",
        });
        const hasWhyWarning = result.warnings.some((w) => w.includes("Why we need this"));
        expect(hasWhyWarning).toBe(false);
      }
    });

    it("warns on long titles", () => {
      const result = validateIssueCreation({
        labels: ["feature"],
        description:
          "## Why we need this\n\nDescription that is long enough to pass the checks.",
        title: "A".repeat(101),
      });

      expect(result.warnings.some((w) => w.includes("101 characters"))).toBe(true);
    });

    it("warns on titles starting with articles", () => {
      for (const article of ["A ", "An ", "The "]) {
        const result = validateIssueCreation({
          labels: ["feature"],
          description:
            "## Why we need this\n\nDescription that is long enough to pass the checks.",
          title: `${article}new feature for the system`,
        });

        expect(result.warnings.some((w) => w.includes("action verb"))).toBe(true);
      }
    });

    it("normalizes labels and returns them", () => {
      const result = validateIssueCreation({
        labels: ["Feature", "backend"],
        description:
          "## Why we need this\n\nDescription that is long enough to pass the checks.",
        title: "Add new feature",
      });

      expect(result.normalizedLabels).toEqual(["feature", "backend"]);
      expect(result.errors).toHaveLength(0);
    });

    it("warns when a label is aliased", () => {
      const result = validateIssueCreation({
        labels: ["feature-request", "frontend"],
        description:
          "## Why we need this\n\nDescription that is long enough to pass the checks.",
        title: "Add new feature",
      });

      expect(result.normalizedLabels).toEqual(["feature", "frontend"]);
      expect(result.warnings.some((w) => w.includes('"feature-request" normalized to "feature"'))).toBe(true);
    });

    it("normalizes feature-request to feature", () => {
      const result = validateIssueCreation({
        labels: ["feature-request", "frontend"],
        description:
          "## Why we need this\n\nDescription that is long enough to pass the checks.",
        title: "Add new feature",
      });

      expect(result.normalizedLabels).toEqual(["feature", "frontend"]);
      expect(result.errors).toHaveLength(0);
    });

    it("collects multiple errors at once", () => {
      const result = validateIssueCreation({
        labels: null,
        description: undefined,
        title: "Fix something",
      });

      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.some((e) => e.includes("--labels"))).toBe(true);
      expect(result.errors.some((e) => e.includes("--description"))).toBe(true);
    });
  });

  describe("when validation is disabled", () => {
    beforeEach(() => {
      mockConfig.validation = { enabled: false };
    });

    afterEach(() => {
      mockConfig.validation = {
        enabled: true,
        typeLabels: ["bug", "feature", "refactor", "chore", "spike"],
      };
    });

    it("returns no errors or warnings", () => {
      const result = validateIssueCreation({
        labels: null,
        description: undefined,
        title: "",
      });

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.normalizedLabels).toBeNull();
    });
  });
});

describe("enforceValidation", () => {
  it("does not throw when no errors", () => {
    expect(() =>
      enforceValidation({
        errors: [],
        warnings: ["some warning"],
        normalizedLabels: null,
      }),
    ).not.toThrow();
  });

  it("throws when errors present", () => {
    expect(() =>
      enforceValidation({
        errors: ["Missing type label"],
        warnings: [],
        normalizedLabels: null,
      }),
    ).toThrow("validation");
  });

  it("includes all errors in the thrown message", () => {
    expect(() =>
      enforceValidation({
        errors: ["Error one", "Error two"],
        warnings: [],
        normalizedLabels: null,
      }),
    ).toThrow(/Error one.*Error two/s);
  });

  it("mentions --no-validate bypass", () => {
    try {
      enforceValidation({
        errors: ["Missing something"],
        warnings: [],
        normalizedLabels: null,
      });
    } catch (e) {
      expect((e as Error).message).toContain("--skip-validation");
    }
  });
});

// Need afterEach import at module level for the nested describe
const { afterEach } = await import("vitest");
