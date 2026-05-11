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

// Header forms accepted:
//   `# ... `, `## ...`, `### ...`, ... up to `######`
//   `**Done when**`, `**Done when:**` (bold pseudo-headers)
// Trailing colons after the header text are stripped.
const ATX_HEADER_RE = /^(?:#{1,6})\s+([^\n]+?)(?::\s*)?\s*$/;
const BOLD_PSEUDO_HEADER_RE = /^\*\*([^*\n]+?)(?::\s*)?\*\*\s*$/;

// Fenced code block delimiters per CommonMark: at least three backticks or
// tildes at the start of a line. We toggle an inFence flag while scanning so
// section headers inside code samples don't terminate the real section.
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;

function normalize(s: string): string {
	return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// Bold pseudo-header heuristic: any `**...**` line could be a header, but
// inline emphasis paragraphs (e.g. a single bolded sentence in prose) are
// false positives. Require either a trailing colon OR ≤6 words so that
// "**Done when:**" and "**Why we need this**" qualify but "**Note that all
// downstream consumers ...**" does not.
function isLikelyBoldHeader(text: string, hadTrailingColon: boolean): boolean {
	if (hadTrailingColon) return true;
	const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
	return wordCount > 0 && wordCount <= 6;
}

interface HeaderMatch {
	text: string;
}

function matchHeader(line: string): HeaderMatch | null {
	const atx = line.match(ATX_HEADER_RE);
	if (atx) return { text: atx[1] };
	const bold = line.match(BOLD_PSEUDO_HEADER_RE);
	if (bold) {
		const text = bold[1];
		// match[1] excludes the bold delimiters; the regex consumed a trailing
		// colon if present, so detect by re-checking the raw line.
		const hadColon = /:\*\*\s*$/.test(line);
		if (!isLikelyBoldHeader(text, hadColon)) return null;
		return { text };
	}
	return null;
}

export function extractField(body: string, fieldName: string): string | null {
	if (!body) return null;
	const target = normalize(fieldName);
	const lines = body.split("\n");

	let inFence = false;
	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (FENCE_RE.test(lines[i])) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const match = matchHeader(lines[i]);
		if (!match) continue;
		if (normalize(match.text) === target) {
			startIdx = i + 1;
			break;
		}
	}
	if (startIdx === -1) return null;

	const out: string[] = [];
	let sectionInFence = false;
	for (let i = startIdx; i < lines.length; i++) {
		if (FENCE_RE.test(lines[i])) {
			sectionInFence = !sectionInFence;
			out.push(lines[i]);
			continue;
		}
		if (!sectionInFence && matchHeader(lines[i]) !== null) break;
		out.push(lines[i]);
	}
	return out.join("\n").trim();
}
