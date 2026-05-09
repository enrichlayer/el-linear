/**
 * Localhost HTTP listener that captures the OAuth redirect.
 *
 * Linear redirects the user's browser to
 *   http://localhost:<port>/oauth/callback?code=…&state=…
 * after they approve the app. We spin a one-shot HTTP server, parse the
 * callback, validate `state`, return `{code, state}`, then close.
 *
 * Hardening:
 *   - Only listens on `127.0.0.1` (NOT `0.0.0.0`) so other hosts on the
 *     network can't race to grab the code.
 *   - Rejects requests with a missing/wrong `state` parameter.
 *   - Has a timeout (default 5 minutes) so a user who closes the browser
 *     tab doesn't leave the CLI hanging forever.
 *   - Sends a friendly success/error HTML page back so the user knows what
 *     to do next ("you can close this tab").
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import { type CallbackParams, parseCallbackUrl } from "./oauth-client.js";

export const DEFAULT_CALLBACK_PATH = "/oauth/callback";
export const DEFAULT_LISTEN_HOST = "127.0.0.1";
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface CallbackOptions {
	port: number;
	expectedState: string;
	host?: string;
	callbackPath?: string;
	timeoutMs?: number;
}

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>el-linear · authorized</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:64px auto;padding:0 16px;color:#1a1a1a}h1{font-size:18px;margin:0 0 12px}p{margin:8px 0}.ok{color:#0a7e35}</style>
</head>
<body>
<h1 class="ok">el-linear · authorization complete</h1>
<p>You can close this tab and return to your terminal.</p>
</body>
</html>`;

// Fixed error page — never interpolates attacker-controlled prose.
//
// Pre-fix: the upstream `error_description` from the redirect URL was
// embedded into the HTML response (with `<>&` stripped). An attacker
// who knew the local listener port could fire
// `http://localhost:<port>/oauth/callback?error=phish&error_description=Your+account+is+compromised…`
// and have arbitrary phishing prose render in the user's browser
// before the legitimate redirect arrived. Now we render a fixed
// string and log the upstream detail to the terminal where the user
// can compare it to expected output.
const ERROR_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>el-linear · authorization error</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:64px auto;padding:0 16px;color:#1a1a1a}h1{font-size:18px;margin:0 0 12px}p{margin:8px 0}.bad{color:#a30000}code{background:#f4f4f4;padding:2px 4px;border-radius:3px}</style>
</head>
<body>
<h1 class="bad">el-linear · authorization error</h1>
<p>Authorization failed. Return to your terminal — the CLI has the details.</p>
<p>You can close this tab. Re-run <code>el-linear init oauth</code> to retry.</p>
</body>
</html>`;

/**
 * Spin up a one-shot HTTP server on `127.0.0.1:<port>`, accept the OAuth
 * callback, validate state, and resolve with `{code, state}`.
 *
 * Always closes the server before resolving / rejecting.
 *
 * Test seam: `serverFactory` lets tests inject a mock server so we don't
 * have to bind to a real port (and avoid flakiness from port collisions in
 * CI).
 */
export async function runLocalhostCallback(
	options: CallbackOptions,
	serverFactory: () => Server = () => createServer(),
): Promise<CallbackParams> {
	const host = options.host ?? DEFAULT_LISTEN_HOST;
	const callbackPath = options.callbackPath ?? DEFAULT_CALLBACK_PATH;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const server = serverFactory();
	let timeoutHandle: NodeJS.Timeout | null = null;

	return new Promise<CallbackParams>((resolve, reject) => {
		const settle = (
			run: () => void,
			finalize: { closeServer: boolean } = { closeServer: true },
		) => {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}
			if (finalize.closeServer) {
				server.close(() => run());
			} else {
				run();
			}
		};

		server.on("request", (req, res) => {
			try {
				const incoming = req as IncomingMessage;
				const rawUrl = incoming.url ?? "";
				// Only respond on the configured callback path; all other
				// requests get a 404 so a stray `/favicon.ico` poke doesn't
				// trigger a parse error.
				const pathname = new URL(rawUrl, "http://localhost").pathname;
				if (pathname !== callbackPath) {
					res.statusCode = 404;
					res.setHeader("content-type", "text/plain; charset=utf-8");
					res.end("Not found.");
					return;
				}

				let parsed: CallbackParams;
				try {
					parsed = parseCallbackUrl(rawUrl);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					res.statusCode = 400;
					res.setHeader("content-type", "text/html; charset=utf-8");
					res.end(ERROR_HTML);
					settle(() => reject(new Error(message)));
					return;
				}

				if (parsed.state !== options.expectedState) {
					const message =
						"State mismatch — the OAuth callback's `state` parameter doesn't match what we sent. This could indicate a CSRF attempt; aborting.";
					res.statusCode = 400;
					res.setHeader("content-type", "text/html; charset=utf-8");
					res.end(ERROR_HTML);
					settle(() => reject(new Error(message)));
					return;
				}

				res.statusCode = 200;
				res.setHeader("content-type", "text/html; charset=utf-8");
				res.end(SUCCESS_HTML);
				settle(() => resolve(parsed));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				try {
					res.statusCode = 500;
					res.setHeader("content-type", "text/plain; charset=utf-8");
					res.end(`internal error: ${message}`);
				} catch {
					// Connection already closed — nothing to do.
				}
				settle(() => reject(err instanceof Error ? err : new Error(message)));
			}
		});

		server.on("error", (err: NodeJS.ErrnoException) => {
			const code = err.code ?? "UNKNOWN";
			const friendly =
				code === "EADDRINUSE"
					? `Port ${options.port} is already in use. Pick another with --port <n>.`
					: `Could not start localhost listener on ${host}:${options.port} (${code}: ${err.message}).`;
			settle(() => reject(new Error(friendly)), { closeServer: false });
		});

		timeoutHandle = setTimeout(() => {
			settle(() =>
				reject(
					new Error(
						`OAuth callback timed out after ${Math.round(timeoutMs / 1000)}s. Re-run \`el-linear init oauth\`.`,
					),
				),
			);
		}, timeoutMs);
		// Don't keep the event loop alive solely on the timeout.
		timeoutHandle.unref?.();

		server.listen(options.port, host);
	});
}
