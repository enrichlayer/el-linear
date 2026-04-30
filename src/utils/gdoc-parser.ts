interface GDocElement {
	inlineObjectElement?: {
		inlineObjectId: string;
	};
	textRun?: {
		content: string;
		textStyle?: {
			bold?: boolean;
			italic?: boolean;
			link?: { url?: string };
		};
	};
}

interface GDocParagraph {
	bullet?: {
		nestingLevel?: number;
		listId?: string;
	};
	elements: GDocElement[];
	paragraphStyle?: {
		namedStyleType?: string;
	};
}

interface GDocContent {
	paragraph?: GDocParagraph;
	table?: {
		tableRows: Array<{
			tableCells: Array<{
				content: GDocContent[];
			}>;
		}>;
	};
}

interface GDocBody {
	content: GDocContent[];
}

const TRAILING_NEWLINE_RE = /\n$/;
const GDOC_URL_RE = /\/document\/d\/([a-zA-Z0-9_-]+)/;

interface GDocResponse {
	body: GDocBody;
	title?: string;
}

function formatTextRun(element: GDocElement): string {
	const run = element.textRun;
	if (!run?.content) {
		return "";
	}

	let text = run.content;
	const style = run.textStyle;

	if (!style) {
		return text;
	}

	// Don't wrap newlines in formatting
	if (text.trim() === "") {
		return text;
	}

	const trimmedEnd = text.endsWith("\n");
	if (trimmedEnd) {
		text = text.slice(0, -1);
	}

	if (style.link?.url) {
		text = `[${text}](${style.link.url})`;
	} else if (style.bold && style.italic) {
		text = `***${text}***`;
	} else if (style.bold) {
		text = `**${text}**`;
	} else if (style.italic) {
		text = `*${text}*`;
	}

	if (trimmedEnd) {
		text += "\n";
	}
	return text;
}

function paragraphToMarkdown(para: GDocParagraph): string {
	const style = para.paragraphStyle?.namedStyleType || "NORMAL_TEXT";

	let line = "";
	for (const element of para.elements) {
		line += formatTextRun(element);
	}

	// Handle bullet lists
	if (para.bullet) {
		const indent = "  ".repeat(para.bullet.nestingLevel || 0);
		const content = line.replace(TRAILING_NEWLINE_RE, "");
		return `${indent}- ${content}\n`;
	}

	// Handle headings
	switch (style) {
		case "HEADING_1":
			return `# ${line}`;
		case "HEADING_2":
			return `## ${line}`;
		case "HEADING_3":
			return `### ${line}`;
		case "HEADING_4":
			return `#### ${line}`;
		case "HEADING_5":
			return `##### ${line}`;
		case "HEADING_6":
			return `###### ${line}`;
		default:
			return line;
	}
}

export function parseGoogleDoc(doc: GDocResponse): string {
	const body = doc.body?.content;
	if (!body) {
		return "";
	}

	const parts: string[] = [];

	for (const block of body) {
		if (block.paragraph) {
			parts.push(paragraphToMarkdown(block.paragraph));
		}
		if (block.table) {
			for (const row of block.table.tableRows) {
				const cells = row.tableCells.map((cell) => {
					const cellText = cell.content
						.filter((c) => c.paragraph)
						.map((c) => {
							let text = "";
							for (const el of c.paragraph!.elements) {
								text += formatTextRun(el);
							}
							return text.replace(TRAILING_NEWLINE_RE, "");
						})
						.join(" ");
					return cellText;
				});
				parts.push(`| ${cells.join(" | ")} |\n`);
			}
		}
	}

	return parts.join("");
}

export function extractDocId(input: string): string {
	// Full URL: https://docs.google.com/document/d/DOC_ID/...
	const urlMatch = input.match(GDOC_URL_RE);
	if (urlMatch) {
		return urlMatch[1];
	}
	// Bare ID
	return input;
}
