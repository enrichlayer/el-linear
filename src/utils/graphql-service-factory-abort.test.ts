import { afterEach, expect, it, vi } from "vitest";
import type { GetActiveAuthOptions } from "../auth/token-resolver.js";

const { auth, renew } = vi.hoisted(() => ({ auth: vi.fn(), renew: vi.fn() }));
vi.mock("../auth/token-resolver.js", () => ({
	getActiveAuth: auth,
	ensureFreshAccessToken: renew,
}));

import { createGraphQLService } from "./graphql-service.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it("bounded factory forwards the same cancellation to existing OAuth refresh", async () => {
	const controller = new AbortController();
	let refreshSignal: AbortSignal | null | undefined;
	const fetch = vi.fn(
		(_url: unknown, init?: RequestInit) =>
			new Promise<Response>((_, reject) => {
				refreshSignal = init?.signal;
				refreshSignal?.addEventListener(
					"abort",
					() => reject(new Error("refresh aborted")),
					{ once: true },
				);
			}),
	);
	vi.stubGlobal("fetch", fetch);
	auth.mockImplementation(async (options: GetActiveAuthOptions) => {
		await options.fetchImpl?.("https://synthetic.invalid", {
			method: "POST",
			headers: {},
			body: "synthetic",
		});
		return { kind: "personal", token: "synthetic" };
	});
	const pending = createGraphQLService({}, { signal: controller.signal });
	const failed = expect(pending).rejects.toThrow(/refresh aborted/);
	expect(refreshSignal).toBe(controller.signal);
	controller.abort();
	await failed;
});

it("unsignaled callers keep the original auth options contract", async () => {
	auth.mockResolvedValue({ kind: "personal", token: "synthetic" });
	await createGraphQLService({ apiToken: "synthetic" });
	expect(auth).toHaveBeenCalledWith({ apiToken: "synthetic" });
});
