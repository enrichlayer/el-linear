import { describe, expect, it, vi } from "vitest";
import {
	exchangeCodeForTokens,
	type FetchLike,
	refreshTokens,
	revokeToken,
} from "./oauth-token.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
	return {
		ok,
		status,
		statusText: ok ? "OK" : "Bad Request",
		text: async () => JSON.stringify(body),
	};
}

function textResponse(body: string, ok = false, status = 400) {
	return {
		ok,
		status,
		statusText: ok ? "OK" : "Bad Request",
		text: async () => body,
	};
}

describe("exchangeCodeForTokens", () => {
	it("posts the expected form-encoded params and parses the response", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "lin_oauth_a",
				token_type: "Bearer",
				expires_in: 86400,
				scope: "read,write",
				refresh_token: "refresh-r",
			}),
		);

		const result = await exchangeCodeForTokens(
			{
				clientId: "client-id",
				clientSecret: "client-secret",
				code: "AUTH_CODE",
				redirectUri: "http://localhost:8765/oauth/callback",
				codeVerifier: "VERIFIER",
			},
			fetchImpl,
			() => 1_000_000,
		);

		expect(result.accessToken).toBe("lin_oauth_a");
		expect(result.refreshToken).toBe("refresh-r");
		expect(result.tokenType).toBe("Bearer");
		expect(result.scopes).toEqual(["read", "write"]);
		expect(result.expiresAt).toBe(1_000_000 + 86400 * 1000);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe("https://api.linear.app/oauth/token");
		expect(init.method).toBe("POST");
		expect(init.headers["content-type"]).toBe(
			"application/x-www-form-urlencoded",
		);
		const body = new URLSearchParams(init.body);
		expect(body.get("grant_type")).toBe("authorization_code");
		expect(body.get("code")).toBe("AUTH_CODE");
		expect(body.get("client_id")).toBe("client-id");
		expect(body.get("client_secret")).toBe("client-secret");
		expect(body.get("code_verifier")).toBe("VERIFIER");
		expect(body.get("redirect_uri")).toBe(
			"http://localhost:8765/oauth/callback",
		);
	});

	it("omits client_secret when not provided", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "x",
				token_type: "Bearer",
				expires_in: 100,
				scope: "read",
			}),
		);

		await exchangeCodeForTokens(
			{
				clientId: "id",
				code: "code",
				redirectUri: "http://l/cb",
				codeVerifier: "v",
			},
			fetchImpl,
		);

		const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
		expect(body.get("client_secret")).toBeNull();
	});

	it("throws with status + body on non-2xx response", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			textResponse(`{"error":"invalid_grant"}`, false, 400),
		);
		await expect(
			exchangeCodeForTokens(
				{
					clientId: "id",
					code: "bad",
					redirectUri: "http://l/cb",
					codeVerifier: "v",
				},
				fetchImpl,
			),
		).rejects.toThrow(/400.*invalid_grant/);
	});

	it("throws on response without access_token", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				token_type: "Bearer",
				expires_in: 100,
				scope: "read",
			}),
		);
		await expect(
			exchangeCodeForTokens(
				{
					clientId: "id",
					code: "code",
					redirectUri: "http://l/cb",
					codeVerifier: "v",
				},
				fetchImpl,
			),
		).rejects.toThrow(/access_token/);
	});

	it("falls back to a 23h expiry when expires_in is missing", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "x",
				token_type: "Bearer",
				scope: "read",
			}),
		);
		const result = await exchangeCodeForTokens(
			{
				clientId: "id",
				code: "code",
				redirectUri: "http://l/cb",
				codeVerifier: "v",
			},
			fetchImpl,
			() => 0,
		);
		expect(result.expiresAt).toBe(23 * 60 * 60 * 1000);
	});

	it("accepts space-separated scope strings (defensive parsing)", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "x",
				token_type: "Bearer",
				expires_in: 100,
				scope: "read write issues:create",
			}),
		);
		const result = await exchangeCodeForTokens(
			{
				clientId: "id",
				code: "code",
				redirectUri: "http://l/cb",
				codeVerifier: "v",
			},
			fetchImpl,
		);
		expect(result.scopes).toEqual(["read", "write", "issues:create"]);
	});

	it("wraps network errors with a useful message", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () => {
			throw new Error("ECONNREFUSED 127.0.0.1:443");
		});
		await expect(
			exchangeCodeForTokens(
				{
					clientId: "id",
					code: "c",
					redirectUri: "http://l/cb",
					codeVerifier: "v",
				},
				fetchImpl,
			),
		).rejects.toThrow(/Network error.*ECONNREFUSED/);
	});

	it("throws on non-JSON success body", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () => textResponse("oops", true));
		await expect(
			exchangeCodeForTokens(
				{
					clientId: "id",
					code: "c",
					redirectUri: "http://l/cb",
					codeVerifier: "v",
				},
				fetchImpl,
			),
		).rejects.toThrow(/non-JSON/);
	});
});

describe("refreshTokens", () => {
	it("sends grant_type=refresh_token and parses response", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			jsonResponse({
				access_token: "new-access",
				token_type: "Bearer",
				expires_in: 86400,
				scope: "read,write",
				refresh_token: "new-refresh",
			}),
		);
		const result = await refreshTokens(
			{
				clientId: "id",
				clientSecret: "secret",
				refreshToken: "old-refresh",
			},
			fetchImpl,
			() => 0,
		);
		expect(result.accessToken).toBe("new-access");
		expect(result.refreshToken).toBe("new-refresh");
		const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
		expect(body.get("grant_type")).toBe("refresh_token");
		expect(body.get("refresh_token")).toBe("old-refresh");
		expect(body.get("client_id")).toBe("id");
		expect(body.get("client_secret")).toBe("secret");
	});

	it("throws on 4xx (refresh token expired)", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			textResponse(`{"error":"invalid_grant"}`, false, 401),
		);
		await expect(
			refreshTokens({ clientId: "id", refreshToken: "expired" }, fetchImpl),
		).rejects.toThrow(/401/);
	});
});

describe("revokeToken", () => {
	it("sends Bearer auth and reports ok=true on success", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse({}, true, 200));
		const result = await revokeToken({ accessToken: "tok-1" }, fetchImpl);
		expect(result.ok).toBe(true);
		expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe(
			"Bearer tok-1",
		);
	});

	it("does NOT throw on transport error — returns ok=false instead", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () => {
			throw new Error("network down");
		});
		const result = await revokeToken({ accessToken: "tok-1" }, fetchImpl);
		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/network down/);
	});

	it("returns ok=false + body on a 4xx response", async () => {
		const fetchImpl = vi.fn<FetchLike>(async () =>
			textResponse("invalid_token", false, 400),
		);
		const result = await revokeToken({ accessToken: "tok-1" }, fetchImpl);
		expect(result.ok).toBe(false);
		expect(result.status).toBe(400);
		expect(result.message).toBe("invalid_token");
	});
});
