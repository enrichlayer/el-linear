import { describe, expect, it } from "vitest";
import { markdownToProseMirror, parseInline } from "./markdown-prosemirror.js";

describe("markdownToProseMirror", () => {
	it("converts plain paragraph", () => {
		const doc = markdownToProseMirror("Hello world");
		expect(doc).toEqual({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
			],
		});
	});

	it("converts multiple paragraphs separated by blank lines", () => {
		const doc = markdownToProseMirror("First paragraph\n\nSecond paragraph");
		expect(doc.content).toHaveLength(2);
		expect(doc.content![0].type).toBe("paragraph");
		expect(doc.content![1].type).toBe("paragraph");
	});

	it("converts headings", () => {
		const doc = markdownToProseMirror("# Title\n\n## Subtitle\n\n### H3");
		expect(doc.content).toHaveLength(3);
		expect(doc.content![0]).toEqual({
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "Title" }],
		});
		expect(doc.content![1].attrs).toEqual({ level: 2 });
		expect(doc.content![2].attrs).toEqual({ level: 3 });
	});

	it("converts bullet lists", () => {
		const doc = markdownToProseMirror("- Item one\n- Item two\n- Item three");
		expect(doc.content).toHaveLength(1);
		const list = doc.content![0];
		expect(list.type).toBe("bulletList");
		expect(list.content).toHaveLength(3);
		expect(list.content![0].type).toBe("listItem");
		expect(list.content![0].content![0].content![0].text).toBe("Item one");
	});

	it("converts ordered lists", () => {
		const doc = markdownToProseMirror("1. First\n2. Second");
		expect(doc.content).toHaveLength(1);
		const list = doc.content![0];
		expect(list.type).toBe("orderedList");
		expect(list.content).toHaveLength(2);
	});

	it("converts fenced code blocks", () => {
		const doc = markdownToProseMirror("```typescript\nconst x = 1;\n```");
		expect(doc.content).toHaveLength(1);
		const block = doc.content![0];
		expect(block.type).toBe("codeBlock");
		expect(block.attrs).toEqual({ language: "typescript" });
		expect(block.content![0].text).toBe("const x = 1;");
	});

	it("converts code blocks without language", () => {
		const doc = markdownToProseMirror("```\nsome code\n```");
		const block = doc.content![0];
		expect(block.type).toBe("codeBlock");
		expect(block.attrs).toBeUndefined();
	});

	it("converts blockquotes", () => {
		const doc = markdownToProseMirror("> This is a quote");
		expect(doc.content).toHaveLength(1);
		const quote = doc.content![0];
		expect(quote.type).toBe("blockquote");
		expect(quote.content![0].type).toBe("paragraph");
	});

	it("converts horizontal rules", () => {
		const doc = markdownToProseMirror("---");
		expect(doc.content).toHaveLength(1);
		expect(doc.content![0].type).toBe("horizontalRule");
	});

	it("handles mixed content", () => {
		const md = [
			"# Report",
			"",
			"Some intro text.",
			"",
			"- Point one",
			"- Point two",
			"",
			"```js",
			"console.log('hi');",
			"```",
			"",
			"> A final note",
		].join("\n");

		const doc = markdownToProseMirror(md);
		const types = doc.content!.map((n) => n.type);
		expect(types).toEqual([
			"heading",
			"paragraph",
			"bulletList",
			"codeBlock",
			"blockquote",
		]);
	});
});

describe("parseInline", () => {
	it("parses plain text", () => {
		const nodes = parseInline("Hello world");
		expect(nodes).toEqual([{ type: "text", text: "Hello world" }]);
	});

	it("parses bold text", () => {
		const nodes = parseInline("Hello **world**");
		expect(nodes).toHaveLength(2);
		expect(nodes[1]).toEqual({
			type: "text",
			text: "world",
			marks: [{ type: "bold" }],
		});
	});

	it("parses italic text", () => {
		const nodes = parseInline("Hello *world*");
		expect(nodes).toHaveLength(2);
		expect(nodes[1]).toEqual({
			type: "text",
			text: "world",
			marks: [{ type: "italic" }],
		});
	});

	it("parses inline code", () => {
		const nodes = parseInline("Use `npm install`");
		expect(nodes).toHaveLength(2);
		expect(nodes[1]).toEqual({
			type: "text",
			text: "npm install",
			marks: [{ type: "code" }],
		});
	});

	it("parses links", () => {
		const nodes = parseInline("See [docs](https://example.com)");
		expect(nodes).toHaveLength(2);
		expect(nodes[1]).toEqual({
			type: "text",
			text: "docs",
			marks: [{ type: "link", attrs: { href: "https://example.com" } }],
		});
	});

	it("drops the link mark when the href uses an unsafe scheme", () => {
		// javascript: / data: / vbscript: hrefs are silently dropped — the
		// label remains as plain text but the link mark is gone, so we never
		// ship XSS-shaped ProseMirror docs into Linear comments.
		for (const href of [
			"javascript:alert(1)",
			"data:text/html,<script>x</script>",
			"vbscript:msgbox()",
			"file:///etc/passwd",
		]) {
			const nodes = parseInline(`see [click](${href})`);
			const linked = nodes.find((n) => n.marks?.some((m) => m.type === "link"));
			expect(linked).toBeUndefined();
			// The plain text rendering should still include the original
			// brackets / parens because we never matched the link.
			const combined = nodes.map((n) => n.text ?? "").join("");
			expect(combined).toContain("click");
		}
	});

	it("keeps mailto: and linear: as safe schemes", () => {
		for (const href of ["mailto:hi@example.com", "linear:DEV-1"]) {
			const nodes = parseInline(`see [contact](${href})`);
			const linked = nodes.find((n) => n.marks?.some((m) => m.type === "link"));
			expect(linked?.marks?.[0]?.attrs?.href).toBe(href);
		}
	});

	it("keeps schemeless / relative links as safe", () => {
		// Relative paths and fragment-only hrefs pass through; the renderer
		// resolves them against the document base.
		for (const href of ["/docs", "../page", "#anchor"]) {
			const nodes = parseInline(`see [link](${href})`);
			const linked = nodes.find((n) => n.marks?.some((m) => m.type === "link"));
			expect(linked?.marks?.[0]?.attrs?.href).toBe(href);
		}
	});

	it("parses multiple inline marks in sequence", () => {
		const nodes = parseInline("**bold** then `code`");
		expect(nodes).toHaveLength(3);
		expect(nodes[0].marks![0].type).toBe("bold");
		expect(nodes[1].text).toBe(" then ");
		expect(nodes[2].marks![0].type).toBe("code");
	});
});

describe("table support", () => {
	it("converts a markdown table to ProseMirror table node", () => {
		const md = `| Vendor | Purpose |
| --- | --- |
| Stripe | Payments |
| Sentry | Errors |`;
		const doc = markdownToProseMirror(md);
		expect(doc.content).toHaveLength(1);
		expect(doc.content![0].type).toBe("table");
		const rows = doc.content![0].content!;
		expect(rows).toHaveLength(3); // header + 2 body rows
		expect(rows[0].content![0].type).toBe("tableHeader");
		expect(rows[0].content![0].content![0].content![0].text).toBe("Vendor");
		expect(rows[1].content![0].type).toBe("tableCell");
		expect(rows[1].content![0].content![0].content![0].text).toBe("Stripe");
	});

	it("does not treat pipe-only lines as tables without separator", () => {
		const md = "| not a table |";
		const doc = markdownToProseMirror(md);
		expect(doc.content![0].type).toBe("paragraph");
	});

	it("handles inline formatting in table cells", () => {
		const md = `| Name | Status |
| --- | --- |
| **Stripe** | \`active\` |`;
		const doc = markdownToProseMirror(md);
		const bodyRow = doc.content![0].content![1];
		const nameCell = bodyRow.content![0].content![0].content![0];
		expect(nameCell.marks![0].type).toBe("bold");
		expect(nameCell.text).toBe("Stripe");
	});

	it("treats escaped pipes as literal characters inside cells", () => {
		const md = `| Pattern | Description |
| --- | --- |
| \\|-delimited\\| | uses a pipe |`;
		const doc = markdownToProseMirror(md);
		const bodyRow = doc.content![0].content![1];
		expect(bodyRow.content).toHaveLength(2);
		const patternText = bodyRow.content![0].content![0].content![0].text;
		expect(patternText).toBe("|-delimited|");
	});

	it("pads body rows with empty cells to match header column count", () => {
		const md = `| A | B | C |
| --- | --- | --- |
| x | y |`;
		const doc = markdownToProseMirror(md);
		const bodyRow = doc.content![0].content![1];
		expect(bodyRow.content).toHaveLength(3);
		expect(bodyRow.content![2].type).toBe("tableCell");
		expect(bodyRow.content![2].content![0].content).toEqual([]);
	});

	it("truncates body rows to match header column count", () => {
		const md = `| A | B |
| --- | --- |
| x | y | extra |`;
		const doc = markdownToProseMirror(md);
		const bodyRow = doc.content![0].content![1];
		expect(bodyRow.content).toHaveLength(2);
		expect(bodyRow.content![1].content![0].content![0].text).toBe("y");
	});

	it("renders empty cells as empty paragraph content (valid ProseMirror)", () => {
		const md = `| A | B |
| --- | --- |
| | filled |`;
		const doc = markdownToProseMirror(md);
		const bodyRow = doc.content![0].content![1];
		expect(bodyRow.content![0].content![0].type).toBe("paragraph");
		expect(bodyRow.content![0].content![0].content).toEqual([]);
		expect(bodyRow.content![1].content![0].content![0].text).toBe("filled");
	});
});
