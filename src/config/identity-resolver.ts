import { spawnSync } from "node:child_process";
import type { ElLinearConfig } from "./config.js";

/**
 * Optional **identity resolver hook** (DEV-5628).
 *
 * Some organizations keep a people registry that knows things Linear does not:
 * that `jd` is a person, that a GitLab handle and a Linear handle belong to the
 * same human. el-linear can consult it — but it must never learn *how* to reach it.
 *
 * So the hook is a **command**, not an HTTP client:
 *
 *   identity.resolver = ["el-identity", "resolve"]
 *
 * el-linear appends the identifier as the final argv element, runs the command,
 * and reads a Linear user UUID off stdout. That is the entire contract.
 *
 * Why a command rather than a URL + credentials (which is what
 * `registry-resolve.ts` does, and why that path stayed dormant): el-linear is
 * MIT and published on npm. Most installs are not Enrich Layer. Baking in an
 * auth scheme means baking in *somebody's* auth scheme — and the moment we did,
 * the next organization would need Infisical, or 1Password, or a plain env var,
 * or SSO. A command has no such problem: the credential lives entirely inside
 * whatever the operator points this at. Adding a new secret backend is writing a
 * different script, not patching this package.
 *
 * The command is trusted (the operator configured it) but the *identifier* is
 * not, so it is passed as an argv element with `shell: false` — a name like
 * `"; rm -rf /"` is an argument, never a command.
 *
 * Fail-open by design: unconfigured, a miss, a non-zero exit, a timeout, an
 * unparseable answer, or a missing binary all return `null`, and the caller
 * falls through to Linear's own user lookup (which resolves names and emails
 * perfectly well — see `LinearService.resolveUserId`). This hook is an
 * *enhancement*, so a broken resolver must degrade to plain el-linear rather
 * than break every command. It never throws.
 */

/** Env override — a whitespace-separated command, e.g. `el-identity resolve`. */
const RESOLVER_ENV = "EL_LINEAR_IDENTITY_RESOLVER";

/** A resolver that hasn't answered in this long is not going to. */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Per-process memo. A single command can resolve the same person several times —
 * `--subscriber a,b,a`, or an assignee who is also a subscriber — and each miss
 * costs a full subprocess round-trip (seconds, against a network-backed
 * resolver). Nothing here is cached across processes: el-linear is short-lived,
 * and a stale identity cache on disk is exactly the drift this hook exists to
 * remove.
 */
const memo = new Map<string, string | null>();

/** Test seam — the memo would otherwise leak between cases in one vitest process. */
export function clearResolverMemoForTests(): void {
	memo.clear();
}

/**
 * Resolve the effective timeout.
 *
 * `?? DEFAULT` is not enough: Node treats `timeout <= 0` as *no timeout*, and `0`
 * is the most natural thing to type when you mean "off". That would turn the
 * documented fail-open contract into an unkillable hang inside a synchronous
 * call — the one failure mode the surrounding try/catch cannot save you from.
 */
function resolveTimeoutMs(config: Pick<ElLinearConfig, "identity">): number {
	const configured = config.identity?.resolverTimeoutMs;
	return typeof configured === "number" && configured > 0
		? configured
		: DEFAULT_TIMEOUT_MS;
}

/**
 * The environment handed to the resolver.
 *
 * It inherits the ambient env on purpose — reaching its own secret backend
 * (Vault, Infisical, 1Password, a plain env var) is the entire point, so
 * scrubbing wholesale would defeat the design. But the resolver has no business
 * with *Linear's* token: it resolves people, it never talks to Linear. Dropping
 * it keeps the CLI's most sensitive secret out of the blast radius of a
 * compromised — or merely over-logging — resolver.
 */
function resolverEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const { LINEAR_API_TOKEN: _dropped, ...rest } = env;
	return rest;
}

/**
 * Debug-gated diagnosis. Every failure here is a silent `null` by design, which
 * is right for the user but miserable for the operator whose resolver is broken:
 * all they see is an unexplained pause. `EL_LINEAR_DEBUG=1` is this repo's
 * existing convention for "tell me what actually happened", and stderr never
 * corrupts the JSON on stdout.
 */
function debugMiss(reason: string, env: NodeJS.ProcessEnv): void {
	if (!env.EL_LINEAR_DEBUG) return;
	process.stderr.write(`el-linear: identity resolver miss — ${reason}\n`);
}

/**
 * The configured resolver argv, or `null` when the hook is off.
 *
 * Env wins over config so a single invocation can point at a different resolver
 * (or disable one) without editing files: `EL_LINEAR_IDENTITY_RESOLVER=""` is an
 * explicit off switch.
 */
export function resolverCommand(
	config: Pick<ElLinearConfig, "identity">,
	env: NodeJS.ProcessEnv = process.env,
): string[] | null {
	const fromEnv = env[RESOLVER_ENV];
	if (fromEnv !== undefined) {
		const argv = fromEnv.trim().split(/\s+/).filter(Boolean);
		return argv.length > 0 ? argv : null;
	}

	const configured = config.identity?.resolver;
	if (!configured || configured.length === 0) {
		return null;
	}
	return configured;
}

/** True when an identity resolver is configured (env or config). */
export function isResolverConfigured(
	config: Pick<ElLinearConfig, "identity">,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return resolverCommand(config, env) !== null;
}

/**
 * Pull a Linear user UUID out of whatever the resolver printed.
 *
 * Deliberately generous about the shape, because the point of this hook is that
 * anyone can write the resolver — demanding one exact JSON envelope would make
 * the "just shell out to your own script" promise a lie. Accepted:
 *
 *   - a bare UUID:                     `3f2a…`
 *   - `{"linearId": "3f2a…"}`     (the el-identity record shape)
 *   - `{"data": {"linearId": "…"}}`    (an el-* CLI `{data, meta}` envelope)
 *   - `{"id": "3f2a…"}`           (the obvious alternative spelling)
 *
 * Anything else — including a *non*-UUID string, which is the shape a confused
 * resolver most plausibly emits — is a miss. We would rather fall through to
 * Linear's own lookup than hand a bogus id to the API and produce an opaque
 * "Argument Validation Error" (the DEV-4312 failure, in a new costume).
 */
export function parseResolverOutput(stdout: string): string | null {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return null;
	}

	if (UUID_RE.test(trimmed)) {
		return trimmed;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}

	const candidate = pickLinearId(parsed);
	return candidate && UUID_RE.test(candidate) ? candidate : null;
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pickLinearId(parsed: unknown): string | null {
	if (typeof parsed === "string") {
		return parsed;
	}
	if (!parsed || typeof parsed !== "object") {
		return null;
	}
	const obj = parsed as Record<string, unknown>;

	for (const key of ["linearId", "id"]) {
		const value = obj[key];
		if (typeof value === "string") {
			return value;
		}
	}
	// One level of `{data: …}` unwrapping — the el-* CLI envelope.
	if (obj.data && typeof obj.data === "object") {
		return pickLinearId(obj.data);
	}
	return null;
}

/**
 * Run the configured resolver for `identifier`. Returns the Linear user UUID, or
 * `null` on any miss/failure. Never throws.
 *
 * Synchronous (`spawnSync`) on purpose: resolution sits on the critical path of
 * `--assignee` for a short-lived CLI, the callers are already `async` so nothing
 * is starved, and it keeps the failure modes to exactly one place.
 */
export function resolveViaCommand(
	identifier: string,
	config: Pick<ElLinearConfig, "identity">,
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	const argv = resolverCommand(config, env);
	if (!argv) {
		return null;
	}

	const [command, ...args] = argv;
	if (!command) {
		return null;
	}

	// A leading `-` is never a valid Linear identifier, but it IS a flag to the
	// resolver's own option parser — `--assignee "--output=/tmp/x"` would be
	// presented to it as one. There is no shell escape here (argv, not a shell),
	// but el-linear is increasingly driven by agents over untrusted issue text, so
	// close the class for free rather than trust every resolver to be careful.
	if (identifier.startsWith("-")) {
		debugMiss(`refusing flag-shaped identifier "${identifier}"`, env);
		return null;
	}

	const cached = memo.get(identifier);
	if (cached !== undefined) {
		return cached;
	}

	const resolved = spawnResolver(command, args, identifier, config, env);
	memo.set(identifier, resolved);
	return resolved;
}

function spawnResolver(
	command: string,
	args: string[],
	identifier: string,
	config: Pick<ElLinearConfig, "identity">,
	env: NodeJS.ProcessEnv,
): string | null {
	try {
		const result = spawnSync(command, [...args, identifier], {
			encoding: "utf8",
			timeout: resolveTimeoutMs(config),
			// The identifier is untrusted input; never hand it to a shell. This also
			// means a Windows npm shim (`el-identity.cmd`) will NOT be found — see
			// the Windows note in docs/configuration.md. Turning `shell: true` on to
			// fix that would hand the untrusted identifier to cmd.exe, which is a
			// far worse trade.
			shell: false,
			// stdin closed: a resolver that decides to prompt must not hang the CLI.
			stdio: ["ignore", "pipe", "pipe"],
			env: resolverEnv(env),
		});

		// BOTH conditions are load-bearing; do not "simplify" this to one.
		//   - a plain timeout      → error ETIMEDOUT, status null
		//   - a maxBuffer overflow → error ENOBUFS,   status null
		//   - a child that leaves a grandchild holding the stdout pipe
		//                          → error ETIMEDOUT, status **0**
		// Checking only `status` would let that last case through as a success and
		// parse whatever partial output happened to be buffered.
		if (result.error) {
			debugMiss(`${command}: ${result.error.message}`, env);
			return null;
		}
		if (result.status !== 0) {
			const stderr = (result.stderr ?? "").trim().split("\n")[0] ?? "";
			debugMiss(
				`${command} exited ${result.status}${stderr ? `: ${stderr}` : ""}`,
				env,
			);
			return null;
		}

		const parsed = parseResolverOutput(result.stdout ?? "");
		if (!parsed) {
			debugMiss(
				`${command} printed no usable Linear UUID for "${identifier}"`,
				env,
			);
		}
		return parsed;
	} catch (err) {
		debugMiss(err instanceof Error ? err.message : String(err), env);
		return null;
	}
}
