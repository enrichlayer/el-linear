import { execFileSync } from "node:child_process";
import {
	dispatch as dispatchSummary,
	inferKindFromPayload,
} from "./formatters/summary.js";
import { logger } from "./logger.js";

const warningBuffer: string[] = [];
let rawMode = false;
let jqFilter: string | null = null;
let fieldsFilter: string[] | null = null;

export type OutputFormat = "json" | "summary";
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
 * Emit a summary-format render to stdout for the given payload. The
 * caller (`outputSuccess`) has already applied `--raw` and `--fields`,
 * so the value here is post-filter — no need to unwrap again.
 */
function emitSummary(payload: unknown): void {
	const kind = inferKindFromPayload(payload);
	logger.info(dispatchSummary(kind, payload));
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
		emitSummary(output);
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

export function outputWarning(
	message: string | string[],
	_type?: string,
): void {
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

export function resetOutputFormat(): void {
	outputFormat = "json";
}

function outputError(error: Error): void {
	const payload = JSON.stringify({ error: error.message }, null, 2);
	// Write to stdout (same channel as success) so machine callers always
	// receive exactly one parseable JSON object regardless of stream capture.
	logger.info(payload);
	if (process.env.EL_LINEAR_DEBUG ?? process.env.LINCTL_DEBUG) {
		logger.error(error.stack ?? "");
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
