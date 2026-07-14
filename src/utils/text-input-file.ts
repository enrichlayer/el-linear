import fs from "node:fs";

/**
 * Read the body for a `--*-file` flag: a path on disk, or `-` for stdin.
 *
 * These flags exist to keep large markdown bodies away from the shell. The
 * workaround they replace — `--content "$(cat body.md)"` — hands the file's
 * bytes to the shell first, so backticks, `$`, and nested quotes inside the
 * markdown get interpolated before the CLI ever sees them. Reading the path
 * ourselves means the bytes arrive exactly as authored.
 *
 * For the same reason the content is used verbatim: no escape-sequence
 * normalization. That is `normalizeInlineTextInput`'s job for the *inline*
 * flags, where a user typing `\n` at a shell prompt means a newline. In a file,
 * a literal `\n` inside a fenced code block is content, and rewriting it would
 * corrupt the document.
 *
 * `label` names the subject in the not-found error, so each flag reports itself
 * ("Description file not found: …", "Content file not found: …").
 *
 * Single source of truth for `issues --description-file` and `projects
 * --content-file` (DEV-6033) — the two are specified to behave identically, so
 * they share one implementation rather than two that drift.
 */
export function readTextInputFile(filePath: string, label: string): string {
	if (filePath === "-") {
		return fs.readFileSync(0, "utf8").trim();
	}
	if (!fs.existsSync(filePath)) {
		throw new Error(`${label} file not found: ${filePath}`);
	}
	return fs.readFileSync(filePath, "utf8").trim();
}
