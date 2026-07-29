/**
 * Non-blocking repo/profile mismatch hint (DEV-7277).
 *
 * On write commands (`issues create`, `comments create`) a user who works
 * across multiple Linear workspaces can silently write into the wrong one: the
 * machine-global `active-profile` marker is whatever they last `profile use`d,
 * and it applies to every repo that hasn't pinned a profile. This prints a
 * ONE-LINE hint to stderr when — and only when — the active profile came from
 * that bare global marker AND the current repo has no pin, nudging the user to
 * `el-linear profile pin`.
 *
 * It NEVER blocks the command and NEVER writes to stdout (that stays reserved
 * for the machine-parseable JSON envelope). It is suppressed by `--quiet` and
 * by the `EL_LINEAR_NO_PIN_HINT` opt-out.
 */

import { getQuietMode } from "../utils/output.js";
import { readActiveProfileMarker } from "./paths.js";
import {
	type RepoLinearProfile,
	resolveRepoLinearProfile,
} from "./repo-profile.js";

const ENV_OPT_IN_VALUES = new Set(["1", "true", "yes", "on"]);

/** True only when `env[name]` is an explicit opt-in value (not `0`/`false`). */
function isEnvOptIn(name: string, env: NodeJS.ProcessEnv): boolean {
	const raw = env[name]?.trim().toLowerCase();
	return raw !== undefined && ENV_OPT_IN_VALUES.has(raw);
}

export interface PinHintDeps {
	env: NodeJS.ProcessEnv;
	cwd: string;
	/** True when `--profile` was passed for this invocation. */
	hasProfileFlag: boolean;
	/** Whether `--quiet` is active. */
	isQuiet: () => boolean;
	/** Raw `active-profile` marker content (bypasses the flag/env layers). */
	readMarker: () => string | null;
	/** Repo→profile pin lookup for `cwd`. */
	resolveRepoPin: (cwd: string) => RepoLinearProfile | null;
	/** Sink for the one-line hint (stderr in production). */
	write: (message: string) => void;
}

/**
 * Emit the mismatch hint when applicable. Returns true when a hint was written
 * (for tests). All decision inputs are injectable so the trigger/suppression
 * matrix can be unit-tested without git, env, or process state.
 */
export function maybeEmitPinMismatchHint(
	deps: Pick<PinHintDeps, "hasProfileFlag"> & Partial<PinHintDeps>,
): boolean {
	const env = deps.env ?? process.env;
	const cwd = deps.cwd ?? process.cwd();
	const isQuiet = deps.isQuiet ?? getQuietMode;
	const readMarker = deps.readMarker ?? (() => readActiveProfileMarker());
	const resolveRepoPin =
		deps.resolveRepoPin ?? ((c: string) => resolveRepoLinearProfile(c));
	const write = deps.write ?? ((m: string) => process.stderr.write(`${m}\n`));

	// Suppressed contexts — every one of these means the hint would be noise.
	if (isQuiet()) return false;
	if (isEnvOptIn("EL_LINEAR_NO_PIN_HINT", env)) return false;
	// Came from `--profile` — the user was explicit.
	if (deps.hasProfileFlag) return false;
	// Came from `$EL_LINEAR_PROFILE` — also explicit.
	if ((env.EL_LINEAR_PROFILE ?? "").trim()) return false;
	// Repo already has a pin — nothing to nudge.
	if (resolveRepoPin(cwd)) return false;
	// Only fire when the profile came from the BARE global marker. No marker =
	// legacy single-profile default; that user hasn't opted into workspaces at
	// all, so the nudge would be premature.
	const marker = readMarker();
	if (!marker) return false;

	write(
		`el-linear: writing with the machine-global active profile "${marker}" — this repo has no pinned workspace. ` +
			"If it belongs to a specific workspace, pin it: `el-linear profile pin`. " +
			"(silence this: EL_LINEAR_NO_PIN_HINT=1)",
	);
	return true;
}
