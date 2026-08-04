/**
 * Explicit issue-intake validation — DEV-6163.
 *
 * This gate does not try to decide whether work is worthwhile or where it
 * belongs. It requires the author to record those judgments, in order, before
 * `issues create` can mutate Linear. The deterministic part is completeness:
 * needed, worth doing, existing/duplicate work checked, canonical owner,
 * concrete placement, then a proceed decision.
 *
 * OPT-IN by design. el-linear is open source, so the gate is dormant unless a
 * workspace config sets `validation.intakeDecisionGate` to `"warn"` or
 * `"block"`.
 *
 * DEV-7074: the parser accepts the markdown an author actually types — any
 * list marker (`-`, `*`, `+`, `1.`) and bolded or italicized labels with the
 * colon inside (`**Needed:**`) or outside (`**Needed**:`) the emphasis run.
 * When a field genuinely fails, the diagnostic names WHICH failure it is:
 * an unreadable line, an absent field, an empty value, a placeholder, or a
 * present-but-unjudged value. Reporting a formatting mismatch as empty content
 * sent authors to rewrite prose that was already correct.
 */

import { extractField, stripFencedCodeBlocks } from "../utils/extract-field.js";
import { loadConfig } from "./config.js";

export const DEFAULT_INTAKE_SECTION_HEADERS = ["Intake decision"];

export type IntakeDecisionGateMode = "off" | "warn" | "block";

export interface IntakeDecisionGateConfig {
	mode: IntakeDecisionGateMode;
	headers: string[];
}

export function getIntakeDecisionGateConfig(): IntakeDecisionGateConfig {
	const validation = loadConfig().validation;
	const raw = validation?.intakeDecisionGate;
	const mode: IntakeDecisionGateMode =
		validation?.enabled !== false && (raw === "warn" || raw === "block")
			? raw
			: "off";
	const headers =
		validation?.intakeSectionHeaders &&
		validation.intakeSectionHeaders.length > 0
			? validation.intakeSectionHeaders
			: DEFAULT_INTAKE_SECTION_HEADERS;
	return { mode, headers };
}

const FIELD_DEFINITIONS = [
	{ key: "needed", label: "Needed" },
	{ key: "worth", label: "Worth doing" },
	{ key: "existing", label: "Existing work" },
	{ key: "owner", label: "Owner" },
	{ key: "placement", label: "Placement" },
	{ key: "decision", label: "Decision" },
] as const;

type IntakeFieldKey = (typeof FIELD_DEFINITIONS)[number]["key"];

/**
 * A field line, split at its FIRST colon: an optional list marker or ordinal,
 * the label part, then the value part. Emphasis markers are deliberately not
 * described here — the label and value are normalized separately, because
 * markdown lets the colon fall either inside (`**Needed:**`) or outside
 * (`**Needed**:`) the emphasis run (DEV-7074).
 */
const FIELD_LINE = /^[ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+)?([^:\n]*):(.*)$/;
/** Leading / trailing markdown emphasis run (`**`, `__`, `*`, `_`). */
const LEADING_EMPHASIS = /^[*_]{1,3}\s*/;
const TRAILING_EMPHASIS = /\s*[*_]{1,3}$/;
/** A value entirely wrapped in one emphasis run, e.g. `**PROCEED**`. */
const WRAPPED_IN_EMPHASIS = /^([*_]{1,3})([^*_].*?)\1$/;
/**
 * A paired inline emphasis run at a token boundary. The boundaries are
 * load-bearing: a literal underscore in `PRO_CEED` or `customer_support` is
 * content, not markdown, and must not disappear during semantic validation.
 */
const INLINE_EMPHASIS =
	/(^|[^\p{L}\p{N}])([*_]{1,3})(?=\S)(.+?\S)\2(?=$|[^\p{L}\p{N}])/gu;
const PLACEHOLDER =
	/^(?:tbd|todo|unknown|n\/?a|none|unsure|not decided|-)\.?$/i;
const NON_SPECIFIC = /^(?:yes|no)$/i;
// The gate exists to force an explicit verdict AND a reason. Which punctuation
// joins the two carries no meaning, so every ordinary separator is accepted —
// including `.`, which reads most naturally when the reason is a full sentence.
// A bare verdict still fails: the trailing group requires real reason text.
const AFFIRMATIVE_WITH_REASON = /^yes\s*(?:[-–—.:;,]|because)\s*(\S.{2,})$/i;

/**
 * What is actually wrong with a field whose label parsed. Keeping these apart
 * matters: "the label didn't parse" and "the value is weak" send the author to
 * completely different fixes, and reporting the first as the second sends them
 * to rewrite prose that was already correct (DEV-7074).
 */
export type IntakeFieldProblem =
	| "empty"
	| "placeholder"
	| "non-specific"
	| "no-judgment"
	| "placeholder-reason";

export type IntakeDecisionEvaluation =
	| { ok: true; header: string }
	| { ok: false; reason: "no-section" }
	| { ok: false; reason: "missing-field"; field: string }
	| { ok: false; reason: "unparsed-field"; field: string; line: string }
	| { ok: false; reason: "duplicate-field"; field: string }
	| { ok: false; reason: "out-of-order"; field: string }
	| {
			ok: false;
			reason: "invalid-field";
			field: string;
			problem: IntakeFieldProblem;
			value: string;
	  }
	| { ok: false; reason: "not-proceeding"; decision: string };

function labelOf(key: IntakeFieldKey): string {
	return FIELD_DEFINITIONS.find((field) => field.key === key)?.label ?? key;
}

function normalizedKey(label: string): IntakeFieldKey | null {
	const normalized = label.toLowerCase().trim().replace(/\s+/g, " ");
	return (
		FIELD_DEFINITIONS.find((field) => field.label.toLowerCase() === normalized)
			?.key ?? null
	);
}

/** Strip the emphasis markers wrapping a label, e.g. `**Needed**` -> `Needed`. */
function stripLabelEmphasis(raw: string): {
	label: string;
	/** True when the label opened an emphasis run it did not close before the
	 * colon (`**Needed:**`) — its closing marker then heads the value. */
	opensEmphasis: boolean;
} {
	const trimmed = raw.trim();
	const opened = LEADING_EMPHASIS.test(trimmed);
	const closed = TRAILING_EMPHASIS.test(trimmed);
	return {
		label: trimmed.replace(LEADING_EMPHASIS, "").replace(TRAILING_EMPHASIS, ""),
		opensEmphasis: opened && !closed,
	};
}

function normalizeFieldValue(raw: string, labelOpensEmphasis: boolean): string {
	let value = raw.trim();
	if (labelOpensEmphasis) {
		// The emphasis run heading the value closes the label's bold, it is not
		// part of the value: `* **Needed:** Yes — …`.
		value = value.replace(LEADING_EMPHASIS, "").trim();
	}
	const wrapped = value.match(WRAPPED_IN_EMPHASIS);
	return (wrapped?.[2] ?? value).trim();
}

/**
 * The value with inline emphasis removed, used for the SEMANTIC checks only.
 * `- Decision: **PROCEED**` and `- Needed: **Yes** — …` are the same judgments
 * as their unemphasized forms. Diagnostics report the parsed value, which
 * normalizes a whole-value wrapper but preserves emphasis within longer prose.
 */
function withoutEmphasis(value: string): string {
	let normalized = value;
	let previous: string;
	do {
		previous = normalized;
		normalized = normalized.replace(INLINE_EMPHASIS, "$1$3");
	} while (normalized !== previous);
	return normalized.trim();
}

function parseFieldLine(
	line: string,
): { key: IntakeFieldKey; value: string } | null {
	const match = line.match(FIELD_LINE);
	if (!match) return null;
	const { label, opensEmphasis } = stripLabelEmphasis(match[1] ?? "");
	const key = normalizedKey(label);
	if (key === null) return null;
	return { key, value: normalizeFieldValue(match[2] ?? "", opensEmphasis) };
}

/**
 * Find a line that names `label` but did not parse as `Label: value` — a
 * formatting failure, not absent content. Reported as `unparsed-field` so the
 * author fixes the line instead of writing a field they already wrote.
 */
function findUnparsedLine(lines: string[], label: string): string | null {
	// Built from FIELD_DEFINITIONS' fixed labels (no regex metacharacters).
	const names = new RegExp(
		`^[ \\t]*(?:[-*+][ \\t]+|\\d+[.)][ \\t]+)?[*_]{0,3}${label}\\b`,
		"i",
	);
	for (const line of lines) {
		if (names.test(line) && parseFieldLine(line) === null) return line.trim();
	}
	return null;
}

function classifyValue(
	key: IntakeFieldKey,
	value: string,
): IntakeFieldProblem | null {
	if (value.length === 0) return "empty";
	const probe = withoutEmphasis(value);
	if (probe.length === 0) return "empty";
	if (PLACEHOLDER.test(probe)) return "placeholder";
	if (key === "needed" || key === "worth") {
		const match = probe.match(AFFIRMATIVE_WITH_REASON);
		if (!match) return "no-judgment";
		return PLACEHOLDER.test(match[1]?.trim() ?? "")
			? "placeholder-reason"
			: null;
	}
	// Measure the parsed value rather than the semantic probe so removing inline
	// emphasis markers cannot make substantive content look artificially short.
	if (value.length < 3 || NON_SPECIFIC.test(probe)) return "non-specific";
	return null;
}

export function evaluateIntakeDecision(
	description: string,
	headers: string[] = DEFAULT_INTAKE_SECTION_HEADERS,
): IntakeDecisionEvaluation {
	let section: string | null = null;
	let matchedHeader = "";
	for (const header of headers) {
		section = extractField(description, header);
		if (section !== null) {
			matchedHeader = header;
			break;
		}
	}
	if (section === null) {
		return { ok: false, reason: "no-section" };
	}

	// A template/example fence is not an operative decision record. Remove all
	// fenced examples before matching so copied guidance cannot satisfy intake.
	const lines = stripFencedCodeBlocks(section).split("\n");
	const values = new Map<IntakeFieldKey, { value: string; index: number }>();
	for (const [index, line] of lines.entries()) {
		const parsed = parseFieldLine(line);
		if (!parsed) continue;
		if (values.has(parsed.key)) {
			return {
				ok: false,
				reason: "duplicate-field",
				field: labelOf(parsed.key),
			};
		}
		values.set(parsed.key, { value: parsed.value, index });
	}

	let previousIndex = -1;
	for (const definition of FIELD_DEFINITIONS) {
		const entry = values.get(definition.key);
		if (!entry) {
			// Distinguish "the field is absent" from "the field is there but its
			// line does not parse" — different authoring fixes (DEV-7074).
			const unparsed = findUnparsedLine(lines, definition.label);
			return unparsed === null
				? { ok: false, reason: "missing-field", field: definition.label }
				: {
						ok: false,
						reason: "unparsed-field",
						field: definition.label,
						line: unparsed,
					};
		}
		if (entry.index < previousIndex) {
			return {
				ok: false,
				reason: "out-of-order",
				field: definition.label,
			};
		}
		previousIndex = entry.index;
	}

	for (const key of [
		"needed",
		"worth",
		"existing",
		"owner",
		"placement",
	] as const) {
		const value = values.get(key)?.value ?? "";
		const problem = classifyValue(key, value);
		if (problem !== null) {
			return {
				ok: false,
				reason: "invalid-field",
				field: labelOf(key),
				problem,
				value,
			};
		}
	}

	const decision = values.get("decision")?.value ?? "";
	if (!/^proceed$/i.test(withoutEmphasis(decision))) {
		return { ok: false, reason: "not-proceeding", decision };
	}
	return { ok: true, header: matchedHeader };
}

/** Quote what the author actually wrote, bounded so a long line stays readable. */
function quote(text: string, limit = 80): string {
	const single = text.replace(/\s+/g, " ").trim();
	return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
}

/**
 * Name the ACTUAL failure. A message that blames content for a formatting
 * mismatch sends the author to rewrite prose that was already correct
 * (DEV-7074), so each problem gets its own remedy.
 */
function describeFieldProblem(
	field: string,
	problem: IntakeFieldProblem,
	value: string,
): string {
	switch (problem) {
		case "empty":
			return `The intake field "${field}" parsed, but has no content after the label.`;
		case "placeholder":
			return `The intake field "${field}" is the placeholder "${quote(value)}"; record a real value.`;
		case "non-specific":
			return `The intake field "${field}" reads "${quote(value)}", which is too short or too generic to be a specific answer.`;
		case "no-judgment":
			return `The intake field "${field}" reads "${quote(value)}" — the verdict is there, but no reason follows it. Write both together, e.g. "Yes — <reason>" or "Yes. <reason>"; any ordinary separator works.`;
		case "placeholder-reason":
			return `The intake field "${field}" says Yes but gives the placeholder reason "${quote(value)}"; record the real reason.`;
	}
}

export function formatIntakeDecisionBlock(opts: {
	evaluation: Exclude<IntakeDecisionEvaluation, { ok: true }>;
	headers: string[];
}): string {
	const { evaluation } = opts;
	let reason: string;
	switch (evaluation.reason) {
		case "no-section":
			reason = `Issue description has no intake section (looked for: ${opts.headers.join(", ")}).`;
			break;
		case "missing-field":
			reason = `The intake decision is missing the "${evaluation.field}" field — no line records it.`;
			break;
		case "unparsed-field":
			reason = `The intake decision's "${evaluation.field}" line is not in "${evaluation.field}: <value>" form, so it was not read as a field: "${quote(evaluation.line)}". This is a formatting mismatch, not missing content — the label must be followed by a colon. Bolded labels are accepted in either form (\`- **${evaluation.field}:** <value>\` or \`- **${evaluation.field}**: <value>\`).`;
			break;
		case "duplicate-field":
			reason = `The intake decision repeats the "${evaluation.field}" field; record one unambiguous value.`;
			break;
		case "out-of-order":
			reason = `The intake fields are out of order at "${evaluation.field}".`;
			break;
		case "invalid-field":
			reason = describeFieldProblem(
				evaluation.field,
				evaluation.problem,
				evaluation.value,
			);
			break;
		case "not-proceeding":
			reason = `The intake decision is "${evaluation.decision || "empty"}", not PROCEED.`;
	}
	return `${reason}\n\nRecord the decision before creating the issue, in this exact order:\n\n## ${opts.headers[0]}\n- Needed: Yes — <why this is needed>\n- Worth doing: Yes — <why the value exceeds the cost>\n- Existing work: <duplicate/search result and evidence>\n- Owner: <canonical owner or source of truth>\n- Placement: <team/project/repository/document path>\n- Decision: PROCEED\n\nIf an accountable human has approved an exceptional create, re-run with --allow-missing-intake-decision; that override is recorded.`;
}
