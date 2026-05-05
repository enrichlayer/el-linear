/**
 * Step 3 of the wizard: member aliases.
 *
 * For each Linear user in the workspace, the user can add short aliases,
 * GitHub handles, and GitLab handles used for resolution. Skip-by-default
 * (most users skip this and only fill in the people they @-mention often).
 *
 * Idempotent: re-running shows the current aliases per user and offers a
 * 4-way menu (keep / edit / append / clear) plus quit. Progress is persisted
 * so an interrupted walk can be resumed via `linctl init aliases`.
 */

import fs from "node:fs/promises";
import { confirm, input, select } from "@inquirer/prompts";
import { GraphQLService } from "../../utils/graphql-service.js";
import {
	type AliasesProgress,
	clearAliasesProgress,
	readAliasesProgress,
	type WizardConfig,
	writeAliasesProgress,
} from "./shared.js";

const USERS_QUERY = /* GraphQL */ `
  query InitUsers($first: Int!, $after: String) {
    users(first: $first, after: $after, includeDisabled: false) {
      pageInfo { endCursor hasNextPage }
      nodes { id name email displayName active }
    }
  }
`;

interface UsersResponse {
	users: {
		pageInfo: { endCursor: string | null; hasNextPage: boolean };
		nodes: Array<{
			id: string;
			name: string;
			email: string | null;
			displayName: string | null;
			active: boolean;
		}>;
	};
}

export interface User {
	id: string;
	name: string;
	email: string | null;
	displayName: string;
}

export async function fetchAllUsers(token: string): Promise<User[]> {
	const service = new GraphQLService(token);
	const out: User[] = [];
	let after: string | undefined;
	for (;;) {
		const data = await service.rawRequest<UsersResponse>(USERS_QUERY, {
			first: 100,
			after,
		});
		for (const u of data.users.nodes) {
			if (!u.active) continue;
			out.push({
				id: u.id,
				name: u.name,
				email: u.email,
				displayName: u.displayName ?? u.name,
			});
		}
		if (!data.users.pageInfo.hasNextPage || !data.users.pageInfo.endCursor)
			break;
		after = data.users.pageInfo.endCursor;
	}
	return out;
}

/**
 * Merge new alias entries into existing config without dropping unrelated
 * fields. Pure function — no I/O. Exported for testing.
 */
export function mergeAliasesIntoConfig(
	existing: WizardConfig,
	updates: Map<string, AliasUpdate>,
): WizardConfig {
	const next: WizardConfig = JSON.parse(JSON.stringify(existing));
	next.members = next.members ?? {};
	next.members.aliases = next.members.aliases ?? {};
	next.members.fullNames = next.members.fullNames ?? {};
	next.members.handles = next.members.handles ?? {};
	next.members.uuids = next.members.uuids ?? {};
	next.members.handles.github = next.members.handles.github ?? {};
	next.members.handles.gitlab = next.members.handles.gitlab ?? {};

	for (const [userId, update] of updates) {
		const fullName = update.displayName;
		next.members.uuids[fullName] = userId;
		next.members.fullNames[userId] = fullName;

		// Aliases: replace this user's entries based on the update mode.
		// We track aliases as { aliasKey: fullName }, so removing means deleting
		// any keys whose value is this fullName.
		const currentAliasKeys = Object.entries(next.members.aliases)
			.filter(([_, v]) => v === fullName)
			.map(([k]) => k);

		if (update.mode === "clear") {
			for (const k of currentAliasKeys) delete next.members.aliases[k];
		} else if (update.mode === "edit") {
			for (const k of currentAliasKeys) delete next.members.aliases[k];
			for (const a of update.aliases) next.members.aliases[a] = fullName;
		} else if (update.mode === "append") {
			for (const a of update.aliases) next.members.aliases[a] = fullName;
		}
		// "keep" → no changes.

		// GitHub / GitLab handles use the same edit/append/clear semantics.
		for (const platform of ["github", "gitlab"] as const) {
			const handlesMap = next.members.handles[platform] as Record<
				string,
				string
			>;
			const currentHandleKeys = Object.entries(handlesMap)
				.filter(([_, v]) => v === fullName)
				.map(([k]) => k);
			const newHandle = update[`${platform}Handle`];
			if (newHandle === "__clear__") {
				for (const k of currentHandleKeys) delete handlesMap[k];
			} else if (newHandle !== undefined && newHandle !== "__keep__") {
				for (const k of currentHandleKeys) delete handlesMap[k];
				if (newHandle.trim()) handlesMap[newHandle.trim()] = fullName;
			}
		}
	}
	return next;
}

export interface AliasUpdate {
	displayName: string;
	mode: "keep" | "edit" | "append" | "clear";
	aliases: string[];
	/** "__keep__" leaves it alone, "__clear__" removes, any other string sets. */
	githubHandle: string | "__keep__" | "__clear__";
	gitlabHandle: string | "__keep__" | "__clear__";
}

function currentAliasesFor(config: WizardConfig, fullName: string): string[] {
	const aliases = config.members?.aliases ?? {};
	return Object.entries(aliases)
		.filter(([_, v]) => v === fullName)
		.map(([k]) => k);
}

function currentHandleFor(
	config: WizardConfig,
	platform: "github" | "gitlab",
	fullName: string,
): string | undefined {
	const handles = config.members?.handles?.[platform] ?? {};
	for (const [k, v] of Object.entries(handles)) {
		if (v === fullName) return k;
	}
	return undefined;
}

function parseCsvList(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Walk users one-by-one. Returns updates keyed by user UUID. Caller writes
 * them back via `mergeAliasesIntoConfig`.
 */
export async function runAliasesStep(
	token: string,
	existing: WizardConfig,
	options: {
		/** Path to a CSV with batch alias data — when set, skips the interactive walk. */
		importCsv?: string;
		/** Skip the per-section "walk now?" prompt and force the walk. */
		force?: boolean;
	} = {},
): Promise<Map<string, AliasUpdate>> {
	if (options.importCsv) {
		return runAliasesImport(options.importCsv);
	}

	const proceed = options.force
		? true
		: await confirm({
				message:
					"Walk through users now to add aliases? Most teams skip this and add aliases later " +
					"via `linctl init aliases` for the people they @-mention often.",
				default: false,
			});
	if (!proceed) {
		// biome-ignore lint/suspicious/noConsole: wizard
		console.log(
			"  Skipped — run `linctl init aliases` to add or edit aliases later.",
		);
		return new Map();
	}

	const users = await fetchAllUsers(token);
	if (users.length === 0) {
		// biome-ignore lint/suspicious/noConsole: wizard
		console.log("  No active users visible to this token.");
		return new Map();
	}

	const startIdx = await resolveResumePoint(users.length);
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(
		`  Walking ${users.length - startIdx}/${users.length} users. Type 'q' at any prompt to stop and save progress.`,
	);

	const updates = new Map<string, AliasUpdate>();
	let lastCompleted = startIdx - 1;

	try {
		for (let i = startIdx; i < users.length; i++) {
			const u = users[i];
			const update = await promptForUser(i + 1, users.length, u, existing);
			if (update === "quit") {
				await writeAliasesProgress({
					lastCompleted,
					totalUsers: users.length,
					savedAt: new Date().toISOString(),
				});
				// biome-ignore lint/suspicious/noConsole: wizard
				console.log(
					`  Saved progress at ${lastCompleted + 1}/${users.length}. Resume with \`linctl init aliases\`.`,
				);
				return updates;
			}
			if (
				update.mode !== "keep" ||
				update.githubHandle !== "__keep__" ||
				update.gitlabHandle !== "__keep__"
			) {
				updates.set(u.id, update);
			}
			lastCompleted = i;
		}
		await clearAliasesProgress();
		// biome-ignore lint/suspicious/noConsole: wizard
		console.log(`  ✓ Walked all ${users.length} users.`);
		return updates;
	} catch (err) {
		// Save what we have on unexpected error so the user can resume.
		if (lastCompleted >= startIdx) {
			await writeAliasesProgress({
				lastCompleted,
				totalUsers: users.length,
				savedAt: new Date().toISOString(),
			});
		}
		throw err;
	}
}

async function resolveResumePoint(totalUsers: number): Promise<number> {
	const progress: AliasesProgress | null = await readAliasesProgress();
	if (!progress || progress.lastCompleted < 0) return 0;
	if (progress.totalUsers !== totalUsers) {
		// biome-ignore lint/suspicious/noConsole: wizard
		console.log(
			`  Saved progress is from ${progress.totalUsers} users; the workspace now has ${totalUsers}. Starting over.`,
		);
		await clearAliasesProgress();
		return 0;
	}
	const resume = await confirm({
		message: `Resume from user ${progress.lastCompleted + 2}/${progress.totalUsers}? (saved ${progress.savedAt})`,
		default: true,
	});
	if (resume) return progress.lastCompleted + 1;
	await clearAliasesProgress();
	return 0;
}

async function promptForUser(
	index: number,
	total: number,
	user: User,
	existing: WizardConfig,
): Promise<AliasUpdate | "quit"> {
	const fullName = user.displayName;
	const currentAliases = currentAliasesFor(existing, fullName);
	const currentGithub = currentHandleFor(existing, "github", fullName);
	const currentGitlab = currentHandleFor(existing, "gitlab", fullName);

	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(
		`\n  [${index}/${total}] ${fullName}${user.email ? ` <${user.email}>` : ""}`,
	);
	if (currentAliases.length > 0) {
		// biome-ignore lint/suspicious/noConsole: wizard
		console.log(`    Current aliases: ${currentAliases.join(", ")}`);
	}
	if (currentGithub) {
		// biome-ignore lint/suspicious/noConsole: wizard
		console.log(`    Current GitHub:  ${currentGithub}`);
	}
	if (currentGitlab) {
		// biome-ignore lint/suspicious/noConsole: wizard
		console.log(`    Current GitLab:  ${currentGitlab}`);
	}

	const action = await select<"keep" | "edit" | "append" | "clear" | "quit">({
		message:
			currentAliases.length > 0 ? "Action:" : "Add aliases for this user?",
		choices: [
			{ name: "Keep as-is (skip this user)", value: "keep" },
			{
				name:
					currentAliases.length > 0 ? "Edit (replace aliases)" : "Add aliases",
				value: "edit",
			},
			...(currentAliases.length > 0
				? [
						{
							name: "Append (keep current + add more)",
							value: "append" as const,
						},
						{
							name: "Clear (remove all aliases for this user)",
							value: "clear" as const,
						},
					]
				: []),
			{ name: "Quit (save progress, exit walk)", value: "quit" },
		],
		default: "keep",
	});

	if (action === "quit") return "quit";
	if (action === "keep") {
		return {
			displayName: fullName,
			mode: "keep",
			aliases: [],
			githubHandle: "__keep__",
			gitlabHandle: "__keep__",
		};
	}
	if (action === "clear") {
		return {
			displayName: fullName,
			mode: "clear",
			aliases: [],
			githubHandle: currentGithub ? "__clear__" : "__keep__",
			gitlabHandle: currentGitlab ? "__clear__" : "__keep__",
		};
	}

	// edit / append: collect aliases + handles
	const aliasesRaw = await input({
		message: "Aliases (comma-separated, blank to skip):",
		default: action === "edit" ? currentAliases.join(", ") : "",
	});
	const githubRaw = await input({
		message: "GitHub handle (blank to skip):",
		default: currentGithub ?? "",
	});
	const gitlabRaw = await input({
		message: "GitLab handle (blank to skip):",
		default: currentGitlab ?? "",
	});

	return {
		displayName: fullName,
		mode: action,
		aliases: parseCsvList(aliasesRaw),
		githubHandle:
			githubRaw === (currentGithub ?? "")
				? "__keep__"
				: githubRaw.trim() || "__clear__",
		gitlabHandle:
			gitlabRaw === (currentGitlab ?? "")
				? "__keep__"
				: gitlabRaw.trim() || "__clear__",
	};
}

/**
 * Batch alias import from a CSV. Format:
 *   email,aliases,github,gitlab
 *   alice@example.com,"alice,ali",alice-gh,
 *   bob@example.com,"bob",,
 *
 * Lines starting with `#` are comments. Aliases column is comma-separated
 * inside the cell; if the cell contains commas it must be quoted.
 *
 * Each row's email is matched against Linear users; rows that don't match
 * are reported and skipped.
 */
export async function runAliasesImport(
	csvPath: string,
): Promise<Map<string, AliasUpdate>> {
	const raw = await fs.readFile(csvPath, "utf8");
	const rows = parseCsv(raw);
	const updates = new Map<string, AliasUpdate>();
	// The caller (full wizard) supplies the user list; for the standalone
	// sub-command, we rely on `linctl init aliases --import` doing its own
	// user fetch in the entrypoint. This function is intentionally pure.
	// The caller should resolve emails to user UUIDs and call `mergeAliasesIntoConfig`.
	// We return the row data with email as key, expecting the caller to map.
	for (const row of rows) {
		const email = (row.email ?? "").trim().toLowerCase();
		if (!email) continue;
		updates.set(email, {
			displayName: email, // placeholder — caller replaces with the real display name
			mode: "edit",
			aliases: parseCsvList(row.aliases ?? ""),
			githubHandle: row.github?.trim() ? row.github.trim() : "__keep__",
			gitlabHandle: row.gitlab?.trim() ? row.gitlab.trim() : "__keep__",
		});
	}
	return updates;
}

interface CsvRow {
	email?: string;
	aliases?: string;
	github?: string;
	gitlab?: string;
}

/** Minimal CSV parser supporting quoted cells and `#` comment lines. */
export function parseCsv(text: string): CsvRow[] {
	const lines = text
		.split(/\r?\n/)
		.filter((l) => l.trim() && !l.trim().startsWith("#"));
	if (lines.length === 0) return [];
	const header = splitCsvRow(lines[0]).map((h) => h.toLowerCase());
	const rows: CsvRow[] = [];
	for (let i = 1; i < lines.length; i++) {
		const cells = splitCsvRow(lines[i]);
		const row: CsvRow = {};
		for (let j = 0; j < header.length; j++) {
			const k = header[j] as keyof CsvRow;
			row[k] = cells[j] ?? "";
		}
		rows.push(row);
	}
	return rows;
}

function splitCsvRow(line: string): string[] {
	const cells: string[] = [];
	let cur = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (inQuotes) {
			if (c === '"') {
				if (line[i + 1] === '"') {
					cur += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cur += c;
			}
		} else if (c === '"' && cur === "") {
			inQuotes = true;
		} else if (c === ",") {
			cells.push(cur);
			cur = "";
		} else {
			cur += c;
		}
	}
	cells.push(cur);
	return cells.map((s) => s.trim());
}
