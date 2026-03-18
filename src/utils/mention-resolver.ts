import { resolveMember } from "../config/resolver.js";
import type { LinearService } from "./linear-service.js";
import type { ProseMirrorNode } from "./markdown-prosemirror.js";
import { markdownToProseMirror } from "./markdown-prosemirror.js";
import { isUuid } from "./uuid.js";

const MENTION_REGEX = /@(\w+)/g;

/**
 * Resolve @name mentions in markdown body text to Linear user IDs.
 * Returns ProseMirror bodyData with suggestion_userMentions nodes,
 * or null if no mentions were found/resolved.
 *
 * The markdown is first converted to a proper ProseMirror document
 * (preserving headings, lists, code blocks, etc.), then @mentions
 * are injected as suggestion_userMentions nodes.
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

  // Parse markdown into a proper ProseMirror document, then inject mentions
  const doc = markdownToProseMirror(body);
  const bodyData = injectMentions(doc, resolved);
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
 * Walk a ProseMirror document tree and replace @name text with mention nodes.
 */
function injectMentions(doc: ProseMirrorNode, mentions: Map<string, string>): ProseMirrorNode {
  if (!doc.content) {
    return doc;
  }

  return {
    ...doc,
    content: doc.content.map((node) => {
      // Recurse into container nodes (lists, blockquotes, list items, etc.)
      if (node.content && node.type !== "codeBlock") {
        const processed = injectMentions(node, mentions);
        // For nodes that contain inline content (paragraph, heading),
        // expand text nodes that contain @mentions
        if (node.type === "paragraph" || node.type === "heading") {
          return {
            ...processed,
            content: processed.content?.flatMap((child) => splitMentions(child, mentions)),
          };
        }
        return processed;
      }
      return node;
    }),
  };
}

/**
 * If a text node contains @mentions, split it into text + mention nodes.
 * Non-text nodes and code-marked nodes pass through unchanged.
 */
function splitMentions(node: ProseMirrorNode, mentions: Map<string, string>): ProseMirrorNode[] {
  if (node.type !== "text" || !node.text) {
    return [node];
  }
  // Don't replace mentions inside inline code
  if (node.marks?.some((m) => m.type === "code")) {
    return [node];
  }

  const result: ProseMirrorNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(MENTION_REGEX.source, "g");
  let match: RegExpExecArray | null = regex.exec(node.text);

  while (match !== null) {
    const name = match[1];
    const userId = mentions.get(name);

    if (!userId) {
      match = regex.exec(node.text);
      continue;
    }

    if (match.index > lastIndex) {
      result.push({
        type: "text",
        text: node.text.slice(lastIndex, match.index),
        ...(node.marks ? { marks: node.marks } : {}),
      });
    }

    result.push({
      type: "suggestion_userMentions",
      attrs: { id: userId, label: name },
    });

    lastIndex = match.index + match[0].length;
    match = regex.exec(node.text);
  }

  if (lastIndex < node.text.length) {
    result.push({
      type: "text",
      text: node.text.slice(lastIndex),
      ...(node.marks ? { marks: node.marks } : {}),
    });
  }

  return result.length > 0 ? result : [node];
}
