import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LinearCredential } from "../auth/linear-credential.js";
import { atomicWrite, withFileLock } from "../auth/oauth-fs.js";
import type { RateLimitInfo } from "./output.js";

const STATE_VERSION = 1;

interface QuotaState {
	v: typeof STATE_VERSION;
	limit?: number;
	remaining: number;
	resetAt?: string;
	observedAt: number;
}

export interface RateLimitAdmission {
	readonly enabled: boolean;
	admit(): Promise<void>;
	observe(info: RateLimitInfo): Promise<void>;
}

export interface RateLimitAdmissionOptions {
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	stateRoot?: string;
}

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
	const statePath = path.join(
		options.stateRoot ?? defaultStateRoot(env),
		`${quotaKey(auth, env)}.json`,
	);

	return {
		enabled: true,
		async admit(): Promise<void> {
			await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
			await withFileLock(statePath, async () => {
				const state = await readState(statePath);
				if (!state) return;
				const resetAtMs = state.resetAt
					? Date.parse(state.resetAt)
					: Number.NaN;
				if (Number.isFinite(resetAtMs) && now() >= resetAtMs) {
					// Permit exactly one probe into the new window. Closing the local
					// gate before releasing the lock prevents every waiting process
					// from seeing the same expired state and stampeding the reset.
					// Its response headers will reopen the gate with authoritative
					// capacity; a headerless failure remains safely pessimistic.
					await writeState(statePath, {
						...state,
						remaining: headroom,
						resetAt: undefined,
						observedAt: now(),
					});
					return;
				}
				if (state.remaining <= headroom) {
					const reset = state.resetAt ? ` until ${state.resetAt}` : "";
					throw new Error(
						`Linear rate limit exceeded before request; admission refused: ${state.remaining} requests remain, preserving configured headroom ${headroom}${reset}.`,
					);
				}
				// Reserve one request while holding the process-shared lock. The
				// response observation will replace this pessimistic estimate with
				// Linear's authoritative remaining count.
				await writeState(statePath, {
					...state,
					remaining: state.remaining - 1,
					observedAt: now(),
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
