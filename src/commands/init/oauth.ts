/**
 * Wizard step for OAuth 2.0 (PKCE flow) authorization.
 *
 * Flow:
 *   1. Read optional local/team OAuth app defaults, if present.
 *   2. Otherwise present a "what is this?" intro pointing the user at
 *      Linear's OAuth app registration page, then prompt for `client_id`,
 *      optional `client_secret`, port, scopes.
 *   3. Generate PKCE verifier + state, build the authorize URL.
 *   4. Try to open the system browser; fall back to printing the URL.
 *   5. Spin a localhost listener (or fall back to pasted-code prompt) to
 *      receive the redirect.
 *   6. Exchange code for tokens.
 *   7. Validate by calling `viewer { ... }` with the new bearer token.
 *   8. Persist `oauth.json` to the active profile.
 *
 * Idempotent: if a fresh `oauth.json` already exists, offer keep / re-auth /
 * revoke before doing anything else.
 */

import { spawn } from "node:child_process";
import { checkbox, input, password, select } from "@inquirer/prompts";
import { readTeamOAuthConfig } from "../../auth/oauth-app-config.js";
import {
	DEFAULT_CALLBACK_PATH,
	runLocalhostCallback,
} from "../../auth/oauth-callback.js";
import {
	ALL_SCOPES,
	buildAuthorizeUrl,
	DEFAULT_SCOPES,
	generatePkce,
	generateState,
	type OAuthScope,
	SCOPE_DESCRIPTIONS,
	validateScopes,
} from "../../auth/oauth-client.js";
import { promptForPastedCode } from "../../auth/oauth-headless.js";
import {
	clearOAuthState,
	OAUTH_STATE_VERSION,
	type OAuthState,
	readOAuthState,
	writeOAuthState,
} from "../../auth/oauth-storage.js";
import {
	exchangeCodeForTokens,
	type FetchLike,
	revokeToken,
} from "../../auth/oauth-token.js";
import { GraphQLService } from "../../utils/graphql-service.js";
import { sanitizeForLog } from "./token.js";

const DEFAULT_PORT = 8765;
const REGISTRATION_URL = "https://linear.app/settings/api/applications/new";

const VIEWER_QUERY = /* GraphQL */ `
  query {
    viewer {
      id
      name
      email
      displayName
      organization {
        urlKey
        name
      }
    }
  }
`;

interface ViewerResponse {
	viewer: {
		id: string;
		name: string;
		email: string;
		displayName: string;
		organization: { urlKey: string; name: string };
	};
}

export interface OAuthStepOptions {
	/** Force re-authorization even if existing state is valid. */
	force?: boolean;
	/** Skip the localhost listener; use the headless code-paste prompt. */
	noBrowser?: boolean;
	/** Override the localhost port. Default 8765. */
	port?: number;
	/**
	 * Allow pasting a bare authorization code (no surrounding URL) in
	 * the headless flow. Bypasses the OAuth `state` CSRF check, so
	 * opt-in only — see `oauth-headless.ts` for the rationale.
	 */
	unsafeBareCode?: boolean;
	/** Test seam for the OAuth token endpoint. */
	fetchImpl?: FetchLike;
	/**
	 * Test seam for the localhost listener. Default uses the real one.
	 */
	runLocalhostCallbackImpl?: typeof runLocalhostCallback;
	/** Test seam for the system-browser opener. Default uses spawn. */
	openBrowser?: (url: string) => Promise<void>;
	/** Test seam for `viewer` validation against the new bearer token. */
	validateViewer?: (oauthToken: string) => Promise<ViewerResponse["viewer"]>;
}

interface OAuthStepResult {
	state: OAuthState;
	viewer: ViewerResponse["viewer"];
}

const TS = (msg: string): string => `  ${msg}`;

function logLine(msg: string): void {
	console.log(msg);
}

/**
 * Open `url` in the system browser. Forks per-platform:
 *   - darwin → `open <url>`
 *   - win32  → `start "" "<url>"` (cmd builtin)
 *   - other  → `xdg-open <url>` (Linux / BSD with desktop env)
 *
 * Returns once the spawn call succeeds — does NOT wait for the browser to
 * actually load. Throws on spawn failure (e.g. xdg-open not installed in
 * a barebones container).
 */
export async function openSystemBrowser(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let cmd: string;
		let args: string[];
		if (process.platform === "darwin") {
			cmd = "open";
			args = [url];
		} else if (process.platform === "win32") {
			cmd = "cmd";
			// `start "" "<url>"` — empty title means "use the URL".
			args = ["/c", "start", "", url];
		} else {
			cmd = "xdg-open";
			args = [url];
		}
		const child = spawn(cmd, args, { stdio: "ignore", detached: true });
		child.once("error", reject);
		// Don't keep the parent alive on the child — we don't track its exit.
		child.unref();
		// Linux's xdg-open immediately exits with the result code. Wait
		// until the next tick so a synchronous `error` event has a chance
		// to fire before we resolve.
		setImmediate(() => resolve());
	});
}

type ExistingChoice =
	| { kind: "keep"; state: OAuthState }
	| { kind: "reauth" }
	| { kind: "revoked" };

/**
 * Prompt for what to do with existing OAuth state. Returns a discriminated
 * tagged union so the caller can branch cleanly.
 */
async function handleExistingState(
	existing: OAuthState,
	options: OAuthStepOptions,
): Promise<ExistingChoice> {
	if (options.force) return { kind: "reauth" };
	logLine(
		TS(
			`Existing OAuth tokens found for client ${existing.clientId} (${existing.scopes.join(",")}).`,
		),
	);
	const choice = await select<"keep" | "reauth" | "revoke">({
		message: "What would you like to do?",
		choices: [
			{ name: "Keep existing tokens (no changes)", value: "keep" },
			{ name: "Re-authorize (replace tokens)", value: "reauth" },
			{ name: "Revoke and remove", value: "revoke" },
		],
		default: "keep",
	});
	if (choice === "keep") return { kind: "keep", state: existing };
	if (choice === "revoke") {
		const result = await revokeToken(
			{ accessToken: existing.accessToken },
			options.fetchImpl,
		);
		await clearOAuthState();
		logLine(
			TS(
				result.ok
					? "✓ Token revoked and oauth.json removed."
					: `Revoke endpoint returned ${result.status} (${sanitizeForLog(result.message ?? "")}). Local oauth.json removed anyway.`,
			),
		);
		return { kind: "revoked" };
	}
	return { kind: "reauth" };
}

interface RegistrationAnswers {
	clientId: string;
	clientSecret?: string;
	port: number;
	scopes: OAuthScope[];
}

/** Extract the port from a stored `http://localhost:NNN/...` redirect URI, if any. */
function extractPortFromRedirect(state: OAuthState | null): number | null {
	if (!state) return null;
	const match = state.registeredRedirectUri.match(/:(\d+)\//);
	if (!match) return null;
	const n = Number.parseInt(match[1], 10);
	return Number.isInteger(n) ? n : null;
}

/** Walk the user through their OAuth-app registration values. */
async function promptRegistration(defaults: {
	port?: number;
}): Promise<RegistrationAnswers> {
	logLine("");
	logLine(TS(`Register a Linear OAuth app: ${REGISTRATION_URL}`));
	logLine(
		TS(
			`Set the redirect URL to: http://localhost:${defaults.port ?? DEFAULT_PORT}${DEFAULT_CALLBACK_PATH}`,
		),
	);
	logLine(
		TS(
			"Then paste the client_id (and client_secret, if your app is configured as confidential).",
		),
	);
	logLine("");

	const port = Number.parseInt(
		await input({
			message: "Localhost callback port:",
			default: String(defaults.port ?? DEFAULT_PORT),
			validate: (value) => {
				const n = Number.parseInt(value, 10);
				if (!Number.isInteger(n) || n < 1024 || n > 65535) {
					return "Port must be an integer between 1024 and 65535";
				}
				return true;
			},
		}),
		10,
	);
	const clientId = (
		await input({
			message: "Linear OAuth client_id:",
			validate: (v) => v.trim().length > 0 || "client_id cannot be empty",
		})
	).trim();
	const clientSecret = (
		await password({
			message:
				"Linear OAuth client_secret (optional, hidden — press enter to skip):",
			mask: "*",
			validate: () => true,
		})
	).trim();

	const scopes = (await checkbox({
		message: "Scopes (space to toggle, enter to confirm):",
		choices: ALL_SCOPES.map((s) => ({
			name: `${s} — ${SCOPE_DESCRIPTIONS[s]}`,
			value: s,
			checked: (DEFAULT_SCOPES as readonly OAuthScope[]).includes(s),
		})),
		validate: (selections) =>
			selections.length > 0 || "Pick at least one scope",
	})) as OAuthScope[];

	return {
		clientId,
		clientSecret: clientSecret || undefined,
		port,
		scopes: validateScopes(scopes),
	};
}

async function resolveRegistration(defaults: {
	manualPort: number;
	requestedPort?: number;
}): Promise<RegistrationAnswers> {
	const teamConfig = await readTeamOAuthConfig();
	if (!teamConfig) {
		return promptRegistration({ port: defaults.manualPort });
	}

	const port = defaults.requestedPort ?? teamConfig.redirectPort;
	logLine("");
	logLine(TS(`Using Linear OAuth app defaults from ${teamConfig.sourcePath}.`));
	logLine(TS(`Callback URL: http://localhost:${port}${DEFAULT_CALLBACK_PATH}`));
	logLine("");

	return {
		clientId: teamConfig.clientId,
		port,
		scopes: teamConfig.scopes,
	};
}

/**
 * Default viewer-validation routine. Calls `viewer { ... }` with the new
 * bearer token to confirm Linear accepted it. Reused for both the wizard
 * step's success path and the test seam.
 */
async function defaultValidateViewer(
	oauthToken: string,
): Promise<ViewerResponse["viewer"]> {
	const service = new GraphQLService({ oauthToken });
	let data: ViewerResponse;
	try {
		data = await service.rawRequest<ViewerResponse>(VIEWER_QUERY);
	} catch (err) {
		const raw = err instanceof Error ? err.message : String(err);
		throw new Error(
			`Could not validate the OAuth access token via viewer: ${sanitizeForLog(raw)}`,
		);
	}
	const viewer = data?.viewer;
	if (!viewer || typeof viewer !== "object" || typeof viewer.id !== "string") {
		throw new Error(
			"OAuth token validated but the response was missing a viewer with id. Try a different scope set.",
		);
	}
	return viewer;
}

/**
 * Run the OAuth step. Returns the final stored state + viewer info.
 *
 * If the user opts to keep their existing tokens, returns the existing
 * state unchanged (no network calls).
 */
export async function runOAuthStep(
	options: OAuthStepOptions = {},
): Promise<OAuthStepResult> {
	const validateViewer = options.validateViewer ?? defaultValidateViewer;

	const existing = await readOAuthState();
	if (existing && !options.force) {
		const handled = await handleExistingState(existing, options);
		if (handled.kind === "keep") {
			// Validate the existing token actually works; if it's already
			// expired and unrefreshable, the next `el-linear` invocation
			// would fall over — fail loudly here.
			try {
				const viewer = await validateViewer(handled.state.accessToken);
				logLine(
					TS(
						`✓ Existing OAuth tokens verified — authenticated as ${viewer.displayName} <${viewer.email}>.`,
					),
				);
				return { state: handled.state, viewer };
			} catch (err) {
				const raw = err instanceof Error ? err.message : String(err);
				logLine(
					TS(
						`Existing token failed validation (${sanitizeForLog(raw)}). Continuing with re-authorization…`,
					),
				);
			}
		}
		// Both `reauth` and `revoked` fall through to the re-auth flow.
	}

	const reg = await resolveRegistration({
		manualPort:
			options.port ?? extractPortFromRedirect(existing) ?? DEFAULT_PORT,
		requestedPort: options.port,
	});

	const redirectUri = `http://localhost:${reg.port}${DEFAULT_CALLBACK_PATH}`;
	const pkce = generatePkce();
	const state = generateState();
	const authorizeUrl = buildAuthorizeUrl({
		clientId: reg.clientId,
		redirectUri,
		scopes: reg.scopes,
		state,
		codeChallenge: pkce.challenge,
	});

	logLine("");
	logLine(TS("Opening your browser to authorize…"));
	logLine(TS(`If it doesn't open, visit: ${authorizeUrl}`));

	const useBrowser = !options.noBrowser;
	let browserOpened = false;
	if (useBrowser) {
		try {
			await (options.openBrowser ?? openSystemBrowser)(authorizeUrl);
			browserOpened = true;
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			logLine(
				TS(
					`Could not open a browser automatically (${raw}). Falling back to manual.`,
				),
			);
		}
	}

	let callback: { code: string; state: string };
	if (browserOpened) {
		try {
			callback = await (
				options.runLocalhostCallbackImpl ?? runLocalhostCallback
			)({
				port: reg.port,
				expectedState: state,
			});
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			logLine(
				TS(
					`Localhost listener failed (${sanitizeForLog(raw)}). Falling back to manual paste.`,
				),
			);
			callback = await promptForPastedCode({
				expectedState: state,
				unsafeBareCode: options.unsafeBareCode,
			});
		}
	} else {
		callback = await promptForPastedCode({
			expectedState: state,
			unsafeBareCode: options.unsafeBareCode,
		});
	}

	logLine(TS("Exchanging authorization code for tokens…"));
	const exchanged = await exchangeCodeForTokens(
		{
			clientId: reg.clientId,
			clientSecret: reg.clientSecret,
			code: callback.code,
			redirectUri,
			codeVerifier: pkce.verifier,
		},
		options.fetchImpl,
	);

	const newState: OAuthState = {
		v: OAUTH_STATE_VERSION,
		clientId: reg.clientId,
		clientSecret: reg.clientSecret,
		registeredRedirectUri: redirectUri,
		accessToken: exchanged.accessToken,
		refreshToken: exchanged.refreshToken,
		tokenType: exchanged.tokenType,
		scopes: exchanged.scopes.length > 0 ? exchanged.scopes : reg.scopes,
		expiresAt: exchanged.expiresAt,
		obtainedAt: Date.now(),
	};

	logLine(TS("Validating against viewer…"));
	const viewer = await validateViewer(newState.accessToken);
	await writeOAuthState(newState);
	logLine(
		TS(
			`✓ Authorized as ${viewer.displayName} <${viewer.email}> (${viewer.organization.name}).`,
		),
	);
	return { state: newState, viewer };
}

/**
 * `init oauth --revoke`: revoke the active profile's tokens and remove
 * `oauth.json`. Best-effort on the network call.
 */
export async function runOAuthRevoke(
	options: { fetchImpl?: FetchLike } = {},
): Promise<{ revoked: boolean; message: string }> {
	const existing = await readOAuthState();
	if (!existing) {
		return { revoked: false, message: "No OAuth state to revoke." };
	}
	const result = await revokeToken(
		{ accessToken: existing.accessToken },
		options.fetchImpl,
	);
	await clearOAuthState();
	if (result.ok) {
		return {
			revoked: true,
			message: "✓ Token revoked and oauth.json removed.",
		};
	}
	return {
		revoked: false,
		message: `Revoke endpoint returned ${result.status} (${sanitizeForLog(result.message ?? "")}). Local oauth.json removed anyway.`,
	};
}
