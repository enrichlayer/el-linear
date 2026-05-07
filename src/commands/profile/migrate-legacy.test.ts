/**
 * End-to-end tests for `el-linear profile migrate-legacy`.
 *
 * Strategy:
 *
 * - Use vi.spyOn(os, "homedir") to point at a per-test tmpdir, the same
 *   pattern used in `init/shared.test.ts`. This lets us hit the real
 *   filesystem (so we exercise the actual mkdir / writeFile / chmod
 *   sequence) without touching the developer's real ~/.config/el-linear.
 *
 * - Inject a stubbed `validateToken` so we never hit the Linear API. The
 *   stub accepts any token starting with "lin_api_test_" and rejects
 *   everything else, mirroring the real validate-then-write contract.
 *
 * - Tests cover: fresh migration, idempotent second run, --token-from
 *   precedence, EL_LINEAR_TOKEN env precedence, refused overwrite,
 *   --force overwrite, missing-legacy-config exit, validation rejection
 *   before any write.
 */

import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MigrateLegacyDeps } from "./migrate-legacy.js";

const TEST_HOME = path.join(
	os.tmpdir(),
	`el-linear-migrate-legacy-test-${process.pid}-${Date.now()}`,
);

interface FakeViewer {
	id: string;
	organization: { urlKey: string; name: string };
	displayName: string;
	email: string;
}

const FAKE_VIEWER: FakeViewer = {
	id: "11111111-2222-3333-4444-555555555555",
	organization: { urlKey: "acme", name: "ACME Inc" },
	displayName: "Test User",
	email: "test@example.com",
};

function makeStubValidateToken(): (token: string) => Promise<FakeViewer> {
	return async (token: string) => {
		if (!token.startsWith("lin_api_test_")) {
			throw new Error("Token rejected by Linear: AuthenticationFailed");
		}
		return FAKE_VIEWER;
	};
}

function makeDeps(overrides?: Partial<MigrateLegacyDeps>): {
	deps: MigrateLegacyDeps;
	stdout: { chunks: string[]; write: (c: string) => void };
} {
	const stdout = {
		chunks: [] as string[],
		write(c: string) {
			this.chunks.push(c);
		},
	};
	const deps: MigrateLegacyDeps = {
		validateToken: makeStubValidateToken(),
		stdout,
		...overrides,
	};
	return { deps, stdout };
}

async function planLegacyConfig(content: string): Promise<void> {
	await fsp.mkdir(path.join(TEST_HOME, ".config", "el-linear"), {
		recursive: true,
	});
	await fsp.writeFile(
		path.join(TEST_HOME, ".config", "el-linear", "config.json"),
		content,
		{ mode: 0o644 },
	);
}

beforeEach(async () => {
	vi.spyOn(os, "homedir").mockReturnValue(TEST_HOME);
	await fsp.rm(TEST_HOME, { recursive: true, force: true });
	delete process.env.EL_LINEAR_TOKEN;
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fsp.rm(TEST_HOME, { recursive: true, force: true });
	delete process.env.EL_LINEAR_TOKEN;
});

describe("migrate-legacy: pre-flight", () => {
	it("exits 1 with a clear stdout message when no legacy config is present", async () => {
		// Re-import so vi.spyOn(homedir) is captured by the freshly-evaluated
		// constants in `paths.ts`.
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		const { deps, stdout } = makeDeps();

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			_code?: number,
		) => {
			throw new Error(`process.exit(${_code})`);
		}) as never);

		await expect(
			runMigrateLegacy({ skipPrompt: true, name: "default" }, deps),
		).rejects.toThrow(/process\.exit\(1\)/);
		expect(stdout.chunks.join("")).toContain("Nothing to migrate");
		exitSpy.mockRestore();
	});
});

describe("migrate-legacy: fresh migration", () => {
	it("copies legacy config + writes token + sets active-profile (default name)", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		const legacy = JSON.stringify(
			{ defaultTeam: "ENG", members: { aliases: { alice: "Alice" } } },
			null,
			2,
		);
		await planLegacyConfig(legacy);
		process.env.EL_LINEAR_TOKEN = "lin_api_test_freshmigrationtoken";

		const { deps, stdout } = makeDeps();
		await runMigrateLegacy(
			{ skipPrompt: true, name: "default", yes: true },
			deps,
		);

		const profileDir = path.join(
			TEST_HOME,
			".config",
			"el-linear",
			"profiles",
			"default",
		);
		const copiedConfig = await fsp.readFile(
			path.join(profileDir, "config.json"),
			"utf8",
		);
		expect(copiedConfig).toBe(legacy);

		const tokenContent = (
			await fsp.readFile(path.join(profileDir, "token"), "utf8")
		).trim();
		expect(tokenContent).toBe("lin_api_test_freshmigrationtoken");

		const tokenStat = await fsp.stat(path.join(profileDir, "token"));
		expect(tokenStat.mode & 0o777).toBe(0o600);

		const activeMarker = (
			await fsp.readFile(
				path.join(TEST_HOME, ".config", "el-linear", "active-profile"),
				"utf8",
			)
		).trim();
		expect(activeMarker).toBe("default");

		// Legacy file is preserved (not deleted).
		const legacyStillThere = await fsp.readFile(
			path.join(TEST_HOME, ".config", "el-linear", "config.json"),
			"utf8",
		);
		expect(legacyStillThere).toBe(legacy);

		const printed = stdout.chunks.join("");
		expect(printed).toContain("✓ Migrated.");
		expect(printed).toContain("Active profile: default");
		expect(printed).toContain("Workspace: acme");
		expect(printed).toContain("kept for rollback");
	});

	it("respects --name to write to a non-default profile dir", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		await planLegacyConfig('{"defaultTeam":"ENG"}');
		process.env.EL_LINEAR_TOKEN = "lin_api_test_namedprofile";

		const { deps } = makeDeps();
		await runMigrateLegacy({ skipPrompt: true, name: "work", yes: true }, deps);

		const profileDir = path.join(
			TEST_HOME,
			".config",
			"el-linear",
			"profiles",
			"work",
		);
		await expect(
			fsp.access(path.join(profileDir, "config.json")),
		).resolves.toBeUndefined();
		await expect(
			fsp.access(path.join(profileDir, "token")),
		).resolves.toBeUndefined();

		const active = (
			await fsp.readFile(
				path.join(TEST_HOME, ".config", "el-linear", "active-profile"),
				"utf8",
			)
		).trim();
		expect(active).toBe("work");
	});
});

describe("migrate-legacy: idempotent second run", () => {
	it("running twice with the same inputs is a no-op (no diff, no overwrite)", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		const legacy = '{"defaultTeam":"ENG"}';
		await planLegacyConfig(legacy);
		process.env.EL_LINEAR_TOKEN = "lin_api_test_idempotent";

		const { deps } = makeDeps();
		await runMigrateLegacy(
			{ skipPrompt: true, name: "default", yes: true },
			deps,
		);

		const profileDir = path.join(
			TEST_HOME,
			".config",
			"el-linear",
			"profiles",
			"default",
		);
		const firstConfig = await fsp.readFile(
			path.join(profileDir, "config.json"),
			"utf8",
		);
		const firstToken = await fsp.readFile(
			path.join(profileDir, "token"),
			"utf8",
		);

		// Second run with no --force, no --yes — should succeed silently.
		await runMigrateLegacy({ skipPrompt: true, name: "default" }, deps);

		const secondConfig = await fsp.readFile(
			path.join(profileDir, "config.json"),
			"utf8",
		);
		const secondToken = await fsp.readFile(
			path.join(profileDir, "token"),
			"utf8",
		);
		expect(secondConfig).toBe(firstConfig);
		expect(secondToken).toBe(firstToken);
	});
});

describe("migrate-legacy: differing config refuses without --force", () => {
	it("refuses when profile config differs from legacy and --force is not set", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		await planLegacyConfig('{"defaultTeam":"NEW"}');

		// Pre-plant a profile config that differs.
		const profileDir = path.join(
			TEST_HOME,
			".config",
			"el-linear",
			"profiles",
			"default",
		);
		await fsp.mkdir(profileDir, { recursive: true });
		await fsp.writeFile(
			path.join(profileDir, "config.json"),
			'{"defaultTeam":"OLD"}',
			{ mode: 0o644 },
		);
		process.env.EL_LINEAR_TOKEN = "lin_api_test_differingconfig";

		const { deps } = makeDeps();
		await expect(
			runMigrateLegacy({ skipPrompt: true, name: "default" }, deps),
		).rejects.toThrow(/Refusing to overwrite.*differ/s);
	});

	it("--force overwrites the differing profile config (with --yes to skip confirm)", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		const newLegacy = '{"defaultTeam":"NEW"}';
		await planLegacyConfig(newLegacy);

		const profileDir = path.join(
			TEST_HOME,
			".config",
			"el-linear",
			"profiles",
			"default",
		);
		await fsp.mkdir(profileDir, { recursive: true });
		await fsp.writeFile(
			path.join(profileDir, "config.json"),
			'{"defaultTeam":"OLD"}',
			{ mode: 0o644 },
		);
		process.env.EL_LINEAR_TOKEN = "lin_api_test_force";

		const { deps } = makeDeps();
		await runMigrateLegacy(
			{ skipPrompt: true, name: "default", force: true, yes: true },
			deps,
		);

		const after = await fsp.readFile(
			path.join(profileDir, "config.json"),
			"utf8",
		);
		expect(after).toBe(newLegacy);
	});
});

describe("migrate-legacy: token sources", () => {
	it("--token-from reads the token from a file", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		await planLegacyConfig('{"defaultTeam":"ENG"}');

		const tokenFile = path.join(TEST_HOME, "tokenfile");
		await fsp.mkdir(TEST_HOME, { recursive: true });
		await fsp.writeFile(tokenFile, "  lin_api_test_fromfile  \n");

		const { deps } = makeDeps();
		await runMigrateLegacy(
			{
				skipPrompt: true,
				name: "default",
				yes: true,
				tokenFrom: tokenFile,
			},
			deps,
		);

		const written = (
			await fsp.readFile(
				path.join(
					TEST_HOME,
					".config",
					"el-linear",
					"profiles",
					"default",
					"token",
				),
				"utf8",
			)
		).trim();
		expect(written).toBe("lin_api_test_fromfile");
	});

	it("EL_LINEAR_TOKEN env wins over interactive (no prompt fired)", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		await planLegacyConfig('{"defaultTeam":"ENG"}');
		process.env.EL_LINEAR_TOKEN = "lin_api_test_envwins";

		// If the prompt fires, the test fails — we did not stub `password`.
		const passwordSpy = vi.fn(async () => {
			throw new Error("password prompt should not fire when env is set");
		});
		const { deps } = makeDeps({
			prompts: {
				input: vi.fn() as never,
				password: passwordSpy as never,
				confirm: vi.fn() as never,
			},
		});

		await runMigrateLegacy(
			{ skipPrompt: true, name: "default", yes: true },
			deps,
		);
		expect(passwordSpy).not.toHaveBeenCalled();
	});

	it("rejects a bad token before any file is written", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		await planLegacyConfig('{"defaultTeam":"ENG"}');
		process.env.EL_LINEAR_TOKEN = "lin_api_BAD_token_unprefixed";

		const { deps } = makeDeps();
		await expect(
			runMigrateLegacy({ skipPrompt: true, name: "default", yes: true }, deps),
		).rejects.toThrow(/Token rejected by Linear/);

		// No profile dir should have been created — tokens are validated
		// *before* any FS work that might leave a half-built profile behind.
		const profileDir = path.join(
			TEST_HOME,
			".config",
			"el-linear",
			"profiles",
			"default",
		);
		await expect(fsp.access(path.join(profileDir, "token"))).rejects.toThrow();
	});
});

describe("migrate-legacy: rejects unsafe profile names", () => {
	it("throws on '..' traversal attempt", async () => {
		vi.resetModules();
		const { runMigrateLegacy } = await import("./migrate-legacy.js");
		await planLegacyConfig('{"defaultTeam":"ENG"}');
		process.env.EL_LINEAR_TOKEN = "lin_api_test_safename";

		const { deps } = makeDeps();
		await expect(
			runMigrateLegacy(
				{ skipPrompt: true, name: "../escape", yes: true },
				deps,
			),
		).rejects.toThrow(/Invalid profile name/);
	});
});
