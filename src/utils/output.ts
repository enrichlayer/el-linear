import { execFileSync } from "node:child_process";
import { resolveActiveProfile } from "../config/paths.js";
import {
	dispatch as dispatchSummary,
	drainSummaryFieldWarnings,
	formatLine,
	inferKindFromPayload,
	type ResourceKind,
} from "./formatters/summary.js";
import { logger } from "./logger.js";
import { sanitizeForLog } from "./sanitize-for-log.js";

const warningBuffer: string[] = [];
let rawMode = false;
let quietMode = false;
let jqFilter: string | null = null;
let fieldsFilter: string[] | null = null;

type OutputFormat = "json" | "summary";
let outputFormat: OutputFormat = "json";

export function setRawMode(enabled: boolean): void {
	rawMode = enabled;
}

/**
 * `--quiet` (write commands only): collapse the success payload to a single
 * confirmation line via `formatLine`, bypassing both the JSON envelope and
 * the summary block. Set in main.ts's preAction when the flag is present.
 */
export function setQuietMode(enabled: boolean): void {
	quietMode = enabled;
}

/**
 * Whether `--quiet` is active. Lets a command decide to route extra
 * human-facing detail (e.g. a mention-resolution confirmation) to stderr,
 * keeping the single machine-stable stdout line intact.
 */
export function getQuietMode(): boolean {
	return quietMode;
}

export function setJqFilter(filter: string | null): void {
	jqFilter = filter;
}

export function setFieldsFilter(fields: string[] | null): void {
	fieldsFilter = fields;
}

export function setOutputFormat(format: OutputFormat): void {
	outputFormat = format;
}

/** @internal Test seam — consumers should not depend on the format state. */
export function getOutputFormat(): OutputFormat {
	return outputFormat;
}

/**
 * Resolve a dot-separated path against a value (`a.b.c`; array indices are
 * numeric segments, `items.0.id`). Returns `undefined` when any segment is
 * missing so callers can distinguish "missing" from a real `null` value.
 * Same path grammar as el-git's `--field` selector — keeping the two flags'
 * semantics aligned is the point (DEV-5323).
 */
function getNestedPath(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const seg of path.split(".")) {
		if (cur === null || cur === undefined || typeof cur !== "object") {
			return undefined;
		}
		cur = (cur as Record<string, unknown>)[seg];
	}
	return cur;
}

/**
 * Aliases for the table/csv column names that don't exist as literal keys
 * on the JSON payload (DEV-5376). Tried only after the literal key and the
 * dot-path both miss, and only kept when the alias target actually
 * resolves — so a resource that genuinely lacks `state`/`updatedAt` still
 * gets the explicit-null + `fields_unresolved` treatment. The requested
 * name stays the output key (`{"status": "Todo"}`), matching the
 * "consumers read exactly what they asked for" contract.
 */
const FIELD_ALIASES: Record<string, string> = {
	status: "state.name",
	updated: "updatedAt",
};

/**
 * Project `obj` down to the requested fields.
 *
 * - Top-level keys copy through as before.
 * - Dot-separated paths (DEV-5323) resolve nested values; the requested path
 *   string becomes a flat output key (`{"pipeline.status": "success"}`), so
 *   consumers read exactly what they asked for.
 * - Documented column aliases resolve when the literal key is absent
 *   (`status` → `state.name`, `updated` → `updatedAt`; DEV-5376).
 * - A field that resolves nowhere is emitted as an explicit `null` AND
 *   reported via `unresolved` — never silently omitted. Silent omission made
 *   a typo'd field indistinguishable from an empty value (DEV-5323).
 * - For arrays, each item is projected; a field counts as unresolved only
 *   when it resolves on NO item (heterogeneous lists legitimately have
 *   per-item gaps).
 */
function filterFields(
	obj: unknown,
	fields: string[],
	unresolved?: Set<string>,
): unknown {
	if (Array.isArray(obj)) {
		const resolvedSomewhere = new Set<string>();
		const items = obj.map((item) => {
			const perItem = new Set<string>();
			const projected = filterFields(item, fields, perItem);
			for (const field of fields) {
				// A primitive item short-circuits: filterFields returns it
				// unchanged and records NOTHING in perItem, so every field counts
				// as resolved here — a mixed array holding one primitive suppresses
				// the unresolved warning for all fields. Acceptable: a primitive
				// item can't meaningfully be projected, and heterogeneous lists
				// legitimately have per-item gaps.
				if (!perItem.has(field)) {
					resolvedSomewhere.add(field);
				}
			}
			return projected;
		});
		if (unresolved) {
			for (const field of fields) {
				if (!resolvedSomewhere.has(field)) {
					unresolved.add(field);
				}
			}
		}
		return items;
	}
	if (obj !== null && typeof obj === "object") {
		const source = obj as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const field of fields) {
			if (field in source) {
				result[field] = source[field];
				continue;
			}
			const nested = field.includes(".")
				? getNestedPath(source, field)
				: undefined;
			if (nested !== undefined) {
				result[field] = nested;
				continue;
			}
			const alias = FIELD_ALIASES[field];
			const aliased =
				alias !== undefined ? getNestedPath(source, alias) : undefined;
			if (aliased !== undefined) {
				result[field] = aliased;
				continue;
			}
			result[field] = null;
			unresolved?.add(field);
		}
		return result;
	}
	return obj;
}

/**
 * Emit a summary-format render to stdout for the given payload.
 *
 * `kind` is captured upstream from the **pre-filter** payload — if we
 * inferred here, `--fields identifier,url` would strip `title` and
 * the heuristic would fall through to "generic", silently breaking
 * the issue-list table. Caching the pre-filter shape keeps the
 * formatter accurate regardless of how the user pared the JSON.
 *
 * `fields` (when set) is forwarded to the formatter as a projection
 * request (DEV-4750). For summary the JSON-shape `filterFields` is a
 * no-op — the formatter needs the full object to extract nested values
 * like `project.name` or `teams[].key`.
 */
function emitSummary(
	payload: unknown,
	kind: ResourceKind,
	fields: string[] | null,
): void {
	logger.info(dispatchSummary(kind, payload, fields ?? undefined));
}

/**
 * Standard windowing / pagination / truncation metadata for any command
 * that does not return its complete result set in one response.
 *
 * This is the canonical `WindowedMeta` type referenced by the
 * output-transparency audit (DEV-3810 → DEV-4668). It promotes the
 * `el-user usage` reference convention into the shared envelope so every
 * consuming CLI uses the same field names instead of inventing ad-hoc
 * `_window` / `_total` / `truncated` keys. The motivating principle:
 * **every piece of data between a database and a decision-maker (human or
 * LLM) should make its scope, limits, and assumptions visible in the
 * output** — a consumer should never have to read source to interpret
 * data correctly.
 *
 * All fields are optional: a command populates only the ones that apply.
 * Because `ListMeta` / `ListExtraMeta` still carry an open
 * `Record<string, unknown>` index, a CLI may also add its own
 * domain-specific counters (`_total_hits`, `_indices_queried`,
 * `_source_users_total`, …) alongside these — but where a generic field
 * fits, prefer it so cross-CLI tooling and skills can read one shape.
 *
 * When to populate each field:
 * - `_window` — the time/scope window applied, e.g. `"30d"`, `"12 months"`,
 *   `"since 2026-06-01"`.
 * - `_limit_applied` — the cap actually in effect (the value the caller
 *   passed, or the command's default when they passed nothing).
 * - `_query` — the search / filter expression applied to produce `data`.
 * - `_total` — total matching rows *before* windowing / limiting /
 *   filtering. Lets a consumer report "showing N of `_total`".
 * - `_fetched` — how many rows are in *this* response (distinct from
 *   `_total`). For list envelopes this equals `meta.count`.
 * - `truncated` — `true` when `_fetched` hit `_limit_applied` and more
 *   rows exist beyond this page. Skills MUST consume this rather than
 *   counting returned rows to decide whether output is complete.
 * - `availability` — per-response (or per-source) completeness signal.
 *   Emit `{status: "degraded", detail}` when a sub-source failed (e.g. a
 *   Slack timeout in an aggregator) rather than collapsing to an empty
 *   result indistinguishable from "no hits".
 */
export interface WindowedMeta {
	/** Time/scope window applied, e.g. `"30d"`, `"since 2026-06-01"`. */
	_window?: string;
	/** The cap actually in effect (caller's value, or the default). */
	_limit_applied?: number;
	/** The search / filter expression applied to produce `data`. */
	_query?: string;
	/** Total matching rows before windowing / limiting / filtering. */
	_total?: number;
	/** Rows in this response (equals `meta.count` for list envelopes). */
	_fetched?: number;
	/** `true` when `_fetched` hit `_limit_applied` — more rows exist. */
	truncated?: boolean;
	/** Per-response completeness signal; mirrors the `el-user` convention. */
	availability?: {
		status: "complete" | "partial" | "degraded";
		/** Human-readable reason, e.g. `"result reached row cap 100"`. */
		detail?: string;
	};
}

/**
 * Resource-specific extra metadata that may be added to a list response
 * alongside the canonical `count` (e.g. `query` on search, `team` on
 * filtered list). Excludes `count` at the type level — callers can't
 * accidentally pass a string `count` and have it silently overridden;
 * the only way to set `count` is via `data.length` inside `outputList`.
 *
 * Intersected with {@link WindowedMeta} so the standard windowing fields
 * (`_total`, `truncated`, `_window`, …) are typed when present, while the
 * open `Record<string, unknown>` index still admits CLI-specific keys.
 *
 * Implementation note: `count?: never` together with `Record<string, unknown>`
 * lets TypeScript accept any other key while disallowing the literal
 * `count` key. The `never`-typed property is impossible to assign, which
 * is what we want for the "no count here" contract.
 */
export type ListExtraMeta = Record<string, unknown> &
	WindowedMeta & {
		count?: never;
	};

/**
 * Metadata envelope for list responses. Always includes `count`; resources
 * may add their own keys (e.g. `query` on search, `team` on filtered list).
 *
 * `meta.count` is the cardinality of `data[]` — downstream `jq` pipelines
 * read it both for emptiness checks (`.meta.count == 0`) and for the
 * actual magnitude (e.g. logging "found N issues"). A boolean isEmpty
 * would lose the magnitude signal, so `count: number` stays.
 *
 * The open `Record<string, unknown>` index admits the {@link WindowedMeta}
 * fields a windowed list echoes (`_total`, `truncated`, `_window`, …);
 * those are typed at the write site via {@link ListExtraMeta}.
 */
export interface ListMeta extends Record<string, unknown> {
	count: number;
}

/**
 * Canonical JSON envelope for a list response. Pre-DEV-4068 T6, every
 * call site built this object literal inline and `outputSuccess(data:
 * unknown)` accepted it without type-checking. Use `outputList<T>` to
 * route a list through the same emit path with a real per-element type
 * (so e.g. `data: T[]` and `--fields` consumers stay in lock-step).
 */
export interface CliListEnvelope<T> {
	data: T[];
	meta: ListMeta;
}

/**
 * Typed wrapper around `outputSuccess` for list responses — builds the
 * `{ data, meta: { count, ...extraMeta } }` envelope and emits it. The
 * 81 existing inline `outputSuccess({ data, meta: { count, ... } })`
 * call sites can migrate to this incrementally; both go through the
 * same `outputSuccess` emit path so JSON / summary / --raw / --fields /
 * --jq behavior is identical.
 *
 * @param data    The array payload.
 * @param extraMeta Optional resource-specific meta keys (e.g. `query`,
 *                  `team`). The type excludes `count` — `count` is
 *                  always computed from `data.length` to preserve the
 *                  wire-contract invariant.
 */
export function outputList<T>(data: T[], extraMeta?: ListExtraMeta): void {
	const meta: ListMeta = { ...extraMeta, count: data.length };
	const envelope: CliListEnvelope<T> = { data, meta };
	outputSuccess(envelope);
}

/**
 * Typed wrapper around `outputSuccess` for a single-resource response.
 * Pure passthrough — the envelope contract for single resources is just
 * the resource object itself (no `data`/`meta` wrapping). Same emit
 * path as `outputSuccess` and `outputList`; this overload exists so
 * call sites can document their intent at the type level.
 *
 * The conditional return type rejects array inputs at the type level —
 * a caller that meant `outputList` and passed an array gets a compile
 * error pointing them at the right helper. Runtime behavior on an array
 * is unchanged (it'd still emit JSON), but the type catches the foot-gun.
 */
export function outputSingle<T>(
	data: T extends readonly unknown[]
		? "outputSingle does not accept arrays — use outputList(data) instead"
		: T,
): void {
	outputSuccess(data);
}

export function outputSuccess(data: unknown): void {
	let output: unknown = data;
	// Capture the kind from the original envelope shape BEFORE --raw /
	// --fields stripping. Otherwise filtering away signature fields (e.g.
	// `title` on an issue) breaks shape inference and the summary
	// formatter falls back to the generic key-value dump.
	const inferredKind =
		outputFormat === "summary" ? inferKindFromPayload(output) : "generic";
	// --quiet: one machine-stable confirmation line, nothing else. Highest
	// precedence on the write path and independent of --raw / --fields / --jq
	// (those reshape the payload the flag exists to avoid) — so we emit from
	// the full pre-filter object, otherwise `--fields identifier` would strip
	// the state/url formatLine needs and break shape inference. Drain any
	// buffered warnings to preserve pre-DEV-4750 behavior (they were
	// silently dropped on the quiet path; the contract is "one line only").
	if (quietMode) {
		logger.info(formatLine(output));
		drainWarnings();
		drainSummaryFieldWarnings();
		return;
	}
	// --raw: unwrap { data: [...] } to just the array
	if (
		rawMode &&
		output !== null &&
		typeof output === "object" &&
		!Array.isArray(output)
	) {
		const obj = output as Record<string, unknown>;
		if (Array.isArray(obj.data)) {
			output = obj.data;
		}
	}
	// --fields on summary format is a *projection request* — the formatter
	// consumes it directly to extend/replace its column set (DEV-4750). The
	// JSON-shape `filterFields` step would otherwise strip nested values
	// (project.name, teams[].key) the formatter needs to render. Skip the
	// JSON filter when summary is active and let the formatter do the work.
	if (fieldsFilter && outputFormat !== "summary") {
		const unresolved = new Set<string>();
		if (Array.isArray(output)) {
			output = filterFields(output, fieldsFilter, unresolved);
		} else if (output !== null && typeof output === "object") {
			const obj = output as Record<string, unknown>;
			if (
				obj.data !== null &&
				obj.data !== undefined &&
				typeof obj.data === "object"
			) {
				// Envelope with a `data` payload — project inside `data`,
				// whether it's an array (list envelope) or an object (e.g.
				// el-git context). Arrays ARE objects, so this single
				// `typeof === "object"` check subsumes the former separate
				// `Array.isArray(obj.data)` arm (DEV-5339 collapsed the two
				// byte-identical branches); `filterFields` dispatches on
				// array-vs-object internally. Paths are relative to `data` for
				// every envelope shape. Before DEV-5323 the object case fell
				// through to root filtering, so `--fields branch,issueId` on an
				// envelope returned `{}`.
				output = {
					...obj,
					data: filterFields(obj.data, fieldsFilter, unresolved),
				};
			} else {
				output = filterFields(output, fieldsFilter, unresolved);
			}
		}
		if (unresolved.size > 0) {
			// Fail-visible: the projected keys carry explicit nulls and this
			// warning names them, so a typo'd/missing field is never mistaken
			// for an empty value (DEV-5323).
			outputWarning(
				`fields_unresolved: ${[...unresolved].join(", ")} did not resolve on this payload (emitted as null). Paths are dot-separated and relative to the envelope's data when one is present.`,
			);
		}
	}

	// summary format takes the post-raw value and renders it as a
	// human-readable block. We bypass the jq path because jq is a
	// JSON-shape filter — it doesn't compose with text output. The
	// formatter records any unprojectable `--fields` names; we drain
	// them after dispatch and append them as `_warnings: …` lines so
	// the signal is visible without breaking the text contract.
	if (outputFormat === "summary") {
		emitSummary(output, inferredKind, fieldsFilter);
		const summaryWarnings = [
			...drainWarnings(),
			...drainSummaryFieldWarnings(),
		];
		if (summaryWarnings.length > 0) {
			for (const w of summaryWarnings) {
				logger.info(`_warnings: ${w}`);
			}
		}
		return;
	}

	// JSON path: drain buffered warnings (including any
	// fields_unprojectable surfaced from a prior dispatch) and embed
	// them as `_warnings` on the envelope.
	const warnings = [...drainWarnings(), ...drainSummaryFieldWarnings()];
	if (warnings.length > 0) {
		if (
			output !== null &&
			typeof output === "object" &&
			!Array.isArray(output)
		) {
			output = { ...(output as Record<string, unknown>), _warnings: warnings };
		} else {
			// Bare-array (or primitive / null) output has no envelope object to
			// carry `_warnings`. This is the DEV-5339 fix: previously the buffer
			// was drained above but only re-embedded for object output, so a
			// warning was silently dropped on a top-level array payload AND on
			// `--raw` (which unwraps { data: [...] } to a bare array *before*
			// this point) — losing exactly the DEV-5323 `fields_unresolved:`
			// fail-visible signal on the `--raw` form our own CLAUDE.md
			// recommends to agents. Route each warning to STDERR prefixed
			// `_warnings: ` so the signal always reaches the consumer while
			// stdout stays a pure JSON array (safe to pipe to `jq`). Mirrors the
			// summary path's `_warnings:` line convention — that path uses
			// logger.info because its stdout is already human text; here stdout
			// must remain machine-parseable JSON, so we use logger.error
			// (stderr).
			for (const w of warnings) {
				logger.error(`_warnings: ${w}`);
			}
		}
	}

	if (jqFilter) {
		const json = JSON.stringify(output);
		// Normalize common shell-escape artifacts (zsh history expansion)
		const filter = jqFilter.replace(/\\!/g, "!");
		try {
			const result = execFileSync("jq", ["-r", filter], {
				input: json,
				encoding: "utf8",
				maxBuffer: 10 * 1024 * 1024,
			});
			process.stdout.write(result);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`jq filter failed: ${msg}`);
		}
	} else {
		logger.info(JSON.stringify(output, null, 2));
	}
}

/**
 * Emit a `results_truncated` warning when a list command's result count
 * equals the requested `--limit`, signaling to the caller (typically an
 * AI agent) that more results may exist beyond the page. Heuristic, not
 * exact — `length === limit` has a false-positive when the workspace
 * happens to hold exactly `limit` matching items. Accurate `hasNextPage`
 * would require widening every list-service return type; deferred until
 * a caller cares about the false-positive rate.
 *
 * Message includes a concrete next-step (suggested `--limit` is 2× the
 * current limit) so the agent doesn't have to derive it.
 */
export function warnIfTruncated(count: number, limit: number): void {
	// limit <= 0 means unlimited (--all / --limit 0, DEV-6312): a fully
	// paginated result set can't be truncated, so never warn — and never
	// emit the nonsensical "--limit 0" hint on an empty unlimited fetch.
	if (limit <= 0) {
		return;
	}
	if (count !== limit) {
		return;
	}
	outputWarning(
		`results_truncated: returned ${count} matching --limit ${limit}; more results may exist. ` +
			`Re-run with --limit ${limit * 2} (or narrow via filters like --name, --state, --team) to verify.`,
	);
}

export function outputWarning(message: string | string[]): void {
	const messages = Array.isArray(message) ? message : [message];
	for (const msg of messages) {
		warningBuffer.push(msg);
	}
	// Warnings are buffered and embedded as _warnings in the next outputSuccess call.
	// No stderr output — this prevents multi-JSON corruption when callers use 2>&1.
}

function drainWarnings(): string[] {
	const warnings = [...warningBuffer];
	warningBuffer.length = 0;
	return warnings;
}

export function resetWarnings(): void {
	warningBuffer.length = 0;
}

function outputError(error: Error): void {
	// Run the message and stack through sanitizeForLog so a future SDK
	// upgrade (or proxy/MITM error body) that embeds `lin_api_…` /
	// `lin_oauth_…` / `Bearer <payload>` in error text can't leak a token
	// into stdout, shell history, or CI logs. The wizard already sanitizes
	// its own log paths; this is the central error path on every command.
	//
	// `activeProfile` is included so a "not found" error is distinguishable
	// from "wrong workspace" without manually inspecting
	// ~/.config/el-linear/active-profile (DEV-5610) — the active profile can
	// change between commands (an explicit `profile use`, a different
	// $EL_LINEAR_PROFILE, or another process on the machine switching the
	// shared marker file), and a bare "X not found" reads as data loss or an
	// API outage when the real cause is often just the wrong workspace.
	// Guarded: resolveActiveProfile() throws on an invalid $EL_LINEAR_PROFILE
	// value (a real, separate user error) — outputError is the last-resort
	// error path, so this addition must not itself throw uncaught.
	let activeProfile = "<unknown>";
	try {
		activeProfile = resolveActiveProfile().name ?? "<legacy default>";
	} catch {
		// leave activeProfile as "<unknown>"
	}
	const payload = JSON.stringify(
		{ error: sanitizeForLog(error.message), activeProfile },
		null,
		2,
	);
	// Write to stdout (same channel as success) so machine callers always
	// receive exactly one parseable JSON object regardless of stream capture.
	logger.info(payload);
	if (process.env.EL_LINEAR_DEBUG ?? process.env.LINCTL_DEBUG) {
		logger.error(sanitizeForLog(error.stack ?? ""));
	}
	process.exit(1);
}

export function handleAsyncCommand<TArgs extends unknown[]>(
	asyncFn: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
	return async (...args: TArgs) => {
		try {
			await asyncFn(...args);
		} catch (error) {
			outputError(error instanceof Error ? error : new Error(String(error)));
		}
	};
}
