import fs from "node:fs";
import {
	LEGACY_LINCTL_TOKEN_PATH,
	LEGACY_TOKEN_PATH,
	resolveActiveProfile,
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

	// Profile-aware: read from <CONFIG_DIR>/profiles/<name>/token when a
	// profile is active, falling back to the legacy single-file path
	// (TOKEN_PATH) for the no-profile case.
	const active = resolveActiveProfile();
	if (fs.existsSync(active.tokenPath)) {
		return fs.readFileSync(active.tokenPath, "utf8").trim();
	}

	// Even when a profile is selected, fall through to the legacy token
	// path so an operator who only has the single-file layout doesn't
	// suddenly fail. The active-profile name is informational only when
	// no profile-scoped token exists yet.
	if (active.tokenPath !== TOKEN_PATH && fs.existsSync(TOKEN_PATH)) {
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

	const profileNote = active.name
		? ` (active profile: \`${active.name}\` — expected token at ${active.tokenPath})`
		: "";
	throw new Error(
		`No API token found${profileNote}. Use --api-token, LINEAR_API_TOKEN env var, ~/.config/el-linear/token, or ~/.linear_api_token file. To switch profiles, use \`el-linear profile use <name>\` or \`--profile <name>\`.`,
	);
}
