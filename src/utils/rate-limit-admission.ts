import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LinearCredential } from "../auth/linear-credential.js";
import { atomicWrite, withFileLock } from "../auth/oauth-fs.js";
import type { RateLimitInfo } from "./output.js";

const STATE_VERSION = 1;
const PROBE_LEASE_MS = 30_000;

interface QuotaState {
	v: typeof STATE_VERSION;
	limit?: number;
	remaining: number;
	resetAt?: string;
	observedAt: number;
	probeUntil?: number;
}

export interface RateLimitAdmission {
	readonly enabled: boolean;
	admit(): Promise<void>;
	observe(info: RateLimitInfo): Promise<void>;
}

/** A local/coordinator quota gate refused before any Linear request was sent. */
export class RateLimitAdmissionRefusal extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RateLimitAdmissionRefusal";
	}
}

export interface RateLimitAdmissionOptions {
	env?: NodeJS.ProcessEnv;
	fetchImpl?: CoordinatorFetchLike;
	now?: () => number;
	stateRoot?: string;
}

type CoordinatorFetchLike = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body: string;
	},
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function parseHeadroom(env: NodeJS.ProcessEnv): number {
	const raw = env.EL_LINEAR_RATE_LIMIT_HEADROOM?.trim();
	if (!raw) return 0;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(
			"EL_LINEAR_RATE_LIMIT_HEADROOM must be a non-negative integer.",
		);
	}
	return value;
}

function quotaKey(auth: LinearCredential, env: NodeJS.ProcessEnv): string {
	const explicit = env.EL_LINEAR_QUOTA_KEY?.trim();
	const source =
		explicit || ("oauthToken" in auth ? auth.oauthToken : auth.apiKey);
	return createHash("sha256").update(source).digest("hex");
}

function coordinatorUrl(env: NodeJS.ProcessEnv): string | null {
	const raw = env.EL_LINEAR_RATE_LIMIT_COORDINATOR_URL?.trim();
	if (!raw) return null;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(
			"EL_LINEAR_RATE_LIMIT_COORDINATOR_URL must be a valid URL.",
		);
	}
	if (!/^https?:$/.test(parsed.protocol)) {
		throw new Error(
			"EL_LINEAR_RATE_LIMIT_COORDINATOR_URL must use HTTPS (HTTP is allowed only for loopback development).",
		);
	}
	const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
	if (parsed.protocol === "http:" && !loopbackHosts.has(parsed.hostname)) {
		throw new Error(
			"EL_LINEAR_RATE_LIMIT_COORDINATOR_URL must use HTTPS; bearer credentials may use HTTP only with a loopback host.",
		);
	}
	return parsed.toString().replace(/\/$/, "");
}

function createCoordinatorAdmission(
	key: string,
	headroom: number,
	baseUrl: string,
	token: string,
	fetchImpl: CoordinatorFetchLike,
): RateLimitAdmission {
	const post = async (
		action: "admit" | "observe",
		body: Record<string, unknown>,
	): Promise<{ status: number; payload: unknown }> => {
		const response = await fetchImpl(
			`${baseUrl}/v1/quota/${encodeURIComponent(key)}/${action}`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			},
		);
		const payload = await response.json().catch(() => null);
		if (!(response.ok || (action === "admit" && response.status === 429))) {
			throw new Error(
				`Linear quota coordinator ${action} failed with HTTP ${response.status}.`,
			);
		}
		return { status: response.status, payload };
	};

	return {
		enabled: true,
		async admit(): Promise<void> {
			const result = await post("admit", { headroom, cost: 1 });
			if (result.status !== 429) return;
			const state = (
				result.payload as { state?: { remaining?: number; resetAt?: string } }
			)?.state;
			const remaining = state?.remaining ?? 0;
			const reset = state?.resetAt ? ` until ${state.resetAt}` : "";
			throw new RateLimitAdmissionRefusal(
				`Linear rate limit exceeded before request; distributed admission refused: ${remaining} requests remain, preserving configured headroom ${headroom}${reset}.`,
			);
		},
		async observe(info: RateLimitInfo): Promise<void> {
			if (info.remaining === undefined) return;
			await post("observe", {
				limit: info.limit,
				remaining: info.remaining,
				resetAt: info.resetAt,
			});
		},
	};
}

function defaultStateRoot(env: NodeJS.ProcessEnv): string {
	const stateHome =
		env.XDG_STATE_HOME?.trim() || path.join(os.homedir(), ".local", "state");
	return path.join(stateHome, "el-linear", "rate-limit");
}

async function readState(statePath: string): Promise<QuotaState | null> {
	try {
		const parsed = JSON.parse(
			await fs.readFile(statePath, "utf8"),
		) as QuotaState;
		if (
			parsed?.v !== STATE_VERSION ||
			typeof parsed.remaining !== "number" ||
			typeof parsed.observedAt !== "number"
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

async function writeState(statePath: string, state: QuotaState): Promise<void> {
	await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
	await atomicWrite(statePath, `${JSON.stringify(state)}\n`, 0o600);
}

export function createRateLimitAdmission(
	auth: LinearCredential,
	options: RateLimitAdmissionOptions = {},
): RateLimitAdmission {
	const env = options.env ?? process.env;
	const headroom = parseHeadroom(env);
	if (headroom === 0) {
		return {
			enabled: false,
			admit: async () => {},
			observe: async () => {},
		};
	}

	const now = options.now ?? Date.now;
	const key = quotaKey(auth, env);
	const remote = coordinatorUrl(env);
	if (remote) {
		const token = env.EL_LINEAR_RATE_LIMIT_COORDINATOR_TOKEN?.trim();
		if (!token) {
			throw new Error(
				"EL_LINEAR_RATE_LIMIT_COORDINATOR_TOKEN is required when the coordinator URL is configured.",
			);
		}
		const fetchImpl: CoordinatorFetchLike =
			options.fetchImpl ??
			(async (url, init) => {
				const response = await globalThis.fetch(url, init);
				return {
					ok: response.ok,
					status: response.status,
					json: () => response.json(),
				};
			});
		return createCoordinatorAdmission(key, headroom, remote, token, fetchImpl);
	}
	const statePath = path.join(
		options.stateRoot ?? defaultStateRoot(env),
		`${key}.json`,
	);

	return {
		enabled: true,
		async admit(): Promise<void> {
			await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
			await withFileLock(statePath, async () => {
				const state = await readState(statePath);
				const currentTime = now();
				if (!state) {
					await writeState(statePath, {
						v: STATE_VERSION,
						remaining: headroom,
						observedAt: currentTime,
						probeUntil: currentTime + PROBE_LEASE_MS,
					});
					return;
				}
				const resetAtMs = state.resetAt
					? Date.parse(state.resetAt)
					: Number.NaN;
				const leaseExpired =
					state.probeUntil !== undefined && currentTime >= state.probeUntil;
				if (
					(Number.isFinite(resetAtMs) && currentTime >= resetAtMs) ||
					leaseExpired
				) {
					// Permit exactly one probe into the new window. Closing the local
					// gate before releasing the lock prevents every waiting process
					// from seeing the same expired state and stampeding the reset.
					// Its response headers reopen the gate with authoritative capacity;
					// a headerless failure remains pessimistic until the bounded lease
					// permits exactly one recovery probe.
					await writeState(statePath, {
						...state,
						remaining: headroom,
						resetAt: undefined,
						observedAt: currentTime,
						probeUntil: currentTime + PROBE_LEASE_MS,
					});
					return;
				}
				if (state.probeUntil !== undefined) {
					throw new RateLimitAdmissionRefusal(
						`Linear rate limit probe is already in flight; admission refused while preserving configured headroom ${headroom}.`,
					);
				}
				if (state.remaining <= headroom) {
					const reset = state.resetAt ? ` until ${state.resetAt}` : "";
					throw new RateLimitAdmissionRefusal(
						`Linear rate limit exceeded before request; admission refused: ${state.remaining} requests remain, preserving configured headroom ${headroom}${reset}.`,
					);
				}
				// Reserve one request while holding the process-shared lock. The
				// response observation will replace this pessimistic estimate with
				// Linear's authoritative remaining count.
				await writeState(statePath, {
					...state,
					remaining: state.remaining - 1,
					observedAt: currentTime,
				});
			});
		},
		async observe(info: RateLimitInfo): Promise<void> {
			if (info.remaining === undefined) return;
			await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
			await withFileLock(statePath, async () => {
				const existing = await readState(statePath);
				const sameWindow =
					existing?.resetAt !== undefined &&
					info.resetAt !== undefined &&
					existing.resetAt === info.resetAt;
				// Concurrent responses can arrive out of order. Within one Linear
				// window the remaining count only moves downward, so retaining the
				// lower observation prevents a stale response from refunding quota.
				const remaining = sameWindow
					? Math.min(existing.remaining, info.remaining as number)
					: (info.remaining as number);
				await writeState(statePath, {
					v: STATE_VERSION,
					limit: info.limit,
					remaining,
					resetAt: info.resetAt,
					observedAt: now(),
					probeUntil: undefined,
				});
			});
		},
	};
}

/** Keep local OAuth quota state stable when a profile refreshes its token. */
export function createOAuthProfileRateLimitAdmission(
	auth: Extract<LinearCredential, { oauthToken: string }>,
	clientId: string,
	viewerId?: string,
): RateLimitAdmission {
	const quotaKey = viewerId
		? `oauth:${clientId}:${viewerId}`
		: `oauth:${clientId}`;
	return createRateLimitAdmission(auth, {
		env: {
			...process.env,
			EL_LINEAR_QUOTA_KEY: process.env.EL_LINEAR_QUOTA_KEY?.trim() || quotaKey,
		},
	});
}
