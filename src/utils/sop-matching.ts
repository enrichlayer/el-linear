import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { jaccardSimilarity, tokenizeTitle } from "./duplicate-detection.js";

export const DEFAULT_SOP_MATCH_THRESHOLD = 0.3;

interface CatalogAvailability {
	status: string;
	catalogPath?: string;
}

export interface SopCatalogEntry {
	name: string;
	title: string;
	path: string;
	description: string;
	tags?: string[];
	checklist?: string[];
	publishedUrl?: string;
	linearIssue?: string;
}

export interface SopCatalog {
	sops: SopCatalogEntry[];
	availability: CatalogAvailability;
}

export interface SopMatch extends SopCatalogEntry {
	score: number;
	checklist: string[];
	publishedUrl: string;
}

type RunCatalog = () => string;
type ReadSource = (path: string) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string")
	) {
		return undefined;
	}
	return value;
}

/**
 * Parse the structured payload emitted by `el-sop catalog`.
 *
 * This deliberately consumes el-sop's catalog reader instead of parsing
 * CATALOG.md again. The optional fields make the boundary forward-compatible
 * with richer el-sop output while current catalogs are hydrated from the
 * matched SOP source file below.
 */
export function parseSopCatalogOutput(raw: string): SopCatalog {
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed) || !Array.isArray(parsed.sops)) {
		throw new Error("el-sop catalog returned an invalid payload");
	}
	const availability = parsed.availability;
	if (!isRecord(availability) || typeof availability.status !== "string") {
		throw new Error("el-sop catalog omitted source availability");
	}
	if (availability.status !== "ok") {
		throw new Error(
			typeof availability.detail === "string"
				? availability.detail
				: `el-sop catalog is ${availability.status}`,
		);
	}

	const sops: SopCatalogEntry[] = [];
	for (const value of parsed.sops) {
		if (
			!isRecord(value) ||
			typeof value.name !== "string" ||
			typeof value.title !== "string" ||
			typeof value.path !== "string" ||
			typeof value.description !== "string"
		) {
			throw new Error("el-sop catalog returned a malformed SOP entry");
		}
		sops.push({
			name: value.name,
			title: value.title,
			path: value.path,
			description: value.description,
			...(stringArray(value.tags) ? { tags: stringArray(value.tags) } : {}),
			...(stringArray(value.checklist)
				? { checklist: stringArray(value.checklist) }
				: {}),
			...(typeof value.publishedUrl === "string"
				? { publishedUrl: value.publishedUrl }
				: {}),
			...(typeof value.linearIssue === "string"
				? { linearIssue: value.linearIssue }
				: {}),
		});
	}

	return {
		sops,
		availability: {
			status: availability.status,
			...(typeof availability.catalogPath === "string"
				? { catalogPath: availability.catalogPath }
				: {}),
		},
	};
}

function defaultRunCatalog(): string {
	return execFileSync("el-sop", ["catalog"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 10_000,
	});
}

/** Read the SOP corpus through the existing `el-sop catalog` reader. */
export function readSopCatalog(
	runCatalog: RunCatalog = defaultRunCatalog,
): SopCatalog {
	return parseSopCatalogOutput(runCatalog());
}

function parseInlineList(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed) {
		return [];
	}
	const body =
		trimmed.startsWith("[") && trimmed.endsWith("]")
			? trimmed.slice(1, -1)
			: trimmed;
	return body
		.split(",")
		.map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
		.filter(Boolean);
}

/** Read an optional scalar/list field from the SOP's small YAML frontmatter. */
function frontmatterList(source: string, field: string): string[] {
	const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(source)?.[1];
	if (!frontmatter) {
		return [];
	}
	const lines = frontmatter.split(/\r?\n/);
	const start = lines.findIndex((line) => new RegExp(`^${field}:`).test(line));
	if (start === -1) {
		return [];
	}
	const inline = lines[start].slice(lines[start].indexOf(":") + 1);
	if (inline.trim()) {
		return parseInlineList(inline);
	}
	const values: string[] = [];
	for (let index = start + 1; index < lines.length; index++) {
		const match = /^\s+-\s+(.+)$/.exec(lines[index]);
		if (!match) {
			break;
		}
		values.push(match[1].trim().replace(/^['"]|['"]$/g, ""));
	}
	return values;
}

function frontmatterScalar(
	source: string,
	fields: string[],
): string | undefined {
	const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(source)?.[1];
	if (!frontmatter) {
		return undefined;
	}
	for (const field of fields) {
		const match = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(frontmatter);
		if (match) {
			return match[1].trim().replace(/^['"]|['"]$/g, "");
		}
	}
	return undefined;
}

/** Extract the top-level numbered checklist from the canonical `## Steps` section. */
export function extractSopChecklist(source: string): string[] {
	const lines = source.split(/\r?\n/);
	const start = lines.findIndex((line) => /^##\s+Steps\s*$/.test(line));
	if (start === -1) {
		return [];
	}
	const end = lines.findIndex(
		(line, index) => index > start && /^##\s+/.test(line),
	);
	return lines
		.slice(start + 1, end === -1 ? undefined : end)
		.map((line) => /^\d+\.\s+(.+)$/.exec(line)?.[1]?.trim())
		.filter((line): line is string => Boolean(line));
}

/** Map a source file under docs-mdx to its published internal-docs URL. */
export function publishedSopUrl(sourcePath: string): string {
	const marker = `${sep}docs-mdx${sep}`;
	const markerIndex = sourcePath.lastIndexOf(marker);
	if (markerIndex === -1) {
		throw new Error(`SOP source is outside docs-mdx: ${sourcePath}`);
	}
	const docsRoot = sourcePath.slice(0, markerIndex + marker.length - 1);
	const route = relative(docsRoot, sourcePath)
		.split(sep)
		.join("/")
		.replace(/\.mdx?$/i, "");
	return `https://enrichlayer.com/internal/docs/customer-support/${route}`;
}

function sourcePathFor(
	catalog: SopCatalog,
	entry: SopCatalogEntry,
): string | undefined {
	if (!catalog.availability.catalogPath) {
		return undefined;
	}
	return resolve(dirname(catalog.availability.catalogPath), entry.path);
}

function absolutizeChecklistLinks(step: string, sourcePath: string): string {
	return step.replace(/\]\((\.\.?\/[^)]+)\)/g, (full, target: string) => {
		const [pathWithQuery, anchor] = target.split("#", 2);
		const [path, query] = pathWithQuery.split("?", 2);
		try {
			const url = publishedSopUrl(resolve(dirname(sourcePath), path));
			return `](${url}${query ? `?${query}` : ""}${anchor ? `#${anchor}` : ""})`;
		} catch {
			return full;
		}
	});
}

function hydrateEntry(
	catalog: SopCatalog,
	entry: SopCatalogEntry,
	readSource: ReadSource,
): SopCatalogEntry {
	const sourcePath = sourcePathFor(catalog, entry);
	if (!sourcePath) {
		return entry;
	}
	const publishedUrl = entry.publishedUrl ?? publishedSopUrl(sourcePath);
	let source: string;
	try {
		source = readSource(sourcePath);
	} catch (error) {
		throw new Error(
			`could not read SOP source ${entry.name}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const checklist = entry.checklist ?? extractSopChecklist(source);
	return {
		...entry,
		tags: entry.tags ?? frontmatterList(source, "tags"),
		checklist: checklist.map((step) =>
			absolutizeChecklistLinks(step, sourcePath),
		),
		publishedUrl,
		linearIssue:
			entry.linearIssue ??
			frontmatterScalar(source, ["linear_issue", "linearIssue"]),
	};
}

function tokenUnion(...values: string[]): Set<string> {
	const union = new Set<string>();
	for (const value of values) {
		for (const token of tokenizeTitle(value)) {
			union.add(token);
		}
	}
	return union;
}

/**
 * Match issue intent against SOP title, description, and optional tags.
 * Uses the duplicate gate's exact tokenization and Jaccard implementation.
 */
export function matchSops(
	title: string,
	description: string,
	catalog: SopCatalog,
	threshold: number = DEFAULT_SOP_MATCH_THRESHOLD,
	readSource: ReadSource = (path) => readFileSync(path, "utf8"),
): SopMatch[] {
	const issueTitleTokens = tokenizeTitle(title);
	const issueTokens = tokenUnion(title, description);
	const matches: SopMatch[] = [];

	for (const rawEntry of catalog.sops) {
		const entry = hydrateEntry(catalog, rawEntry, readSource);
		const sopTitleTokens = tokenizeTitle(entry.title);
		const sopTokens = tokenUnion(
			entry.title,
			entry.description,
			...(entry.tags ?? []),
		);
		const score = Math.max(
			jaccardSimilarity(issueTitleTokens, sopTitleTokens),
			jaccardSimilarity(issueTokens, sopTokens),
		);
		if (score < threshold || !entry.publishedUrl) {
			continue;
		}
		matches.push({
			...entry,
			score: Math.round(score * 100) / 100,
			checklist: entry.checklist ?? [],
			publishedUrl: entry.publishedUrl,
		});
	}

	matches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
	return matches;
}

function renderMatch(match: SopMatch): string {
	const lines = [`### Matched SOP: [${match.title}](${match.publishedUrl})`];
	for (const step of match.checklist) {
		lines.push(`- [ ] ${step}`);
	}
	return lines.join("\n");
}

/** Add matched SOP links and checklist steps to the issue's Done when section. */
export function appendSopMatchesToDoneWhen(
	description: string,
	matches: SopMatch[],
): string {
	if (matches.length === 0) {
		return description;
	}
	const additions = matches
		.filter((match) => !description.includes(match.publishedUrl))
		.map(renderMatch);
	if (additions.length === 0) {
		return description;
	}
	const block = additions.join("\n\n");
	const goalName = "(?:Done[ -]when|Acceptance criteria|Success criteria)";
	const doneWhen = new RegExp(
		`^(?:#{2,3}\\s+${goalName}\\s*|\\*\\*${goalName}:?\\*\\*)$`,
		"im",
	).exec(description);
	if (!doneWhen || doneWhen.index === undefined) {
		const prefix = description.trimEnd();
		return `${prefix ? `${prefix}\n\n` : ""}## Done when\n\n${block}\n`;
	}
	const sectionStart = doneWhen.index + doneWhen[0].length;
	const nextHeading = /^(?:#{2,3}\s+|\*\*[^*\n]+:?\*\*\s*$)/m.exec(
		description.slice(sectionStart),
	);
	const insertion = nextHeading
		? sectionStart + (nextHeading.index ?? 0)
		: description.length;
	const before = description.slice(0, insertion).trimEnd();
	const after = description.slice(insertion).trimStart();
	return `${before}\n\n${block}\n${after ? `\n${after}` : ""}`;
}

/** Merge SOP-backed Linear issue identifiers into an existing related list. */
export function mergeSopRelations(
	existing: string | undefined,
	matches: SopMatch[],
): string | undefined {
	const identifiers = [
		...(existing
			?.split(",")
			.map((item) => item.trim())
			.filter(Boolean) ?? []),
		...matches
			.map((match) => match.linearIssue)
			.filter((id): id is string => Boolean(id)),
	];
	const unique = [...new Set(identifiers)];
	return unique.length > 0 ? unique.join(",") : undefined;
}

/** Human-facing catalog matches, retaining the published URL and stable score. */
export function formatSopMatches(matches: SopMatch[]): string {
	return [
		`Matched SOP${matches.length === 1 ? "" : "s"}:`,
		...matches.map(
			(match) =>
				`  ${match.title} · ${match.publishedUrl}  (similarity ${match.score})`,
		),
	].join("\n");
}
