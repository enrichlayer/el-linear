import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { outputWarning } from "../utils/output.js";

interface ElLinearConfig {
  brand: {
    name: string;
    reject: string[];
  };
  defaultLabels: string[];
  defaultTeam: string;
  labels: {
    workspace: Record<string, string>;
    teams: Record<string, Record<string, string>>;
  };
  members: {
    aliases: Record<string, string>;
    fullNames: Record<string, string>;
    handles: Record<string, Record<string, string>>;
    uuids: Record<string, string>;
  };
  statusDefaults: {
    noProject: string;
    withAssigneeAndProject: string;
  };
  teamAliases: Record<string, string>;
  teams: Record<string, string>;
}

const CONFIG_PATH = path.join(os.homedir(), ".config", "el-linear", "config.json");

const DEFAULT_CONFIG: ElLinearConfig = {
  defaultTeam: "",
  defaultLabels: [],
  brand: {
    name: "",
    reject: [],
  },
  members: {
    aliases: {},
    fullNames: {},
    handles: {},
    uuids: {},
  },
  teams: {},
  teamAliases: {},
  labels: {
    workspace: {},
    teams: {},
  },
  statusDefaults: {
    noProject: "Triage",
    withAssigneeAndProject: "Todo",
  },
};

let cachedConfig: ElLinearConfig | undefined;

export function loadConfig(): ElLinearConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      cachedConfig = deepMerge(
        DEFAULT_CONFIG as unknown as Record<string, unknown>,
        userConfig as Record<string, unknown>,
      ) as unknown as ElLinearConfig;
    } catch {
      outputWarning(`Failed to parse ${CONFIG_PATH}, using empty defaults`);
      cachedConfig = DEFAULT_CONFIG;
    }
  } else {
    outputWarning(`No config found at ${CONFIG_PATH}. Run with --init to create one.`);
    cachedConfig = DEFAULT_CONFIG;
  }

  return cachedConfig;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
