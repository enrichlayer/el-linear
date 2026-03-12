import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AuthOptions {
  apiToken?: string;
}

export function getApiToken(options: AuthOptions): string {
  if (options.apiToken) {
    return options.apiToken;
  }

  if (process.env.LINEAR_API_TOKEN) {
    return process.env.LINEAR_API_TOKEN;
  }

  // el-linear config path
  const elLinearTokenFile = path.join(os.homedir(), ".config", "el-linear", "token");
  if (fs.existsSync(elLinearTokenFile)) {
    return fs.readFileSync(elLinearTokenFile, "utf8").trim();
  }

  // Fallback to legacy token file (~/.linear_api_token)
  const tokenFile = path.join(os.homedir(), ".linear_api_token");
  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, "utf8").trim();
  }

  throw new Error(
    "No API token found. Use --api-token, LINEAR_API_TOKEN env var, ~/.config/el-linear/token, or ~/.linear_api_token file",
  );
}
