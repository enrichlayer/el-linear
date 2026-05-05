/**
 * Step 1 of the wizard: Linear API token.
 *
 * The only required step. Validates the token by calling `viewer { ... }`
 * before saving. Token is stored at ~/.config/linctl/token (mode 0600),
 * never embedded in config.json.
 */

import { confirm, password } from "@inquirer/prompts";
import { GraphQLService } from "../../utils/graphql-service.js";
import { readToken, writeToken } from "./shared.js";

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

export interface TokenStepResult {
	token: string;
	viewer: ViewerResponse["viewer"];
}

/**
 * Validate a Linear API token by fetching the viewer. Throws with a
 * user-readable message on auth failure.
 */
export async function validateToken(
	token: string,
): Promise<ViewerResponse["viewer"]> {
	const service = new GraphQLService(token);
	try {
		const data = await service.rawRequest<ViewerResponse>(VIEWER_QUERY);
		if (!data?.viewer?.id) {
			throw new Error(
				"Token validated but no viewer was returned. Try a different token.",
			);
		}
		return data.viewer;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/AuthenticationFailed|Unauthorized|invalid|expired/i.test(message)) {
			throw new Error(`Token rejected by Linear: ${message}`);
		}
		throw new Error(`Could not validate token: ${message}`);
	}
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
			// biome-ignore lint/suspicious/noConsole: wizard
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
			const message = err instanceof Error ? err.message : String(err);
			// biome-ignore lint/suspicious/noConsole: wizard
			console.log(
				`  Existing token failed validation (${message}). You'll need to provide a new one.`,
			);
		}
	}

	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(`  Generate a personal API token: ${TOKEN_GENERATION_URL}`);
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(
		"  The token stays on your machine. linctl only sends it to Linear's API. " +
			"It's stored at ~/.config/linctl/token (mode 0600).",
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
			// biome-ignore lint/suspicious/noConsole: wizard
			console.log("  Validating…");
			const viewer = await validateToken(token);
			await writeToken(token);
			// biome-ignore lint/suspicious/noConsole: wizard
			console.log(
				`  ✓ Authenticated as ${viewer.displayName} <${viewer.email}> (${viewer.organization.name}).`,
			);
			return { token, viewer };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// biome-ignore lint/suspicious/noConsole: wizard
			console.log(`  ✗ ${message}`);
		}
	}
	throw new Error(
		"Could not validate a Linear API token after 3 attempts. Aborting.",
	);
}
