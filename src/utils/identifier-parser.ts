interface ParsedIdentifier {
	issueNumber: number;
	teamKey: string;
}

export function parseIssueIdentifier(identifier: string): ParsedIdentifier {
	const parts = identifier.split("-");
	if (parts.length !== 2) {
		throw new Error(
			`Invalid issue identifier format: "${identifier}". Expected format: TEAM-123`,
		);
	}
	const teamKey = parts[0];
	const issueNumber = Number.parseInt(parts[1], 10);
	if (Number.isNaN(issueNumber)) {
		throw new Error(`Invalid issue number in identifier: "${identifier}"`);
	}
	return { teamKey, issueNumber };
}

export function tryParseIssueIdentifier(
	identifier: string,
): ParsedIdentifier | null {
	try {
		return parseIssueIdentifier(identifier);
	} catch {
		return null;
	}
}
