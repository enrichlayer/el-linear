import fs from "node:fs";
import {
	LEGACY_LINCTL_TOKEN_PATH,
	LEGACY_TOKEN_PATH,
	resolveActiveProfile,
} from "../config/paths.js";
import { maybeEmitMigrationHint } from "./migration-hint.js";

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
	// profile is active. When the user has explicitly selected a profile
	// (--profile / EL_LINEAR_PROFILE / active-profile marker), do NOT
	// fall back to the legacy single-file token — that path silently
	// posts writes to the wrong workspace when a profile token is missing.
	const active = resolveActiveProfile();
	if (fs.existsSync(active.tokenPath)) {
		return fs.readFileSync(active.tokenPath, "utf8").trim();
	}
	if (active.name !== null) {
		throw new Error(
			`No token for active profile \`${active.name}\` (expected at ${active.tokenPath}). Run \`el-linear init token --profile ${active.name}\` (or unset --profile / EL_LINEAR_PROFILE / \`el-linear profile use <name>\`) before retrying. Refusing to fall back to the legacy single-file token to avoid posting writes to the wrong workspace.`,
		);
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

	// Before falling through to the auth error, check for legacy-config
	// drift (legacy `config.json` present but no token, or active-profile
	// pointer broken). If detected, emit a one-shot stderr hint pointing
	// the user at `el-linear profile migrate-legacy`. The hint is purely
	// informational — we always still throw below, so scripted callers
	// continue to see a non-zero exit and a parseable JSON error on stdout.
	maybeEmitMigrationHint();

	const profileNote = active.name
		? ` (active profile: \`${active.name}\` — expected token at ${active.tokenPath})`
		: "";
	throw new Error(
		`No API token found${profileNote}. Use --api-token, LINEAR_API_TOKEN env var, ~/.config/el-linear/token, or ~/.linear_api_token file. To switch profiles, use \`el-linear profile use <name>\` or \`--profile <name>\`.`,
	);
}
