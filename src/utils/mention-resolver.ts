import { resolveMember } from "../config/resolver.js";
import type { LinearService } from "./linear-service.js";
import { isUuid } from "./uuid.js";

const MENTION_REGEX = /@(\w+)/g;

interface ProseMirrorNode {
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  text?: string;
  type: string;
}

/**
 * Resolve @name mentions in markdown body text to Linear user IDs.
 * Returns ProseMirror bodyData with suggestion_userMentions nodes,
 * or null if no mentions were found/resolved.
 */
export async function resolveMentions(
  body: string,
  linearService: LinearService,
): Promise<{ bodyData: ProseMirrorNode } | null> {
  const mentionNames = [...body.matchAll(MENTION_REGEX)].map((m) => m[1]);
  if (mentionNames.length === 0) {
    return null;
  }

  // Deduplicate names
  const uniqueNames = [...new Set(mentionNames)];

  // Resolve each name to a user ID
  const resolved = new Map<string, string>();
  for (const name of uniqueNames) {
    const userId = await resolveUserByName(name, linearService);
    if (userId) {
      resolved.set(name, userId);
    }
  }

  if (resolved.size === 0) {
    return null;
  }

  const bodyData = buildBodyData(body, resolved);
  return { bodyData };
}

async function resolveUserByName(
  name: string,
  linearService: LinearService,
): Promise<string | null> {
  // Try config-based resolution first (fast, no API call)
  const configResult = resolveMember(name);
  if (isUuid(configResult)) {
    return configResult;
  }

  // Fall back to API resolution
  try {
    return await linearService.resolveUserId(name);
  } catch {
    return null;
  }
}

/**
 * Build ProseMirror document with mention nodes replacing @name tokens.
 */
function buildBodyData(body: string, mentions: Map<string, string>): ProseMirrorNode {
  const lines = body.split("\n");
  const content: ProseMirrorNode[] = [];

  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const text = paragraphLines.join("\n");
    const nodes = buildInlineContent(text, mentions);
    if (nodes.length > 0) {
      content.push({ type: "paragraph", content: nodes });
    }
    paragraphLines = [];
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flushParagraph();
    } else {
      paragraphLines.push(line);
    }
  }
  flushParagraph();

  return { type: "doc", content };
}

/**
 * Split text into text nodes and mention nodes around @name tokens.
 */
function buildInlineContent(text: string, mentions: Map<string, string>): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  let lastIndex = 0;

  const regex = new RegExp(MENTION_REGEX.source, "g");
  let match: RegExpExecArray | null = regex.exec(text);

  while (match !== null) {
    const name = match[1];
    const userId = mentions.get(name);

    if (!userId) {
      match = regex.exec(text);
      continue;
    }

    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    nodes.push({
      type: "suggestion_userMentions",
      attrs: { id: userId, label: name },
    });

    lastIndex = match.index + match[0].length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }

  return nodes;
}
