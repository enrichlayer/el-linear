import { afterEach, describe, expect, it, vi } from "vitest";

// loadConfig is the only external dependency of getSopLabelGateConfig; mock it
// so the opt-in resolution can be exercised across config shapes.
const mockLoadConfig = vi.fn();
vi.mock("./config.js", () => ({
	loadConfig: mockLoadConfig,
}));

const {
	DEFAULT_SOP_LABELS,
	formatSopParentBlock,
	getSopLabelGateConfig,
	hasSopLabel,
} = await import("./sop-label-validation.js");

afterEach(() => {
	vi.clearAllMocks();
});

describe("hasSopLabel", () => {
	it("matches case-insensitively", () => {
		expect(hasSopLabel(["sop"], ["SOP"])).toBe(true);
		expect(hasSopLabel(["SOP"], ["sop"])).toBe(true);
		expect(hasSopLabel(["Feature", "SOP"], DEFAULT_SOP_LABELS)).toBe(true);
	});

	it("returns false when no label matches", () => {
		expect(hasSopLabel(["feature", "backend"], ["SOP"])).toBe(false);
	});

	it("returns false for an empty label set", () => {
		expect(hasSopLabel([], ["SOP"])).toBe(false);
	});

	it("honors a custom SOP label list", () => {
		expect(hasSopLabel(["Playbook"], ["SOP", "Playbook"])).toBe(true);
		expect(hasSopLabel(["Playbook"], ["SOP"])).toBe(false);
	});
});

describe("getSopLabelGateConfig", () => {
	it("is dormant by default (opt-in) even when validation is enabled", () => {
		mockLoadConfig.mockReturnValue({ validation: { enabled: true } });
		expect(getSopLabelGateConfig()).toEqual({
			enabled: false,
			sopLabels: DEFAULT_SOP_LABELS,
		});
	});

	it("is dormant when no validation block is present", () => {
		mockLoadConfig.mockReturnValue({});
		expect(getSopLabelGateConfig().enabled).toBe(false);
	});

	it("enables only when sopLabelParentGate is explicitly true", () => {
		mockLoadConfig.mockReturnValue({
			validation: { enabled: true, sopLabelParentGate: true },
		});
		expect(getSopLabelGateConfig()).toEqual({
			enabled: true,
			sopLabels: DEFAULT_SOP_LABELS,
		});
	});

	it("stays off when validation.enabled is false even if the gate flag is true", () => {
		mockLoadConfig.mockReturnValue({
			validation: { enabled: false, sopLabelParentGate: true },
		});
		expect(getSopLabelGateConfig().enabled).toBe(false);
	});

	it("uses a configured sopLabels override", () => {
		mockLoadConfig.mockReturnValue({
			validation: {
				enabled: true,
				sopLabelParentGate: true,
				sopLabels: ["SOP", "Runbook"],
			},
		});
		expect(getSopLabelGateConfig().sopLabels).toEqual(["SOP", "Runbook"]);
	});

	it("falls back to the default when sopLabels is empty", () => {
		mockLoadConfig.mockReturnValue({
			validation: {
				enabled: true,
				sopLabelParentGate: true,
				sopLabels: [],
			},
		});
		expect(getSopLabelGateConfig().sopLabels).toEqual(DEFAULT_SOP_LABELS);
	});
});

describe("formatSopParentBlock", () => {
	it("names the rule and the escape hatch for the no-parent case", () => {
		const block = formatSopParentBlock({
			sopLabels: ["SOP"],
			reason: "no-parent",
			parentRefs: [],
		});
		expect(block).toContain("must point at a parent SOP");
		expect(block).toContain("has no --parent or --related-to");
		expect(block).toContain("--allow-unparented-sop");
	});

	it("lists the offending refs for the non-sop-parent case", () => {
		const block = formatSopParentBlock({
			sopLabels: ["SOP"],
			reason: "non-sop-parent",
			parentRefs: ["DEV-100", "DEV-200"],
		});
		expect(block).toContain("DEV-100, DEV-200");
		expect(block).toContain("carry an SOP label");
		expect(block).toContain("--allow-unparented-sop");
	});
});
