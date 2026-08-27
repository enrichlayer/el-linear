import { LinearClient } from "@linear/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readGraphQLErrorDetail } from "./linear-graphql-error.js";
import { instrumentLinearGraphQLErrorClassification } from "./linear-service.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Linear SDK error-classification composition", () => {
	it("preserves classification through the SDK public request path", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						errors: [
							{
								message: "Rate limit exceeded",
								extensions: { code: "RATELIMITED" },
							},
						],
					}),
					{
						status: 429,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		);
		const client = instrumentLinearGraphQLErrorClassification(
			new LinearClient({ apiKey: "test-token" }),
		);

		let thrown: unknown;
		try {
			await client.teams();
		} catch (error) {
			thrown = error;
		}

		expect(readGraphQLErrorDetail(thrown)).toEqual({
			httpStatus: 429,
			code: "RATELIMITED",
			retryable: true,
		});
	});
});
