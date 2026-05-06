import fs from "node:fs";
import {
	LEGACY_LINCTL_TOKEN_PATH,
	LEGACY_TOKEN_PATH,
	TOKEN_PATH,
} from "../config/paths.js";

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

	if (fs.existsSync(TOKEN_PATH)) {
		return fs.readFileSync(TOKEN_PATH, "utf8").trim();
	}

	// Fallback to the linctl-era token (the CLI was briefly published as
	// `@enrichlayer/linctl` then reverted). Kept for one release.
	if (fs.existsSync(LEGACY_LINCTL_TOKEN_PATH)) {
		return fs.readFileSync(LEGACY_LINCTL_TOKEN_PATH, "utf8").trim();
	}

	// Even older fallback from before the `~/.config/...` move.
	if (fs.existsSync(LEGACY_TOKEN_PATH)) {
		return fs.readFileSync(LEGACY_TOKEN_PATH, "utf8").trim();
	}

	throw new Error(
		"No API token found. Use --api-token, LINEAR_API_TOKEN env var, ~/.config/el-linear/token, or ~/.linear_api_token file",
	);
}
