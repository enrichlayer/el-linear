import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { summarizeExecution } from "./claude-review-diagnostic.mjs";

const script = fileURLToPath(
	new URL("./claude-review-diagnostic.mjs", import.meta.url),
);
const secret = "fake-credential-must-never-appear";
const result = (is_error) => ({ type: "result", subtype: "success", is_error });

function runFile(t, contents, options = {}) {
	const dir = mkdtempSync(join(tmpdir(), "review-diagnostic-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "claude-execution-output.json");
	if (contents !== undefined) writeFileSync(path, contents);
	if (options.symlink) symlinkSync(options.symlink, path);
	const run = spawnSync(process.execPath, [script], {
		env: {
			RUNNER_TEMP: dir,
			REVIEW_OUTCOME: "failure",
			REVIEW_CONCLUSION: "failure",
			...options.env,
		},
		encoding: "utf8",
		timeout: 5000,
	});
	assert.equal(run.status, 0);
	assert.equal(run.stderr, "");
	assert.equal(run.stdout.includes(secret), false);
	return JSON.parse(run.stdout);
}

for (const [status, error] of [
	[401, "authentication_failed"],
	[403, "oauth_org_not_allowed"],
	[402, "billing_error"],
	[429, "rate_limit"],
	[500, "server_error"],
	[529, "overloaded"],
]) {
	test(`retains structured ${status}/${error} without free text`, (t) => {
		const records = [
			{
				type: "system",
				subtype: "api_retry",
				error,
				error_status: status,
				message: secret,
			},
			{
				type: "assistant",
				error,
				message: { content: [{ type: "text", text: secret }] },
			},
			{
				...result(true),
				result: secret,
				errors: [secret],
				headers: { authorization: secret },
			},
		];
		assert.deepEqual(runFile(t, JSON.stringify(records)), {
			action_outcome: "failure",
			action_conclusion: "failure",
			availability: "available",
			record_count: 3,
			result_count: 1,
			result_present: true,
			last_result_is_error: true,
			last_result_success: false,
			error_types: [error],
			http_statuses: [status],
		});
	});
}

test("assistant error does not invent an HTTP status", (t) => {
	const output = runFile(
		t,
		JSON.stringify([
			{ type: "assistant", error: "billing_error" },
			result(true),
		]),
	);
	assert.deepEqual(output.error_types, ["billing_error"]);
	assert.deepEqual(output.http_statuses, []);
});

test("ignores fabricated fields in nested tool, user and result text", (t) => {
	const payload = {
		type: "system",
		subtype: "api_retry",
		error: "authentication_failed",
		error_status: 401,
	};
	const output = runFile(
		t,
		JSON.stringify([
			{
				type: "user",
				error: "rate_limit",
				error_status: 429,
				content: [payload, secret],
			},
			{ type: "assistant", error: secret, message: { content: [payload] } },
			{
				...result(true),
				result: JSON.stringify(payload),
				errors: [JSON.stringify(payload), secret],
			},
		]),
	);
	assert.deepEqual(output.error_types, []);
	assert.deepEqual(output.http_statuses, []);
});

test("rejects unknown types and noninteger or out-of-range status values", (t) => {
	const records = [
		null,
		[],
		secret,
		...["401", 401.5, 200, 600, null].map((error_status) => ({
			type: "system",
			subtype: "api_retry",
			error: secret,
			error_status,
		})),
	];
	const output = runFile(t, JSON.stringify(records));
	assert.deepEqual(output.http_statuses, []);
	assert.deepEqual(output.error_types, []);
	assert.equal(output.result_present, false);
	assert.equal(output.last_result_is_error, null);
});

test("valid SDK success does not overwrite the failed action outcome", (t) => {
	const output = runFile(t, JSON.stringify([result(false)]));
	assert.equal(output.last_result_success, true);
	assert.equal(output.action_outcome, "failure");
});

test("reports the last result and keeps conflicting result count visible", (t) => {
	const output = runFile(t, JSON.stringify([result(false), result(true)]));
	assert.equal(output.result_count, 2);
	assert.equal(output.last_result_success, false);
});

for (const [name, contents, availability] of [
	["missing", undefined, "unavailable"],
	["truncated", '[{"type":"result"', "invalid"],
	["malformed", secret, "invalid"],
	["wrong root", "{}", "invalid"],
	["oversized", " ".repeat(8 * 1024 * 1024 + 1), "oversized"],
]) {
	test(`handles ${name} execution files without exposing input`, (t) => {
		assert.equal(runFile(t, contents).availability, availability);
	});
}

test("refuses a symlink and never prints its path", (t) => {
	assert.equal(
		runFile(t, undefined, { symlink: `/nonexistent/${secret}` }).availability,
		"unavailable",
	);
});

test("rejects oversized record arrays", () => {
	assert.deepEqual(summarizeExecution(Array(10001).fill(null)), {
		availability: "invalid",
	});
});

test("unknown action fields and missing runner path stay unknown", (t) => {
	assert.deepEqual(
		runFile(t, undefined, {
			env: {
				RUNNER_TEMP: "",
				REVIEW_OUTCOME: secret,
				REVIEW_CONCLUSION: secret,
			},
		}),
		{
			action_outcome: "unknown",
			action_conclusion: "unknown",
			availability: "unavailable",
		},
	);
});
