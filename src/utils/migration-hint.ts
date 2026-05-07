/**
 * Once-per-process stderr hint for legacy-config drift.
 *
 * Wired into the auth-failure path in `auth.ts`. When the legacy single-file
 * config exists but no token can be found anywhere (the >=1.4 post-upgrade
 * scenario), we emit one stderr line pointing the user at
 * `el-linear profile migrate-legacy` *before* the regular "No API token
 * found" error fires.
 *
 * Constraints:
 *
 * - **stderr only** — stdout is reserved for the JSON error payload that
 *   machine callers parse, and the hint must not corrupt that stream.
 * - **Once per process** — even if a script invokes el-linear in a tight
 *   loop within a single Node process (uncommon but possible), only the
 *   first failure prints. Anything more is noise.
 * - **Suppressible** — `EL_LINEAR_SKIP_MIGRATION_HINT=1` silences the hint
 *   for users who've decided to stay on the legacy layout intentionally.
 *   The env var is read at *emission time*, not module load, so toggling
 *   it in tests works without re-importing.
 * - **Non-blocking** — never throws, never delays the underlying auth
 *   error. The hint is purely informational.
 */

import {
	type DetectionFsOps,
	detectLegacyDrift,
	type LegacyDriftState,
} from "./legacy-config-detection.js";

let hintAlreadyEmitted = false;

/**
 * Test seam — resets the once-per-process latch so each test starts fresh.
 * Production code never calls this.
 */
export function _resetMigrationHintForTests(): void {
	hintAlreadyEmitted = false;
}

/**
 * Emit the migration hint to stderr if (and only if) legacy drift is
 * detected, the latch hasn't fired this process, and the suppress env var
 * isn't set. Returns the detection state so callers can branch (or log).
 *
 * Optional `fsImpl` lets tests drive detection without touching disk.
 * Optional `stderr` lets tests capture the output without spying on the
 * global stream.
 */
export function maybeEmitMigrationHint(
	fsImpl?: DetectionFsOps,
	stderr: { write: (chunk: string) => void } = process.stderr,
): LegacyDriftState {
	const state = detectLegacyDrift(fsImpl);

	// Read the env var at call time — the suppress flag may be flipped between
	// commands in long-lived test processes.
	if (process.env.EL_LINEAR_SKIP_MIGRATION_HINT === "1") {
		return state;
	}

	if (hintAlreadyEmitted) {
		return state;
	}

	const message = formatHint(state);
	if (message === null) {
		return state;
	}

	hintAlreadyEmitted = true;
	stderr.write(`${message}\n`);
	return state;
}

/**
 * Render the hint string for a given state. Returns null when no hint
 * should be emitted (no-drift). Exported for unit testing.
 */
export function formatHint(state: LegacyDriftState): string | null {
	if (state.kind === "no-drift") return null;

	if (state.kind === "broken-active-profile") {
		return [
			`el-linear: active profile "${state.pointedAt}" doesn't exist.`,
			"Switch with:",
			"",
			"  el-linear profile use <name>",
			"",
			"Or list available profiles:",
			"",
			"  el-linear profile list",
			"",
			"Or suppress this hint with EL_LINEAR_SKIP_MIGRATION_HINT=1.",
		].join("\n");
	}

	// legacy-no-token
	return [
		`el-linear: legacy config detected at ${state.legacyConfigPath}`,
		"but no token. Migrate with:",
		"",
		"  el-linear profile migrate-legacy [--name <profile>]",
		"",
		"Or suppress this hint with EL_LINEAR_SKIP_MIGRATION_HINT=1.",
	].join("\n");
}
