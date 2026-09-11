import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 10000;
const ERROR_TYPES = new Set([
	"authentication_failed",
	"oauth_org_not_allowed",
	"billing_error",
	"rate_limit",
	"overloaded",
	"invalid_request",
	"model_not_found",
	"server_error",
	"max_output_tokens",
	"unknown",
]);

/** Only SDK envelope fields are evidence; never search message/tool/result text. */
export function summarizeExecution(records) {
	if (!Array.isArray(records) || records.length > MAX_RECORDS) {
		return { availability: "invalid" };
	}
	const errors = new Set();
	const statuses = new Set();
	let resultCount = 0;
	let lastResult;
	for (const record of records) {
		if (!record || typeof record !== "object" || Array.isArray(record))
			continue;
		if (record.type === "result") {
			resultCount++;
			lastResult = record;
		}
		const retry = record.type === "system" && record.subtype === "api_retry";
		if (record.type === "assistant" || retry) {
			if (ERROR_TYPES.has(record.error)) errors.add(record.error);
		}
		if (
			retry &&
			Number.isInteger(record.error_status) &&
			record.error_status >= 400 &&
			record.error_status <= 599
		) {
			statuses.add(record.error_status);
		}
	}
	return {
		availability: "available",
		record_count: records.length,
		result_count: resultCount,
		result_present: resultCount > 0,
		last_result_is_error:
			typeof lastResult?.is_error === "boolean" ? lastResult.is_error : null,
		last_result_success:
			lastResult?.subtype === "success" && lastResult.is_error === false,
		error_types: [...errors].sort(),
		http_statuses: [...statuses].sort((a, b) => a - b),
	};
}

export function readDiagnostic(runnerTemp) {
	if (!runnerTemp) return { availability: "unavailable" };
	let fd;
	try {
		// The action's fixed runner-local path also works when failure omits outputs.
		fd = openSync(
			join(runnerTemp, "claude-execution-output.json"),
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		const stat = fstatSync(fd);
		if (!stat.isFile()) return { availability: "invalid" };
		if (stat.size > MAX_BYTES) return { availability: "oversized" };
		// Bound the actual read too, even if the file grows after stat.
		const buffer = Buffer.alloc(MAX_BYTES + 1);
		let size = 0;
		while (size < buffer.length) {
			const count = readSync(fd, buffer, size, buffer.length - size, null);
			if (count === 0) break;
			size += count;
		}
		if (size > MAX_BYTES) return { availability: "oversized" };
		return summarizeExecution(
			JSON.parse(buffer.subarray(0, size).toString("utf8")),
		);
	} catch (error) {
		return {
			availability: error instanceof SyntaxError ? "invalid" : "unavailable",
		};
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

export function diagnostic(env) {
	const outcomes = new Set(["success", "failure", "cancelled", "skipped"]);
	return {
		action_outcome: outcomes.has(env.REVIEW_OUTCOME)
			? env.REVIEW_OUTCOME
			: "unknown",
		action_conclusion: ["success", "failure"].includes(env.REVIEW_CONCLUSION)
			? env.REVIEW_CONCLUSION
			: "unknown",
		...readDiagnostic(env.RUNNER_TEMP),
	};
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	process.stdout.write(`${JSON.stringify(diagnostic(process.env))}\n`);
}
