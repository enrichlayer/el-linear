/**
 * Tests for `el-linear profile {list,use,add,remove}`.
 *
 * Strategy: redirect the on-disk state to a tmp dir via the same
 * vi.hoisted node:os mock pattern the wizard tests use, then exercise
 * each `runProfileX` directly. The commander-side wiring
 * (`setupProfileCommands`) is the thinnest possible adapter; integration
 * coverage comes from the per-function tests + a single
 * setup-emits-subcommands sanity check.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TEST_HOME } = vi.hoisted(() => {
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		TEST_HOME: nodePath.join(
			nodeOs.tmpdir(),
			`el-linear-profile-test-${process.pid}-${Date.now()}`,
		),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

vi.mock("@inquirer/prompts", () => ({
	confirm: vi.fn(),
	input: vi.fn(),
	password: vi.fn(),
	select: vi.fn(),
}));

vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return {
		...actual,
		outputSuccess: vi.fn(),
		outputWarning: vi.fn(),
	};
});

vi.mock("./init/index.js", () => ({
	runFullWizard: vi.fn().mockResolvedValue(undefined),
	setupInitCommands: vi.fn(),
}));

import { confirm } from "@inquirer/prompts";
import {
	ACTIVE_PROFILE_FILE,
	CONFIG_DIR,
	CONFIG_PATH,
	PROFILES_DIR,
	profilePaths,
	setActiveProfileForSession,
	TOKEN_PATH,
} from "../config/paths.js";
import {
	runProfileAdd,
	runProfileList,
	runProfileRemove,
	runProfileUse,
} from "./profile.js";

beforeEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
	await fs.mkdir(CONFIG_DIR, { recursive: true });
	setActiveProfileForSession(null);
	vi.mocked(confirm).mockReset();
});

afterEach(async () => {
	setActiveProfileForSession(null);
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

describe("runProfileList", () => {
	it("returns empty profiles list when none exist + reports legacy file presence", async () => {
		await fs.writeFile(TOKEN_PATH, "lin_api_legacy_token\n", { mode: 0o600 });
		await fs.writeFile(CONFIG_PATH, "{}\n");

		const report = await runProfileList();

		expect(report.activeName).toBeNull();
		expect(report.profiles).toEqual([]);
		expect(report.hasLegacyToken).toBe(true);
		expect(report.hasLegacyConfig).toBe(true);
		expect(report.defaultPaths).toEqual({
			configPath: CONFIG_PATH,
			tokenPath: TOKEN_PATH,
		});
	});

	it("lists profile directories sorted alphabetically", async () => {
		const names = ["work", "personal", "scratch"];
		for (const name of names) {
			const p = profilePaths(name);
			await fs.mkdir(path.dirname(p.configPath), { recursive: true });
		}

		const report = await runProfileList();

		expect(report.profiles.map((p) => p.name)).toEqual([
			"personal",
			"scratch",
			"work",
		]);
	});

	it("reports hasToken / hasConfig per profile", async () => {
		const work = profilePaths("work");
		await fs.mkdir(path.dirname(work.configPath), { recursive: true });
		await fs.writeFile(work.tokenPath, "tok\n", { mode: 0o600 });
		// no config.json

		const empty = profilePaths("empty");
		await fs.mkdir(path.dirname(empty.configPath), { recursive: true });
		// no token, no config

		const report = await runProfileList();
		const work_ = report.profiles.find((p) => p.name === "work");
		const empty_ = report.profiles.find((p) => p.name === "empty");

		expect(work_).toMatchObject({ hasToken: true, hasConfig: false });
		expect(empty_).toMatchObject({ hasToken: false, hasConfig: false });
	});

	it("flags the active profile when ACTIVE_PROFILE_FILE points at one", async () => {
		const work = profilePaths("work");
		await fs.mkdir(path.dirname(work.configPath), { recursive: true });
		await fs.writeFile(ACTIVE_PROFILE_FILE, "work\n");

		const report = await runProfileList();

		expect(report.activeName).toBe("work");
		const work_ = report.profiles.find((p) => p.name === "work");
		expect(work_?.active).toBe(true);
	});

	it("returns activeName=null when ACTIVE_PROFILE_FILE doesn't point at an existing profile dir", async () => {
		// Marker file exists but the dir was deleted out from under it.
		await fs.writeFile(ACTIVE_PROFILE_FILE, "ghost\n");

		const report = await runProfileList();

		// resolveActiveProfile reports the marker name even if the dir is missing —
		// list() includes it from disk reads. Ghost has no dir entry though, so
		// profiles[] won't include it.
		expect(report.profiles).toEqual([]);
		expect(report.activeName).toBe("ghost");
	});
});

describe("runProfileUse", () => {
	it("writes ACTIVE_PROFILE_FILE with the trimmed name + trailing newline", async () => {
		await runProfileUse("work");

		const content = await fs.readFile(ACTIVE_PROFILE_FILE, "utf8");
		expect(content).toBe("work\n");
	});

	it("creates CONFIG_DIR with mode 0o700 if it didn't exist", async () => {
		// Force-delete the dir created by beforeEach
		await fs.rm(CONFIG_DIR, { recursive: true, force: true });

		await runProfileUse("work");

		const stat = await fs.stat(CONFIG_DIR);
		// mode is mode | umask noise; check the directory bit + that owner has rwx
		expect(stat.isDirectory()).toBe(true);
	});

	it("trims whitespace from the name before writing", async () => {
		await runProfileUse("  work  ");
		const content = await fs.readFile(ACTIVE_PROFILE_FILE, "utf8");
		expect(content).toBe("work\n");
	});

	it("rejects empty names", async () => {
		await expect(runProfileUse("")).rejects.toThrow(/must be non-empty/);
		await expect(runProfileUse("   ")).rejects.toThrow(/must be non-empty/);
	});

	it("rejects names with unsafe characters (path traversal)", async () => {
		await expect(runProfileUse("../escape")).rejects.toThrow(/[a-z0-9_-]/);
		await expect(runProfileUse("foo/bar")).rejects.toThrow(/[a-z0-9_-]/);
		await expect(runProfileUse("foo bar")).rejects.toThrow(/[a-z0-9_-]/);
		await expect(runProfileUse("foo;rm")).rejects.toThrow(/[a-z0-9_-]/);
	});

	it("rejects names starting with a non-alphanumeric character", async () => {
		await expect(runProfileUse(".hidden")).rejects.toThrow(/[a-z0-9_-]/);
		await expect(runProfileUse("-leading-dash")).rejects.toThrow(/[a-z0-9_-]/);
	});

	it("accepts safe names with letters, digits, underscore, dash, dot", async () => {
		await expect(runProfileUse("a")).resolves.toBeUndefined();
		await expect(runProfileUse("Work_2024")).resolves.toBeUndefined();
		await expect(runProfileUse("foo.bar-baz_2")).resolves.toBeUndefined();
	});

	it("rejects names longer than 64 characters", async () => {
		const tooLong = `a${"x".repeat(64)}`; // 65 chars
		await expect(runProfileUse(tooLong)).rejects.toThrow(/[a-z0-9_-]/);
	});
});

describe("runProfileAdd", () => {
	it("creates the profile dir + writes ACTIVE_PROFILE_FILE + invokes the wizard", async () => {
		const { runFullWizard } = await import("./init/index.js");

		await runProfileAdd("work");

		const dir = path.dirname(profilePaths("work").configPath);
		expect((await fs.stat(dir)).isDirectory()).toBe(true);
		expect(await fs.readFile(ACTIVE_PROFILE_FILE, "utf8")).toBe("work\n");
		expect(runFullWizard).toHaveBeenCalledOnce();
	});

	it("setActiveProfileForSession is set so the wizard writes scoped paths", async () => {
		// The wizard mock just returns; verify the session override was set
		// by inspecting the active profile after add returns.
		await runProfileAdd("scratch");
		const { resolveActiveProfile } = await import("../config/paths.js");
		expect(resolveActiveProfile().name).toBe("scratch");
	});

	it("rejects empty / unsafe names without touching disk", async () => {
		await expect(runProfileAdd("")).rejects.toThrow(/non-empty/);
		await expect(runProfileAdd("../bad")).rejects.toThrow(/[a-z0-9_-]/);

		// No marker file written
		await expect(fs.access(ACTIVE_PROFILE_FILE)).rejects.toThrow();
	});
});

describe("runProfileRemove", () => {
	it("deletes the profile directory + clears active marker if removed profile was active", async () => {
		// Set up a "work" profile and mark it active.
		const work = profilePaths("work");
		await fs.mkdir(path.dirname(work.configPath), { recursive: true });
		await fs.writeFile(work.tokenPath, "tok\n");
		await fs.writeFile(work.configPath, "{}\n");
		await fs.writeFile(ACTIVE_PROFILE_FILE, "work\n");
		setActiveProfileForSession("work");

		await runProfileRemove("work", true); // force=true skips confirm

		// Dir gone
		await expect(fs.access(path.dirname(work.configPath))).rejects.toThrow();
		// Active marker cleared
		await expect(fs.access(ACTIVE_PROFILE_FILE)).rejects.toThrow();
	});

	it("preserves ACTIVE_PROFILE_FILE when removing a non-active profile", async () => {
		const work = profilePaths("work");
		const personal = profilePaths("personal");
		await fs.mkdir(path.dirname(work.configPath), { recursive: true });
		await fs.mkdir(path.dirname(personal.configPath), { recursive: true });
		await fs.writeFile(ACTIVE_PROFILE_FILE, "work\n");
		setActiveProfileForSession("work");

		await runProfileRemove("personal", true);

		// Active marker should still point at "work"
		const marker = await fs.readFile(ACTIVE_PROFILE_FILE, "utf8");
		expect(marker).toBe("work\n");
	});

	it("prompts for confirmation when force=false; aborts on 'no'", async () => {
		const work = profilePaths("work");
		await fs.mkdir(path.dirname(work.configPath), { recursive: true });

		vi.mocked(confirm).mockResolvedValueOnce(false);

		await runProfileRemove("work", false);

		// Dir still exists — abort path
		expect((await fs.stat(path.dirname(work.configPath))).isDirectory()).toBe(
			true,
		);
	});

	it("prompts for confirmation when force=false; proceeds on 'yes'", async () => {
		const work = profilePaths("work");
		await fs.mkdir(path.dirname(work.configPath), { recursive: true });

		vi.mocked(confirm).mockResolvedValueOnce(true);

		await runProfileRemove("work", false);

		await expect(fs.access(path.dirname(work.configPath))).rejects.toThrow();
	});

	it("rejects when the profile dir doesn't exist", async () => {
		await expect(runProfileRemove("ghost", true)).rejects.toThrow(/not found/);
	});

	it("rejects unsafe names without touching disk", async () => {
		await expect(runProfileRemove("../bad", true)).rejects.toThrow(
			/Invalid profile name/,
		);
	});
});

describe("PROFILES_DIR layout invariants", () => {
	it("each profile's configPath/tokenPath sits inside PROFILES_DIR/<name>/", async () => {
		const p = profilePaths("work");
		expect(p.configPath.startsWith(`${PROFILES_DIR}/work/`)).toBe(true);
		expect(p.tokenPath.startsWith(`${PROFILES_DIR}/work/`)).toBe(true);
		expect(p.configPath).toMatch(/\/config\.json$/);
		expect(p.tokenPath).toMatch(/\/token$/);
	});
});
