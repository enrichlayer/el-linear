import {
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	vi,
} from "vitest";
import {
	type CliListEnvelope,
	handleAsyncCommand,
	outputList,
	outputSingle,
	outputSuccess,
	outputWarning,
	resetWarnings,
	setFieldsFilter,
	setQuietMode,
	setRawMode,
	type WindowedMeta,
	warnIfTruncated,
} from "./output.js";

describe("outputSuccess", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
	});

	it("outputs JSON to stdout", () => {
		outputSuccess({ key: "value" });
		expect(stdoutSpy).toHaveBeenCalledWith(
			`${JSON.stringify({ key: "value" }, null, 2)}\n`,
		);
	});

	it("handles arrays", () => {
		outputSuccess([1, 2, 3]);
		expect(stdoutSpy).toHaveBeenCalledWith(
			`${JSON.stringify([1, 2, 3], null, 2)}\n`,
		);
	});

	it("handles null", () => {
		outputSuccess(null);
		expect(stdoutSpy).toHaveBeenCalledWith("null\n");
	});
});

describe("outputSuccess --quiet mode (DEV-4650)", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		setQuietMode(true);
	});

	afterEach(() => {
		setQuietMode(false);
		stdoutSpy.mockRestore();
	});

	// Composition test: the real outputSuccess path (not a mocked formatter)
	// must collapse an updated-issue payload to exactly one confirmation line.
	it("emits a single IDENTIFIER  STATE  URL line for an issue write", () => {
		outputSuccess({
			identifier: "DEV-1",
			title: "Some issue",
			state: { name: "Done" },
			url: "https://linear.app/acme/issue/DEV-1/some-issue",
		});
		expect(stdoutSpy).toHaveBeenCalledTimes(1);
		expect(stdoutSpy).toHaveBeenCalledWith(
			"DEV-1  Done  https://linear.app/acme/issue/DEV-1/some-issue\n",
		);
	});

	it("emits a single 'comment <id>' line for a comment write", () => {
		outputSuccess({
			id: "c-abc",
			body: "hi",
			user: { id: "u-1", name: "Alice" },
			createdAt: "2026-01-01T00:00:00Z",
		});
		expect(stdoutSpy).toHaveBeenCalledWith("comment c-abc\n");
	});

	it("overrides --fields filtering with the one-line form", () => {
		// --fields is captured before quiet emit; the line still wins.
		setFieldsFilter(["identifier"]);
		outputSuccess({
			identifier: "DEV-2",
			title: "x",
			state: { name: "Todo" },
			url: "https://linear.app/acme/issue/DEV-2/x",
		});
		setFieldsFilter(null);
		expect(stdoutSpy).toHaveBeenCalledWith(
			"DEV-2  Todo  https://linear.app/acme/issue/DEV-2/x\n",
		);
	});
});

describe("warning buffer", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	it("embeds warnings in success output as _warnings", () => {
		outputWarning("brand name issue");
		outputSuccess({ id: "123" });
		const written = (stdoutSpy.mock.calls[0][0] as string).trim();
		const parsed = JSON.parse(written);
		expect(parsed.id).toBe("123");
		expect(parsed._warnings).toEqual(["brand name issue"]);
	});

	it("drains buffer after outputSuccess", () => {
		outputWarning("w1");
		outputSuccess({ a: 1 });
		outputSuccess({ b: 2 });
		const first = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		const second = JSON.parse((stdoutSpy.mock.calls[1][0] as string).trim());
		expect(first._warnings).toEqual(["w1"]);
		expect(second._warnings).toBeUndefined();
	});

	it("routes warnings to stderr for bare-array output, keeping stdout a pure array (DEV-5339)", () => {
		outputWarning("w1");
		outputSuccess([1, 2, 3]);
		// stdout stays a pure JSON array — an array has no envelope to hold a
		// `_warnings` key, so it must remain jq/pipe-safe.
		const written = (stdoutSpy.mock.calls[0][0] as string).trim();
		const parsed = JSON.parse(written);
		expect(parsed).toEqual([1, 2, 3]);
		// The warning is NOT silently dropped: it reaches the consumer on stderr
		// prefixed `_warnings: ` (mirrors the summary path's line convention).
		const allStderr = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(allStderr).toContain("_warnings: w1");
	});

	it("accumulates multiple warnings", () => {
		outputWarning("w1");
		outputWarning(["w2", "w3"], "term_enforcement");
		outputSuccess({ id: "x" });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._warnings).toEqual(["w1", "w2", "w3"]);
	});

	it("does not write warnings to stderr (buffered for stdout only)", () => {
		outputWarning("buffered");
		expect(stderrSpy).not.toHaveBeenCalled();
	});

	it("resetWarnings clears the buffer", () => {
		outputWarning("w1");
		resetWarnings();
		outputSuccess({ id: "x" });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._warnings).toBeUndefined();
	});

	it("no _warnings key when no warnings emitted", () => {
		outputSuccess({ id: "y" });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._warnings).toBeUndefined();
		expect(parsed.id).toBe("y");
	});

	it("stdout is always a single parseable JSON object", () => {
		outputWarning("mid-execution warning");
		outputSuccess({ id: "z", identifier: "DEV-1" });
		// Collect all stdout writes
		const allStdout = stdoutSpy.mock.calls
			.map((call) => call[0] as string)
			.join("");
		// Must parse as a single JSON value
		expect(() => JSON.parse(allStdout)).not.toThrow();
		const parsed = JSON.parse(allStdout);
		expect(parsed.identifier).toBe("DEV-1");
		expect(parsed._warnings).toEqual(["mid-execution warning"]);
	});
});

describe("warnIfTruncated", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
	});

	it("emits a results_truncated warning when count === limit", () => {
		warnIfTruncated(50, 50);
		outputSuccess({ data: [] });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._warnings).toHaveLength(1);
		expect(parsed._warnings[0]).toContain("results_truncated");
		expect(parsed._warnings[0]).toContain("50 matching --limit 50");
		expect(parsed._warnings[0]).toContain("--limit 100");
	});

	it("does not warn when count < limit", () => {
		warnIfTruncated(7, 100);
		outputSuccess({ data: [] });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._warnings).toBeUndefined();
	});

	it("does not warn when count > limit (defensive)", () => {
		warnIfTruncated(101, 100);
		outputSuccess({ data: [] });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._warnings).toBeUndefined();
	});

	it("suggested limit is double the current limit", () => {
		warnIfTruncated(25, 25);
		outputSuccess({ data: [] });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._warnings[0]).toContain("--limit 50");
	});
});

describe("--raw mode", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		setRawMode(true);
		setFieldsFilter(null);
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		setRawMode(false);
		setFieldsFilter(null);
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	it("unwraps { data: [...], meta } to just the array", () => {
		outputSuccess({ data: [{ id: "1" }, { id: "2" }], meta: { count: 2 } });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual([{ id: "1" }, { id: "2" }]);
	});

	it("preserves flat objects without data key", () => {
		outputSuccess({ id: "123", name: "test" });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed.id).toBe("123");
		expect(parsed.name).toBe("test");
	});

	it("preserves arrays passed directly", () => {
		outputSuccess([1, 2, 3]);
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual([1, 2, 3]);
	});

	it("preserves non-array data field", () => {
		outputSuccess({ data: "not-an-array", meta: { count: 0 } });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed.data).toBe("not-an-array");
	});

	it("routes warnings to stderr when unwrapping to a bare array (DEV-5339)", () => {
		outputWarning("watch out");
		outputSuccess({ data: [{ id: "1" }], meta: { count: 1 }, _warnings: [] });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		// raw mode unwraps to a bare array, which can't carry a `_warnings` key,
		// so stdout stays a pure array...
		expect(Array.isArray(parsed)).toBe(true);
		// ...and the buffered warning is emitted to stderr instead of dropped.
		const allStderr = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(allStderr).toContain("_warnings: watch out");
	});

	// DEV-5339 regression: the DEV-5323 `fields_unresolved:` fail-visible signal
	// must survive `--raw`, which unwraps { data } to a bare array BEFORE the
	// fields filter runs — previously the warning was drained and silently
	// discarded exactly on the `--raw` form CLAUDE.md recommends to agents.
	it("--raw + unresolved --fields: fields_unresolved reaches stderr, stdout stays a bare array (DEV-5339)", () => {
		setFieldsFilter(["identifier", "ghost"]);
		outputSuccess({
			data: [{ identifier: "DEV-1" }, { identifier: "DEV-2" }],
			meta: { count: 2 },
		});
		// stdout: the unwrapped, projected array — pure JSON, jq-safe. The
		// unresolved field is still present as an explicit null per item.
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual([
			{ identifier: "DEV-1", ghost: null },
			{ identifier: "DEV-2", ghost: null },
		]);
		// the naming signal survives on stderr, prefixed `_warnings: `.
		const allStderr = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(allStderr).toContain("_warnings: ");
		expect(allStderr).toContain("fields_unresolved: ghost");
	});
});

describe("--fields filter", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		setRawMode(false);
		setFieldsFilter(null);
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		setFieldsFilter(null);
		setRawMode(false);
		stdoutSpy.mockRestore();
	});

	it("filters fields on a flat object", () => {
		setFieldsFilter(["identifier", "title"]);
		outputSuccess({
			identifier: "DEV-1",
			title: "Fix bug",
			priority: 2,
			state: { name: "Done" },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual({ identifier: "DEV-1", title: "Fix bug" });
	});

	it("filters fields on items inside { data: [...] } wrapper", () => {
		setFieldsFilter(["identifier", "title"]);
		outputSuccess({
			data: [
				{ identifier: "DEV-1", title: "First", priority: 2 },
				{ identifier: "DEV-2", title: "Second", priority: 1 },
			],
			meta: { count: 2 },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed.data).toEqual([
			{ identifier: "DEV-1", title: "First" },
			{ identifier: "DEV-2", title: "Second" },
		]);
		expect(parsed.meta).toEqual({ count: 2 });
	});

	it("composes with --raw: filters the unwrapped array items", () => {
		setRawMode(true);
		setFieldsFilter(["identifier", "title"]);
		outputSuccess({
			data: [
				{ identifier: "DEV-1", title: "First", priority: 2 },
				{ identifier: "DEV-2", title: "Second", priority: 1 },
			],
			meta: { count: 2 },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual([
			{ identifier: "DEV-1", title: "First" },
			{ identifier: "DEV-2", title: "Second" },
		]);
	});

	it("emits non-existent field names as explicit null + a _warnings line (DEV-5323 — was silent omission)", () => {
		setFieldsFilter(["identifier", "nonexistent"]);
		outputSuccess({ identifier: "DEV-1", title: "Bug", priority: 2 });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed.identifier).toBe("DEV-1");
		expect(parsed.nonexistent).toBeNull();
		expect(parsed._warnings.join(" ")).toContain(
			"fields_unresolved: nonexistent",
		);
	});

	it("resolves dot-separated nested paths as flat output keys (DEV-5323)", () => {
		setFieldsFilter(["iid", "pipeline.status"]);
		outputSuccess({
			iid: 1740,
			sha: "abc",
			pipeline: { id: 9, status: "success" },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual({ iid: 1740, "pipeline.status": "success" });
	});

	it("projects inside an envelope with an OBJECT data payload (DEV-5323 — was {})", () => {
		setFieldsFilter(["branch", "issueId"]);
		outputSuccess({
			data: {
				branch: "fix/DEV-1-x",
				issueId: "DEV-1",
				team: "DEV",
				staged: [],
			},
			meta: { totalChanged: 3 },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed.data).toEqual({ branch: "fix/DEV-1-x", issueId: "DEV-1" });
		expect(parsed.meta).toEqual({ totalChanged: 3 });
	});

	it("a real null value resolves without an unresolved warning", () => {
		setFieldsFilter(["identifier", "dueDate"]);
		outputSuccess({ identifier: "DEV-1", dueDate: null });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual({ identifier: "DEV-1", dueDate: null });
		expect(parsed._warnings).toBeUndefined();
	});

	it("array projection warns only when a field resolves on NO item", () => {
		setFieldsFilter(["identifier", "dueDate", "ghost"]);
		outputSuccess({
			data: [
				{ identifier: "DEV-1", dueDate: "2026-07-01" },
				{ identifier: "DEV-2" },
			],
			meta: { count: 2 },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed.data[0].dueDate).toBe("2026-07-01");
		expect(parsed.data[1].dueDate).toBeNull();
		expect(parsed.data[1].ghost).toBeNull();
		const warningText = parsed._warnings.join(" ");
		expect(warningText).toContain("ghost");
		expect(warningText).not.toContain("dueDate");
	});

	it("includes full nested objects for fields like state", () => {
		setFieldsFilter(["identifier", "state"]);
		outputSuccess({
			identifier: "DEV-1",
			title: "Bug",
			state: { id: "s1", name: "In Progress", type: "started" },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual({
			identifier: "DEV-1",
			state: { id: "s1", name: "In Progress", type: "started" },
		});
	});

	it("passes through primitives and null unchanged", () => {
		setFieldsFilter(["identifier"]);
		outputSuccess(null);
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toBeNull();
	});

	it("does not filter when fieldsFilter is null", () => {
		outputSuccess({ identifier: "DEV-1", title: "Bug", priority: 2 });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual({ identifier: "DEV-1", title: "Bug", priority: 2 });
	});

	it("resolves the status/updated column aliases when the literal key is absent (DEV-5376)", () => {
		setFieldsFilter(["identifier", "status", "updated"]);
		outputSuccess({
			data: [
				{
					identifier: "DEV-1",
					state: { name: "In Progress", type: "started" },
					updatedAt: "2026-07-02T15:46:36.117Z",
				},
			],
			meta: { count: 1 },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed.data).toEqual([
			{
				identifier: "DEV-1",
				status: "In Progress",
				updated: "2026-07-02T15:46:36.117Z",
			},
		]);
		expect(parsed._warnings).toBeUndefined();
	});

	it("a literal status key wins over the alias", () => {
		setFieldsFilter(["status"]);
		outputSuccess({
			status: "raw-status",
			state: { name: "In Progress" },
		});
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed).toEqual({ status: "raw-status" });
	});

	it("an alias whose target is missing still nulls + warns", () => {
		setFieldsFilter(["identifier", "status"]);
		outputSuccess({ identifier: "cfg-1", scope: "workspace" });
		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed.status).toBeNull();
		expect(parsed._warnings.join(" ")).toContain("fields_unresolved: status");
	});
});

describe("handleAsyncCommand", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;
	let exitSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		stderrSpy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("calls the wrapped async function", async () => {
		const fn = vi.fn().mockResolvedValue(undefined);
		const wrapped = handleAsyncCommand(fn);
		await wrapped("arg1", "arg2");
		expect(fn).toHaveBeenCalledWith("arg1", "arg2");
	});

	it("outputs error JSON to stdout and exits", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("test failure"));
		const wrapped = handleAsyncCommand(fn);
		await wrapped();
		// activeProfile (DEV-5610) reflects whatever profile is active on the
		// machine running this test, so assert its shape rather than a fixed
		// value — the exact-string form this replaced hardcoded the full
		// envelope and broke the moment that field was added.
		const parsed = JSON.parse(stdoutSpy.mock.calls[0]?.[0] as string);
		expect(parsed.error).toBe("test failure");
		expect(parsed.activeProfile).toEqual(expect.any(String));
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("wraps non-Error throws in Error", async () => {
		const fn = vi.fn().mockRejectedValue("string error");
		const wrapped = handleAsyncCommand(fn);
		await wrapped();
		const parsed = JSON.parse(stdoutSpy.mock.calls[0]?.[0] as string);
		expect(parsed.error).toBe("string error");
		expect(parsed.activeProfile).toEqual(expect.any(String));
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("error output on stdout is a single parseable JSON object", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("broken"));
		const wrapped = handleAsyncCommand(fn);
		await wrapped();
		const allStdout = stdoutSpy.mock.calls
			.map((call) => call[0] as string)
			.join("");
		expect(() => JSON.parse(allStdout)).not.toThrow();
		expect(JSON.parse(allStdout).error).toBe("broken");
	});

	it("redacts a Linear personal API token embedded in error.message", async () => {
		// A future SDK upgrade that wraps the Authorization header into the
		// rejection's message would otherwise leak the token through this
		// central error path. Defense applies via sanitizeForLog.
		const fn = vi
			.fn()
			.mockRejectedValue(
				new Error("Bearer lin_api_abcdefghijklmnop1234567890 — request failed"),
			);
		const wrapped = handleAsyncCommand(fn);
		await wrapped();
		const allStdout = stdoutSpy.mock.calls
			.map((call) => call[0] as string)
			.join("");
		const message = JSON.parse(allStdout).error as string;
		expect(message).not.toContain("lin_api_abcdefghijklmnop1234567890");
		expect(message).toContain("lin_api_***REDACTED***");
	});

	it("redacts a Linear OAuth token embedded in error.message", async () => {
		const fn = vi
			.fn()
			.mockRejectedValue(
				new Error("OAuth refresh failed: lin_oauth_zyxwvutsrqponmlk0987654321"),
			);
		const wrapped = handleAsyncCommand(fn);
		await wrapped();
		const allStdout = stdoutSpy.mock.calls
			.map((call) => call[0] as string)
			.join("");
		const message = JSON.parse(allStdout).error as string;
		expect(message).not.toContain("lin_oauth_zyxwvutsrqponmlk0987654321");
		expect(message).toContain("lin_oauth_***REDACTED***");
	});

	it("redacts a Bearer-style high-entropy payload embedded in error.stack (debug mode)", async () => {
		// EL_LINEAR_DEBUG=1 logs the stack to stderr. A leaked Authorization
		// header in the stack frames would otherwise reach the user's terminal.
		const oldDebug = process.env.EL_LINEAR_DEBUG;
		process.env.EL_LINEAR_DEBUG = "1";
		try {
			const err = new Error("boom");
			err.stack =
				"Authorization: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij01234567890+/=\n    at runFoo";
			const fn = vi.fn().mockRejectedValue(err);
			const wrapped = handleAsyncCommand(fn);
			await wrapped();
			const allStderr = stderrSpy.mock.calls
				.map((call) => call[0] as string)
				.join("");
			expect(allStderr).not.toContain(
				"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij01234567890+/=",
			);
			expect(allStderr).toContain("***REDACTED***");
		} finally {
			if (oldDebug === undefined) delete process.env.EL_LINEAR_DEBUG;
			else process.env.EL_LINEAR_DEBUG = oldDebug;
		}
	});
});

describe("--format summary", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		const mod = await import("./output.js");
		mod.resetWarnings();
		mod.setRawMode(false);
		mod.setFieldsFilter(null);
		mod.setOutputFormat("summary");
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
	});

	afterEach(async () => {
		const mod = await import("./output.js");
		mod.setOutputFormat("json");
		mod.setRawMode(false);
		mod.setFieldsFilter(null);
		stdoutSpy.mockRestore();
	});

	it("emits a human-readable summary instead of JSON", async () => {
		const { outputSuccess } = await import("./output.js");
		outputSuccess({
			identifier: "DEV-1",
			title: "Fix bug",
			state: { name: "Todo" },
			assignee: { name: "Alice" },
			url: "https://linear.app/acme/issue/DEV-1",
		});
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(written).toContain("DEV-1");
		expect(written).toContain("Fix bug");
		expect(written).toContain("Todo");
		expect(written).toContain("Alice");
		// Must not be valid JSON
		expect(() => JSON.parse(written)).toThrow();
	});

	it("renders a list envelope as a table", async () => {
		const { outputSuccess } = await import("./output.js");
		outputSuccess({
			data: [
				{
					identifier: "DEV-1",
					title: "First",
					state: { name: "Todo" },
					assignee: { name: "Alice" },
				},
				{
					identifier: "DEV-2",
					title: "Second",
					state: { name: "Done" },
					assignee: { name: "Bob" },
				},
			],
			meta: { count: 2 },
		});
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(written).toMatch(/ID\s+TITLE\s+STATE\s+ASSIGNEE/);
		expect(written).toContain("2 issues");
	});

	it("composes with --raw to render bare-array list", async () => {
		const { outputSuccess, setRawMode } = await import("./output.js");
		setRawMode(true);
		outputSuccess({
			data: [
				{
					identifier: "DEV-1",
					title: "x",
					state: { name: "Todo" },
					assignee: null,
				},
			],
			meta: { count: 1 },
		});
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(written).toContain("DEV-1");
		expect(written).toContain("1 issue");
	});

	it("falls back to generic key/value rendering for unknown shapes", async () => {
		const { outputSuccess } = await import("./output.js");
		outputSuccess({ foo: "bar", baz: 123 });
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(written).toContain("foo:");
		expect(written).toContain("bar");
		expect(written).toContain("baz:");
	});

	it("includes a trailing newline", async () => {
		const { outputSuccess } = await import("./output.js");
		outputSuccess({ foo: "bar" });
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(written.endsWith("\n")).toBe(true);
	});

	// --fields on summary is a projection request (DEV-4750), not the
	// pre-DEV-4750 JSON-shape strip. The shape inference still runs on the
	// pre-filter payload so kind detection survives (ALL-933 composition);
	// what changed is that the formatter now consumes the requested fields
	// directly. Header line still carries the identifier + title regardless.
	it("composes with --fields: still renders as issue summary when title is filtered out", async () => {
		const { outputSuccess, setFieldsFilter } = await import("./output.js");
		setFieldsFilter(["identifier", "url"]);
		outputSuccess({
			identifier: "DEV-1",
			title: "Fix bug",
			state: { name: "Todo" },
			assignee: { name: "Alice" },
			url: "https://linear.app/acme/issue/DEV-1",
		});
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		// Issue formatter renders a header line with the identifier and title.
		// If we'd fallen through to the generic formatter, we'd see
		// `identifier:` as a key/value line.
		expect(written).toContain("DEV-1");
		expect(written).not.toMatch(/^identifier:/m);
		// URL is in the requested set; render it.
		expect(written).toContain("URL:");
	});

	it("composes with --fields: list envelope renders as issue table with projected columns", async () => {
		const { outputSuccess, setFieldsFilter } = await import("./output.js");
		setFieldsFilter(["identifier"]);
		outputSuccess({
			data: [
				{
					identifier: "DEV-1",
					title: "First",
					state: { name: "Todo" },
					assignee: { name: "Alice" },
				},
				{
					identifier: "DEV-2",
					title: "Second",
					state: { name: "Done" },
					assignee: { name: "Bob" },
				},
			],
			meta: { count: 2 },
		});
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		// Issue-list table header — generic fallback would dump key/value pairs.
		// Post-DEV-4750: --fields identifier means *only* the ID column renders.
		expect(written).toMatch(/^ID\s*$/m);
		expect(written).toContain("DEV-1");
		expect(written).toContain("DEV-2");
	});

	// DEV-4750: --fields on summary extends the column set with projectable
	// nested fields. `--fields ...,project` adds a PROJECT column whose
	// value is `project.name` — proves the JSON-shape strip is no longer
	// applied (which would have flattened `project: {name: ...}` to `{}`).
	it("composes with --fields: projects nested project.name into the issue table", async () => {
		const { outputSuccess, setFieldsFilter } = await import("./output.js");
		setFieldsFilter(["identifier", "title", "state", "assignee", "project"]);
		outputSuccess({
			data: [
				{
					identifier: "DEV-1",
					title: "First",
					state: { name: "Todo" },
					assignee: { name: "Alice" },
					project: { name: "Auth Refactor" },
				},
			],
			meta: { count: 1 },
		});
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(written).toMatch(/ID\s+TITLE\s+STATE\s+ASSIGNEE\s+PROJECT/);
		expect(written).toContain("Auth Refactor");
	});

	// DEV-4750: --fields on summary projects nested teams[].key into the
	// projects table — the original gap that motivated the change.
	it("composes with --fields: projects nested teams into the projects table", async () => {
		const { outputSuccess, setFieldsFilter } = await import("./output.js");
		setFieldsFilter(["name", "state", "progress", "lead", "teams"]);
		outputSuccess({
			data: [
				{
					name: "Auth Refactor",
					state: "started",
					progress: 0.65,
					lead: { name: "Alice" },
					teams: [
						{ key: "DEV", name: "Dev" },
						{ key: "FE", name: "Frontend" },
					],
				},
			],
			meta: { count: 1 },
		});
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(written).toMatch(/NAME\s+STATE\s+PROGRESS\s+LEAD\s+TEAMS/);
		expect(written).toContain("DEV, FE");
	});

	// DEV-4750: an unprojectable --fields name surfaces as an inline
	// `_warnings:` line after the summary block so scripts can detect it
	// deterministically without re-running with --format json.
	it("emits a _warnings line when an unknown field is requested on summary", async () => {
		const { outputSuccess, setFieldsFilter } = await import("./output.js");
		setFieldsFilter(["identifier", "title", "doesnotexist"]);
		outputSuccess({
			data: [
				{
					identifier: "DEV-1",
					title: "x",
					state: { name: "Todo" },
					assignee: null,
				},
			],
			meta: { count: 1 },
		});
		const written = stdoutSpy.mock.calls.map((c) => c[0] as string).join("");
		expect(written).toContain("_warnings:");
		expect(written).toContain("fields_unprojectable");
		expect(written).toContain("doesnotexist");
	});
});

describe("setOutputFormat", () => {
	it("toggles between json and summary", async () => {
		const { setOutputFormat, getOutputFormat } = await import("./output.js");
		setOutputFormat("summary");
		expect(getOutputFormat()).toBe("summary");
		setOutputFormat("json");
		expect(getOutputFormat()).toBe("json");
	});
});

describe("outputList / outputSingle (DEV-4068 T6)", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function lastEmittedJson(): unknown {
		const lastCall = stdoutSpy.mock.calls.at(-1);
		if (!lastCall) throw new Error("no stdout writes recorded");
		const text = String(lastCall[0]).trim();
		return JSON.parse(text);
	}

	it("outputList builds `{ data, meta: { count } }` envelope from an array", () => {
		outputList([{ id: 1 }, { id: 2 }]);
		expect(lastEmittedJson()).toEqual({
			data: [{ id: 1 }, { id: 2 }],
			meta: { count: 2 },
		});
	});

	it("outputList rejects extraMeta containing `count` at the type level (DEV-4068 T6 cycle-1)", () => {
		// Type-only test — `extraMeta.count` is `never`, so the literal
		// fails to assign. Defense at the contract level: callers can't
		// pass `count: 999` and have it silently overridden — the type
		// catches the lie before it reaches runtime.
		// @ts-expect-error -- count is excluded from ListExtraMeta
		outputList([{ id: 1 }], { count: 999, query: "x" });
		// Runtime: count is always data.length even if the type were bypassed.
		expect(lastEmittedJson()).toEqual({
			data: [{ id: 1 }],
			meta: { count: 1, query: "x" },
		});
	});

	it("outputList preserves extraMeta keys alongside count", () => {
		outputList([{ id: 1 }, { id: 2 }, { id: 3 }], {
			query: "fix bug",
			team: "DEV",
		});
		expect(lastEmittedJson()).toEqual({
			data: [{ id: 1 }, { id: 2 }, { id: 3 }],
			meta: { count: 3, query: "fix bug", team: "DEV" },
		});
	});

	it("outputList emits an empty list as `{ data: [], meta: { count: 0 } }`", () => {
		outputList([]);
		expect(lastEmittedJson()).toEqual({ data: [], meta: { count: 0 } });
	});

	it("outputSingle passes through unchanged (no envelope wrapping)", () => {
		outputSingle({ id: "DEV-1", title: "issue" });
		expect(lastEmittedJson()).toEqual({ id: "DEV-1", title: "issue" });
	});

	it("outputList is type-parameterized over its element type", () => {
		// Compile-time only: outputList<T> threads T through to
		// CliListEnvelope<T>. Inferring `T` from the array literal lets the
		// resource-specific shape participate in `--fields` / `jq` typing.
		expectTypeOf<typeof outputList<{ id: number }>>()
			.parameter(0)
			.toEqualTypeOf<{ id: number }[]>();
		expectTypeOf<CliListEnvelope<{ id: number }>>().toEqualTypeOf<{
			data: { id: number }[];
			meta: { count: number } & Record<string, unknown>;
		}>();
	});

	it("outputSingle rejects array inputs at the type level (DEV-4068 T6 cycle-1)", () => {
		// Type-only test — passing an array to outputSingle is a foot-gun
		// (caller probably meant outputList). The conditional return type
		// narrows the parameter against `readonly unknown[]` and emits a
		// helpful error string.
		// @ts-expect-error -- arrays must use outputList, not outputSingle
		outputSingle([1, 2, 3]);
		// @ts-expect-error -- typed-array case also rejected
		outputSingle<{ id: number }[]>([{ id: 1 }]);
		// Sanity: scalar / object inputs still accepted.
		outputSingle({ id: 1 });
		outputSingle("a string");
		outputSingle(42);
	});
});

describe("WindowedMeta (DEV-4668)", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetWarnings();
		stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function lastEmittedJson(): unknown {
		const lastCall = stdoutSpy.mock.calls.at(-1);
		if (!lastCall) throw new Error("no stdout writes recorded");
		return JSON.parse(String(lastCall[0]).trim());
	}

	it("outputList accepts WindowedMeta fields as extraMeta and emits them", () => {
		outputList([{ id: 1 }, { id: 2 }], {
			_window: "30d",
			_limit_applied: 100,
			_query: "fix bug",
			_total: 247,
			_fetched: 2,
			truncated: false,
			availability: { status: "complete" },
		} satisfies WindowedMeta);
		expect(lastEmittedJson()).toEqual({
			data: [{ id: 1 }, { id: 2 }],
			meta: {
				count: 2,
				_window: "30d",
				_limit_applied: 100,
				_query: "fix bug",
				_total: 247,
				_fetched: 2,
				truncated: false,
				availability: { status: "complete" },
			},
		});
	});

	it("WindowedMeta fields are all optional — a partial subset is valid", () => {
		// Compile-time + runtime: a command that only knows `_total` and
		// `truncated` populates just those, leaving the rest absent.
		outputList([{ id: 1 }], {
			_total: 9,
			truncated: true,
		} satisfies WindowedMeta);
		expect(lastEmittedJson()).toEqual({
			data: [{ id: 1 }],
			meta: { count: 1, _total: 9, truncated: true },
		});
	});

	it("availability.status is constrained to the documented union", () => {
		expectTypeOf<WindowedMeta["availability"]>().toEqualTypeOf<
			| { status: "complete" | "partial" | "degraded"; detail?: string }
			| undefined
		>();
		// @ts-expect-error -- "unknown" is not a member of the status union
		const bad: WindowedMeta = { availability: { status: "unknown" } };
		void bad;
	});

	it("ListExtraMeta still admits CLI-specific keys alongside WindowedMeta", () => {
		// The open Record<string, unknown> index means a CLI may add its own
		// domain counters (e.g. el-elasticsearch `_total_hits`) next to the
		// generic fields without a type error.
		outputList([{ id: 1 }], {
			_total: 3,
			_total_hits: 3,
			_indices_queried: 2,
		});
		expect(lastEmittedJson()).toEqual({
			data: [{ id: 1 }],
			meta: { count: 1, _total: 3, _total_hits: 3, _indices_queried: 2 },
		});
	});
});
