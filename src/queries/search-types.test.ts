import { describe, expectTypeOf, it } from "vitest";
import type { SemanticSearchResult } from "./search-types.js";

describe("SemanticSearchResult discriminated union (DEV-4068 T1)", () => {
	it("type narrows to the populated payload field", () => {
		const r = {} as SemanticSearchResult;
		if (r.type === "issue") {
			// Inside the `issue` arm, `r.issue` is the only payload property
			// in scope — accessing the others should fail to compile.
			expectTypeOf(r).toHaveProperty("issue");
			// @ts-expect-error -- project is not on the issue arm
			void r.project;
			// @ts-expect-error -- initiative is not on the issue arm
			void r.initiative;
			// @ts-expect-error -- document is not on the issue arm
			void r.document;
		}
		if (r.type === "project") {
			expectTypeOf(r).toHaveProperty("project");
			// @ts-expect-error -- issue is not on the project arm
			void r.issue;
		}
		if (r.type === "initiative") {
			expectTypeOf(r).toHaveProperty("initiative");
			// @ts-expect-error -- document is not on the initiative arm
			void r.document;
		}
		if (r.type === "document") {
			expectTypeOf(r).toHaveProperty("document");
			// @ts-expect-error -- initiative is not on the document arm
			void r.initiative;
		}
	});

	it("type is a closed literal union — unknown strings don't satisfy", () => {
		// @ts-expect-error -- "template" is not a SemanticSearchResult variant
		const _bad: SemanticSearchResult = { type: "template", issue: null };
		void _bad;
	});
});
