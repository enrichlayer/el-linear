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
 * Recommended leading verbs for each type label.
 * Title verb and type label should express the same intent.
 */
const TYPE_VERB_MAP: Record<string, string[]> = {
	bug: ["Fix", "Resolve", "Patch", "Handle", "Address", "Correct"],
	feature: [
		"Add",
		"Build",
		"Create",
		"Implement",
		"Enable",
		"Ship",
		"Launch",
		"Design",
		"Wire",
		"Integrate",
		"Expose",
		"Send",
		"Track",
		"Alert",
		"Automate",
		"Post",
	],
	chore: [
		"Update",
		"Remove",
		"Clean",
		"Migrate",
		"Deploy",
		"Rotate",
		"Set up",
		"Configure",
		"Document",
		"Review",
		"Publish",
		"Standardize",
		"Accept",
		"Consolidate",
		"Teardown",
		"Upgrade",
	],
	spike: [
		"Research",
		"Investigate",
		"Explore",
		"Evaluate",
		"Audit",
		"Benchmark",
		"Test",
	],
	refactor: [
		"Refactor",
		"Restructure",
		"Extract",
		"Decouple",
		"Consolidate",
		"Simplify",
	],
};

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
	assignee: string | undefined;
	project: string | undefined;
}

interface ValidationConfig {
	enabled: boolean;
	typeLabels: string[];
}

function getValidationConfig(): ValidationConfig {
	const config = loadConfig();
	const validation = config.validation;
	return {
		enabled: validation?.enabled ?? true,
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
export function validateIssueCreation(
	input: ValidationInput,
): ValidationResult {
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
		result.normalizedLabels = input.labels.map((label) => {
			const normalized = normalizeLabel(label);
			if (normalized !== label) {
				result.warnings.push(
					`Label "${label}" normalized to "${normalized}" (alias)`,
				);
			}
			return normalized;
		});
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
		result.errors.push(
			"Missing --description. A description is required for issue creation.",
		);
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
		result.warnings.push(
			"Consider starting the title with an action verb instead of an article.",
		);
	}

	// --- Warning: title-verb / type-label alignment ---
	const typeLabelsFound = effectiveLabels.filter((l) =>
		vConfig.typeLabels.includes(l.toLowerCase()),
	);
	if (typeLabelsFound.length === 1) {
		checkTitleVerbAlignment(
			input.title,
			typeLabelsFound[0].toLowerCase(),
			result,
		);
	}

	// --- Required: assignee ---
	if (!input.assignee) {
		result.errors.push(
			"Missing --assignee. Every issue must have an assignee.\n" +
				"  Use `el-linear users list --active` to find valid assignees.",
		);
	}

	// --- Required: project ---
	if (!input.project) {
		result.errors.push(
			"Missing --project. Every issue must belong to a project.\n" +
				"  Use `el-linear projects list` to find valid projects.",
		);
	}

	return result;
}

/**
 * Check whether the title's leading verb aligns with the provided type label.
 * Only warns when the first word is a recognized verb in any type's set —
 * titles starting with non-verb words (e.g. "Dashboard auth failing") are left alone.
 */
function checkTitleVerbAlignment(
	title: string,
	typeLabel: string,
	result: ValidationResult,
): void {
	const verbs = TYPE_VERB_MAP[typeLabel];
	if (!verbs) return;

	// Check multi-word verbs first (e.g. "Set up")
	for (const [type, typeVerbs] of Object.entries(TYPE_VERB_MAP)) {
		for (const verb of typeVerbs) {
			if (!verb.includes(" ")) continue;
			if (
				title.toLowerCase().startsWith(`${verb.toLowerCase()} `) ||
				title.toLowerCase() === verb.toLowerCase()
			) {
				if (type === typeLabel) return; // match — all good
				result.warnings.push(
					`Title starts with "${verb}" but type is "${typeLabel}". ` +
						`Consider starting with: ${verbs.slice(0, 6).join(", ")}`,
				);
				result.warnings.push(
					`"${verb}" is typically associated with "${type}" issues.`,
				);
				return;
			}
		}
	}

	// Single-word verb check
	const firstWord = title.split(/\s/)[0];
	if (!firstWord) return;

	// Is the first word in the correct type's verb set?
	const matchesType = verbs.some(
		(v) => v.toLowerCase() === firstWord.toLowerCase(),
	);
	if (matchesType) return; // match — all good

	// Is the first word in any OTHER type's verb set?
	let matchedOtherType: string | null = null;
	for (const [type, typeVerbs] of Object.entries(TYPE_VERB_MAP)) {
		if (type === typeLabel) continue;
		if (typeVerbs.some((v) => v.toLowerCase() === firstWord.toLowerCase())) {
			matchedOtherType = type;
			break;
		}
	}

	// Only warn if the first word IS a recognized verb (just for the wrong type)
	if (matchedOtherType) {
		result.warnings.push(
			`Title starts with "${firstWord}" but type is "${typeLabel}". ` +
				`Consider starting with: ${verbs.slice(0, 6).join(", ")}`,
		);
		result.warnings.push(
			`"${firstWord}" is typically associated with "${matchedOtherType}" issues.`,
		);
	}
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
			"\n\nTo skip validation, pass --skip-validation.\n" +
			"To disable validation permanently, set validation.enabled: false in ~/.config/el-linear/config.json.";
		throw new Error(errorMsg);
	}
}
