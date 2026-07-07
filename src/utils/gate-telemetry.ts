import { existsSync } from "node:fs";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Deterministic-gate fire/override telemetry (DEV-4834, sub of DEV-4831).
 *
 * The `issues create` duplicate-detection gate (DEV-4823) records each decision
 * it makes as a `gate` event so a reader (the Enrich Layer `el-telemetry gates`
 * command, or any JSONL consumer) can compute the gate's override-rate
 * (overridden / total) and tell whether the threshold is noisy.
 *
 * **Opt-in.** el-linear is open-source; most installs have no telemetry, and we
 * must never write files a user didn't ask for. Emission is therefore OFF by
 * default and turns on only when telemetry is actually configured — see
 * {@link decideGateLedger}. The ledger is a plain local JSONL file
 * (`gate-events.jsonl`); there is no server or database. el-linear can't import
 * `el-telemetry` (separate package), so it writes by **path-contract** — the
 * same approach `el-hook` uses. The path mirrors `el-telemetry`'s
 * `GATE_EVENTS_PATH`; keep the two in sync. Format + reader are documented in
 * `docs/telemetry.md`.
 */

export const GATE_LEDGER_MAX_BYTES = 2 * 1024 * 1024;
export const GATE_LEDGER_BACKUP_SUFFIX = ".old";

/** The default ledger directory when `EL_TELEMETRY_DIR` is not set. */
function defaultTelemetryDir(): string {
	return join(homedir(), ".cache", "el-telemetry");
}

/** Resolve where the ledger lives — for a *reader* locating the file (mirrors
 * el-telemetry's `GATE_EVENTS_PATH`). This is NOT the emit decision: it ignores
 * the opt-in policy, so never write through it — `emitGateEvent` goes through
 * {@link decideGateLedger}, which may veto writing entirely. */
export function gateEventsPath(): string {
	const dir = process.env.EL_TELEMETRY_DIR || defaultTelemetryDir();
	return join(dir, "gate-events.jsonl");
}

/**
 * Decide whether gate telemetry is enabled and, if so, the ledger path —
 * returning `null` (no-op) otherwise. Pure (no env / fs reads) so the opt-in
 * policy is exhaustively testable.
 *
 * Policy (open-source-safe):
 * - `disabled` (`EL_TELEMETRY_DISABLED`) → off. Hard opt-out, wins over all.
 * - `explicitDir` (`EL_TELEMETRY_DIR` set) → on. An explicit destination is an
 *   explicit opt-in; the dir is created on demand.
 * - otherwise → on **only if the default dir already exists**, i.e. the user
 *   already runs the EL telemetry tooling that created it. A fresh open-source
 *   install has no such dir, so nothing is ever written for them.
 */
export function decideGateLedger(opts: {
	disabled: boolean;
	explicitDir?: string;
	defaultDir: string;
	defaultDirExists: boolean;
}): string | null {
	if (opts.disabled) {
		return null;
	}
	if (opts.explicitDir) {
		return join(opts.explicitDir, "gate-events.jsonl");
	}
	if (!opts.defaultDirExists) {
		return null;
	}
	return join(opts.defaultDir, "gate-events.jsonl");
}

/** Wire {@link decideGateLedger} to the real environment + filesystem. */
function gateLedgerIfEnabled(): string | null {
	const defaultDir = defaultTelemetryDir();
	return decideGateLedger({
		disabled: Boolean(process.env.EL_TELEMETRY_DISABLED),
		explicitDir: process.env.EL_TELEMETRY_DIR,
		defaultDir,
		defaultDirExists: existsSync(defaultDir),
	});
}

async function rotateGateLedgerIfOverLimit(path: string): Promise<void> {
	let size = 0;
	try {
		const s = await stat(path);
		if (!s.isFile()) return;
		size = s.size;
	} catch {
		return;
	}
	if (size <= GATE_LEDGER_MAX_BYTES) return;

	try {
		const backupPath = `${path}${GATE_LEDGER_BACKUP_SUFFIX}`;
		await rm(backupPath, { force: true });
		await rename(path, backupPath);
	} catch {
		// best-effort — telemetry never blocks issue creation
	}
}

export interface GateEvent {
	/** Stable gate id, e.g. `issues-create-dup`. */
	gate: string;
	/**
	 * `blocked` — the gate stopped creation. `overridden` — a gate-specific
	 * override flag let a would-block proceed. `fail-open` — the gate could not
	 * evaluate (infra/service error) and let creation proceed rather than block
	 * on trouble; tracked so degradation is measurable (DEV-5378). `advisory` —
	 * the gate fired below its hard-block threshold: printed, but never forced
	 * a stop (DEV-5590). Like `fail-open`, the tools-repo reader
	 * (`el-telemetry gates`) only recognizes `blocked`/`overridden` for the
	 * override-rate denominator — an unrecognized outcome is skipped rather
	 * than counted, so `advisory` fires are visible in the raw ledger but
	 * intentionally excluded from the metric.
	 */
	outcome: "blocked" | "overridden" | "fail-open" | "advisory";
	/** Highest candidate similarity that triggered the gate (0–1). */
	topScore?: number;
	/** How many candidates crossed the threshold. */
	candidateCount?: number;
}

/**
 * Best-effort append of a gate event to the local ledger — but only when
 * telemetry is opted in ({@link gateLedgerIfEnabled}); otherwise a silent
 * no-op, so an open-source install with no telemetry writes nothing. **Never
 * throws** — telemetry must not block issue creation.
 */
export async function emitGateEvent(
	name: string,
	subcommand: string,
	event: GateEvent,
): Promise<void> {
	const path = gateLedgerIfEnabled();
	if (!path) {
		return;
	}
	try {
		await mkdir(dirname(path), { recursive: true });
		await rotateGateLedgerIfOverLimit(path);
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
