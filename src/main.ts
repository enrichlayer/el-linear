#!/usr/bin/env node
import { type Command, program } from "commander";
import { setupAttachmentsCommands } from "./commands/attachments.js";
import { setupBatchCommands } from "./commands/batch.js";
import { setupCommentsCommands } from "./commands/comments.js";
import { setupConfigCommands } from "./commands/config.js";
import { setupCyclesCommands } from "./commands/cycles.js";
import { setupDocumentsCommands } from "./commands/documents.js";
import { setupEmbedsCommands } from "./commands/embeds.js";
import { setupGdocCommands } from "./commands/gdoc.js";
import { setupGraphQLCommands } from "./commands/graphql.js";
import { setupInitCommands } from "./commands/init/index.js";
import { setupIssueIdCommand } from "./commands/issue-id.js";
import { setupIssuesCommands } from "./commands/issues.js";
import { setupLabelsCommands } from "./commands/labels.js";
import { setupProfileCommands } from "./commands/profile.js";
import { setupProjectMilestonesCommands } from "./commands/project-milestones.js";
import { setupProjectsCommands } from "./commands/projects.js";
import { setupReadShortcut } from "./commands/read-shortcut.js";
import { setupRefsCommands } from "./commands/refs.js";
import { setupReleasesCommands } from "./commands/releases.js";
import { setupSearchCommands } from "./commands/search.js";
import { setupTeamsCommands } from "./commands/teams.js";
import { setupTemplatesCommands } from "./commands/templates.js";
import { setupUsersCommands } from "./commands/users.js";
import { setActiveProfileForSession } from "./config/paths.js";
import {
	setFieldsFilter,
	setJqFilter,
	setOutputFormat,
	setRawMode,
} from "./utils/output.js";
import { outputUsageInfo } from "./utils/usage.js";
import { splitList } from "./utils/validators.js";

program
	.name("el-linear")
	.description(
		"A pragmatic CLI for Linear.app — deterministic resolution, structured validation, GraphQL escape hatch.",
	)
	.version("1.9.0")
	.option("--api-token <token>", "Linear API token")
	.option(
		"--profile <name>",
		"named profile (under ~/.config/el-linear/profiles/<name>/) for this invocation. Overrides EL_LINEAR_PROFILE env + the on-disk active-profile marker.",
	)
	.option("--json", "output as JSON (default, accepted for compatibility)")
	.option(
		"--format <kind>",
		"output format: json (default, structured envelope) or summary (human-readable)",
		"json",
	)
	.option(
		"--raw",
		"strip { data, meta } wrapper from list output — emit the array directly",
	)
	.option("--jq <filter>", "apply a jq filter to the JSON output")
	.option(
		"--fields <fields>",
		"filter output to specific fields (comma-separated)",
	)
	.option(
		"--no-cache",
		"bypass the on-disk cache for `teams list` / `labels list` / `projects list`",
	);

program.hook("preAction", (_thisCommand: Command, actionCommand: Command) => {
	const rootOpts = actionCommand.optsWithGlobals();
	if (rootOpts.raw) {
		setRawMode(true);
	}
	if (rootOpts.jq) {
		setJqFilter(rootOpts.jq);
	}
	if (rootOpts.fields) {
		setFieldsFilter(splitList(rootOpts.fields));
	}
	// Subcommand --format wins over the global flag (commander resolves
	// options closest to the action), so `optsWithGlobals` returns the
	// subcommand value when one is set. We accept any of the per-command
	// formats (table/md/csv) silently — those take a different code path
	// inside the handler and never reach outputSuccess. The global
	// behaviour only triggers for `summary`.
	const fmt =
		typeof rootOpts.format === "string"
			? rootOpts.format.toLowerCase()
			: "json";
	if (fmt === "summary") {
		setOutputFormat("summary");
	} else if (fmt === "json") {
		setOutputFormat("json");
	} else if (
		fmt === "table" ||
		fmt === "md" ||
		fmt === "markdown" ||
		fmt === "csv"
	) {
		// Per-subcommand format: no global state change. The subcommand
		// owns its own output path.
		setOutputFormat("json");
	} else {
		// Match outputSuccess's stable JSON-on-stdout shape so machine
		// callers always get a parseable error envelope on stdout. We
		// can't route through handleAsyncCommand here — preAction runs
		// before the action handler.
		const msg =
			`Unknown --format: "${rootOpts.format}". Use one of: json, summary` +
			" (per-command formats table/md/csv are also accepted on issues" +
			" list/search and projects list).";
		process.stdout.write(`${JSON.stringify({ error: msg }, null, 2)}\n`);
		process.exit(1);
	}
	// `--profile <name>` is highest-priority. preAction runs BEFORE the
	// command body, which is BEFORE getApiToken / loadConfig fire — so
	// setting the override here means the rest of the run picks up the
	// right profile's token + config.
	if (rootOpts.profile) {
		setActiveProfileForSession(rootOpts.profile);
	}
});

program.action(() => {
	program.help();
});

setupAttachmentsCommands(program);
setupBatchCommands(program);
setupSearchCommands(program);
setupIssuesCommands(program);
setupIssueIdCommand(program);
setupCommentsCommands(program);
setupLabelsCommands(program);
setupReleasesCommands(program);
setupProjectsCommands(program);
setupCyclesCommands(program);
setupProjectMilestonesCommands(program);
setupEmbedsCommands(program);
setupTeamsCommands(program);
setupTemplatesCommands(program);
setupUsersCommands(program);
setupDocumentsCommands(program);
setupGdocCommands(program);
setupGraphQLCommands(program);
setupConfigCommands(program);
setupInitCommands(program);
setupProfileCommands(program);
setupRefsCommands(program);
setupReadShortcut(program);

program
	.command("usage")
	.description("show usage info for *all* commands")
	.action(() => outputUsageInfo(program));

program.parse();
