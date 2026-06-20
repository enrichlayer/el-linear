/**
 * Optional, opt-in resolution against the company-wide identity registry
 * (DEV-4827 / DEV-4871). EL-only: this activates **solely** when
 * `EL_IDENTITY_URL` is set. el-linear is MIT/open-source — a non-EL install
 * leaves this dormant (no network, no config, nothing written), and the package
 * never takes a dependency on EL-internal infrastructure. It mirrors the
 * env-gated CF-Access pattern of the tools `@enrichlayer/el-identity` client but
 * is kept self-contained so the OSS package carries no private dependency.
 *
 * The registry is an *enhancement* for EL users: callers try it first, then fall
 * back to the bundled config (`resolveMember`). It must never throw or break a
 * command because the registry is unreachable.
 */

const URL_ENV = "EL_IDENTITY_URL";
const CF_ID_ENV = "EL_IDENTITY_CF_ACCESS_CLIENT_ID";
const CF_SECRET_ENV = "EL_IDENTITY_CF_ACCESS_CLIENT_SECRET";
const TIMEOUT_MS = 8000;

/** True only when the registry is explicitly configured (opt-in). */
export function isRegistryConfigured(
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return Boolean(env[URL_ENV]?.trim());
}

/**
 * Resolve any identifier (alias, handle, email, name, Linear UUID) to a Linear
 * UUID via the registry's `GET /api/people/resolve`. Returns `null` when the
 * registry is not configured, when nothing matches, or on **any** failure
 * (unreachable / timeout / CF-Access challenge / malformed response) — the
 * caller falls back to the config-based resolver. Never throws.
 */
export async function resolveViaRegistry(
	identifier: string,
	env: NodeJS.ProcessEnv = process.env,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	const base = env[URL_ENV]?.trim();
	if (!base) {
		return null;
	}

	const headers: Record<string, string> = { Accept: "application/json" };
	const cfId = env[CF_ID_ENV];
	const cfSecret = env[CF_SECRET_ENV];
	if (cfId && cfSecret) {
		headers["CF-Access-Client-Id"] = cfId;
		headers["CF-Access-Client-Secret"] = cfSecret;
	}

	const url = `${base.replace(/\/+$/, "")}/api/people/resolve?identifier=${encodeURIComponent(identifier)}`;
	try {
		const res = await fetchImpl(url, {
			headers,
			// A 3xx is a Cloudflare Access SSO bounce, not a result — `redirect:
			// "manual"` surfaces it as a non-ok status we treat as a miss.
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) {
			return null;
		}
		const record = (await res.json()) as { linearId?: string | null };
		return record?.linearId ?? null;
	} catch {
		return null;
	}
}
