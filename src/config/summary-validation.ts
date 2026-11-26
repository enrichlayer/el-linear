/**
 * Summary validation — DEV-16785.
 *
 * An advisory create-time check that the issue description has a `Summary`
 * section: a short plain-language account of what the issue is about, for
 * readers outside the work. Presence is all it checks; whether a summary is
 * any good is a judgment the author keeps.
 *
 * OPT-IN and warn-only. Dormant unless a workspace config sets
 * `validation.summaryGate` to `"warn"`, and it never stops creation.
 */

import { extractField } from "../utils/extract-field.js";
import { loadConfig } from "./config.js";

export const SUMMARY_SECTION_HEADER = "Summary";

/** True only for an explicit `"warn"`; any other value leaves the check off. */
export function isSummaryGateEnabled(): boolean {
	const validation = loadConfig().validation;
	return validation?.enabled !== false && validation?.summaryGate === "warn";
}

/** A `## Summary` section exists, at any position and heading level. */
export function hasSummarySection(description: string): boolean {
	return extractField(description, SUMMARY_SECTION_HEADER) !== null;
}

export function formatSummaryWarning(): string {
	return (
		`Issue description has no "## ${SUMMARY_SECTION_HEADER}" section.\n` +
		"  Open it with a few plain-language sentences for readers outside the work:\n" +
		"  what this is about, why it matters or what was concluded, and what happens next."
	);
}
