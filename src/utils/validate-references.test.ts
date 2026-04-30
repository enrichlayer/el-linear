import { describe, expect, it, vi } from "vitest";
import type { LinearService } from "./linear-service.js";
import { validateReferences } from "./validate-references.js";

function makeLinearService(
	impl: (id: string) => Promise<string>,
): LinearService {
	return { resolveIssueId: vi.fn(impl) } as unknown as LinearService;
}

describe("validateReferences", () => {
	it("returns empty map for empty input", async () => {
		const ls = makeLinearService(() => Promise.resolve("uuid"));
		expect((await validateReferences([], ls)).size).toBe(0);
	});

	it("includes only identifiers that resolve", async () => {
		const ls = makeLinearService((id) =>
			id === "DEV-100"
				? Promise.resolve("uuid-100")
				: Promise.reject(new Error(`Issue "${id}" not found`)),
		);
		const result = await validateReferences(["DEV-100", "GHOST-999"], ls);
		expect([...result.entries()]).toEqual([["DEV-100", "uuid-100"]]);
	});

	it("deduplicates input identifiers", async () => {
		const resolveIssueId = vi.fn((id: string) => Promise.resolve(`uuid-${id}`));
		const ls = { resolveIssueId } as unknown as LinearService;
		const result = await validateReferences(
			["DEV-100", "DEV-100", "DEV-200"],
			ls,
		);
		expect([...result.entries()]).toEqual([
			["DEV-100", "uuid-DEV-100"],
			["DEV-200", "uuid-DEV-200"],
		]);
		expect(resolveIssueId).toHaveBeenCalledTimes(2);
	});

	it("does not throw when all resolutions fail", async () => {
		const ls = makeLinearService((id) =>
			Promise.reject(new Error(`Issue "${id}" not found`)),
		);
		const result = await validateReferences(["GHOST-1", "GHOST-2"], ls);
		expect(result.size).toBe(0);
	});
});
