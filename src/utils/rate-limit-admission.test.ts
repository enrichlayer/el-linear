import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRateLimitAdmission } from "./rate-limit-admission.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots
			.splice(0)
			.map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

function admission(
	headroom = "2",
	now = () => Date.parse("2026-08-24T08:00:00Z"),
) {
	const stateRoot = path.join(
		os.tmpdir(),
		`el-linear-admission-${process.pid}-${Date.now()}-${roots.length}`,
	);
	roots.push(stateRoot);
	return createRateLimitAdmission(
		{ apiKey: "lin_api_test_not_a_real_secret" },
		{ env: { EL_LINEAR_RATE_LIMIT_HEADROOM: headroom }, now, stateRoot },
	);
}

describe("rate-limit admission", () => {
	it("is disabled unless headroom is configured", () => {
		expect(
			createRateLimitAdmission(
				{ apiKey: "token" },
				{ env: {}, stateRoot: "/unused" },
			).enabled,
		).toBe(false);
	});

	it("reserves observed capacity and refuses at configured headroom", async () => {
		const gate = admission();
		await gate.observe({
			limit: 2500,
			remaining: 4,
			resetAt: "2026-08-24T09:00:00Z",
		});
		await gate.admit();
		await gate.admit();
		await expect(gate.admit()).rejects.toThrow(
			"2 requests remain, preserving configured headroom 2",
		);
	});

	it("admits one probe after reset and holds followers until observation", async () => {
		let current = Date.parse("2026-08-24T08:00:00Z");
		const gate = admission("2", () => current);
		await gate.observe({ remaining: 2, resetAt: "2026-08-24T09:00:00Z" });
		await expect(gate.admit()).rejects.toThrow("admission refused");
		current = Date.parse("2026-08-24T09:00:01Z");
		await expect(gate.admit()).resolves.toBeUndefined();
		await expect(gate.admit()).rejects.toThrow("admission refused");
		await gate.observe({
			remaining: 2499,
			resetAt: "2026-08-24T10:00:00Z",
		});
		await expect(gate.admit()).resolves.toBeUndefined();
	});

	it("does not refund quota when concurrent responses arrive out of order", async () => {
		const gate = admission();
		await gate.observe({
			remaining: 100,
			resetAt: "2026-08-24T09:00:00Z",
		});
		await gate.observe({
			remaining: 98,
			resetAt: "2026-08-24T09:00:00Z",
		});
		await gate.observe({
			remaining: 99,
			resetAt: "2026-08-24T09:00:00Z",
		});

		for (let index = 0; index < 96; index += 1) await gate.admit();
		await expect(gate.admit()).rejects.toThrow(
			"2 requests remain, preserving configured headroom 2",
		);
	});

	it("uses an explicit quota key without persisting it in clear text", async () => {
		const stateRoot = path.join(
			os.tmpdir(),
			`el-linear-admission-key-${process.pid}-${Date.now()}`,
		);
		roots.push(stateRoot);
		const gate = createRateLimitAdmission(
			{ apiKey: "token-a" },
			{
				env: {
					EL_LINEAR_RATE_LIMIT_HEADROOM: "1",
					EL_LINEAR_QUOTA_KEY: "shared-user",
				},
				stateRoot,
			},
		);
		await gate.observe({ remaining: 10 });
		const names = await fs.readdir(stateRoot);
		expect(names).toHaveLength(1);
		expect(names[0]).not.toContain("shared-user");
		expect(
			await fs.readFile(path.join(stateRoot, names[0] as string), "utf8"),
		).not.toContain("shared-user");
	});
});
