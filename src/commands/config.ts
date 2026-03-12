import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { outputSuccess } from "../utils/output.js";

export function setupConfigCommands(program: Command): void {
  const config = program.command("config").description("Configuration introspection");
  config.action(() => config.help());

  config
    .command("show")
    .description("Show resolved configuration")
    .addHelpText(
      "after",
      "\nDumps the merged config from ~/.config/el-linear/config.json.\n\nExamples:\n  el-linear config show",
    )
    .action(() => {
      outputSuccess({ data: loadConfig() });
    });
}
