import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProgram, runCommand } from "../__tests__/test-helpers.js";

/**
 * End-to-end cover for DEV-7987's published contract: `el-linear graphql`
 * must let a shell-out caller tell a retryable 429 from a permanent 400.
 *
 * Deliberately NOT in `graphql.test.ts` — that file mocks
 * `utils/output.js` wholesale, so it can never observe the real
 * `outputError` envelope. Here only the GraphQL service is mocked and the
 * genuine `handleAsyncCommand` → `outputError` path runs, which is the
 * only way to prove what actually lands on stdout.
 */

const mockRawRequest = vi.fn();
const mockCreateGraphQLService = vi
	.fn()
	.mockReturnValue({ rawRequest: mockRawRequest });

vi.mock("../utils/graphql-service.js", () => ({
	createGraphQLService: mockCreateGraphQLService,
}));

const { LinearGraphQLError } = await import("../utils/linear-graphql-error.js");
const { setupGraphQLCommands } = await import("./graphql.js");

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.clearAllMocks();
	mockCreateGraphQLService.mockReturnValue({ rawRequest: mockRawRequest });
	stdoutSpy = vi
		.spyOn(process.stdout, "write")
		.mockImplementation(() => true) as ReturnType<typeof vi.spyOn>;
	exitSpy = vi
		.spyOn(process, "exit")
		.mockImplementation(() => undefined as never) as ReturnType<
		typeof vi.spyOn
	>;
});

afterEach(() => {
	stdoutSpy.mockRestore();
	exitSpy.mockRestore();
});

function emittedEnvelope(): Record<string, unknown> {
	const stdout = stdoutSpy.mock.calls
		.map((call: unknown[]) => call[0] as string)
		.join("");
	return JSON.parse(stdout) as Record<string, unknown>;
}

async function runGraphql(): Promise<void> {
	const program = createTestProgram();
	setupGraphQLCommands(program);
	await runCommand(program, ["graphql", "{ viewer { id } }"]);
}

describe("el-linear graphql error envelope", () => {
	it("reports a 429 as retryable", async () => {
		mockRawRequest.mockRejectedValue(
			new LinearGraphQLError("Ratelimit exceeded", {
				httpStatus: 429,
				code: "RATELIMITED",
				retryable: true,
			}),
		);

		await runGraphql();

		expect(emittedEnvelope()).toMatchObject({
			error: "Ratelimit exceeded",
			errorDetail: { httpStatus: 429, code: "RATELIMITED", retryable: true },
		});
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("reports a 400 as permanent — the distinction the flattened envelope lost", async () => {
		mockRawRequest.mockRejectedValue(
			new LinearGraphQLError("Cannot query field 'nope'", {
				httpStatus: 400,
				code: "GRAPHQL_VALIDATION_FAILED",
				retryable: false,
			}),
		);

		await runGraphql();

		expect(emittedEnvelope()).toMatchObject({
			error: "Cannot query field 'nope'",
			errorDetail: {
				httpStatus: 400,
				code: "GRAPHQL_VALIDATION_FAILED",
				retryable: false,
			},
		});
		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("emits one parseable JSON object, still on stdout", async () => {
		mockRawRequest.mockRejectedValue(
			new LinearGraphQLError("GraphQL request failed: fetch failed", {
				httpStatus: null,
				code: null,
				retryable: true,
			}),
		);

		await runGraphql();

		const envelope = emittedEnvelope();
		expect(envelope.activeProfile).toEqual(expect.any(String));
		expect(envelope.errorDetail).toEqual({
			httpStatus: null,
			code: null,
			retryable: true,
		});
	});
});
