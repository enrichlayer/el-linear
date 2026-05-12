/**
 * Step 1 of the wizard: Linear API token.
 *
 * The only required step. Validates the token by calling `viewer { ... }`
 * before saving. Token is stored at ~/.config/el-linear/token (mode 0600),
 * never embedded in config.json.
 */

import { confirm, password } from "@inquirer/prompts";
import { GraphQLService } from "../../utils/graphql-service.js";
import { sanitizeForLog } from "../../utils/sanitize-for-log.js";
import { readToken, writeToken } from "./shared.js";

// Re-export for legacy import paths under `init/`. New code should import
// from `utils/sanitize-for-log.js` directly.
export { sanitizeForLog };

const TOKEN_GENERATION_URL = "https://linear.app/settings/account/security";

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

interface TokenStepResult {
	token: string;
	viewer: ViewerResponse["viewer"];
}

/**
 * Strict shape check on the viewer response. Treats whitespace-only fields as
 * "validated to nothing" — easy to forge with a malformed but truthy stub
 * response, so we require a UUID-shaped id and a basic urlKey.
 */
function viewerIsValid(viewer: unknown): viewer is ViewerResponse["viewer"] {
	if (!viewer || typeof viewer !== "object") return false;
	const v = viewer as Record<string, unknown>;
	const id = typeof v.id === "string" ? v.id.trim() : "";
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
	)
		return false;
	const org = v.organization as Record<string, unknown> | null | undefined;
	if (!org || typeof org !== "object") return false;
	const urlKey = typeof org.urlKey === "string" ? org.urlKey.trim() : "";
	if (!/^[a-z0-9-]+$/i.test(urlKey)) return false;
	return true;
}

/**
 * Validate a Linear API token by fetching the viewer. Throws with a
 * sanitized user-readable message on auth failure — the error string is
 * always run through sanitizeForLog so a leaked token in an upstream error
 * is redacted before it hits stdout.
 */
export async function validateToken(
	token: string,
): Promise<ViewerResponse["viewer"]> {
	const service = new GraphQLService({ apiKey: token });
	let data: ViewerResponse;
	try {
		data = await service.rawRequest<ViewerResponse>(VIEWER_QUERY);
	} catch (err) {
		const raw = err instanceof Error ? err.message : String(err);
		const message = sanitizeForLog(raw);
		if (/AuthenticationFailed|Unauthorized|invalid|expired/i.test(message)) {
			throw new Error(`Token rejected by Linear: ${message}`);
		}
		throw new Error(`Could not validate token: ${message}`);
	}
	if (!viewerIsValid(data?.viewer)) {
		throw new Error(
			"Token validated but the response is missing a viewer with a valid id and organization. " +
				"Try a different token.",
		);
	}
	return data.viewer;
}

/**
 * Run the interactive token step. Returns the validated token + viewer info.
 *
 * On re-run with an existing valid token, the prompt defaults to "keep" — so
 * pressing enter is a no-op.
 */
export async function runTokenStep(
	options: {
		/** Skip the "replace existing?" prompt; always replace if existing is present. */
		force?: boolean;
	} = {},
): Promise<TokenStepResult> {
	const existing = await readToken();

	if (existing && !options.force) {
		try {
			const viewer = await validateToken(existing);
			console.log(
				`  Existing token works — authenticated as ${viewer.displayName} <${viewer.email}>.`,
			);
			const replace = await confirm({
				message: "Replace this token?",
				default: false,
			});
			if (!replace) {
				return { token: existing, viewer };
			}
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			const message = sanitizeForLog(raw);
			console.log(
				`  Existing token failed validation (${message}). You'll need to provide a new one.`,
			);
		}
	}

	console.log(`  Generate a personal API token: ${TOKEN_GENERATION_URL}`);
	console.log(
		"  The token stays on your machine. el-linear only sends it to Linear's API. " +
			"It's stored at ~/.config/el-linear/token (mode 0600).",
	);

	// Up to three attempts before giving up.
	for (let attempt = 0; attempt < 3; attempt++) {
		const token = (
			await password({
				message:
					attempt === 0
						? "Linear API token (input hidden):"
						: "Try again (input hidden):",
				mask: "*",
				validate: (input) => input.trim().length > 0 || "Token cannot be empty",
			})
		).trim();

		try {
			console.log("  Validating…");
			const viewer = await validateToken(token);
			await writeToken(token);
			console.log(
				`  ✓ Authenticated as ${viewer.displayName} <${viewer.email}> (${viewer.organization.name}).`,
			);
			return { token, viewer };
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			console.log(`  ✗ ${sanitizeForLog(raw)}`);
		}
	}
	throw new Error(
		"Could not validate a Linear API token after 3 attempts. Aborting.",
	);
}
