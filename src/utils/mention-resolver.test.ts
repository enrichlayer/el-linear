import { describe, expect, it, vi } from "vitest";
import { resolveMentions } from "./mention-resolver.js";

const UUID_BOB = "a1a780e3-a411-466e-b6c8-0fe04ff355fa";
const UUID_DAVID = "b2b890f4-b522-477f-a7d9-1af15aa466ab";
const UUID_ERIN = "d4d012b6-d744-499b-c9fb-3fb37ff688fd";

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
		};
		return known[name.toLowerCase()] ?? name;
	}),
}));

vi.mock("../config/config.js", () => ({
	loadConfig: vi.fn(() => ({
		members: {
			aliases: { bob: "Bob", rae: "Erin" },
			uuids: { Bob: UUID_BOB, David: UUID_DAVID, Erin: UUID_ERIN },
			fullNames: {
				[UUID_BOB]: "Bob Marley",
				[UUID_DAVID]: "David Doe",
				[UUID_ERIN]: "Erin Smith",
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

	it("resolves config-based mentions", async () => {
		const result = await resolveMentions(
			"Hey @bob check this",
			mockLinearService(),
		);
		expect(result).not.toBeNull();
		const doc = result!.bodyData;
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
		const nodes = result!.bodyData.content![0].content!;
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
		const nodes = result!.bodyData.content![0].content!;
		const mention = nodes.find((n) => n.type === "suggestion_userMentions");
		expect(mention?.attrs?.id).toBe("c3c901a5-c633-488a-b8ea-2fa26ff577fc");
	});

	it("returns null when mentions exist but none resolve", async () => {
		const result = await resolveMentions(
			"Hey @unknown check",
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
		expect(result!.bodyData.content).toHaveLength(2);
	});

	it("deduplicates mentions of the same user", async () => {
		const service = mockLinearService();
		const result = await resolveMentions("@bob see @bob comment", service);
		expect(result).not.toBeNull();
		const nodes = result!.bodyData.content![0].content!;
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
		const nodes = result!.bodyData.content![0].content!;
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
		const mentions = result!.bodyData.content![0].content!.filter(
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
		const mentions = result!.bodyData.content![0].content!.filter(
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
		const mentions = result!.bodyData.content![0].content!.filter(
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
		const mentions = result!.bodyData.content![0].content!.filter(
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
		const mentions = result!.bodyData.content![0].content!.filter(
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
		const mentions = result!.bodyData.content![0].content!.filter(
			(n) => n.type === "suggestion_userMentions",
		);
		expect(mentions).toHaveLength(2);
		expect(mentions[0].attrs!.id).toBe(UUID_BOB);
		expect(mentions[1].attrs!.id).toBe(UUID_BOB);
	});
});
