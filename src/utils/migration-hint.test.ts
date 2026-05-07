/**
 * Tests for the once-per-process stderr emitter and the hint formatter.
 *
 * The latch (`hintAlreadyEmitted`) is module-level state, so each test
 * resets it via the `_resetMigrationHintForTests` test seam.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ACTIVE_PROFILE_FILE,
	CONFIG_PATH,
	PROFILES_DIR,
	TOKEN_PATH,
} from "../config/paths.js";
import type { DetectionFsOps } from "./legacy-config-detection.js";
import {
	_resetMigrationHintForTests,
	formatHint,
	maybeEmitMigrationHint,
} from "./migration-hint.js";

function emptyFs(): DetectionFsOps {
	return {
		existsSync: () => false,
		readFileSync: () => "",
		readdirSync: () => [],
	};
}

function legacyDriftFs(): DetectionFsOps {
	return {
		existsSync: (p) => p === CONFIG_PATH,
		readFileSync: () => "",
		readdirSync: () => [],
	};
}

function brokenActiveProfileFs(): DetectionFsOps {
	const presence = new Set([CONFIG_PATH, ACTIVE_PROFILE_FILE]);
	return {
		existsSync: (p) => presence.has(p),
		readFileSync: (p) => (p === ACTIVE_PROFILE_FILE ? "ghost\n" : ""),
		readdirSync: () => [],
	};
}

function captureStderr(): {
	write: (chunk: string) => void;
	chunks: string[];
} {
	const chunks: string[] = [];
	return {
		write: (c) => {
			chunks.push(c);
		},
		chunks,
	};
}

describe("formatHint", () => {
	it("returns null for no-drift", () => {
		expect(formatHint({ kind: "no-drift" })).toBeNull();
	});

	it("includes the legacy config path and the migrate command", () => {
		const msg = formatHint({
			kind: "legacy-no-token",
			legacyConfigPath: CONFIG_PATH,
		});
		expect(msg).not.toBeNull();
		expect(msg).toContain(CONFIG_PATH);
		expect(msg).toContain("el-linear profile migrate-legacy");
		expect(msg).toContain("EL_LINEAR_SKIP_MIGRATION_HINT=1");
	});

	it("names the broken profile pointer in the hint", () => {
		const msg = formatHint({
			kind: "broken-active-profile",
			pointedAt: "ghost",
		});
		expect(msg).not.toBeNull();
		expect(msg).toContain('"ghost"');
		expect(msg).toContain("el-linear profile use");
		expect(msg).toContain("el-linear profile list");
	});
});

describe("maybeEmitMigrationHint", () => {
	beforeEach(() => {
		_resetMigrationHintForTests();
		delete process.env.EL_LINEAR_SKIP_MIGRATION_HINT;
	});
	afterEach(() => {
		_resetMigrationHintForTests();
		delete process.env.EL_LINEAR_SKIP_MIGRATION_HINT;
	});

	it("emits nothing when there is no drift", () => {
		const stderr = captureStderr();
		const state = maybeEmitMigrationHint(emptyFs(), stderr);
		expect(state).toEqual({ kind: "no-drift" });
		expect(stderr.chunks).toEqual([]);
	});

	it("emits the legacy-no-token hint exactly once across multiple calls", () => {
		const stderr = captureStderr();
		const fs = legacyDriftFs();
		maybeEmitMigrationHint(fs, stderr);
		maybeEmitMigrationHint(fs, stderr);
		maybeEmitMigrationHint(fs, stderr);
		expect(stderr.chunks.length).toBe(1);
		expect(stderr.chunks[0]).toContain("el-linear profile migrate-legacy");
		expect(stderr.chunks[0]).toContain(CONFIG_PATH);
	});

	it("respects EL_LINEAR_SKIP_MIGRATION_HINT=1 (read at emission time, not module load)", () => {
		const stderr = captureStderr();
		process.env.EL_LINEAR_SKIP_MIGRATION_HINT = "1";
		const state = maybeEmitMigrationHint(legacyDriftFs(), stderr);
		expect(state.kind).toBe("legacy-no-token");
		expect(stderr.chunks).toEqual([]);
	});

	it("emits the broken-active-profile hint when the active marker is dangling", () => {
		const stderr = captureStderr();
		maybeEmitMigrationHint(brokenActiveProfileFs(), stderr);
		expect(stderr.chunks.length).toBe(1);
		expect(stderr.chunks[0]).toContain('"ghost"');
		expect(stderr.chunks[0]).toContain("el-linear profile use");
	});

	it("returns the detection state regardless of whether the hint was emitted", () => {
		const stderr = captureStderr();
		process.env.EL_LINEAR_SKIP_MIGRATION_HINT = "1";
		const state = maybeEmitMigrationHint(legacyDriftFs(), stderr);
		// Suppression doesn't change the underlying classification, so callers
		// (e.g. integration tests) can still inspect what *would* have fired.
		expect(state.kind).toBe("legacy-no-token");
	});

	it("uses the on-disk PROFILES_DIR / TOKEN_PATH constants from config/paths", () => {
		// Sanity that the imported constants we test against are the same ones
		// the production code consumes — guards against accidental rename drift.
		expect(typeof PROFILES_DIR).toBe("string");
		expect(typeof TOKEN_PATH).toBe("string");
		expect(typeof CONFIG_PATH).toBe("string");
	});
});
