/**
 * Tests for the repo/profile mismatch hint (DEV-7277). Every decision input is
 * injected, so the trigger/suppression matrix is exercised without git, env, or
 * process state.
 */

import { describe, expect, it } from "vitest";
import { maybeEmitPinMismatchHint, type PinHintDeps } from "./pin-hint.js";
import type { RepoLinearProfile } from "./repo-profile.js";

function run(overrides: Partial<PinHintDeps> & { hasProfileFlag: boolean }) {
	const lines: string[] = [];
	const base: Partial<PinHintDeps> = {
		env: {} as NodeJS.ProcessEnv,
		cwd: "/repo",
		isQuiet: () => false,
		readMarker: () => "work",
		resolveRepoPin: () => null,
		write: (m) => lines.push(m),
	};
	const emitted = maybeEmitPinMismatchHint({ ...base, ...overrides });
	return { emitted, lines };
}

describe("maybeEmitPinMismatchHint — fires", () => {
	it("hints when the marker is set, no pin, no flag, no env", () => {
		const { emitted, lines } = run({ hasProfileFlag: false });
		expect(emitted).toBe(true);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('"work"');
		expect(lines[0]).toContain("profile pin");
		// Single line only — never corrupts stdout, and stays one line.
		expect(lines[0].includes("\n")).toBe(false);
	});
});

describe("maybeEmitPinMismatchHint — suppressed", () => {
	it("stays silent under --profile", () => {
		expect(run({ hasProfileFlag: true }).emitted).toBe(false);
	});

	it("stays silent when $EL_LINEAR_PROFILE is set", () => {
		expect(
			run({
				hasProfileFlag: false,
				env: { EL_LINEAR_PROFILE: "work" } as NodeJS.ProcessEnv,
			}).emitted,
		).toBe(false);
	});

	it("stays silent when the repo already has a pin", () => {
		const pin: RepoLinearProfile = { profile: "forage", source: "repo-file" };
		expect(
			run({ hasProfileFlag: false, resolveRepoPin: () => pin }).emitted,
		).toBe(false);
	});

	it("stays silent on the legacy default (no active-profile marker)", () => {
		expect(run({ hasProfileFlag: false, readMarker: () => null }).emitted).toBe(
			false,
		);
	});

	it("stays silent under --quiet", () => {
		expect(run({ hasProfileFlag: false, isQuiet: () => true }).emitted).toBe(
			false,
		);
	});

	it("stays silent when EL_LINEAR_NO_PIN_HINT opts out", () => {
		expect(
			run({
				hasProfileFlag: false,
				env: { EL_LINEAR_NO_PIN_HINT: "1" } as NodeJS.ProcessEnv,
			}).emitted,
		).toBe(false);
	});

	it("treats a falsy opt-out value (0/false) as NOT opted out", () => {
		expect(
			run({
				hasProfileFlag: false,
				env: { EL_LINEAR_NO_PIN_HINT: "0" } as NodeJS.ProcessEnv,
			}).emitted,
		).toBe(true);
	});
});
