/**
 * Disk-cache unit tests. Use the same `vi.hoisted` + `node:os` mock pattern
 * as `commands/init/wizard.test.ts` so the cache writes never touch the
 * real `~/.config/el-linear/`.
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
			`el-linear-disk-cache-test-${process.pid}-${Date.now()}`,
		),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

// Imports must follow the os mock so `paths.ts` resolves homedir against
// TEST_HOME on first import.
const { cached, clearCache, resolveCacheTTL } = await import("./disk-cache.js");
const { CONFIG_DIR } = await import("../config/paths.js");

const cacheDir = () => path.join(CONFIG_DIR, "cache");

beforeEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

afterEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

describe("cached() — happy path", () => {
	it("first call invokes fetcher; second call hits cache", async () => {
		const fetcher = vi.fn().mockResolvedValue({ teams: ["A", "B"] });

		const first = await cached("teams-list", 60, fetcher);
		const second = await cached("teams-list", 60, fetcher);

		expect(first).toEqual({ teams: ["A", "B"] });
		expect(second).toEqual({ teams: ["A", "B"] });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("write produces a file at <profile-dir>/cache/<key>.json with mode 0644", async () => {
		await cached("teams-list", 60, async () => ({ teams: [] }));

		const filePath = path.join(cacheDir(), "teams-list.json");
		const stat = await fs.stat(filePath);
		expect(stat.isFile()).toBe(true);
		expect(stat.mode & 0o777).toBe(0o644);
	});

	it("envelope shape has v, key, fetchedAt, expiresAt, data", async () => {
		const data = { teams: ["X"] };
		await cached("teams-list", 60, async () => data);

		const raw = await fs.readFile(
			path.join(cacheDir(), "teams-list.json"),
			"utf8",
		);
		const env = JSON.parse(raw) as Record<string, unknown>;
		expect(env.v).toBe(1);
		expect(env.key).toBe("teams-list");
		expect(typeof env.fetchedAt).toBe("number");
		expect(typeof env.expiresAt).toBe("number");
		expect(env.data).toEqual(data);
		// expiresAt is fetchedAt + ttlMs
		expect((env.expiresAt as number) - (env.fetchedAt as number)).toBe(
			60 * 1000,
		);
	});
});

describe("cached() — TTL expiry", () => {
	it("refetches when expiresAt is in the past", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce("first")
			.mockResolvedValueOnce("second");

		// First call: TTL=60s, writes envelope.
		await cached("foo", 60, fetcher);

		// Hand-rewrite envelope with an expired expiresAt to simulate TTL
		// expiry without faking timers.
		const filePath = path.join(cacheDir(), "foo.json");
		const env = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<
			string,
			unknown
		>;
		env.expiresAt = Date.now() - 1000;
		await fs.writeFile(filePath, JSON.stringify(env));

		const second = await cached("foo", 60, fetcher);
		expect(second).toBe("second");
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});

describe("cached() — bypass option", () => {
	it("bypass: true forces refetch but still rewrites envelope", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce("v1")
			.mockResolvedValueOnce("v2");

		await cached("k", 60, fetcher);
		const second = await cached("k", 60, fetcher, { bypass: true });

		expect(second).toBe("v2");
		expect(fetcher).toHaveBeenCalledTimes(2);

		// Envelope contains the new value.
		const raw = await fs.readFile(path.join(cacheDir(), "k.json"), "utf8");
		expect(JSON.parse(raw).data).toBe("v2");
	});
});

describe("cached() — TTL=0 disables caching", () => {
	it("never reads, never writes when TTL is zero", async () => {
		const fetcher = vi.fn().mockResolvedValue("fresh");

		const a = await cached("zero-key", 0, fetcher);
		const b = await cached("zero-key", 0, fetcher);

		expect(a).toBe("fresh");
		expect(b).toBe("fresh");
		expect(fetcher).toHaveBeenCalledTimes(2);

		// No envelope on disk.
		await expect(
			fs.stat(path.join(cacheDir(), "zero-key.json")),
		).rejects.toThrow();
	});
});

describe("cached() — corrupt JSON triggers silent refetch", () => {
	it("malformed envelope on disk → refetch + rewrite, no throw", async () => {
		const fetcher = vi.fn().mockResolvedValue("recovered");

		// Manually write corrupt JSON.
		await fs.mkdir(cacheDir(), { recursive: true, mode: 0o700 });
		await fs.writeFile(
			path.join(cacheDir(), "corrupt.json"),
			"this is not valid json",
		);

		const result = await cached("corrupt", 60, fetcher);
		expect(result).toBe("recovered");
		expect(fetcher).toHaveBeenCalledTimes(1);

		// Envelope replaced with a parseable one.
		const raw = await fs.readFile(
			path.join(cacheDir(), "corrupt.json"),
			"utf8",
		);
		expect(JSON.parse(raw).data).toBe("recovered");
	});

	it("envelope with unknown version is treated as a miss", async () => {
		const fetcher = vi.fn().mockResolvedValue("rebuilt");

		await fs.mkdir(cacheDir(), { recursive: true, mode: 0o700 });
		await fs.writeFile(
			path.join(cacheDir(), "future.json"),
			JSON.stringify({
				v: 99,
				key: "future",
				fetchedAt: Date.now(),
				expiresAt: Date.now() + 60_000,
				data: "stale",
			}),
		);

		const result = await cached("future", 60, fetcher);
		expect(result).toBe("rebuilt");
	});
});

describe("cached() — distinct keys", () => {
	it("different keys do not collide", async () => {
		const fa = vi.fn().mockResolvedValue("A");
		const fb = vi.fn().mockResolvedValue("B");

		const a = await cached("alpha", 60, fa);
		const b = await cached("beta", 60, fb);
		// Roundtrip — both should be cached independently.
		const a2 = await cached("alpha", 60, fa);
		const b2 = await cached("beta", 60, fb);

		expect(a).toBe("A");
		expect(b).toBe("B");
		expect(a2).toBe("A");
		expect(b2).toBe("B");
		expect(fa).toHaveBeenCalledTimes(1);
		expect(fb).toHaveBeenCalledTimes(1);

		// Both files exist on disk.
		await fs.stat(path.join(cacheDir(), "alpha.json"));
		await fs.stat(path.join(cacheDir(), "beta.json"));
	});

	it("filter-bearing keys (`team:ENG`) write under a sanitized filename", async () => {
		await cached("labels-list-team:ENG", 60, async () => ({
			labels: ["bug"],
		}));
		// `:` is POSIX-safe but the sanitizer leaves it intact since we only
		// strip path separators. The filename is the literal key + .json.
		await fs.stat(path.join(cacheDir(), "labels-list-team:ENG.json"));
	});

	it("path separators in keys are sanitized so writes can't escape the cache dir", async () => {
		await cached("evil/path/../etc", 60, async () => "safe");
		// Sanitized to evil_path_.._etc.json — still under cacheDir.
		await fs.stat(path.join(cacheDir(), "evil_path_.._etc.json"));
	});
});

describe("cached() — profile awareness", () => {
	it("two profiles produce two distinct cache directories", async () => {
		const { setActiveProfileForSession } = await import("../config/paths.js");

		setActiveProfileForSession("alpha");
		await cached("teams-list", 60, async () => "alpha-data");
		const alphaPath = path.join(
			TEST_HOME,
			".config/el-linear/profiles/alpha/cache/teams-list.json",
		);
		await fs.stat(alphaPath);

		setActiveProfileForSession("beta");
		await cached("teams-list", 60, async () => "beta-data");
		const betaPath = path.join(
			TEST_HOME,
			".config/el-linear/profiles/beta/cache/teams-list.json",
		);
		await fs.stat(betaPath);

		// Reading back: each profile sees its own data.
		setActiveProfileForSession("alpha");
		const a = await cached("teams-list", 60, async () => "should-not-fetch");
		expect(a).toBe("alpha-data");

		setActiveProfileForSession("beta");
		const b = await cached("teams-list", 60, async () => "should-not-fetch");
		expect(b).toBe("beta-data");

		setActiveProfileForSession(null);
	});
});

describe("cached() — write errors don't fail the call", () => {
	it("returns fetcher data even when the write step throws", async () => {
		const fetcher = vi.fn().mockResolvedValue("ok");
		// Make the cache dir un-writable by replacing it with a regular file.
		await fs.mkdir(path.dirname(cacheDir()), { recursive: true });
		await fs.writeFile(cacheDir(), "not a directory");

		// Suppress the warning that disk-cache writes on stderr.
		const stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);

		const result = await cached("oops", 60, fetcher);
		expect(result).toBe("ok");
		expect(stderrSpy).toHaveBeenCalled();

		stderrSpy.mockRestore();
		// Cleanup the file so afterEach's rm can remove the test dir.
		await fs.unlink(cacheDir()).catch(() => {});
	});
});

describe("clearCache()", () => {
	it("with no prefix removes the entire cache dir", async () => {
		await cached("a", 60, async () => "1");
		await cached("b", 60, async () => "2");

		await clearCache();

		await expect(fs.stat(cacheDir())).rejects.toThrow();
	});

	it("with a prefix removes only matching entries", async () => {
		await cached("teams-list", 60, async () => "t");
		await cached("labels-list-team:ENG", 60, async () => "l");
		await cached("projects-list", 60, async () => "p");

		await clearCache("labels-");

		await fs.stat(path.join(cacheDir(), "teams-list.json"));
		await fs.stat(path.join(cacheDir(), "projects-list.json"));
		await expect(
			fs.stat(path.join(cacheDir(), "labels-list-team:ENG.json")),
		).rejects.toThrow();
	});

	it("is a no-op when the cache dir is missing", async () => {
		await expect(clearCache()).resolves.toBeUndefined();
	});
});

describe("resolveCacheTTL()", () => {
	it("--no-cache forces 0", () => {
		expect(resolveCacheTTL({ configTTL: 7200, noCacheFlag: true })).toBe(0);
	});

	it("undefined config TTL falls back to 3600 (1 hour)", () => {
		expect(resolveCacheTTL({ configTTL: undefined, noCacheFlag: false })).toBe(
			3600,
		);
	});

	it("explicit 0 in config disables the cache", () => {
		expect(resolveCacheTTL({ configTTL: 0, noCacheFlag: false })).toBe(0);
	});

	it("explicit positive value is honored", () => {
		expect(resolveCacheTTL({ configTTL: 1800, noCacheFlag: false })).toBe(1800);
	});
});
