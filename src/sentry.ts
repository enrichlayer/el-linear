/**
 * Optional, opt-in Sentry error reporting for el-linear (DEV-4349, sub of DEV-4328).
 *
 * el-linear ships open-source, so Sentry is NEVER required:
 *  - No dependency on the private `@enrichlayer/sentry` package — this is a
 *    self-contained copy of its scrub + init (acceptable duplication: the repo
 *    boundary makes sharing the tools-repo util impossible).
 *  - `@sentry/node` is an OPTIONAL dependency, loaded via a dynamic
 *    `import("@sentry/node")` ONLY when a DSN resolves. `npm i @enrichlayer/el-linear`
 *    never forces Sentry, and a missing/uninstalled SDK is a clean no-op.
 *  - The DSN comes from the environment only (`SENTRY_DSN_CLI`) — no Vault (that
 *    is internal infra OSS users do not have), and NOT the conventional
 *    `SENTRY_DSN` (which would collide with an OSS user's own app). Default OFF;
 *    only active when we set our namespaced env var in our own environment.
 *
 * One line at the top of `main.ts`:
 *
 *   import { initCliSentry } from "./sentry.js";
 *   void initCliSentry("el-linear", { version });
 *   // ... program.parse()
 *
 * Set `EL_SENTRY_DISABLED=1` to force-disable even when a DSN is present.
 *
 * Safety: a mandatory `beforeSend` scrub redacts secret-shaped values (tokens,
 * keys, auth headers). CLI argv/env routinely carry credentials (the Linear API
 * token, GitHub PATs), and an unscrubbed report would leak them into Sentry.
 */

/** A Sentry event is deeply dynamic; we walk it structurally. */
type Json = unknown;

/** Key names whose values are always redacted, regardless of content. */
const SECRET_KEY_RE =
	/(token|secret|passwd|password|api[_-]?key|apikey|bearer|authorization|auth|dsn|cookie|session|credential|private[_-]?key)/i;

/** Value patterns that look like a credential even under an innocent key. */
const SECRET_VALUE_RES: RegExp[] = [
	/glpat-[A-Za-z0-9_-]{10,}/g, // GitLab PAT
	/gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub classic token
	/github_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT (now the default)
	/xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack bot/user token
	/xapp-[A-Za-z0-9-]{10,}/g, // Slack app-level token
	/lin_api_[A-Za-z0-9]{20,}/g, // Linear API key
	/sk-[A-Za-z0-9]{16,}/g, // OpenAI-style key
	/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
	/\b[Bb]earer\s+[A-Za-z0-9._-]{10,}/g, // bearer header
	/https?:\/\/[^:@/\s]+:[^@/\s]+@/g, // creds in a URL (user:pass@host)
];

export const REDACTED = "[redacted]";
const MAX_DEPTH = 8;

/** Redact credential-shaped substrings from a string. Pure. */
export function scrubString(input: string): string {
	let out = input;
	for (const re of SECRET_VALUE_RES) {
		out = out.replace(re, REDACTED);
	}
	return out;
}

/**
 * Recursively scrub a JSON-ish value: redact whole values under secret-named
 * keys, scrub credential-shaped substrings everywhere else, and cap depth so a
 * cyclic / huge event can't hang the scrubber. Pure.
 */
export function scrubValue(value: Json, depth = 0): Json {
	if (depth > MAX_DEPTH) {
		// Fail CLOSED: past the cap we can't recurse to check for secrets, so a
		// primitive could be a credential — redact rather than leak it.
		return REDACTED;
	}
	if (typeof value === "string") {
		return scrubString(value);
	}
	if (Array.isArray(value)) {
		return value.map((v) => scrubValue(v, depth + 1));
	}
	if (value && typeof value === "object") {
		const out: Record<string, Json> = {};
		for (const [k, v] of Object.entries(value as Record<string, Json>)) {
			out[k] = SECRET_KEY_RE.test(k) ? REDACTED : scrubValue(v, depth + 1);
		}
		return out;
	}
	return value;
}

/**
 * Scrub a Sentry event (message, exceptions, breadcrumbs, extra, request — which
 * carries headers + env — and contexts) by walking it structurally. Pure.
 */
export function scrubEvent(event: Json): Json {
	return scrubValue(event);
}

/**
 * Resolve the CLI Sentry DSN from the environment. Returns null when reporting
 * is disabled or no DSN is configured (→ init no-ops). No Vault: OSS users do
 * not have it, so this path is intentionally env-only.
 *
 * Only the namespaced `SENTRY_DSN_CLI` is read — NOT the conventional
 * `SENTRY_DSN`. el-linear ships open-source, and `SENTRY_DSN` is the var the
 * `@sentry/node` SDK reads by default, so an OSS user running their own
 * Sentry-instrumented app very likely has it set; falling back to it would make
 * el-linear silently report into *their* project. Requiring our explicit,
 * namespaced var keeps activation unambiguous and collision-free (DEV-4349
 * cycle-1 review). The internal tools build uses `SENTRY_DSN_CLI` too, so we
 * lose nothing.
 */
export function resolveDsn(): string | null {
	if (process.env.EL_SENTRY_DISABLED === "1") {
		return null;
	}
	return process.env.SENTRY_DSN_CLI?.trim() || null;
}

/** Minimal structural subset of `@sentry/node` we use — avoids a type-time dep. */
interface SentryModule {
	init: (opts: {
		dsn: string;
		release: string;
		environment: string;
		tracesSampleRate: number;
		beforeSend: (event: Json) => Json;
	}) => void;
	setTag: (key: string, value: string) => void;
	captureException: (err: unknown) => void;
	flush: (timeout?: number) => Promise<boolean>;
}

export interface InitCliSentryOptions {
	/** Override the resolved DSN (mainly for tests). */
	dsn?: string | null;
	/** CLI version for the Sentry `release` (defaults to "0.0.0"). */
	version?: string;
}

/**
 * Initialize Sentry for el-linear. Async because `@sentry/node` is loaded via a
 * dynamic import only when a DSN resolves — so a CLI run without a DSN (the
 * default for OSS users) never even loads the SDK. Returns true when reporting
 * is active, false when it no-ops (disabled / no DSN / SDK not installed).
 *
 * When active, installs global uncaughtException + unhandledRejection handlers
 * that capture → flush → exit(1). Because the SDK loads via a dynamic import
 * (resolving a tick after the caller's fire-and-forget `void`), a synchronous
 * throw during the very first tick of CLI startup — before the handlers install
 * — is out of scope; this is best-effort reporting, not a crash guarantee.
 */
export async function initCliSentry(
	cliName: string,
	opts: InitCliSentryOptions = {},
): Promise<boolean> {
	const dsn = opts.dsn === undefined ? resolveDsn() : opts.dsn;
	if (!dsn) {
		return false;
	}

	let Sentry: SentryModule;
	try {
		// Optional dependency: loaded only here, only when a DSN is set. A
		// missing/uninstalled SDK is a clean no-op (we never ship Sentry to OSS
		// users who have not opted in).
		Sentry = (await import("@sentry/node")) as unknown as SentryModule;
	} catch {
		return false;
	}

	Sentry.init({
		dsn,
		release: `${cliName}@${opts.version ?? "0.0.0"}`,
		environment: process.env.CI ? "ci" : "development",
		tracesSampleRate: 0,
		beforeSend: (event) => scrubEvent(event),
	});
	Sentry.setTag("cli", cliName);

	const report = (err: unknown): void => {
		Sentry.captureException(err);
		// Flush before exiting; the process is in an undefined state after an
		// uncaught error, so report-then-die is the standard Sentry pattern.
		Sentry.flush(2000).then(
			() => process.exit(1),
			() => process.exit(1),
		);
	};
	process.on("uncaughtException", report);
	process.on("unhandledRejection", (reason) =>
		report(reason instanceof Error ? reason : new Error(String(reason))),
	);

	return true;
}
