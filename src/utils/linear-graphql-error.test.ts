import { describe, expect, it } from "vitest";
import {
	classifyGraphQLFailure,
	graphQLErrorCode,
	graphQLErrorHttpStatus,
	isRetryableGraphQLCode,
	isRetryableHttpStatus,
	LinearGraphQLError,
	readGraphQLErrorDetail,
	toLinearGraphQLError,
} from "./linear-graphql-error.js";

/**
 * The shape `@linear/sdk` actually throws (a `LinearError`): the status is
 * hoisted to the top level and the ONLY surviving `extensions.code` is on
 * the wrapped original under `raw`. Captured from a live 400 against the
 * Linear API — reading only `error.response` (the un-normalized
 * `graphql-request` shape) finds neither.
 */
function sdkRejection(status: number, code: string | null): Error {
	return Object.assign(new Error('Cannot query field "nope" on type "User".'), {
		type: "GraphqlError",
		status,
		errors: [{ type: "GraphqlError", message: "…", userError: true }],
		raw: {
			response: {
				status,
				errors: [
					{
						message: "…",
						extensions: code === null ? {} : { code, type: "graphql error" },
					},
				],
			},
		},
	});
}

describe("graphQLErrorHttpStatus / graphQLErrorCode", () => {
	it("reads the @linear/sdk LinearError shape", () => {
		const error = sdkRejection(400, "GRAPHQL_VALIDATION_FAILED");
		expect(graphQLErrorHttpStatus(error)).toBe(400);
		expect(graphQLErrorCode(error)).toBe("GRAPHQL_VALIDATION_FAILED");
	});

	it("reads the un-normalized graphql-request ClientError shape", () => {
		const error = {
			response: {
				status: 429,
				errors: [{ extensions: { code: "RATELIMITED" } }],
			},
		};
		expect(graphQLErrorHttpStatus(error)).toBe(429);
		expect(graphQLErrorCode(error)).toBe("RATELIMITED");
	});

	it("reports null rather than guessing when neither shape carries a signal", () => {
		expect(graphQLErrorHttpStatus(new Error("fetch failed"))).toBe(null);
		expect(graphQLErrorCode(new Error("fetch failed"))).toBe(null);
		expect(graphQLErrorHttpStatus(null)).toBe(null);
		expect(graphQLErrorCode("string throw")).toBe(null);
	});
});

describe("isRetryableHttpStatus", () => {
	it.each([408, 429, 500, 502, 503, 504, 599])("retries %i", (status) => {
		expect(isRetryableHttpStatus(status)).toBe(true);
	});

	it.each([400, 401, 403, 404, 422])("does not retry %i", (status) => {
		expect(isRetryableHttpStatus(status)).toBe(false);
	});

	it("treats a missing status as no signal rather than as retryable", () => {
		expect(isRetryableHttpStatus(null)).toBe(false);
	});
});

describe("isRetryableGraphQLCode", () => {
	it.each(["RATELIMITED", "INTERNAL_SERVER_ERROR", "SERVICE_UNAVAILABLE"])(
		"retries %s",
		(code) => {
			expect(isRetryableGraphQLCode(code)).toBe(true);
		},
	);

	it.each(["BAD_USER_INPUT", "GRAPHQL_VALIDATION_FAILED", "FORBIDDEN"])(
		"does not retry %s",
		(code) => {
			expect(isRetryableGraphQLCode(code)).toBe(false);
		},
	);

	it("treats a missing code as no signal", () => {
		expect(isRetryableGraphQLCode(null)).toBe(false);
	});
});

describe("classifyGraphQLFailure", () => {
	it("classifies a 429 and a 400 differently", () => {
		expect(classifyGraphQLFailure(429, null)).toBe(true);
		expect(classifyGraphQLFailure(400, null)).toBe(false);
	});

	it("retries a rate limit that arrives under a non-retryable status", () => {
		// The whole point of reading extensions.code separately: Linear can
		// answer a rate limit with a 400 body, and the status alone would
		// then read as a permanent schema error.
		expect(classifyGraphQLFailure(400, "RATELIMITED")).toBe(true);
	});

	it("retries a transport failure that never got an answer out of Linear", () => {
		// No status AND no code means the request never reached a Linear
		// response — every failure Linear itself produced carries a status.
		// This structural absence is stronger than guessing from unbounded
		// transport-error wording.
		expect(classifyGraphQLFailure(null, null)).toBe(true);
	});

	it("keeps authoritative permanent responses non-retryable", () => {
		expect(classifyGraphQLFailure(400, null)).toBe(false);
		expect(classifyGraphQLFailure(401, null)).toBe(false);
		expect(classifyGraphQLFailure(403, "FORBIDDEN")).toBe(false);
	});
});

describe("LinearGraphQLError", () => {
	it("keeps the message and publishes its classification", () => {
		const error = new LinearGraphQLError("GraphQL request failed: boom", {
			httpStatus: 503,
			code: "SERVICE_UNAVAILABLE",
			retryable: true,
		});
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe("GraphQL request failed: boom");
		expect(error.name).toBe("LinearGraphQLError");
		expect(error.detail).toEqual({
			httpStatus: 503,
			code: "SERVICE_UNAVAILABLE",
			retryable: true,
		});
	});
});

describe("toLinearGraphQLError", () => {
	it("classifies from the rejection while keeping the composed message", () => {
		const wrapped = toLinearGraphQLError(
			sdkRejection(429, "RATELIMITED"),
			"GraphQL request failed: Rate limit exceeded. Resets at 10:00Z.",
		);
		expect(wrapped.message).toBe(
			"GraphQL request failed: Rate limit exceeded. Resets at 10:00Z.",
		);
		expect(wrapped.detail).toEqual({
			httpStatus: 429,
			code: "RATELIMITED",
			retryable: true,
		});
	});

	it("classifies off the rejection's own text, not the composed message", () => {
		// A composed message can lose the transport wording the classifier
		// needs; the original rejection is the authority.
		const wrapped = toLinearGraphQLError(
			new Error("fetch failed"),
			"GraphQL request failed: something went wrong",
		);
		expect(wrapped.retryable).toBe(true);
	});
});

describe("readGraphQLErrorDetail", () => {
	it("reads the classification off a LinearGraphQLError", () => {
		const error = new LinearGraphQLError("nope", {
			httpStatus: 400,
			code: "BAD_USER_INPUT",
			retryable: false,
		});
		expect(readGraphQLErrorDetail(error)).toEqual({
			httpStatus: 400,
			code: "BAD_USER_INPUT",
			retryable: false,
		});
	});

	it("reads structurally, so a cross-module-instance copy still resolves", () => {
		// The envelope contract must not hinge on prototype identity — a
		// duplicated module copy (vitest mock, hoisted dependency) would
		// otherwise silently drop the classification.
		const lookalike = Object.assign(new Error("nope"), {
			httpStatus: 429,
			code: "RATELIMITED",
			retryable: true,
		});
		expect(readGraphQLErrorDetail(lookalike)).toEqual({
			httpStatus: 429,
			code: "RATELIMITED",
			retryable: true,
		});
	});

	it("returns null for an ordinary error carrying no classification", () => {
		expect(readGraphQLErrorDetail(new Error("File not found: q.gql"))).toBe(
			null,
		);
		expect(readGraphQLErrorDetail(null)).toBe(null);
		expect(readGraphQLErrorDetail("string throw")).toBe(null);
	});

	it("normalizes absent status and code to explicit nulls", () => {
		const error = new LinearGraphQLError("fetch failed", {
			httpStatus: null,
			code: null,
			retryable: true,
		});
		expect(readGraphQLErrorDetail(error)).toEqual({
			httpStatus: null,
			code: null,
			retryable: true,
		});
	});
});
