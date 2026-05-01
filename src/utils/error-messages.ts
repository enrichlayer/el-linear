export function notFoundError(
	entityType: string,
	identifier: string,
	context?: string,
	hint?: string,
): Error {
	const contextStr = context ? ` ${context}` : "";
	const hintStr = hint ? ` ${hint}` : "";
	return new Error(
		`${entityType} "${identifier}"${contextStr} not found.${hintStr}`,
	);
}

export function multipleMatchesError(
	entityType: string,
	identifier: string,
	matches: string[],
	disambiguation: string,
): Error {
	const matchList = matches.join(", ");
	return new Error(
		`Multiple ${entityType}s found matching "${identifier}". ` +
			`Candidates: ${matchList}. ` +
			`Please ${disambiguation}.`,
	);
}

export function invalidParameterError(
	parameter: string,
	reason: string,
): Error {
	return new Error(`Invalid ${parameter}: ${reason}`);
}

export function requiresParameterError(
	flag: string,
	requiredFlag: string,
): Error {
	return new Error(`${flag} requires ${requiredFlag} to be specified`);
}
