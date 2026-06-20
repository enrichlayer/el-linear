import { describe, expect, it, vi } from "vitest";
import {
	isRegistryConfigured,
	resolveViaRegistry,
} from "./registry-resolve.js";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const ENV = { EL_IDENTITY_URL: "https://cp.example" } as NodeJS.ProcessEnv;

describe("isRegistryConfigured", () => {
	it("is false when EL_IDENTITY_URL is unset or blank (opt-in default)", () => {
		expect(isRegistryConfigured({} as NodeJS.ProcessEnv)).toBe(false);
		expect(
			isRegistryConfigured({ EL_IDENTITY_URL: "   " } as NodeJS.ProcessEnv),
		).toBe(false);
	});

	it("is true only when EL_IDENTITY_URL is set", () => {
		expect(isRegistryConfigured(ENV)).toBe(true);
	});
});

describe("resolveViaRegistry", () => {
	it("returns null without fetching when not configured", async () => {
		const fetchImpl = vi.fn();
		await expect(
			resolveViaRegistry("dima", {} as NodeJS.ProcessEnv, fetchImpl),
		).resolves.toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("returns the linearId on a 200 hit and targets the resolve endpoint", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			jsonResponse({
				linearId: "5bae6897-ce50-406e-8492-e3f4bdee877e",
				gitlab: "dmitriiiii",
			}),
		);
		await expect(resolveViaRegistry("dima", ENV, fetchImpl)).resolves.toBe(
			"5bae6897-ce50-406e-8492-e3f4bdee877e",
		);
		expect(fetchImpl.mock.calls[0][0]).toBe(
			"https://cp.example/api/people/resolve?identifier=dima",
		);
	});

	it("attaches CF-Access headers when both env halves are present", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(jsonResponse({ linearId: "x" }));
		await resolveViaRegistry(
			"dima",
			{
				...ENV,
				EL_IDENTITY_CF_ACCESS_CLIENT_ID: "id",
				EL_IDENTITY_CF_ACCESS_CLIENT_SECRET: "sec",
			} as NodeJS.ProcessEnv,
			fetchImpl,
		);
		const headers = fetchImpl.mock.calls[0][1].headers as Record<
			string,
			string
		>;
		expect(headers["CF-Access-Client-Id"]).toBe("id");
		expect(headers["CF-Access-Client-Secret"]).toBe("sec");
	});

	it("returns null on 404 / non-ok", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(jsonResponse({ error: "no match" }, 404));
		await expect(
			resolveViaRegistry("ghost", ENV, fetchImpl),
		).resolves.toBeNull();
	});

	it("returns null on a Cloudflare-Access 302 bounce", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 302 }));
		await expect(
			resolveViaRegistry("dima", ENV, fetchImpl),
		).resolves.toBeNull();
	});

	it("returns null on a network error — never throws", async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		await expect(
			resolveViaRegistry("dima", ENV, fetchImpl),
		).resolves.toBeNull();
	});

	it("returns null when the record carries no linearId", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(jsonResponse({ name: "Dmitrii", linearId: null }));
		await expect(
			resolveViaRegistry("dima", ENV, fetchImpl),
		).resolves.toBeNull();
	});
});
