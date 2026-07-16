/**
 * Guard against overwriting an issue body with the issue's own JSON envelope.
 *
 * `issues get/read --format json` emits `JSON.stringify(transformIssueData(...))`
 * — an object shaped `{ id, identifier, url, title, description, branchName,
 * state, assignee, ... }`. Feeding that straight back into
 * `issues update <ID> --description "$(... get <ID> --format json)"` (or the
 * equivalent create) silently replaces the real markdown with the stringified
 * envelope. Re-running on an already-corrupted issue re-wraps it, producing
 * envelope-inside-envelope — so the damage deepens and recurs.
 *
 * This detector spots the envelope signature so the create/update path can
 * block it with an actionable error. It is deliberately conservative: a plain
 * markdown body never parses to an object carrying `identifier` plus an
 * issue-only sibling key, so real descriptions pass untouched.
 *
 * See DEV-6315 (and the two victims it recovered, DEV-6092 / DEV-6042).
 */

/** Strong issue-envelope keys that, alongside `identifier`, distinguish the
 * CLI output from unrelated ticket JSON. `description` is deliberately absent:
 * `{ identifier, description }` is common enough outside Linear to avoid a
 * false positive, while real `issues get` output always carries `url` and
 * normally also `state` / `branchName`. */
const ENVELOPE_SIBLING_KEYS = ["branchName", "state", "url"];

export interface IssueEnvelopeMatch {
	/** The `identifier` field carried by the detected envelope (e.g. "DEV-123"). */
	identifier: string;
	/** UUID carried by the envelope, when present. Used for self-match messages. */
	id?: string;
	/** Linear URL carried by the envelope, when present. */
	url?: string;
	/** True when the envelope's `description` is itself a nested envelope — the
	 * double-nesting signature of a re-corrupted body. */
	nested: boolean;
}

/**
 * Return a match when `text` parses as an issue-envelope JSON object, else null.
 *
 * An envelope is an object with a string `identifier` AND at least one of
 * {@link ENVELOPE_SIBLING_KEYS}. Non-JSON text, JSON that isn't an object, and
 * JSON objects without the signature all return null.
 */
export function detectIssueEnvelope(text: string): IssueEnvelopeMatch | null {
	const trimmed = text.trim();
	// Cheap prefilter: an envelope is a JSON object literal. Skips the parse for
	// the overwhelmingly common markdown case.
	if (!trimmed.startsWith("{")) {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}

	const obj = parsed as Record<string, unknown>;
	if (typeof obj.identifier !== "string" || obj.identifier.length === 0) {
		return null;
	}
	const hasSibling = ENVELOPE_SIBLING_KEYS.some((key) => key in obj);
	if (!hasSibling) {
		return null;
	}

	const nested =
		typeof obj.description === "string" &&
		detectIssueEnvelope(obj.description) !== null;

	return {
		identifier: obj.identifier,
		...(typeof obj.id === "string" ? { id: obj.id } : {}),
		...(typeof obj.url === "string" ? { url: obj.url } : {}),
		nested,
	};
}

/** Whether a raw CLI target (identifier, UUID, or Linear URL) names `match`. */
function isSameIssueTarget(
	match: IssueEnvelopeMatch,
	targetIssueRef: string | undefined,
): boolean {
	if (!targetIssueRef) {
		return false;
	}
	const target = targetIssueRef.toLowerCase();
	if (
		target === match.identifier.toLowerCase() ||
		(match.id !== undefined && target === match.id.toLowerCase()) ||
		(match.url !== undefined && target === match.url.toLowerCase())
	) {
		return true;
	}
	// Linear issue URLs carry the canonical identifier as a path segment.
	return target.split(/[/?#]/).includes(match.identifier.toLowerCase());
}

/**
 * Throw an actionable error when `text` looks like an issue's own JSON
 * envelope being used as a description body. No-op otherwise, or when the
 * caller passed the audited `--allow-json-description` override.
 *
 * `context` carries the audited override and, when known, the raw update target
 * (identifier, UUID, or URL) so the message can flag the exact self-overwrite
 * case without making a network request.
 */
export function assertNotIssueEnvelope(
	text: string | undefined,
	context: { allow?: boolean; targetIssueRef?: string } = {},
): void {
	if (!text || context.allow) {
		return;
	}
	const match = detectIssueEnvelope(text);
	if (!match) {
		return;
	}

	const isSelf = isSameIssueTarget(match, context.targetIssueRef);
	const selfNote = isSelf
		? ` This is ${match.identifier}'s own envelope — the update would overwrite its body with itself.`
		: "";
	const nestedNote = match.nested
		? " (It is already a doubly-nested envelope — a sign this body was corrupted by an earlier run.)"
		: "";

	throw new Error(
		`Refusing to write a description that looks like an issue's JSON envelope ` +
			`(a "${match.identifier}" object with an issue-only field such as branchName/state/url).${selfNote}${nestedNote}\n` +
			`This is almost always an "issues get --format json" output accidentally piped into --description — ` +
			`which silently destroys the real body (DEV-6315). ` +
			`Pass a markdown body via --description-file <path>, or, if you genuinely mean to store this JSON, ` +
			`re-run with --allow-json-description.`,
	);
}
