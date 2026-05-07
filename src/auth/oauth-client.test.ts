import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	ALL_SCOPES,
	buildAuthorizeUrl,
	DEFAULT_SCOPES,
	generatePkce,
	generateState,
	parseCallbackUrl,
	validateScopes,
} from "./oauth-client.js";

describe("generatePkce", () => {
	it("returns base64url verifier ≥43 chars and matching S256 challenge", () => {
		const { verifier, challenge, method } = generatePkce();
		expect(method).toBe("S256");
		expect(verifier.length).toBeGreaterThanOrEqual(43);
		// base64url has no `+/=` characters.
		expect(verifier).not.toMatch(/[+/=]/);
		// Challenge must be SHA256(verifier) base64url-encoded.
		const expected = createHash("sha256")
			.update(verifier)
			.digest()
			.toString("base64url");
		expect(challenge).toBe(expected);
	});

	it("produces unique verifiers across calls", () => {
		const a = generatePkce();
		const b = generatePkce();
		expect(a.verifier).not.toBe(b.verifier);
	});
});

describe("generateState", () => {
	it("returns a non-empty base64url string", () => {
		const s = generateState();
		expect(s.length).toBeGreaterThanOrEqual(20);
		expect(s).not.toMatch(/[+/=]/);
	});
});

describe("buildAuthorizeUrl", () => {
	it("includes all required PKCE + state params", () => {
		const url = new URL(
			buildAuthorizeUrl({
				clientId: "client-abc",
				redirectUri: "http://localhost:8765/oauth/callback",
				scopes: ["read", "write"],
				state: "state-xyz",
				codeChallenge: "challenge-123",
			}),
		);
		expect(url.origin + url.pathname).toBe(
			"https://linear.app/oauth/authorize",
		);
		expect(url.searchParams.get("client_id")).toBe("client-abc");
		expect(url.searchParams.get("redirect_uri")).toBe(
			"http://localhost:8765/oauth/callback",
		);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("scope")).toBe("read,write");
		expect(url.searchParams.get("state")).toBe("state-xyz");
		expect(url.searchParams.get("code_challenge")).toBe("challenge-123");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
	});

	it("encodes the scope comma in the URL output (defensive)", () => {
		const url = buildAuthorizeUrl({
			clientId: "c",
			redirectUri: "http://l/cb",
			scopes: ["read", "issues:create"],
			state: "s",
			codeChallenge: "ch",
		});
		// URLSearchParams encodes `,` as `%2C` and `:` as `%3A`.
		expect(url).toContain("scope=read%2Cissues%3Acreate");
	});

	it("supports the optional prompt=consent flag", () => {
		const url = new URL(
			buildAuthorizeUrl({
				clientId: "c",
				redirectUri: "http://l/cb",
				scopes: ["read"],
				state: "s",
				codeChallenge: "ch",
				prompt: "consent",
			}),
		);
		expect(url.searchParams.get("prompt")).toBe("consent");
	});
});

describe("parseCallbackUrl", () => {
	it("extracts code + state from a happy-path callback", () => {
		const result = parseCallbackUrl(
			"http://localhost:8765/oauth/callback?code=AUTHCODE&state=ABC",
		);
		expect(result).toEqual({ code: "AUTHCODE", state: "ABC" });
	});

	it("works on a path-only URL", () => {
		const result = parseCallbackUrl("/oauth/callback?code=X&state=Y");
		expect(result.code).toBe("X");
		expect(result.state).toBe("Y");
	});

	it("throws when `code` is missing", () => {
		expect(() => parseCallbackUrl("/oauth/callback?state=Y")).toThrow(/code/);
	});

	it("throws when `state` is missing", () => {
		expect(() => parseCallbackUrl("/oauth/callback?code=X")).toThrow(/state/);
	});

	it("surfaces an OAuth error parameter", () => {
		expect(() =>
			parseCallbackUrl(
				"/oauth/callback?error=access_denied&error_description=user+cancelled",
			),
		).toThrow(/access_denied/);
	});
});

describe("validateScopes", () => {
	it("accepts the documented scopes", () => {
		expect(validateScopes([...DEFAULT_SCOPES])).toEqual([...DEFAULT_SCOPES]);
	});

	it("trims whitespace before checking", () => {
		expect(validateScopes(["  read  ", "write"])).toEqual(["read", "write"]);
	});

	it("throws on an unknown scope", () => {
		expect(() => validateScopes(["read", "totally-fake"])).toThrow(
			/Unknown OAuth scope/,
		);
	});

	it("throws when no scopes are supplied", () => {
		expect(() => validateScopes([])).toThrow(/at least one/i);
	});
});

describe("constants", () => {
	it("DEFAULT_SCOPES is a subset of ALL_SCOPES", () => {
		const all = new Set<string>(ALL_SCOPES);
		for (const s of DEFAULT_SCOPES) {
			expect(all.has(s)).toBe(true);
		}
	});
});
