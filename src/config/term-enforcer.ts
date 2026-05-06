import { outputWarning } from "../utils/output.js";
import { loadConfig } from "./config.js";

/**
 * A single term-enforcement rule. The canonical form is what authors should use;
 * the reject list contains common misspellings or alternate forms that should be
 * flagged (and corrected to the canonical form).
 *
 * @example
 *   { canonical: "Enrich Layer", reject: ["EnrichLayer", "enrichlayer", "Enrichlayer"] }
 *   { canonical: "Linear", reject: ["linear.app", "Linear App"] }
 *   { canonical: "GitHub", reject: ["Github", "github", "GitHUB"] }
 */
export interface TermRule {
	canonical: string;
	reject: string[];
}

interface TermViolation {
	matched: string;
	occurrences: number;
	rule: TermRule;
}

/**
 * Build a regex that matches the rejected form as a standalone token, while
 * tolerating common URL/file boundaries. The look-arounds prevent us from
 * flagging `enrichlayer.com` (URL), `myenrichlayer` (compound word), or
 * `path/to/enrichlayer` (file path).
 */
function buildRejectRegex(rejected: string): RegExp {
	return new RegExp(
		`(?<!\\w|\\.|/)${escapeRegExp(rejected)}(?!\\w|\\.com|\\.co|\\.io)`,
		"g",
	);
}

function findViolations(text: string, rules: TermRule[]): TermViolation[] {
	const violations: TermViolation[] = [];
	for (const rule of rules) {
		for (const rejected of rule.reject) {
			const matches = text.match(buildRejectRegex(rejected));
			if (matches) {
				violations.push({
					rule,
					matched: rejected,
					occurrences: matches.length,
				});
			}
		}
	}
	return violations;
}

function formatViolation(v: TermViolation): string {
	const plural = v.occurrences > 1 ? "s" : "";
	return `Found "${v.matched}" — use "${v.rule.canonical}" instead (${v.occurrences} occurrence${plural})`;
}

/**
 * Enforce all configured term rules against the given texts (typically a title
 * and an optional description). In strict mode, the first violation throws;
 * otherwise, all violations are buffered as warnings on the JSON output.
 *
 * Configure rules in your el-linear config:
 *   {
 *     "terms": [
 *       { "canonical": "Enrich Layer", "reject": ["EnrichLayer", "enrichlayer"] }
 *     ]
 *   }
 *
 * If no rules are configured, this is a no-op.
 */
export function enforceTerms(
	texts: Array<string | null | undefined>,
	options: { strict?: boolean } = {},
): void {
	const { terms } = loadConfig();
	if (!terms || terms.length === 0) {
		return;
	}

	const allViolations: TermViolation[] = [];
	for (const text of texts) {
		if (!text) {
			continue;
		}
		allViolations.push(...findViolations(text, terms));
	}

	if (allViolations.length === 0) {
		return;
	}

	const warnings = allViolations.map(formatViolation);

	if (options.strict) {
		throw new Error(
			`Term enforcement failed:\n${warnings.map((w) => `  - ${w}`).join("\n")}`,
		);
	}
	outputWarning(warnings, "term_enforcement");
}

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
