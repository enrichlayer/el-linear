const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PREFIX_REGEX = /^[0-9a-f]{8}$/i;

export function isUuid(value: string): boolean {
	return UUID_REGEX.test(value);
}

export function isUuidPrefix(value: string): boolean {
	return UUID_PREFIX_REGEX.test(value);
}
