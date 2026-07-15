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

const FIELD_LINE =
	/^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*)?(Needed|Worth doing|Existing work|Owner|Placement|Decision)(?:\*\*)?\s*:\s*(.*?)\s*$/gim;
const PLACEHOLDER =
	/^(?:tbd|todo|unknown|n\/?a|none|unsure|not decided|-)\.?$/i;
const NON_SPECIFIC = /^(?:yes|no)$/i;
const AFFIRMATIVE_WITH_REASON = /^yes\s*(?:[-—:;,]|because)\s*(\S.{2,})$/i;

export type IntakeDecisionEvaluation =
	| { ok: true; header: string }
	| { ok: false; reason: "no-section" }
	| { ok: false; reason: "missing-field"; field: string }
	| { ok: false; reason: "duplicate-field"; field: string }
	| { ok: false; reason: "out-of-order"; field: string }
	| { ok: false; reason: "invalid-field"; field: string }
	| { ok: false; reason: "not-proceeding"; decision: string };

function normalizedKey(label: string): IntakeFieldKey {
	switch (label.toLowerCase()) {
		case "needed":
			return "needed";
		case "worth doing":
			return "worth";
		case "existing work":
			return "existing";
		case "owner":
			return "owner";
		case "placement":
			return "placement";
		default:
			return "decision";
	}
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
	const operativeSection = stripFencedCodeBlocks(section);
	const values = new Map<IntakeFieldKey, { value: string; index: number }>();
	for (const match of operativeSection.matchAll(FIELD_LINE)) {
		const key = normalizedKey(match[1] ?? "");
		if (values.has(key)) {
			return {
				ok: false,
				reason: "duplicate-field",
				field:
					FIELD_DEFINITIONS.find((field) => field.key === key)?.label ?? key,
			};
		}
		values.set(key, { value: match[2]?.trim() ?? "", index: match.index });
	}

	let previousIndex = -1;
	for (const definition of FIELD_DEFINITIONS) {
		const entry = values.get(definition.key);
		if (!entry) {
			return {
				ok: false,
				reason: "missing-field",
				field: definition.label,
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

	for (const key of ["needed", "worth"] as const) {
		const value = values.get(key)?.value ?? "";
		const match = value.match(AFFIRMATIVE_WITH_REASON);
		const reason = match?.[1]?.trim() ?? "";
		if (!match || PLACEHOLDER.test(reason)) {
			return {
				ok: false,
				reason: "invalid-field",
				field: key === "needed" ? "Needed" : "Worth doing",
			};
		}
	}
	for (const key of ["existing", "owner", "placement"] as const) {
		const value = values.get(key)?.value ?? "";
		if (
			value.length < 3 ||
			PLACEHOLDER.test(value) ||
			NON_SPECIFIC.test(value)
		) {
			return {
				ok: false,
				reason: "invalid-field",
				field:
					key === "existing"
						? "Existing work"
						: key === "owner"
							? "Owner"
							: "Placement",
			};
		}
	}

	const decision = values.get("decision")?.value ?? "";
	if (!/^proceed$/i.test(decision)) {
		return { ok: false, reason: "not-proceeding", decision };
	}
	return { ok: true, header: matchedHeader };
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
			reason = `The intake decision is missing the "${evaluation.field}" field.`;
			break;
		case "duplicate-field":
			reason = `The intake decision repeats the "${evaluation.field}" field; record one unambiguous value.`;
			break;
		case "out-of-order":
			reason = `The intake fields are out of order at "${evaluation.field}".`;
			break;
		case "invalid-field":
			reason = `The intake field "${evaluation.field}" is empty, a placeholder, or lacks an explicit yes-and-reason judgment.`;
			break;
		case "not-proceeding":
			reason = `The intake decision is "${evaluation.decision || "empty"}", not PROCEED.`;
	}
	return `${reason}\n\nRecord the decision before creating the issue, in this exact order:\n\n## ${opts.headers[0]}\n- Needed: Yes — <why this is needed>\n- Worth doing: Yes — <why the value exceeds the cost>\n- Existing work: <duplicate/search result and evidence>\n- Owner: <canonical owner or source of truth>\n- Placement: <team/project/repository/document path>\n- Decision: PROCEED\n\nIf an accountable human has approved an exceptional create, re-run with --allow-missing-intake-decision; that override is recorded.`;
}
