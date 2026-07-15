/**
 * DEV-3799: smoke test for the `@enrichlayer/el-linear/output` secondary
 * entry point. Catches accidental drift of the stable surface — a renamed
 * or removed export is a breaking change for tools-repo CLIs that depend
 * on this module, so we lock in the contract here rather than only at
 * the implementation site.
 *
 * This test does NOT re-verify the behaviour of the underlying functions
 * (that lives in `utils/output.test.ts`). It only asserts the barrel
 * exposes the contract.
 */

import { describe, expect, it } from "vitest";

import * as output from "./output.js";

describe("@enrichlayer/el-linear/output barrel", () => {
	it("exposes the stable function surface", () => {
		const fns = [
			["getOutputFormat", output.getOutputFormat],
			["handleAsyncCommand", output.handleAsyncCommand],
			["outputList", output.outputList],
			["outputSingle", output.outputSingle],
			["outputSuccess", output.outputSuccess],
			["outputWarning", output.outputWarning],
			["resetWarnings", output.resetWarnings],
			["setFieldsFilter", output.setFieldsFilter],
			["setJqFilter", output.setJqFilter],
			["setOutputFormat", output.setOutputFormat],
			["setRawMode", output.setRawMode],
			["warnIfTruncated", output.warnIfTruncated],
		];
		for (const [name, fn] of fns) {
			expect(typeof fn, `expected ${name} to be a function`).toBe("function");
		}
	});

	it("setters and getters round-trip the format state", () => {
		// State is module-singleton. Save → mutate → restore so this test
		// doesn't leak format=summary into sibling tests run in the same
		// worker.
		const initial = output.getOutputFormat();
		try {
			output.setOutputFormat("summary");
			expect(output.getOutputFormat()).toBe("summary");
			output.setOutputFormat("json");
			expect(output.getOutputFormat()).toBe("json");
		} finally {
			output.setOutputFormat(initial);
		}
	});

	it("re-exports the same singletons as the underlying utils/output module", async () => {
		// Identity check, not value-equality: if the barrel ever reaches
		// for a copy of the module (e.g. a future refactor that wraps the
		// setters), the shared singleton state breaks and `--jq` flags
		// set via one path would be invisible to the other. Locking the
		// identity here makes that regression impossible to merge silently.
		const utilsModule = await import("./utils/output.js");
		expect(output.setJqFilter).toBe(utilsModule.setJqFilter);
		expect(output.setFieldsFilter).toBe(utilsModule.setFieldsFilter);
		expect(output.setRawMode).toBe(utilsModule.setRawMode);
		expect(output.outputSuccess).toBe(utilsModule.outputSuccess);
		expect(output.handleAsyncCommand).toBe(utilsModule.handleAsyncCommand);
	});
});
