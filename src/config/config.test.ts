import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let existsSyncReturn: boolean;
let readFileSyncReturn: string;

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => existsSyncReturn),
    readFileSync: vi.fn(() => readFileSyncReturn),
  },
}));

describe("loadConfig", () => {
  beforeEach(() => {
    existsSyncReturn = false;
    readFileSyncReturn = "{}";
    // Reset module cache so cachedConfig is cleared
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults when no config file exists", async () => {
    existsSyncReturn = false;
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.defaultTeam).toBe("");
    expect(config.defaultLabels).toEqual([]);
    expect(config.statusDefaults.noProject).toBe("Triage");
    expect(config.statusDefaults.withAssigneeAndProject).toBe("Todo");
  });

  it("deep merges user config with defaults", async () => {
    existsSyncReturn = true;
    readFileSyncReturn = JSON.stringify({
      defaultTeam: "FE",
      teams: { FE: "fe-uuid" },
    });
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.defaultTeam).toBe("FE");
    expect(config.teams.FE).toBe("fe-uuid");
    // Defaults preserved for unset fields
    expect(config.statusDefaults.noProject).toBe("Triage");
    expect(config.members.aliases).toEqual({});
  });

  it("deeply merges nested objects", async () => {
    existsSyncReturn = true;
    readFileSyncReturn = JSON.stringify({
      members: { aliases: { dima: "Dmitrii" } },
    });
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.members.aliases.dima).toBe("Dmitrii");
    expect(config.members.uuids).toEqual({});
  });

  it("caches config on subsequent calls", async () => {
    existsSyncReturn = false;
    const { loadConfig } = await import("./config.js");
    const first = loadConfig();
    const second = loadConfig();
    expect(first).toBe(second);
  });

  it("handles parse errors gracefully", async () => {
    existsSyncReturn = true;
    readFileSyncReturn = "invalid json!!!";
    const { loadConfig } = await import("./config.js");
    const { resetWarnings, outputSuccess } = await import("../utils/output.js");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    resetWarnings();
    const config = loadConfig();
    expect(config.defaultTeam).toBe("");
    // Warning is buffered, verify by flushing through outputSuccess
    outputSuccess({ check: true });
    const output = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trimEnd());
    expect(output._warnings).toBeDefined();
    stdoutSpy.mockRestore();
  });
});
