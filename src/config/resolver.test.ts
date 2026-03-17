import { describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({
  loadConfig: () => ({
    teams: {
      DEV: "dev-uuid-123",
      FE: "fe-uuid-456",
    },
    teamAliases: {
      frontend: "FE",
      backend: "DEV",
      "front-end": "FE",
    },
    members: {
      aliases: {
        ytspar: "Yury",
        dima: "Dmitrii",
      },
      handles: {
        gitlab: {
          ytspar: "Yury",
          dmitriiiii: "Dmitrii",
        },
        github: {
          "yury-gh": "Yury",
        },
      },
      uuids: {
        Yury: "yury-uuid-789",
        Dmitrii: "dmitrii-uuid-012",
      },
    },
    labels: {
      workspace: {
        claude: "c1a0de00-0000-4000-8000-000000000001",
        bug: "b0900000-0000-4000-8000-000000000002",
      },
      teams: {
        DEV: {
          "tech-debt": "7ec4deb7-0000-4000-8000-000000000003",
          "truncated-label": "2acf31b1",
        },
        FE: {
          design: "de519000-0000-4000-8000-000000000004",
        },
      },
    },
  }),
}));

const { resolveTeam, resolveMember, resolveLabels } = await import("./resolver.js");

describe("resolveTeam", () => {
  it("returns UUID directly if input is UUID", () => {
    expect(resolveTeam("4b6bb89a-9348-4ab7-9e01-581040273998")).toBe(
      "4b6bb89a-9348-4ab7-9e01-581040273998",
    );
  });

  it("resolves team key to UUID (case-insensitive)", () => {
    expect(resolveTeam("dev")).toBe("dev-uuid-123");
    expect(resolveTeam("DEV")).toBe("dev-uuid-123");
    expect(resolveTeam("fe")).toBe("fe-uuid-456");
  });

  it("resolves team alias to UUID (case-insensitive)", () => {
    expect(resolveTeam("frontend")).toBe("fe-uuid-456");
    expect(resolveTeam("Frontend")).toBe("fe-uuid-456");
    expect(resolveTeam("FRONTEND")).toBe("fe-uuid-456");
    expect(resolveTeam("backend")).toBe("dev-uuid-123");
    expect(resolveTeam("front-end")).toBe("fe-uuid-456");
  });

  it("prefers direct key over alias", () => {
    expect(resolveTeam("FE")).toBe("fe-uuid-456");
    expect(resolveTeam("DEV")).toBe("dev-uuid-123");
  });

  it("returns input as-is for unknown teams", () => {
    expect(resolveTeam("UNKNOWN")).toBe("UNKNOWN");
  });
});

describe("resolveMember", () => {
  it("returns UUID directly if input is UUID", () => {
    expect(resolveMember("4b6bb89a-9348-4ab7-9e01-581040273998")).toBe(
      "4b6bb89a-9348-4ab7-9e01-581040273998",
    );
  });

  it("resolves alias to UUID", () => {
    expect(resolveMember("ytspar")).toBe("yury-uuid-789");
    expect(resolveMember("dima")).toBe("dmitrii-uuid-012");
  });

  it("resolves alias case-insensitively", () => {
    expect(resolveMember("YTSPAR")).toBe("yury-uuid-789");
  });

  it("resolves direct name to UUID", () => {
    expect(resolveMember("Yury")).toBe("yury-uuid-789");
    expect(resolveMember("dmitrii")).toBe("dmitrii-uuid-012");
  });

  it("resolves GitLab handle to UUID", () => {
    expect(resolveMember("dmitriiiii")).toBe("dmitrii-uuid-012");
  });

  it("resolves GitHub handle to UUID", () => {
    expect(resolveMember("yury-gh")).toBe("yury-uuid-789");
  });

  it("resolves handle with @ prefix", () => {
    expect(resolveMember("@dmitriiiii")).toBe("dmitrii-uuid-012");
    expect(resolveMember("@yury-gh")).toBe("yury-uuid-789");
  });

  it("resolves handle case-insensitively", () => {
    expect(resolveMember("DMITRIIIII")).toBe("dmitrii-uuid-012");
  });

  it("prefers alias over handle when both match", () => {
    // "ytspar" matches both alias and gitlab handle → alias wins
    expect(resolveMember("ytspar")).toBe("yury-uuid-789");
  });

  it("returns input as-is for unknown members", () => {
    expect(resolveMember("unknown-person")).toBe("unknown-person");
  });
});

describe("resolveLabels", () => {
  it("resolves workspace labels by name", () => {
    expect(resolveLabels(["claude"])).toEqual(["c1a0de00-0000-4000-8000-000000000001"]);
  });

  it("resolves team-scoped labels", () => {
    expect(resolveLabels(["tech-debt"], "DEV")).toEqual(["7ec4deb7-0000-4000-8000-000000000003"]);
  });

  it("returns name as-is when not found", () => {
    expect(resolveLabels(["nonexistent"])).toEqual(["nonexistent"]);
  });

  it("passes through UUIDs", () => {
    const uuid = "4b6bb89a-9348-4ab7-9e01-581040273998";
    expect(resolveLabels([uuid])).toEqual([uuid]);
  });

  it("resolves mixed labels", () => {
    const result = resolveLabels(["claude", "unknown-label", "bug"]);
    expect(result).toEqual([
      "c1a0de00-0000-4000-8000-000000000001",
      "unknown-label",
      "b0900000-0000-4000-8000-000000000002",
    ]);
  });

  it("returns label name when config has truncated UUID", () => {
    expect(resolveLabels(["truncated-label"], "DEV")).toEqual(["truncated-label"]);
  });

  it("only returns config UUIDs that pass full UUID validation", () => {
    // Valid UUIDs from config resolve correctly
    expect(resolveLabels(["claude"])).toEqual(["c1a0de00-0000-4000-8000-000000000001"]);
    expect(resolveLabels(["design"], "FE")).toEqual(["de519000-0000-4000-8000-000000000004"]);
    // Truncated UUIDs fall back to name (API resolution)
    expect(resolveLabels(["truncated-label"], "DEV")).toEqual(["truncated-label"]);
    // Unknown labels pass through as names
    expect(resolveLabels(["nonexistent"], "DEV")).toEqual(["nonexistent"]);
  });
});
