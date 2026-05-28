import dns from "node:dns";
import net from "node:net";

/**
 * Injectable seams for the two Node defaults we flip. Real callers use the
 * `node:dns` / `node:net` implementations; tests pass spies.
 */
export interface NetworkPreferenceDeps {
	setDefaultResultOrder: (
		order: "ipv4first" | "ipv6first" | "verbatim",
	) => void;
	setDefaultAutoSelectFamily: (value: boolean) => void;
}

const defaultDeps: NetworkPreferenceDeps = {
	// Wrapped (not passed by reference) so the receiver keeps its module binding.
	setDefaultResultOrder: (order) => dns.setDefaultResultOrder(order),
	setDefaultAutoSelectFamily: (value) => net.setDefaultAutoSelectFamily(value),
};

/** Set this env var to `1` to keep Node's native behavior (see below). */
export const VERBATIM_ENV = "EL_LINEAR_NETWORK_VERBATIM";

/**
 * Prefer IPv4 for el-linear's outbound API calls.
 *
 * el-linear talks only to `api.linear.app` (Cloudflare, dual-stack — it
 * publishes AAAA records). On a network whose IPv6 route is broken or
 * blackholed, Node 17+'s defaults — DNS result order `verbatim` (often
 * IPv6-first) plus Happy Eyeballs (`autoSelectFamily`) — make `fetch`
 * (undici) stall on the dead IPv6 path until it times out, surfacing as
 * `GraphQL request failed: fetch failed`. Restoring `ipv4first` AND disabling
 * `autoSelectFamily` makes el-linear use the working IPv4 path directly.
 * (`ipv4first` alone is not enough — Happy Eyeballs still races the dead IPv6
 * address; both levers are required.) `ipv4first` was Node's own default
 * before v17, so this is a conservative choice.
 *
 * Opt out with `EL_LINEAR_NETWORK_VERBATIM=1` — required only on pure
 * IPv6-only networks (no IPv4 route at all), where preferring IPv4 would pick
 * an unreachable address. See DEV-4415.
 *
 * @returns `true` if the IPv4 preference was applied, `false` if opted out.
 */
export function applyIpv4Preference(
	env: NodeJS.ProcessEnv = process.env,
	deps: NetworkPreferenceDeps = defaultDeps,
): boolean {
	if (env[VERBATIM_ENV] === "1") {
		return false;
	}
	deps.setDefaultResultOrder("ipv4first");
	deps.setDefaultAutoSelectFamily(false);
	return true;
}
