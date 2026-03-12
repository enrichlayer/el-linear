#!/usr/bin/env node
import { program } from "commander";
import { setupAttachmentsCommands } from "./commands/attachments.js";
import { setupCommentsCommands } from "./commands/comments.js";
import { setupConfigCommands } from "./commands/config.js";
import { setupCyclesCommands } from "./commands/cycles.js";
import { setupDocumentsCommands } from "./commands/documents.js";
import { setupEmbedsCommands } from "./commands/embeds.js";
import { setupGdocCommands } from "./commands/gdoc.js";
import { setupGraphQLCommands } from "./commands/graphql.js";
import { setupIssuesCommands } from "./commands/issues.js";
import { setupLabelsCommands } from "./commands/labels.js";
import { setupProjectMilestonesCommands } from "./commands/project-milestones.js";
import { setupProjectsCommands } from "./commands/projects.js";
import { setupReleasesCommands } from "./commands/releases.js";
import { setupReadShortcut } from "./commands/read-shortcut.js";
import { setupSearchCommands } from "./commands/search.js";
import { setupTeamsCommands } from "./commands/teams.js";
import { setupTemplatesCommands } from "./commands/templates.js";
import { setupUsersCommands } from "./commands/users.js";
import { outputUsageInfo } from "./utils/usage.js";

program
  .name("el-linear")
  .description(
    "Enrich Layer CLI for Linear.app — deterministic resolution, brand validation, status defaults",
  )
  .version("1.0.0")
  .option("--api-token <token>", "Linear API token")
  .option("--json", "output as JSON (default, accepted for compatibility)");

program.action(() => {
  program.help();
});

setupAttachmentsCommands(program);
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
