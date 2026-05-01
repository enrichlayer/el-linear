import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
	let stdoutSpy: ReturnType<typeof vi.spyOn>;
	let stderrSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
		stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("info writes to stdout with newline", () => {
		logger.info("hello world");
		expect(stdoutSpy).toHaveBeenCalledWith("hello world\n");
	});

	it("error writes to stderr with newline", () => {
		logger.error("something broke");
		expect(stderrSpy).toHaveBeenCalledWith("something broke\n");
	});

	it("info does not write to stderr", () => {
		logger.info("test");
		expect(stderrSpy).not.toHaveBeenCalled();
	});

	it("error does not write to stdout", () => {
		logger.error("test");
		expect(stdoutSpy).not.toHaveBeenCalled();
	});
});
