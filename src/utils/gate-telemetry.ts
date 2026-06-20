import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Deterministic-gate fire/override telemetry (DEV-4834, sub of DEV-4831).
 *
 * The `issues create` duplicate-detection gate (DEV-4823) records each decision
 * it makes as a `gate` event so `el-telemetry gates` can compute the gate's
 * override-rate (overridden / total) and tell whether the threshold is noisy.
 *
 * el-linear is a published package and cannot import `el-telemetry`, so it
 * writes the ledger by **path-contract** — the same approach `el-hook` uses for
 * its session events. The path mirrors `el-telemetry`'s `GATE_EVENTS_PATH`:
 * `${EL_TELEMETRY_DIR:-~/.cache/el-telemetry}/gate-events.jsonl`. Keep this in
 * sync with `cli/el-telemetry/src/lib/paths.ts` in the tools repo.
 */

/** Resolve the gate-events ledger path (mirrors el-telemetry's GATE_EVENTS_PATH). */
export function gateEventsPath(): string {
	const dir =
		process.env.EL_TELEMETRY_DIR || join(homedir(), ".cache", "el-telemetry");
	return join(dir, "gate-events.jsonl");
}

export interface GateEvent {
	/** Stable gate id, e.g. `issues-create-dup`. */
	gate: string;
	outcome: "blocked" | "overridden";
	/** Highest candidate similarity that triggered the gate (0–1). */
	topScore?: number;
	/** How many candidates crossed the threshold. */
	candidateCount?: number;
}

/**
 * Best-effort append of a gate event to the shared local ledger `el-telemetry`
 * reads. **Never throws** — telemetry must not block issue creation — and is a
 * no-op when `EL_TELEMETRY_DISABLED` is set (the same opt-out the rest of the
 * telemetry pipeline honors).
 */
export async function emitGateEvent(
	name: string,
	subcommand: string,
	event: GateEvent,
): Promise<void> {
	if (process.env.EL_TELEMETRY_DISABLED) {
		return;
	}
	try {
		const path = gateEventsPath();
		await mkdir(dirname(path), { recursive: true });
		const record = {
			ts: new Date().toISOString(),
			kind: "gate",
			name,
			subcommand,
			metadata: {
				gate: event.gate,
				outcome: event.outcome,
				top_score: event.topScore,
				candidate_count: event.candidateCount,
			},
		};
		await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
	} catch {
		// best-effort — telemetry never blocks issue creation
	}
}
