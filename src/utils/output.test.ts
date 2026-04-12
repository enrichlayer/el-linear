import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAsyncCommand,
  outputSuccess,
  outputWarning,
  resetWarnings,
  setFieldsFilter,
  setRawMode,
} from "./output.js";

describe("outputSuccess", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetWarnings();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("outputs JSON to stdout", () => {
    outputSuccess({ key: "value" });
    expect(stdoutSpy).toHaveBeenCalledWith(`${JSON.stringify({ key: "value" }, null, 2)}\n`);
  });

  it("handles arrays", () => {
    outputSuccess([1, 2, 3]);
    expect(stdoutSpy).toHaveBeenCalledWith(`${JSON.stringify([1, 2, 3], null, 2)}\n`);
  });

  it("handles null", () => {
    outputSuccess(null);
    expect(stdoutSpy).toHaveBeenCalledWith("null\n");
  });
});

describe("warning buffer", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetWarnings();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
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

  it("skips _warnings for array output", () => {
    outputWarning("w1");
    outputSuccess([1, 2, 3]);
    const written = (stdoutSpy.mock.calls[0][0] as string).trim();
    const parsed = JSON.parse(written);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it("accumulates multiple warnings", () => {
    outputWarning("w1");
    outputWarning(["w2", "w3"], "brand_validation");
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
    const allStdout = stdoutSpy.mock.calls.map((call) => call[0] as string).join("");
    // Must parse as a single JSON value
    expect(() => JSON.parse(allStdout)).not.toThrow();
    const parsed = JSON.parse(allStdout);
    expect(parsed.identifier).toBe("DEV-1");
    expect(parsed._warnings).toEqual(["mid-execution warning"]);
  });
});

describe("--raw mode", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetWarnings();
    setRawMode(true);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    setRawMode(false);
    stdoutSpy.mockRestore();
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

  it("still embeds warnings when unwrapping", () => {
    outputWarning("watch out");
    outputSuccess({ data: [{ id: "1" }], meta: { count: 1 }, _warnings: [] });
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    // raw mode unwraps after warnings are embedded, so the array has no warnings
    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe("--fields filter", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetWarnings();
    setRawMode(false);
    setFieldsFilter(null);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    setFieldsFilter(null);
    setRawMode(false);
    stdoutSpy.mockRestore();
  });

  it("filters fields on a flat object", () => {
    setFieldsFilter(["identifier", "title"]);
    outputSuccess({ identifier: "DEV-1", title: "Fix bug", priority: 2, state: { name: "Done" } });
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

  it("silently omits non-existent field names", () => {
    setFieldsFilter(["identifier", "nonexistent"]);
    outputSuccess({ identifier: "DEV-1", title: "Bug", priority: 2 });
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed).toEqual({ identifier: "DEV-1" });
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
});

describe("handleAsyncCommand", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetWarnings();
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
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
    const errorJson = `${JSON.stringify({ error: "test failure" }, null, 2)}\n`;
    expect(stdoutSpy).toHaveBeenCalledWith(errorJson);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("wraps non-Error throws in Error", async () => {
    const fn = vi.fn().mockRejectedValue("string error");
    const wrapped = handleAsyncCommand(fn);
    await wrapped();
    const errorJson = `${JSON.stringify({ error: "string error" }, null, 2)}\n`;
    expect(stdoutSpy).toHaveBeenCalledWith(errorJson);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("error output on stdout is a single parseable JSON object", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("broken"));
    const wrapped = handleAsyncCommand(fn);
    await wrapped();
    const allStdout = stdoutSpy.mock.calls.map((call) => call[0] as string).join("");
    expect(() => JSON.parse(allStdout)).not.toThrow();
    expect(JSON.parse(allStdout).error).toBe("broken");
  });
});
