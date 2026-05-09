/**
 * Headless OAuth fallback: print the authorize URL, ask the user to open
 * it in any browser, then paste the redirected URL (or just the `code`
 * fragment) back into the terminal.
 *
 * This is the escape hatch for environments where:
 *   - The CLI can't open a browser (SSH session, remote shell).
 *   - The user explicitly passes `--no-browser`.
 *   - The localhost listener fails (port in use, firewall, restricted
 *     container).
 *
 * Linear's OAuth app config requires a redirect URI matching the
 * `redirect_uri` we sent. If the user is somewhere they can't run a
 * localhost listener, they can still paste the full callback URL —
 * Linear's redirect happens client-side in the browser regardless of
 * whether the URL is reachable.
 */

import { input } from "@inquirer/prompts";
import { type CallbackParams, parseCallbackUrl } from "./oauth-client.js";

export interface PromptForPastedCodeOptions {
	expectedState: string;
	/**
	 * Allow the user to paste a bare authorization code without a
	 * surrounding URL. Defeats the OAuth `state` CSRF check (we can't
	 * verify state without the URL), so it's gated behind explicit
	 * opt-in. Default: false — paste the full callback URL.
	 */
	unsafeBareCode?: boolean;
	/** Test seam — defaults to @inquirer/prompts `input`. */
	prompt?: (opts: {
		message: string;
		validate?: (value: string) => boolean | string;
	}) => Promise<string>;
}

/**
 * Ask the user to paste the full OAuth callback URL. We parse `code`
 * and `state`, then verify `state` matches what we sent.
 *
 * Bare `code` pastes (no URL) are rejected by default because we have
 * no way to verify the `state` parameter — the entire CSRF protection
 * collapses if we silently accept the expected state on the user's
 * behalf. Opt in with `--unsafe-bare-code` (`unsafeBareCode: true`).
 */
export async function promptForPastedCode(
	options: PromptForPastedCodeOptions,
): Promise<CallbackParams> {
	const ask = options.prompt ?? ((o) => input(o));
	const message = options.unsafeBareCode
		? "Paste the full callback URL (or just the `code` value, since --unsafe-bare-code was set):"
		: "Paste the full callback URL (it includes both `code` and `state`):";
	const raw = (
		await ask({
			message,
			validate: (value) => value.trim().length > 0 || "Cannot be empty",
		})
	).trim();

	if (raw.startsWith("http://") || raw.startsWith("https://")) {
		const parsed = parseCallbackUrl(raw);
		if (parsed.state !== options.expectedState) {
			throw new Error(
				"State mismatch — the pasted URL's `state` doesn't match the value we sent. Re-run `el-linear init oauth`.",
			);
		}
		return parsed;
	}

	// Bare-code pastes are opt-in. Without `unsafeBareCode`, refuse to
	// silently fabricate `state` and bypass CSRF.
	if (!options.unsafeBareCode) {
		throw new Error(
			"Paste the FULL callback URL — bare `code` pastes are disabled because they bypass the OAuth `state` CSRF check. " +
				"Re-run with `--unsafe-bare-code` only if you understand and accept the risk.",
		);
	}

	// Reject anything that looks like a query fragment but isn't a URL
	// (the user partially copied something).
	if (raw.includes("=") || raw.includes("?")) {
		throw new Error(
			"Pasted value looks malformed. Paste either the full callback URL or just the `code` value (alphanumeric + dashes).",
		);
	}
	return { code: raw, state: options.expectedState };
}
