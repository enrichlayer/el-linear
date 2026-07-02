/**
 * SOP-label parent validation — DEV-5378.
 *
 * The el-linear side of the SOP-system enforcement (parent ALL-1028). When an
 * issue carries an SOP-type label, it must point at a parent SOP so the
 * `el-sop landscape` catalog topology stays connected — an SOP with no parent
 * SOP is unfindable and breaks the tree. This turns the kaizen skill's Stage-4
 * "always give an SOP issue a parent SOP" prose rule into a deterministic
 * create-time gate, mirroring the DEV-4823 duplicate-detection gate.
 *
 * OPT-IN by design. el-linear is MIT and published on npm; most installs are
 * not Enrich Layer and have no SOP taxonomy. The gate is dormant unless
 * `validation.sopLabelParentGate: true` is set (the EL workspace flips it on in
 * its shared team config). This is the opposite of the duplicate-detection gate,
 * which defaults on — but the dup check is workspace-agnostic, whereas "SOP" is
 * an Enrich-Layer-specific label taxonomy that a fresh OSS install must not be
 * surprised by.
 */

import { loadConfig } from "./config.js";

/**
 * Default label names that mark an issue as an SOP. Overridable via
 * `config.validation.sopLabels`. Matched case-insensitively against the
 * issue's labels.
 */
export const DEFAULT_SOP_LABELS = ["SOP"];

export interface SopLabelGateConfig {
	/**
	 * Whether the gate is active. OPT-IN: only true when validation is not
	 * turned off AND `sopLabelParentGate` is explicitly `true`.
	 */
	enabled: boolean;
	/** The SOP label names in effect (config override or {@link DEFAULT_SOP_LABELS}). */
	sopLabels: string[];
}

/**
 * Resolve the SOP-label-parent-gate config from the merged el-linear config.
 *
 * The gate is dormant by default. It activates only when validation isn't
 * disabled (`validation.enabled !== false`) AND the operator has explicitly set
 * `validation.sopLabelParentGate: true`. An absent or empty `sopLabels` falls
 * back to {@link DEFAULT_SOP_LABELS}.
 */
export function getSopLabelGateConfig(): SopLabelGateConfig {
	const validation = loadConfig().validation;
	const enabled =
		validation?.enabled !== false && validation?.sopLabelParentGate === true;
	const sopLabels =
		validation?.sopLabels && validation.sopLabels.length > 0
			? validation.sopLabels
			: DEFAULT_SOP_LABELS;
	return { enabled, sopLabels };
}

/**
 * Case-insensitive membership test: does `labels` contain any of the configured
 * SOP label names? Returns false for an empty `labels` set.
 */
export function hasSopLabel(labels: string[], sopLabels: string[]): boolean {
	const wanted = new Set(sopLabels.map((l) => l.toLowerCase()));
	return labels.some((l) => wanted.has(l.toLowerCase()));
}

/**
 * Distinguish a reference that cleanly does NOT resolve to a real issue (a
 * typo'd or nonexistent `--parent` / `--related-to`) from a transport/service
 * failure (network, GraphQL 5xx, timeout).
 *
 * `getIssueById` throws a plain `Error` for both — this codebase has no error
 * `code` or subclass to switch on — so we key on the two message families it
 * produces for an *unresolvable reference*:
 *   - `notFoundError` → `… not found.`  (well-formed ref, no such issue)
 *   - `parseIssueIdentifier` → `Invalid issue identifier format: …` /
 *     `Invalid issue number in identifier: …`  (malformed ref)
 * Everything else — notably `GraphQL request failed: …` / `GraphQL query
 * failed` from `graphql-service` — is treated as transport and fails open.
 *
 * This is a correctness distinction, not just telemetry: an unresolvable
 * reference must BLOCK. Otherwise a typo'd `--related-to` on an SOP issue fails
 * open, the issue is created, and the *follow-up* `createRelations` throws —
 * leaving an orphan SOP on the board (the exact gap DEV-5378 cycle-1 caught). A
 * transport error must FAIL OPEN so infra trouble can't block legitimate work.
 */
export function isUnresolvableReferenceError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return (
		message.includes("not found.") ||
		message.includes("Invalid issue identifier format") ||
		message.includes("Invalid issue number in identifier")
	);
}

/**
 * Render the human/agent-facing block thrown when an SOP-labeled issue has no
 * SOP parent. `reason` distinguishes "no parent at all" from "one or more
 * references present but none resolves to an SOP-labeled issue", so the message
 * points at the exact fix. When some references couldn't be resolved at all,
 * `unresolvableRefs` names them (a typo'd ref reads differently from a real but
 * non-SOP parent). Names the rule and the `--allow-unparented-sop` escape hatch.
 */
export function formatSopParentBlock(opts: {
	sopLabels: string[];
	reason: "no-parent" | "no-sop-parent";
	parentRefs: string[];
	unresolvableRefs?: string[];
}): string {
	const sopList = opts.sopLabels.join(", ");
	const head =
		`SOP-labeled issue must point at a parent SOP (SOP label(s): ${sopList}).\n` +
		"  An SOP with no parent SOP is unfindable by `el-sop landscape` and breaks the catalog topology.\n";
	let detail: string;
	if (opts.reason === "no-parent") {
		detail =
			"  This issue has no --parent or --related-to. Add one that points at an SOP-labeled issue.\n";
	} else {
		detail = `  No referenced issue resolves to an SOP-labeled issue (referenced: ${opts.parentRefs.join(", ")}).\n`;
		if (opts.unresolvableRefs && opts.unresolvableRefs.length > 0) {
			detail += `  Could not resolve: ${opts.unresolvableRefs.join(", ")} — check the identifier exists.\n`;
		}
		detail +=
			"  Point --parent or --related-to at an existing SOP-labeled issue.\n";
	}
	const hatch =
		"  If this SOP is intentionally top-level, re-run with --allow-unparented-sop.";
	return head + detail + hatch;
}
