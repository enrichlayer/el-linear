/**
 * Normalize shell-literal newline escapes in inline CLI text fields.
 *
 * File inputs are intentionally excluded by call site: a file body is already
 * explicit authored text and may intentionally contain backslash sequences.
 */
export function normalizeInlineTextInput(value: string): string {
	return value
		.replace(/\\r\\n/g, "\n")
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\n");
}
