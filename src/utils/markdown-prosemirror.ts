/**
 * Lightweight markdown → ProseMirror document converter.
 *
 * Handles the subset of markdown commonly used in Linear comments:
 * headings, bullet/ordered lists, code blocks, blockquotes, horizontal rules,
 * and inline marks (bold, italic, code, links).
 */

interface ProseMirrorMark {
  attrs?: Record<string, unknown>;
  type: string;
}

export interface ProseMirrorNode {
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: ProseMirrorMark[];
  text?: string;
  type: string;
}

// ── Block parsing ────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const BULLET_RE = /^[\t ]*[-*]\s+(.+)$/;
const ORDERED_RE = /^[\t ]*\d+[.)]\s+(.+)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^([-*_])\1{2,}\s*$/;
const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEP_RE = /^\|[\s:]*-{2,}[\s:]*(\|[\s:]*-{2,}[\s:]*)*\|$/;
const FENCE_OPEN_RE = /^```(\w*)$/;
const FENCE_CLOSE_RE = /^```\s*$/;

// Inline patterns (top-level for performance)
const INLINE_CODE_RE = /`([^`]+)`/;
const INLINE_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/;
const INLINE_BOLD_RE = /\*\*(.+?)\*\*|__(.+?)__/;
const INLINE_ITALIC_RE = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/;

interface ParseState {
  content: ProseMirrorNode[];
  i: number;
  lines: string[];
}

export function markdownToProseMirror(text: string): ProseMirrorNode {
  const state: ParseState = { lines: text.split("\n"), content: [], i: 0 };

  while (state.i < state.lines.length) {
    const line = state.lines[state.i];

    if (line.trim() === "") {
      state.i++;
      continue;
    }

    if (parseFencedCodeBlock(state, line)) {
      continue;
    }
    if (parseHorizontalRule(state, line)) {
      continue;
    }
    if (parseHeading(state, line)) {
      continue;
    }
    if (parseBulletList(state, line)) {
      continue;
    }
    if (parseOrderedList(state, line)) {
      continue;
    }
    if (parseBlockquote(state)) {
      continue;
    }
    if (parseTable(state, line)) {
      continue;
    }
    parseParagraph(state);
  }

  return { type: "doc", content: state.content };
}

function parseFencedCodeBlock(state: ParseState, line: string): boolean {
  const fenceMatch = line.match(FENCE_OPEN_RE);
  if (!fenceMatch) {
    return false;
  }

  const language = fenceMatch[1] || undefined;
  const codeLines: string[] = [];
  state.i++;
  while (state.i < state.lines.length && !FENCE_CLOSE_RE.test(state.lines[state.i])) {
    codeLines.push(state.lines[state.i]);
    state.i++;
  }
  state.i++; // skip closing fence
  const attrs: Record<string, unknown> = {};
  if (language) {
    attrs.language = language;
  }
  state.content.push({
    type: "codeBlock",
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    content: codeLines.length > 0 ? [{ type: "text", text: codeLines.join("\n") }] : undefined,
  });
  return true;
}

function parseHorizontalRule(state: ParseState, line: string): boolean {
  if (!HR_RE.test(line)) {
    return false;
  }
  state.content.push({ type: "horizontalRule" });
  state.i++;
  return true;
}

function parseHeading(state: ParseState, line: string): boolean {
  const headingMatch = line.match(HEADING_RE);
  if (!headingMatch) {
    return false;
  }
  state.content.push({
    type: "heading",
    attrs: { level: headingMatch[1].length },
    content: parseInline(headingMatch[2]),
  });
  state.i++;
  return true;
}

function parseBulletList(state: ParseState, line: string): boolean {
  if (!BULLET_RE.test(line)) {
    return false;
  }
  const items: ProseMirrorNode[] = [];
  while (state.i < state.lines.length && BULLET_RE.test(state.lines[state.i])) {
    const m = state.lines[state.i].match(BULLET_RE)!;
    items.push({ type: "listItem", content: [{ type: "paragraph", content: parseInline(m[1]) }] });
    state.i++;
  }
  state.content.push({ type: "bulletList", content: items });
  return true;
}

function parseOrderedList(state: ParseState, line: string): boolean {
  if (!ORDERED_RE.test(line)) {
    return false;
  }
  const items: ProseMirrorNode[] = [];
  while (state.i < state.lines.length && ORDERED_RE.test(state.lines[state.i])) {
    const m = state.lines[state.i].match(ORDERED_RE)!;
    items.push({ type: "listItem", content: [{ type: "paragraph", content: parseInline(m[1]) }] });
    state.i++;
  }
  state.content.push({ type: "orderedList", content: items });
  return true;
}

function parseBlockquote(state: ParseState): boolean {
  if (!BLOCKQUOTE_RE.test(state.lines[state.i])) {
    return false;
  }
  const quoteLines: string[] = [];
  while (state.i < state.lines.length && BLOCKQUOTE_RE.test(state.lines[state.i])) {
    const m = state.lines[state.i].match(BLOCKQUOTE_RE)!;
    quoteLines.push(m[1]);
    state.i++;
  }
  const inner = markdownToProseMirror(quoteLines.join("\n"));
  state.content.push({
    type: "blockquote",
    content:
      inner.content && inner.content.length > 0
        ? inner.content
        : [{ type: "paragraph", content: [] }],
  });
  return true;
}

function parseTable(state: ParseState, line: string): boolean {
  if (!TABLE_ROW_RE.test(line)) {
    return false;
  }
  // Peek ahead: a table needs at least a header row + separator row
  if (state.i + 1 >= state.lines.length || !TABLE_SEP_RE.test(state.lines[state.i + 1].trim())) {
    return false;
  }

  const rows: ProseMirrorNode[] = [];

  // Parse header row
  const headerCells = line.split("|").slice(1, -1).map(cell => cell.trim());
  rows.push({
    type: "tableRow",
    content: headerCells.map(cell => ({
      type: "tableHeader",
      content: [{ type: "paragraph", content: parseInline(cell) }],
    })),
  });
  state.i++; // header row
  state.i++; // separator row

  // Parse body rows
  while (state.i < state.lines.length && TABLE_ROW_RE.test(state.lines[state.i].trim())) {
    const cells = state.lines[state.i].split("|").slice(1, -1).map(cell => cell.trim());
    rows.push({
      type: "tableRow",
      content: cells.map(cell => ({
        type: "tableCell",
        content: [{ type: "paragraph", content: parseInline(cell) }],
      })),
    });
    state.i++;
  }

  state.content.push({ type: "table", content: rows });
  return true;
}

function isBlockStart(line: string): boolean {
  return (
    HEADING_RE.test(line) ||
    FENCE_OPEN_RE.test(line) ||
    HR_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line) ||
    BLOCKQUOTE_RE.test(line) ||
    TABLE_ROW_RE.test(line)
  );
}

function parseParagraph(state: ParseState): void {
  // Always consume the current line — the main loop has already determined no
  // block parser handled it. Skipping the first-line block-start check avoids
  // an infinite loop when a line looks like a block (e.g. table row) but fails
  // the stricter block parser (e.g. table row with no separator line).
  const paraLines: string[] = [state.lines[state.i]];
  state.i++;
  while (
    state.i < state.lines.length &&
    state.lines[state.i].trim() !== "" &&
    !isBlockStart(state.lines[state.i])
  ) {
    paraLines.push(state.lines[state.i]);
    state.i++;
  }
  const inlineNodes = parseInline(paraLines.join("\n"));
  if (inlineNodes.length > 0) {
    state.content.push({ type: "paragraph", content: inlineNodes });
  }
}

// ── Inline parsing ───────────────────────────────────────────────────

/**
 * Parse inline markdown (bold, italic, code, links) into ProseMirror nodes with marks.
 */
export function parseInline(text: string): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const candidate = findEarliestInlineMatch(remaining);

    if (!candidate) {
      nodes.push({ type: "text", text: remaining });
      break;
    }

    if (candidate.index > 0) {
      nodes.push({ type: "text", text: remaining.slice(0, candidate.index) });
    }

    nodes.push({
      type: "text",
      text: candidate.innerText,
      marks: candidate.marks,
    });

    remaining = remaining.slice(candidate.index + candidate.length);
  }

  return nodes;
}

interface InlineMatch {
  index: number;
  innerText: string;
  length: number;
  marks: ProseMirrorMark[];
}

function findEarliestInlineMatch(text: string): InlineMatch | null {
  const candidates: InlineMatch[] = [];

  const codeMatch = text.match(INLINE_CODE_RE);
  if (codeMatch) {
    candidates.push({
      index: codeMatch.index!,
      length: codeMatch[0].length,
      innerText: codeMatch[1],
      marks: [{ type: "code" }],
    });
  }

  const linkMatch = text.match(INLINE_LINK_RE);
  if (linkMatch) {
    candidates.push({
      index: linkMatch.index!,
      length: linkMatch[0].length,
      innerText: linkMatch[1],
      marks: [{ type: "link", attrs: { href: linkMatch[2] } }],
    });
  }

  const boldMatch = text.match(INLINE_BOLD_RE);
  if (boldMatch) {
    candidates.push({
      index: boldMatch.index!,
      length: boldMatch[0].length,
      innerText: boldMatch[1] ?? boldMatch[2],
      marks: [{ type: "bold" }],
    });
  }

  const italicMatch = text.match(INLINE_ITALIC_RE);
  if (italicMatch) {
    candidates.push({
      index: italicMatch.index!,
      length: italicMatch[0].length,
      innerText: italicMatch[1] ?? italicMatch[2],
      marks: [{ type: "italic" }],
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Return the earliest match; on tie, prefer the longer match (more specific)
  candidates.sort((a, b) => a.index - b.index || b.length - a.length);
  return candidates[0];
}
