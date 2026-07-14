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

	try {
		const result = spawnSync(command, [...args, identifier], {
			encoding: "utf8",
			timeout: config.identity?.resolverTimeoutMs ?? DEFAULT_TIMEOUT_MS,
			// The identifier is untrusted input; never hand it to a shell.
			shell: false,
			// stdin closed: a resolver that decides to prompt must not hang the CLI.
			stdio: ["ignore", "pipe", "pipe"],
		});

		// ENOENT (resolver not installed), a timeout, or a non-zero exit are all
		// the same thing to us: no answer. The caller falls through to Linear.
		if (result.error || result.status !== 0) {
			return null;
		}
		return parseResolverOutput(result.stdout ?? "");
	} catch {
		return null;
	}
}
