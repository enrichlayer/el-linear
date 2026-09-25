/**
 * Consent-label receipt gate (DEV-10372).
 *
 * Some workspaces treat a label as **consent** for unattended work: an
 * automation picks up any issue carrying it. Consent there is not the label
 * alone — the automation also requires exactly one machine-readable intake
 * receipt in the issue description:
 *
 *   <!-- el-intake-decision:v1 {"policyVersion":"intake-policy/v1", …} -->
 *
 * An issue that carries the label without a valid receipt is silently skipped
 * by that automation, which is the failure this gate removes: el-linear refuses
 * to apply a consent label unless the resulting description carries a receipt
 * for that issue, and names what is missing.
 *
 * Why el-linear refuses rather than writes the receipt: the receipt names the
 * target repository, and whether a (team, project) maps to an admissible
 * repository — and whether that repository is review-only — is policy owned
 * by the automation, not by a generic Linear CLI. Writing a receipt with a
 * guessed repository would manufacture consent the policy never granted. The
 * receipt must also name the issue identifier, which does not exist before
 * `issues create`, so a create can never carry a valid receipt: the consent
 * label is applied with `issues update` once the receipt is written.
 *
 * The receipt shape mirrors the canonical `intake-policy/v1` wire format
 * (`validateIntakeDecisionReceipt` in the automation's shared contracts). This
 * is a strict structural check; the automation's own evaluator remains the
 * admission authority and additionally checks the repository mapping.
 *
 * OPT-IN: dormant unless `validation.consentReceiptGate` is `true`. It is
 * deliberately independent of `validation.enabled` and `--skip-validation`:
 * it guards consent integrity, not field hygiene.
 */

import { loadConfig } from "./config.js";

export const DEFAULT_CONSENT_LABELS = ["bot"];
export const INTAKE_POLICY_VERSION = "intake-policy/v1";

const RECEIPT_RE = /<!--\s*el-intake-decision:v1\s+([^\r\n]+?)\s*-->/g;
const LINEAR_ISSUE_RE = /^[A-Z][A-Z0-9]*-\d+$/;
const SENTRY_SOURCE_ISSUE_RE = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;

/** True when `text` has no ASCII control character (U+0000–U+001F, U+007F). */
function isSafeText(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return false;
	}
	return text.length > 0;
}

/**
 * Linear stores descriptions as normalized markdown and backslash-escapes
 * characters such as `[` and `]`, so a receipt read back from an issue can
 * contain `\[`. No JSON escape starts with those characters, so dropping a
 * backslash before a non-JSON-escape character recovers the written receipt
 * and leaves `\"` and `\\` intact (mirrors the canonical parser).
 */
const JSON_ESCAPE_CHARACTERS = new Set([
	'"',
	"\\",
	"/",
	"b",
	"f",
	"n",
	"r",
	"t",
	"u",
]);

export interface ConsentReceiptGateConfig {
	enabled: boolean;
	labels: string[];
}

export function getConsentReceiptGateConfig(): ConsentReceiptGateConfig {
	const validation = loadConfig().validation;
	const labels =
		validation?.consentLabels && validation.consentLabels.length > 0
			? validation.consentLabels
			: DEFAULT_CONSENT_LABELS;
	return { enabled: validation?.consentReceiptGate === true, labels };
}

/** Consent labels present in `names`, matched case-insensitively. */
export function consentLabelsIn(
	names: readonly string[],
	consentLabels: readonly string[],
): string[] {
	const wanted = new Set(consentLabels.map((label) => label.toLowerCase()));
	return names.filter((name) => wanted.has(name.trim().toLowerCase()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseReceiptJson(raw: string): unknown {
	return JSON.parse(
		raw.replace(/\\(.)/g, (sequence: string, character: string) =>
			JSON_ESCAPE_CHARACTERS.has(character) ? sequence : character,
		),
	);
}

/** First structural problem with a parsed receipt, or `null` when valid. */
function receiptError(value: unknown): string | null {
	if (!isRecord(value)) return "receipt is not a JSON object";
	if (value.policyVersion !== INTAKE_POLICY_VERSION) {
		return "unsupported policy version";
	}
	if (value.decision !== "automatic-implementation") {
		return `receipt decision is ${JSON.stringify(value.decision)}, not "automatic-implementation"`;
	}
	const capabilities = value.capabilities;
	if (!Array.isArray(capabilities) || capabilities.length === 0) {
		return "capabilities must be a non-empty array";
	}
	const allowed = new Set(["manual-review", "automatic-implementation"]);
	if (
		capabilities.some(
			(capability) =>
				typeof capability !== "string" || !allowed.has(capability),
		) ||
		new Set(capabilities).size !== capabilities.length
	) {
		return "capabilities must be unique known values";
	}
	if (
		!capabilities.includes("manual-review") ||
		!capabilities.includes("automatic-implementation")
	) {
		return "capabilities must include manual-review and automatic-implementation";
	}
	if (
		typeof value.reason !== "string" ||
		value.reason.trim().length === 0 ||
		value.reason.length > 500
	) {
		return "reason must be a non-empty string of at most 500 characters";
	}
	const provenance = value.provenance;
	if (!isRecord(provenance)) return "provenance must be an object";
	if (
		provenance.source !== "issue-triage" &&
		provenance.source !== "sentry-registry"
	) {
		return "provenance.source is not recognized";
	}
	if (
		typeof provenance.actor !== "string" ||
		provenance.actor.trim().length === 0 ||
		provenance.actor.length > 160
	) {
		return "provenance.actor must be a non-empty string of at most 160 characters";
	}
	if (
		typeof provenance.issue !== "string" ||
		provenance.issue.length > 200 ||
		!isSafeText(provenance.issue) ||
		(provenance.source === "issue-triage" &&
			!LINEAR_ISSUE_RE.test(provenance.issue)) ||
		(provenance.source === "sentry-registry" &&
			!SENTRY_SOURCE_ISSUE_RE.test(provenance.issue))
	) {
		return "provenance.issue has an invalid shape";
	}
	if (
		typeof provenance.repo !== "string" ||
		provenance.repo.trim().length === 0 ||
		provenance.repo.length > 200 ||
		!isSafeText(provenance.repo)
	) {
		return "provenance.repo must be a non-empty safe string of at most 200 characters";
	}
	return null;
}

export type ConsentReceiptEvaluation =
	| { ok: true }
	| { ok: false; problem: string };

/**
 * Does `description` carry exactly one valid automatic-implementation receipt
 * for `identifier`? An `issue-triage` receipt must name this issue; a receipt
 * copied from another issue is not consent for this one.
 */
export function evaluateConsentReceipt(
	description: string,
	identifier: string,
): ConsentReceiptEvaluation {
	const matches = [...description.matchAll(RECEIPT_RE)];
	if (matches.length === 0) {
		return {
			ok: false,
			problem: "the description has no el-intake-decision:v1 receipt",
		};
	}
	if (matches.length > 1) {
		return {
			ok: false,
			problem:
				"the description has more than one el-intake-decision:v1 receipt",
		};
	}
	let parsed: unknown;
	try {
		parsed = parseReceiptJson(matches[0]?.[1] ?? "");
	} catch {
		return { ok: false, problem: "the receipt is not valid JSON" };
	}
	const error = receiptError(parsed);
	if (error) {
		return { ok: false, problem: `the receipt is invalid: ${error}` };
	}
	const provenance = (parsed as { provenance: Record<string, string> })
		.provenance;
	if (
		provenance.source === "issue-triage" &&
		provenance.issue.toUpperCase() !== identifier.toUpperCase()
	) {
		return {
			ok: false,
			problem: `the receipt names ${provenance.issue}, not ${identifier}`,
		};
	}
	return { ok: true };
}

function receiptTemplate(identifier: string): string {
	return `<!-- el-intake-decision:v1 {"policyVersion":"${INTAKE_POLICY_VERSION}","decision":"automatic-implementation","capabilities":["manual-review","automatic-implementation"],"reason":"<why unattended work is consented>","provenance":{"source":"issue-triage","actor":"<your name>","issue":"${identifier}","repo":"<namespace/repo>"}} -->`;
}

/** Refusal for `issues create` carrying a consent label. */
export function formatCreateConsentRefusal(labels: readonly string[]): string {
	const names = labels.map((label) => `"${label}"`).join(", ");
	return `Label ${names} is consent for unattended work and requires an el-intake-decision:v1 receipt naming the issue, which cannot exist before the issue does. Create the issue without ${names}, then apply it with the receipt in one update:\n\n  el-linear issues update <ID> --labels ${labels.join(",")} --description-file <body-with-receipt>\n\nwhere the body ends with:\n\n${receiptTemplate("<ID>")}`;
}

/** Refusal for `issues update` applying a consent label without a receipt. */
export function formatUpdateConsentRefusal(
	labels: readonly string[],
	identifier: string,
	problem: string,
): string {
	const names = labels.map((label) => `"${label}"`).join(", ");
	return `Label ${names} is consent for unattended work and requires an el-intake-decision:v1 receipt for ${identifier}, but ${problem}. Include the receipt in the same update (--description / --description-file / --append-description), e.g.:\n\n${receiptTemplate(identifier)}`;
}
