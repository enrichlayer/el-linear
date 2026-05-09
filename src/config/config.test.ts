import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let existsSyncReturn: boolean;
let readFileSyncReturn: string;

vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn(() => existsSyncReturn),
		readFileSync: vi.fn(() => readFileSyncReturn),
	},
}));

describe("loadConfig", () => {
	beforeEach(() => {
		existsSyncReturn = false;
		readFileSyncReturn = "{}";
		// Reset module cache so cachedConfig is cleared
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns defaults when no config file exists", async () => {
		existsSyncReturn = false;
		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultTeam).toBe("");
		expect(config.defaultLabels).toEqual([]);
		expect(config.statusDefaults.noProject).toBe("Triage");
		expect(config.statusDefaults.withAssigneeAndProject).toBe("Todo");
	});

	it("deep merges user config with defaults", async () => {
		existsSyncReturn = true;
		readFileSyncReturn = JSON.stringify({
			defaultTeam: "FE",
			teams: { FE: "fe-uuid" },
		});
		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultTeam).toBe("FE");
		expect(config.teams.FE).toBe("fe-uuid");
		// Defaults preserved for unset fields
		expect(config.statusDefaults.noProject).toBe("Triage");
		expect(config.members.aliases).toEqual({});
	});

	it("deeply merges nested objects", async () => {
		existsSyncReturn = true;
		readFileSyncReturn = JSON.stringify({
			members: { aliases: { bob: "Bob" } },
		});
		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.members.aliases.bob).toBe("Bob");
		expect(config.members.uuids).toEqual({});
	});

	it("caches config on subsequent calls", async () => {
		existsSyncReturn = false;
		const { loadConfig } = await import("./config.js");
		const first = loadConfig();
		const second = loadConfig();
		expect(first).toBe(second);
	});

	it("cache is keyed by active profile (ALL-935 deferred)", async () => {
		// Pre-fix: the cachedConfig was a single slot. Switching the
		// active profile mid-process and calling loadConfig again
		// returned the OLD profile's config. Post-fix: each profile
		// gets its own cache slot, so a profile switch returns the
		// correct config.
		vi.resetModules();
		const { loadConfig, _resetConfigCacheForTests } = await import(
			"./config.js"
		);
		const { setActiveProfileForSession } = await import("./paths.js");
		_resetConfigCacheForTests();

		try {
			// Profile A.
			existsSyncReturn = true;
			readFileSyncReturn = JSON.stringify({ defaultTeam: "AAA" });
			setActiveProfileForSession("alpha");
			const configA = loadConfig();
			expect(configA.defaultTeam).toBe("AAA");

			// Switch to profile B mid-process. With the old single-slot
			// cache this would re-return AAA; with the keyed cache it
			// reads the new profile's config.
			readFileSyncReturn = JSON.stringify({ defaultTeam: "BBB" });
			setActiveProfileForSession("bravo");
			const configB = loadConfig();
			expect(configB.defaultTeam).toBe("BBB");

			// Switch BACK to alpha — should hit the cache and return AAA
			// without reading from disk again.
			readFileSyncReturn = JSON.stringify({ defaultTeam: "CCC" });
			setActiveProfileForSession("alpha");
			const configA2 = loadConfig();
			expect(configA2.defaultTeam).toBe("AAA");
			expect(configA2).toBe(configA);
		} finally {
			setActiveProfileForSession(null);
		}
	});

	it("handles parse errors gracefully", async () => {
		existsSyncReturn = true;
		readFileSyncReturn = "invalid json!!!";
		const { loadConfig } = await import("./config.js");
		const { resetWarnings, outputSuccess } = await import("../utils/output.js");
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		resetWarnings();
		const config = loadConfig();
		expect(config.defaultTeam).toBe("");
		// Warning is buffered, verify by flushing through outputSuccess
		outputSuccess({ check: true });
		const output = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trimEnd());
		expect(output._warnings).toBeDefined();
		stdoutSpy.mockRestore();
	});
});
