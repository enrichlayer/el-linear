import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApiToken } from "./auth.js";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue("file-token\n"),
  },
}));

const fs = await import("node:fs");
const existsSyncMock = vi.mocked(fs.default.existsSync);
const readFileSyncMock = vi.mocked(fs.default.readFileSync);

describe("getApiToken", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.LINEAR_API_TOKEN;
    delete process.env.LINEAR_API_TOKEN;
    existsSyncMock.mockReturnValue(false);
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LINEAR_API_TOKEN = originalEnv;
    } else {
      delete process.env.LINEAR_API_TOKEN;
    }
  });

  it("returns CLI flag token first (highest priority)", () => {
    process.env.LINEAR_API_TOKEN = "env-token";
    const result = getApiToken({ apiToken: "flag-token" });
    expect(result).toBe("flag-token");
  });

  it("returns env var when no CLI flag", () => {
    process.env.LINEAR_API_TOKEN = "env-token";
    const result = getApiToken({});
    expect(result).toBe("env-token");
  });

  it("reads from ~/.config/el-linear/token when no flag or env", () => {
    existsSyncMock.mockImplementation((p) => (p as string).includes(".config/el-linear/token"));
    readFileSyncMock.mockReturnValue("config-token\n");

    const result = getApiToken({});
    expect(result).toBe("config-token");
  });

  it("reads from ~/.linear_api_token as last fallback", () => {
    existsSyncMock.mockImplementation((p) => (p as string).includes(".linear_api_token"));
    readFileSyncMock.mockReturnValue("  fallback-token  \n");

    const result = getApiToken({});
    expect(result).toBe("fallback-token");
  });

  it("throws when no token source is available", () => {
    expect(() => getApiToken({})).toThrow("No API token found");
  });
});
