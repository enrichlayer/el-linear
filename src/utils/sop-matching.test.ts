import { describe, expect, it, vi } from "vitest";
import {
	appendSopMatchesToDoneWhen,
	DEFAULT_SOP_PUBLISHED_URL_BASE,
	extractSopChecklist,
	matchSops,
	parseSopCatalogOutput,
	parseSopLinearIssueReference,
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

	it("uses title, description, and catalog tags with the duplicate gate tokenizer", () => {
		const matches = matchSops(
			"Run the merge request review",
			"Follow the code review workflow.",
			{
				...catalog,
				sops: [{ ...catalog.sops[0], tags: ["merge-request", "code-review"] }],
			},
			{ threshold: 0.3, readSource: () => source },
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
			{ threshold: 0.3, readSource: () => source },
		);

		expect(matches).toEqual([]);
	});

	it("skips one unreadable matched entry and continues matching the corpus", () => {
		const onEntryError = vi.fn();
		const matches = matchSops(
			"Run the MR review",
			"Review the request.",
			{
				...catalog,
				sops: [
					catalog.sops[0],
					{
						...catalog.sops[0],
						name: "sop-review-backup.mdx",
						path: "./sop-review-backup.mdx",
					},
				],
			},
			{
				threshold: 0.3,
				readSource: (path) => {
					if (path.endsWith("sop-mr-review.mdx")) {
						throw new Error("read failed");
					}
					return source;
				},
				onEntryError,
			},
		);

		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe("sop-review-backup.mdx");
		expect(onEntryError).toHaveBeenCalledWith(
			catalog.sops[0],
			expect.objectContaining({
				message: expect.stringContaining("read failed"),
			}),
		);
	});

	it("does not hydrate catalog entries below the score threshold", () => {
		const readSource = vi.fn(() => source);
		expect(
			matchSops("Offboard a teammate", "Revoke access.", catalog, {
				threshold: 0.3,
				readSource,
			}),
		).toEqual([]);
		expect(readSource).not.toHaveBeenCalled();
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
			`${DEFAULT_SOP_PUBLISHED_URL_BASE}/business/operations/sop-payments`,
		);
	});

	it("derives the published URL from a configured base", () => {
		expect(
			publishedSopUrl(
				"/workspace/docs-mdx/workflow-guides/sop-review.mdx",
				"https://docs.example.com/playbooks/",
			),
		).toBe("https://docs.example.com/playbooks/workflow-guides/sop-review");
	});

	it("accepts bare and URL-form Linear issue references", () => {
		expect(parseSopLinearIssueReference("DEV-100")).toBe("DEV-100");
		expect(
			parseSopLinearIssueReference(
				"https://linear.app/verticalint/issue/DEV-100/review-the-mr",
			),
		).toBe("DEV-100");
	});

	it("rejects malformed Linear issue references", () => {
		expect(() => parseSopLinearIssueReference("not-an-issue")).toThrow(
			"expected TEAM-123",
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
			"Context.\n\n**Done when:**\n\n- [ ] Existing.\n\n## Out of scope\n\nNothing else.",
			[match()],
		);
		expect(result.indexOf("### Matched SOP")).toBeLessThan(
			result.indexOf("## Out of scope"),
		);
		expect(result.match(/Done when/g)).toHaveLength(1);
	});

	it("keeps a bold callout inside Done when instead of treating it as a section", () => {
		const result = appendSopMatchesToDoneWhen(
			"Context.\n\n## Done when\n\n**Important:**\n\nKeep this callout.\n\n- [ ] Existing.\n\n## Out of scope\n\nNothing else.",
			[match()],
		);
		expect(result.indexOf("**Important:**")).toBeLessThan(
			result.indexOf("### Matched SOP"),
		);
		expect(result.indexOf("### Matched SOP")).toBeLessThan(
			result.indexOf("## Out of scope"),
		);
	});
});
