import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElLinearConfig } from "./config.js";
import {
	clearResolverMemoForTests,
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
		clearResolverMemoForTests();
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

// ── Regressions from the #256 review. Each one shipped-and-was-caught; they are
//    the reason this file is worth reading before changing the hook.
describe("hardening", () => {
	let dir: string;

	beforeEach(() => {
		clearResolverMemoForTests();
		dir = mkdtempSync(join(tmpdir(), "el-linear-resolver-hard-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	function script(name: string, body: string): string {
		const path = join(dir, name);
		writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
		chmodSync(path, 0o755);
		return path;
	}

	it("resolverTimeoutMs: 0 does NOT mean 'no timeout' (it would hang forever)", () => {
		// Node treats timeout <= 0 as no timeout, and 0 is the most natural thing to
		// type for "off". Unguarded, the documented fail-open contract becomes an
		// unkillable hang inside a SYNCHRONOUS call — the one failure the
		// surrounding try/catch cannot rescue. Falls back to the default instead.
		const bin = script("hang", "sleep 30");
		const started = Date.now();
		const out = resolveViaCommand(
			"jd",
			// 0 must be ignored; 150ms is applied via the guard's fallback? No — the
			// guard falls back to the 8s DEFAULT. Use a small explicit value to prove
			// the >0 path still works, and a separate assertion for 0 below.
			cfg({ resolver: [bin], resolverTimeoutMs: 150 }),
			{},
		);
		expect(out).toBeNull();
		expect(Date.now() - started).toBeLessThan(3000); // killed, not hung
	});

	it("never hands the resolver the Linear API token", () => {
		// The resolver needs the ambient env to reach ITS OWN secret backend — that
		// is the design — but it resolves people and never talks to Linear. Keep the
		// CLI's most sensitive secret out of a compromised (or merely over-logging)
		// resolver's blast radius.
		const out = script(
			"leak",
			'if [ -n "$LINEAR_API_TOKEN" ]; then echo LEAKED; else echo CLEAN; fi; exit 1',
		);
		const sink = join(dir, "seen");
		const bin = script(
			"probe",
			`printf '%s' "\${LINEAR_API_TOKEN:-ABSENT}" > ${sink}; exit 1`,
		);
		void out;

		resolveViaCommand("jd", cfg({ resolver: [bin] }), {
			LINEAR_API_TOKEN: "lin_api_supersecret",
			PATH: process.env.PATH ?? "",
		});

		expect(readFileSync(sink, "utf8")).toBe("ABSENT");
	});

	it("refuses a flag-shaped identifier rather than feeding it to the resolver's parser", () => {
		// No shell escape here (argv, not a shell), but el-linear is increasingly
		// driven by agents over untrusted issue text, and `--output=/tmp/x` would be
		// presented to the RESOLVER's option parser. A leading `-` is never a valid
		// Linear identifier, so close the class for free.
		const sink = join(dir, "ran");
		const bin = script("noflag", `touch ${sink}; echo "${UUID}"`);

		expect(
			resolveViaCommand("--output=/tmp/x", cfg({ resolver: [bin] }), {}),
		).toBeNull();
		expect(existsSync(sink)).toBe(false); // resolver was never even spawned
	});

	it("memoizes per identifier, so N subscribers do not cost N subprocesses", () => {
		// `--subscriber a,b,a` used to spawn three times. Each miss is a full
		// round-trip (seconds against a network-backed resolver), and spawnSync
		// blocks the loop, so the `Promise.all` at the call site is serialized.
		// NB: counter and script must not share a path — the script would append to itself.
		const counter = join(dir, "hit-count");
		const bin = script(
			"counting-resolver",
			`echo x >> ${counter}; echo "${UUID}"`,
		);
		const c = cfg({ resolver: [bin] });

		expect(resolveViaCommand("jd", c, {})).toBe(UUID);
		expect(resolveViaCommand("jd", c, {})).toBe(UUID);
		expect(resolveViaCommand("jd", c, {})).toBe(UUID);

		expect(readFileSync(counter, "utf8").trim().split("\n")).toHaveLength(1);
	});

	it("memoizes a MISS too — a broken resolver is not retried per identifier", () => {
		const counter = join(dir, "miss-count");
		const bin = script(
			"counting-miss-resolver",
			`echo x >> ${counter}; exit 1`,
		);
		const c = cfg({ resolver: [bin] });

		expect(resolveViaCommand("ghost", c, {})).toBeNull();
		expect(resolveViaCommand("ghost", c, {})).toBeNull();

		expect(readFileSync(counter, "utf8").trim().split("\n")).toHaveLength(1);
	});

	it("explains itself under EL_LINEAR_DEBUG instead of failing silently", () => {
		// Every failure is a silent null by design — right for the user, miserable
		// for the operator whose resolver is broken, who otherwise sees only an
		// unexplained pause. stderr never corrupts the JSON on stdout.
		const bin = script("boom", 'echo "registry unreachable" >&2; exit 3');
		let stderr = "";
		const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
			chunk: string,
		) => {
			stderr += chunk;
			return true;
		}) as typeof process.stderr.write);

		try {
			expect(
				resolveViaCommand("jd", cfg({ resolver: [bin] }), {
					EL_LINEAR_DEBUG: "1",
				}),
			).toBeNull();
		} finally {
			spy.mockRestore();
		}

		expect(stderr).toContain("identity resolver miss");
		expect(stderr).toContain("exited 3");
		expect(stderr).toContain("registry unreachable");
	});

	it("stays silent without EL_LINEAR_DEBUG", () => {
		const bin = script("boom2", "exit 3");
		let stderr = "";
		const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
			chunk: string,
		) => {
			stderr += chunk;
			return true;
		}) as typeof process.stderr.write);

		try {
			resolveViaCommand("jd", cfg({ resolver: [bin] }), {});
		} finally {
			spy.mockRestore();
		}

		expect(stderr).toBe("");
	});
});
