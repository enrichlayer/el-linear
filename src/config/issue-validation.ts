/**
 * Issue creation validation — Phase 1 of DEV-3708.
 *
 * Enforces structural requirements (type labels, description, label normalization)
 * at the CLI level rather than relying on LLM skill prompts.
 *
 * Gated behind `validation.enabled` in config so it can be rolled out per-user
 * before becoming the default for the team.
 */

import { outputWarning } from "../utils/output.js";
import { loadConfig } from "./config.js";

/** Canonical type labels. Stored in config so they can be updated without code changes. */
const DEFAULT_TYPE_LABELS = ["bug", "feature", "refactor", "chore", "spike"];

/**
 * Common misspellings / wrong-case variants → canonical form.
 * Covers the real mistakes observed in production data.
 */
const LABEL_ALIASES: Record<string, string> = {
  Bug: "bug",
  Feature: "feature",
  Refactor: "refactor",
  Chore: "chore",
  Spike: "spike",
  "feature-request": "feature",
  "bug-report": "bug",
  enhancement: "feature",
  research: "spike",
};

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  /** Labels after normalization (aliases resolved, case fixed). */
  normalizedLabels: string[] | null;
}

export interface ValidationInput {
  labels: string[] | null;
  description: string | undefined;
  title: string;
}

interface ValidationConfig {
  enabled: boolean;
  typeLabels: string[];
}

function getValidationConfig(): ValidationConfig {
  const config = loadConfig();
  const validation = config.validation;
  return {
    enabled: validation?.enabled ?? false,
    typeLabels: validation?.typeLabels ?? DEFAULT_TYPE_LABELS,
  };
}

/**
 * Normalize a label name: resolve known aliases and fix casing.
 * Returns the canonical form if an alias exists, otherwise the original.
 */
export function normalizeLabel(label: string): string {
  // Exact alias match first (case-sensitive for things like "Feature" → "feature")
  if (label in LABEL_ALIASES) {
    return LABEL_ALIASES[label];
  }
  return label;
}

/**
 * Validate issue creation inputs. Returns errors (block creation) and warnings (informational).
 *
 * Only runs when `validation.enabled` is true in config.
 * Bypass entirely with `--no-validate`.
 */
export function validateIssueCreation(input: ValidationInput): ValidationResult {
  const vConfig = getValidationConfig();
  const result: ValidationResult = {
    errors: [],
    warnings: [],
    normalizedLabels: null,
  };

  if (!vConfig.enabled) {
    return result;
  }

  // --- Label normalization (always runs when validation is on) ---
  if (input.labels && input.labels.length > 0) {
    result.normalizedLabels = input.labels.map(normalizeLabel);
  }

  const effectiveLabels = result.normalizedLabels ?? input.labels ?? [];

  // --- Required: labels must be provided ---
  if (effectiveLabels.length === 0) {
    result.errors.push(
      "Missing --labels. At least one label is required, including a type label.\n" +
        `  Valid type labels: ${vConfig.typeLabels.join(", ")}\n` +
        '  Example: --labels "bug,backend"',
    );
  } else {
    // --- Required: exactly one type label ---
    const typeLabelsFound = effectiveLabels.filter((l) =>
      vConfig.typeLabels.includes(l.toLowerCase()),
    );

    if (typeLabelsFound.length === 0) {
      result.errors.push(
        "Missing type label. Exactly one required.\n" +
          `  Valid type labels: ${vConfig.typeLabels.join(", ")}\n` +
          `  Provided labels: ${effectiveLabels.join(", ")}\n` +
          `  Example: --labels "${vConfig.typeLabels[0]},${effectiveLabels[0]}"`,
      );
    } else if (typeLabelsFound.length > 1) {
      result.errors.push(
        `Multiple type labels found: ${typeLabelsFound.join(", ")}. Exactly one required.\n` +
          `  Valid type labels: ${vConfig.typeLabels.join(", ")}`,
      );
    }
  }

  // --- Required: description must be provided ---
  if (!input.description || input.description.trim().length === 0) {
    result.errors.push("Missing --description. A description is required for issue creation.");
  } else {
    // --- Warning: short description ---
    if (input.description.trim().length < 50) {
      result.warnings.push(
        `Description is only ${input.description.trim().length} characters. Consider adding more context.`,
      );
    }

    // --- Warning: no "why" section ---
    const descLower = input.description.toLowerCase();
    const hasWhySection =
      descLower.includes("why we need") ||
      descLower.includes("## why") ||
      descLower.includes("**why") ||
      descLower.includes("background") ||
      descLower.includes("motivation") ||
      descLower.includes("context:");
    if (!hasWhySection) {
      result.warnings.push(
        'Consider adding a "## Why we need this" section to explain the motivation.',
      );
    }
  }

  // --- Warning: title style ---
  if (input.title.length > 100) {
    result.warnings.push(
      `Title is ${input.title.length} characters. Consider shortening to under 100.`,
    );
  }
  if (/^(A|An|The)\s/.test(input.title)) {
    result.warnings.push("Consider starting the title with an action verb instead of an article.");
  }

  return result;
}

/**
 * Apply validation results: emit warnings, throw on errors.
 * Called from the create command unless `--no-validate` is set.
 */
export function enforceValidation(result: ValidationResult): void {
  for (const warning of result.warnings) {
    outputWarning(warning, "validation");
  }
  if (result.errors.length > 0) {
    const errorMsg =
      "Issue creation blocked by validation:\n\n" +
      result.errors.map((e) => `  ✗ ${e}`).join("\n\n") +
      "\n\nUse --skip-validation to bypass all content validation.";
    throw new Error(errorMsg);
  }
}
