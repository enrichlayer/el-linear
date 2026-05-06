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
		existsSyncMock.mockImplementation((p) =>
			(p as string).includes(".config/el-linear/token"),
		);
		readFileSyncMock.mockReturnValue("config-token\n");

		const result = getApiToken({});
		expect(result).toBe("config-token");
	});

	it("falls back to ~/.config/linctl/token (legacy) if the primary path is missing", () => {
		// The package was briefly published as `@enrichlayer/linctl`; the linctl
		// path is read-only fallback for one release after the revert.
		existsSyncMock.mockImplementation((p) =>
			(p as string).includes(".config/linctl/token"),
		);
		readFileSyncMock.mockReturnValue("legacy-linctl-token\n");

		const result = getApiToken({});
		expect(result).toBe("legacy-linctl-token");
	});

	it("reads from ~/.linear_api_token as last fallback", () => {
		existsSyncMock.mockImplementation((p) =>
			(p as string).includes(".linear_api_token"),
		);
		readFileSyncMock.mockReturnValue("  fallback-token  \n");

		const result = getApiToken({});
		expect(result).toBe("fallback-token");
	});

	it("throws when no token source is available", () => {
		expect(() => getApiToken({})).toThrow("No API token found");
	});

	it("reads from <CONFIG_DIR>/profiles/<name>/token when a profile is active", async () => {
		const { setActiveProfileForSession } = await import("../config/paths.js");
		setActiveProfileForSession("forage");
		try {
			existsSyncMock.mockImplementation((p) =>
				(p as string).includes("profiles/forage/token"),
			);
			readFileSyncMock.mockReturnValue("forage-token\n");
			const result = getApiToken({});
			expect(result).toBe("forage-token");
		} finally {
			setActiveProfileForSession(null);
		}
	});

	it("falls back to legacy ~/.config/el-linear/token when the profile token is missing", async () => {
		const { setActiveProfileForSession } = await import("../config/paths.js");
		setActiveProfileForSession("forage");
		try {
			// Profile token absent; legacy token present.
			existsSyncMock.mockImplementation((p) =>
				(p as string).endsWith(".config/el-linear/token"),
			);
			readFileSyncMock.mockReturnValue("legacy-token\n");
			const result = getApiToken({});
			expect(result).toBe("legacy-token");
		} finally {
			setActiveProfileForSession(null);
		}
	});

	it("error message names the active profile + expected token path when set", async () => {
		const { setActiveProfileForSession } = await import("../config/paths.js");
		setActiveProfileForSession("forage");
		try {
			existsSyncMock.mockReturnValue(false);
			expect(() => getApiToken({})).toThrow(/active profile.*forage/);
			expect(() => getApiToken({})).toThrow(/profiles\/forage\/token/);
		} finally {
			setActiveProfileForSession(null);
		}
	});
});
