import { invalidParameterError } from "./error-messages.js";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePositiveInt(value: string, flagName: string): number {
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n) || n < 1) {
		throw invalidParameterError(
			flagName,
			`"${value}" is not a positive integer`,
		);
	}
	return n;
}

/**
 * Parse a single priority value (for `issues create --priority`, `issues update --priority`).
 *
 * Accepts:
 *   - keywords:  none | urgent | high | medium | normal | low
 *   - numbers:   0 (no priority), 1 (urgent), 2 (high), 3 (medium), 4 (low)
 */
export function validatePriority(value: string): number {
	const asName = PRIORITY_NAMES[value.toLowerCase()];
	if (asName !== undefined) {
		return asName;
	}
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n) || n < 0 || n > 4) {
		throw invalidParameterError(
			"--priority",
			`"${value}" is not valid. Use names (none, urgent, high, medium/normal, low) or numbers (0-4).`,
		);
	}
	return n;
}

export function validateHexColor(value: string): string {
	if (!HEX_COLOR_RE.test(value)) {
		throw invalidParameterError(
			"--color",
			`"${value}" is not a valid hex color. Use #RRGGBB format (e.g. #e06666).`,
		);
	}
	return value;
}

export function validateIsoDate(value: string): string {
	if (!ISO_DATE_RE.test(value)) {
		throw invalidParameterError(
			"--target-date",
			`"${value}" is not a valid date. Use YYYY-MM-DD format.`,
		);
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw invalidParameterError(
			"--target-date",
			`"${value}" is not a valid date.`,
		);
	}
	return value;
}

/**
 * Split a comma-separated list into trimmed, non-empty items.
 *
 * Accepts `undefined` so call sites can pipe through commander's
 * optional flag values without an explicit truthy guard. `false`
 * (commander's representation of `--no-foo`) and empty string both
 * resolve to `[]`.
 */
export function splitList(value: string | undefined | null | false): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

// Shared keyword → Linear priority number map. `none` and `0` mean "No priority"
// (Linear stores it as a real state, not absence). `1..4` are the rated priorities,
// `urgent` (1) being the highest.
const PRIORITY_NAMES: Record<string, number> = {
	none: 0,
	urgent: 1,
	high: 2,
	medium: 3,
	normal: 3,
	low: 4,
};

export function parsePriorityFilter(value: string): number[] {
	return splitList(value).map((item) => validatePriority(item));
}

export const PRIORITY_LABELS: Record<number, string> = {
	0: "No priority",
	1: "Urgent",
	2: "High",
	3: "Medium",
	4: "Low",
};
