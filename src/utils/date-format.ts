/** Convert a date-like value to an ISO string, falling back to the current time. */
export function toISOStringOrNow(
	value: string | Date | null | undefined,
): string {
	return value ? new Date(value).toISOString() : new Date().toISOString();
}

/** Convert a date-like value to an ISO string, or return undefined if absent. */
export function toISOStringOrUndefined(
	value: string | Date | null | undefined,
): string | undefined {
	return value ? new Date(value).toISOString() : undefined;
}
