import { describe, expect, it } from "vitest";
import { sanitizeForLog } from "./token.js";

describe("sanitizeForLog", () => {
	it("redacts a Linear API token from a string", () => {
		expect(sanitizeForLog("Bearer lin_api_abc123def456ghi789xyz extra")).toBe(
			"Bearer lin_api_***REDACTED*** extra",
		);
	});

	it("redacts multiple tokens in the same string", () => {
		const input = "lin_api_aaaaaaaaaaaaaaaa and lin_api_bbbbbbbbbbbbbbbb";
		expect(sanitizeForLog(input)).toBe(
			"lin_api_***REDACTED*** and lin_api_***REDACTED***",
		);
	});

	it("does not redact short non-token strings that happen to start with lin_api_", () => {
		// Real tokens are long. A string with the prefix but only 8 chars is
		// likely a placeholder / fake; redacting would create false positives.
		// Token regex requires 16+ trailing chars.
		expect(sanitizeForLog("lin_api_short")).toBe("lin_api_short");
	});

	it("preserves text without tokens", () => {
		expect(sanitizeForLog("Network error: ECONNREFUSED")).toBe(
			"Network error: ECONNREFUSED",
		);
	});

	it("redacts tokens embedded in JSON-like error wrappers", () => {
		const input = `{"headers":{"Authorization":"Bearer lin_api_secrettoken123456"}}`;
		expect(sanitizeForLog(input)).toBe(
			`{"headers":{"Authorization":"Bearer lin_api_***REDACTED***"}}`,
		);
	});

	it("redacts OAuth access tokens (lin_oauth_ prefix)", () => {
		expect(sanitizeForLog("authorized: lin_oauth_abcdef0123456789xyz")).toBe(
			"authorized: lin_oauth_***REDACTED***",
		);
	});

	it("redacts mixed lin_api_ and lin_oauth_ in the same string", () => {
		const input =
			"old: lin_api_personalkey1234567 new: lin_oauth_accesskey1234567";
		expect(sanitizeForLog(input)).toBe(
			"old: lin_api_***REDACTED*** new: lin_oauth_***REDACTED***",
		);
	});

	it("redacts a high-entropy bearer payload even without the lin_ prefix", () => {
		const input =
			"got: Authorization: ABCDEFGH0123456789abcdefghABCDEFGH0123456789xyz";
		expect(sanitizeForLog(input)).toBe("got: Authorization: ***REDACTED***");
	});

	it("does not redact short alphanumerics adjacent to Bearer", () => {
		expect(sanitizeForLog("Bearer abc123")).toBe("Bearer abc123");
	});
});
