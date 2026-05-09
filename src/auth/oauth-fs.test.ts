/**
 * Tests for the auth-module FS helpers — primarily `withFileLock`, which
 * serialises the OAuth refresh path against concurrent CLI invocations.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withFileLock } from "./oauth-fs.js";

const TMP_BASE = path.join(
	os.tmpdir(),
	`el-linear-oauth-fs-test-${process.pid}-${Date.now()}`,
);

beforeEach(async () => {
	await fs.mkdir(TMP_BASE, { recursive: true });
});

afterEach(async () => {
	await fs.rm(TMP_BASE, { recursive: true, force: true });
});

describe("withFileLock", () => {
	it("runs the critical section and releases the lock on success", async () => {
		const target = path.join(TMP_BASE, "target");
		const result = await withFileLock(target, async () => "ok");
		expect(result).toBe("ok");
		// Lockfile is removed on success.
		await expect(fs.access(`${target}.lock`)).rejects.toThrow();
	});

	it("releases the lock on synchronous throw", async () => {
		const target = path.join(TMP_BASE, "target");
		await expect(
			withFileLock(target, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow(/boom/);
		await expect(fs.access(`${target}.lock`)).rejects.toThrow();
	});

	it("serialises two concurrent callers", async () => {
		const target = path.join(TMP_BASE, "target");
		// Track which caller observed the critical section as held; the
		// counter should never exceed 1 because the lock excludes peers.
		let inside = 0;
		let maxInside = 0;

		const work = async () => {
			inside += 1;
			maxInside = Math.max(maxInside, inside);
			await new Promise((r) => setTimeout(r, 50));
			inside -= 1;
			return "done";
		};

		const [a, b] = await Promise.all([
			withFileLock(target, work),
			withFileLock(target, work),
		]);
		expect(a).toBe("done");
		expect(b).toBe("done");
		expect(maxInside).toBe(1);
	});

	it("steals a stale lock left behind by a crashed process", async () => {
		const target = path.join(TMP_BASE, "target");
		// Plant a stale lockfile with mtime well past the staleness window.
		await fs.writeFile(`${target}.lock`, "999999\n0\n");
		const stalePast = new Date(Date.now() - 60_000);
		await fs.utimes(`${target}.lock`, stalePast, stalePast);

		const result = await withFileLock(
			target,
			async () => "stole-it",
			// Aggressive stale window so the test runs fast.
			{ staleAfterMs: 1_000, maxWaitMs: 5_000, pollMs: 20 },
		);
		expect(result).toBe("stole-it");
	});

	it("times out when the lock holder is alive and slow", async () => {
		const target = path.join(TMP_BASE, "target");
		// Plant a fresh lockfile (mtime = now) so staleness detection
		// doesn't kick in. The helper should give up after maxWaitMs.
		await fs.writeFile(`${target}.lock`, `${process.pid}\n${Date.now()}\n`);

		await expect(
			withFileLock(target, async () => "never", {
				staleAfterMs: 60_000,
				maxWaitMs: 200,
				pollMs: 20,
			}),
		).rejects.toThrow(/Timed out.*waiting/);

		// Cleanup so the afterEach rm doesn't trip on perms (it shouldn't,
		// but be tidy).
		await fs.unlink(`${target}.lock`).catch(() => {});
	});
});
