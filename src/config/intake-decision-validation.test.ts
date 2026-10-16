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
			problem: "no-judgment",
			value: "Yes",
		});
	});

	// The accepted separators, pinned as a set so they stay deliberate rather
	// than incidental to one regex edit. Both tests below iterate THIS list, so
	// the accept side and the reject side cannot drift apart: adding a separator
	// here automatically requires it to reject a reason-free verdict too.
	const VERDICT_SEPARATORS = ["—", "–", "-", ".", ":", ";", ",", " because"];

	it("accepts any ordinary separator between the verdict and its reason", () => {
		// The gate's purpose is an explicit verdict plus a reason; the punctuation
		// joining them carries no meaning.
		for (const separator of VERDICT_SEPARATORS) {
			const description = VALID.replace(
				"Needed: Yes — support cannot find the current procedure",
				`Needed: Yes${separator} support cannot find the current procedure`,
			);
			expect(evaluateIntakeDecision(description)).toEqual({
				ok: true,
				header: "Intake decision",
			});
		}
	});

	it("still rejects a bare verdict whatever separator trails it", () => {
		// The loosened separator set must not open a path to a verdict with no
		// reason — that is the single case the gate exists for. Covers a bare
		// "Yes" plus every separator with nothing after it.
		for (const bare of ["Yes", ...VERDICT_SEPARATORS.map((s) => `Yes${s}`)]) {
			const description = VALID.replace(
				"Needed: Yes — support cannot find the current procedure",
				`Needed: ${bare}`,
			);
			const result = evaluateIntakeDecision(description);
			expect(result.ok).toBe(false);
			expect(result).toMatchObject({
				reason: "invalid-field",
				field: "Needed",
			});
		}
	});

	it("rejects placeholder reasons and non-specific owner or placement", () => {
		expect(
			evaluateIntakeDecision(
				VALID.replace(
					"Needed: Yes — support cannot find the current procedure",
					"Needed: Yes — TBD",
				),
			),
		).toEqual({
			ok: false,
			reason: "invalid-field",
			field: "Needed",
			problem: "placeholder-reason",
			value: "Yes — TBD",
		});
		expect(
			evaluateIntakeDecision(
				VALID.replace(
					"Owner: Customer Support internal documentation",
					"Owner: Yes",
				),
			),
		).toEqual({
			ok: false,
			reason: "invalid-field",
			field: "Owner",
			problem: "non-specific",
			value: "Yes",
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
			problem: "placeholder",
			value: "TBD",
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

	it.each(["PROCEED", "PROCEED.", "PROCEED!", "PROCEED;"])(
		"accepts the terminal decision %s",
		(decision) => {
			expect(
				evaluateIntakeDecision(
					VALID.replace("Decision: PROCEED", `Decision: ${decision}`),
				),
			).toEqual({ ok: true, header: "Intake decision" });
		},
	);

	it.each(["PROCEED if approved", "PROCEED later", "PROCEED,"])(
		"rejects the expanded or non-terminal decision %s",
		(decision) => {
			expect(
				evaluateIntakeDecision(
					VALID.replace("Decision: PROCEED", `Decision: ${decision}`),
				),
			).toEqual({
				ok: false,
				reason: "not-proceeding",
				decision,
			});
		},
	);

	it("does not erase literal underscores to manufacture a PROCEED decision", () => {
		const misspelled = VALID.replace("Decision: PROCEED", "Decision: PRO_CEED");
		expect(evaluateIntakeDecision(misspelled)).toEqual({
			ok: false,
			reason: "not-proceeding",
			decision: "PRO_CEED",
		});
	});

	it("still accepts paired inline emphasis around a semantic token", () => {
		const emphasized = VALID.replace(
			"Needed: Yes — support",
			"Needed: **Yes** — support",
		);
		expect(evaluateIntakeDecision(emphasized)).toEqual({
			ok: true,
			header: "Intake decision",
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
		["tilde fence with backticks in its info string", "~~~```markdown", "~~~"],
		["backtick fence with tildes in its info string", "```~~~markdown", "```"],
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

// DEV-7074: a well-formed decision block must parse whatever markdown the
// author actually typed, and a field that genuinely fails must be diagnosed as
// the failure it is — formatting or content, never one reported as the other.
describe("evaluateIntakeDecision — label formatting tolerance (DEV-7074)", () => {
	const FIELDS: ReadonlyArray<readonly [string, string]> = [
		["Needed", "Yes — support cannot find the current procedure"],
		[
			"Worth doing",
			"Yes — one maintained guide replaces repeated investigation",
		],
		[
			"Existing work",
			"No duplicate — searched current intake and issue-creation work",
		],
		["Owner", "Customer Support internal documentation"],
		["Placement", "customer-support/docs-mdx/tools/linear/intake.mdx"],
		["Decision", "PROCEED"],
	];

	function block(
		render: (label: string, value: string, index: number) => string,
	): string {
		const body = FIELDS.map(([label, value], index) =>
			render(label, value, index),
		).join("\n");
		return `Background that explains the proposed work.\n\n## Intake decision\n${body}`;
	}

	it.each([
		["plain labels", (l: string, v: string) => `- ${l}: ${v}`],
		[
			"bolded labels with the colon inside the emphasis",
			(l: string, v: string) => `- **${l}:** ${v}`,
		],
		[
			"bolded labels with the colon outside the emphasis",
			(l: string, v: string) => `- **${l}**: ${v}`,
		],
		[
			"bolded labels under an asterisk list marker",
			(l: string, v: string) => `* **${l}:** ${v}`,
		],
		["italic labels", (l: string, v: string) => `- *${l}*: ${v}`],
		[
			"underscore-emphasized labels",
			(l: string, v: string) => `- __${l}:__ ${v}`,
		],
		["no list marker at all", (l: string, v: string) => `${l}: ${v}`],
		[
			"numbered list markers",
			(l: string, v: string, i: number) => `${i + 1}. ${l}: ${v}`,
		],
		[
			"labels mixed plain and bolded",
			(l: string, v: string, i: number) =>
				i % 2 === 0 ? `- ${l}: ${v}` : `* **${l}:** ${v}`,
		],
		["bolded values", (l: string, v: string) => `- ${l}: **${v}**`],
	])("accepts %s", (_name, render) => {
		expect(evaluateIntakeDecision(block(render))).toEqual({
			ok: true,
			header: "Intake decision",
		});
	});

	it("accepts the bolded block that DEV-7074 reported as rejected", () => {
		const reported = `## Intake decision

* **Needed:** Yes — the intake-decision gate rejects a well-formed decision block for formatting reasons
* **Worth doing:** Yes — the gate fires on every issue create
* **Existing work:** Searched "intake decision gate" including closed; DEV-6163 built the gate
* **Owner:** DEV — el-linear
* **Placement:** Team DEV, project left unset for triage
* **Decision:** PROCEED`;
		expect(evaluateIntakeDecision(reported)).toEqual({
			ok: true,
			header: "Intake decision",
		});
	});

	it("reports an absent field as absent, not as empty content", () => {
		const evaluation = evaluateIntakeDecision(
			block((l, v) => `- ${l}: ${v}`).replace(/^- Owner:.*\n/m, ""),
		);
		expect(evaluation).toEqual({
			ok: false,
			reason: "missing-field",
			field: "Owner",
		});
		const message = formatIntakeDecisionBlock({
			evaluation: evaluation as Exclude<typeof evaluation, { ok: true }>,
			headers: DEFAULT_INTAKE_SECTION_HEADERS,
		});
		expect(message).toContain('missing the "Owner" field');
		expect(message).toContain("no line records it");
	});

	it("reports an unreadable field line as a formatting mismatch", () => {
		const evaluation = evaluateIntakeDecision(
			block((l, v) => `- ${l}: ${v}`).replace(
				"- Owner: Customer Support internal documentation",
				"- Owner — Customer Support internal documentation",
			),
		);
		expect(evaluation).toEqual({
			ok: false,
			reason: "unparsed-field",
			field: "Owner",
			line: "- Owner — Customer Support internal documentation",
		});
		const message = formatIntakeDecisionBlock({
			evaluation: evaluation as Exclude<typeof evaluation, { ok: true }>,
			headers: DEFAULT_INTAKE_SECTION_HEADERS,
		});
		expect(message).toContain("formatting mismatch, not missing content");
		expect(message).toContain("- Owner — Customer Support internal");
		expect(message).not.toContain("is empty");
	});

	it.each([
		["a plain label", "- Owner:"],
		["a bolded label", "* **Owner:**"],
	])("reports empty content under %s as empty", (_name, replacement) => {
		const evaluation = evaluateIntakeDecision(
			block((l, v) => `- ${l}: ${v}`).replace(
				"- Owner: Customer Support internal documentation",
				replacement,
			),
		);
		expect(evaluation).toEqual({
			ok: false,
			reason: "invalid-field",
			field: "Owner",
			problem: "empty",
			value: "",
		});
		const message = formatIntakeDecisionBlock({
			evaluation: evaluation as Exclude<typeof evaluation, { ok: true }>,
			headers: DEFAULT_INTAKE_SECTION_HEADERS,
		});
		expect(message).toContain(
			'The intake field "Owner" parsed, but has no content after the label.',
		);
	});

	it("quotes a present-but-unjudged value instead of calling it empty", () => {
		const evaluation = evaluateIntakeDecision(
			block((l, v) => `- **${l}:** ${v}`).replace(
				"Yes — support cannot find the current procedure",
				"probably, we should discuss it",
			),
		);
		expect(evaluation).toEqual({
			ok: false,
			reason: "invalid-field",
			field: "Needed",
			problem: "no-judgment",
			value: "probably, we should discuss it",
		});
		const message = formatIntakeDecisionBlock({
			evaluation: evaluation as Exclude<typeof evaluation, { ok: true }>,
			headers: DEFAULT_INTAKE_SECTION_HEADERS,
		});
		expect(message).toContain('reads "probably, we should discuss it"');
		// Names the actual defect (no reason) rather than prescribing one dash —
		// the message must not imply the em dash is the only accepted separator.
		expect(message).toContain("the verdict is there, but no reason follows it");
		expect(message).toContain("any ordinary separator works");
	});

	it("still rejects a non-PROCEED decision written with a bolded label", () => {
		expect(
			evaluateIntakeDecision(
				block((l, v) => `* **${l}:** ${v}`).replace(
					"**Decision:** PROCEED",
					"**Decision:** REJECT",
				),
			),
		).toEqual({ ok: false, reason: "not-proceeding", decision: "REJECT" });
	});

	it("still rejects a bolded duplicate field", () => {
		expect(
			evaluateIntakeDecision(
				`${block((l, v) => `- ${l}: ${v}`)}\n* **Decision:** REJECT`,
			),
		).toEqual({ ok: false, reason: "duplicate-field", field: "Decision" });
	});

	it("still rejects bolded fields written out of order", () => {
		const swapped = block((l, v) => `* **${l}:** ${v}`).replace(
			/\* \*\*Existing work:\*\*.*\n\* \*\*Owner:\*\*.*\n/,
			"* **Owner:** Customer Support docs\n* **Existing work:** No duplicate — searched docs\n",
		);
		expect(evaluateIntakeDecision(swapped)).toEqual({
			ok: false,
			reason: "out-of-order",
			field: "Owner",
		});
	});

	it("does not treat prose that merely mentions a label as a field", () => {
		const prose = `## Intake decision\nThe owner question: we discussed it at length.\n${FIELDS.map(
			([label, value]) => `- ${label}: ${value}`,
		).join("\n")}`;
		expect(evaluateIntakeDecision(prose)).toEqual({
			ok: true,
			header: "Intake decision",
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
