import { describe, expect, it, vi } from "vitest";
import { applyIpv4Preference, VERBATIM_ENV } from "./network-preference.js";

function makeDeps() {
	return {
		setDefaultResultOrder:
			vi.fn<(order: "ipv4first" | "ipv6first" | "verbatim") => void>(),
		setDefaultAutoSelectFamily: vi.fn<(value: boolean) => void>(),
	};
}

describe("applyIpv4Preference", () => {
	it("prefers IPv4 by default (no opt-out env)", () => {
		const deps = makeDeps();
		const applied = applyIpv4Preference({}, deps);
		expect(applied).toBe(true);
		expect(deps.setDefaultResultOrder).toHaveBeenCalledWith("ipv4first");
		expect(deps.setDefaultAutoSelectFamily).toHaveBeenCalledWith(false);
	});

	it("opts out (and touches nothing) when EL_LINEAR_NETWORK_VERBATIM=1", () => {
		const deps = makeDeps();
		const applied = applyIpv4Preference({ [VERBATIM_ENV]: "1" }, deps);
		expect(applied).toBe(false);
		expect(deps.setDefaultResultOrder).not.toHaveBeenCalled();
		expect(deps.setDefaultAutoSelectFamily).not.toHaveBeenCalled();
	});

	it("treats only the literal '1' as opt-out — other values still prefer IPv4", () => {
		for (const value of ["0", "true", "", "yes", "ipv4first"]) {
			const deps = makeDeps();
			const applied = applyIpv4Preference({ [VERBATIM_ENV]: value }, deps);
			expect(applied).toBe(true);
			expect(deps.setDefaultResultOrder).toHaveBeenCalledWith("ipv4first");
			expect(deps.setDefaultAutoSelectFamily).toHaveBeenCalledWith(false);
		}
	});

	it("applies both levers exactly once (ipv4first alone is insufficient)", () => {
		const deps = makeDeps();
		applyIpv4Preference({}, deps);
		expect(deps.setDefaultResultOrder).toHaveBeenCalledTimes(1);
		expect(deps.setDefaultAutoSelectFamily).toHaveBeenCalledTimes(1);
	});
});
