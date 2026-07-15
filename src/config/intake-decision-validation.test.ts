import { afterEach, describe, expect, it, vi } from "vitest";

const mockLoadConfig = vi.fn();
vi.mock("./config.js", () => ({ loadConfig: mockLoadConfig }));

const {
	DEFAULT_INTAKE_SECTION_HEADERS,
	evaluateIntakeDecision,
	formatIntakeDecisionBlock,
	getIntakeDecisionGateConfig,
} = await import("./intake-decision-validation.js");

const VALID = `Background that explains the proposed work.

## Intake decision
- Needed: Yes — support cannot find the current procedure
- Worth doing: Yes — one maintained guide replaces repeated investigation
- Owner: Customer Support internal documentation
- Placement: customer-support/docs-mdx/tools/linear/intake.mdx
- Decision: PROCEED`;

afterEach(() => vi.clearAllMocks());

describe("getIntakeDecisionGateConfig", () => {
	it("is dormant by default", () => {
		mockLoadConfig.mockReturnValue({ validation: { enabled: true } });
		expect(getIntakeDecisionGateConfig()).toEqual({
			mode: "off",
			headers: DEFAULT_INTAKE_SECTION_HEADERS,
		});
	});

	it("resolves an opted-in block and custom header", () => {
		mockLoadConfig.mockReturnValue({
			validation: {
				enabled: true,
				intakeDecisionGate: "block",
				intakeSectionHeaders: ["Triage decision"],
			},
		});
		expect(getIntakeDecisionGateConfig()).toEqual({
			mode: "block",
			headers: ["Triage decision"],
		});
	});

	it("stays off when validation is disabled", () => {
		mockLoadConfig.mockReturnValue({
			validation: { enabled: false, intakeDecisionGate: "block" },
		});
		expect(getIntakeDecisionGateConfig().mode).toBe("off");
	});
});

describe("evaluateIntakeDecision", () => {
	it("accepts the complete ordered decision", () => {
		expect(evaluateIntakeDecision(VALID)).toEqual({
			ok: true,
			header: "Intake decision",
		});
	});

	it("rejects a missing section", () => {
		expect(evaluateIntakeDecision("Background only")).toEqual({
			ok: false,
			reason: "no-section",
		});
	});

	it("rejects a missing placement", () => {
		expect(
			evaluateIntakeDecision(VALID.replace(/^- Placement:.*\n/m, "")),
		).toEqual({
			ok: false,
			reason: "missing-field",
			field: "Placement",
		});
	});

	it("rejects fields in the wrong order", () => {
		const wrongOrder = VALID.replace(
			/- Owner:.*\n- Placement:.*\n/,
			"- Placement: customer-support/docs.mdx\n- Owner: Customer Support docs\n",
		);
		expect(evaluateIntakeDecision(wrongOrder)).toEqual({
			ok: false,
			reason: "out-of-order",
			field: "Placement",
		});
	});

	it("requires explicit reasons for needed and worth doing", () => {
		const noReason = VALID.replace(
			"Needed: Yes — support cannot find the current procedure",
			"Needed: Yes",
		);
		expect(evaluateIntakeDecision(noReason)).toEqual({
			ok: false,
			reason: "invalid-field",
			field: "Needed",
		});
	});

	it("rejects placeholder ownership", () => {
		const placeholder = VALID.replace(
			"Owner: Customer Support internal documentation",
			"Owner: TBD",
		);
		expect(evaluateIntakeDecision(placeholder)).toEqual({
			ok: false,
			reason: "invalid-field",
			field: "Owner",
		});
	});

	it("does not create rejected work", () => {
		const rejected = VALID.replace("Decision: PROCEED", "Decision: REJECT");
		expect(evaluateIntakeDecision(rejected)).toEqual({
			ok: false,
			reason: "not-proceeding",
			decision: "REJECT",
		});
	});
});

describe("formatIntakeDecisionBlock", () => {
	it("renders the canonical order and narrow override", () => {
		const message = formatIntakeDecisionBlock({
			evaluation: { ok: false, reason: "no-section" },
			headers: DEFAULT_INTAKE_SECTION_HEADERS,
		});
		expect(message).toContain("Needed: Yes");
		expect(message).toContain("Worth doing: Yes");
		expect(message).toContain("Owner:");
		expect(message).toContain("Placement:");
		expect(message).toContain("Decision: PROCEED");
		expect(message).toContain("--allow-missing-intake-decision");
	});
});
