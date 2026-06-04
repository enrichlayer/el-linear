import { describe, expect, it } from "vitest";
import { extractField, extractFields } from "./extract-field.js";

describe("extractField", () => {
	const body = `## Why we need this

Some prose about why.

Multiple paragraphs are fine.

## Done when

- Thing A
- Thing B

## Out of scope

Stuff we won't do.`;

	it("returns the section text between matching ## and the next header", () => {
		expect(extractField(body, "Why we need this")).toBe(
			"Some prose about why.\n\nMultiple paragraphs are fine.",
		);
	});

	it("returns the section text for ### headers too", () => {
		const h3body = "### Step 1\n\nDo X.\n\n### Step 2\n\nDo Y.";
		expect(extractField(h3body, "Step 1")).toBe("Do X.");
	});

	it("matches case-insensitively", () => {
		expect(extractField(body, "done when")).toBe("- Thing A\n- Thing B");
		expect(extractField(body, "DONE WHEN")).toBe("- Thing A\n- Thing B");
	});

	it("matches bold pseudo-headers (e.g. **Done when**)", () => {
		const boldBody = "**Done when**\n\n- A\n- B\n\n**Out of scope**\n\nNope.";
		expect(extractField(boldBody, "Done when")).toBe("- A\n- B");
	});

	it("strips a trailing colon from headers (**Done when:**)", () => {
		const colonBody = "**Done when:**\n\n- A\n\n**Other:**\n\nB";
		expect(extractField(colonBody, "Done when")).toBe("- A");
	});

	it("returns the last section when it runs to EOF", () => {
		expect(extractField(body, "Out of scope")).toBe("Stuff we won't do.");
	});

	it("returns null when the field is not present", () => {
		expect(extractField(body, "Nonexistent section")).toBeNull();
	});

	it("returns null for empty body", () => {
		expect(extractField("", "Done when")).toBeNull();
	});

	it("treats multiple whitespace as a single space (for messy headers)", () => {
		const messy = "## Done   when\n\nstuff";
		expect(extractField(messy, "Done when")).toBe("stuff");
	});

	it("first match wins when the same header appears twice", () => {
		const dup = "## Notes\n\nfirst\n\n## Other\n\nx\n\n## Notes\n\nsecond";
		expect(extractField(dup, "Notes")).toBe("first");
	});

	it("returns an empty string when the section is empty", () => {
		const empty = "## Done when\n\n## Next\n\nx";
		expect(extractField(empty, "Done when")).toBe("");
	});

	it("ignores headers inside fenced code blocks (matches the real section)", () => {
		const body =
			"## Intro\n\nprose\n\n```\n## Done when\nfoo\n```\n\n## Done when\n\nrealcontent";
		expect(extractField(body, "Done when")).toBe("realcontent");
	});

	it("does not terminate the section on a header inside a fenced code block", () => {
		const body = "## Done when\n\nbefore\n\n```\n## Out of scope\n```\n\nafter";
		expect(extractField(body, "Done when")).toBe(
			"before\n\n```\n## Out of scope\n```\n\nafter",
		);
	});

	it("supports tilde-fenced code blocks too", () => {
		const body = "## Done when\n\nbefore\n\n~~~\n## Out of scope\n~~~\n\nafter";
		expect(extractField(body, "Done when")).toBe(
			"before\n\n~~~\n## Out of scope\n~~~\n\nafter",
		);
	});

	it("does NOT treat a long emphasis paragraph as a pseudo-header (>6 words, no colon)", () => {
		// Without the heuristic this 7-word fully-bold line would be treated as
		// a header and prematurely terminate the section.
		const body =
			"**Done when**\n\nfoo\n\n**Note that all downstream consumers must adapt**\n\nbar";
		expect(extractField(body, "Done when")).toBe(
			"foo\n\n**Note that all downstream consumers must adapt**\n\nbar",
		);
	});

	it("DOES treat a short bold line with a trailing colon as a pseudo-header", () => {
		const body = "**Done when:**\n\nfoo\n\n**Note:**\n\nbar";
		expect(extractField(body, "Done when")).toBe("foo");
	});
});

describe("extractFields (multi-section)", () => {
	const BODY = [
		"## Why we need this",
		"Backstory.",
		"",
		"## Done when",
		"- Foo",
		"- Bar",
		"",
		"## Out of scope",
		"Nothing else.",
	].join("\n");

	it("extracts every requested section in caller order", () => {
		const out = extractFields(BODY, [
			"Done when",
			"Out of scope",
			"Why we need this",
		]);
		expect(Array.from(out.keys())).toEqual([
			"Done when",
			"Out of scope",
			"Why we need this",
		]);
		expect(out.get("Done when")).toBe("- Foo\n- Bar");
		expect(out.get("Out of scope")).toBe("Nothing else.");
		expect(out.get("Why we need this")).toBe("Backstory.");
	});

	it("maps missing sections to null (callers distinguish absent from empty)", () => {
		const out = extractFields(BODY, ["Done when", "No such section"]);
		expect(out.get("Done when")).toBe("- Foo\n- Bar");
		expect(out.get("No such section")).toBeNull();
		expect(out.has("No such section")).toBe(true);
	});

	it("returns an empty map for an empty input list", () => {
		const out = extractFields(BODY, []);
		expect(out.size).toBe(0);
	});

	it("collapses duplicate names without crashing (Map semantics)", () => {
		const out = extractFields(BODY, ["Done when", "Done when"]);
		expect(out.size).toBe(1);
		expect(out.get("Done when")).toBe("- Foo\n- Bar");
	});

	it("is case-insensitive on section names just like extractField", () => {
		const out = extractFields(BODY, ["DONE WHEN", "out of scope"]);
		expect(out.get("DONE WHEN")).toBe("- Foo\n- Bar");
		expect(out.get("out of scope")).toBe("Nothing else.");
	});

	it("works on an empty body (every requested section is null)", () => {
		const out = extractFields("", ["Done when", "Out of scope"]);
		expect(out.get("Done when")).toBeNull();
		expect(out.get("Out of scope")).toBeNull();
	});
});
