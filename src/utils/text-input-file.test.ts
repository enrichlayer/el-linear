import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTextInputFile } from "./text-input-file.js";

describe("readTextInputFile", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "el-linear-text-input-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function write(name: string, body: string): string {
		const path = join(dir, name);
		writeFileSync(path, body, "utf8");
		return path;
	}

	it("reads a file's contents", () => {
		const path = write("body.md", "# Title\n\nSome prose.");
		expect(readTextInputFile(path, "Content")).toBe("# Title\n\nSome prose.");
	});

	it("trims surrounding whitespace", () => {
		const path = write("body.md", "\n\n# Title\n\n");
		expect(readTextInputFile(path, "Content")).toBe("# Title");
	});

	it("passes shell metacharacters through verbatim", () => {
		// The entire reason these flags exist. Via `--content "$(cat body.md)"` the
		// shell would expand $(whoami) and the backtick span before the CLI ever ran;
		// reading the path ourselves means the bytes arrive exactly as authored.
		const body = [
			"# Deploy",
			"",
			"Run `el-linear projects list` and check $HOME/.config.",
			"",
			"```bash",
			'echo "cost: $100 (100%)" && printf \'%s\\n\' "$(whoami)"',
			"```",
			"",
			'A literal backslash-n: \\n — and a "quoted" phrase.',
		].join("\n");
		const path = write("body.md", body);
		expect(readTextInputFile(path, "Content")).toBe(body);
	});

	it("does NOT normalize escape sequences the way inline flags do", () => {
		// normalizeInlineTextInput turns a typed "\n" into a newline for the INLINE
		// flags. A file must not get that treatment: a literal \n inside a fenced
		// code block is content, and rewriting it would corrupt the document.
		const path = write("body.md", "line1\\nline2");
		expect(readTextInputFile(path, "Content")).toBe("line1\\nline2");
	});

	it("names the flag's subject in the not-found error", () => {
		const missing = join(dir, "nope.md");
		expect(() => readTextInputFile(missing, "Content")).toThrow(
			`Content file not found: ${missing}`,
		);
		expect(() => readTextInputFile(missing, "Description")).toThrow(
			`Description file not found: ${missing}`,
		);
	});
});
