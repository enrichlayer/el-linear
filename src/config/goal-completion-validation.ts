/**
 * Goal-completion ("Done when") validation — DEV-5920.
 *
 * A create-time gate that checks the issue description for a goal-completion
 * section ("Done when", "Acceptance criteria", "Success criteria", …) that
 * contains at least one FALSIFIABLE criterion — something a later session can
 * mechanically verify (a command with an expected result, a threshold number,
 * a named artifact path, an exit-code/status assertion, or an explicit
 * "verifiable via X" phrase). A section made only of bare quality adjectives
 * ("improved", "better", "cleaner", "faster") gives the implementing agent no
 * terminal state to converge on, which is the concrete-goals failure mode this
 * gate encodes (RFC-0027 discussion). Mirrors the DEV-4823 duplicate-detection
 * gate and the DEV-5378 SOP-label parent gate.
 *
 * OPT-IN by design. el-linear is MIT and published on npm; most installs are
 * not Enrich Layer and must not be surprised by a new refusal. The gate is
 * dormant unless `validation.goalCompletionGate` is set to `"warn"` or
 * `"block"` (the EL workspace flips it on in its shared team config). Section
 * matching reuses the `extractField` header semantics (`##`/`###` ATX headers
 * and `**bold**` pseudo-headers, case-insensitive, trailing colons stripped)
 * so the gate accepts exactly what `issues read --field "Done when"` can later
 * extract.
 */

import { extractField } from "../utils/extract-field.js";
import { loadConfig } from "./config.js";

/**
 * Default section headers accepted as the goal-completion section, matched
 * with `extractField` semantics (case-insensitive, `##`/`###`/`**bold**`
 * forms, trailing colons stripped). Overridable via
 * `config.validation.goalSectionHeaders`.
 */
export const DEFAULT_GOAL_SECTION_HEADERS = [
	"Done when",
	"Done-when",
	"Acceptance criteria",
	"Success criteria",
];

/** Gate mode: dormant, stderr warning, or hard block. */
export type GoalCompletionGateMode = "off" | "warn" | "block";

export interface GoalCompletionGateConfig {
	/**
	 * The mode in effect. OPT-IN: `"off"` unless validation is not turned off
	 * AND `goalCompletionGate` is explicitly `"warn"` or `"block"`.
	 */
	mode: GoalCompletionGateMode;
	/** The section headers in effect (config override or {@link DEFAULT_GOAL_SECTION_HEADERS}). */
	headers: string[];
}

/**
 * Resolve the goal-completion-gate config from the merged el-linear config.
 *
 * The gate is dormant by default. It activates only when validation isn't
 * disabled (`validation.enabled !== false`) AND the operator has explicitly
 * set `validation.goalCompletionGate` to `"warn"` or `"block"`. Any other
 * value (absent, `false`, a typo) resolves to `"off"` — a misconfigured gate
 * must fail dormant, never blocking. An absent or empty `goalSectionHeaders`
 * falls back to {@link DEFAULT_GOAL_SECTION_HEADERS}.
 */
export function getGoalCompletionGateConfig(): GoalCompletionGateConfig {
	const validation = loadConfig().validation;
	const raw = validation?.goalCompletionGate;
	const mode: GoalCompletionGateMode =
		validation?.enabled !== false && (raw === "warn" || raw === "block")
			? raw
			: "off";
	const headers =
		validation?.goalSectionHeaders && validation.goalSectionHeaders.length > 0
			? validation.goalSectionHeaders
			: DEFAULT_GOAL_SECTION_HEADERS;
	return { mode, headers };
}

/**
 * Falsifiability proxies — any single match makes the section pass. Each is a
 * cheap textual stand-in for "a later session can mechanically check this":
 *
 * - **command** — inline code or a fenced block (`` `pnpm test` `` and its
 *   expected output live in code spans by Markdown convention).
 * - **number** — a digit anywhere in the section: thresholds ("under 200ms",
 *   "95%"), counts ("all 12 tests"), issue/artifact ids. Deliberately
 *   permissive — the failure mode this gate targets is a section with NO
 *   number/command/artifact at all, not a weak number.
 * - **artifact path** — a slash-joined path (`src/utils/foo.ts`) or a bare
 *   filename with a code-adjacent extension.
 * - **exit/status assertion** — "exits non-zero", "exit code 0", "tests
 *   pass", "CI green", "returns nonzero".
 * - **verifiable-via phrase** — "verifiable via/by/with/through X".
 */
const FALSIFIABLE_PROXY_RES: readonly RegExp[] = [
	// Inline code span or a fenced code block opener.
	/`[^`\n]+`/,
	/^ {0,3}(?:`{3,}|~{3,})/m,
	// Threshold number / percentage / count.
	/\d/,
	// Artifact path: slash-joined segments, or a filename with an extension.
	/(?:^|[\s("'[])[\w.-]+\/[\w.\-/]+/m,
	/\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|ya?ml|sh|css|html|txt|csv|toml|sql|py|go|rs|lock)\b/i,
	// Exit-code / status assertion.
	/\bexit(?:s|ed)?\s+(?:code\s+|status\s+)?(?:non-?zero|zero|\d+)\b/i,
	/\bexit\s+(?:code|status)\b/i,
	/\breturns?\s+non-?zero\b/i,
	/\b(?:test|tests|suite|ci|pipeline|lint|typecheck|build|check|checks)\s+(?:is\s+|are\s+|stays?\s+|go(?:es)?\s+)?(?:pass(?:es|ing)?|green|fail(?:s|ing)?|red)\b/i,
	// Explicit "verifiable via X" escape phrase.
	/\bverifi(?:able|ed)\s+(?:via|by|with|through)\b/i,
];

/**
 * Does the section text contain at least one falsifiable criterion?
 * See {@link FALSIFIABLE_PROXY_RES} for what counts. An empty/whitespace
 * section trivially fails — a bare header is not a criterion.
 */
export function hasFalsifiableCriterion(sectionText: string): boolean {
	if (!sectionText || sectionText.trim().length === 0) {
		return false;
	}
	return FALSIFIABLE_PROXY_RES.some((re) => re.test(sectionText));
}

export type GoalCompletionEvaluation =
	| { ok: true; header: string }
	| { ok: false; reason: "no-section" }
	| { ok: false; reason: "vague-section"; header: string };

/**
 * Evaluate a description against the goal-completion rule. Headers are tried
 * in order; the FIRST one present in the description decides the outcome
 * (matching `extractField`'s first-match-wins semantics). A present-but-vague
 * section is reported as `vague-section` with the header that matched, so the
 * error can point at the exact section rather than a generic "missing".
 */
export function evaluateGoalCompletion(
	description: string,
	headers: string[] = DEFAULT_GOAL_SECTION_HEADERS,
): GoalCompletionEvaluation {
	for (const header of headers) {
		const section = extractField(description, header);
		if (section !== null) {
			return hasFalsifiableCriterion(section)
				? { ok: true, header }
				: { ok: false, reason: "vague-section", header };
		}
	}
	return { ok: false, reason: "no-section" };
}

/**
 * Render the human/agent-facing block emitted when the gate fires. `reason`
 * distinguishes "no goal-completion section at all" from "section present but
 * nothing falsifiable in it", so the message points at the exact fix. Names
 * the rule and the `--allow-vague-goal` escape hatch.
 */
export function formatGoalCompletionBlock(opts: {
	reason: "no-section" | "vague-section";
	headers: string[];
	/** The header that matched, when reason is `vague-section`. */
	sectionHeader?: string;
}): string {
	const headerList = opts.headers.join(", ");
	let head: string;
	if (opts.reason === "no-section") {
		head =
			`Issue description has no goal-completion section (looked for: ${headerList}).\n` +
			`  Add a "${opts.headers[0]}" section stating how completion will be verified.\n`;
	} else {
		head =
			`The "${opts.sectionHeader}" section contains no falsifiable criterion.\n` +
			'  Bare quality adjectives ("improved", "better", "cleaner", "faster") give the\n' +
			"  implementing session no terminal state to converge on.\n";
	}
	const criteria =
		"  At least one criterion must be mechanically checkable: a command with its\n" +
		"  expected exit/output, a threshold number or percentage, a named artifact path,\n" +
		'  an exit-code/status assertion, or a "verifiable via X" phrase.\n';
	const hatch =
		"  If the goal is intentionally open-ended, re-run with --allow-vague-goal.";
	return head + criteria + hatch;
}
