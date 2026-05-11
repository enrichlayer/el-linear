import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Override the home directory for these tests so we don't touch real config.
const TEST_HOME = path.join(
	os.tmpdir(),
	`el-linear-shared-test-${process.pid}-${Date.now()}`,
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
			lastCompletedUserId: "user-uuid-23",
			totalUsers: 47,
			savedAt: "2026-01-01T00:00:00Z",
		});
		const p = await readAliasesProgress();
		expect(p?.lastCompletedUserId).toBe("user-uuid-23");
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

describe("writeToken security guarantees", () => {
	it("enforces mode 0600 even when the file pre-existed with 0644 perms", async () => {
		// Real-world scenario: a legacy ~/.linear_api_token was migrated, or the
		// file was scp'd from another machine, leaving permissive perms behind.
		// Plain fs.writeFile({mode}) only honors the mode flag on a NEW file —
		// the atomic-write helper sidesteps that by always writing to a fresh
		// tmp file and renaming.
		vi.resetModules();
		const { ensureConfigDir, TOKEN_PATH, writeToken } = await import(
			"./shared.js"
		);
		await ensureConfigDir();
		// Plant a pre-existing token file with permissive perms.
		await fs.writeFile(TOKEN_PATH, "lin_api_oldtoken\n", { mode: 0o644 });
		await fs.chmod(TOKEN_PATH, 0o644);
		// Sanity check the planted state.
		expect((await fs.stat(TOKEN_PATH)).mode & 0o777).toBe(0o644);

		// Replace via writeToken.
		await writeToken("lin_api_newtoken");
		expect((await fs.stat(TOKEN_PATH)).mode & 0o777).toBe(0o600);
		expect((await fs.readFile(TOKEN_PATH, "utf8")).trim()).toBe(
			"lin_api_newtoken",
		);
	});

	it("updateConfig serialises concurrent read-modify-write so neither write is lost (DEV-4066)", async () => {
		// Two parallel `init <step>` invocations both do:
		//   readConfig → mutate one slice → writeConfig
		// Without the lock the slower writer clobbers the faster writer's
		// already-persisted slice. With updateConfig() the mutator runs
		// inside withFileLock, so the second invocation re-reads the
		// freshly-written state and merges on top of it.
		vi.resetModules();
		const { readConfig, updateConfig, writeConfig } = await import(
			"./shared.js"
		);
		await writeConfig({});

		// Both mutators add a distinct top-level key. If serialization works,
		// both keys survive. If not, the slower-finishing mutator wins.
		const a = updateConfig((current) => ({
			...current,
			defaultTeam: "TEAM-A",
		}));
		const b = updateConfig((current) => ({
			...current,
			defaultLabels: ["from-b"],
		}));
		await Promise.all([a, b]);

		const result = await readConfig();
		expect(result.defaultTeam).toBe("TEAM-A");
		expect(result.defaultLabels).toEqual(["from-b"]);
	});

	it("updateConfig locks and reads/writes the same snapshot path even if active profile changes mid-update", async () => {
		// Guard against a future call site that could swap profiles between
		// the lock acquisition and the read+write inside the closure. If the
		// snapshot weren't honored, the lock and the file ops would diverge
		// onto different profile dirs — silently corrupting state.
		// Implementation: updateConfig captures activePaths().configPath once
		// at entry; readConfig + writeConfig accept that path as an arg.
		vi.resetModules();
		const { readConfig, updateConfig, writeConfig } = await import(
			"./shared.js"
		);
		const paths = await import("../../config/paths.js");
		await writeConfig({});
		// Capture the path that was active when we started.
		const originalPath = paths.resolveActiveProfile().configPath;

		// Inside the mutator, simulate a "profile switch" by repointing
		// future resolveActiveProfile() calls at a different path. The
		// snapshot taken at updateConfig entry should still bind the
		// lock + read + write to the ORIGINAL path.
		const switchedPath = path.join(
			path.dirname(originalPath),
			"profiles",
			"alternate",
			"config.json",
		);
		await fs.mkdir(path.dirname(switchedPath), { recursive: true });
		const resolveSpy = vi
			.spyOn(paths, "resolveActiveProfile")
			.mockReturnValueOnce(paths.resolveActiveProfile()); // first call: real

		await updateConfig((current) => {
			// Simulate the profile change in flight by overriding subsequent
			// resolves. Without the snapshot, the inner writeConfig would
			// land on switchedPath.
			resolveSpy.mockReturnValue({
				name: "alternate",
				configPath: switchedPath,
				tokenPath: path.join(path.dirname(switchedPath), "token"),
			});
			return { ...current, defaultTeam: "OK" };
		});

		// Critical assertion: the write hit the ORIGINAL path, not the
		// switched-to one.
		const onDisk = await readConfig(originalPath);
		expect(onDisk.defaultTeam).toBe("OK");
		await expect(fs.access(switchedPath)).rejects.toThrow();
		resolveSpy.mockRestore();
	});

	it("updateConfig releases the lock after the mutator throws", async () => {
		// If the lock weren't released on throw, the next caller would
		// either time out or steal a stale lock — both bad. The finally
		// block in withFileLock guarantees release.
		vi.resetModules();
		const { readConfig, updateConfig } = await import("./shared.js");
		await expect(
			updateConfig(() => {
				throw new Error("mutator failure");
			}),
		).rejects.toThrow("mutator failure");
		// Subsequent updateConfig must succeed without blocking.
		await updateConfig((current) => ({ ...current, defaultTeam: "AFTER" }));
		expect((await readConfig()).defaultTeam).toBe("AFTER");
	});

	it("atomic write: SIGINT-equivalent (rename failure) leaves the original file intact", async () => {
		// We can't actually SIGINT in a test, but we can simulate by mocking
		// fs.rename to reject — verifying that the original config file is
		// untouched if the rename never completes.
		vi.resetModules();
		const { CONFIG_PATH, ensureConfigDir, writeConfig } = await import(
			"./shared.js"
		);
		await ensureConfigDir();
		await fs.writeFile(CONFIG_PATH, '{"defaultTeam":"ORIGINAL"}\n', "utf8");
		const originalContent = await fs.readFile(CONFIG_PATH, "utf8");

		const renameSpy = vi
			.spyOn(fs, "rename")
			.mockRejectedValueOnce(new Error("simulated mid-rename failure"));

		await expect(writeConfig({ defaultTeam: "NEW" })).rejects.toThrow(
			"simulated mid-rename failure",
		);

		// Critical assertion: the original file is byte-identical, no truncation.
		expect(await fs.readFile(CONFIG_PATH, "utf8")).toBe(originalContent);
		renameSpy.mockRestore();

		// And no orphaned tmp files left behind.
		const dir = await fs.readdir(path.dirname(CONFIG_PATH));
		expect(dir.filter((f) => f.includes(".tmp-"))).toEqual([]);
	});
});
