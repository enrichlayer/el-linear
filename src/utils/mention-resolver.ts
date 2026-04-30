import { loadConfig } from "../config/config.js";
import { resolveMember } from "../config/resolver.js";
import type { LinearService } from "./linear-service.js";
import type { ProseMirrorNode } from "./markdown-prosemirror.js";
import { markdownToProseMirror } from "./markdown-prosemirror.js";
import { isUuid } from "./uuid.js";

const EXPLICIT_MENTION_REGEX = /@(\w+)/g;
const WHITESPACE_SPLIT_REGEX = /\s+/;
const FENCED_CODE_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`[^`]+`/g;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

export interface ResolveMentionsOptions {
	/**
	 * When true, bare capitalized-word references matching known config members
	 * are auto-converted to mentions. Default: true.
	 */
	autoMention?: boolean;
	/**
	 * UUID of the commenting user. Bare references that resolve to this UUID
	 * are skipped (you shouldn't @-mention yourself).
	 */
	selfUserId?: string;
}

interface ResolvedMention {
	label: string;
	userId: string;
}

/**
 * Resolve mentions in markdown body text to Linear user IDs.
 *
 * Explicit `@name` tokens are always resolved via config aliases, full names,
 * and platform handles — falling back to the Linear API.
 *
 * When `autoMention` is true (default), bare capitalized-word references that
 * match a known config member (alias or first-name/last-name of a fullName)
 * are also converted to mentions — without requiring the `@` prefix. This
 * catches cases like "Bob owns the design" → "@bob owns the design".
 *
 * Returns a ProseMirror `bodyData` doc with `suggestion_userMentions` nodes,
 * or `null` if nothing was resolved.
 */
export async function resolveMentions(
	body: string,
	linearService: LinearService,
	options: ResolveMentionsOptions = {},
): Promise<{ bodyData: ProseMirrorNode } | null> {
	const autoMention = options.autoMention !== false;
	const selfUserId = options.selfUserId;

	// 1. Resolve explicit @name mentions (existing behavior).
	const explicit = new Map<string, ResolvedMention>();
	const explicitNames = [...body.matchAll(EXPLICIT_MENTION_REGEX)].map(
		(m) => m[1],
	);
	for (const name of new Set(explicitNames)) {
		const userId = await resolveUserByName(name, linearService);
		if (userId) {
			explicit.set(name, { userId, label: name });
		}
	}

	// 2. Bare-name mentions: scan for candidate names that actually appear as
	//    standalone words in the body (outside code / link contexts).
	//    Config-only — no API fallback — so false positives stay bounded.
	const bare = new Map<string, ResolvedMention>();
	if (autoMention) {
		const stripped = stripCodeAndLinks(body);
		for (const candidate of getBareMentionCandidates()) {
			const pattern = new RegExp(`\\b${escapeRegex(candidate)}\\b`);
			if (!pattern.test(stripped)) {
				continue;
			}
			const userId = resolveMemberLocal(candidate);
			if (!userId) {
				continue;
			}
			if (selfUserId && userId === selfUserId) {
				continue;
			}
			bare.set(candidate, { userId, label: candidate });
		}
	}

	if (explicit.size === 0 && bare.size === 0) {
		return null;
	}

	const doc = markdownToProseMirror(body);
	const bodyData = injectMentions(doc, explicit, bare);
	return { bodyData };
}

async function resolveUserByName(
	name: string,
	linearService: LinearService,
): Promise<string | null> {
	const configResult = resolveMember(name);
	if (isUuid(configResult)) {
		return configResult;
	}
	try {
		return await linearService.resolveUserId(name);
	} catch {
		return null;
	}
}

/**
 * Config-only resolution (no API fallback). Used for bare-mention detection,
 * where matching a random word against the API would risk false positives.
 */
function resolveMemberLocal(name: string): string | null {
	const result = resolveMember(name);
	return isUuid(result) ? result : null;
}

/**
 * Build the list of candidate names for bare-mention detection from config:
 * - alias keys ("bob", "erin", "carol")
 * - uuids keys (short display names like "Bob", "David")
 * - every space-separated token of every fullName (so "Surkov" resolves too)
 *
 * Each candidate is returned capitalized (first letter upper, rest lower) —
 * text matches use word boundaries and the capitalization is a proper-noun
 * signal that filters out code/keyword matches.
 */
function getBareMentionCandidates(): string[] {
	const config = loadConfig();
	const candidates = new Set<string>();

	for (const alias of Object.keys(config.members.aliases)) {
		candidates.add(capitalize(alias));
	}
	for (const name of Object.keys(config.members.uuids)) {
		candidates.add(capitalize(name));
	}
	for (const fullName of Object.values(config.members.fullNames)) {
		for (const part of fullName.split(WHITESPACE_SPLIT_REGEX)) {
			if (part.length >= 3) {
				candidates.add(capitalize(part));
			}
		}
	}

	return [...candidates];
}

function capitalize(s: string): string {
	if (s.length === 0) {
		return s;
	}
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Remove fenced code blocks, inline code, and link text/URLs from the body
 * so the bare-name scan doesn't match inside them. This is a conservative
 * pre-filter — the ProseMirror-walk injection still skips these contexts at
 * emit time, but pre-filtering keeps the bare map from recording candidates
 * that wouldn't actually be converted.
 */
function stripCodeAndLinks(body: string): string {
	return body
		.replace(FENCED_CODE_REGEX, "")
		.replace(INLINE_CODE_REGEX, "")
		.replace(MARKDOWN_LINK_REGEX, "");
}

/**
 * Walk a ProseMirror document tree and replace @name + bare name references
 * with mention nodes.
 */
function injectMentions(
	doc: ProseMirrorNode,
	explicit: Map<string, ResolvedMention>,
	bare: Map<string, ResolvedMention>,
): ProseMirrorNode {
	if (!doc.content) {
		return doc;
	}

	return {
		...doc,
		content: doc.content.map((node) => {
			if (node.content && node.type !== "codeBlock") {
				const processed = injectMentions(node, explicit, bare);
				if (node.type === "paragraph" || node.type === "heading") {
					return {
						...processed,
						content: processed.content?.flatMap((child) =>
							splitMentions(child, explicit, bare),
						),
					};
				}
				return processed;
			}
			return node;
		}),
	};
}

/**
 * Split a text node on mention matches. Non-text nodes and code/link-marked
 * nodes pass through unchanged — link text like "[Dima's doc](url)" is an
 * explicit label, not a team reference.
 */
function splitMentions(
	node: ProseMirrorNode,
	explicit: Map<string, ResolvedMention>,
	bare: Map<string, ResolvedMention>,
): ProseMirrorNode[] {
	if (node.type !== "text" || !node.text) {
		return [node];
	}
	if (node.marks?.some((m) => m.type === "code" || m.type === "link")) {
		return [node];
	}

	const combinedRegex = buildCombinedRegex(explicit, bare);
	if (!combinedRegex) {
		return [node];
	}

	const result: ProseMirrorNode[] = [];
	let lastIndex = 0;
	combinedRegex.lastIndex = 0;
	let match: RegExpExecArray | null = combinedRegex.exec(node.text);

	while (match !== null) {
		const raw = match[0];
		const resolved = raw.startsWith("@")
			? explicit.get(raw.slice(1))
			: bare.get(raw);

		if (!resolved) {
			match = combinedRegex.exec(node.text);
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
			attrs: { id: resolved.userId, label: resolved.label },
		});

		lastIndex = match.index + raw.length;
		match = combinedRegex.exec(node.text);
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

/**
 * Build a single regex that matches either an explicit `@name` or any bare
 * candidate name as a whole word. Returns null when both maps are empty.
 *
 * Bare names are anchored with `\b` so "Dima" inside "Dimadex" doesn't match.
 * Longest candidates come first so multi-word names win over prefixes.
 */
function buildCombinedRegex(
	explicit: Map<string, ResolvedMention>,
	bare: Map<string, ResolvedMention>,
): RegExp | null {
	const parts: string[] = [];

	if (explicit.size > 0) {
		parts.push("@\\w+");
	}

	if (bare.size > 0) {
		const alternation = [...bare.keys()]
			.sort((a, b) => b.length - a.length)
			.map(escapeRegex)
			.join("|");
		parts.push(`\\b(?:${alternation})\\b`);
	}

	if (parts.length === 0) {
		return null;
	}
	return new RegExp(parts.join("|"), "g");
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
