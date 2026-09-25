import { describe, expect, it } from "vitest";
import {
	consentLabelsIn,
	evaluateConsentReceipt,
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
