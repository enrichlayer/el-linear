import { LinearClient } from "@linear/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { instrumentLinearClient } from "./graphql-service.js";
import { readGraphQLErrorDetail } from "./linear-graphql-error.js";
import { instrumentLinearGraphQLErrorClassification } from "./linear-service.js";
import {
	RateLimitAdmissionRefusal,
	type RateLimitAdmission,
} from "./rate-limit-admission.js";

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

	it("restores a local admission refusal after SDK normalization", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const refusal = new RateLimitAdmissionRefusal(
			"Linear rate limit exceeded before request",
		);
		const admission: RateLimitAdmission = {
			enabled: true,
			admit: vi.fn().mockRejectedValue(refusal),
			observe: vi.fn(),
		};
		const client = instrumentLinearGraphQLErrorClassification(
			instrumentLinearClient(
				new LinearClient({ apiKey: "test-token" }),
				{ apiKey: "test-token" },
				{ admission },
			),
		);

		await expect(client.teams()).rejects.toBe(refusal);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
