import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDescription } from "./description.js";

/**
 * Composition test for the DEV-6315 guard: the real create/update description
 * resolution path must reject an issue's own JSON envelope (the corruption that
 * overwrote DEV-6092 / DEV-6042), through both --description and
 * --description-file, and honor the --allow-json-description override.
 */

const ENVELOPE = JSON.stringify({
	id: "uuid-1",
	identifier: "DEV-6092",
	title: "Some issue",
	description: "## Real body",
	branchName: "dev-6092-some-issue",
	state: { name: "Todo" },
});

const tmpDirs: string[] = [];
function writeTemp(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "el-linear-desc-"));
	tmpDirs.push(dir);
	const path = join(dir, "body.md");
	writeFileSync(path, contents);
	return path;
}

afterEach(() => {
	while (tmpDirs.length) {
		rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
	}
});

describe("resolveDescription envelope guard (DEV-6315)", () => {
	it("blocks an envelope passed via --description", () => {
		expect(() => resolveDescription({ description: ENVELOPE })).toThrow(
			/JSON envelope/i,
		);
	});

	it("blocks an envelope passed via --description-file", () => {
		const path = writeTemp(ENVELOPE);
		expect(() => resolveDescription({ descriptionFile: path })).toThrow(
			/JSON envelope/i,
		);
	});

	it("allows the envelope through with --allow-json-description", () => {
		expect(
			resolveDescription({
				description: ENVELOPE,
				allowJsonDescription: true,
			}),
		).toBe(ENVELOPE);
	});

	it("passes a normal markdown body untouched", () => {
		const body = "## Heading\n\nProse referencing DEV-1.";
		expect(resolveDescription({ description: body })).toBe(body);
	});
});
