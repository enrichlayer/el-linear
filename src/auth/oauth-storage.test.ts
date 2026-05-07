/**
 * Tests for `oauth-storage`. Uses the same `vi.hoisted` `node:os` mock
 * pattern as `commands/init/wizard.test.ts` so the writes go to a tmp dir
 * instead of the real `~/.config/`.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TEST_HOME } = vi.hoisted(() => {
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		TEST_HOME: nodePath.join(
			nodeOs.tmpdir(),
			`el-linear-oauth-storage-test-${process.pid}-${Date.now()}`,
		),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

import {
	clearOAuthState,
	isAccessTokenFresh,
	OAUTH_STATE_VERSION,
	type OAuthState,
	oauthStatePath,
	readOAuthState,
	writeOAuthState,
} from "./oauth-storage.js";

const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

function sampleState(overrides: Partial<OAuthState> = {}): OAuthState {
	return {
		v: OAUTH_STATE_VERSION,
		clientId: "client-abc",
		registeredRedirectUri: "http://localhost:8765/oauth/callback",
		accessToken: "lin_oauth_access_token_xyz",
		refreshToken: "refresh-token-xyz",
		tokenType: "Bearer",
		scopes: ["read", "write"],
		expiresAt: NOW + 24 * 60 * 60 * 1000,
		obtainedAt: NOW,
		...overrides,
	};
}

beforeEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

afterEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

describe("readOAuthState", () => {
	it("returns null when no state file exists", async () => {
		expect(await readOAuthState()).toBeNull();
	});

	it("round-trips a valid state via writeOAuthState", async () => {
		const state = sampleState();
		await writeOAuthState(state);
		const read = await readOAuthState();
		expect(read).toEqual(state);
	});

	it("returns null on a state with the wrong version", async () => {
		await writeOAuthState({ ...sampleState(), v: 99 as 1 });
		expect(await readOAuthState()).toBeNull();
	});

	it("returns null on corrupt JSON", async () => {
		// Force the file into existence with garbage content.
		await writeOAuthState(sampleState());
		await fs.writeFile(oauthStatePath(), "{ not valid json", "utf8");
		expect(await readOAuthState()).toBeNull();
	});

	it("returns null when accessToken is empty", async () => {
		await writeOAuthState({ ...sampleState(), accessToken: "" });
		expect(await readOAuthState()).toBeNull();
	});
});

describe("writeOAuthState", () => {
	it("writes the file with mode 0600", async () => {
		await writeOAuthState(sampleState());
		const stat = await fs.stat(oauthStatePath());
		expect(stat.mode & 0o777).toBe(0o600);
	});

	it("resets a pre-existing 0644 file's mode to 0600 (atomic write)", async () => {
		await writeOAuthState(sampleState());
		await fs.chmod(oauthStatePath(), 0o644);
		await writeOAuthState(sampleState());
		const stat = await fs.stat(oauthStatePath());
		expect(stat.mode & 0o777).toBe(0o600);
	});

	it("creates the profile directory when it doesn't exist yet", async () => {
		// Sanity: TEST_HOME doesn't exist on disk after the beforeEach rm.
		const exists = await fs
			.access(TEST_HOME)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
		await writeOAuthState(sampleState());
		const stat = await fs.stat(oauthStatePath());
		expect(stat.isFile()).toBe(true);
	});
});

describe("clearOAuthState", () => {
	it("deletes an existing state file", async () => {
		await writeOAuthState(sampleState());
		await clearOAuthState();
		expect(await readOAuthState()).toBeNull();
	});

	it("is a no-op when nothing exists", async () => {
		await expect(clearOAuthState()).resolves.toBeUndefined();
	});
});

describe("isAccessTokenFresh", () => {
	it("returns true when expiresAt is well in the future", () => {
		expect(
			isAccessTokenFresh(
				sampleState({ expiresAt: Date.now() + 10 * 60 * 1000 }),
			),
		).toBe(true);
	});

	it("returns false when expiresAt is in the past", () => {
		expect(
			isAccessTokenFresh(
				sampleState({ expiresAt: Date.now() - 1 * 60 * 1000 }),
			),
		).toBe(false);
	});

	it("returns false when within the default 60s skew window", () => {
		expect(
			isAccessTokenFresh(sampleState({ expiresAt: Date.now() + 30_000 })),
		).toBe(false);
	});
});
