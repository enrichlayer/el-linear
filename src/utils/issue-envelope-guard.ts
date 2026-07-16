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

/** Sibling keys that, alongside `identifier`, mark a value as an issue envelope
 * rather than a description that merely happens to be JSON. */
const ENVELOPE_SIBLING_KEYS = ["branchName", "state", "url", "description"];

export interface IssueEnvelopeMatch {
	/** The `identifier` field carried by the detected envelope (e.g. "DEV-123"). */
	identifier: string;
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

	return { identifier: obj.identifier, nested };
}

/**
 * Throw an actionable error when `text` looks like an issue's own JSON
 * envelope being used as a description body. No-op otherwise, or when the
 * caller passed the audited `--allow-json-description` override.
 *
 * `context` names the surface for the error ("create" / "update") and,
 * when known, the target identifier so the message can flag the exact
 * self-overwrite case.
 */
export function assertNotIssueEnvelope(
	text: string | undefined,
	context: { allow?: boolean; targetIdentifier?: string } = {},
): void {
	if (!text || context.allow) {
		return;
	}
	const match = detectIssueEnvelope(text);
	if (!match) {
		return;
	}

	const isSelf =
		context.targetIdentifier !== undefined &&
		context.targetIdentifier.toLowerCase() === match.identifier.toLowerCase();
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
