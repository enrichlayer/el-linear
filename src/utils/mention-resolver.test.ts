import { describe, expect, it, vi } from "vitest";
import { resolveMentions } from "./mention-resolver.js";

const UUID_BOB = "a1a780e3-a411-466e-b6c8-0fe04ff355fa";
const UUID_DAVID = "b2b890f4-b522-477f-a7d9-1af15aa466ab";
const UUID_ERIN = "d4d012b6-d744-499b-c9fb-3fb37ff688fd";
const UUID_YURY = "e5e123c7-e855-4aac-d0fc-4fc48ff799fe";

vi.mock("../config/resolver.js", () => ({
	resolveMember: vi.fn((name: string) => {
		// Mirror the real resolver: alias keys, uuid keys, and partial matches on
		// fullName tokens all resolve to the same UUID.
		const known: Record<string, string> = {
			bob: UUID_BOB,
			bobby: UUID_BOB,
			marley: UUID_BOB,
			david: UUID_DAVID,
			doe: UUID_DAVID,
			erin: UUID_ERIN,
			rae: UUID_ERIN,
			smith: UUID_ERIN,
			юрий: UUID_YURY,
			tsukerman: UUID_YURY,
		};
		return known[name.toLowerCase()] ?? name;
	}),
}));

vi.mock("../config/config.js", () => ({
	loadConfig: vi.fn(() => ({
		members: {
			aliases: { bob: "Bob", rae: "Erin", юрий: "Юрий" },
			uuids: {
				Bob: UUID_BOB,
				David: UUID_DAVID,
				Erin: UUID_ERIN,
				Юрий: UUID_YURY,
			},
			fullNames: {
				[UUID_BOB]: "Bob Marley",
				[UUID_DAVID]: "David Doe",
				[UUID_ERIN]: "Erin Smith",
				[UUID_YURY]: "Юрий Tsukerman",
			},
			handles: {},
		},
	})),
}));

const UUID_ILYA = "c3c901a5-c633-488a-b8ea-2fa26ff577fc";

function mockLinearService() {
	return {
		resolveUserId: vi.fn(async (name: string) => {
			if (name === "ilya") {
				return UUID_ILYA;
			}
			throw new Error("not found");
		}),
	} as never;
}

describe("resolveMentions", () => {
	it("returns null when no mentions in text", async () => {
		const result = await resolveMentions(
			"No mentions here",
			mockLinearService(),
		);
		expect(result).toBeNull();
	});

	it("resolves explicit mentions with non-Latin (Cyrillic) names (ALL-935)", async () => {
		// Pre-fix: `@(\w+)` was ASCII-only, so `@Юрий` matched `@`
		// followed by zero word chars and produced no useful name.
		const result = await resolveMentions("cc @Юрий", mockLinearService());
		expect(result).not.toBeNull();
		const nodes = result!.bodyData!.content![0].content!;
		const mention = nodes.find((n) => n.type === "suggestion_userMentions");
		expect(mention?.attrs?.id).toBe(UUID_YURY);
	});

	it("resolves bare-name mentions for Cyrillic names (ALL-935)", async () => {
		// Bare-name detection used `\b...\b` which is ASCII-only.
		// Cyrillic chars don't sit on `\b` boundaries, so `Юрий` would
		// silently fail to match. The unicode-aware lookarounds fix this.
		const result = await resolveMentions(
			"Юрий please take a look",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const nodes = result!.bodyData!.content![0].content!;
		const mention = nodes.find((n) => n.type === "suggestion_userMentions");
		expect(mention?.attrs?.id).toBe(UUID_YURY);
	});

	it("resolves config-based mentions", async () => {
		const result = await resolveMentions(
			"Hey @bob check this",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const doc = result!.bodyData!;
		expect(doc.type).toBe("doc");
		expect(doc.content).toHaveLength(1);
		const paragraph = doc.content![0];
		expect(paragraph.type).toBe("paragraph");
		const nodes = paragraph.content!;
		expect(nodes).toHaveLength(3);
		expect(nodes[0]).toEqual({ type: "text", text: "Hey " });
		expect(nodes[1]).toEqual({
			type: "suggestion_userMentions",
			attrs: { id: "a1a780e3-a411-466e-b6c8-0fe04ff355fa", label: "bob" },
		});
		expect(nodes[2]).toEqual({ type: "text", text: " check this" });
	});

	it("resolves multiple mentions in one paragraph", async () => {
		const result = await resolveMentions(
			"@bob and @david please review",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const nodes = result!.bodyData!.content![0].content!;
		const mentionNodes = nodes.filter(
			(n) => n.type === "suggestion_userMentions",
		);
		expect(mentionNodes).toHaveLength(2);
		expect(mentionNodes[0].attrs!.id).toBe(
			"a1a780e3-a411-466e-b6c8-0fe04ff355fa",
		);
		expect(mentionNodes[1].attrs!.id).toBe(
			"b2b890f4-b522-477f-a7d9-1af15aa466ab",
		);
	});

	it("falls back to API resolution when config doesn't resolve", async () => {
		const service = mockLinearService();
		const result = await resolveMentions("CC @ilya", service);
		expect(result).not.toBeNull();
		const nodes = result!.bodyData!.content![0].content!;
		const mention = nodes.find((n) => n.type === "suggestion_userMentions");
		expect(mention?.attrs?.id).toBe("c3c901a5-c633-488a-b8ea-2fa26ff577fc");
	});

	it("reports an unresolved explicit @name (no bodyData, surfaced for warning)", async () => {
		const result = await resolveMentions(
			"Hey @unknown check",
			mockLinearService(),
		);
		// Previously returned null (silent drop). Now the failed explicit ping is
		// reported so the caller can warn — but bodyData stays null since nothing
		// resolved, and the comment ships as plain text.
		expect(result).not.toBeNull();
		expect(result!.bodyData).toBeNull();
		expect(result!.resolved).toEqual([]);
		expect(result!.unresolvedExplicit).toEqual(["unknown"]);
	});

	it("reports resolved mentions alongside an unresolved one", async () => {
		const result = await resolveMentions(
			"@bob owns it, cc @unknown",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		expect(result!.bodyData).not.toBeNull();
		expect(result!.resolved.map((m) => m.label)).toContain("bob");
		expect(result!.unresolvedExplicit).toEqual(["unknown"]);
	});

	it("returns null when there are no mentions at all", async () => {
		const result = await resolveMentions(
			"plain text only",
			mockLinearService(),
		);
		expect(result).toBeNull();
	});

	it("handles multiple paragraphs separated by blank lines", async () => {
		const result = await resolveMentions(
			"@bob first\n\n@david second",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		expect(result!.bodyData!.content).toHaveLength(2);
	});

	it("deduplicates mentions of the same user", async () => {
		const service = mockLinearService();
		const result = await resolveMentions("@bob see @bob comment", service);
		expect(result).not.toBeNull();
		const nodes = result!.bodyData!.content![0].content!;
		const mentions = nodes.filter((n) => n.type === "suggestion_userMentions");
		expect(mentions).toHaveLength(2);
		expect(mentions[0].attrs!.id).toBe("a1a780e3-a411-466e-b6c8-0fe04ff355fa");
		expect(mentions[1].attrs!.id).toBe("a1a780e3-a411-466e-b6c8-0fe04ff355fa");
	});

	it("preserves text around unresolved mentions", async () => {
		const result = await resolveMentions(
			"@unknown text @bob end",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const nodes = result!.bodyData!.content![0].content!;
		// @unknown should appear as plain text, @bob as mention
		const mentions = nodes.filter((n) => n.type === "suggestion_userMentions");
		expect(mentions).toHaveLength(1);
		expect(mentions[0].attrs!.label).toBe("bob");
	});
});

describe("resolveMentions — auto-mention for bare names", () => {
	it("auto-converts bare alias to mention (e.g. 'Bob')", async () => {
		const result = await resolveMentions(
			"Bob owns the design",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const mentions = result!.bodyData!.content![0].content!.filter(
			(n) => n.type === "suggestion_userMentions",
		);
		expect(mentions).toHaveLength(1);
		expect(mentions[0].attrs!.id).toBe(UUID_BOB);
		expect(mentions[0].attrs!.label).toBe("Bob");
	});

	it("auto-converts bare display name (e.g. 'Erin')", async () => {
		const result = await resolveMentions(
			"Erin's research concluded X",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const mentions = result!.bodyData!.content![0].content!.filter(
			(n) => n.type === "suggestion_userMentions",
		);
		expect(mentions).toHaveLength(1);
		expect(mentions[0].attrs!.id).toBe(UUID_ERIN);
	});

	it("auto-converts last name from fullName (e.g. 'Marley')", async () => {
		const result = await resolveMentions(
			"Marley will decide",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const mentions = result!.bodyData!.content![0].content!.filter(
			(n) => n.type === "suggestion_userMentions",
		);
		expect(mentions).toHaveLength(1);
		expect(mentions[0].attrs!.id).toBe(UUID_BOB);
	});

	it("combines explicit @mention and bare name", async () => {
		const result = await resolveMentions(
			"@bob and David should sync",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const mentions = result!.bodyData!.content![0].content!.filter(
			(n) => n.type === "suggestion_userMentions",
		);
		expect(mentions).toHaveLength(2);
		expect(mentions[0].attrs!.id).toBe(UUID_BOB);
		expect(mentions[1].attrs!.id).toBe(UUID_DAVID);
	});

	it("does not match lowercase 'bob' in prose", async () => {
		const result = await resolveMentions(
			"the bob parameter is fine",
			mockLinearService(),
		);
		expect(result).toBeNull();
	});

	it("does not match inside inline code", async () => {
		const result = await resolveMentions(
			"the `Bob` variable",
			mockLinearService(),
		);
		expect(result).toBeNull();
	});

	it("does not match inside code blocks", async () => {
		const result = await resolveMentions(
			"```\nconst Bob = 1;\n```",
			mockLinearService(),
		);
		expect(result).toBeNull();
	});

	it("does not match link text", async () => {
		const result = await resolveMentions(
			"see [Bob's doc](https://example.com)",
			mockLinearService(),
		);
		expect(result).toBeNull();
	});

	it("respects word boundaries (Bob inside Bobdex is skipped)", async () => {
		const result = await resolveMentions(
			"the Bobdex product",
			mockLinearService(),
		);
		expect(result).toBeNull();
	});

	it("skips self when selfUserId is provided", async () => {
		const result = await resolveMentions("Bob owns this", mockLinearService(), {
			selfUserId: UUID_BOB,
		});
		expect(result).toBeNull();
	});

	it("disables auto-conversion when autoMention is false", async () => {
		const result = await resolveMentions("Bob owns this", mockLinearService(), {
			autoMention: false,
		});
		expect(result).toBeNull();
	});

	it("still resolves explicit @mentions when autoMention is false", async () => {
		const result = await resolveMentions(
			"@bob owns this",
			mockLinearService(),
			{
				autoMention: false,
			},
		);
		expect(result).not.toBeNull();
		const mentions = result!.bodyData!.content![0].content!.filter(
			(n) => n.type === "suggestion_userMentions",
		);
		expect(mentions).toHaveLength(1);
	});

	it("does not duplicate a mention when both @bob and Bob appear", async () => {
		const result = await resolveMentions(
			"@bob and Bob are the same",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const mentions = result!.bodyData!.content![0].content!.filter(
			(n) => n.type === "suggestion_userMentions",
		);
		expect(mentions).toHaveLength(2);
		expect(mentions[0].attrs!.id).toBe(UUID_BOB);
		expect(mentions[1].attrs!.id).toBe(UUID_BOB);
	});
});

// DEV-3785: comment creation failed for long bodies containing @mentions.
// Root cause was schema-name drift in `markdown-prosemirror` — `bulletList` /
// `codeBlock` / `bold` / `italic` etc. were camelCase, but Linear's schema
// uses snake_case (`bullet_list`, `code_block`) and the marks `strong` /
// `em`. The error surfaced as "Invalid bodyData value" once a markdown
// element actually fired (longer bodies routinely contained lists / code /
// bold). The fix is to emit Linear-native names everywhere. These tests lock
// in the contract by exercising every node and mark type through the
// mention-injection path and asserting Linear-schema names appear.
describe("resolveMentions — DEV-3785 schema regression", () => {
	it("produces Linear-schema node names for a markdown-rich body with a mention", async () => {
		const body = [
			"# Setup",
			"",
			"@bob please run the following steps:",
			"",
			"- Install deps",
			"- Run **the build** with `pnpm build`",
			"- See the [README](https://example.com/readme)",
			"",
			"```bash",
			"pnpm install",
			"```",
			"",
			"---",
			"",
			"> A note: this is _important_.",
		].join("\n");

		const result = await resolveMentions(body, mockLinearService());
		expect(result).not.toBeNull();

		// Collect every `type` in the doc and assert none of them are the old
		// camelCase names. The renames are the regression we're locking in.
		const types = new Set<string>();
		const marks = new Set<string>();
		const walk = (node: {
			type: string;
			content?: unknown[];
			marks?: { type: string }[];
		}) => {
			types.add(node.type);
			if (node.marks) {
				for (const m of node.marks) marks.add(m.type);
			}
			if (Array.isArray(node.content)) {
				for (const child of node.content) {
					walk(child as Parameters<typeof walk>[0]);
				}
			}
		};
		walk(result!.bodyData! as Parameters<typeof walk>[0]);

		const forbidden = [
			"bulletList",
			"orderedList",
			"listItem",
			"codeBlock",
			"horizontalRule",
			"tableCell",
			"tableHeader",
			"tableRow",
		];
		for (const bad of forbidden) {
			expect(types.has(bad), `node type "${bad}" leaked into output`).toBe(
				false,
			);
		}
		expect(marks.has("bold"), 'mark "bold" leaked (should be "strong")').toBe(
			false,
		);
		expect(marks.has("italic"), 'mark "italic" leaked (should be "em")').toBe(
			false,
		);

		// Sanity-check that the Linear-native names ARE present.
		expect(types.has("bullet_list")).toBe(true);
		expect(types.has("code_block")).toBe(true);
		expect(types.has("horizontal_rule")).toBe(true);
		expect(marks.has("strong")).toBe(true);
		expect(marks.has("em")).toBe(true);

		// The mention itself still landed (proves the schema fix didn't break
		// mention injection through list / paragraph walking).
		expect(types.has("suggestion_userMentions")).toBe(true);
	});

	it("injects mentions inside list items alongside links + bold without empty text nodes (DEV-4306)", async () => {
		// DEV-4306 repro shape: a multi-element body (lists + bold + several
		// already-wrapped issue-ref links + bare-name mentions, one of them
		// *inside* a list item). The `comments update` path forced this through
		// the `bodyData` converter once auto-mention resolved a name; on the
		// stale npm build it surfaced as "Invalid bodyData value". Empirically,
		// current output is accepted by Linear on both create and update — this
		// locks the structure so future converter drift can't silently regress
		// it back to a fallback-to-plaintext (which drops the mention).
		const body = [
			"Status for Bob:",
			"",
			"- **Blocker:** [DEV-100](https://linear.app/acme/issue/DEV-100/) — Bob owns it",
			"- Linked [DEV-200](https://linear.app/acme/issue/DEV-200/) and [DEV-300](https://linear.app/acme/issue/DEV-300/)",
			"",
			"Related: [DEV-400](https://linear.app/acme/issue/DEV-400/), Erin to confirm.",
		].join("\n");

		const result = await resolveMentions(body, mockLinearService());
		expect(result).not.toBeNull();

		type Node = {
			type: string;
			text?: string;
			attrs?: Record<string, unknown>;
			marks?: { type: string }[];
			content?: Node[];
		};
		const mentions: Node[] = [];
		let mentionInsideListItem = false;
		const linkMarks: string[] = [];
		const walk = (node: Node, inListItem: boolean) => {
			if (node.type === "suggestion_userMentions") {
				mentions.push(node);
				if (inListItem) mentionInsideListItem = true;
			}
			// Linear's validator rejects empty text nodes — assert none slipped
			// in from the split-on-mention logic (e.g. a mention at a boundary).
			if (node.type === "text") {
				expect((node.text ?? "").length).toBeGreaterThan(0);
			}
			for (const m of node.marks ?? []) {
				if (m.type === "link") linkMarks.push(node.text ?? "");
			}
			for (const child of node.content ?? []) {
				walk(child, inListItem || node.type === "list_item");
			}
		};
		walk(result!.bodyData! as Node, false);

		// Both bare names resolved to mention nodes.
		const labels = mentions.map((m) => m.attrs?.label).sort();
		expect(labels).toEqual(["Bob", "Bob", "Erin"]);
		// Every mention is a content-less leaf carrying an id.
		for (const m of mentions) {
			expect(m.content).toBeUndefined();
			expect(m.attrs?.id).toBeTruthy();
		}
		// The whole point of DEV-4306: a mention landed *inside* a list item.
		expect(mentionInsideListItem).toBe(true);
		// Link marks survived the mention walk intact.
		expect(linkMarks.sort()).toEqual([
			"DEV-100",
			"DEV-200",
			"DEV-300",
			"DEV-400",
		]);
	});

	it("handles a long single-paragraph body with one mention (the original repro)", async () => {
		// Matches the DEV-3785 issue example almost verbatim — single
		// paragraph, one mention, no other markdown. Documented as the case
		// that originally surfaced the bug; left here so the repro stays
		// visible in the test names.
		const body =
			"@bob Here is a longer message with enough text to trigger the bug in prosemirror conversion.";
		const result = await resolveMentions(body, mockLinearService());
		expect(result).not.toBeNull();

		const paragraph = result!.bodyData!.content![0];
		expect(paragraph.type).toBe("paragraph");
		const children = paragraph.content!;
		expect(children[0].type).toBe("suggestion_userMentions");
		expect(children[0].attrs!.id).toBe(UUID_BOB);
		expect(children[1].type).toBe("text");
		expect((children[1].text as string).startsWith(" Here is a longer")).toBe(
			true,
		);
		// No empty text nodes — Linear's validator rejects them.
		for (const node of children) {
			if (node.type === "text") {
				expect((node.text as string).length).toBeGreaterThan(0);
			}
		}
	});
});
