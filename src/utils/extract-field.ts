/**
 * Extract a named section from a Linear issue's markdown description.
 *
 * Linear issue bodies follow a small set of repeated structures —
 * "Why we need this", "Done when", "Scope", "Out of scope", etc. —
 * usually as `##` or `###` headers, sometimes as bold pseudo-headers
 * (`**Done when**`). Agents end up repeatedly piping
 * `el-linear issues read X | python -c '...desc.find("Done when")...'`
 * to pull one section out. This helper centralizes that.
 *
 * Matching is case-insensitive on the header text. The first matching
 * header wins. Content is everything between that header and the next
 * header line (any `#{1,6}` or bold pseudo-header at line start) or EOF,
 * trimmed of surrounding whitespace.
 *
 * Returns `null` when the field isn't found, so callers can distinguish
 * "missing" from "empty body".
 */

const HEADER_RE = /^(?:#{1,6}\s+|\*\*)([^*\n]+?)(?::\s*)?(?:\*\*)?\s*$/;

function normalize(s: string): string {
	return s.toLowerCase().trim().replace(/\s+/g, " ");
}

export function extractField(body: string, fieldName: string): string | null {
	if (!body) return null;
	const target = normalize(fieldName);
	const lines = body.split("\n");

	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(HEADER_RE);
		if (!match) continue;
		const headerText = normalize(match[1]);
		if (headerText === target) {
			startIdx = i + 1;
			break;
		}
	}
	if (startIdx === -1) return null;

	const out: string[] = [];
	for (let i = startIdx; i < lines.length; i++) {
		if (HEADER_RE.test(lines[i])) break;
		out.push(lines[i]);
	}
	return out.join("\n").trim();
}
