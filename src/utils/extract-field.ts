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
// tildes at the start of a line, with up to 3 leading SPACES of indent (4+
// is an indented code block, which is a different construct; tabs are not
// permitted as fence indent per the CommonMark spec). We toggle an inFence
// flag while scanning so section headers inside code samples don't
// terminate the real section.
const FENCE_DELIMITER_RE = /^ {0,3}([`~]{3,})(.*)$/;

interface FenceState {
	marker: "`" | "~";
	length: number;
}

function fenceDelimiter(line: string): { run: string; rest: string } | null {
	const match = line.match(FENCE_DELIMITER_RE);
	const run = match?.[1] ?? "";
	if (!run || new Set(run).size !== 1) return null;
	return { run, rest: match?.[2] ?? "" };
}

function openFence(line: string): FenceState | null {
	const delimiter = fenceDelimiter(line);
	if (!delimiter) return null;
	const marker = delimiter.run[0] as "`" | "~";
	// CommonMark forbids backticks in the info string of a backtick fence.
	if (marker === "`" && delimiter.rest.includes("`")) return null;
	return { marker, length: delimiter.run.length };
}

function closesFence(line: string, state: FenceState): boolean {
	const delimiter = fenceDelimiter(line);
	return (
		delimiter !== null &&
		delimiter.run[0] === state.marker &&
		delimiter.run.length >= state.length &&
		delimiter.rest.trim().length === 0
	);
}

/** Remove operative text inside CommonMark fenced code blocks, including an unclosed block through EOF. */
export function stripFencedCodeBlocks(body: string): string {
	const out: string[] = [];
	let fence: FenceState | null = null;
	for (const line of body.split("\n")) {
		if (fence) {
			if (closesFence(line, fence)) fence = null;
			continue;
		}
		const opened = openFence(line);
		if (opened) {
			fence = opened;
			continue;
		}
		out.push(line);
	}
	return out.join("\n");
}

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

/**
 * Multi-section variant of `extractField`. Extracts each requested section
 * by name in one call and returns a `{section -> text|null}` map preserving
 * the caller's order. Missing sections map to `null` so the caller can
 * distinguish "absent" from "empty" the same way `extractField` does.
 *
 * Each name is matched independently via `extractField` — semantics are
 * identical (first-match wins, case-insensitive, fenced-code-block aware).
 *
 * DEV-4479: this is the primitive behind `el-linear issues read --sections
 * "Done when,Out of scope"` so agents can pull several sections in one
 * call instead of N spawns. (The CLI flag landed as `--sections` rather
 * than `--fields` because `--fields` is already the program-level
 * output-key filter — see the option's `addHelpText` for context.)
 */
export function extractFields(
	body: string,
	fieldNames: readonly string[],
): Map<string, string | null> {
	const out = new Map<string, string | null>();
	for (const name of fieldNames) {
		out.set(name, extractField(body, name));
	}
	return out;
}

export function extractField(body: string, fieldName: string): string | null {
	if (!body) return null;
	const target = normalize(fieldName);
	const lines = body.split("\n");

	let fence: FenceState | null = null;
	let startIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (fence) {
			if (closesFence(lines[i], fence)) fence = null;
			continue;
		}
		const opened = openFence(lines[i]);
		if (opened) {
			fence = opened;
			continue;
		}
		const match = matchHeader(lines[i]);
		if (!match) continue;
		if (normalize(match.text) === target) {
			startIdx = i + 1;
			break;
		}
	}
	if (startIdx === -1) return null;

	const out: string[] = [];
	let sectionFence: FenceState | null = null;
	for (let i = startIdx; i < lines.length; i++) {
		if (sectionFence) {
			if (closesFence(lines[i], sectionFence)) sectionFence = null;
			out.push(lines[i]);
			continue;
		}
		const opened = openFence(lines[i]);
		if (opened) {
			sectionFence = opened;
			out.push(lines[i]);
			continue;
		}
		if (matchHeader(lines[i]) !== null) break;
		out.push(lines[i]);
	}
	return out.join("\n").trim();
}
