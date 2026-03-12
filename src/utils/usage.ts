import type { Command } from "commander";
import { logger } from "./logger.js";

interface SubcommandEntry {
  command: Command;
  name: string;
}

export function outputUsageInfo(program: Command): void {
  const subcommands: SubcommandEntry[] = [];

  function collectSubcommands(cmd: Command, prefix = ""): void {
    const currentName = prefix ? `${prefix} ${cmd.name()}` : cmd.name();
    const commands = cmd.commands;
    if (commands.length === 0) {
      if (prefix) {
        subcommands.push({ name: currentName, command: cmd });
      }
    } else {
      for (const subcmd of commands) {
        collectSubcommands(subcmd, currentName);
      }
    }
  }

  collectSubcommands(program);
  subcommands.sort((a, b) => a.name.localeCompare(b.name));
  for (const { command } of subcommands) {
    command.outputHelp();
    logger.info("\n---\n");
  }
}
