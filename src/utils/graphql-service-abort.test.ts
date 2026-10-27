import { afterEach, expect, it, vi } from "vitest";
import { GraphQLService } from "./graphql-service.js";

afterEach(() => vi.unstubAllGlobals());

it("real SDK transport receives the read signal and aborts its underlying fetch", async () => {
	const controller = new AbortController();
	let received: AbortSignal | null | undefined;
	const fetch = vi.fn(
		(_url: unknown, options?: RequestInit) =>
			new Promise((_resolve, reject) => {
				received = options?.signal;
				received?.addEventListener(
					"abort",
					() => reject(new Error("transport aborted")),
					{ once: true },
				);
			}),
	);
	vi.stubGlobal("fetch", fetch);
	const service = new GraphQLService(
		{ apiKey: "synthetic" },
		{
			signal: controller.signal,
			admission: {
				enabled: false,
				admit: async () => {},
				observe: async () => {},
			},
		},
	);
	const pending = service.rawRequest("query { viewer { id } }");
	const failed = expect(pending).rejects.toThrow();
	await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
	expect(received).toBe(controller.signal);
	controller.abort();
	await failed;
});

it("late quota admission cannot dispatch after the read was aborted", async () => {
	const controller = new AbortController();
	let admit!: () => void;
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	const service = new GraphQLService(
		{ apiKey: "synthetic" },
		{
			signal: controller.signal,
			admission: {
				enabled: false,
				admit: () =>
					new Promise((resolve) => {
						admit = resolve;
					}),
				observe: async () => {},
			},
		},
	);
	const pending = service.rawRequest("query { viewer { id } }");
	const failed = expect(pending).rejects.toThrow();
	controller.abort();
	admit();
	await failed;
	expect(fetch).not.toHaveBeenCalled();
});
