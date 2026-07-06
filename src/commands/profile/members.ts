/**
 * `el-linear profile members` — direct, non-interactive alias/handle edits
 * on the active profile's on-disk config — DEV-5612.
 *
 * `init aliases` (the interactive wizard walk) is the right tool for a
 * first-time setup or a bulk pass over many users, but fixing ONE entry
 * (e.g. clearing a mistaken alias, or the Linear system actor a user
 * accidentally aliased before DEV-5612's wizard-side skip existed) meant
 * either re-walking every user interactively or hand-editing
 * `~/.config/el-linear/config.json`. These commands are the direct path:
 *
 *   el-linear profile members list                      — show configured members
 *   el-linear profile members clear <name>               — remove all aliases/handles for <name>
 *   el-linear profile members set <name> [options]        — replace aliases/handles for <name>
 *
 * `<name>` is the exact Linear display name as it appears in
 * `members.aliases`/`members.handles.*` values (see `profile members list`).
 * These commands operate purely on the local config file — no Linear API
 * call, no UUID resolution — so they also work to clean up a stale/mistaken
 * entry for a user no longer in the workspace.
 */

import type { Command } from "commander";
import { outputSuccess } from "../../utils/output.js";
import type { HandleAction } from "../init/aliases.js";
import { applyMemberAliasUpdate } from "../init/aliases.js";
import {
	parseCsvList,
	readConfig,
	updateConfig,
	type WizardConfig,
} from "../init/shared.js";

export interface MemberListEntry {
	displayName: string;
	aliases: string[];
	github?: string;
	gitlab?: string;
}

/**
 * Reconstruct a per-member view from the on-disk `members.aliases` /
 * `members.handles.{github,gitlab}` maps (each `{ key: displayName }`).
 * `WizardConfig`'s maps are `Record<string, string | undefined>` (DeepPartial
 * over an index signature) — an `undefined` value can't happen in practice
 * (JSON never round-trips one), but we guard it defensively rather than cast.
 * Pure — exported for testing.
 */
export function listMembers(config: WizardConfig): MemberListEntry[] {
	const aliases = config.members?.aliases ?? {};
	const github = config.members?.handles?.github ?? {};
	const gitlab = config.members?.handles?.gitlab ?? {};

	const byName = new Map<string, MemberListEntry>();
	const ensure = (name: string): MemberListEntry => {
		let entry = byName.get(name);
		if (!entry) {
			entry = { displayName: name, aliases: [] };
			byName.set(name, entry);
		}
		return entry;
	};

	for (const [alias, name] of Object.entries(aliases)) {
		if (name === undefined) continue;
		ensure(name).aliases.push(alias);
	}
	for (const [handle, name] of Object.entries(github)) {
		if (name === undefined) continue;
		ensure(name).github = handle;
	}
	for (const [handle, name] of Object.entries(gitlab)) {
		if (name === undefined) continue;
		ensure(name).gitlab = handle;
	}

	return [...byName.values()].sort((a, b) =>
		a.displayName.localeCompare(b.displayName),
	);
}

/**
 * Translate a `--github`/`--gitlab` flag value into a HandleAction:
 *   - flag absent          → keep (leave any existing handle alone)
 *   - flag present, empty  → clear
 *   - flag present, value  → set
 */
function handleActionFromFlag(raw: string | undefined): HandleAction {
	if (raw === undefined) return { kind: "keep" };
	const trimmed = raw.trim();
	return trimmed ? { kind: "set", value: trimmed } : { kind: "clear" };
}

/** `el-linear profile members list` — exported for direct testing. */
export async function runMembersList(): Promise<MemberListEntry[]> {
	const config = await readConfig();
	return listMembers(config);
}

/** `el-linear profile members clear <name>` — exported for direct testing. */
export async function runMembersClear(name: string): Promise<void> {
	await updateConfig((current) =>
		applyMemberAliasUpdate(current, name, {
			mode: "clear",
			aliases: [],
			github: { kind: "clear" },
			gitlab: { kind: "clear" },
		}),
	);
}

export interface MembersSetOptions {
	aliases?: string;
	github?: string;
	gitlab?: string;
}

/** `el-linear profile members set <name>` — exported for direct testing. */
export async function runMembersSet(
	name: string,
	opts: MembersSetOptions,
): Promise<void> {
	if (
		opts.aliases === undefined &&
		opts.github === undefined &&
		opts.gitlab === undefined
	) {
		throw new Error("Pass at least one of --aliases, --github, --gitlab.");
	}
	await updateConfig((current) =>
		applyMemberAliasUpdate(current, name, {
			mode: opts.aliases !== undefined ? "edit" : "keep",
			aliases: opts.aliases !== undefined ? parseCsvList(opts.aliases) : [],
			github: handleActionFromFlag(opts.github),
			gitlab: handleActionFromFlag(opts.gitlab),
		}),
	);
}

export function registerMembersCommands(profile: Command): void {
	const members = profile
		.command("members")
		.description(
			"Directly edit or clear a member's aliases/handles without hand-editing config.json (DEV-5612).",
		);
	members.action(() => members.help());

	members
		.command("list")
		.description("List members with configured aliases/GitHub/GitLab handles.")
		.action(async () => {
			const data = await runMembersList();
			outputSuccess({ data, meta: { count: data.length } });
		});

	members
		.command("clear <name>")
		.description(
			"Remove all aliases + GitHub/GitLab handles for <name> (exact display name, see `members list`).",
		)
		.action(async (name: string) => {
			await runMembersClear(name);
			outputSuccess({ data: { cleared: name } });
		});

	members
		.command("set <name>")
		.description(
			"Replace aliases/handles for <name> (exact display name). Omit a flag to leave that field unchanged; pass an empty value to clear just that field.",
		)
		.option(
			"--aliases <csv>",
			"comma-separated aliases; replaces the existing set for this member",
		)
		.option("--github <handle>", "GitHub handle; pass an empty string to clear")
		.option("--gitlab <handle>", "GitLab handle; pass an empty string to clear")
		.action(async (name: string, opts: MembersSetOptions) => {
			await runMembersSet(name, opts);
			outputSuccess({ data: { updated: name } });
		});
}
