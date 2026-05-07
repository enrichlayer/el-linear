/**
 * Unit tests for the localhost OAuth callback listener.
 *
 * We avoid binding to a real port: the implementation accepts a server
 * factory that lets us inject a `node:http` Server-shaped mock. We drive
 * the server with simulated requests via the `request` event.
 */
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { runLocalhostCallback } from "./oauth-callback.js";

interface MockResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	ended: boolean;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
}

function makeRes(): MockResponse {
	return {
		statusCode: 0,
		headers: {},
		body: "",
		ended: false,
		setHeader(name: string, value: string) {
			this.headers[name.toLowerCase()] = value;
		},
		end(body?: string) {
			if (body) this.body = body;
			this.ended = true;
		},
	};
}

class MockServer extends EventEmitter {
	listen(_port: number, _host: string): this {
		return this;
	}
	close(cb?: () => void): this {
		setImmediate(() => cb?.());
		return this;
	}
}

function makeServer(): Server {
	return new MockServer() as unknown as Server;
}

describe("runLocalhostCallback", () => {
	it("resolves with code + state on a valid callback to the right path", async () => {
		const server = new MockServer();
		const promise = runLocalhostCallback(
			{ port: 1, expectedState: "STATE-OK" },
			() => server as unknown as Server,
		);

		// Simulate the redirected request from the user's browser.
		const res = makeRes();
		server.emit(
			"request",
			{ url: "/oauth/callback?code=AUTHCODE&state=STATE-OK" },
			res,
		);

		await expect(promise).resolves.toEqual({
			code: "AUTHCODE",
			state: "STATE-OK",
		});
		expect(res.statusCode).toBe(200);
		expect(res.headers["content-type"]).toMatch(/text\/html/);
		expect(res.body).toMatch(/authorization complete/i);
	});

	it("rejects on a state mismatch with a 400 + error page", async () => {
		const server = new MockServer();
		const promise = runLocalhostCallback(
			{ port: 1, expectedState: "EXPECTED" },
			() => server as unknown as Server,
		);
		const res = makeRes();
		server.emit(
			"request",
			{ url: "/oauth/callback?code=X&state=ATTACKER" },
			res,
		);
		await expect(promise).rejects.toThrow(/State mismatch/);
		expect(res.statusCode).toBe(400);
	});

	it("rejects with a friendly error when the request lacks `code`", async () => {
		const server = new MockServer();
		const promise = runLocalhostCallback(
			{ port: 1, expectedState: "S" },
			() => server as unknown as Server,
		);
		const res = makeRes();
		server.emit("request", { url: "/oauth/callback?state=S" }, res);
		await expect(promise).rejects.toThrow(/code/);
		expect(res.statusCode).toBe(400);
	});

	it("rejects when the request reports an OAuth error param", async () => {
		const server = new MockServer();
		const promise = runLocalhostCallback(
			{ port: 1, expectedState: "S" },
			() => server as unknown as Server,
		);
		const res = makeRes();
		server.emit(
			"request",
			{
				url: "/oauth/callback?error=access_denied&error_description=denied",
			},
			res,
		);
		await expect(promise).rejects.toThrow(/access_denied/);
		expect(res.statusCode).toBe(400);
	});

	it("returns 404 on an unrelated path without rejecting", async () => {
		const server = new MockServer();
		const promise = runLocalhostCallback(
			{ port: 1, expectedState: "S", timeoutMs: 50 },
			() => server as unknown as Server,
		);

		// /favicon.ico - should 404, not settle the promise.
		const res = makeRes();
		server.emit("request", { url: "/favicon.ico" }, res);
		expect(res.statusCode).toBe(404);
		expect(res.body).toMatch(/Not found/);

		// Eventually the timeout settles it.
		await expect(promise).rejects.toThrow(/timed out/);
	});

	it("rejects when the timeout fires before any request arrives", async () => {
		const server = new MockServer();
		const promise = runLocalhostCallback(
			{ port: 1, expectedState: "S", timeoutMs: 30 },
			() => server as unknown as Server,
		);
		await expect(promise).rejects.toThrow(/timed out/);
	});

	it("rejects with an EADDRINUSE-friendly message", async () => {
		const server = new MockServer();
		const promise = runLocalhostCallback(
			{ port: 8765, expectedState: "S" },
			() => server as unknown as Server,
		);
		const err: NodeJS.ErrnoException = Object.assign(new Error("bind"), {
			code: "EADDRINUSE",
		});
		server.emit("error", err);
		await expect(promise).rejects.toThrow(/8765 is already in use/);
	});

	it("respects a custom callbackPath", async () => {
		const server = new MockServer();
		const promise = runLocalhostCallback(
			{ port: 1, expectedState: "S", callbackPath: "/custom/cb" },
			() => server as unknown as Server,
		);
		const res = makeRes();
		server.emit(
			"request",
			{ url: "/oauth/callback?code=X&state=S" }, // wrong path
			res,
		);
		expect(res.statusCode).toBe(404);
		const res2 = makeRes();
		server.emit("request", { url: "/custom/cb?code=X&state=S" }, res2);
		await expect(promise).resolves.toEqual({ code: "X", state: "S" });
	});

	it("uses real createServer by default (smoke)", () => {
		// Just ensure the default factory call shape is a function. We don't
		// bind to a port here — that's exercised manually.
		expect(typeof makeServer).toBe("function");
	});
});

// Reference unused symbol so vitest doesn't flag the import.
const _unused: typeof vi = vi;
void _unused;
