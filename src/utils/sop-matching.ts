import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { DEFAULT_GOAL_SECTION_HEADERS } from "../config/goal-completion-validation.js";
import { jaccardSimilarity, tokenizeTitle } from "./duplicate-detection.js";
import { parseIssueIdentifier } from "./identifier-parser.js";

export const DEFAULT_SOP_MATCH_THRESHOLD = 0.3;
export const DEFAULT_SOP_PUBLISHED_URL_BASE =
	"https://enrichlayer.com/internal/docs/customer-support";

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

export interface SopMatchOptions {
	threshold?: number;
	readSource?: ReadSource;
	publishedUrlBase?: string;
	onEntryError?: (entry: SopCatalogEntry, error: Error) => void;
}

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

/** Map a source file under docs-mdx to its configured published-docs URL. */
export function publishedSopUrl(
	sourcePath: string,
	baseUrl: string = DEFAULT_SOP_PUBLISHED_URL_BASE,
): string {
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
	return `${baseUrl.replace(/\/+$/, "")}/${route}`;
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

function absolutizeChecklistLinks(
	step: string,
	sourcePath: string,
	publishedUrlBase: string,
): string {
	return step.replace(/\]\((\.\.?\/[^)]+)\)/g, (full, target: string) => {
		const [pathWithQuery, anchor] = target.split("#", 2);
		const [path, query] = pathWithQuery.split("?", 2);
		try {
			const url = publishedSopUrl(
				resolve(dirname(sourcePath), path),
				publishedUrlBase,
			);
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
	publishedUrlBase: string,
): SopCatalogEntry {
	const sourcePath = sourcePathFor(catalog, entry);
	if (!sourcePath) {
		return entry;
	}
	const publishedUrl =
		entry.publishedUrl ?? publishedSopUrl(sourcePath, publishedUrlBase);
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
			absolutizeChecklistLinks(step, sourcePath, publishedUrlBase),
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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match issue intent against SOP title, description, and optional tags.
 * Uses the duplicate gate's exact tokenization and Jaccard implementation.
 */
export function matchSops(
	title: string,
	description: string,
	catalog: SopCatalog,
	options: SopMatchOptions = {},
): SopMatch[] {
	const threshold = options.threshold ?? DEFAULT_SOP_MATCH_THRESHOLD;
	const readSource =
		options.readSource ?? ((path) => readFileSync(path, "utf8"));
	const publishedUrlBase =
		options.publishedUrlBase ?? DEFAULT_SOP_PUBLISHED_URL_BASE;
	const issueTitleTokens = tokenizeTitle(title);
	const issueTokens = tokenUnion(title, description);
	const matches: SopMatch[] = [];

	for (const rawEntry of catalog.sops) {
		// Score only catalog-supplied fields first. Source hydration is the costly
		// part of the create path, so below-threshold entries never touch disk.
		const sopTitleTokens = tokenizeTitle(rawEntry.title);
		const sopTokens = tokenUnion(
			rawEntry.title,
			rawEntry.description,
			...(rawEntry.tags ?? []),
		);
		const score = Math.max(
			jaccardSimilarity(issueTitleTokens, sopTitleTokens),
			jaccardSimilarity(issueTokens, sopTokens),
		);
		if (score < threshold) {
			continue;
		}

		let entry: SopCatalogEntry;
		try {
			entry = hydrateEntry(catalog, rawEntry, readSource, publishedUrlBase);
		} catch (error) {
			options.onEntryError?.(
				rawEntry,
				error instanceof Error ? error : new Error(String(error)),
			);
			continue;
		}
		if (!entry.publishedUrl) {
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

/** Normalize a bare Linear identifier or Linear issue URL to TEAM-123. */
export function parseSopLinearIssueReference(reference: string): string {
	const trimmed = reference.trim();
	let identifier = trimmed;
	if (/^https?:\/\//i.test(trimmed)) {
		let url: URL;
		try {
			url = new URL(trimmed);
		} catch {
			throw new Error(`invalid Linear issue URL: ${reference}`);
		}
		if (url.hostname.toLowerCase() !== "linear.app") {
			throw new Error(`not a linear.app issue URL: ${reference}`);
		}
		const parts = url.pathname.split("/").filter(Boolean);
		const issueIndex = parts.findIndex(
			(part) => part.toLowerCase() === "issue",
		);
		identifier = issueIndex === -1 ? "" : (parts[issueIndex + 1] ?? "");
	}

	if (!/^[A-Z][A-Z0-9]*-\d+$/.test(identifier)) {
		throw new Error(
			`invalid Linear issue reference: ${reference}; expected TEAM-123 or a linear.app issue URL`,
		);
	}
	const parsed = parseIssueIdentifier(identifier);
	return `${parsed.teamKey}-${parsed.issueNumber}`;
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
	sectionNames: string[] = DEFAULT_GOAL_SECTION_HEADERS,
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
	const knownSectionNames =
		sectionNames.length > 0 ? sectionNames : DEFAULT_GOAL_SECTION_HEADERS;
	const goalName = `(?:${knownSectionNames.map(escapeRegExp).join("|")})`;
	const doneWhen = new RegExp(
		`^(?:#{2,3}\\s+${goalName}\\s*|\\*\\*${goalName}:?\\*\\*)$`,
		"im",
	).exec(description);
	if (!doneWhen || doneWhen.index === undefined) {
		const prefix = description.trimEnd();
		return `${prefix ? `${prefix}\n\n` : ""}## Done when\n\n${block}\n`;
	}
	const sectionStart = doneWhen.index + doneWhen[0].length;
	const nextHeading = new RegExp(
		`^(?:#{2,3}\\s+|\\*\\*${goalName}:?\\*\\*\\s*$)`,
		"im",
	).exec(description.slice(sectionStart));
	const insertion = nextHeading
		? sectionStart + (nextHeading.index ?? 0)
		: description.length;
	const before = description.slice(0, insertion).trimEnd();
	const after = description.slice(insertion).trimStart();
	return `${before}\n\n${block}\n${after ? `\n${after}` : ""}`;
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
