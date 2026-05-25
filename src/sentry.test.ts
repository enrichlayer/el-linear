import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initMock, setTagMock, captureMock, flushMock } = vi.hoisted(() => ({
	initMock: vi.fn(),
	setTagMock: vi.fn(),
	captureMock: vi.fn(),
	flushMock: vi.fn(() => Promise.resolve(true)),
}));
// el-linear loads @sentry/node via a DYNAMIC import; vi.mock intercepts both
// static and dynamic imports of the specifier, so the dynamic-import path is
// exercised for real here (not bypassed).
vi.mock("@sentry/node", () => ({
	init: initMock,
	setTag: setTagMock,
	captureException: captureMock,
	flush: flushMock,
}));

import {
	initCliSentry,
	REDACTED,
	resolveDsn,
	scrubEvent,
	scrubString,
	scrubValue,
} from "./sentry.js";

const FAKE_DSN = "https://abc123@o123.ingest.sentry.io/456";

describe("scrubString (pure)", () => {
	it("redacts credential-shaped substrings", () => {
		expect(scrubString("token glpat-ABCDEFGHIJ1234567890 done")).toContain(
			REDACTED,
		);
		expect(scrubString("ghp_0123456789abcdefghij0123456789abcd")).toBe(
			REDACTED,
		);
		expect(scrubString("github_pat_0123456789ABCDEFGHIJ0123456789")).toBe(
			REDACTED,
		);
		expect(scrubString("xoxb-1111-2222-aaaabbbbcccc")).toContain(REDACTED);
		expect(scrubString("xapp-1-A0123-456-deadbeefcafe")).toContain(REDACTED);
		// el-linear's own primary credential — a Linear API key.
		expect(scrubString("lin_api_0123456789ABCDEFGHIJ0123456789")).toBe(
			REDACTED,
		);
		expect(scrubString("Authorization: Bearer abcdef0123456789")).toContain(
			REDACTED,
		);
		expect(scrubString("https://user:s3cr3tpass@host.com/x")).toContain(
			REDACTED,
		);
	});

	it("leaves innocent strings untouched", () => {
		expect(scrubString("just a normal error message")).toBe(
			"just a normal error message",
		);
	});
});

describe("scrubValue (pure)", () => {
	it("redacts whole values under secret-named keys", () => {
		expect(scrubValue({ LINEAR_API_KEY: "anything", note: "ok" })).toEqual({
			LINEAR_API_KEY: REDACTED,
			note: "ok",
		});
		expect(scrubValue({ Authorization: "Bearer xyz" })).toEqual({
			Authorization: REDACTED,
		});
	});

	it("scrubs credential substrings under innocent keys, recursively", () => {
		expect(
			scrubValue({
				args: ["--token", "lin_api_0123456789ABCDEFGHIJ0123456789"],
			}),
		).toEqual({
			args: ["--token", REDACTED],
		});
	});

	it("fails CLOSED past the depth cap — a deeply-nested credential is redacted, not leaked", () => {
		let deep: Record<string, unknown> = {
			secret_at_leaf: "glpat-ABCDEFGHIJ1234567890",
		};
		for (let i = 0; i < 20; i++) {
			deep = { nested: deep };
		}
		expect(() => scrubValue(deep)).not.toThrow();
		// The raw credential must NOT survive past the recursion cap.
		expect(JSON.stringify(scrubValue(deep))).not.toContain(
			"glpat-ABCDEFGHIJ1234567890",
		);
	});

	it("passes through primitives", () => {
		expect(scrubValue(42)).toBe(42);
		expect(scrubValue(null)).toBeNull();
		expect(scrubValue(true)).toBe(true);
	});
});

describe("scrubEvent (pure) — realistic Sentry event", () => {
	it("redacts secrets across message, exception, extra, and request headers/env", () => {
		const scrubbed = scrubEvent({
			message: "failed calling api with glpat-ABCDEFGHIJ1234567890",
			exception: {
				values: [
					{
						type: "Error",
						value: "auth failed: ghp_0123456789abcdefghij0123456789abcd",
					},
				],
			},
			extra: {
				command: "el-linear issues read DEV-1",
				LINEAR_API_KEY: "lin_api_supersecretvalue",
			},
			request: {
				headers: {
					Authorization: "Bearer deadbeefcafef00d",
					"User-Agent": "el-linear",
				},
				env: { SENTRY_DSN_CLI: "https://k@o.sentry.io/1", HOME: "/Users/x" },
			},
		}) as Record<string, unknown>;

		const flat = JSON.stringify(scrubbed);
		expect(flat).not.toContain("glpat-ABCDEFGHIJ1234567890");
		expect(flat).not.toContain("ghp_0123456789abcdefghij0123456789abcd");
		expect(flat).not.toContain("lin_api_supersecretvalue");
		expect(flat).not.toContain("deadbeefcafef00d");
		// secret-named keys redacted; innocent values preserved
		const req = scrubbed.request as Record<string, Record<string, string>>;
		expect(req.headers.Authorization).toBe(REDACTED);
		expect(req.headers["User-Agent"]).toBe("el-linear");
		expect(req.env.HOME).toBe("/Users/x");
	});
});

describe("resolveDsn (env-only — no Vault)", () => {
	beforeEach(() => {
		delete process.env.EL_SENTRY_DISABLED;
		delete process.env.SENTRY_DSN_CLI;
		delete process.env.SENTRY_DSN;
	});

	it("returns null when EL_SENTRY_DISABLED=1", () => {
		process.env.EL_SENTRY_DISABLED = "1";
		process.env.SENTRY_DSN_CLI = FAKE_DSN;
		expect(resolveDsn()).toBeNull();
	});

	it("reads only the namespaced SENTRY_DSN_CLI", () => {
		process.env.SENTRY_DSN_CLI = FAKE_DSN;
		expect(resolveDsn()).toBe(FAKE_DSN);
	});

	it("does NOT fall back to the conventional SENTRY_DSN (OSS collision foot-gun)", () => {
		// An OSS user's own app commonly sets SENTRY_DSN; el-linear must not
		// hijack it. Only our namespaced var activates reporting (DEV-4349).
		process.env.SENTRY_DSN = "https://someone-elses@o.sentry.io/9";
		expect(resolveDsn()).toBeNull();
	});

	it("returns null when nothing is configured", () => {
		expect(resolveDsn()).toBeNull();
	});
});

describe("initCliSentry (composition — dynamic import + init wiring + scrubbing beforeSend)", () => {
	beforeEach(() => {
		initMock.mockReset();
		setTagMock.mockReset();
		delete process.env.EL_SENTRY_DISABLED;
		delete process.env.SENTRY_DSN_CLI;
		delete process.env.SENTRY_DSN;
	});
	afterEach(() => {
		process.removeAllListeners("uncaughtException");
		process.removeAllListeners("unhandledRejection");
	});

	it("no-ops (returns false, no init) when disabled", async () => {
		process.env.EL_SENTRY_DISABLED = "1";
		expect(await initCliSentry("el-linear")).toBe(false);
		expect(initMock).not.toHaveBeenCalled();
	});

	it("no-ops when no DSN resolves (SDK never loaded)", async () => {
		expect(await initCliSentry("el-linear")).toBe(false);
		expect(initMock).not.toHaveBeenCalled();
	});

	it("initializes with release + tag + a scrubbing beforeSend when a DSN is given", async () => {
		expect(
			await initCliSentry("el-linear", { dsn: FAKE_DSN, version: "1.18.0" }),
		).toBe(true);
		expect(initMock).toHaveBeenCalledTimes(1);

		const cfg = initMock.mock.calls[0][0] as {
			dsn: string;
			release: string;
			tracesSampleRate: number;
			beforeSend: (e: unknown) => unknown;
		};
		expect(cfg.dsn).toBe(FAKE_DSN);
		expect(cfg.release).toBe("el-linear@1.18.0");
		expect(cfg.tracesSampleRate).toBe(0);
		expect(setTagMock).toHaveBeenCalledWith("cli", "el-linear");

		// The whole point: the wired beforeSend actually scrubs (predicate → real scrub → end-state).
		const out = cfg.beforeSend({
			message: "boom with glpat-ABCDEFGHIJ1234567890",
			extra: { LINEAR_API_KEY: "lin_api_secretvaluehere000000" },
		}) as Record<string, unknown>;
		const flat = JSON.stringify(out);
		expect(flat).not.toContain("glpat-ABCDEFGHIJ1234567890");
		expect((out.extra as Record<string, string>).LINEAR_API_KEY).toBe(REDACTED);
	});

	it("no-ops (returns false) when @sentry/node is not installed — the OSS-safe path", async () => {
		// Simulate the optional dependency being absent: the dynamic import rejects.
		vi.resetModules();
		vi.doMock("@sentry/node", () => {
			throw new Error("Cannot find module '@sentry/node'");
		});
		const { initCliSentry: freshInit } = await import("./sentry.js");
		expect(await freshInit("el-linear", { dsn: FAKE_DSN })).toBe(false);
		vi.doUnmock("@sentry/node");
		vi.resetModules();
	});
});
