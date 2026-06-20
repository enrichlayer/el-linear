import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitGateEvent, gateEventsPath } from "./gate-telemetry.js";

describe("gateEventsPath", () => {
	const saved = process.env.EL_TELEMETRY_DIR;
	afterEach(() => {
		if (saved === undefined) delete process.env.EL_TELEMETRY_DIR;
		else process.env.EL_TELEMETRY_DIR = saved;
	});

	it("honors EL_TELEMETRY_DIR", () => {
		process.env.EL_TELEMETRY_DIR = "/custom/dir";
		expect(gateEventsPath()).toBe("/custom/dir/gate-events.jsonl");
	});

	it("defaults under ~/.cache/el-telemetry", () => {
		delete process.env.EL_TELEMETRY_DIR;
		expect(
			gateEventsPath().endsWith("/.cache/el-telemetry/gate-events.jsonl"),
		).toBe(true);
	});
});

describe("emitGateEvent", () => {
	let dir: string;
	const savedDir = process.env.EL_TELEMETRY_DIR;
	const savedDisabled = process.env.EL_TELEMETRY_DISABLED;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "gate-tel-"));
		process.env.EL_TELEMETRY_DIR = dir;
		delete process.env.EL_TELEMETRY_DISABLED;
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
		if (savedDir === undefined) delete process.env.EL_TELEMETRY_DIR;
		else process.env.EL_TELEMETRY_DIR = savedDir;
		if (savedDisabled === undefined) delete process.env.EL_TELEMETRY_DISABLED;
		else process.env.EL_TELEMETRY_DISABLED = savedDisabled;
	});

	it("appends a well-formed gate event (creating the dir)", async () => {
		await emitGateEvent("el-linear", "issues create", {
			gate: "issues-create-dup",
			outcome: "blocked",
			topScore: 0.62,
			candidateCount: 2,
		});
		const raw = await readFile(join(dir, "gate-events.jsonl"), "utf8");
		const rec = JSON.parse(raw.trim());
		expect(rec).toMatchObject({
			kind: "gate",
			name: "el-linear",
			subcommand: "issues create",
			metadata: {
				gate: "issues-create-dup",
				outcome: "blocked",
				top_score: 0.62,
				candidate_count: 2,
			},
		});
		expect(typeof rec.ts).toBe("string");
	});

	it("appends one line per event", async () => {
		await emitGateEvent("el-linear", "issues create", {
			gate: "issues-create-dup",
			outcome: "blocked",
		});
		await emitGateEvent("el-linear", "issues create", {
			gate: "issues-create-dup",
			outcome: "overridden",
		});
		const raw = await readFile(join(dir, "gate-events.jsonl"), "utf8");
		expect(raw.trim().split("\n")).toHaveLength(2);
	});

	it("is a no-op when EL_TELEMETRY_DISABLED is set", async () => {
		process.env.EL_TELEMETRY_DISABLED = "1";
		await emitGateEvent("el-linear", "issues create", {
			gate: "issues-create-dup",
			outcome: "blocked",
		});
		await expect(
			readFile(join(dir, "gate-events.jsonl"), "utf8"),
		).rejects.toThrow();
	});

	it("never throws when the ledger dir can't be created", async () => {
		// Point EL_TELEMETRY_DIR at a path *under a regular file* so the
		// recursive mkdir fails fast with ENOTDIR — a deterministic,
		// cross-platform unwritable-path simulation (a NUL-byte path can hang
		// on some Linux fs layers; an EACCES dir is flaky under CI-as-root).
		const blocker = join(dir, "iam-a-file");
		await writeFile(blocker, "x", "utf8");
		process.env.EL_TELEMETRY_DIR = join(blocker, "nested");
		await expect(
			emitGateEvent("el-linear", "issues create", {
				gate: "issues-create-dup",
				outcome: "blocked",
			}),
		).resolves.toBeUndefined();
	});
});
