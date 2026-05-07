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
	/** Test seam — defaults to @inquirer/prompts `input`. */
	prompt?: (opts: {
		message: string;
		validate?: (value: string) => boolean | string;
	}) => Promise<string>;
}

/**
 * Ask the user to paste either:
 *   - The full callback URL (we extract code+state ourselves), OR
 *   - Just the `code` value (we accept the user's word on state).
 *
 * For the URL form, state is validated against `expectedState`.
 *
 * Returns `{code, state}`. When the user pasted only a code, `state` is
 * the expected value (the user has implicitly trusted it; we have no
 * other check available).
 */
export async function promptForPastedCode(
	options: PromptForPastedCodeOptions,
): Promise<CallbackParams> {
	const ask = options.prompt ?? ((o) => input(o));
	const raw = (
		await ask({
			message: "Paste the full callback URL (or just the `code` value):",
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

	// Bare code path. Reject anything that looks like it has a query
	// string but isn't a URL (the user partially copied something).
	if (raw.includes("=") || raw.includes("?")) {
		throw new Error(
			"Pasted value looks malformed. Paste either the full callback URL or just the `code` value (alphanumeric + dashes).",
		);
	}
	return { code: raw, state: options.expectedState };
}
