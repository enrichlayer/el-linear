import { afterEach, describe, expect, it, vi } from "vitest";

// loadConfig is the only external dependency of getGoalCompletionGateConfig;
// mock it so the opt-in resolution can be exercised across config shapes.
// extractField is pure and stays real — the header-form coverage below is the
// point of these tests.
const mockLoadConfig = vi.fn();
vi.mock("./config.js", () => ({
	loadConfig: mockLoadConfig,
}));

const {
	DEFAULT_GOAL_SECTION_HEADERS,
	evaluateGoalCompletion,
	formatGoalCompletionBlock,
	getGoalCompletionGateConfig,
	hasFalsifiableCriterion,
} = await import("./goal-completion-validation.js");

afterEach(() => {
	vi.clearAllMocks();
});

describe("getGoalCompletionGateConfig", () => {
	it("is dormant by default (opt-in) even when validation is enabled", () => {
		mockLoadConfig.mockReturnValue({ validation: { enabled: true } });
		expect(getGoalCompletionGateConfig()).toEqual({
			mode: "off",
			headers: DEFAULT_GOAL_SECTION_HEADERS,
		});
	});

	it("is dormant when no validation block is present", () => {
		mockLoadConfig.mockReturnValue({});
		expect(getGoalCompletionGateConfig().mode).toBe("off");
	});

	it("is dormant when goalCompletionGate is explicitly false", () => {
		mockLoadConfig.mockReturnValue({
			validation: { enabled: true, goalCompletionGate: false },
		});
		expect(getGoalCompletionGateConfig().mode).toBe("off");
	});

	it("resolves warn mode", () => {
		mockLoadConfig.mockReturnValue({
			validation: { enabled: true, goalCompletionGate: "warn" },
		});
		expect(getGoalCompletionGateConfig().mode).toBe("warn");
	});

	it("resolves block mode", () => {
		mockLoadConfig.mockReturnValue({
			validation: { enabled: true, goalCompletionGate: "block" },
		});
		expect(getGoalCompletionGateConfig().mode).toBe("block");
	});

	it("stays off when validation.enabled is false even if the gate is set", () => {
		mockLoadConfig.mockReturnValue({
			validation: { enabled: false, goalCompletionGate: "block" },
		});
		expect(getGoalCompletionGateConfig().mode).toBe("off");
	});

	it("treats an unrecognized mode value as off (misconfig fails dormant)", () => {
		mockLoadConfig.mockReturnValue({
			validation: { enabled: true, goalCompletionGate: "true" },
		});
		expect(getGoalCompletionGateConfig().mode).toBe("off");
	});

	it("uses a configured goalSectionHeaders override", () => {
		mockLoadConfig.mockReturnValue({
			validation: {
				enabled: true,
				goalCompletionGate: "warn",
				goalSectionHeaders: ["Definition of done"],
			},
		});
		expect(getGoalCompletionGateConfig().headers).toEqual([
			"Definition of done",
		]);
	});

	it("falls back to the default headers on an empty override", () => {
		mockLoadConfig.mockReturnValue({
			validation: {
				enabled: true,
				goalCompletionGate: "warn",
				goalSectionHeaders: [],
			},
		});
		expect(getGoalCompletionGateConfig().headers).toEqual(
			DEFAULT_GOAL_SECTION_HEADERS,
		);
	});
});

describe("hasFalsifiableCriterion", () => {
	it("accepts a command in inline code", () => {
		expect(hasFalsifiableCriterion("- [ ] `pnpm test` exits cleanly")).toBe(
			true,
		);
	});

	it("accepts a fenced code block", () => {
		expect(
			hasFalsifiableCriterion("```bash\nel-linear doctor\n```\nruns clean"),
		).toBe(true);
	});

	it("accepts a threshold percentage", () => {
		expect(hasFalsifiableCriterion("- Override rate drops below 20%")).toBe(
			true,
		);
	});

	it("accepts a plain number threshold", () => {
		expect(hasFalsifiableCriterion("- p95 latency stays under 200ms")).toBe(
			true,
		);
	});

	it("accepts a named artifact path", () => {
		expect(
			hasFalsifiableCriterion("- docs/telemetry.md documents the new field"),
		).toBe(true);
	});

	it("accepts a bare filename with a code extension", () => {
		expect(hasFalsifiableCriterion("- The report lands in summary.json")).toBe(
			true,
		);
	});

	it("accepts an exit-code assertion without digits", () => {
		expect(
			hasFalsifiableCriterion("- The command exits non-zero on a bad ref"),
		).toBe(true);
	});

	it("accepts a tests-pass status assertion", () => {
		expect(
			hasFalsifiableCriterion("- All new tests pass and CI is green"),
		).toBe(true);
	});

	it('accepts a "verifiable via X" phrase', () => {
		expect(
			hasFalsifiableCriterion("- Faster startup, verifiable via the profiler"),
		).toBe(true);
	});

	it("rejects a section of bare quality adjectives", () => {
		expect(
			hasFalsifiableCriterion(
				"- Performance is improved\n- The code is cleaner and better\n- Everything feels faster",
			),
		).toBe(false);
	});

	it("rejects vague checklist items (a checkbox alone is not a predicate)", () => {
		expect(
			hasFalsifiableCriterion("- [ ] Improved developer experience overall"),
		).toBe(false);
	});

	it("rejects an empty section (a bare header is not a criterion)", () => {
		expect(hasFalsifiableCriterion("")).toBe(false);
		expect(hasFalsifiableCriterion("   \n  ")).toBe(false);
	});
});

describe("evaluateGoalCompletion", () => {
	const falsifiable = "- [ ] `pnpm test` reports 0 failures";
	const vague = "- Things are generally better and cleaner";

	it("passes a ## Done when section with a falsifiable criterion", () => {
		const result = evaluateGoalCompletion(
			`Context first.\n\n## Done when\n\n${falsifiable}\n`,
		);
		expect(result).toEqual({ ok: true, header: "Done when" });
	});

	it("passes a ### Acceptance criteria section", () => {
		const result = evaluateGoalCompletion(
			`Intro.\n\n### Acceptance criteria\n\n${falsifiable}\n`,
		);
		expect(result).toEqual({ ok: true, header: "Acceptance criteria" });
	});

	it("passes a **Success criteria** bold pseudo-header section", () => {
		const result = evaluateGoalCompletion(
			`Intro.\n\n**Success criteria**\n\n${falsifiable}\n`,
		);
		expect(result).toEqual({ ok: true, header: "Success criteria" });
	});

	it("passes a bold pseudo-header with a trailing colon (**Done when:**)", () => {
		const result = evaluateGoalCompletion(
			`Intro.\n\n**Done when:**\n\n${falsifiable}\n`,
		);
		expect(result).toEqual({ ok: true, header: "Done when" });
	});

	it("matches headers case-insensitively", () => {
		const result = evaluateGoalCompletion(
			`Intro.\n\n## DONE WHEN\n\n${falsifiable}\n`,
		);
		expect(result).toEqual({ ok: true, header: "Done when" });
	});

	it('accepts the hyphenated "Done-when" variant', () => {
		const result = evaluateGoalCompletion(
			`Intro.\n\n## Done-when\n\n${falsifiable}\n`,
		);
		expect(result).toEqual({ ok: true, header: "Done-when" });
	});

	it("only judges the goal section — falsifiable prose elsewhere doesn't rescue it", () => {
		const result = evaluateGoalCompletion(
			`Run \`pnpm test\` for context (100% relevant).\n\n## Done when\n\n${vague}\n`,
		);
		expect(result).toEqual({
			ok: false,
			reason: "vague-section",
			header: "Done when",
		});
	});

	it("flags a vague-adjectives-only section with the matched header", () => {
		const result = evaluateGoalCompletion(
			`Intro.\n\n## Acceptance criteria\n\n${vague}\n`,
		);
		expect(result).toEqual({
			ok: false,
			reason: "vague-section",
			header: "Acceptance criteria",
		});
	});

	it("flags a missing section", () => {
		expect(
			evaluateGoalCompletion("Just some context with no goal section at all."),
		).toEqual({ ok: false, reason: "no-section" });
	});

	it("flags an empty description", () => {
		expect(evaluateGoalCompletion("")).toEqual({
			ok: false,
			reason: "no-section",
		});
	});

	it("flags a bare header with an empty section body", () => {
		expect(evaluateGoalCompletion("Intro.\n\n## Done when\n")).toEqual({
			ok: false,
			reason: "vague-section",
			header: "Done when",
		});
	});

	it("honors a custom header list", () => {
		const result = evaluateGoalCompletion(
			`Intro.\n\n## Definition of done\n\n${falsifiable}\n`,
			["Definition of done"],
		);
		expect(result).toEqual({ ok: true, header: "Definition of done" });
	});
});

describe("formatGoalCompletionBlock", () => {
	it("lists the accepted headers when no section was found", () => {
		const message = formatGoalCompletionBlock({
			reason: "no-section",
			headers: DEFAULT_GOAL_SECTION_HEADERS,
		});
		expect(message).toContain("no goal-completion section");
		expect(message).toContain("Done when");
		expect(message).toContain("Acceptance criteria");
		expect(message).toContain("--allow-vague-goal");
	});

	it("names the matched section when it is present but vague", () => {
		const message = formatGoalCompletionBlock({
			reason: "vague-section",
			headers: DEFAULT_GOAL_SECTION_HEADERS,
			sectionHeader: "Done when",
		});
		expect(message).toContain('"Done when" section');
		expect(message).toContain("no falsifiable criterion");
		expect(message).toContain("--allow-vague-goal");
	});
});
