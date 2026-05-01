import { Command } from "commander";
import { describe, expect, it } from "vitest";

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
