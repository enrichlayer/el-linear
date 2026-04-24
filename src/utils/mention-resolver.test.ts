import { describe, expect, it, vi } from "vitest";
import { resolveMentions } from "./mention-resolver.js";

const UUID_DIMA = "a1a780e3-a411-466e-b6c8-0fe04ff355fa";
const UUID_KAMAL = "b2b890f4-b522-477f-a7d9-1af15aa466ab";
const UUID_RAEFALDHI = "d4d012b6-d744-499b-c9fb-3fb37ff688fd";

vi.mock("../config/resolver.js", () => ({
  resolveMember: vi.fn((name: string) => {
    // Mirror the real resolver: alias keys, uuid keys, and partial matches on
    // fullName tokens all resolve to the same UUID.
    const known: Record<string, string> = {
      dima: UUID_DIMA,
      dmitrii: UUID_DIMA,
      surkov: UUID_DIMA,
      kamal: UUID_KAMAL,
      mahmudi: UUID_KAMAL,
      raefaldhi: UUID_RAEFALDHI,
      rae: UUID_RAEFALDHI,
      amartya: UUID_RAEFALDHI,
      junior: UUID_RAEFALDHI,
    };
    return known[name.toLowerCase()] ?? name;
  }),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    members: {
      aliases: { dima: "Dmitrii", rae: "Raefaldhi" },
      uuids: { Dmitrii: UUID_DIMA, Kamal: UUID_KAMAL, Raefaldhi: UUID_RAEFALDHI },
      fullNames: {
        [UUID_DIMA]: "Dmitrii Surkov",
        [UUID_KAMAL]: "Kamal Mahmudi",
        [UUID_RAEFALDHI]: "Raefaldhi Amartya Junior",
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
    const result = await resolveMentions("No mentions here", mockLinearService());
    expect(result).toBeNull();
  });

  it("resolves config-based mentions", async () => {
    const result = await resolveMentions("Hey @dima check this", mockLinearService());
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
      attrs: { id: "a1a780e3-a411-466e-b6c8-0fe04ff355fa", label: "dima" },
    });
    expect(nodes[2]).toEqual({ type: "text", text: " check this" });
  });

  it("resolves multiple mentions in one paragraph", async () => {
    const result = await resolveMentions("@dima and @kamal please review", mockLinearService());
    expect(result).not.toBeNull();
    const nodes = result!.bodyData.content![0].content!;
    const mentionNodes = nodes.filter((n) => n.type === "suggestion_userMentions");
    expect(mentionNodes).toHaveLength(2);
    expect(mentionNodes[0].attrs!.id).toBe("a1a780e3-a411-466e-b6c8-0fe04ff355fa");
    expect(mentionNodes[1].attrs!.id).toBe("b2b890f4-b522-477f-a7d9-1af15aa466ab");
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
    const result = await resolveMentions("Hey @unknown check", mockLinearService());
    expect(result).toBeNull();
  });

  it("handles multiple paragraphs separated by blank lines", async () => {
    const result = await resolveMentions("@dima first\n\n@kamal second", mockLinearService());
    expect(result).not.toBeNull();
    expect(result!.bodyData.content).toHaveLength(2);
  });

  it("deduplicates mentions of the same user", async () => {
    const service = mockLinearService();
    const result = await resolveMentions("@dima see @dima comment", service);
    expect(result).not.toBeNull();
    const nodes = result!.bodyData.content![0].content!;
    const mentions = nodes.filter((n) => n.type === "suggestion_userMentions");
    expect(mentions).toHaveLength(2);
    expect(mentions[0].attrs!.id).toBe("a1a780e3-a411-466e-b6c8-0fe04ff355fa");
    expect(mentions[1].attrs!.id).toBe("a1a780e3-a411-466e-b6c8-0fe04ff355fa");
  });

  it("preserves text around unresolved mentions", async () => {
    const result = await resolveMentions("@unknown text @dima end", mockLinearService());
    expect(result).not.toBeNull();
    const nodes = result!.bodyData.content![0].content!;
    // @unknown should appear as plain text, @dima as mention
    const mentions = nodes.filter((n) => n.type === "suggestion_userMentions");
    expect(mentions).toHaveLength(1);
    expect(mentions[0].attrs!.label).toBe("dima");
  });
});

describe("resolveMentions — auto-mention for bare names", () => {
  it("auto-converts bare alias to mention (e.g. 'Dima')", async () => {
    const result = await resolveMentions("Dima owns the design", mockLinearService());
    expect(result).not.toBeNull();
    const mentions = result!.bodyData.content![0].content!.filter(
      (n) => n.type === "suggestion_userMentions",
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0].attrs!.id).toBe(UUID_DIMA);
    expect(mentions[0].attrs!.label).toBe("Dima");
  });

  it("auto-converts bare display name (e.g. 'Raefaldhi')", async () => {
    const result = await resolveMentions("Raefaldhi's research concluded X", mockLinearService());
    expect(result).not.toBeNull();
    const mentions = result!.bodyData.content![0].content!.filter(
      (n) => n.type === "suggestion_userMentions",
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0].attrs!.id).toBe(UUID_RAEFALDHI);
  });

  it("auto-converts last name from fullName (e.g. 'Surkov')", async () => {
    const result = await resolveMentions("Surkov will decide", mockLinearService());
    expect(result).not.toBeNull();
    const mentions = result!.bodyData.content![0].content!.filter(
      (n) => n.type === "suggestion_userMentions",
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0].attrs!.id).toBe(UUID_DIMA);
  });

  it("combines explicit @mention and bare name", async () => {
    const result = await resolveMentions("@dima and Kamal should sync", mockLinearService());
    expect(result).not.toBeNull();
    const mentions = result!.bodyData.content![0].content!.filter(
      (n) => n.type === "suggestion_userMentions",
    );
    expect(mentions).toHaveLength(2);
    expect(mentions[0].attrs!.id).toBe(UUID_DIMA);
    expect(mentions[1].attrs!.id).toBe(UUID_KAMAL);
  });

  it("does not match lowercase 'dima' in prose", async () => {
    const result = await resolveMentions("the dima parameter is fine", mockLinearService());
    expect(result).toBeNull();
  });

  it("does not match inside inline code", async () => {
    const result = await resolveMentions("the `Dima` variable", mockLinearService());
    expect(result).toBeNull();
  });

  it("does not match inside code blocks", async () => {
    const result = await resolveMentions("```\nconst Dima = 1;\n```", mockLinearService());
    expect(result).toBeNull();
  });

  it("does not match link text", async () => {
    const result = await resolveMentions(
      "see [Dima's doc](https://example.com)",
      mockLinearService(),
    );
    expect(result).toBeNull();
  });

  it("respects word boundaries (Dima inside Dimadex is skipped)", async () => {
    const result = await resolveMentions("the Dimadex product", mockLinearService());
    expect(result).toBeNull();
  });

  it("skips self when selfUserId is provided", async () => {
    const result = await resolveMentions("Dima owns this", mockLinearService(), {
      selfUserId: UUID_DIMA,
    });
    expect(result).toBeNull();
  });

  it("disables auto-conversion when autoMention is false", async () => {
    const result = await resolveMentions("Dima owns this", mockLinearService(), {
      autoMention: false,
    });
    expect(result).toBeNull();
  });

  it("still resolves explicit @mentions when autoMention is false", async () => {
    const result = await resolveMentions("@dima owns this", mockLinearService(), {
      autoMention: false,
    });
    expect(result).not.toBeNull();
    const mentions = result!.bodyData.content![0].content!.filter(
      (n) => n.type === "suggestion_userMentions",
    );
    expect(mentions).toHaveLength(1);
  });

  it("does not duplicate a mention when both @dima and Dima appear", async () => {
    const result = await resolveMentions("@dima and Dima are the same", mockLinearService());
    expect(result).not.toBeNull();
    const mentions = result!.bodyData.content![0].content!.filter(
      (n) => n.type === "suggestion_userMentions",
    );
    expect(mentions).toHaveLength(2);
    expect(mentions[0].attrs!.id).toBe(UUID_DIMA);
    expect(mentions[1].attrs!.id).toBe(UUID_DIMA);
  });
});
