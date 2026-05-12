import { describe, expect, it, vi } from "vitest";

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
