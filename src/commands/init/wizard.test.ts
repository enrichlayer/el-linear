/**
 * End-to-end wizard tests with mocked inquirer prompts + mocked GraphQL.
 *
 * Each step is exercised with realistic prompt sequences so every config
 * option the wizard can write is covered: token, workspace defaults,
 * aliases (interactive walk + CSV import), default labels, status defaults,
 * and term-enforcement rules.
 *
 * The token-step happy path is intentionally split between
 * `token.test.ts` (sanitiseForLog unit tests) and here (the prompt flow).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CRITICAL: TEST_HOME and mockRawRequest must be created during the hoisted
// phase so they exist before vitest hoists the vi.mock() calls above the
// imports. Without `vi.hoisted`, the `node:os` mock factory would close over
// undefined references and the wizard's `paths.ts` would resolve against the
// real `~/.config/el-linear/`, clobbering the user's real token.
const { TEST_HOME, mockRawRequest } = vi.hoisted(() => {
	// Use require() because `vi.hoisted` runs synchronously during import
	// hoisting — top-level `await import` isn't available here.
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		TEST_HOME: nodePath.join(
			nodeOs.tmpdir(),
			`el-linear-wizard-test-${process.pid}-${Date.now()}`,
		),
		mockRawRequest: vi.fn(),
	};
});

// ── node:os mock — must be hoisted ABOVE any code that calls homedir() ──
// `paths.ts` evaluates `path.join(os.homedir(), …)` at module load. Mocking
// `node:os` at module level (vitest hoists this above the imports) makes the
// paths resolve to TEST_HOME on first import, so the wizard never touches the
// user's real ~/.config/el-linear/.
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	// `paths.ts` uses `import os from "node:os"` (default import). When vitest
	// returns a module-shaped object, the default-import binding reads
	// `module.default` — so we must override BOTH the named export AND the
	// default re-export, otherwise `os.homedir()` resolves to the real one
	// and the wizard writes to the user's actual ~/.config/el-linear/.
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

// ── Inquirer prompts mock ────────────────────────────────────────────────
vi.mock("@inquirer/prompts", () => ({
	confirm: vi.fn(),
	input: vi.fn(),
	password: vi.fn(),
	select: vi.fn(),
}));

// ── GraphQLService mock ──────────────────────────────────────────────────
// Use a class (not `vi.fn().mockImplementation(arrow)`) so `new GraphQLService()`
// works without triggering "is not a constructor".
vi.mock("../../utils/graphql-service.js", () => ({
	GraphQLService: class {
		// biome-ignore lint/suspicious/noExplicitAny: test-only stub
		rawRequest: (...args: unknown[]) => Promise<any> = (...args) =>
			mockRawRequest(...args);
	},
}));

// Top-level imports — mocks are stable across tests, so we don't need
// vi.resetModules() between cases.
import { confirm, input, password, select } from "@inquirer/prompts";
import {
	type AliasUpdate,
	fetchAllUsers,
	mergeAliasesIntoConfig,
	runAliasesImport,
	runAliasesStep,
} from "./aliases.js";
import { runDefaultsStep } from "./defaults.js";
import {
	assignDefined,
	CONFIG_PATH,
	readAliasesProgress,
	readConfig,
	TOKEN_PATH,
	writeConfig,
	writeToken,
} from "./shared.js";
import { runTokenStep, validateToken } from "./token.js";
import { runWorkspaceStep } from "./workspace.js";

beforeEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });

	// Clear all queued return values + call history between tests, but DO NOT
	// `mockReset` (which would also wipe the GraphQLService class binding).
	mockRawRequest.mockReset();
	vi.mocked(confirm).mockReset();
	vi.mocked(input).mockReset();
	vi.mocked(password).mockReset();
	vi.mocked(select).mockReset();

	// Silence wizard stdout chatter.
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
	vi.mocked(console.log).mockRestore();
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

const VALID_VIEWER = {
	id: "11111111-2222-3333-4444-555555555555",
	name: "Tester",
	email: "test@example.com",
	displayName: "Tester",
	organization: { urlKey: "acme", name: "Acme" },
};

// ─────────────────────────────────────────────────────────────────────────
//  Token step
// ─────────────────────────────────────────────────────────────────────────

describe("runTokenStep — first-time setup", () => {
	it("prompts for token, validates via viewer, writes to disk at mode 0600", async () => {
		vi.mocked(password).mockResolvedValueOnce("lin_api_validtoken1234567890");
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const result = await runTokenStep();
		expect(result.token).toBe("lin_api_validtoken1234567890");
		expect(result.viewer.organization.urlKey).toBe("acme");

		const onDisk = (await fs.readFile(TOKEN_PATH, "utf8")).trim();
		expect(onDisk).toBe("lin_api_validtoken1234567890");
		const stat = await fs.stat(TOKEN_PATH);
		expect(stat.mode & 0o777).toBe(0o600);
	});

	it("retries up to 3 times when validation fails, then succeeds", async () => {
		vi.mocked(password)
			.mockResolvedValueOnce("bad-token-1")
			.mockResolvedValueOnce("bad-token-2")
			.mockResolvedValueOnce("lin_api_finally_valid_token");
		mockRawRequest
			.mockRejectedValueOnce(new Error("AuthenticationFailed"))
			.mockRejectedValueOnce(new Error("Unauthorized"))
			.mockResolvedValueOnce({ viewer: VALID_VIEWER });

		const result = await runTokenStep();
		expect(result.token).toBe("lin_api_finally_valid_token");
		expect(vi.mocked(password)).toHaveBeenCalledTimes(3);
	});

	it("throws after 3 consecutive failures", async () => {
		vi.mocked(password).mockResolvedValue("nope");
		mockRawRequest.mockRejectedValue(new Error("AuthenticationFailed"));

		await expect(runTokenStep()).rejects.toThrow(
			/Could not validate a Linear API token after 3 attempts/,
		);
	});

	it("rejects a viewer response missing a UUID id", async () => {
		mockRawRequest.mockResolvedValueOnce({
			viewer: { ...VALID_VIEWER, id: "not-a-uuid" },
		});
		await expect(validateToken("lin_api_anything_long_enough")).rejects.toThrow(
			/missing a viewer/,
		);
	});
});

describe("runTokenStep — existing token paths", () => {
	it("keep-as-is: existing valid token + user declines replace → returns existing", async () => {
		await writeToken("lin_api_pre_existing_token_xyz");
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });
		vi.mocked(confirm).mockResolvedValueOnce(false);

		const result = await runTokenStep();
		expect(result.token).toBe("lin_api_pre_existing_token_xyz");
		expect(vi.mocked(password)).not.toHaveBeenCalled();
	});

	it("replace path: existing valid token + user accepts replace → enters new", async () => {
		await writeToken("lin_api_old_token_aaaaaaaa");
		mockRawRequest
			.mockResolvedValueOnce({ viewer: VALID_VIEWER }) // initial validation of old token
			.mockResolvedValueOnce({ viewer: VALID_VIEWER }); // validation of new token
		vi.mocked(confirm).mockResolvedValueOnce(true);
		vi.mocked(password).mockResolvedValueOnce("lin_api_brand_new_token_bb");

		const result = await runTokenStep();
		expect(result.token).toBe("lin_api_brand_new_token_bb");
	});

	it("force flag bypasses the keep prompt and goes straight to re-entry", async () => {
		await writeToken("lin_api_force_replace_old");
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });
		vi.mocked(password).mockResolvedValueOnce("lin_api_force_replace_new");

		const result = await runTokenStep({ force: true });
		expect(result.token).toBe("lin_api_force_replace_new");
		expect(vi.mocked(confirm)).not.toHaveBeenCalled();
	});

	it("invalid existing token: skips keep prompt, prompts for new", async () => {
		await writeToken("lin_api_revoked_token_11");
		mockRawRequest
			.mockRejectedValueOnce(new Error("AuthenticationFailed: token revoked"))
			.mockResolvedValueOnce({ viewer: VALID_VIEWER });
		vi.mocked(password).mockResolvedValueOnce("lin_api_replacement_token");

		const result = await runTokenStep();
		expect(result.token).toBe("lin_api_replacement_token");
		expect(vi.mocked(confirm)).not.toHaveBeenCalled();
	});
});

// ─────────────────────────────────────────────────────────────────────────
//  Workspace step
// ─────────────────────────────────────────────────────────────────────────

const TEAMS_RESPONSE = {
	teams: {
		nodes: [
			{ id: "team-eng-id", key: "ENG", name: "Engineering" },
			{ id: "team-des-id", key: "DES", name: "Design" },
		],
	},
};

describe("runWorkspaceStep", () => {
	it("skip (default): returns existing default team and merged team-id map", async () => {
		mockRawRequest.mockResolvedValueOnce(TEAMS_RESPONSE);
		vi.mocked(confirm).mockResolvedValueOnce(false);

		const result = await runWorkspaceStep("token", "acme", {
			defaultTeam: "ENG",
		});
		expect(result.workspaceUrlKey).toBe("acme");
		expect(result.defaultTeam).toBe("ENG");
		expect(result.teams).toEqual({
			ENG: "team-eng-id",
			DES: "team-des-id",
		});
	});

	it("change: user picks a different team", async () => {
		mockRawRequest.mockResolvedValueOnce(TEAMS_RESPONSE);
		vi.mocked(confirm).mockResolvedValueOnce(true);
		vi.mocked(select).mockResolvedValueOnce("DES");

		const result = await runWorkspaceStep("token", "acme", {
			defaultTeam: "ENG",
		});
		expect(result.defaultTeam).toBe("DES");
	});

	it("change → __skip: user opts out of having a default", async () => {
		mockRawRequest.mockResolvedValueOnce(TEAMS_RESPONSE);
		vi.mocked(confirm).mockResolvedValueOnce(true);
		vi.mocked(select).mockResolvedValueOnce("__skip");

		const result = await runWorkspaceStep("token", "acme", {
			defaultTeam: "ENG",
		});
		expect(result.defaultTeam).toBeUndefined();
	});

	it("no teams visible: skips the picker even if user opted in", async () => {
		mockRawRequest.mockResolvedValueOnce({ teams: { nodes: [] } });
		vi.mocked(confirm).mockResolvedValueOnce(true);

		const result = await runWorkspaceStep("token", "acme", {});
		expect(result.defaultTeam).toBeUndefined();
		expect(result.teams).toEqual({});
		expect(vi.mocked(select)).not.toHaveBeenCalled();
	});

	it("no existing default + skip: returns undefined (not empty string)", async () => {
		mockRawRequest.mockResolvedValueOnce(TEAMS_RESPONSE);
		vi.mocked(confirm).mockResolvedValueOnce(false);

		const result = await runWorkspaceStep("token", "acme", {});
		expect(result.defaultTeam).toBeUndefined();
	});
});

// ─────────────────────────────────────────────────────────────────────────
//  Aliases step (interactive walk)
// ─────────────────────────────────────────────────────────────────────────

const USERS_RESPONSE = {
	users: {
		pageInfo: { endCursor: null, hasNextPage: false },
		nodes: [
			{
				id: "user-alice",
				name: "Alice Anderson",
				email: "alice@x.com",
				displayName: "Alice Anderson",
				active: true,
			},
			{
				id: "user-bob",
				name: "Bob Brown",
				email: "bob@x.com",
				displayName: "Bob Brown",
				active: true,
			},
		],
	},
};

describe("runAliasesStep", () => {
	it("declines walk: returns empty map", async () => {
		vi.mocked(confirm).mockResolvedValueOnce(false);

		const result = await runAliasesStep("token", {});
		expect(result.size).toBe(0);
		expect(mockRawRequest).not.toHaveBeenCalled();
	});

	it("force flag bypasses the proceed prompt", async () => {
		mockRawRequest.mockResolvedValueOnce(USERS_RESPONSE);
		vi.mocked(select)
			.mockResolvedValueOnce("keep")
			.mockResolvedValueOnce("keep");

		const result = await runAliasesStep("token", {}, { force: true });
		expect(result.size).toBe(0);
		expect(vi.mocked(confirm)).not.toHaveBeenCalled();
	});

	it("walk all keep: returns empty map (no changes)", async () => {
		mockRawRequest.mockResolvedValueOnce(USERS_RESPONSE);
		vi.mocked(confirm).mockResolvedValueOnce(true); // proceed
		vi.mocked(select)
			.mockResolvedValueOnce("keep")
			.mockResolvedValueOnce("keep");

		const result = await runAliasesStep("token", {}, { force: true });
		expect(result.size).toBe(0);
	});

	it("edit a user's aliases + handles", async () => {
		mockRawRequest.mockResolvedValueOnce(USERS_RESPONSE);
		// Alice: edit
		vi.mocked(select).mockResolvedValueOnce("edit");
		vi.mocked(input)
			.mockResolvedValueOnce("ali, alex") // aliases
			.mockResolvedValueOnce("alice-gh") // github
			.mockResolvedValueOnce(""); // gitlab (skip)
		// Bob: keep
		vi.mocked(select).mockResolvedValueOnce("keep");

		const result = await runAliasesStep("token", {}, { force: true });
		expect(result.size).toBe(1);
		const aliceUpdate = result.get("user-alice");
		expect(aliceUpdate?.mode).toBe("edit");
		expect(aliceUpdate?.aliases).toEqual(["ali", "alex"]);
		expect(aliceUpdate?.github).toEqual({ kind: "set", value: "alice-gh" });
		expect(aliceUpdate?.gitlab).toEqual({ kind: "keep" });
	});

	it("append mode: only available when current aliases exist", async () => {
		mockRawRequest.mockResolvedValueOnce(USERS_RESPONSE);
		const existing = {
			members: {
				aliases: { ali: "Alice Anderson" },
				uuids: { "Alice Anderson": "user-alice" },
				fullNames: { "user-alice": "Alice Anderson" },
				handles: { github: {}, gitlab: {} },
			},
		};

		vi.mocked(select)
			.mockResolvedValueOnce("append")
			.mockResolvedValueOnce("keep");
		vi.mocked(input)
			.mockResolvedValueOnce("alex")
			.mockResolvedValueOnce("")
			.mockResolvedValueOnce("");

		const result = await runAliasesStep("token", existing, { force: true });
		expect(result.get("user-alice")?.mode).toBe("append");
		expect(result.get("user-alice")?.aliases).toEqual(["alex"]);
	});

	it("clear mode: drops aliases and any existing handles for that user", async () => {
		mockRawRequest.mockResolvedValueOnce(USERS_RESPONSE);
		const existing = {
			members: {
				aliases: { ali: "Alice Anderson" },
				uuids: { "Alice Anderson": "user-alice" },
				fullNames: { "user-alice": "Alice Anderson" },
				handles: {
					github: { "alice-gh": "Alice Anderson" },
					gitlab: { "alice-gl": "Alice Anderson" },
				},
			},
		};

		vi.mocked(select)
			.mockResolvedValueOnce("clear")
			.mockResolvedValueOnce("keep");

		const result = await runAliasesStep("token", existing, { force: true });
		const aliceUpdate = result.get("user-alice");
		expect(aliceUpdate?.mode).toBe("clear");
		expect(aliceUpdate?.github).toEqual({ kind: "clear" });
		expect(aliceUpdate?.gitlab).toEqual({ kind: "clear" });
	});

	it("quit mid-walk saves progress with the last completed user UUID", async () => {
		mockRawRequest.mockResolvedValueOnce(USERS_RESPONSE);
		// Alice: edit (completes)
		vi.mocked(select).mockResolvedValueOnce("edit");
		vi.mocked(input)
			.mockResolvedValueOnce("ali")
			.mockResolvedValueOnce("")
			.mockResolvedValueOnce("");
		// Bob: quit (does NOT complete Bob)
		vi.mocked(select).mockResolvedValueOnce("quit");

		const result = await runAliasesStep("token", {}, { force: true });
		expect(result.size).toBe(1);
		const progress = await readAliasesProgress();
		expect(progress?.lastCompletedUserId).toBe("user-alice");
		expect(progress?.totalUsers).toBe(2);
	});

	it("collision filter: users with shared display names are skipped", async () => {
		mockRawRequest.mockResolvedValueOnce({
			users: {
				pageInfo: { endCursor: null, hasNextPage: false },
				nodes: [
					{
						id: "id-1",
						name: "Alex",
						email: "a@x.com",
						displayName: "Alex",
						active: true,
					},
					{
						id: "id-2",
						name: "Alex",
						email: "b@x.com",
						displayName: "Alex",
						active: true,
					},
					{
						id: "id-3",
						name: "Carol",
						email: "c@x.com",
						displayName: "Carol",
						active: true,
					},
				],
			},
		});
		vi.mocked(confirm).mockResolvedValueOnce(true); // proceed
		vi.mocked(select).mockResolvedValueOnce("keep"); // only Carol

		const result = await runAliasesStep("token", {});
		expect(result.size).toBe(0);
		expect(vi.mocked(select)).toHaveBeenCalledTimes(1);
	});

	it("paginates user fetch across multiple pages", async () => {
		mockRawRequest
			.mockResolvedValueOnce({
				users: {
					pageInfo: { endCursor: "cursor-1", hasNextPage: true },
					nodes: [
						{
							id: "u1",
							name: "U1",
							email: "u1@x.com",
							displayName: "U1",
							active: true,
						},
					],
				},
			})
			.mockResolvedValueOnce({
				users: {
					pageInfo: { endCursor: null, hasNextPage: false },
					nodes: [
						{
							id: "u2",
							name: "U2",
							email: "u2@x.com",
							displayName: "U2",
							active: true,
						},
						{
							id: "u3",
							name: "U3",
							email: null,
							displayName: "U3",
							active: false,
						},
					],
				},
			});

		const users = await fetchAllUsers("token");
		expect(users.map((u) => u.id)).toEqual(["u1", "u2"]);
	});
});

// ─────────────────────────────────────────────────────────────────────────
//  Aliases step (CSV import)
// ─────────────────────────────────────────────────────────────────────────

describe("runAliasesImport", () => {
	it("imports rows, resolves emails to user UUIDs, reports skipped emails", async () => {
		mockRawRequest.mockResolvedValueOnce(USERS_RESPONSE);

		const csvPath = path.join(TEST_HOME, "import.csv");
		await fs.mkdir(TEST_HOME, { recursive: true });
		await fs.writeFile(
			csvPath,
			[
				"email,aliases,github,gitlab",
				'alice@x.com,"alice,ali",alice-gh,alice-gl',
				"bob@x.com,bob,,",
				"unknown@x.com,who,,",
			].join("\n"),
		);

		const { updates, skipped } = await runAliasesImport("token", csvPath);
		expect(updates.size).toBe(2);

		const aliceUpdate = updates.get("user-alice");
		expect(aliceUpdate?.aliases).toEqual(["alice", "ali"]);
		expect(aliceUpdate?.github).toEqual({ kind: "set", value: "alice-gh" });
		expect(aliceUpdate?.gitlab).toEqual({ kind: "set", value: "alice-gl" });

		const bobUpdate = updates.get("user-bob");
		expect(bobUpdate?.aliases).toEqual(["bob"]);
		expect(bobUpdate?.github).toEqual({ kind: "keep" });
		expect(bobUpdate?.gitlab).toEqual({ kind: "keep" });

		expect(skipped).toEqual(["unknown@x.com"]);
	});
});

// ─────────────────────────────────────────────────────────────────────────
//  Defaults step
// ─────────────────────────────────────────────────────────────────────────

describe("runDefaultsStep — every config key", () => {
	it("skip everything: returns existing values byte-for-byte", async () => {
		const existing = {
			defaultLabels: ["claude"],
			statusDefaults: { noProject: "Backlog" },
			terms: [{ canonical: "Acme", reject: ["acme"] }],
		};
		vi.mocked(confirm)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);

		const result = await runDefaultsStep(existing);
		expect(result.defaultLabels).toEqual(["claude"]);
		expect(result.statusDefaults).toEqual({ noProject: "Backlog" });
		expect(result.terms).toEqual([{ canonical: "Acme", reject: ["acme"] }]);
	});

	it("default labels: change to a new csv list", async () => {
		vi.mocked(confirm)
			.mockResolvedValueOnce(true) // edit labels
			.mockResolvedValueOnce(false) // skip status
			.mockResolvedValueOnce(false); // skip terms
		vi.mocked(input).mockResolvedValueOnce("claude, automation, bot");

		const result = await runDefaultsStep({});
		expect(result.defaultLabels).toEqual(["claude", "automation", "bot"]);
	});

	it("default labels: blank input clears them (undefined)", async () => {
		vi.mocked(confirm)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false);
		vi.mocked(input).mockResolvedValueOnce("");

		const result = await runDefaultsStep({ defaultLabels: ["old"] });
		expect(result.defaultLabels).toBeUndefined();
	});

	it("status defaults: writes both noProject and withAssigneeAndProject", async () => {
		vi.mocked(confirm)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true) // edit status
			.mockResolvedValueOnce(false);
		vi.mocked(input)
			.mockResolvedValueOnce("Backlog")
			.mockResolvedValueOnce("In Progress");

		const result = await runDefaultsStep({});
		expect(result.statusDefaults).toEqual({
			noProject: "Backlog",
			withAssigneeAndProject: "In Progress",
		});
	});

	it("term enforcement: adds a single rule (initial setup)", async () => {
		vi.mocked(confirm)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true); // edit terms
		vi.mocked(input)
			.mockResolvedValueOnce("Enrich Layer")
			.mockResolvedValueOnce("EnrichLayer, enrichlayer")
			.mockResolvedValueOnce("");

		const result = await runDefaultsStep({});
		expect(result.terms).toEqual([
			{ canonical: "Enrich Layer", reject: ["EnrichLayer", "enrichlayer"] },
		]);
	});

	it("term enforcement: append mode keeps existing rules and adds more", async () => {
		const existing = {
			terms: [{ canonical: "Acme", reject: ["acme"] }],
		};
		vi.mocked(confirm)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true) // edit terms
			.mockResolvedValueOnce(false); // append (don't replace)
		vi.mocked(input)
			.mockResolvedValueOnce("Linear")
			.mockResolvedValueOnce("linear,LINEAR")
			.mockResolvedValueOnce("");

		const result = await runDefaultsStep(existing);
		expect(result.terms).toEqual([
			{ canonical: "Acme", reject: ["acme"] },
			{ canonical: "Linear", reject: ["linear", "LINEAR"] },
		]);
	});

	it("term enforcement: replace mode wipes existing rules first", async () => {
		const existing = {
			terms: [
				{ canonical: "Old", reject: ["older"] },
				{ canonical: "Old2", reject: ["older2"] },
			],
		};
		vi.mocked(confirm)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true); // replace
		vi.mocked(input)
			.mockResolvedValueOnce("New")
			.mockResolvedValueOnce("nEw,NEW")
			.mockResolvedValueOnce("");

		const result = await runDefaultsStep(existing);
		expect(result.terms).toEqual([
			{ canonical: "New", reject: ["nEw", "NEW"] },
		]);
	});

	it("term enforcement: skips a rule when no variants are provided", async () => {
		vi.mocked(confirm)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		vi.mocked(input)
			.mockResolvedValueOnce("Foo")
			.mockResolvedValueOnce("") // no rejects → skip
			.mockResolvedValueOnce("");

		const result = await runDefaultsStep({});
		expect(result.terms).toEqual([]);
	});

	it("status defaults trim whitespace from inputs", async () => {
		vi.mocked(confirm)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		vi.mocked(input)
			.mockResolvedValueOnce("  Backlog  ")
			.mockResolvedValueOnce(" In Progress ");

		const result = await runDefaultsStep({});
		expect(result.statusDefaults?.noProject).toBe("Backlog");
		expect(result.statusDefaults?.withAssigneeAndProject).toBe("In Progress");
	});
});

// ─────────────────────────────────────────────────────────────────────────
//  Cross-step round-trip
// ─────────────────────────────────────────────────────────────────────────

describe("full wizard round-trip", () => {
	it("token → workspace → aliases → defaults composes into one config.json", async () => {
		// 1. Token: first-time, validates.
		vi.mocked(password).mockResolvedValueOnce("lin_api_full_wizard_token");
		mockRawRequest.mockResolvedValueOnce({ viewer: VALID_VIEWER });
		const tokenRes = await runTokenStep();

		// 2. Workspace: pick ENG.
		mockRawRequest.mockResolvedValueOnce(TEAMS_RESPONSE);
		vi.mocked(confirm).mockResolvedValueOnce(true);
		vi.mocked(select).mockResolvedValueOnce("ENG");
		const ws = await runWorkspaceStep(
			tokenRes.token,
			tokenRes.viewer.organization.urlKey,
			{},
		);

		// 3. Aliases: walk Alice (edit), Bob (keep).
		mockRawRequest.mockResolvedValueOnce(USERS_RESPONSE);
		vi.mocked(confirm).mockResolvedValueOnce(true); // proceed
		vi.mocked(select).mockResolvedValueOnce("edit"); // Alice
		vi.mocked(input)
			.mockResolvedValueOnce("ali")
			.mockResolvedValueOnce("alice-gh")
			.mockResolvedValueOnce("");
		vi.mocked(select).mockResolvedValueOnce("keep"); // Bob
		const aliasUpdates = await runAliasesStep(tokenRes.token, {});

		// 4. Defaults.
		vi.mocked(confirm)
			.mockResolvedValueOnce(true) // labels
			.mockResolvedValueOnce(true) // status
			.mockResolvedValueOnce(true); // terms (add)
		vi.mocked(input)
			.mockResolvedValueOnce("claude, automation")
			.mockResolvedValueOnce("Backlog")
			.mockResolvedValueOnce("Todo")
			.mockResolvedValueOnce("Acme")
			.mockResolvedValueOnce("acme")
			.mockResolvedValueOnce("");
		const defaults = await runDefaultsStep({});

		// Compose & write.
		const existing = await readConfig();
		let merged = assignDefined(existing, {
			defaultLabels: defaults.defaultLabels,
			statusDefaults: defaults.statusDefaults,
			terms: defaults.terms,
			defaultTeam: ws.defaultTeam,
			teams: { ...(existing.teams ?? {}), ...ws.teams },
			workspaceUrlKey: existing.workspaceUrlKey ?? ws.workspaceUrlKey,
		});
		merged = mergeAliasesIntoConfig(merged, aliasUpdates);
		await writeConfig(merged);

		const onDisk = await readConfig();
		expect(onDisk.defaultTeam).toBe("ENG");
		expect(onDisk.teams).toEqual({
			ENG: "team-eng-id",
			DES: "team-des-id",
		});
		expect(onDisk.workspaceUrlKey).toBe("acme");
		expect(onDisk.defaultLabels).toEqual(["claude", "automation"]);
		expect(onDisk.statusDefaults).toEqual({
			noProject: "Backlog",
			withAssigneeAndProject: "Todo",
		});
		expect(onDisk.terms).toEqual([{ canonical: "Acme", reject: ["acme"] }]);
		expect(onDisk.members?.aliases).toEqual({ ali: "Alice Anderson" });
		expect(onDisk.members?.handles?.github).toEqual({
			"alice-gh": "Alice Anderson",
		});
		expect(onDisk.members?.uuids?.["Alice Anderson"]).toBe("user-alice");
	});

	it("re-running with no input is byte-identical (idempotency)", async () => {
		// Seed a non-empty config that already matches what the mocked API
		// will return — otherwise the additive team-cache merge appends DES
		// and the output isn't byte-identical even though the user changed
		// nothing interactively.
		await writeConfig({
			defaultTeam: "ENG",
			teams: { ENG: "team-eng-id", DES: "team-des-id" },
			workspaceUrlKey: "acme",
			defaultLabels: ["claude"],
			statusDefaults: { noProject: "Backlog", withAssigneeAndProject: "Todo" },
			terms: [{ canonical: "Acme", reject: ["acme"] }],
		});
		const before = await fs.readFile(CONFIG_PATH, "utf8");

		mockRawRequest.mockResolvedValueOnce(TEAMS_RESPONSE);
		vi.mocked(confirm)
			.mockResolvedValueOnce(false) // workspace
			.mockResolvedValueOnce(false) // labels
			.mockResolvedValueOnce(false) // status
			.mockResolvedValueOnce(false); // terms

		const existing = await readConfig();
		const ws = await runWorkspaceStep("token", "acme", existing);
		const defaults = await runDefaultsStep(existing);

		const merged = assignDefined(existing, {
			defaultLabels: defaults.defaultLabels,
			statusDefaults: defaults.statusDefaults,
			terms: defaults.terms,
			defaultTeam: ws.defaultTeam,
			teams: { ...(existing.teams ?? {}), ...ws.teams },
			workspaceUrlKey: existing.workspaceUrlKey ?? ws.workspaceUrlKey,
		});
		await writeConfig(merged);

		const after = await fs.readFile(CONFIG_PATH, "utf8");
		expect(after).toBe(before);
	});
});

// Type-only assertion that the local `AliasUpdate` import isn't dead — keep
// it for editor-driven exploration of the export surface.
const _typeProbe: AliasUpdate | undefined = undefined;
void _typeProbe;
