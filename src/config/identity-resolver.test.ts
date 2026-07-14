import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ElLinearConfig } from "./config.js";
import {
	isResolverConfigured,
	parseResolverOutput,
	resolverCommand,
	resolveViaCommand,
} from "./identity-resolver.js";

/** Obviously-synthetic — never a real person's Linear id. */
const UUID = "00000000-0000-4000-8000-000000000001";

/** Only the slice of config the resolver reads. */
function cfg(
	identity?: ElLinearConfig["identity"],
): Pick<ElLinearConfig, "identity"> {
	return identity ? { identity } : {};
}

describe("resolverCommand", () => {
	it("is off when nothing is configured", () => {
		expect(resolverCommand(cfg(), {})).toBeNull();
		expect(isResolverConfigured(cfg(), {})).toBe(false);
	});

	it("reads the argv array from config", () => {
		expect(
			resolverCommand(cfg({ resolver: ["el-identity", "resolve"] }), {}),
		).toEqual(["el-identity", "resolve"]);
	});

	it("lets the env override config", () => {
		const c = cfg({ resolver: ["el-identity", "resolve"] });
		expect(
			resolverCommand(c, { EL_LINEAR_IDENTITY_RESOLVER: "my-resolver --json" }),
		).toEqual(["my-resolver", "--json"]);
	});

	it("treats an empty env value as an explicit OFF switch", () => {
		// A configured resolver you can disable for one invocation without editing
		// files — the reason env wins over config at all.
		const c = cfg({ resolver: ["el-identity", "resolve"] });
		expect(resolverCommand(c, { EL_LINEAR_IDENTITY_RESOLVER: "" })).toBeNull();
		expect(
			resolverCommand(c, { EL_LINEAR_IDENTITY_RESOLVER: "   " }),
		).toBeNull();
	});

	it("ignores an empty resolver array", () => {
		expect(resolverCommand(cfg({ resolver: [] }), {})).toBeNull();
	});
});

describe("parseResolverOutput", () => {
	it("accepts a bare UUID", () => {
		expect(parseResolverOutput(`${UUID}\n`)).toBe(UUID);
	});

	it.each([
		["linearId", JSON.stringify({ linearId: UUID })],
		["id", JSON.stringify({ id: UUID })],
		["{data} envelope", JSON.stringify({ data: { linearId: UUID }, meta: {} })],
		["JSON string", JSON.stringify(UUID)],
	])("accepts the %s shape", (_label, stdout) => {
		expect(parseResolverOutput(stdout)).toBe(UUID);
	});

	it("misses on empty output", () => {
		expect(parseResolverOutput("")).toBeNull();
		expect(parseResolverOutput("   \n")).toBeNull();
	});

	it("REJECTS a non-UUID string — the shape a confused resolver most likely emits", () => {
		// Handing a bogus id to Linear produces an opaque "Argument Validation
		// Error" (DEV-4312 in a new costume). Far better to miss and let Linear's
		// own name lookup answer.
		expect(parseResolverOutput("jd")).toBeNull();
		expect(parseResolverOutput("not-a-uuid")).toBeNull();
		expect(parseResolverOutput(JSON.stringify({ linearId: "jd" }))).toBeNull();
	});

	it("misses on an error envelope rather than mistaking it for an answer", () => {
		expect(
			parseResolverOutput(JSON.stringify({ error: "not found" })),
		).toBeNull();
	});

	it("misses on non-JSON noise", () => {
		expect(
			parseResolverOutput("Traceback (most recent call last):"),
		).toBeNull();
	});
});

describe("resolveViaCommand", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "el-linear-resolver-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	/** Write an executable shell script and return its path. */
	function script(name: string, body: string): string {
		const path = join(dir, name);
		writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
		chmodSync(path, 0o755);
		return path;
	}

	it("returns null when no resolver is configured (the default install)", () => {
		expect(resolveViaCommand("jd", cfg(), {})).toBeNull();
	});

	it("resolves via the command, passing the identifier as the last argv element", () => {
		// Echo back the last argument, so the test proves argv wiring, not just output.
		const bin = script("resolver", `[ "$2" = "jd" ] && echo "${UUID}"`);
		expect(
			resolveViaCommand("jd", cfg({ resolver: [bin, "resolve"] }), {}),
		).toBe(UUID);
	});

	it("accepts a JSON record from the command", () => {
		const bin = script(
			"resolver",
			`echo '{"linearId":"${UUID}","name":"J. Doe"}'`,
		);
		expect(resolveViaCommand("jd", cfg({ resolver: [bin] }), {})).toBe(UUID);
	});

	it("misses (null) on a non-zero exit — e.g. the registry said not-found", () => {
		const bin = script("resolver", `echo 'no match' >&2; exit 1`);
		expect(resolveViaCommand("ghost", cfg({ resolver: [bin] }), {})).toBeNull();
	});

	it("misses (null) when the resolver binary does not exist", () => {
		// An operator who configures a resolver they haven't installed yet gets
		// plain el-linear, not a crash on every command.
		expect(
			resolveViaCommand(
				"jd",
				cfg({ resolver: ["/definitely/not/a/binary"] }),
				{},
			),
		).toBeNull();
	});

	it("misses (null) when the resolver hangs past the timeout", () => {
		const bin = script("resolver", "sleep 5");
		expect(
			resolveViaCommand(
				"jd",
				cfg({ resolver: [bin], resolverTimeoutMs: 150 }),
				{},
			),
		).toBeNull();
	});

	it("misses (null) when the resolver prints garbage", () => {
		const bin = script("resolver", "echo 'not a uuid at all'");
		expect(resolveViaCommand("jd", cfg({ resolver: [bin] }), {})).toBeNull();
	});

	// ── Security: the identifier is untrusted input. ──────────────────────────
	it("never lets the identifier reach a shell", () => {
		// With shell: true this would create the sentinel. It must NOT exist: the
		// identifier is an argv element, so `; touch …` is a literal name, not a
		// command. The resolver is trusted (the operator configured it); the thing
		// the user typed is not.
		const sentinel = join(dir, "PWNED");
		const bin = script("resolver", "exit 1");

		const injected = `x"; touch ${sentinel}; echo "`;
		expect(
			resolveViaCommand(injected, cfg({ resolver: [bin] }), {}),
		).toBeNull();

		expect(() => rmSync(sentinel)).toThrow(); // i.e. it was never created
	});

	it("does not hang when the resolver tries to read stdin", () => {
		// stdio[0] is 'ignore', so a resolver that prompts gets EOF instead of
		// blocking a short-lived CLI forever.
		const bin = script("resolver", `read -r x; echo "${UUID}"`);
		expect(resolveViaCommand("jd", cfg({ resolver: [bin] }), {})).toBe(UUID);
	});

	it("is driven by the env override too", () => {
		const bin = script("resolver", `echo "${UUID}"`);
		expect(
			resolveViaCommand("jd", cfg(), { EL_LINEAR_IDENTITY_RESOLVER: bin }),
		).toBe(UUID);
	});
});
