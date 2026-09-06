import { describe, expect, it, vi } from "vitest";
import type { LinearGraphQLError } from "./linear-graphql-error.js";

const mockRawRequest = vi.fn();
const linearClientCtorSpy = vi.fn();

// Mock @linear/sdk with a proper class constructor that records its options.
vi.mock("@linear/sdk", () => ({
	LinearClient: class MockLinearClient {
		client = { rawRequest: mockRawRequest };
		constructor(opts: unknown) {
			linearClientCtorSpy(opts);
		}
	},
}));

const { GraphQLService } = await import("./graphql-service.js");

describe("GraphQLService", () => {
	it("returns response data from rawRequest", async () => {
		mockRawRequest.mockResolvedValue({
			data: { issue: { id: "123", title: "Test" } },
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		const result = await service.rawRequest("query { issue { id title } }");
		expect(result).toEqual({ issue: { id: "123", title: "Test" } });
	});

	it("passes variables to the underlying client", async () => {
		mockRawRequest.mockResolvedValue({ data: {} });
		const service = new GraphQLService({ apiKey: "test-token" });

		await service.rawRequest("query ($id: String!) { issue(id: $id) { id } }", {
			id: "abc",
		});
		expect(mockRawRequest).toHaveBeenCalledWith(
			"query ($id: String!) { issue(id: $id) { id } }",
			{
				id: "abc",
			},
		);
	});

	it("throws a readable error from GraphQL errors", async () => {
		mockRawRequest.mockRejectedValue({
			response: { errors: [{ message: "Field 'foo' not found" }] },
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		await expect(service.rawRequest("{ foo }")).rejects.toThrow(
			"Field 'foo' not found",
		);
	});

	it("falls back to generic message when GraphQL error has no message", async () => {
		mockRawRequest.mockRejectedValue({
			response: { errors: [{}] },
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		await expect(service.rawRequest("{ foo }")).rejects.toThrow(
			"GraphQL query failed",
		);
	});

	it("wraps non-GraphQL errors with request context", async () => {
		mockRawRequest.mockRejectedValue({ message: "Network timeout" });
		const service = new GraphQLService({ apiKey: "test-token" });

		await expect(service.rawRequest("{ foo }")).rejects.toThrow(
			"GraphQL request failed: Network timeout",
		);
	});

	it("retries a transient failure only when the caller marks the mutation safe", async () => {
		const sleep = vi.fn().mockResolvedValue(undefined);
		const callsBefore = mockRawRequest.mock.calls.length;
		mockRawRequest
			.mockRejectedValueOnce({
				response: { status: 503 },
				message: "upstream unavailable",
			})
			.mockResolvedValueOnce({ data: { issueUpdate: { success: true } } });
		const service = new GraphQLService(
			{ apiKey: "test-token" },
			{ retryDelaysMs: [1], sleep },
		);

		await expect(
			service.rawRequest(
				"mutation Update { issueUpdate { success } }",
				{},
				{ retrySafeMutation: true },
			),
		).resolves.toEqual({ issueUpdate: { success: true } });
		expect(sleep).toHaveBeenCalledWith(1);
		expect(mockRawRequest.mock.calls.length - callsBefore).toBe(2);
	});

	it("does not retry a transient failure unless the caller opts in", async () => {
		const callsBefore = mockRawRequest.mock.calls.length;
		mockRawRequest.mockRejectedValue({
			response: { status: 503 },
			message: "upstream unavailable",
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		await expect(
			service.rawRequest("mutation Create { commentCreate { success } }"),
		).rejects.toThrow("GraphQL request failed: upstream unavailable");
		expect(mockRawRequest.mock.calls.length - callsBefore).toBe(1);
	});

	// DEV-7987: a shell-out caller must be able to tell a retryable 429 from a
	// permanent 400. These pin the classification the thrown error carries,
	// which is what `outputError` publishes as `errorDetail`. The rejection
	// fixtures mirror the `@linear/sdk` `LinearError` shape a live call
	// produces — status hoisted to the top level, `extensions.code` reachable
	// only through `raw` — because that, not `graphql-request`'s `ClientError`,
	// is what this service catches in production.
	it("classifies a 429 as retryable and a 400 as permanent", async () => {
		const service = new GraphQLService({ apiKey: "test-token" });

		mockRawRequest.mockRejectedValueOnce(
			Object.assign(new Error("Ratelimit exceeded"), {
				type: "Ratelimited",
				status: 429,
				raw: {
					response: {
						status: 429,
						errors: [{ extensions: { code: "RATELIMITED" } }],
					},
				},
			}),
		);
		const rateLimited = await service
			.rawRequest("{ viewer { id } }")
			.catch((error: unknown) => error as LinearGraphQLError);
		expect(rateLimited.httpStatus).toBe(429);
		expect(rateLimited.code).toBe("RATELIMITED");
		expect(rateLimited.retryable).toBe(true);

		mockRawRequest.mockRejectedValueOnce(
			Object.assign(new Error("Cannot query field 'nope'"), {
				type: "GraphqlError",
				status: 400,
				raw: {
					response: {
						status: 400,
						errors: [{ extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }],
					},
				},
			}),
		);
		const badQuery = await service
			.rawRequest("{ nope }")
			.catch((error: unknown) => error as LinearGraphQLError);
		expect(badQuery.httpStatus).toBe(400);
		expect(badQuery.code).toBe("GRAPHQL_VALIDATION_FAILED");
		expect(badQuery.retryable).toBe(false);
		// The message contract is unchanged — the SDK-normalized rejection has
		// no `response.errors`, so it keeps taking the wrapped-message branch.
		expect(badQuery.message).toBe(
			"GraphQL request failed: Cannot query field 'nope'",
		);
	});

	it("reads a rate limit off extensions.code even under a 400", async () => {
		mockRawRequest.mockRejectedValueOnce(
			Object.assign(new Error("Ratelimit"), {
				status: 400,
				raw: {
					response: {
						status: 400,
						errors: [{ extensions: { code: "RATELIMITED" } }],
					},
				},
			}),
		);
		const service = new GraphQLService({ apiKey: "test-token" });
		const error = await service
			.rawRequest("{ viewer { id } }")
			.catch((e: unknown) => e as LinearGraphQLError);
		expect(error.code).toBe("RATELIMITED");
		expect(error.retryable).toBe(true);
	});

	it("classifies a response-less transport failure as retryable", async () => {
		mockRawRequest.mockRejectedValueOnce(new Error("fetch failed"));
		const service = new GraphQLService({ apiKey: "test-token" });
		const error = await service
			.rawRequest("{ viewer { id } }")
			.catch((e: unknown) => e as LinearGraphQLError);
		expect(error.message).toBe("GraphQL request failed: fetch failed");
		expect(error.httpStatus).toBe(null);
		expect(error.code).toBe(null);
		expect(error.retryable).toBe(true);
	});

	it("keeps the un-normalized ClientError shape working too", async () => {
		// The `client.client` escape hatch is not contractually guaranteed to
		// stay SDK-normalized across upgrades; if it ever hands back a bare
		// graphql-request ClientError, the classification must not go blind.
		mockRawRequest.mockRejectedValueOnce({
			response: {
				status: 503,
				errors: [{ message: "Service unavailable" }],
			},
			message: "upstream unavailable",
		});
		const service = new GraphQLService({ apiKey: "test-token" });
		const error = await service
			.rawRequest("{ viewer { id } }")
			.catch((e: unknown) => e as LinearGraphQLError);
		expect(error.httpStatus).toBe(503);
		expect(error.retryable).toBe(true);
		expect(error.message).toBe("Service unavailable");
	});

	it("string constructor passes apiKey to LinearClient (personal-token path)", () => {
		linearClientCtorSpy.mockReset();
		new GraphQLService({ apiKey: "personal-token" });
		expect(linearClientCtorSpy).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: "personal-token" }),
		);
		const opts = linearClientCtorSpy.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(opts.accessToken).toBeUndefined();
	});

	it("`{apiKey}` constructor passes apiKey to LinearClient", () => {
		linearClientCtorSpy.mockReset();
		new GraphQLService({ apiKey: "explicit-key" });
		expect(linearClientCtorSpy).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: "explicit-key" }),
		);
	});

	it("`{oauthToken}` constructor passes accessToken — SDK adds Bearer prefix", () => {
		linearClientCtorSpy.mockReset();
		new GraphQLService({ oauthToken: "lin_oauth_xyz" });
		expect(linearClientCtorSpy).toHaveBeenCalledWith(
			expect.objectContaining({ accessToken: "lin_oauth_xyz" }),
		);
		const opts = linearClientCtorSpy.mock.calls[0][0] as Record<
			string,
			unknown
		>;
		expect(opts.apiKey).toBeUndefined();
	});
});
