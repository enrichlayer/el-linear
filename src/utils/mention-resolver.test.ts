import { describe, expect, it, vi } from "vitest";
import { resolveMentions } from "./mention-resolver.js";

vi.mock("../config/resolver.js", () => ({
  resolveMember: vi.fn((name: string) => {
    const known: Record<string, string> = {
      dima: "a1a780e3-a411-466e-b6c8-0fe04ff355fa",
      kamal: "b2b890f4-b522-477f-a7d9-1af15aa466ab",
    };
    return known[name.toLowerCase()] ?? name;
  }),
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
