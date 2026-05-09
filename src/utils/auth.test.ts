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

	it("refuses to fall back to legacy ~/.config/el-linear/token when a profile is active but its token is missing", async () => {
		const { setActiveProfileForSession } = await import("../config/paths.js");
		setActiveProfileForSession("forage");
		try {
			// Profile token absent; legacy token present — the legacy fallback
			// is intentionally disabled to avoid posting writes to the wrong
			// workspace when the user explicitly selected a profile.
			existsSyncMock.mockImplementation((p) =>
				(p as string).endsWith(".config/el-linear/token"),
			);
			readFileSyncMock.mockReturnValue("legacy-token\n");
			expect(() => getApiToken({})).toThrow(
				/No token for active profile.*forage/,
			);
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

/**
 * Integration: the legacy-drift hint emits to stderr at most once per
 * process before the underlying auth error fires, and is silenced by
 * EL_LINEAR_SKIP_MIGRATION_HINT=1.
 *
 * `node:fs` is module-mocked at the top of this file, so we can drive the
 * detection branch by toggling existsSync to claim only the legacy
 * config.json exists. The hint module reads `process.stderr` directly,
 * so we spy on its `write` method.
 */
describe("getApiToken: legacy migration hint integration", () => {
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		const { _resetMigrationHintForTests } = await import("./migration-hint.js");
		_resetMigrationHintForTests();
		stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		delete process.env.EL_LINEAR_SKIP_MIGRATION_HINT;
	});

	afterEach(async () => {
		stderrSpy.mockRestore();
		const { _resetMigrationHintForTests } = await import("./migration-hint.js");
		_resetMigrationHintForTests();
		delete process.env.EL_LINEAR_SKIP_MIGRATION_HINT;
	});

	it("emits the migration hint once across two simulated command runs in the same process", () => {
		// Drift state: legacy config.json exists; no token files; no profiles dir.
		existsSyncMock.mockImplementation((p) =>
			(p as string).endsWith(".config/el-linear/config.json"),
		);

		// First simulated command: throws "No API token found", emits hint.
		expect(() => getApiToken({})).toThrow(/No API token found/);
		// Second command in the same process: throws again, but no second hint.
		expect(() => getApiToken({})).toThrow(/No API token found/);

		// stderr.write may be called multiple times under the hood (jest framework
		// internals etc.) so we filter to just our hint signature.
		const hintCalls = stderrSpy.mock.calls.filter((args) =>
			String(args[0]).includes("el-linear profile migrate-legacy"),
		);
		expect(hintCalls.length).toBe(1);
	});

	it("does NOT emit the hint when EL_LINEAR_SKIP_MIGRATION_HINT=1 is set", () => {
		process.env.EL_LINEAR_SKIP_MIGRATION_HINT = "1";
		existsSyncMock.mockImplementation((p) =>
			(p as string).endsWith(".config/el-linear/config.json"),
		);

		expect(() => getApiToken({})).toThrow(/No API token found/);
		const hintCalls = stderrSpy.mock.calls.filter((args) =>
			String(args[0]).includes("el-linear profile migrate-legacy"),
		);
		expect(hintCalls.length).toBe(0);
	});

	it("does NOT emit the hint when there's no legacy drift", () => {
		// Nothing exists on disk — fresh install. Hint should stay silent.
		existsSyncMock.mockReturnValue(false);
		expect(() => getApiToken({})).toThrow(/No API token found/);
		const hintCalls = stderrSpy.mock.calls.filter((args) =>
			String(args[0]).includes("el-linear profile migrate-legacy"),
		);
		expect(hintCalls.length).toBe(0);
	});
});
