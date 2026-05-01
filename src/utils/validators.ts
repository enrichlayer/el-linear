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

export function validatePriority(value: string): number {
	const asName = PRIORITY_NAMES[value.toLowerCase()];
	if (asName !== undefined && asName >= 1) {
		return asName;
	}
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n) || n < 1 || n > 4) {
		throw invalidParameterError(
			"--priority",
			`"${value}" is not valid. Use names (urgent, high, medium/normal, low) or numbers (1-4).`,
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

export function splitList(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

const PRIORITY_NAMES: Record<string, number> = {
	none: 0,
	urgent: 1,
	high: 2,
	medium: 3,
	normal: 3,
	low: 4,
};

export function parsePriorityFilter(value: string): number[] {
	return splitList(value).map((item) => {
		const asName = PRIORITY_NAMES[item.toLowerCase()];
		if (asName !== undefined) {
			return asName;
		}
		const n = Number.parseInt(item, 10);
		if (Number.isNaN(n) || n < 0 || n > 4) {
			throw invalidParameterError(
				"--priority",
				`"${item}" is not valid. Use names (urgent, high, medium, low, none) or numbers (0-4).`,
			);
		}
		return n;
	});
}

export const PRIORITY_LABELS: Record<number, string> = {
	0: "No priority",
	1: "Urgent",
	2: "High",
	3: "Medium",
	4: "Low",
};
