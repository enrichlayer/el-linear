import { Command } from "commander";
import { describe, expect, it } from "vitest";

import {
	bypassesDuplicateHardBlock,
	formatDuplicateBlock,
} from "../utils/duplicate-detection.js";

import { setupAttachmentsCommands } from "./attachments.js";
import { setupBatchCommands } from "./batch.js";
import { setupCommentsCommands } from "./comments.js";
import { setupCyclesCommands } from "./cycles.js";
import { setupDocumentsCommands } from "./documents.js";
import { setupEmbedsCommands } from "./embeds.js";
import { setupIssuesCommands } from "./issues.js";
import { setupLabelsCommands } from "./labels.js";
import { setupProjectMilestonesCommands } from "./project-milestones.js";
import { setupProjectsCommands } from "./projects.js";
import { setupReleasesCommands } from "./releases.js";
import { setupSearchCommands } from "./search.js";
import { setupTeamsCommands } from "./teams.js";
import { setupUsersCommands } from "./users.js";

function buildProgram(): Command {
	const program = new Command();
	program.exitOverride();

	setupAttachmentsCommands(program);
	setupBatchCommands(program);
	setupSearchCommands(program);
	setupIssuesCommands(program);
	setupCommentsCommands(program);
	setupLabelsCommands(program);
	setupReleasesCommands(program);
	setupProjectsCommands(program);
	setupCyclesCommands(program);
	setupProjectMilestonesCommands(program);
	setupEmbedsCommands(program);
	setupTeamsCommands(program);
	setupUsersCommands(program);
	setupDocumentsCommands(program);

	return program;
}

/**
 * Recursively collect all subcommands matching a name.
 */
function collectSubcommands(
	cmd: Command,
	name: string,
	prefix = "",
): { path: string; command: Command }[] {
	const result: { path: string; command: Command }[] = [];
	for (const sub of cmd.commands) {
		const fullPath = prefix ? `${prefix} ${sub.name()}` : sub.name();
		if (sub.name() === name) {
			result.push({ path: fullPath, command: sub });
		}
		result.push(...collectSubcommands(sub, name, fullPath));
	}
	return result;
}

/**
 * COMPOSITION test (DEV-6205) — the duplicate gate's remedy copy must actually
 * clear the duplicate gate.
 *
 * Unit tests on `formatDuplicateBlock` assert the string contains `--parent
 * <id>`; they cannot see that the gate never reads `parentTicket`. The first cut
 * of DEV-6205 shipped exactly that: a message promising "re-run with --parent
 * MAR-744 to file it as a sub-issue" against a gate whose escape set is
 * `allowDuplicate` alone — so following the advice hit the identical block. The
 * bug lived in the SEAM (message ⇄ gate), which is invisible to either side's
 * own tests.
 *
 * This drives the real rendered copy through the real `issues create` option
 * parser and asserts the resulting options satisfy the real gate predicate. It
 * fails on that shipped bug.
 */
describe("duplicate-gate remedy ⇄ gate (DEV-6205 composition)", () => {
	function findIssuesCreate(program: Command): Command {
		const issues = program.commands.find((c) => c.name() === "issues");
		const create = issues?.commands.find((c) => c.name() === "create");
		if (!create) throw new Error("issues create not found");
		return create;
	}

	/** The exact flags the block-mode message tells the operator to re-run with. */
	function remedyFlagsFromMessage(): string[] {
		const message = formatDuplicateBlock([
			{
				identifier: "MAR-744",
				title: "Document and pilot the workflow",
				state: "In Progress",
				assignee: "Eishan",
				score: 0.7,
			},
		]);
		const match = message.match(/re-run with (.+?) to file it as a sub-issue/);
		if (!match) {
			throw new Error(
				`block-mode message no longer names a sub-issue re-run command:\n${message}`,
			);
		}
		return match[1].trim().split(/\s+/);
	}

	it("the sub-issue remedy it prints actually clears the gate", () => {
		const flags = remedyFlagsFromMessage();
		const program = buildProgram();
		const create = findIssuesCreate(program);

		// Replace the real action so parsing doesn't hit the network.
		let captured: Record<string, unknown> | undefined;
		create.exitOverride();
		create.action(() => {
			captured = create.opts();
		});
		program.parse(
			["issues", "create", "Some title", "--team", "DEV", ...flags],
			{
				from: "user",
			},
		);

		expect(
			captured,
			"issues create did not parse the remedy flags",
		).toBeDefined();
		// The whole point: the printed remedy must satisfy the gate's escape set.
		expect(
			bypassesDuplicateHardBlock(captured as { allowDuplicate?: unknown }),
			`the block-mode remedy (${flags.join(" ")}) does not clear the duplicate gate — ` +
				"the message promises an outcome the command refuses",
		).toBe(true);
		// ...and still actually name the parent, which is the remedy's purpose.
		// Either key is correct here: `--parent` is an alias that the real action
		// handler normalizes to `parentTicket`, and this test replaces that handler
		// to stay offline — so assert the parent survived parsing under either name
		// rather than coupling to where normalization happens.
		expect(captured?.parentTicket ?? captured?.parent).toBe("MAR-744");
	});
});

describe("CLI consistency", () => {
	it("all list subcommands have a --limit option", () => {
		const program = buildProgram();
		const listCommands = collectSubcommands(program, "list");

		expect(listCommands.length).toBeGreaterThan(0);

		const missing: string[] = [];
		for (const { path, command } of listCommands) {
			const hasLimit = command.options.some((opt) => opt.long === "--limit");
			if (!hasLimit) {
				missing.push(path);
			}
		}

		expect(
			missing,
			`List commands missing --limit: ${missing.join(", ")}`,
		).toEqual([]);
	});

	it("all list subcommands have consistent --limit short flag", () => {
		const program = buildProgram();
		const listCommands = collectSubcommands(program, "list");

		const inconsistent: string[] = [];
		for (const { path, command } of listCommands) {
			const limitOpt = command.options.find((opt) => opt.long === "--limit");
			if (limitOpt && limitOpt.short !== "-l") {
				inconsistent.push(
					`${path}: short flag is "${limitOpt.short}" (expected "-l")`,
				);
			}
		}

		expect(
			inconsistent,
			`Inconsistent --limit short flags: ${inconsistent.join(", ")}`,
		).toEqual([]);
	});
});
