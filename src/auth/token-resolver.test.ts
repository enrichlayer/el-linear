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
		if (auth.kind === "oauth") {
			expect(auth.oauth.accessToken).toBe(state.accessToken);
		}
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

	it("kind narrows the oauth field (DEV-4068 T8)", async () => {
		// Regression: pre-DEV-4068, ActiveAuth was a flat shape with
		// `oauth?: OAuthState`, so `auth.oauth` was optionally present
		// regardless of kind. Now it's a discriminated union:
		// `{ kind: "oauth", oauth: OAuthState } | { kind: "personal" }`,
		// so `auth.oauth` is non-optional in the oauth arm and absent
		// in the personal arm.
		await writeOAuthState(freshState({ expiresAt: NOW + 24 * 60 * 60 * 1000 }));
		const oauthAuth = await getActiveAuth({ now: () => NOW });
		expect(oauthAuth.kind).toBe("oauth");
		if (oauthAuth.kind === "oauth") {
			// Type-level: oauth is non-optional here. Runtime: it's populated.
			expect(oauthAuth.oauth.clientId).toBeDefined();
		}

		// Now switch to personal to confirm the opposite arm.
		await fs.rm(`${TEST_HOME}/.config/el-linear`, {
			recursive: true,
			force: true,
		});
		process.env.LINEAR_API_TOKEN = "personal-tok";
		const personalAuth = await getActiveAuth();
		expect(personalAuth.kind).toBe("personal");
		if (personalAuth.kind === "personal") {
			// Type-level: `oauth` is not a property of the personal arm.
			// @ts-expect-error -- oauth is not present on the personal arm
			void personalAuth.oauth;
		}
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
		// Persist the state first so the file lock can be acquired —
		// production callers always go readOAuthState → ensureFreshAccessToken,
		// so oauth.json exists by the time we reach the lock.
		await writeOAuthState(state);
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
		await writeOAuthState(state);
		await expect(
			ensureFreshAccessToken(state, { now: () => NOW }),
		).rejects.toThrow(/no refresh token/);
	});

	it("two concurrent refreshes only call the token endpoint once (lock serialises them)", async () => {
		// State expired enough to force a refresh.
		const state = freshState({
			accessToken: "stale",
			expiresAt: NOW - 60_000,
		});
		await writeOAuthState(state);

		// Fetcher counts how many real refreshes fired. The slow reply lets
		// both callers race for the lock — only the winner should issue the
		// network call; the loser re-reads the freshly-written state.
		let calls = 0;
		const fetchImpl = vi.fn<FetchLike>(async () => {
			calls += 1;
			await new Promise((r) => setTimeout(r, 50));
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				text: async () =>
					JSON.stringify({
						access_token: "fresh-after-race",
						token_type: "Bearer",
						expires_in: 86400,
						scope: "read,write",
						refresh_token: "rt-rotated",
					}),
			};
		});

		const [a, b] = await Promise.all([
			ensureFreshAccessToken(state, { fetchImpl, now: () => NOW }),
			ensureFreshAccessToken(state, { fetchImpl, now: () => NOW }),
		]);
		expect(calls).toBe(1);
		expect(a.accessToken).toBe("fresh-after-race");
		expect(b.accessToken).toBe("fresh-after-race");
		// Both observers see the same rotated refresh token.
		expect(a.refreshToken).toBe("rt-rotated");
		expect(b.refreshToken).toBe("rt-rotated");
	});
});
