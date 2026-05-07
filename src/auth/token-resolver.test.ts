/**
 * Tests for the unified token resolver. Mocks fs (via tmp dir) for OAuth
 * storage and injects a stub fetcher for refresh.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TEST_HOME } = vi.hoisted(() => {
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		TEST_HOME: nodePath.join(
			nodeOs.tmpdir(),
			`el-linear-token-resolver-test-${process.pid}-${Date.now()}`,
		),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

import {
	OAUTH_STATE_VERSION,
	type OAuthState,
	readOAuthState,
	writeOAuthState,
} from "./oauth-storage.js";
import type { FetchLike } from "./oauth-token.js";
import { ensureFreshAccessToken, getActiveAuth } from "./token-resolver.js";

const NOW = Date.UTC(2026, 4, 7, 12, 0, 0);

function freshState(overrides: Partial<OAuthState> = {}): OAuthState {
	return {
		v: OAUTH_STATE_VERSION,
		clientId: "client-abc",
		clientSecret: "secret",
		registeredRedirectUri: "http://localhost:8765/oauth/callback",
		accessToken: "lin_oauth_fresh",
		refreshToken: "rt-1",
		tokenType: "Bearer",
		scopes: ["read", "write"],
		expiresAt: NOW + 24 * 60 * 60 * 1000,
		obtainedAt: NOW,
		...overrides,
	};
}

let originalEnv: string | undefined;

beforeEach(async () => {
	originalEnv = process.env.LINEAR_API_TOKEN;
	delete process.env.LINEAR_API_TOKEN;
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

afterEach(async () => {
	if (originalEnv !== undefined) process.env.LINEAR_API_TOKEN = originalEnv;
	else delete process.env.LINEAR_API_TOKEN;
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

describe("getActiveAuth", () => {
	it("returns kind=personal when --api-token is provided (highest priority)", async () => {
		await writeOAuthState(freshState());
		process.env.LINEAR_API_TOKEN = "env-tok";
		const auth = await getActiveAuth({ apiToken: "flag-tok" });
		expect(auth).toEqual({ kind: "personal", token: "flag-tok" });
	});

	it("returns kind=personal from the env var when no flag is provided", async () => {
		await writeOAuthState(freshState());
		process.env.LINEAR_API_TOKEN = "env-tok";
		const auth = await getActiveAuth();
		expect(auth).toEqual({ kind: "personal", token: "env-tok" });
	});

	it("returns kind=oauth when oauth.json is present and fresh", async () => {
		const state = freshState();
		await writeOAuthState(state);
		const auth = await getActiveAuth({ now: () => NOW });
		expect(auth.kind).toBe("oauth");
		expect(auth.token).toBe(state.accessToken);
		expect(auth.oauth?.accessToken).toBe(state.accessToken);
	});

	it("auto-refreshes when the access token is within the skew window", async () => {
		const state = freshState({
			accessToken: "old-access",
			expiresAt: NOW + 30_000, // < 60s skew
		});
		await writeOAuthState(state);

		const fetchImpl = vi.fn<FetchLike>(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
			text: async () =>
				JSON.stringify({
					access_token: "new-access",
					token_type: "Bearer",
					expires_in: 86400,
					scope: "read,write",
					refresh_token: "rt-2",
				}),
		}));

		const auth = await getActiveAuth({ fetchImpl, now: () => NOW });
		expect(auth.kind).toBe("oauth");
		expect(auth.token).toBe("new-access");

		// New state must be persisted.
		const persisted = await readOAuthState();
		expect(persisted?.accessToken).toBe("new-access");
		expect(persisted?.refreshToken).toBe("rt-2");
	});

	it("falls back to personal-token resolver when no oauth.json exists", async () => {
		// Write a personal token to the wizard's expected path.
		const tokenPath = `${TEST_HOME}/.config/el-linear/token`;
		await fs.mkdir(`${TEST_HOME}/.config/el-linear`, {
			recursive: true,
			mode: 0o700,
		});
		await fs.writeFile(tokenPath, "lin_api_personal_xxx\n", {
			mode: 0o600,
		});

		const auth = await getActiveAuth();
		expect(auth).toEqual({
			kind: "personal",
			token: "lin_api_personal_xxx",
		});
	});

	it("propagates the personal-token resolver's error when nothing is configured", async () => {
		await expect(getActiveAuth()).rejects.toThrow(/No API token found/);
	});
});

describe("ensureFreshAccessToken", () => {
	it("returns state unchanged when token is fresh", async () => {
		const state = freshState({ expiresAt: NOW + 10 * 60 * 60 * 1000 });
		const result = await ensureFreshAccessToken(state, { now: () => NOW });
		expect(result).toBe(state);
	});

	it("refreshes when expired, persists new tokens, preserves clientSecret", async () => {
		const state = freshState({
			accessToken: "expired",
			expiresAt: NOW - 60_000,
		});
		await writeOAuthState(state);

		const fetchImpl = vi.fn<FetchLike>(async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
			text: async () =>
				JSON.stringify({
					access_token: "fresh",
					token_type: "Bearer",
					expires_in: 86400,
					scope: "read,write",
				}),
		}));

		const result = await ensureFreshAccessToken(state, {
			fetchImpl,
			now: () => NOW,
		});
		expect(result.accessToken).toBe("fresh");
		// Refresh token preserved when server doesn't rotate.
		expect(result.refreshToken).toBe(state.refreshToken);
		expect(result.clientSecret).toBe("secret");

		const persisted = await readOAuthState();
		expect(persisted?.accessToken).toBe("fresh");
	});

	it("throws actionable error when refresh fails", async () => {
		const state = freshState({ expiresAt: NOW - 1 });
		const fetchImpl = vi.fn<FetchLike>(async () => ({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			text: async () => `{"error":"invalid_grant"}`,
		}));
		await expect(
			ensureFreshAccessToken(state, { fetchImpl, now: () => NOW }),
		).rejects.toThrow(/Re-run.*el-linear init oauth/);
	});

	it("throws when expired and no refresh token is stored", async () => {
		const state = freshState({
			expiresAt: NOW - 1,
			refreshToken: undefined,
		});
		await expect(
			ensureFreshAccessToken(state, { now: () => NOW }),
		).rejects.toThrow(/no refresh token/);
	});
});
