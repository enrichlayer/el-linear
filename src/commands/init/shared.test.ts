import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Override the home directory for these tests so we don't touch real config.
const TEST_HOME = path.join(
	os.tmpdir(),
	`linctl-shared-test-${process.pid}-${Date.now()}`,
);

beforeEach(async () => {
	vi.spyOn(os, "homedir").mockReturnValue(TEST_HOME);
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

describe("shared config helpers", () => {
	it("readConfig returns {} when no file exists", async () => {
		const { readConfig } = await import("./shared.js");
		expect(await readConfig()).toEqual({});
	});

	it("writeConfig + readConfig roundtrips with stable key order", async () => {
		vi.resetModules();
		const { readConfig, writeConfig } = await import("./shared.js");
		await writeConfig({
			teams: { ENG: "id-1" },
			defaultTeam: "ENG",
			members: { aliases: { alice: "Alice Anderson" } },
		});
		const result = await readConfig();
		expect(result.defaultTeam).toBe("ENG");
		expect(result.teams?.ENG).toBe("id-1");
		expect(result.members?.aliases?.alice).toBe("Alice Anderson");
	});

	it("writeConfig produces sorted, byte-stable JSON output", async () => {
		vi.resetModules();
		const { CONFIG_PATH, writeConfig } = await import("./shared.js");
		await writeConfig({
			// Intentionally insert keys out of order.
			teams: { ENG: "id-1" },
			defaultTeam: "ENG",
			defaultLabels: ["claude"],
		});
		const first = await fs.readFile(CONFIG_PATH, "utf8");
		// Re-write with the same content but different insertion order.
		await writeConfig({
			defaultLabels: ["claude"],
			defaultTeam: "ENG",
			teams: { ENG: "id-1" },
		});
		const second = await fs.readFile(CONFIG_PATH, "utf8");
		expect(first).toBe(second);
	});

	it("readToken / writeToken roundtrip with mode 0600", async () => {
		vi.resetModules();
		const { readToken, TOKEN_PATH, writeToken } = await import("./shared.js");
		await writeToken("lin_api_test_token");
		expect(await readToken()).toBe("lin_api_test_token");
		const stat = await fs.stat(TOKEN_PATH);
		// mode is OS-bitfield; mask out file-type bits to compare.
		// 0o600 = owner rw only.
		expect(stat.mode & 0o777).toBe(0o600);
	});

	it("readToken returns null when file is missing", async () => {
		vi.resetModules();
		const { readToken } = await import("./shared.js");
		expect(await readToken()).toBeNull();
	});

	it("aliases progress: write/read/clear roundtrip", async () => {
		vi.resetModules();
		const { readAliasesProgress, writeAliasesProgress, clearAliasesProgress } =
			await import("./shared.js");
		expect(await readAliasesProgress()).toBeNull();
		await writeAliasesProgress({
			lastCompleted: 23,
			totalUsers: 47,
			savedAt: "2026-01-01T00:00:00Z",
		});
		const p = await readAliasesProgress();
		expect(p?.lastCompleted).toBe(23);
		expect(p?.totalUsers).toBe(47);
		await clearAliasesProgress();
		expect(await readAliasesProgress()).toBeNull();
	});

	it("clearAliasesProgress is idempotent (no error if file missing)", async () => {
		vi.resetModules();
		const { clearAliasesProgress } = await import("./shared.js");
		await expect(clearAliasesProgress()).resolves.toBeUndefined();
		await expect(clearAliasesProgress()).resolves.toBeUndefined();
	});
});
