import { describe, expectTypeOf, it } from "vitest";
import type {
	FileDownloadResult,
	FileUploadResult,
	GraphQLResponseData,
	GraphQLVariables,
	IssueStateSpan,
	LinearAttachment,
	LinearComment,
	LinearCycleDetail,
	LinearCycleSummary,
	LinearDocument,
	LinearIssue,
	LinearIssueRelation,
	LinearLabel,
	LinearPriority,
	LinearProject,
	LinearRelease,
	LinearTeam,
	LinearUser,
} from "./linear.js";

describe("linear entity types", () => {
	it("all exported types are importable and structurally valid", () => {
		expectTypeOf<LinearTeam>().toHaveProperty("key");
		expectTypeOf<LinearUser>().toHaveProperty("email");
		expectTypeOf<LinearLabel>().toHaveProperty("scope");
		expectTypeOf<LinearProject>().toHaveProperty("teams");
		expectTypeOf<LinearComment>().toHaveProperty("body");
		expectTypeOf<LinearIssue>().toHaveProperty("identifier");
		expectTypeOf<LinearCycleSummary>().toHaveProperty("number");
		expectTypeOf<LinearCycleDetail>().toHaveProperty("issues");
		expectTypeOf<LinearDocument>().toHaveProperty("title");
		expectTypeOf<LinearAttachment>().toHaveProperty("url");
		expectTypeOf<LinearIssueRelation>().toHaveProperty("type");
		expectTypeOf<LinearRelease>().toHaveProperty("name");
		expectTypeOf<IssueStateSpan>().toHaveProperty("state");
		expectTypeOf<GraphQLResponseData>().toBeObject();
		expectTypeOf<GraphQLVariables>().toEqualTypeOf<Record<string, unknown>>();
	});

	it("LinearLabel scope is a string union", () => {
		expectTypeOf<LinearLabel["scope"]>().toEqualTypeOf<"team" | "workspace">();
	});

	it("LinearPriority is the Linear 0-4 literal union (DEV-4068 T9)", () => {
		// Surface contract — priority everywhere narrows to this set.
		expectTypeOf<LinearPriority>().toEqualTypeOf<0 | 1 | 2 | 3 | 4>();
		// LinearIssue.priority uses it.
		expectTypeOf<LinearIssue["priority"]>().toEqualTypeOf<LinearPriority>();
		// Out-of-range literals must NOT assign — `5` should fail to compile.
		// @ts-expect-error -- 5 is not a valid Linear priority
		const _bad: LinearPriority = 5;
		void _bad;
	});

	it("LinearCycleDetail extends LinearCycleSummary", () => {
		expectTypeOf<LinearCycleDetail>().toExtend<LinearCycleSummary>();
	});

	it("FileDownloadResult is a discriminated union", () => {
		const success: FileDownloadResult = { success: true, filePath: "/tmp/x" };
		const failure: FileDownloadResult = { success: false, error: "fail" };
		expectTypeOf(success).toExtend<FileDownloadResult>();
		expectTypeOf(failure).toExtend<FileDownloadResult>();
	});

	it("FileUploadResult is a discriminated union", () => {
		const success: FileUploadResult = {
			success: true,
			assetUrl: "https://x",
			filename: "f",
		};
		const failure: FileUploadResult = { success: false, error: "fail" };
		expectTypeOf(success).toExtend<FileUploadResult>();
		expectTypeOf(failure).toExtend<FileUploadResult>();
	});

	it("GraphQLResponseData allows recursive nested access", () => {
		const data: GraphQLResponseData = { issue: { id: "1", title: "test" } };
		expectTypeOf(data.issue).not.toBeAny();
	});
});
