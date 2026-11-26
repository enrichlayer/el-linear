import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadConfig = vi.fn();
vi.mock("./config.js", () => ({ loadConfig: () => mockLoadConfig() }));

import { evaluateIntakeDecision } from "./intake-decision-validation.js";
import {
	hasSummarySection,
	isSummaryGateEnabled,
} from "./summary-validation.js";

beforeEach(() => {
	mockLoadConfig.mockReset();
});

describe("isSummaryGateEnabled", () => {
	it.each([
		[{ summaryGate: "warn" }, true],
		[{ enabled: true, summaryGate: "warn" }, true],
		[{ enabled: false, summaryGate: "warn" }, false],
		[{ summaryGate: false }, false],
		[{ summaryGate: "block" }, false],
		[{}, false],
		[undefined, false],
	])("validation %j resolves to %s", (validation, expected) => {
		mockLoadConfig.mockReturnValue({ validation });
		expect(isSummaryGateEnabled()).toBe(expected);
	});
});

describe("hasSummarySection", () => {
	it.each([
		"## Summary\n\nWhat this is about.",
		"Intro.\n\n### summary:\nText",
		"**Summary**\nText",
		"## Summary\n\n### What this is about\nText",
	])("accepts %j", (description) => {
		expect(hasSummarySection(description)).toBe(true);
	});

	it.each([
		"",
		"A summary of the problem, in prose.",
		"## Summary of changes\nText",
		"```markdown\n## Summary\n```",
	])("rejects %j", (description) => {
		expect(hasSummarySection(description)).toBe(false);
	});
});

it("leaves a valid intake decision below the summary readable", () => {
	const description = [
		"## Summary",
		"",
		"What this is about.",
		"",
		"## Intake decision",
		"- Needed: Yes — the current workflow loses requests",
		"- Worth doing: Yes — it costs a few sentences",
		"- Existing work: searched open and closed issues; none found",
		"- Owner: the tools team",
		"- Placement: DEV / tools repository",
		"- Decision: PROCEED",
	].join("\n");
	expect(evaluateIntakeDecision(description)).toMatchObject({ ok: true });
});
