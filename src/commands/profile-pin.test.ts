/**
 * Command-level tests for `el-linear profile pin|unpin` (DEV-7277).
 *
 * These exercise the real fs + git seam against a throwaway git repo so the
 * repo-local `.el-git.json` merge, the `--global` table write, name validation,
 * and unpin behavior are covered end to end. `os.homedir` is redirected to a
 * tmp dir so the `--global` path writes under the sandbox.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { TEST_HOME } = vi.hoisted(() => {
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		TEST_HOME: nodePath.join(
			nodeOs.tmpdir(),
			`el-linear-pin-test-${process.pid}-${Date.now()}`,
		),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return { ...actual, outputSuccess: vi.fn(), outputWarning: vi.fn() };
});

import { outputSuccess } from "../utils/output.js";
import { runProfilePin, runProfileUnpin } from "./profile.js";

const realTmp = require("node:os").tmpdir() as string;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
let repoDir = "";
let originalCwd = "";

function gitInitRepo(dir: string, origin: string | null): void {
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "t@t.co"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
	if (origin) {
		execFileSync("git", ["remote", "add", "origin", origin], { cwd: dir });
	}
}

beforeEach(async () => {
	originalCwd = process.cwd();
	delete process.env.XDG_CONFIG_HOME;
	await fs.rm(TEST_HOME, { recursive: true, force: true });
	await fs.mkdir(TEST_HOME, { recursive: true });
	repoDir = await fs.mkdtemp(path.join(realTmp, "el-linear-pin-repo-"));
	// realpath so macOS /var → /private/var symlink matches git's toplevel.
	repoDir = await fs.realpath(repoDir);
	gitInitRepo(repoDir, "git@github.com:enrichlayer/el-linear.git");
	process.chdir(repoDir);
	vi.mocked(outputSuccess).mockReset();
});

afterEach(async () => {
	process.chdir(originalCwd);
	if (originalXdgConfigHome === undefined) {
		delete process.env.XDG_CONFIG_HOME;
	} else {
		process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
	}
	await fs.rm(repoDir, { recursive: true, force: true });
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

afterAll(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

describe("runProfilePin — repo-local", () => {
	it("writes .el-git.json { linearProfile } at the repo root", async () => {
		await runProfilePin("forage", {});
		const body = await fs.readFile(path.join(repoDir, ".el-git.json"), "utf8");
		expect(JSON.parse(body)).toEqual({ linearProfile: "forage" });
	});

	it("merges into an existing .el-git.json without clobbering siblings", async () => {
		const file = path.join(repoDir, ".el-git.json");
		await fs.writeFile(file, JSON.stringify({ keep: "me" }));
		await runProfilePin("forage", {});
		expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
			keep: "me",
			linearProfile: "forage",
		});
	});

	it("rejects an unsafe profile name", async () => {
		await expect(runProfilePin("../evil", {})).rejects.toThrow(
			/must contain only/,
		);
	});

	it("refuses a repo-controlled symlink without reading or writing its target", async () => {
		const target = path.join(TEST_HOME, "outside.json");
		const file = path.join(repoDir, ".el-git.json");
		await fs.writeFile(target, JSON.stringify({ keep: "outside" }));
		await fs.symlink(target, file);

		await expect(runProfilePin("forage", {})).rejects.toThrow(/symbolic link/);

		expect((await fs.lstat(file)).isSymbolicLink()).toBe(true);
		expect(JSON.parse(await fs.readFile(target, "utf8"))).toEqual({
			keep: "outside",
		});
	});
});

describe("runProfilePin — global", () => {
	it("writes the owner/repo entry into the global table", async () => {
		await runProfilePin("work", { global: true });
		const file = path.join(
			TEST_HOME,
			".config",
			"el-git",
			"linear-profiles.json",
		);
		expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
			profiles: { "enrichlayer/el-linear": "work" },
		});
	});

	it("honors XDG_CONFIG_HOME instead of the home-directory fallback", async () => {
		const xdgConfigHome = path.join(TEST_HOME, "xdg");
		process.env.XDG_CONFIG_HOME = xdgConfigHome;

		await runProfilePin("work", { global: true });

		const file = path.join(xdgConfigHome, "el-git", "linear-profiles.json");
		expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
			profiles: { "enrichlayer/el-linear": "work" },
		});
	});

	it("removes the exact owner/repo entry via unpin --global", async () => {
		await runProfilePin("work", { global: true });
		await runProfileUnpin({ global: true });
		const file = path.join(
			TEST_HOME,
			".config",
			"el-git",
			"linear-profiles.json",
		);
		await expect(fs.access(file)).rejects.toThrow();
	});
});

describe("runProfilePin — show", () => {
	it("reports the resolved repo-local pin + source", async () => {
		await fs.writeFile(
			path.join(repoDir, ".el-git.json"),
			JSON.stringify({ linearProfile: "forage" }),
		);
		await runProfilePin(undefined, { show: true });
		const arg = vi.mocked(outputSuccess).mock.calls[0]?.[0] as {
			data: { pinned: string | null; source: string | null };
		};
		expect(arg.data.pinned).toBe("forage");
		expect(arg.data.source).toBe("repo-file");
	});
});

describe("runProfileUnpin", () => {
	it("deletes .el-git.json when the pin was its only key", async () => {
		const file = path.join(repoDir, ".el-git.json");
		await fs.writeFile(file, JSON.stringify({ linearProfile: "forage" }));
		await runProfileUnpin();
		await expect(fs.access(file)).rejects.toThrow();
	});

	it("keeps sibling keys and only drops linearProfile", async () => {
		const file = path.join(repoDir, ".el-git.json");
		await fs.writeFile(
			file,
			JSON.stringify({ keep: "me", linearProfile: "x" }),
		);
		await runProfileUnpin();
		expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ keep: "me" });
	});

	it("refuses non-object JSON without deleting the shared file", async () => {
		const file = path.join(repoDir, ".el-git.json");
		await fs.writeFile(file, "[]");

		await expect(runProfileUnpin()).rejects.toThrow(/malformed JSON/);
		expect(await fs.readFile(file, "utf8")).toBe("[]");
	});
});
