import { loadConfig } from "../config/config.js";

/**
 * Append a footer to a body string.
 *
 * Resolution order:
 *   1. `--no-footer` flag → return body unchanged
 *   2. `--footer <text>` flag → use the explicit value
 *   3. `config.messageFooter` → use the configured value
 *   4. nothing set → return body unchanged
 *
 * The footer is treated as a literal string — callers who want a horizontal
 * rule or blank line before it must include the separator in the value.
 *
 * Used on `create` paths only (issues create, comments create). Update paths
 * take an explicit body the user has already authored, so we don't auto-inject.
 */
export function applyFooter(
	body: string | undefined,
	options: { footer?: string; noFooter?: boolean },
): string | undefined {
	if (options.noFooter) {
		return body;
	}
	const explicit = options.footer;
	const footer = explicit ?? loadConfig().messageFooter;
	if (!footer) {
		return body;
	}
	return body ? `${body}${footer}` : footer;
}
