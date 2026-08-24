import type { LinearClient } from "@linear/sdk";
import { describe, expect, it, vi } from "vitest";
import type { LinearGraphQLError } from "./linear-graphql-error.js";
import { outputSuccess, resetWarnings } from "./output.js";

const mockRawRequest = vi.fn();
const mockSetHeader = vi.fn();
const linearClientCtorSpy = vi.fn();

// Mock @linear/sdk with a proper class constructor that records its options.
vi.mock("@linear/sdk", () => ({
	LinearClient: class MockLinearClient {
		client = { rawRequest: mockRawRequest, setHeader: mockSetHeader };
		constructor(opts: unknown) {
			linearClientCtorSpy(opts);
		}
	},
}));

const {
	GraphQLService,
	instrumentLinearClient,
	isRateLimitGraphQLError,
	isTransientGraphQLError,
} = await import("./graphql-service.js");

describe("GraphQLService", () => {
	it("returns response data from rawRequest", async () => {
		mockRawRequest.mockResolvedValue({
			data: { issue: { id: "123", title: "Test" } },
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		const result = await service.rawRequest("query { issue { id title } }");
		expect(result).toEqual({ issue: { id: "123", title: "Test" } });
	});

	it("admits before the request and persists the returned quota observation", async () => {
		const admit = vi.fn().mockResolvedValue(undefined);
		const observe = vi.fn().mockResolvedValue(undefined);
		mockRawRequest.mockResolvedValue({
			data: { viewer: { id: "123" } },
			headers: new Headers({
				"x-ratelimit-requests-limit": "2500",
				"x-ratelimit-requests-remaining": "2499",
			}),
		});
		const service = new GraphQLService(
			{ apiKey: "test-token" },
			{ admission: { enabled: true, admit, observe } },
		);

		await service.rawRequest("query { viewer { id } }");

		expect(admit).toHaveBeenCalledTimes(1);
		expect(observe).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 2500, remaining: 2499 }),
		);
		expect(admit.mock.invocationCallOrder[0]).toBeLessThan(
			mockRawRequest.mock.invocationCallOrder.at(-1) as number,
		);
	});

	it("does not call Linear when quota admission refuses", async () => {
		const before = mockRawRequest.mock.calls.length;
		const service = new GraphQLService(
			{ apiKey: "test-token" },
			{
				admission: {
					enabled: true,
					admit: vi
						.fn()
						.mockRejectedValue(
							new Error(
								"Linear rate limit exceeded before request; admission refused",
							),
						),
					observe: vi.fn().mockResolvedValue(undefined),
				},
			},
		);

		await expect(service.rawRequest("query { viewer { id } }")).rejects.toThrow(
			"Rate limit exceeded",
		);
		expect(mockRawRequest.mock.calls.length).toBe(before);
	});

	it("instruments SDK request calls without hiding response headers", async () => {
		const admit = vi.fn().mockResolvedValue(undefined);
		const observe = vi.fn().mockResolvedValue(undefined);
		const rawRequest = vi.fn().mockResolvedValue({
			data: { teams: { nodes: [] } },
			headers: new Headers({
				"x-ratelimit-requests-limit": "2500",
				"x-ratelimit-requests-remaining": "2490",
			}),
		});
		const client = {
			client: { rawRequest, request: vi.fn() },
		} as unknown as LinearClient;
		instrumentLinearClient(
			client,
			{ apiKey: "test-token" },
			{
				admission: { enabled: true, admit, observe },
			},
		);

		await expect(
			(
				client as unknown as {
					client: { request(query: string): Promise<unknown> };
				}
			).client.request("query { teams { nodes { id } } }"),
		).resolves.toEqual({ teams: { nodes: [] } });
		expect(admit).toHaveBeenCalledTimes(1);
		expect(observe).toHaveBeenCalledWith(
			expect.objectContaining({ remaining: 2490 }),
		);
	});

	it("surfaces successful response headers on normal JSON output", async () => {
		resetWarnings();
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		mockRawRequest.mockResolvedValue({
			data: { viewer: { id: "user-1" } },
			headers: new Headers({
				"x-complexity": "42",
				"x-ratelimit-complexity-limit": "2000000",
				"x-ratelimit-complexity-remaining": "1999958",
				"x-ratelimit-complexity-reset": String(
					Date.parse("2026-08-11T10:00:00.000Z"),
				),
				"x-ratelimit-endpoint-name": "Issue",
				"x-ratelimit-endpoint-requests-limit": "1000",
				"x-ratelimit-endpoint-requests-remaining": "998",
				"x-ratelimit-endpoint-requests-reset": String(
					Date.parse("2026-08-11T10:00:00.000Z"),
				),
				"x-ratelimit-requests-limit": "2500",
				"x-ratelimit-requests-remaining": "2498",
				"x-ratelimit-requests-reset": String(
					Date.parse("2026-08-11T10:00:00.000Z"),
				),
			}),
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		const result = await service.rawRequest("query { viewer { id } }");
		outputSuccess(result);

		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._rateLimit).toEqual({
			limit: 2500,
			remaining: 2498,
			resetAt: "2026-08-11T10:00:00.000Z",
			observedRequests: 1,
			minimumRemaining: 2498,
			complexity: {
				cost: 42,
				totalCost: 42,
				limit: 2_000_000,
				remaining: 1_999_958,
				minimumRemaining: 1_999_958,
				resetAt: "2026-08-11T10:00:00.000Z",
			},
			endpoints: {
				Issue: {
					limit: 1000,
					remaining: 998,
					minimumRemaining: 998,
					resetAt: "2026-08-11T10:00:00.000Z",
					observedRequests: 1,
				},
			},
		});
		stdoutSpy.mockRestore();
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

	it("does not retry a 429 even when the mutation is otherwise retry-safe", async () => {
		const sleep = vi.fn().mockResolvedValue(undefined);
		const callsBefore = mockRawRequest.mock.calls.length;
		mockRawRequest.mockRejectedValue({
			response: {
				status: 429,
				headers: new Headers({
					"x-ratelimit-requests-limit": "2500",
					"x-ratelimit-requests-remaining": "0",
					"x-ratelimit-requests-reset": String(
						Date.parse("2026-08-11T10:00:00.000Z"),
					),
				}),
			},
			message: "Rate limit exceeded",
		});
		const service = new GraphQLService(
			{ apiKey: "test-token" },
			{ retryDelaysMs: [1, 2], sleep },
		);

		await expect(
			service.rawRequest(
				"mutation Update { issueUpdate { success } }",
				{},
				{ retrySafeMutation: true },
			),
		).rejects.toThrow("the request limit resets at 2026-08-11T10:00:00.000Z");
		expect(mockRawRequest.mock.calls.length - callsBefore).toBe(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("records quota headers from a rejected rate-limited response", async () => {
		resetWarnings();
		const stdoutSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		mockRawRequest.mockRejectedValue({
			response: {
				status: 429,
				headers: new Headers({
					"x-complexity": "7",
					"x-ratelimit-requests-limit": "2500",
					"x-ratelimit-requests-remaining": "0",
				}),
			},
			message: "Rate limit exceeded",
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		await service.rawRequest("query Read { viewer { id } }").catch(() => {});
		outputSuccess({ caught: true });

		const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
		expect(parsed._rateLimit).toMatchObject({
			limit: 2500,
			remaining: 0,
			observedRequests: 1,
			complexity: { cost: 7, totalCost: 7 },
		});
		stdoutSpy.mockRestore();
	});

	it("warns that a rate-limited mutation may already have been applied", async () => {
		mockRawRequest.mockRejectedValue({
			type: "Ratelimited",
			requestsLimit: 2500,
			requestsRemaining: 0,
			requestsResetAt: Date.parse("2026-08-11T10:00:00.000Z"),
			message: "Rate limit exceeded",
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		await expect(
			service.rawRequest("mutation Create { issueCreate { success } }"),
		).rejects.toThrow(
			"This mutation may have been applied; verify its outcome before retrying.",
		);
	});

	it("does not add mutation ambiguity text to a rate-limited query", async () => {
		mockRawRequest.mockRejectedValue({
			type: "Ratelimited",
			requestsResetAt: Date.parse("2026-08-11T10:00:00.000Z"),
			message: "Rate limit exceeded",
		});
		const service = new GraphQLService({ apiKey: "test-token" });

		await expect(
			service.rawRequest("query Read { viewer { id } }"),
		).rejects.not.toThrow("may have been applied");
	});

	it("uses Retry-After when the absolute reset header is unavailable", async () => {
		mockRawRequest.mockRejectedValue({
			type: "Ratelimited",
			retryAfter: 90,
			message: "Rate limit exceeded",
		});
		const service = new GraphQLService(
			{ apiKey: "test-token" },
			{ now: () => Date.parse("2026-08-11T09:00:00.000Z") },
		);

		await expect(
			service.rawRequest("query Read { viewer { id } }"),
		).rejects.toThrow("the request limit resets at 2026-08-11T09:01:30.000Z");
	});

	it("recognizes Linear's GraphQL RATELIMITED error shape and keeps 408/5xx transient", () => {
		const graphqlRateLimit = {
			response: {
				status: 400,
				errors: [{ extensions: { code: "RATELIMITED" } }],
			},
		};
		expect(isRateLimitGraphQLError(graphqlRateLimit)).toBe(true);
		expect(isTransientGraphQLError(graphqlRateLimit)).toBe(false);
		expect(isTransientGraphQLError({ response: { status: 408 } })).toBe(true);
		expect(isTransientGraphQLError({ response: { status: 503 } })).toBe(true);
	});

	it("renews client credentials once after HTTP 401", async () => {
		mockRawRequest
			.mockRejectedValueOnce({ status: 401, message: "Unauthorized" })
			.mockResolvedValueOnce({ data: { viewer: { id: "app-user" } } });
		const renewAccessToken = vi.fn().mockResolvedValue("renewed-token");
		const service = new GraphQLService(
			{ oauthToken: "expired-token" },
			{ renewAccessToken },
		);
		await expect(
			service.rawRequest("query { viewer { id } }"),
		).resolves.toEqual({ viewer: { id: "app-user" } });
		expect(renewAccessToken).toHaveBeenCalledTimes(1);
		expect(mockSetHeader).toHaveBeenCalledWith(
			"authorization",
			"Bearer renewed-token",
		);
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
