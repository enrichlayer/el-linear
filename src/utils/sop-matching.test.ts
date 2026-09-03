import { describe, expect, it } from "vitest";
import {
	appendSopMatchesToDoneWhen,
	extractSopChecklist,
	matchSops,
	mergeSopRelations,
	parseSopCatalogOutput,
	publishedSopUrl,
	type SopCatalog,
	type SopMatch,
} from "./sop-matching.js";

const catalog: SopCatalog = {
	sops: [
		{
			name: "sop-mr-review.mdx",
			title: "SOP: MR Review",
			path: "./sop-mr-review.mdx",
			description: "Review a merge request with the standard review flow.",
		},
	],
	availability: {
		status: "ok",
		catalogPath: "/workspace/docs-mdx/workflow-guides/CATALOG.md",
	},
};

const source = `---
title: "SOP: MR Review"
tags: [merge-request, code-review]
linear_issue: DEV-100
---

# SOP: MR Review

## Steps

1. **Prepare the MR** — fill in the description.
2. **Request review** — assign a reviewer using the [guide](./guide-mr-review.mdx#roles).

## Verification

- The review was completed.
`;

function match(overrides: Partial<SopMatch> = {}): SopMatch {
	return {
		...catalog.sops[0],
		score: 0.67,
		checklist: ["Prepare the MR", "Request review"],
		publishedUrl:
			"https://enrichlayer.com/internal/docs/customer-support/workflow-guides/sop-mr-review",
		...overrides,
	};
}

describe("SOP matching", () => {
	it("parses the structured el-sop catalog payload", () => {
		expect(parseSopCatalogOutput(JSON.stringify(catalog))).toEqual(catalog);
	});

	it("rejects malformed catalog entries so the create gate can fail open loudly", () => {
		expect(() =>
			parseSopCatalogOutput(
				JSON.stringify({
					sops: [{ title: "missing required fields" }],
					availability: { status: "ok" },
				}),
			),
		).toThrow("malformed SOP entry");
	});

	it("uses title, description, and source tags with the duplicate gate tokenizer", () => {
		const matches = matchSops(
			"Run the merge request review",
			"Follow the code review workflow.",
			catalog,
			0.3,
			() => source,
		);

		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({
			title: "SOP: MR Review",
			tags: ["merge-request", "code-review"],
			linearIssue: "DEV-100",
			checklist: [
				"**Prepare the MR** — fill in the description.",
				"**Request review** — assign a reviewer using the [guide](https://enrichlayer.com/internal/docs/customer-support/workflow-guides/guide-mr-review#roles).",
			],
			publishedUrl:
				"https://enrichlayer.com/internal/docs/customer-support/workflow-guides/sop-mr-review",
		});
	});

	it("returns no matches below threshold", () => {
		const matches = matchSops(
			"Offboard a departing teammate",
			"Revoke account access.",
			catalog,
			0.3,
			() => source,
		);

		expect(matches).toEqual([]);
	});

	it("surfaces an unreadable SOP source to the create gate's fail-open path", () => {
		expect(() =>
			matchSops(
				"Run the MR review",
				"Review the request.",
				catalog,
				0.3,
				() => {
					throw new Error("read failed");
				},
			),
		).toThrow("could not read SOP source sop-mr-review.mdx: read failed");
	});

	it("extracts only top-level numbered items from the Steps section", () => {
		expect(extractSopChecklist(source)).toEqual([
			"**Prepare the MR** — fill in the description.",
			"**Request review** — assign a reviewer using the [guide](./guide-mr-review.mdx#roles).",
		]);
	});

	it("derives the published URL from the catalog source path", () => {
		expect(
			publishedSopUrl(
				"/workspace/docs-mdx/business/operations/sop-payments.mdx",
			),
		).toBe(
			"https://enrichlayer.com/internal/docs/customer-support/business/operations/sop-payments",
		);
	});

	it("appends links and unchecked steps inside an existing Done when section", () => {
		const description =
			"Context.\n\n## Done when\n\n- [ ] Existing criterion.\n\n## Out of scope\n\nNothing else.";
		const result = appendSopMatchesToDoneWhen(description, [match()]);

		expect(result.indexOf("### Matched SOP")).toBeLessThan(
			result.indexOf("## Out of scope"),
		);
		expect(result).toContain("- [ ] Prepare the MR");
		expect(result).toContain("- [ ] Request review");
		expect(result).toContain("- [ ] Existing criterion.");
	});

	it("creates Done when when the original description has none", () => {
		const result = appendSopMatchesToDoneWhen("Context.", [match()]);
		expect(result).toContain("## Done when");
		expect(result).toContain("### Matched SOP");
	});

	it("appends to a bold Done when pseudo-header", () => {
		const result = appendSopMatchesToDoneWhen(
			"Context.\n\n**Done when:**\n\n- [ ] Existing.\n\n**Out of scope**\n\nNothing else.",
			[match()],
		);
		expect(result.indexOf("### Matched SOP")).toBeLessThan(
			result.indexOf("**Out of scope**"),
		);
		expect(result.match(/Done when/g)).toHaveLength(1);
	});

	it("merges matched SOP Linear issues with explicit related issues", () => {
		expect(
			mergeSopRelations("DEV-50,DEV-100", [
				match({ linearIssue: "DEV-100" }),
				match({ linearIssue: "ALL-20" }),
			]),
		).toBe("DEV-50,DEV-100,ALL-20");
	});
});
