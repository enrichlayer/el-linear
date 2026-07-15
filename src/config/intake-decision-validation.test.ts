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
- Existing work: No duplicate — searched current intake and issue-creation work
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

	it("rejects a missing existing-work check", () => {
		expect(
			evaluateIntakeDecision(VALID.replace(/^- Existing work:.*\n/m, "")),
		).toEqual({
			ok: false,
			reason: "missing-field",
			field: "Existing work",
		});
	});

	it("rejects fields in the wrong order", () => {
		const wrongOrder = VALID.replace(
			/- Existing work:.*\n- Owner:.*\n/,
			"- Owner: Customer Support docs\n- Existing work: No duplicate — searched docs\n",
		);
		expect(evaluateIntakeDecision(wrongOrder)).toEqual({
			ok: false,
			reason: "out-of-order",
			field: "Owner",
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

	it("rejects placeholder reasons and non-specific owner or placement", () => {
		expect(
			evaluateIntakeDecision(
				VALID.replace(
					"Needed: Yes — support cannot find the current procedure",
					"Needed: Yes — TBD",
				),
			),
		).toEqual({ ok: false, reason: "invalid-field", field: "Needed" });
		expect(
			evaluateIntakeDecision(
				VALID.replace(
					"Owner: Customer Support internal documentation",
					"Owner: Yes",
				),
			),
		).toEqual({ ok: false, reason: "invalid-field", field: "Owner" });
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

	it("rejects a contradictory duplicate decision field", () => {
		expect(evaluateIntakeDecision(`${VALID}\n- Decision: REJECT`)).toEqual({
			ok: false,
			reason: "duplicate-field",
			field: "Decision",
		});
	});

	it("does not treat a fenced template as an operative decision", () => {
		const fenced = `Background only.\n\n## Intake decision\n\`\`\`markdown\n${VALID.split("## Intake decision\n")[1]}\n\`\`\``;
		expect(evaluateIntakeDecision(fenced)).toEqual({
			ok: false,
			reason: "missing-field",
			field: "Needed",
		});
	});

	it.each([
		["tilde fence", "~~~markdown", "~~~"],
		["unclosed backtick fence", "```markdown", ""],
		["six-backtick fence", "``````markdown", "``````"],
	])("does not treat a %s template as operative", (_name, opener, closer) => {
		const fenced = `Background only.\n\n## Intake decision\n${opener}\n${VALID.split("## Intake decision\n")[1]}${closer ? `\n${closer}` : ""}`;
		expect(evaluateIntakeDecision(fenced)).toEqual({
			ok: false,
			reason: "missing-field",
			field: "Needed",
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
		expect(message).toContain("Existing work:");
		expect(message).toContain("Owner:");
		expect(message).toContain("Placement:");
		expect(message).toContain("Decision: PROCEED");
		expect(message).toContain("--allow-missing-intake-decision");
	});
});
