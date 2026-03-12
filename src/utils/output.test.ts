import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAsyncCommand, outputSuccess } from "./output.js";

describe("outputSuccess", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
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

describe("handleAsyncCommand", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("calls the wrapped async function", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = handleAsyncCommand(fn);
    await wrapped("arg1", "arg2");
    expect(fn).toHaveBeenCalledWith("arg1", "arg2");
  });

  it("outputs error JSON and exits on Error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("test failure"));
    const wrapped = handleAsyncCommand(fn);
    await wrapped();
    expect(stderrSpy).toHaveBeenCalledWith(
      `${JSON.stringify({ error: "test failure" }, null, 2)}\n`,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("wraps non-Error throws in Error", async () => {
    const fn = vi.fn().mockRejectedValue("string error");
    const wrapped = handleAsyncCommand(fn);
    await wrapped();
    expect(stderrSpy).toHaveBeenCalledWith(
      `${JSON.stringify({ error: "string error" }, null, 2)}\n`,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
