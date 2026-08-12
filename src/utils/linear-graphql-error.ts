/**
 * Structured classification for a failed Linear GraphQL request (DEV-7987).
 *
 * WHY THIS EXISTS. Every command routes its failures through `outputError`
 * in `utils/output.ts`, which used to emit `{ error, activeProfile }` and
 * nothing else. That flattens a rate limit, a gateway blip and a permanent
 * schema error into one indistinguishable shape, so a machine caller
 * shelling out to `el-linear` (a job runner deciding whether to retry, say)
 * had to substring-match the message to guess. This module carries the two
 * facts that were being thrown away — the HTTP status and the GraphQL
 * `extensions.code` — plus the retryable verdict derived from them, so the
 * envelope can state them.
 *
 * Kept in its own module, free of `@linear/sdk`, so `utils/output.ts` can
 * read the classification without importing the GraphQL client.
 */

/**
 * GraphQL `extensions.code` values Linear returns for conditions that clear
 * on their own. A caller may retry these regardless of the HTTP status —
 * Linear answers a rate limit with `RATELIMITED` under more than one
 * status, so the code is load-bearing on its own.
 */
export const RETRYABLE_GRAPHQL_ERROR_CODES: readonly string[] = [
	"RATELIMITED",
	"INTERNAL_SERVER_ERROR",
	"SERVICE_UNAVAILABLE",
];

/** HTTP statuses that mean "the request was fine, the moment wasn't". */
const RETRYABLE_HTTP_STATUSES: readonly number[] = [408, 429];

/**
 * Message fragments that identify a transport failure that never reached
 * Linear (DNS, refused connection, socket reset). Kept as a message test
 * because these arrive as bare `Error`s with no status and no code.
 */
const TRANSIENT_TRANSPORT_MESSAGE_RE =
	/\b(?:408|429|500|502|503|504)\b|(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network error|connection termination)/i;

/**
 * The classification block `el-linear` publishes as `errorDetail` on a
 * failed command's JSON envelope. Every field is always present — `null`
 * means "the failure carried no such signal", which is itself information a
 * caller can act on.
 */
export interface LinearGraphQLErrorDetail {
	/** HTTP status of the Linear response, or `null` if it never arrived. */
	httpStatus: number | null;
	/** GraphQL `extensions.code` of the first error, or `null`. */
	code: string | null;
	/** Whether retrying the identical request could plausibly succeed. */
	retryable: boolean;
}

/**
 * The two rejection shapes that reach `GraphQLService.rawRequest`'s catch.
 *
 * `@linear/sdk` normalizes `graphql-request`'s `ClientError` into a
 * `LinearError`, which hoists the status to the TOP level and keeps the
 * original under `raw` — so the `extensions.code` survives only at
 * `raw.response.errors[].extensions.code`. The SDK's own `errors[]` is a
 * different projection (`{ type, message, userError, path }`) that drops
 * `code` entirely. The un-normalized `ClientError` shape is read too,
 * because the `client.client` escape hatch this CLI uses is not contractually
 * guaranteed to stay normalized across SDK upgrades.
 */
interface GraphQLRejection {
	/** `LinearError.status` — the SDK's hoisted HTTP status. */
	status?: unknown;
	/** `ClientError.response` — the un-normalized shape. */
	response?: {
		status?: unknown;
		statusCode?: unknown;
		errors?: Array<{ extensions?: { code?: unknown } }>;
	};
	/** `LinearError.raw` — the original `ClientError` the SDK wrapped. */
	raw?: {
		response?: {
			status?: unknown;
			errors?: Array<{ extensions?: { code?: unknown } }>;
		};
	};
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** HTTP status of a rejected request, or `null` if no response arrived. */
export function graphQLErrorHttpStatus(error: unknown): number | null {
	if (typeof error !== "object" || error === null) {
		return null;
	}
	const rejection = error as GraphQLRejection;
	return (
		asNumber(rejection.status) ??
		asNumber(rejection.response?.status) ??
		asNumber(rejection.response?.statusCode) ??
		asNumber(rejection.raw?.response?.status)
	);
}

/** First GraphQL error's `extensions.code`, or `null` when absent. */
export function graphQLErrorCode(error: unknown): string | null {
	if (typeof error !== "object" || error === null) {
		return null;
	}
	const rejection = error as GraphQLRejection;
	return (
		asString(rejection.response?.errors?.[0]?.extensions?.code) ??
		asString(rejection.raw?.response?.errors?.[0]?.extensions?.code)
	);
}

/** True when an HTTP status alone justifies a retry. */
export function isRetryableHttpStatus(status: number | null): boolean {
	if (status === null) {
		return false;
	}
	return RETRYABLE_HTTP_STATUSES.includes(status) || status >= 500;
}

/** True when a GraphQL `extensions.code` alone justifies a retry. */
export function isRetryableGraphQLCode(code: string | null): boolean {
	return code !== null && RETRYABLE_GRAPHQL_ERROR_CODES.includes(code);
}

/**
 * The retryable verdict, from the status, the code, and the message.
 *
 * "Retryable" here means *the failure is transient* — a caller that waits
 * an appropriate interval could succeed. It is NOT the same question as
 * `isTransientGraphQLError` in `graphql-service.ts`, which gates this CLI's
 * own immediate 150 ms / 400 ms retry: a rate limit is transient (so
 * `retryable: true`) but a terrible candidate for an immediate retry.
 *
 * The last arm is the one that is easy to get wrong: a rejection carrying
 * NEITHER a status NOR a code never got an answer out of Linear at all —
 * DNS, a refused connection, a dropped socket — and those are exactly the
 * failures worth retrying. Every failure Linear itself produced arrives
 * with a status (`LinearError.status` is set from the HTTP response), so
 * this arm cannot swallow a permanent schema or permission error. Leaving
 * it to the message regex alone would misclassify any transport failure
 * whose wording is not in the list, which is unbounded.
 */
export function classifyGraphQLFailure(
	httpStatus: number | null,
	code: string | null,
	message: string,
): boolean {
	if (isRetryableHttpStatus(httpStatus) || isRetryableGraphQLCode(code)) {
		return true;
	}
	if (httpStatus === null && code === null) {
		return true;
	}
	return TRANSIENT_TRANSPORT_MESSAGE_RE.test(message);
}

/**
 * A Linear GraphQL failure that carries its own classification.
 *
 * The `message` is unchanged from what the plain `Error` used to carry, so
 * every existing consumer that matches on the message text keeps working;
 * the classification is purely additive.
 */
export class LinearGraphQLError extends Error {
	readonly httpStatus: number | null;
	readonly code: string | null;
	readonly retryable: boolean;

	constructor(message: string, detail: LinearGraphQLErrorDetail) {
		super(message);
		this.name = "LinearGraphQLError";
		this.httpStatus = detail.httpStatus;
		this.code = detail.code;
		this.retryable = detail.retryable;
	}

	get detail(): LinearGraphQLErrorDetail {
		return {
			httpStatus: this.httpStatus,
			code: this.code,
			retryable: this.retryable,
		};
	}
}

/**
 * Wrap a rejection from the Linear GraphQL client in a classified error,
 * keeping `message` exactly as the caller composed it.
 *
 * This is the seam every throw out of `GraphQLService.rawRequest` must pass
 * through. A branch that builds its own message and throws a bare `Error`
 * instead — a rate-limit path with a friendlier wording, say — produces a
 * failure with NO `errorDetail` on the envelope, which is precisely the
 * blindness DEV-7987 exists to remove, and it fails silently.
 */
export function toLinearGraphQLError(
	error: unknown,
	message: string,
): LinearGraphQLError {
	const httpStatus = graphQLErrorHttpStatus(error);
	const code = graphQLErrorCode(error);
	return new LinearGraphQLError(message, {
		httpStatus,
		code,
		// Classify off the ORIGINAL rejection's text, not the composed
		// `message`: the transport arm needs the client's own wording
		// (`fetch failed`), which a composed message may have replaced.
		retryable: classifyGraphQLFailure(
			httpStatus,
			code,
			error instanceof Error ? error.message : String(error),
		),
	});
}

/**
 * Read the classification off an arbitrary thrown value, or `null` when it
 * carries none. Structural rather than `instanceof` so a
 * `LinearGraphQLError` that crossed a module-instance boundary (a vitest
 * mock, a duplicated dependency copy) is still recognized — the envelope
 * contract must not depend on prototype identity.
 */
export function readGraphQLErrorDetail(
	error: unknown,
): LinearGraphQLErrorDetail | null {
	if (typeof error !== "object" || error === null) {
		return null;
	}
	const candidate = error as {
		httpStatus?: unknown;
		code?: unknown;
		retryable?: unknown;
	};
	if (typeof candidate.retryable !== "boolean") {
		return null;
	}
	return {
		httpStatus: asNumber(candidate.httpStatus),
		code: asString(candidate.code),
		retryable: candidate.retryable,
	};
}
