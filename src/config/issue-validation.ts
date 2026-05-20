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
 * Built-in per-team overrides for the canonical type-label set. Teams whose
 * taxonomy diverges from the workspace default ship here so the CLI accepts
 * their labels out of the box without forcing every operator to maintain a
 * personal config override.
 *
 * DEV-4084: the Dev team uses `research` instead of `spike` (and has no
 * `spike` label) — the DEV-3768 fix removed the silent `research → spike`
 * alias correctly, but left the validator's accepted set workspace-wide,
 * so DEV creators were forced into `--skip-validation` (which also drops
 * title-verb, label-count, and description checks).
 *
 * This widens the accepted set for DEV (no rewrite — DEV-3768's no-silent-
 * alias guarantee is preserved) so `--labels "research,tools"` validates
 * cleanly on DEV while every other team keeps `spike`.
 */
const TEAM_TYPE_LABELS: Record<string, string[]> = {
	DEV: ["bug", "feature", "refactor", "chore", "research"],
};

/**
 * Verbs that indicate a `spike`-equivalent type. Shared between `spike` and
 * its team-local synonym `research` so adding a new investigation verb only
 * has to land in one place — without this constant the two arrays drift the
 * next time someone adds e.g. `Probe`.
 */
const SPIKE_VERBS = [
	"Research",
	"Investigate",
	"Explore",
	"Evaluate",
	"Audit",
	"Benchmark",
	"Test",
];

/**
 * Recommended leading verbs for each type label.
 * Title verb and type label should express the same intent.
 *
 * Exported so error-enrichment can reuse the same mapping when inferring a
 * type label from a title's first word.
 *
 * **Ambiguous-verb resolution.** When a verb belongs to multiple type sets
 * (e.g. `Research` appears under both `spike` and `research`), the first
 * declared type wins — `Object.entries` preserves insertion order, and
 * `inferTypeFromTitle` filters by the team's accepted set before iterating.
 * In practice no team accepts both `spike` and `research` (the synonyms),
 * so the first-declared-wins rule never bites; if a future team accepts
 * both, list the preferred one earlier in this map.
 */
export const TYPE_VERB_MAP: Record<string, string[]> = {
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
	spike: SPIKE_VERBS,
	// Team-local synonym for `spike`. Active when the validator is scoped to
	// a team whose `typeLabels` includes `research` (see `TEAM_TYPE_LABELS` /
	// `validation.teamTypeLabels`). Shares `SPIKE_VERBS` so the two stay in
	// lockstep — drift would silently produce different inferences depending
	// on which team you're on.
	research: SPIKE_VERBS,
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
	/**
	 * Team key (e.g. `DEV`) the issue is being created on. When set, the
	 * validator consults the team-scoped `typeLabels` override (DEV-4084) so
	 * a team whose taxonomy doesn't include the workspace default (`spike`)
	 * can validate its own equivalent (`research`) without `--skip-validation`.
	 *
	 * `team` is otherwise advisory: it does not affect description/title/
	 * assignee/project requirements.
	 */
	team?: string;
}

interface ValidationConfig {
	enabled: boolean;
	typeLabels: string[];
	teamTypeLabels: Record<string, string[]>;
}

function getValidationConfig(): ValidationConfig {
	const config = loadConfig();
	const validation = config.validation;
	// User-supplied `teamTypeLabels` are layered on top of the built-in
	// `TEAM_TYPE_LABELS` so an operator can add a new team's override
	// without having to re-declare DEV's. A user override for an existing
	// team key replaces the built-in entry for that key.
	//
	// Normalize user-config keys to uppercase before merging — Linear team
	// keys are uppercase canonical, but an operator who writes
	// `{ "dev": [...] }` (lowercase) should still hit DEV's override. Doing
	// it here means `resolveTypeLabels` can rely on a uniformly uppercased
	// map without re-walking on every lookup.
	const userOverrides: Record<string, string[]> = {};
	for (const [key, value] of Object.entries(validation?.teamTypeLabels ?? {})) {
		userOverrides[key.toUpperCase()] = value;
	}
	const teamTypeLabels = {
		...TEAM_TYPE_LABELS,
		...userOverrides,
	};
	return {
		enabled: validation?.enabled ?? true,
		typeLabels: validation?.typeLabels ?? DEFAULT_TYPE_LABELS,
		teamTypeLabels,
	};
}

/**
 * Resolve the canonical type-label set for a team. DEV-4084: when the team
 * has a per-team override (built-in or config-declared) that set is returned;
 * otherwise the workspace default. The team key is normalized to uppercase
 * because Linear team keys are case-insensitive but stored uppercase.
 */
function resolveTypeLabels(team: string | undefined): string[] {
	const cfg = getValidationConfig();
	if (!team) return cfg.typeLabels;
	const teamKey = team.toUpperCase();
	return cfg.teamTypeLabels[teamKey] ?? cfg.typeLabels;
}

/**
 * Public accessor for the canonical type labels. Pass the team key to get
 * the team-scoped set (DEV-4084); omit for the workspace default. Used by
 * error-enrichment when suggesting labels.
 */
export function getCanonicalTypeLabels(team?: string): string[] {
	return resolveTypeLabels(team);
}

/**
 * Find the canonical type label for a title's first word, if it matches a
 * known verb in TYPE_VERB_MAP. Returns the matched verb and inferred type,
 * or null if no match.
 *
 * Checks multi-word verbs first (e.g. "Set up"), then single-word verbs.
 *
 * Why this lives next to `checkTitleVerbAlignment` but does NOT share its
 * matching loop: the two functions answer different questions despite
 * walking the same map.
 *   - `checkTitleVerbAlignment` runs only when a type label is already
 *     supplied; it warns when the verb belongs to a *different* type set
 *     than the one the user picked.
 *   - `inferTypeFromTitle` runs only when no type label is supplied; it
 *     wants the *positive* match — "this verb belongs to this type" —
 *     so it can suggest a default in the enrichment block.
 * Sharing TYPE_VERB_MAP keeps them in sync; sharing the matcher would
 * conflate "warn about mismatch" with "suggest a default" and produce
 * subtle bugs (e.g. inferring a type the alignment check just rejected).
 */
export function inferTypeFromTitle(
	title: string,
	team?: string,
): { verb: string; type: string } | null {
	const lowered = title.toLowerCase();
	// DEV-4084: when scoping to a team, only suggest a type that the team
	// actually accepts. This makes "Research GraphQL caching options" on a
	// DEV team infer `research` instead of `spike` (which DEV doesn't have)
	// without disrupting other teams whose taxonomy still uses `spike`.
	const allowedTypes = new Set(resolveTypeLabels(team));
	const isAllowed = (type: string): boolean => allowedTypes.has(type);

	// Multi-word verbs first ("Set up")
	for (const [type, verbs] of Object.entries(TYPE_VERB_MAP)) {
		if (!isAllowed(type)) continue;
		for (const verb of verbs) {
			if (!verb.includes(" ")) {
				continue;
			}
			const verbLower = verb.toLowerCase();
			if (lowered.startsWith(`${verbLower} `) || lowered === verbLower) {
				return { verb, type };
			}
		}
	}

	// Single-word verb
	const firstWord = title.split(/\s/)[0];
	if (!firstWord) {
		return null;
	}
	const firstLower = firstWord.toLowerCase();
	for (const [type, verbs] of Object.entries(TYPE_VERB_MAP)) {
		if (!isAllowed(type)) continue;
		for (const verb of verbs) {
			if (verb.includes(" ")) {
				continue;
			}
			if (verb.toLowerCase() === firstLower) {
				return { verb, type };
			}
		}
	}
	return null;
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

	// DEV-4084: scope the accepted type-label set to the team when one was
	// passed. Falls back to the workspace default when no team is supplied
	// or no override exists.
	const typeLabels = resolveTypeLabels(input.team);

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
				`  Valid type labels: ${typeLabels.join(", ")}\n` +
				'  Example: --labels "bug,backend"',
		);
	} else {
		// --- Required: exactly one type label ---
		const typeLabelsFound = effectiveLabels.filter((l) =>
			typeLabels.includes(l.toLowerCase()),
		);

		if (typeLabelsFound.length === 0) {
			result.errors.push(
				"Missing type label. Exactly one required.\n" +
					`  Valid type labels: ${typeLabels.join(", ")}\n` +
					`  Provided labels: ${effectiveLabels.join(", ")}\n` +
					`  Example: --labels "${typeLabels[0]},${effectiveLabels[0]}"`,
			);
		} else if (typeLabelsFound.length > 1) {
			result.errors.push(
				`Multiple type labels found: ${typeLabelsFound.join(", ")}. Exactly one required.\n` +
					`  Valid type labels: ${typeLabels.join(", ")}`,
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
		typeLabels.includes(l.toLowerCase()),
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
		outputWarning(warning);
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
