/**
 * Optional local OAuth app defaults.
 *
 * This deliberately lives outside the packaged/default config. Teams can
 * materialize it from a password manager, while the OSS CLI keeps requiring
 * users to bring their own OAuth app when no local file exists.
 */

import fs from "node:fs/promises";
import { TEAM_OAUTH_CONFIG_PATH } from "../config/paths.js";
import {
	DEFAULT_SCOPES,
	type OAuthActor,
	type OAuthScope,
	validateActorScopes,
	validateOAuthActor,
	validateScopes,
} from "./oauth-client.js";

const TEAM_OAUTH_CONFIG_ENV = "EL_LINEAR_OAUTH_CONFIG";

interface TeamOAuthConfig {
	actor: OAuthActor;
	clientId: string;
	redirectPort: number;
	scopes: OAuthScope[];
	/**
	 * Optional human-facing pointer such as `op://vault/item/client_id`.
	 * The CLI does not execute password-manager commands from this value.
	 */
	passwordManagerPath?: string;
	sourcePath: string;
}

interface TeamOAuthConfigFile {
	linearOAuth?: {
		actor?: unknown;
		clientId?: unknown;
		redirectPort?: unknown;
		scopes?: unknown;
		passwordManagerPath?: unknown;
	};
}

export async function readTeamOAuthConfig(
	env: NodeJS.ProcessEnv = process.env,
): Promise<TeamOAuthConfig | null> {
	const envPath = env[TEAM_OAUTH_CONFIG_ENV]?.trim();
	const sourcePath = envPath || TEAM_OAUTH_CONFIG_PATH;
	let raw: string;
	try {
		raw = await fs.readFile(sourcePath, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT" && !envPath) {
			return null;
		}
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(
				`${TEAM_OAUTH_CONFIG_ENV} points to ${sourcePath}, but that file does not exist.`,
			);
		}
		throw err;
	}

	let parsed: TeamOAuthConfigFile;
	try {
		parsed = JSON.parse(raw) as TeamOAuthConfigFile;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Failed to parse ${sourcePath}: ${message}`);
	}

	const linearOAuth = parsed.linearOAuth;
	if (!linearOAuth || typeof linearOAuth !== "object") {
		throw new Error(
			`${sourcePath} must contain a linearOAuth object with a clientId.`,
		);
	}

	const clientId =
		typeof linearOAuth.clientId === "string" ? linearOAuth.clientId.trim() : "";
	if (!clientId) {
		throw new Error(`${sourcePath} linearOAuth.clientId must be a string.`);
	}

	const redirectPort = parseRedirectPort(linearOAuth.redirectPort, sourcePath);
	const scopes = parseScopes(linearOAuth.scopes, sourcePath);
	const actor = parseActor(linearOAuth.actor, sourcePath);
	validateActorScopes(actor, scopes);
	const passwordManagerPath = parsePasswordManagerPath(
		linearOAuth.passwordManagerPath,
		sourcePath,
	);

	return {
		actor,
		clientId,
		redirectPort,
		scopes,
		passwordManagerPath,
		sourcePath,
	};
}

function parseActor(value: unknown, sourcePath: string): OAuthActor {
	if (value === undefined) return "user";
	if (typeof value !== "string") {
		throw new Error(`${sourcePath} linearOAuth.actor must be "user" or "app".`);
	}
	return validateOAuthActor(value);
}

function parseRedirectPort(value: unknown, sourcePath: string): number {
	if (value === undefined) return 8765;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1024 ||
		value > 65535
	) {
		throw new Error(
			`${sourcePath} linearOAuth.redirectPort must be an integer between 1024 and 65535.`,
		);
	}
	return value;
}

function parseScopes(value: unknown, sourcePath: string): OAuthScope[] {
	if (value === undefined) return [...DEFAULT_SCOPES];
	if (!Array.isArray(value) || !value.every((s) => typeof s === "string")) {
		throw new Error(`${sourcePath} linearOAuth.scopes must be a string array.`);
	}
	return validateScopes(value);
}

function parsePasswordManagerPath(
	value: unknown,
	sourcePath: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw new Error(
			`${sourcePath} linearOAuth.passwordManagerPath must be a string when set.`,
		);
	}
	const trimmed = value.trim();
	return trimmed || undefined;
}
