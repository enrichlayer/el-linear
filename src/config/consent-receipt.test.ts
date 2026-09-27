import { describe, expect, it } from "vitest";
import {
	appendConsentReceipt,
	consentLabelsIn,
	evaluateConsentReceipt,
	formatConsentReceipt,
	formatCreateConsentRefusal,
} from "./consent-receipt.js";

function receipt(overrides: Record<string, unknown> = {}): string {
	const body = {
		policyVersion: "intake-policy/v1",
		decision: "automatic-implementation",
		capabilities: ["manual-review", "automatic-implementation"],
		reason: "Maintainer consented to unattended authoring",
		provenance: {
			source: "issue-triage",
			actor: "Test Person",
			issue: "DEV-1",
			repo: "acme/tools",
		},
		...overrides,
	};
	return `<!-- el-intake-decision:v1 ${JSON.stringify(body)} -->`;
}

describe("consentLabelsIn", () => {
	it("matches case-insensitively", () => {
		expect(consentLabelsIn(["Bug", "BOT"], ["bot"])).toEqual(["BOT"]);
		expect(consentLabelsIn(["bug"], ["bot"])).toEqual([]);
	});
});

describe("evaluateConsentReceipt", () => {
	it("accepts one valid receipt for the issue", () => {
		expect(evaluateConsentReceipt(`Body\n\n${receipt()}`, "DEV-1")).toEqual({
			ok: true,
		});
	});

	it("accepts a receipt read back with Linear's markdown escapes", () => {
		const escaped = receipt().replace("[", "\\[").replace("]", "\\]");
		expect(evaluateConsentReceipt(escaped, "DEV-1")).toEqual({ ok: true });
	});

	it("names a missing receipt", () => {
		const result = evaluateConsentReceipt(
			"## Intake decision\n- Decision: PROCEED",
			"DEV-1",
		);
		expect(result).toEqual({
			ok: false,
			problem: "the description has no el-intake-decision:v1 receipt",
		});
	});

	it("refuses ambiguous receipts", () => {
		expect(
			evaluateConsentReceipt(`${receipt()}\n${receipt()}`, "DEV-1").ok,
		).toBe(false);
	});

	it("refuses a receipt copied from another issue", () => {
		const result = evaluateConsentReceipt(receipt(), "DEV-2");
		expect(result).toEqual({
			ok: false,
			problem: "the receipt names DEV-1, not DEV-2",
		});
	});

	it.each([
		[
			"review-only decision",
			{ decision: "review-only", capabilities: ["manual-review"] },
		],
		["missing automatic capability", { capabilities: ["manual-review"] }],
		["unknown policy", { policyVersion: "intake-policy/v2" }],
		["empty reason", { reason: " " }],
		[
			"bad provenance source",
			{
				provenance: { source: "vibes", actor: "a", issue: "DEV-1", repo: "r" },
			},
		],
	])("refuses a receipt with %s", (_name, overrides) => {
		expect(evaluateConsentReceipt(receipt(overrides), "DEV-1").ok).toBe(false);
	});

	it("refuses a receipt that is not JSON", () => {
		expect(
			evaluateConsentReceipt("<!-- el-intake-decision:v1 {nope} -->", "DEV-1"),
		).toEqual({ ok: false, problem: "the receipt is not valid JSON" });
	});
});

describe("formatCreateConsentRefusal", () => {
	it("names the label, the missing receipt and the update route", () => {
		const message = formatCreateConsentRefusal(["bot"]);
		expect(message).toContain('"bot"');
		expect(message).toContain("el-intake-decision:v1");
		expect(message).toContain("el-linear issues update <ID> --labels bot");
	});
});

describe("formatConsentReceipt (DEV-10455)", () => {
	const fields = {
		repo: "acme/tools",
		reason: "rubric consent",
		actor: "Test Person",
		issue: "DEV-7",
	};

	it("writes a receipt the gate accepts for that issue only", () => {
		const description = appendConsentReceipt(
			"Body\n",
			formatConsentReceipt(fields),
		);
		expect(description.startsWith("Body\n\n<!-- el-intake-decision:v1 ")).toBe(
			true,
		);
		expect(evaluateConsentReceipt(description, "DEV-7")).toEqual({ ok: true });
		expect(evaluateConsentReceipt(description, "DEV-8").ok).toBe(false);
	});

	it("still reads back after Linear escapes the brackets", () => {
		const escaped = formatConsentReceipt(fields)
			.replace("[", "\\[")
			.replace("]", "\\]");
		expect(evaluateConsentReceipt(escaped, "DEV-7")).toEqual({ ok: true });
	});

	it("keeps quotes in the reason as valid JSON", () => {
		const receipt = formatConsentReceipt({ ...fields, reason: 'say "yes"' });
		expect(evaluateConsentReceipt(receipt, "DEV-7")).toEqual({ ok: true });
	});

	it("uses the receipt alone for an empty description", () => {
		const receipt = formatConsentReceipt(fields);
		expect(appendConsentReceipt("  ", receipt)).toBe(receipt);
	});
});
