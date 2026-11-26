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
		return readStdinSync().trim();
	}
	if (!fs.existsSync(filePath)) {
		throw new Error(`${label} file not found: ${filePath}`);
	}
	return fs.readFileSync(filePath, "utf8").trim();
}

/** Nonblocking stdin can temporarily have no bytes without reaching EOF. */
function readStdinSync(): string {
	const buffer = Buffer.alloc(65536);
	const wait = new Int32Array(new SharedArrayBuffer(4));
	const chunks: Buffer[] = [];
	for (;;) {
		let length: number;
		try {
			length = fs.readSync(0, buffer, 0, buffer.length, null);
		} catch (error) {
			const code =
				error !== null && typeof error === "object"
					? (error as NodeJS.ErrnoException).code
					: undefined;
			if (code === "EAGAIN" || code === "EWOULDBLOCK") {
				Atomics.wait(wait, 0, 0, 10);
				continue;
			}
			throw error;
		}
		if (length === 0) break;
		chunks.push(Buffer.from(buffer.subarray(0, length)));
	}
	// Decode after joining: one Unicode character may span multiple pipe reads.
	return Buffer.concat(chunks).toString("utf8");
}
