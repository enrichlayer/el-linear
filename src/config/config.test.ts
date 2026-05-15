import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Path-keyed file system mock. Tests set entries in `fsFiles` to control which
// paths exist and what they contain. Paths absent from the map fall through to
// the `defaultExistsSync` / `defaultReadFileSync` booleans for backward compat
// with tests that don't care about specific paths.
const fsFiles = new Map<string, string | null>(); // null = does not exist
let defaultExistsReturn: boolean;
let defaultReadReturn: string;

vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn((p: string) => {
			if (fsFiles.has(p)) return fsFiles.get(p) !== null;
			return defaultExistsReturn;
		}),
		readFileSync: vi.fn((p: string) => {
			if (fsFiles.has(p)) {
				const content = fsFiles.get(p);
				if (content === null) throw new Error(`ENOENT: ${p}`);
				return content;
			}
			return defaultReadReturn;
		}),
	},
}));

describe("loadConfig", () => {
	beforeEach(() => {
		fsFiles.clear();
		defaultExistsReturn = false;
		defaultReadReturn = "{}";
		vi.resetModules();
		// Clear EL_LINEAR_TEAM_CONFIG so tests don't bleed into each other.
		delete process.env.EL_LINEAR_TEAM_CONFIG;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.EL_LINEAR_TEAM_CONFIG;
	});

	it("returns defaults when no config file exists", async () => {
		defaultExistsReturn = false;
		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultTeam).toBe("");
		expect(config.defaultLabels).toEqual([]);
		expect(config.statusDefaults.noProject).toBe("Triage");
		expect(config.statusDefaults.withAssigneeAndProject).toBe("Todo");
	});

	it("deep merges user config with defaults", async () => {
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({
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
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({
			members: { aliases: { bob: "Bob" } },
		});
		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.members.aliases.bob).toBe("Bob");
		expect(config.members.uuids).toEqual({});
	});

	it("caches config on subsequent calls", async () => {
		defaultExistsReturn = false;
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
			defaultExistsReturn = true;
			defaultReadReturn = JSON.stringify({ defaultTeam: "AAA" });
			setActiveProfileForSession("alpha");
			const configA = loadConfig();
			expect(configA.defaultTeam).toBe("AAA");

			// Switch to profile B mid-process. With the old single-slot
			// cache this would re-return AAA; with the keyed cache it
			// reads the new profile's config.
			defaultReadReturn = JSON.stringify({ defaultTeam: "BBB" });
			setActiveProfileForSession("bravo");
			const configB = loadConfig();
			expect(configB.defaultTeam).toBe("BBB");

			// Switch BACK to alpha — should hit the cache and return AAA
			// without reading from disk again.
			defaultReadReturn = JSON.stringify({ defaultTeam: "CCC" });
			setActiveProfileForSession("alpha");
			const configA2 = loadConfig();
			expect(configA2.defaultTeam).toBe("AAA");
			expect(configA2).toBe(configA);
		} finally {
			setActiveProfileForSession(null);
		}
	});

	it("handles parse errors gracefully", async () => {
		defaultExistsReturn = true;
		defaultReadReturn = "invalid json!!!";
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

describe("loadConfig — team config layer", () => {
	beforeEach(() => {
		fsFiles.clear();
		defaultExistsReturn = false;
		defaultReadReturn = "{}";
		vi.resetModules();
		delete process.env.EL_LINEAR_TEAM_CONFIG;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.EL_LINEAR_TEAM_CONFIG;
	});

	it("merges team config under personal config (personal wins)", async () => {
		const teamPath = "/shared/team-config.json";
		const personalPath = "/home/.config/el-linear/config.json";

		fsFiles.set(
			teamPath,
			JSON.stringify({
				members: { aliases: { alice: "Alice Smith", bob: "Bob Jones" } },
				defaultTeam: "ENG",
			}),
		);
		fsFiles.set(
			personalPath,
			JSON.stringify({
				members: { aliases: { alice: "Ali" } }, // override team alias for alice
				defaultAssignee: "me",
			}),
		);

		// Point personal config at the team config.
		// We wire teamConfigPath by using the env var to avoid having to
		// know the personal config's exact on-disk path in this unit test.
		process.env.EL_LINEAR_TEAM_CONFIG = teamPath;
		// Override defaultExists so personal path reads succeed via fsFiles.
		defaultExistsReturn = false; // fsFiles.has() takes precedence for known paths

		// Re-point default read to the personal config content.
		// Use a path-specific entry so both files resolve correctly.
		// Personal config is at the legacy CONFIG_PATH. We set it via defaultRead.
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({
			members: { aliases: { alice: "Ali" } },
			defaultAssignee: "me",
		});

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();

		// alice is overridden by personal config
		expect(config.members.aliases.alice).toBe("Ali");
		// bob comes from team config (not in personal)
		expect(config.members.aliases.bob).toBe("Bob Jones");
		// defaultTeam from team config (not set in personal)
		expect(config.defaultTeam).toBe("ENG");
		// personal-only field
		expect(config.defaultAssignee).toBe("me");
	});

	it("env var EL_LINEAR_TEAM_CONFIG overrides teamConfigPath in personal config", async () => {
		const envTeamPath = "/env/team-config.json";
		const personalTeamPath = "/personal/team-config.json";

		fsFiles.set(envTeamPath, JSON.stringify({ defaultTeam: "FROM_ENV" }));
		fsFiles.set(
			personalTeamPath,
			JSON.stringify({ defaultTeam: "FROM_PERSONAL" }),
		);

		process.env.EL_LINEAR_TEAM_CONFIG = envTeamPath;
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({ teamConfigPath: personalTeamPath });

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultTeam).toBe("FROM_ENV");
	});

	it("teamConfigPath in personal config is used when env var is absent", async () => {
		const teamPath = "/shared/team.json";
		fsFiles.set(teamPath, JSON.stringify({ defaultTeam: "TEAM_DEFAULT" }));

		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({ teamConfigPath: teamPath });

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultTeam).toBe("TEAM_DEFAULT");
	});

	it("strips teamConfigPath from team config to prevent circular references", async () => {
		const teamPath = "/shared/team.json";
		fsFiles.set(
			teamPath,
			JSON.stringify({
				teamConfigPath: "/other/nested.json", // should be stripped
				defaultTeam: "TEAM",
			}),
		);

		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({ teamConfigPath: teamPath });

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		// teamConfigPath from team config is stripped; personal config's value survives
		expect(config.teamConfigPath).toBe(teamPath);
		expect(config.defaultTeam).toBe("TEAM");
	});

	it("warns and continues when team config file is missing", async () => {
		const missingTeamPath = "/nonexistent/team.json";
		fsFiles.set(missingTeamPath, null); // explicitly absent
		process.env.EL_LINEAR_TEAM_CONFIG = missingTeamPath;
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({ defaultTeam: "PERSONAL" });

		const { loadConfig } = await import("./config.js");
		const { resetWarnings, outputSuccess } = await import("../utils/output.js");
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		resetWarnings();

		const config = loadConfig();
		expect(config.defaultTeam).toBe("PERSONAL");

		outputSuccess({ ok: true });
		const output = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trimEnd());
		expect(output._warnings).toBeDefined();
		expect(
			(output._warnings as string[]).some((w: string) =>
				w.includes("Team config not found"),
			),
		).toBe(true);

		stdoutSpy.mockRestore();
	});

	it("warns and continues when team config has invalid JSON", async () => {
		const teamPath = "/shared/bad.json";
		fsFiles.set(teamPath, "not valid json {{");

		process.env.EL_LINEAR_TEAM_CONFIG = teamPath;
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({ defaultTeam: "PERSONAL" });

		const { loadConfig } = await import("./config.js");
		const { resetWarnings, outputSuccess } = await import("../utils/output.js");
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		resetWarnings();

		const config = loadConfig();
		expect(config.defaultTeam).toBe("PERSONAL");

		outputSuccess({ ok: true });
		const output = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trimEnd());
		expect(output._warnings).toBeDefined();
		expect(
			(output._warnings as string[]).some((w: string) =>
				w.includes("Failed to parse team config"),
			),
		).toBe(true);

		stdoutSpy.mockRestore();
	});

	it("team config merges members from both layers", async () => {
		const teamPath = "/shared/team.json";
		fsFiles.set(
			teamPath,
			JSON.stringify({
				members: {
					aliases: { alice: "Alice", bob: "Bob" },
					uuids: { alice: "uuid-alice" },
				},
			}),
		);

		process.env.EL_LINEAR_TEAM_CONFIG = teamPath;
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({
			members: {
				aliases: { charlie: "Charlie" },
				uuids: { charlie: "uuid-charlie" },
			},
		});

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();

		// All aliases present from both layers
		expect(config.members.aliases.alice).toBe("Alice");
		expect(config.members.aliases.bob).toBe("Bob");
		expect(config.members.aliases.charlie).toBe("Charlie");
		// UUIDs from both layers
		expect(config.members.uuids.alice).toBe("uuid-alice");
		expect(config.members.uuids.charlie).toBe("uuid-charlie");
	});
});
