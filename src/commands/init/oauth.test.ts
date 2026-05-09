/**
 * Wizard-side tests for `init oauth`. Mocks @inquirer prompts, the OAuth
 * token endpoint, the localhost listener, and the browser opener — same
 * patterns as `wizard.test.ts`.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TEST_HOME, mockRawRequest } = vi.hoisted(() => {
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		TEST_HOME: nodePath.join(
			nodeOs.tmpdir(),
			`el-linear-oauth-wizard-test-${process.pid}-${Date.now()}`,
		),
		mockRawRequest: vi.fn(),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

vi.mock("@inquirer/prompts", () => ({
	checkbox: vi.fn(),
	confirm: vi.fn(),
	input: vi.fn(),
	password: vi.fn(),
	select: vi.fn(),
}));

vi.mock("../../utils/graphql-service.js", () => ({
	GraphQLService: class {
		rawRequest: (...args: unknown[]) => Promise<any> = (...args) =>
			mockRawRequest(...args);
	},
}));

import { checkbox, input, password, select } from "@inquirer/prompts";
import type { FetchLike } from "../../auth/oauth-token.js";
import { runOAuthRevoke, runOAuthStep } from "./oauth.js";

const VALID_VIEWER = {
	id: "11111111-2222-3333-4444-555555555555",
	name: "Tester",
	email: "test@example.com",
	displayName: "Tester",
	organization: { urlKey: "acme", name: "Acme" },
};

function jsonResponse(body: unknown, ok = true, status = 200) {
	return {
		ok,
		status,
		statusText: ok ? "OK" : "Bad Request",
		text: async () => JSON.stringify(body),
	};
}

beforeEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
	delete process.env.EL_LINEAR_OAUTH_CONFIG;
	mockRawRequest.mockReset();
	vi.mocked(checkbox).mockReset();
	vi.mocked(input).mockReset();
	vi.mocked(password).mockReset();
	vi.mocked(select).mockReset();
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
	vi.mocked(console.log).mockRestore();
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────
//  Happy path — full PKCE flow
// ─────────────────────────────────────────────────────────────────────

describe("runOAuthStep — first-time happy path", () => {
	it("registers app, runs PKCE flow, validates token, persists state", async () => {
		// Prompt sequence:
		//   - input port → 8765
		//   - input client_id → "test-client"
		//   - password client_secret → ""
		//   - checkbox scopes → DEFAULT_SCOPES
		vi.mocked(input)
			.mockResolvedValueOnce("8765") // port
			.mockResolvedValueOnce("test-client"); // client_id
		vi.mocked(password).mockResolvedValueOnce(""); // no secret
		vi.mocked(checkbox).mockResolvedValueOnce([
			"read",
			"write",
			"issues:create",
			"comments:create",
		]);

		// Validate-via-viewer call.
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		// Stub for token endpoint.
		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "lin_oauth_access",
				token_type: "Bearer",
				expires_in: 86400,
				scope: "read,write,issues:create,comments:create",
				refresh_token: "rt-1",
			}),
		);

		const openBrowser = vi.fn(async (_url: string) => undefined);

		const result = await runOAuthStep({
			fetchImpl,
			openBrowser,
			// Listener stub: read the state from the URL we sent to
			// openBrowser and echo it back as the callback `state`.
			runLocalhostCallbackImpl: async ({ expectedState }) => ({
				code: "AUTH123",
				state: expectedState,
			}),
		});

		expect(result.viewer.email).toBe(VALID_VIEWER.email);
		expect(result.state.accessToken).toBe("lin_oauth_access");
		expect(result.state.scopes).toEqual([
			"read",
			"write",
			"issues:create",
			"comments:create",
		]);

		// Persisted to disk?
		const onDisk = JSON.parse(
			await fs.readFile(`${TEST_HOME}/.config/el-linear/oauth.json`, "utf8"),
		);
		expect(onDisk.accessToken).toBe("lin_oauth_access");
		expect(onDisk.refreshToken).toBe("rt-1");
		expect(onDisk.clientId).toBe("test-client");

		const stat = await fs.stat(`${TEST_HOME}/.config/el-linear/oauth.json`);
		expect(stat.mode & 0o777).toBe(0o600);

		expect(openBrowser).toHaveBeenCalledTimes(1);
		expect(openBrowser.mock.calls[0][0]).toMatch(
			/^https:\/\/linear\.app\/oauth\/authorize\?/,
		);
	});

	it("uses local team OAuth defaults when team-oauth.json exists", async () => {
		await fs.mkdir(`${TEST_HOME}/.config/el-linear`, {
			recursive: true,
			mode: 0o700,
		});
		await fs.writeFile(
			`${TEST_HOME}/.config/el-linear/team-oauth.json`,
			JSON.stringify({
				linearOAuth: {
					clientId: "team-client",
					redirectPort: 9876,
					scopes: ["read", "issues:create"],
					passwordManagerPath: "op://vault/el-linear/client_id",
				},
			}),
		);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "team-access",
				token_type: "Bearer",
				expires_in: 86400,
				scope: "read,issues:create",
				refresh_token: "rt-team",
			}),
		);
		const openBrowser = vi.fn(async (_url: string) => undefined);

		const result = await runOAuthStep({
			fetchImpl,
			openBrowser,
			runLocalhostCallbackImpl: async ({ expectedState }) => ({
				code: "AUTH-TEAM",
				state: expectedState,
			}),
		});

		expect(result.state.clientId).toBe("team-client");
		expect(result.state.scopes).toEqual(["read", "issues:create"]);
		expect(vi.mocked(input)).not.toHaveBeenCalled();
		expect(vi.mocked(password)).not.toHaveBeenCalled();
		expect(vi.mocked(checkbox)).not.toHaveBeenCalled();

		const authorizeUrl = new URL(openBrowser.mock.calls[0][0]);
		expect(authorizeUrl.searchParams.get("client_id")).toBe("team-client");
		expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
			"http://localhost:9876/oauth/callback",
		);

		const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
		expect(body.get("client_id")).toBe("team-client");
		expect(body.get("redirect_uri")).toBe(
			"http://localhost:9876/oauth/callback",
		);
		expect(body.has("client_secret")).toBe(false);
	});

	it("lets --port override the team OAuth redirect port", async () => {
		await fs.mkdir(`${TEST_HOME}/.config/el-linear`, {
			recursive: true,
			mode: 0o700,
		});
		await fs.writeFile(
			`${TEST_HOME}/.config/el-linear/team-oauth.json`,
			JSON.stringify({
				linearOAuth: {
					clientId: "team-client",
					redirectPort: 9876,
				},
			}),
		);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "team-access",
				token_type: "Bearer",
				expires_in: 86400,
				scope: "read,write,issues:create,comments:create",
			}),
		);

		await runOAuthStep({
			port: 12345,
			fetchImpl,
			openBrowser: async () => undefined,
			runLocalhostCallbackImpl: async ({ expectedState }) => ({
				code: "AUTH-TEAM",
				state: expectedState,
			}),
		});

		const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
		expect(body.get("redirect_uri")).toBe(
			"http://localhost:12345/oauth/callback",
		);
	});

	it("includes client_secret in the token request when provided", async () => {
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("client-with-secret");
		vi.mocked(password).mockResolvedValueOnce("the-secret");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "tok",
				token_type: "Bearer",
				expires_in: 100,
				scope: "read",
			}),
		);

		await runOAuthStep({
			fetchImpl,
			openBrowser: async () => undefined,
			runLocalhostCallbackImpl: async ({ expectedState }) => ({
				code: "C",
				state: expectedState,
			}),
		});

		const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
		expect(body.get("client_secret")).toBe("the-secret");
	});
});

// ─────────────────────────────────────────────────────────────────────
//  Headless fallback paths
// ─────────────────────────────────────────────────────────────────────

describe("runOAuthStep — headless paths", () => {
	it("falls back to manual paste when --no-browser", async () => {
		// Use the bare-code paste form (no `=` or `?`) — that path trusts
		// the expected state without parsing a URL, so we don't have to
		// know the random state value the wizard generated.
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("client-headless")
			.mockResolvedValueOnce("AUTHCODE-BARE");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "tok-h",
				token_type: "Bearer",
				expires_in: 86400,
				scope: "read",
			}),
		);

		const result = await runOAuthStep({
			noBrowser: true,
			// Bare-code paste is opt-in (ALL-935 CSRF guard) — explicitly
			// allow it in the test so the prompt doesn't reject it.
			unsafeBareCode: true,
			fetchImpl,
		});
		expect(result.state.accessToken).toBe("tok-h");
	});

	it("rejects bare-code paste without --unsafe-bare-code (ALL-935 CSRF guard)", async () => {
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("client-no-flag")
			.mockResolvedValueOnce("BARECODE-NO-FLAG");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);

		const fetchImpl = vi.fn<FetchLike>(async () => {
			throw new Error("token endpoint should not be reached");
		});

		await expect(
			runOAuthStep({
				noBrowser: true,
				// unsafeBareCode NOT set — the prompt rejects the bare paste
				// before any token exchange happens.
				fetchImpl,
			}),
		).rejects.toThrow(/--unsafe-bare-code|bypass.*CSRF/);
	});

	it("falls back to paste when openBrowser throws", async () => {
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("client-fb")
			.mockResolvedValueOnce("BARECODE");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "tok-fb",
				token_type: "Bearer",
				expires_in: 100,
				scope: "read",
			}),
		);

		const result = await runOAuthStep({
			fetchImpl,
			unsafeBareCode: true,
			openBrowser: async () => {
				throw new Error("xdg-open not found");
			},
		});
		expect(result.state.accessToken).toBe("tok-fb");
	});

	it("falls back to paste when the localhost listener errors", async () => {
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("client-listener-fail")
			.mockResolvedValueOnce("BARECODE-LF");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "tok-lf",
				token_type: "Bearer",
				expires_in: 100,
				scope: "read",
			}),
		);

		const result = await runOAuthStep({
			fetchImpl,
			unsafeBareCode: true,
			openBrowser: async () => undefined,
			runLocalhostCallbackImpl: async () => {
				throw new Error("EADDRINUSE 8765");
			},
		});
		expect(result.state.accessToken).toBe("tok-lf");
	});
});

// ─────────────────────────────────────────────────────────────────────
//  Existing-state branches
// ─────────────────────────────────────────────────────────────────────

describe("runOAuthStep — existing state", () => {
	async function seedExisting(): Promise<void> {
		await fs.mkdir(`${TEST_HOME}/.config/el-linear`, {
			recursive: true,
			mode: 0o700,
		});
		const state = {
			v: 1,
			clientId: "stored-client",
			registeredRedirectUri: "http://localhost:8765/oauth/callback",
			accessToken: "old-access",
			refreshToken: "old-refresh",
			tokenType: "Bearer",
			scopes: ["read", "write"],
			expiresAt: Date.now() + 86_400_000,
			obtainedAt: Date.now(),
		};
		await fs.writeFile(
			`${TEST_HOME}/.config/el-linear/oauth.json`,
			JSON.stringify(state),
			{ mode: 0o600 },
		);
	}

	it("offers keep / re-auth / revoke and `keep` returns existing state", async () => {
		await seedExisting();
		vi.mocked(select).mockResolvedValueOnce("keep");
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const result = await runOAuthStep({});
		expect(result.state.accessToken).toBe("old-access");
		expect(vi.mocked(input)).not.toHaveBeenCalled();
	});

	it("`revoke` deletes oauth.json and proceeds to re-auth", async () => {
		await seedExisting();
		vi.mocked(select).mockResolvedValueOnce("revoke");
		// Then we go through registration + auth again.
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("new-client")
			.mockResolvedValueOnce("BARECODE");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		// Two fetch calls: one to revoke, one to exchange.
		const fetchImpl = vi
			.fn<FetchLike>()
			.mockResolvedValueOnce(jsonResponse({}, true, 200)) // revoke OK
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "fresh",
					token_type: "Bearer",
					expires_in: 100,
					scope: "read",
				}),
			);

		const result = await runOAuthStep({
			fetchImpl,
			openBrowser: async () => undefined,
			runLocalhostCallbackImpl: async ({ expectedState }) => ({
				code: "C",
				state: expectedState,
			}),
		});
		expect(result.state.accessToken).toBe("fresh");
		expect(result.state.clientId).toBe("new-client");
	});

	it("--force bypasses the keep-prompt and re-authorizes immediately", async () => {
		await seedExisting();
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("force-client")
			.mockResolvedValueOnce("BARECODE");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "forced",
				token_type: "Bearer",
				expires_in: 100,
				scope: "read",
			}),
		);

		const result = await runOAuthStep({
			force: true,
			fetchImpl,
			openBrowser: async () => undefined,
			runLocalhostCallbackImpl: async ({ expectedState }) => ({
				code: "C",
				state: expectedState,
			}),
		});
		expect(result.state.accessToken).toBe("forced");
		expect(result.state.clientId).toBe("force-client");
		expect(vi.mocked(select)).not.toHaveBeenCalled();
	});

	it("falls back to re-auth when the existing token fails validation", async () => {
		await seedExisting();
		vi.mocked(select).mockResolvedValueOnce("keep");
		mockRawRequest.mockRejectedValueOnce(new Error("AuthenticationFailed"));
		// re-auth flow:
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("recovered-client")
			.mockResolvedValueOnce("BARECODE");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "recovered",
				token_type: "Bearer",
				expires_in: 100,
				scope: "read",
			}),
		);

		const result = await runOAuthStep({
			fetchImpl,
			openBrowser: async () => undefined,
			runLocalhostCallbackImpl: async ({ expectedState }) => ({
				code: "C",
				state: expectedState,
			}),
		});
		expect(result.state.accessToken).toBe("recovered");
	});
});

// ─────────────────────────────────────────────────────────────────────
//  Error paths
// ─────────────────────────────────────────────────────────────────────

describe("runOAuthStep — error paths", () => {
	it("throws when token endpoint returns 4xx", async () => {
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("err-client");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);

		const fetchImpl = vi.fn<FetchLike>(async () => ({
			ok: false,
			status: 400,
			statusText: "Bad Request",
			text: async () => `{"error":"invalid_grant"}`,
		}));

		await expect(
			runOAuthStep({
				fetchImpl,
				openBrowser: async () => undefined,
				runLocalhostCallbackImpl: async ({ expectedState }) => ({
					code: "BAD",
					state: expectedState,
				}),
			}),
		).rejects.toThrow(/invalid_grant/);
	});

	it("throws when viewer validation rejects the token", async () => {
		vi.mocked(input)
			.mockResolvedValueOnce("8765")
			.mockResolvedValueOnce("viewer-fail-client");
		vi.mocked(password).mockResolvedValueOnce("");
		vi.mocked(checkbox).mockResolvedValueOnce(["read"]);
		mockRawRequest.mockRejectedValueOnce(new Error("Unauthorized"));

		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "tok-bad",
				token_type: "Bearer",
				expires_in: 100,
				scope: "read",
			}),
		);

		await expect(
			runOAuthStep({
				fetchImpl,
				openBrowser: async () => undefined,
				runLocalhostCallbackImpl: async ({ expectedState }) => ({
					code: "C",
					state: expectedState,
				}),
			}),
		).rejects.toThrow(/Could not validate the OAuth access token/);
	});
});

// ─────────────────────────────────────────────────────────────────────
//  runOAuthRevoke
// ─────────────────────────────────────────────────────────────────────

describe("runOAuthRevoke", () => {
	it("returns false when no state exists", async () => {
		const result = await runOAuthRevoke();
		expect(result.revoked).toBe(false);
		expect(result.message).toMatch(/No OAuth state/);
	});

	it("revokes and removes oauth.json on success", async () => {
		await fs.mkdir(`${TEST_HOME}/.config/el-linear`, {
			recursive: true,
			mode: 0o700,
		});
		await fs.writeFile(
			`${TEST_HOME}/.config/el-linear/oauth.json`,
			JSON.stringify({
				v: 1,
				clientId: "c",
				registeredRedirectUri: "http://localhost:8765/oauth/callback",
				accessToken: "tok-revoke-me",
				tokenType: "Bearer",
				scopes: ["read"],
				expiresAt: Date.now() + 60_000,
				obtainedAt: Date.now(),
			}),
			{ mode: 0o600 },
		);

		const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, true, 200));
		const result = await runOAuthRevoke({ fetchImpl });
		expect(result.revoked).toBe(true);
		expect(result.message).toMatch(/revoked/i);
		await expect(
			fs.stat(`${TEST_HOME}/.config/el-linear/oauth.json`),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("removes oauth.json even if the network revoke fails", async () => {
		await fs.mkdir(`${TEST_HOME}/.config/el-linear`, {
			recursive: true,
			mode: 0o700,
		});
		await fs.writeFile(
			`${TEST_HOME}/.config/el-linear/oauth.json`,
			JSON.stringify({
				v: 1,
				clientId: "c",
				registeredRedirectUri: "http://localhost:8765/oauth/callback",
				accessToken: "doomed",
				tokenType: "Bearer",
				scopes: ["read"],
				expiresAt: Date.now() + 1,
				obtainedAt: Date.now(),
			}),
			{ mode: 0o600 },
		);

		const fetchImpl = vi.fn<FetchLike>(async () => ({
			ok: false,
			status: 500,
			statusText: "Server Error",
			text: async () => "boom",
		}));
		const result = await runOAuthRevoke({ fetchImpl });
		expect(result.revoked).toBe(false);
		await expect(
			fs.stat(`${TEST_HOME}/.config/el-linear/oauth.json`),
		).rejects.toMatchObject({ code: "ENOENT" });
	});
});
