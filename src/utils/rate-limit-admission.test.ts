import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRateLimitAdmission,
	RateLimitAdmissionRefusal,
} from "./rate-limit-admission.js";

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

	it("permits only one initial probe before the first observation", async () => {
		const gate = admission();
		await expect(gate.admit()).resolves.toBeUndefined();
		await expect(gate.admit()).rejects.toThrow("probe is already in flight");
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

	it("recovers when a probe fails before reporting rate-limit headers", async () => {
		let current = Date.parse("2026-08-24T08:00:00Z");
		const gate = admission("2", () => current);
		await expect(gate.admit()).resolves.toBeUndefined();
		current += 29_999;
		await expect(gate.admit()).rejects.toThrow("probe is already in flight");
		current += 1;
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

	it("uses the distributed coordinator when configured", async () => {
		const fetchImpl = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ admitted: true }),
		});
		const gate = createRateLimitAdmission(
			{ apiKey: "token-a" },
			{
				env: {
					EL_LINEAR_RATE_LIMIT_HEADROOM: "25",
					EL_LINEAR_QUOTA_KEY: "shared-user",
					EL_LINEAR_RATE_LIMIT_COORDINATOR_URL: "https://quota.example/",
					EL_LINEAR_RATE_LIMIT_COORDINATOR_TOKEN: "control-token",
				},
				fetchImpl,
			},
		);
		await gate.admit();
		await gate.observe({
			limit: 2500,
			remaining: 2400,
			resetAt: "2026-08-24T10:00:00Z",
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(fetchImpl.mock.calls[0][0]).toMatch(
			/^https:\/\/quota\.example\/v1\/quota\/[a-f0-9]{64}\/admit$/,
		);
		expect(fetchImpl.mock.calls[0][1]).toMatchObject({
			headers: { authorization: "Bearer control-token" },
		});
		expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
			limit: 2500,
			remaining: 2400,
			resetAt: "2026-08-24T10:00:00Z",
		});
	});

	it("rejects a remote HTTP coordinator before exposing its bearer token", () => {
		const fetchImpl = vi.fn();
		expect(() =>
			createRateLimitAdmission(
				{ apiKey: "token-a" },
				{
					env: {
						EL_LINEAR_RATE_LIMIT_HEADROOM: "25",
						EL_LINEAR_RATE_LIMIT_COORDINATOR_URL:
							"http://quota.example/v1",
						EL_LINEAR_RATE_LIMIT_COORDINATOR_TOKEN: "control-token",
					},
					fetchImpl,
				},
			),
		).toThrow("must use HTTPS");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each(["localhost", "127.0.0.1", "[::1]"])(
		"allows explicit loopback HTTP coordinator host %s",
		async (host) => {
			const fetchImpl = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ admitted: true }),
			});
			const gate = createRateLimitAdmission(
				{ apiKey: "token-a" },
				{
					env: {
						EL_LINEAR_RATE_LIMIT_HEADROOM: "25",
						EL_LINEAR_RATE_LIMIT_COORDINATOR_URL: `http://${host}:8787`,
						EL_LINEAR_RATE_LIMIT_COORDINATOR_TOKEN: "control-token",
					},
					fetchImpl,
				},
			);

			await expect(gate.admit()).resolves.toBeUndefined();
			expect(fetchImpl).toHaveBeenCalledTimes(1);
		},
	);

	it("surfaces a coordinator headroom refusal before the Linear request", async () => {
		const gate = createRateLimitAdmission(
			{ apiKey: "token-a" },
			{
				env: {
					EL_LINEAR_RATE_LIMIT_HEADROOM: "25",
					EL_LINEAR_RATE_LIMIT_COORDINATOR_URL: "https://quota.example",
					EL_LINEAR_RATE_LIMIT_COORDINATOR_TOKEN: "control-token",
				},
				fetchImpl: vi.fn().mockResolvedValue({
					ok: false,
					status: 429,
					json: async () => ({
						state: {
							remaining: 25,
							resetAt: "2026-08-24T10:00:00Z",
						},
					}),
				}),
			},
		);
		await expect(gate.admit()).rejects.toMatchObject({
			name: "RateLimitAdmissionRefusal",
			message: expect.stringContaining(
				"distributed admission refused: 25 requests remain",
			),
		});
		await expect(gate.admit()).rejects.toBeInstanceOf(
			RateLimitAdmissionRefusal,
		);
	});

	it("requires a coordinator token instead of failing open", () => {
		expect(() =>
			createRateLimitAdmission(
				{ apiKey: "token-a" },
				{
					env: {
						EL_LINEAR_RATE_LIMIT_HEADROOM: "25",
						EL_LINEAR_RATE_LIMIT_COORDINATOR_URL: "https://quota.example",
					},
				},
			),
		).toThrow("EL_LINEAR_RATE_LIMIT_COORDINATOR_TOKEN is required");
	});
});
