import { execFileSync } from "node:child_process";
import {
	dispatch as dispatchSummary,
	inferKindFromPayload,
	type ResourceKind,
} from "./formatters/summary.js";
import { logger } from "./logger.js";
import { sanitizeForLog } from "./sanitize-for-log.js";

const warningBuffer: string[] = [];
let rawMode = false;
let jqFilter: string | null = null;
let fieldsFilter: string[] | null = null;

type OutputFormat = "json" | "summary";
let outputFormat: OutputFormat = "json";

export function setRawMode(enabled: boolean): void {
	rawMode = enabled;
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

function filterFields(obj: unknown, fields: string[]): unknown {
	if (Array.isArray(obj)) {
		return obj.map((item) => filterFields(item, fields));
	}
	if (obj !== null && typeof obj === "object") {
		const source = obj as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const field of fields) {
			if (field in source) {
				result[field] = source[field];
			}
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
 */
function emitSummary(payload: unknown, kind: ResourceKind): void {
	logger.info(dispatchSummary(kind, payload));
}

/**
 * Resource-specific extra metadata that may be added to a list response
 * alongside the canonical `count` (e.g. `query` on search, `team` on
 * filtered list). Excludes `count` at the type level — callers can't
 * accidentally pass a string `count` and have it silently overridden;
 * the only way to set `count` is via `data.length` inside `outputList`.
 *
 * Implementation note: `count?: never` together with `Record<string, unknown>`
 * lets TypeScript accept any other key while disallowing the literal
 * `count` key. The `never`-typed property is impossible to assign, which
 * is what we want for the "no count here" contract.
 */
export type ListExtraMeta = Record<string, unknown> & {
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
	const warnings = drainWarnings();
	let output: unknown;
	if (
		warnings.length > 0 &&
		data !== null &&
		typeof data === "object" &&
		!Array.isArray(data)
	) {
		output = { ...(data as Record<string, unknown>), _warnings: warnings };
	} else {
		output = data;
	}
	// Capture the kind from the original envelope shape BEFORE --raw /
	// --fields stripping. Otherwise filtering away signature fields (e.g.
	// `title` on an issue) breaks shape inference and the summary
	// formatter falls back to the generic key-value dump.
	const inferredKind =
		outputFormat === "summary" ? inferKindFromPayload(output) : "generic";
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
	// --fields: filter object keys (applies to array items or flat objects)
	if (fieldsFilter) {
		if (Array.isArray(output)) {
			output = filterFields(output, fieldsFilter);
		} else if (output !== null && typeof output === "object") {
			const obj = output as Record<string, unknown>;
			if (Array.isArray(obj.data)) {
				output = { ...obj, data: filterFields(obj.data, fieldsFilter) };
			} else {
				output = filterFields(output, fieldsFilter);
			}
		}
	}

	// summary format takes the post-raw / post-fields value and renders it
	// as a human-readable block. We bypass the jq path because jq is a
	// JSON-shape filter — it doesn't compose with text output.
	if (outputFormat === "summary") {
		emitSummary(output, inferredKind);
		return;
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
	const payload = JSON.stringify(
		{ error: sanitizeForLog(error.message) },
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
