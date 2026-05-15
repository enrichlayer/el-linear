import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Path-keyed file system mock. Tests set entries in `fsFiles` to control which
// paths exist and what they contain. Paths absent from the map fall through to
// the `defaultExistsReturn` / `defaultReadReturn` booleans for backward compat
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
		vi.resetModules();
		const { loadConfig, _resetConfigCacheForTests } = await import(
			"./config.js"
		);
		const { setActiveProfileForSession } = await import("./paths.js");
		_resetConfigCacheForTests();

		try {
			defaultExistsReturn = true;
			defaultReadReturn = JSON.stringify({ defaultTeam: "AAA" });
			setActiveProfileForSession("alpha");
			const configA = loadConfig();
			expect(configA.defaultTeam).toBe("AAA");

			defaultReadReturn = JSON.stringify({ defaultTeam: "BBB" });
			setActiveProfileForSession("bravo");
			const configB = loadConfig();
			expect(configB.defaultTeam).toBe("BBB");

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

		fsFiles.set(
			teamPath,
			JSON.stringify({
				members: { aliases: { alice: "Alice Smith", bob: "Bob Jones" } },
				defaultTeam: "ENG",
			}),
		);

		process.env.EL_LINEAR_TEAM_CONFIG = teamPath;
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({
			members: { aliases: { alice: "Ali" } },
			defaultAssignee: "me",
		});

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();

		expect(config.members.aliases.alice).toBe("Ali");
		expect(config.members.aliases.bob).toBe("Bob Jones");
		expect(config.defaultTeam).toBe("ENG");
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

	it("missing team config file emits warning and falls back to personal config", async () => {
		process.env.EL_LINEAR_TEAM_CONFIG = "/nonexistent/team.json";
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({ defaultTeam: "PERSONAL" });
		fsFiles.set("/nonexistent/team.json", null);

		const { loadConfig } = await import("./config.js");
		const { resetWarnings, outputSuccess } = await import("../utils/output.js");
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		resetWarnings();
		const config = loadConfig();
		expect(config.defaultTeam).toBe("PERSONAL");
		outputSuccess({ check: true });
		const out = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trimEnd());
		expect(out._warnings?.some((w: string) => w.includes("Team config not found"))).toBe(true);
		stdoutSpy.mockRestore();
	});

	it("teamConfigPath inside team config is stripped (circular reference prevention)", async () => {
		const teamPath = "/team.json";
		fsFiles.set(
			teamPath,
			JSON.stringify({
				teamConfigPath: "/another/team.json",
				defaultTeam: "TEAM",
			}),
		);
		process.env.EL_LINEAR_TEAM_CONFIG = teamPath;
		defaultExistsReturn = false;

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultTeam).toBe("TEAM");
		expect(config.teamConfigPath).toBeUndefined();
	});

	it("arrays (terms) are concatenated across team and personal layers", async () => {
		const teamPath = "/team.json";
		fsFiles.set(
			teamPath,
			JSON.stringify({
				terms: [{ canonical: "Foo", reject: ["foo"] }],
			}),
		);
		process.env.EL_LINEAR_TEAM_CONFIG = teamPath;
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({
			terms: [{ canonical: "Bar", reject: ["bar"] }],
		});

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.terms).toHaveLength(2);
		expect(config.terms[0].canonical).toBe("Foo");
		expect(config.terms[1].canonical).toBe("Bar");
	});
});

describe("loadLocalConfig", () => {
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

	it("returns empty object when local.json does not exist", async () => {
		defaultExistsReturn = false;
		const { loadLocalConfig } = await import("./config.js");
		const local = loadLocalConfig();
		expect(local).toEqual({});
	});

	it("returns parsed local.json when it exists", async () => {
		fsFiles.set(
			`${process.env.HOME}/.config/el-linear/local.json`,
			JSON.stringify({ assigneeEmail: "you@example.com" }),
		);
		defaultExistsReturn = false;
		const { loadLocalConfig } = await import("./config.js");
		const local = loadLocalConfig();
		expect(local.assigneeEmail).toBe("you@example.com");
	});

	it("returns empty object on parse error (fail-open)", async () => {
		defaultExistsReturn = true;
		defaultReadReturn = "not json";
		const { loadLocalConfig } = await import("./config.js");
		const local = loadLocalConfig();
		expect(local).toEqual({});
	});
});

describe("loadConfig — local.json overlay", () => {
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

	it("assigneeEmail in local.json becomes defaultAssignee in resolved config", async () => {
		const localPath = `${process.env.HOME}/.config/el-linear/local.json`;
		fsFiles.set(localPath, JSON.stringify({ assigneeEmail: "ytspar@gmail.com" }));
		defaultExistsReturn = true;
		defaultReadReturn = JSON.stringify({ defaultTeam: "DEV" });

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultAssignee).toBe("ytspar@gmail.com");
		expect(config.defaultTeam).toBe("DEV");
	});

	it("local defaultAssignee takes precedence over local assigneeEmail", async () => {
		const localPath = `${process.env.HOME}/.config/el-linear/local.json`;
		fsFiles.set(
			localPath,
			JSON.stringify({ assigneeEmail: "email@example.com", defaultAssignee: "alias-name" }),
		);
		defaultExistsReturn = false;

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultAssignee).toBe("alias-name");
	});

	it("local config wins over team config", async () => {
		const teamPath = "/team.json";
		const localPath = `${process.env.HOME}/.config/el-linear/local.json`;
		fsFiles.set(teamPath, JSON.stringify({ defaultPriority: "low" }));
		fsFiles.set(localPath, JSON.stringify({ defaultPriority: "high" }));
		process.env.EL_LINEAR_TEAM_CONFIG = teamPath;
		defaultExistsReturn = false;

		const { loadConfig } = await import("./config.js");
		const config = loadConfig();
		expect(config.defaultPriority).toBe("high");
	});
});
