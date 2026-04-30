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
import { setupIssueIdCommand } from "./commands/issue-id.js";
import { setupIssuesCommands } from "./commands/issues.js";
import { setupLabelsCommands } from "./commands/labels.js";
import { setupProjectMilestonesCommands } from "./commands/project-milestones.js";
import { setupProjectsCommands } from "./commands/projects.js";
import { setupReadShortcut } from "./commands/read-shortcut.js";
import { setupReleasesCommands } from "./commands/releases.js";
import { setupSearchCommands } from "./commands/search.js";
import { setupTeamsCommands } from "./commands/teams.js";
import { setupTemplatesCommands } from "./commands/templates.js";
import { setupUsersCommands } from "./commands/users.js";
import { setFieldsFilter, setJqFilter, setRawMode } from "./utils/output.js";
import { splitList } from "./utils/validators.js";
import { outputUsageInfo } from "./utils/usage.js";

program
  .name("linctl")
  .description(
    "A pragmatic CLI for Linear.app — deterministic resolution, structured validation, GraphQL escape hatch.",
  )
  .version("1.1.0")
  .option("--api-token <token>", "Linear API token")
  .option("--json", "output as JSON (default, accepted for compatibility)")
  .option("--raw", "strip { data, meta } wrapper from list output — emit the array directly")
  .option("--jq <filter>", "apply a jq filter to the JSON output")
  .option("--fields <fields>", "filter output to specific fields (comma-separated)");

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
setupReadShortcut(program);

program
  .command("usage")
  .description("show usage info for *all* commands")
  .action(() => outputUsageInfo(program));

program.parse();
