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

// Required fields for all tests (assignee + project enforced by default)
const required = { assignee: "carol", project: "Infrastructure" };

describe("validateIssueCreation", () => {

  describe("when validation is enabled", () => {
    it("passes with valid input", () => {
      const result = validateIssueCreation({
        ...required,
        labels: ["bug", "backend"],
        description:
          "## Why we need this\n\nThe auth token refresh logic fails silently when the server returns a 503.",
        title: "Fix auth token refresh on 503 errors",
        ...required,
      });

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("errors when no labels provided", () => {
      const result = validateIssueCreation({
        ...required,
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
        ...required,
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
        ...required,
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
        ...required,
        labels: ["bug", "backend"],
        description: undefined,
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Missing --description");
    });

    it("errors when description is empty", () => {
      const result = validateIssueCreation({
        ...required,
        labels: ["bug"],
        description: "   ",
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Missing --description");
    });

    it("warns when description is short", () => {
      const result = validateIssueCreation({
        ...required,
        labels: ["bug"],
        description: "## Why\n\nShort.",
        title: "Fix something",
      });

      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("characters"))).toBe(true);
    });

    it("warns when no why section detected", () => {
      const result = validateIssueCreation({
        ...required,
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
          ...required,
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
        ...required,
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
          ...required,
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
        ...required,
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
        ...required,
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
        ...required,
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
        ...required,
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
        ...required,
        labels: null,
        description: undefined,
        title: "",
        assignee: undefined,
        project: undefined,
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

describe("title-verb / type-label alignment", () => {
  const base = { description: "A valid description with enough context for testing.", ...required };

  it("no warning when title verb matches type", () => {
    const cases: [string, string][] = [
      ["Fix auth token refresh", "bug"],
      ["Add webhook support", "feature"],
      ["Update .env.example", "chore"],
      ["Research vector embeddings", "spike"],
      ["Refactor data layer", "refactor"],
    ];
    for (const [title, type] of cases) {
      const r = validateIssueCreation({ ...base, title, labels: [type, "backend"] });
      const verbWarnings = r.warnings.filter((w) => w.includes("but type is"));
      expect(verbWarnings, `Expected no verb warning for "${title}" with type "${type}"`).toHaveLength(0);
    }
  });

  it("warns when title verb mismatches type", () => {
    const r = validateIssueCreation({ ...base, title: "Build new dashboard", labels: ["bug", "frontend"] });
    expect(r.warnings.some((w) => w.includes('starts with "Build" but type is "bug"'))).toBe(true);
  });

  it("hints at the correct type for the verb", () => {
    const r = validateIssueCreation({ ...base, title: "Fix broken feature", labels: ["feature", "frontend"] });
    expect(r.warnings.some((w) => w.includes('"Fix" is typically associated with "bug"'))).toBe(true);
  });

  it("no warning when title starts with non-verb word", () => {
    const r = validateIssueCreation({ ...base, title: "Dashboard auth is broken", labels: ["bug", "frontend"] });
    const verbWarnings = r.warnings.filter((w) => w.includes("but type is"));
    expect(verbWarnings).toHaveLength(0);
  });

  it("matches case-insensitively", () => {
    const r = validateIssueCreation({ ...base, title: "fix auth token", labels: ["bug", "backend"] });
    const verbWarnings = r.warnings.filter((w) => w.includes("but type is"));
    expect(verbWarnings).toHaveLength(0);
  });

  it("handles multi-word verb 'Set up'", () => {
    const r = validateIssueCreation({ ...base, title: "Set up CI pipeline", labels: ["chore", "infrastructure"] });
    const verbWarnings = r.warnings.filter((w) => w.includes("but type is"));
    expect(verbWarnings).toHaveLength(0);
  });

  it("warns on multi-word verb mismatch", () => {
    const r = validateIssueCreation({ ...base, title: "Set up CI pipeline", labels: ["bug", "infrastructure"] });
    expect(r.warnings.some((w) => w.includes('"Set up" is typically associated with "chore"'))).toBe(true);
  });

  it("does not fire when no type label present", () => {
    const r = validateIssueCreation({ ...base, title: "Fix something", labels: ["frontend"] });
    const verbWarnings = r.warnings.filter((w) => w.includes("but type is"));
    expect(verbWarnings).toHaveLength(0);
  });

  it("does not fire when multiple type labels present", () => {
    const r = validateIssueCreation({ ...base, title: "Fix something", labels: ["bug", "feature"] });
    const verbWarnings = r.warnings.filter((w) => w.includes("but type is"));
    expect(verbWarnings).toHaveLength(0);
  });

  it("never produces errors, only warnings", () => {
    const r = validateIssueCreation({ ...base, title: "Build something wrong", labels: ["bug", "backend"] });
    expect(r.errors.filter((e) => e.includes("verb"))).toHaveLength(0);
  });
});
