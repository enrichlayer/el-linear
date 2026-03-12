import { outputWarning } from "../utils/output.js";
import { loadConfig } from "./config.js";

interface BrandValidationResult {
  valid: boolean;
  warnings: string[];
}

/**
 * Validate text for brand name compliance.
 * Returns warnings for misspellings of "Enrich Layer".
 */
function validateBrandName(text: string): BrandValidationResult {
  const config = loadConfig();
  const warnings: string[] = [];

  for (const rejected of config.brand.reject) {
    // Match the rejected form, but not when it's part of a URL
    // (e.g., enrichlayer.com is fine)
    const regex = new RegExp(
      `(?<!\\w|\\.|/)${escapeRegExp(rejected)}(?!\\w|\\.com|\\.co|\\.io)`,
      "g",
    );
    const matches = text.match(regex);
    if (matches) {
      warnings.push(
        `Found "${rejected}" — use "${config.brand.name}" instead (${matches.length} occurrence${matches.length > 1 ? "s" : ""})`,
      );
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Check title and description for brand name issues.
 * In strict mode, throws an error. Otherwise, prints warnings to stderr.
 */
export function enforceBrandName(title: string, description?: string, strict = false): void {
  const textsToCheck = [title];
  if (description) {
    textsToCheck.push(description);
  }

  const allWarnings: string[] = [];
  for (const text of textsToCheck) {
    const result = validateBrandName(text);
    allWarnings.push(...result.warnings);
  }

  if (allWarnings.length > 0) {
    if (strict) {
      throw new Error(`Brand name warning:\n${allWarnings.map((w) => `  - ${w}`).join("\n")}`);
    }
    outputWarning(allWarnings, "brand_validation");
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
