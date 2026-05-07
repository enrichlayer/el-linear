/**
 * Integration test: `el-linear teams list` exercises the real disk cache.
 *
 * Distinct from `teams.test.ts` (which stubs out disk-cache) because we
 * specifically want to verify that the SECOND invocation of `teams list`
 * reads from the on-disk envelope rather than calling LinearService again.
 */

import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { TEST_HOME } = vi.hoisted(() => {
	const nodeOs = require("node:os") as typeof import("node:os");
	const nodePath = require("node:path") as typeof import("node:path");
	return {
		TEST_HOME: nodePath.join(
			nodeOs.tmpdir(),
			`el-linear-teams-cache-test-${process.pid}-${Date.now()}`,
		),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	const overridden = { ...actual, homedir: () => TEST_HOME };
	return { ...overridden, default: overridden };
});

const mockGetTeams = vi.fn();
vi.mock("../utils/linear-service.js", () => ({
	createLinearService: vi.fn().mockResolvedValue({ getTeams: mockGetTeams }),
}));

const mockOutputSuccess = vi.fn();
vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return { ...actual, outputSuccess: mockOutputSuccess };
});

vi.mock("../config/config.js", () => ({
	loadConfig: () => ({ cacheTTLSeconds: 3600 }),
}));

const { setupTeamsCommands } = await import("./teams.js");
const { createTestProgram, runCommand, suppressExit } = await import(
	"../__tests__/test-helpers.js"
);

beforeEach(async () => {
	await fs.rm(TEST_HOME, { recursive: true, force: true });
	mockGetTeams.mockReset();
	mockOutputSuccess.mockReset();
	suppressExit();
});

describe("teams list — disk cache integration", () => {
	it("first invocation fetches; second invocation reads from cache", async () => {
		const teamsData = [{ id: "t1", key: "ENG", name: "Engineering" }];
		mockGetTeams.mockResolvedValue(teamsData);

		const program1 = createTestProgram();
		setupTeamsCommands(program1);
		await runCommand(program1, ["teams", "list"]);

		const program2 = createTestProgram();
		setupTeamsCommands(program2);
		await runCommand(program2, ["teams", "list"]);

		// Fetcher called exactly once across both invocations.
		expect(mockGetTeams).toHaveBeenCalledTimes(1);
		// Both invocations produced the same data via outputSuccess.
		expect(mockOutputSuccess).toHaveBeenCalledTimes(2);
		expect(mockOutputSuccess).toHaveBeenNthCalledWith(1, {
			data: teamsData,
			meta: { count: 1 },
		});
		expect(mockOutputSuccess).toHaveBeenNthCalledWith(2, {
			data: teamsData,
			meta: { count: 1 },
		});
	});

	it("--no-cache bypasses the on-disk envelope", async () => {
		const teamsData = [{ id: "t1", key: "ENG", name: "Engineering" }];
		mockGetTeams.mockResolvedValue(teamsData);

		// Warm the cache.
		const program1 = createTestProgram();
		setupTeamsCommands(program1);
		await runCommand(program1, ["teams", "list"]);

		// `--no-cache` is a root option — must come BEFORE the subcommand.
		const program2 = createTestProgram();
		// The test helper's createTestProgram doesn't add --no-cache, so we
		// add it inline to mimic main.ts.
		program2.option("--no-cache", "bypass cache");
		setupTeamsCommands(program2);
		await runCommand(program2, ["--no-cache", "teams", "list"]);

		// Two fetches: one for the cache warm, one for --no-cache.
		expect(mockGetTeams).toHaveBeenCalledTimes(2);
	});

	it("different limits use distinct cache keys", async () => {
		mockGetTeams.mockImplementation((limit: number) =>
			Promise.resolve(
				Array.from({ length: limit }, (_, i) => ({
					id: `t${i}`,
					key: `T${i}`,
					name: `Team ${i}`,
				})),
			),
		);

		const program1 = createTestProgram();
		setupTeamsCommands(program1);
		await runCommand(program1, ["teams", "list", "--limit", "5"]);

		const program2 = createTestProgram();
		setupTeamsCommands(program2);
		await runCommand(program2, ["teams", "list", "--limit", "10"]);

		// Two fetches because the cache keys differ.
		expect(mockGetTeams).toHaveBeenCalledTimes(2);
		expect(mockGetTeams).toHaveBeenNthCalledWith(1, 5);
		expect(mockGetTeams).toHaveBeenNthCalledWith(2, 10);
	});
});
