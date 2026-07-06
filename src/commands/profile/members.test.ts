/**
 * Tests for `el-linear profile members {list,clear,set}` (DEV-5612).
 *
 * Strategy: same real-tmp-dir `vi.hoisted` node:os mock pattern as
 * `profile.test.ts` / the wizard tests, then exercise each `runMembersX`
 * function directly against the real config.json read-modify-write path
 * (`readConfig`/`updateConfig`).
 */

import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TEST_HOME } = vi.hoisted(() => {
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		TEST_HOME: nodePath.join(
			nodeOs.tmpdir(),
			`el-linear-profile-members-test-${process.pid}-${Date.now()}`,
		),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

import { CONFIG_DIR, CONFIG_PATH } from "../../config/paths.js";
import {
	listMembers,
	runMembersClear,
	runMembersList,
	runMembersSet,
} from "./members.js";

const BASE_CONFIG = {
	defaultTeam: "ENG",
	members: {
		aliases: {
			alice: "Alice Anderson",
			ali: "Alice Anderson",
			bob: "Bob Brown",
		},
		uuids: { "Alice Anderson": "alice-id", "Bob Brown": "bob-id" },
		fullNames: { "alice-id": "Alice Anderson", "bob-id": "Bob Brown" },
		handles: {
			github: { "alice-gh": "Alice Anderson" },
			gitlab: {},
		},
	},
};

beforeEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
	await fs.mkdir(CONFIG_DIR, { recursive: true });
	await fs.writeFile(CONFIG_PATH, `${JSON.stringify(BASE_CONFIG, null, 2)}\n`);
});

afterEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
});

describe("listMembers", () => {
	it("groups aliases + handles per member, sorted by display name", () => {
		const result = listMembers(BASE_CONFIG);
		expect(result).toEqual([
			{
				displayName: "Alice Anderson",
				aliases: expect.arrayContaining(["alice", "ali"]),
				github: "alice-gh",
			},
			{ displayName: "Bob Brown", aliases: ["bob"] },
		]);
	});

	it("returns an empty list for a config with no members", () => {
		expect(listMembers({})).toEqual([]);
	});
});

describe("runMembersList", () => {
	it("reads members straight off the active profile's config", async () => {
		const result = await runMembersList();
		expect(result.map((m) => m.displayName).sort()).toEqual([
			"Alice Anderson",
			"Bob Brown",
		]);
	});
});

describe("runMembersClear", () => {
	it("removes all aliases + handles for the named member only", async () => {
		await runMembersClear("Alice Anderson");

		const raw = await fs.readFile(CONFIG_PATH, "utf8");
		const config = JSON.parse(raw);
		expect(config.members.aliases).toEqual({ bob: "Bob Brown" });
		expect(config.members.handles.github).toEqual({});
	});

	it("is a no-op when the member has no aliases/handles on file", async () => {
		await runMembersClear("Nobody Here");

		const raw = await fs.readFile(CONFIG_PATH, "utf8");
		const config = JSON.parse(raw);
		expect(config.members.aliases).toEqual(BASE_CONFIG.members.aliases);
	});
});

describe("runMembersSet", () => {
	it("replaces aliases for the named member without touching others", async () => {
		await runMembersSet("Alice Anderson", { aliases: "alex, al" });

		const raw = await fs.readFile(CONFIG_PATH, "utf8");
		const config = JSON.parse(raw);
		expect(config.members.aliases).toEqual({
			alex: "Alice Anderson",
			al: "Alice Anderson",
			bob: "Bob Brown",
		});
	});

	it("sets a GitHub handle, replacing any existing one", async () => {
		await runMembersSet("Alice Anderson", { github: "alice-new-gh" });

		const raw = await fs.readFile(CONFIG_PATH, "utf8");
		const config = JSON.parse(raw);
		expect(config.members.handles.github).toEqual({
			"alice-new-gh": "Alice Anderson",
		});
		// Aliases untouched (no --aliases flag passed).
		expect(config.members.aliases.alice).toBe("Alice Anderson");
	});

	it("clears a handle when passed an empty string", async () => {
		await runMembersSet("Alice Anderson", { github: "" });

		const raw = await fs.readFile(CONFIG_PATH, "utf8");
		const config = JSON.parse(raw);
		expect(config.members.handles.github).toEqual({});
	});

	it("throws when no flags are passed", async () => {
		await expect(runMembersSet("Alice Anderson", {})).rejects.toThrow(
			/Pass at least one of/,
		);
	});
});
