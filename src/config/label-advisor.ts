import { spawnSync } from "node:child_process";
import type { ElLinearConfig } from "./config.js";

/**
 * Optional **label advisor hook** (DEV-10372).
 *
 * An organization may have a rubric that knows which labels a new issue should
 * carry — for example "this Tools issue is small and well specified, so it
 * belongs in the unattended-automation lane". el-linear can consult it on
 * `issues create`, but it must never learn *what* the rubric is or how to run
 * it. So the hook is a **command**, modelled on the identity resolver
 * (DEV-5628, `identity-resolver.ts`):
 *
 *   "labelAdvisor": { "command": ["my-rubric", "--advise"] }
 *
 * Contract:
 *
 *   - stdin: one JSON object describing the proposed issue —
 *     `{team, project, title, description, labels, state}`.
 *   - stdout: JSON. Either a bare array of label names (`["bot"]`) or an
 *     object `{"labels": ["bot"], "reason": "…"}`; one level of `{data: …}`
 *     envelope is unwrapped (the el-* CLI shape). `{"labels": []}` means
 *     "nothing to add".
 *   - exit 0 on success.
 *
 * **Fail-closed on labels.** A label may carry meaning — in some workspaces a
 * label is consent for unattended work — so a broken advisor must never add
 * one. Non-zero exit, timeout, missing binary, unparseable or malformed output
 * all return a failure; the caller warns and creates the issue with exactly
 * the labels the author asked for. The hook never throws.
 *
 * The issue text is untrusted input (agents create issues from arbitrary
 * prose), so it travels on stdin, never in argv, and the command runs with
 * `shell: false`.
 */

/** Env override — a whitespace-separated command; `""` is an explicit OFF. */
const ADVISOR_ENV = "EL_LINEAR_LABEL_ADVISOR";

/** An advisor that hasn't answered in this long is not going to. */
const DEFAULT_TIMEOUT_MS = 5000;

/** Advice for more labels than this is a confused advisor, not a rubric. */
const MAX_LABELS = 10;
const MAX_LABEL_LENGTH = 80;
const MAX_REASON_LENGTH = 300;

/** True when `text` has no ASCII control character (U+0000–U+001F, U+007F). */
function isSafeText(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return false;
	}
	return text.length > 0;
}

export interface LabelAdvisorInput {
	team: string | null;
	project: string | null;
	title: string | null;
	description: string | null;
	labels: string[];
	state: string | null;
}

export type LabelAdvisorResult =
	| { ok: true; labels: string[]; reason: string | null }
	| { ok: false; error: string };

/**
 * The configured advisor argv, or `null` when the hook is off. Env wins over
 * config so one invocation can point elsewhere or disable it without editing
 * files.
 */
export function labelAdvisorCommand(
	config: Pick<ElLinearConfig, "labelAdvisor">,
	env: NodeJS.ProcessEnv = process.env,
): string[] | null {
	const fromEnv = env[ADVISOR_ENV];
	if (fromEnv !== undefined) {
		const argv = fromEnv.trim().split(/\s+/).filter(Boolean);
		return argv.length > 0 ? argv : null;
	}
	const configured = config.labelAdvisor?.command;
	if (!Array.isArray(configured) || configured.length === 0) {
		return null;
	}
	return configured;
}

/**
 * Resolve the effective timeout. Node treats `timeout <= 0` as *no timeout*,
 * which would turn a hung advisor into a hung CLI — so non-positive values
 * fall back to the default, exactly like the identity resolver.
 */
function resolveTimeoutMs(
	config: Pick<ElLinearConfig, "labelAdvisor">,
): number {
	const configured = config.labelAdvisor?.timeoutMs;
	return typeof configured === "number" && configured > 0
		? configured
		: DEFAULT_TIMEOUT_MS;
}

/** The advisor classifies issue text; it never needs Linear's token. */
function advisorEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const { LINEAR_API_TOKEN: _dropped, ...rest } = env;
	return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse what the advisor printed. Returns an error string for anything that is
 * not exactly a well-formed answer — a malformed answer is a failure, and a
 * failure adds no labels. Partial acceptance (keep the valid elements, drop the
 * rest) is deliberately not offered: an advisor emitting garbage is broken, and
 * trusting half of its output is how a wrong label slips in.
 */
export function parseLabelAdvisorOutput(stdout: string): LabelAdvisorResult {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return { ok: false, error: "advisor printed nothing (expected JSON)" };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return { ok: false, error: "advisor output is not valid JSON" };
	}
	if (isRecord(parsed) && isRecord(parsed.data)) {
		parsed = parsed.data;
	}

	let rawLabels: unknown;
	let rawReason: unknown = null;
	if (Array.isArray(parsed)) {
		rawLabels = parsed;
	} else if (isRecord(parsed)) {
		rawLabels = parsed.labels;
		rawReason = parsed.reason ?? null;
	} else {
		return {
			ok: false,
			error: "advisor output must be a label array or an object",
		};
	}

	if (!Array.isArray(rawLabels)) {
		return { ok: false, error: 'advisor output has no "labels" array' };
	}
	if (rawLabels.length > MAX_LABELS) {
		return {
			ok: false,
			error: `advisor returned ${rawLabels.length} labels (limit ${MAX_LABELS})`,
		};
	}
	const labels: string[] = [];
	for (const label of rawLabels) {
		if (
			typeof label !== "string" ||
			label.trim().length === 0 ||
			label.length > MAX_LABEL_LENGTH ||
			!isSafeText(label) ||
			label.includes(",")
		) {
			return {
				ok: false,
				error: "advisor returned a label that is not a plain label name",
			};
		}
		const name = label.trim();
		if (!labels.some((seen) => seen.toLowerCase() === name.toLowerCase())) {
			labels.push(name);
		}
	}

	if (rawReason !== null && typeof rawReason !== "string") {
		return { ok: false, error: "advisor reason must be a string" };
	}
	const reason =
		typeof rawReason === "string" && rawReason.trim()
			? rawReason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON_LENGTH)
			: null;
	return { ok: true, labels, reason };
}

/**
 * Run the configured advisor. Returns `null` when no advisor is configured,
 * otherwise the parsed advice or a failure. Never throws.
 *
 * Synchronous for the same reason as the identity resolver: it sits on the
 * critical path of a short-lived CLI, and a single failure site is easier to
 * reason about than a promise race.
 */
export function runLabelAdvisor(
	input: LabelAdvisorInput,
	config: Pick<ElLinearConfig, "labelAdvisor">,
	env: NodeJS.ProcessEnv = process.env,
): LabelAdvisorResult | null {
	const argv = labelAdvisorCommand(config, env);
	if (!argv) {
		return null;
	}
	const [command, ...args] = argv;
	if (!command) {
		return null;
	}
	try {
		const result = spawnSync(command, args, {
			encoding: "utf8",
			input: JSON.stringify(input),
			timeout: resolveTimeoutMs(config),
			// A trapped SIGTERM would let a broken advisor wedge the CLI past
			// its time budget; see the identical note in identity-resolver.ts.
			killSignal: "SIGKILL",
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
			env: advisorEnv(env),
		});
		// Check `error` before `status`: a timeout that leaves a grandchild
		// holding the pipe reports ETIMEDOUT with status 0 (identity-resolver.ts).
		if (result.error) {
			return { ok: false, error: `${command}: ${result.error.message}` };
		}
		if (result.status !== 0) {
			const stderr = (result.stderr ?? "").trim().split("\n")[0] ?? "";
			return {
				ok: false,
				error: `${command} exited ${result.status ?? `on ${result.signal}`}${stderr ? `: ${stderr}` : ""}`,
			};
		}
		return parseLabelAdvisorOutput(result.stdout ?? "");
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
