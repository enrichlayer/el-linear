import { describe, expect, it, vi } from "vitest";
import { promptForPastedCode } from "./oauth-headless.js";

describe("promptForPastedCode", () => {
	it("accepts a full callback URL and validates state", async () => {
		const prompt = vi.fn(
			async () => "http://localhost:8765/oauth/callback?code=AC&state=ST",
		);
		const result = await promptForPastedCode({
			expectedState: "ST",
			prompt,
		});
		expect(result).toEqual({ code: "AC", state: "ST" });
	});

	it("rejects a callback URL with the wrong state", async () => {
		const prompt = vi.fn(
			async () => "http://localhost:8765/oauth/callback?code=AC&state=ATTACKER",
		);
		await expect(
			promptForPastedCode({ expectedState: "ST", prompt }),
		).rejects.toThrow(/State mismatch/);
	});

	it("accepts a bare code string and trusts the expected state", async () => {
		const prompt = vi.fn(async () => "  abcd-1234-efgh  ");
		const result = await promptForPastedCode({
			expectedState: "EXPECTED",
			prompt,
		});
		expect(result).toEqual({ code: "abcd-1234-efgh", state: "EXPECTED" });
	});

	it("rejects a malformed paste with `=` or `?`", async () => {
		const prompt = vi.fn(async () => "code=foo");
		await expect(
			promptForPastedCode({ expectedState: "EXPECTED", prompt }),
		).rejects.toThrow(/malformed/);
	});

	it("propagates underlying URL parse errors (bad URL → wrapped)", async () => {
		const prompt = vi.fn(async () => "http://localhost:8765/oauth/callback");
		await expect(
			promptForPastedCode({ expectedState: "ST", prompt }),
		).rejects.toThrow(/code/);
	});
});
