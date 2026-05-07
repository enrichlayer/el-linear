/**
 * `el-linear profile migrate-legacy` — one-shot migration from the legacy
 * single-file config layout (`~/.config/el-linear/{token,config.json}`) to
 * the named-profiles layout introduced in 1.4 (`~/.config/el-linear/
 * profiles/<name>/{token,config.json}`).
 *
 * Why this command exists:
 *
 *   When a user upgraded el-linear to >=1.4, their existing single-file
 *   `config.json` was preserved verbatim, but the legacy `token` slot was
 *   sometimes cleared (depending on how the upgrade was performed) and
 *   1.4 expects per-profile tokens. Result: every command failed with
 *   "Authentication required" while the rich legacy config (member
 *   aliases, brand rules, default labels) sat right there on disk with
 *   no documented migration path.
 *
 * Design constraints:
 *
 * - **Each step is independently idempotent.** Re-running the command
 *   after a successful migration is a no-op — config + token files match,
 *   active-profile already points at the right name. Re-running after a
 *   partial failure picks up where it left off without `--force`.
 *
 * - **Validate before writing.** A token that doesn't pass `viewer { ... }`
 *   never lands on disk. The validate-then-write order means an interrupted
 *   migration can't leave a dud token in a freshly-created profile dir.
 *
 * - **Legacy preservation.** We never delete the legacy `config.json` or
 *   `token` — the user gets a rollback path. A one-line stdout hint says
 *   so explicitly.
 *
 * - **`--force` is opt-in destruction.** When the destination profile
 *   already has a config.json or token that *differs* from the source,
 *   the command refuses by default with a clear diff hint. `--force`
 *   overwrites; `--yes` skips the interactive confirm. Both are
 *   required-together for unattended (CI / scripted) overwrites.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { confirm, input, password } from "@inquirer/prompts";
import type { Command } from "commander";

import {
	ACTIVE_PROFILE_FILE,
	CONFIG_DIR,
	CONFIG_PATH,
	PROFILES_DIR,
	profilePaths,
	TOKEN_PATH,
} from "../../config/paths.js";
import { sanitizeForLog, validateToken } from "../init/token.js";

export interface MigrateLegacyOptions {
	/** Target profile name. Defaults to "default" when omitted. */
	name?: string;
	/** Path to a file containing the API token (whitespace trimmed). */
	tokenFrom?: string;
	/** Overwrite existing profile config.json/token even if they differ. */
	force?: boolean;
	/** Skip interactive confirmation when --force is needed. */
	yes?: boolean;
	/** Skip the interactive name prompt — use whatever `name` resolved to. */
	skipPrompt?: boolean;
}

export interface MigrateLegacyDeps {
	/**
	 * Hook around the `viewer` validation call so tests can short-circuit
	 * the GraphQL roundtrip. Production wiring uses the real
	 * `validateToken` from `init/token.ts`.
	 */
	validateToken?: (token: string) => Promise<{
		id: string;
		organization: { urlKey: string; name: string };
		displayName: string;
		email: string;
	}>;
	/** stdout writer (for the success line + "kept for rollback" hint). */
	stdout?: { write: (chunk: string) => void };
	/**
	 * Inquirer-based prompts. Tests inject deterministic responses so we
	 * don't need a TTY.
	 */
	prompts?: {
		input: typeof input;
		password: typeof password;
		confirm: typeof confirm;
	};
}

const DEFAULT_PROMPTS = { input, password, confirm };

/** Register `el-linear profile migrate-legacy` under the parent `profile` command. */
export function registerMigrateLegacy(profile: Command): void {
	profile
		.command("migrate-legacy")
		.description(
			"Copy the legacy ~/.config/el-linear/{config.json,token} into a named profile so >=1.4 commands work again.",
		)
		.option(
			"--name <name>",
			"Target profile name. Defaults to `default`.",
			"default",
		)
		.option(
			"--token-from <path>",
			"Read the API token from this file instead of prompting.",
		)
		.option(
			"--force",
			"Overwrite an existing per-profile config.json or token even when contents differ.",
		)
		.option(
			"--yes",
			"Skip interactive confirmations (still respects --force semantics).",
		)
		.action(
			async (opts: {
				name: string;
				tokenFrom?: string;
				force?: boolean;
				yes?: boolean;
			}) => {
				await runMigrateLegacy({
					name: opts.name,
					tokenFrom: opts.tokenFrom,
					force: opts.force === true,
					yes: opts.yes === true,
				});
			},
		);
}

/**
 * Top-level orchestrator. Each helper below is independently idempotent;
 * this function just sequences them and prints the final ✓ banner.
 *
 * Exit semantics:
 *
 *   - Missing legacy config → `process.exit(1)` (user error, nothing to do).
 *   - Refused overwrite (no --force) → throws — handled by handleAsyncCommand
 *     elsewhere in the CLI and surfaces as a structured JSON error on stdout.
 *   - Token validation failure → throws (no on-disk change has happened yet).
 */
export async function runMigrateLegacy(
	options: MigrateLegacyOptions,
	deps: MigrateLegacyDeps = {},
): Promise<void> {
	const stdout = deps.stdout ?? process.stdout;
	const prompts = deps.prompts ?? DEFAULT_PROMPTS;
	const validate = deps.validateToken ?? validateToken;

	// 1. Pre-flight: legacy config must exist. There's nothing to migrate
	//    on a freshly-onboarded machine and we don't want to silently
	//    create an empty profile.
	if (!(await pathExists(CONFIG_PATH))) {
		stdout.write(
			`Nothing to migrate — no legacy config found at ${CONFIG_PATH}.\n`,
		);
		stdout.write("If this is a fresh install, run `el-linear init` instead.\n");
		process.exit(1);
	}

	const initialName = (options.name ?? "default").trim() || "default";
	let name = initialName;

	// Allow an interactive override of the target name unless --yes was passed
	// (scripted) or --name was explicitly set to something other than the
	// default. Keeps backward compat with the CLI flag while not surprising
	// CI runs.
	if (!options.skipPrompt && !options.yes && options.name === undefined) {
		const answer = await prompts.input({
			message: "Target profile name:",
			default: name,
		});
		const trimmed = answer.trim();
		if (trimmed.length > 0) name = trimmed;
	}
	if (!isSafeName(name)) {
		throw new Error(
			`Invalid profile name "${name}". Allowed: [a-z0-9_.-], up to 64 chars.`,
		);
	}

	// 2. Token source priority: --token-from > EL_LINEAR_TOKEN > prompt.
	//    Validate before writing anything to disk.
	const token = await resolveAndValidateToken(options, prompts, validate);

	// 3. Profile dir.
	const paths = profilePaths(name);
	const profileDir = path.dirname(paths.configPath);
	await fsp.mkdir(profileDir, { recursive: true, mode: 0o700 });

	// 4. Config copy with idempotent + force semantics.
	await copyConfigIntoProfile(paths.configPath, options, prompts);

	// 5. Token write with idempotent + force semantics.
	await writeProfileToken(paths.tokenPath, token, options, prompts);

	// 6. active-profile marker.
	await ensureActiveProfile(name);

	// 7. Legacy preservation hint. We do NOT delete the legacy paths —
	//    the user gets a rollback if anything went sideways.
	stdout.write(
		`legacy ${CONFIG_PATH} kept for rollback; safe to remove later if no longer needed\n`,
	);

	// 8. Final verify against the freshly-written profile token. This is
	//    a defensive double-check: the token was already validated above,
	//    but verifying *after* the write catches any FS-level surprise
	//    (e.g. wrong token landed in the wrong dir on a multi-profile box).
	const onDiskToken = (await fsp.readFile(paths.tokenPath, "utf8")).trim();
	const viewer = await validate(onDiskToken);
	stdout.write(
		`✓ Migrated. Active profile: ${name}. Workspace: ${viewer.organization.urlKey}\n`,
	);
}

// ---- Helpers --------------------------------------------------------

async function resolveAndValidateToken(
	options: MigrateLegacyOptions,
	prompts: NonNullable<MigrateLegacyDeps["prompts"]>,
	validate: NonNullable<MigrateLegacyDeps["validateToken"]>,
): Promise<string> {
	if (options.tokenFrom) {
		const raw = await fsp.readFile(options.tokenFrom, "utf8");
		const token = raw.trim();
		if (!token) {
			throw new Error(`Token file ${options.tokenFrom} is empty.`);
		}
		await validate(token);
		return token;
	}

	const envToken = process.env.EL_LINEAR_TOKEN?.trim();
	if (envToken) {
		await validate(envToken);
		return envToken;
	}

	// Interactive: up to three attempts, hidden input. We re-prompt on
	// validation failure rather than aborting so the user can paste a
	// fresh token without re-running the whole command.
	for (let attempt = 0; attempt < 3; attempt++) {
		const candidate = (
			await prompts.password({
				message:
					attempt === 0
						? "Linear API token (input hidden):"
						: "Try again (input hidden):",
				mask: "*",
				validate: (s) => s.trim().length > 0 || "Token cannot be empty",
			})
		).trim();
		try {
			await validate(candidate);
			return candidate;
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			console.log(`  ✗ ${sanitizeForLog(raw)}`);
		}
	}
	throw new Error(
		"Could not validate a Linear API token after 3 attempts. Aborting migration.",
	);
}

async function copyConfigIntoProfile(
	destConfigPath: string,
	options: MigrateLegacyOptions,
	prompts: NonNullable<MigrateLegacyDeps["prompts"]>,
): Promise<void> {
	const sourceContent = await fsp.readFile(CONFIG_PATH, "utf8");

	if (!(await pathExists(destConfigPath))) {
		await fsp.writeFile(destConfigPath, sourceContent, {
			mode: 0o644,
			encoding: "utf8",
		});
		return;
	}

	const destContent = await fsp.readFile(destConfigPath, "utf8");
	if (destContent === sourceContent) {
		// Idempotent re-run — nothing to do.
		return;
	}

	if (!options.force) {
		throw new Error(
			[
				`Refusing to overwrite ${destConfigPath} — its contents differ from ${CONFIG_PATH}.`,
				"Re-run with --force to overwrite. The legacy file is kept either way; only the per-profile copy changes.",
				`Diff hint: \`diff ${CONFIG_PATH} ${destConfigPath}\``,
			].join("\n"),
		);
	}

	if (!options.yes) {
		const ok = await prompts.confirm({
			message: `Overwrite ${destConfigPath} with the legacy config?`,
			default: false,
		});
		if (!ok) {
			throw new Error("Aborted by user.");
		}
	}

	await fsp.writeFile(destConfigPath, sourceContent, {
		mode: 0o644,
		encoding: "utf8",
	});
}

async function writeProfileToken(
	destTokenPath: string,
	token: string,
	options: MigrateLegacyOptions,
	prompts: NonNullable<MigrateLegacyDeps["prompts"]>,
): Promise<void> {
	const newline = `${token}\n`;

	if (!(await pathExists(destTokenPath))) {
		await fsp.writeFile(destTokenPath, newline, {
			mode: 0o600,
			encoding: "utf8",
		});
		// fs.writeFile mode is only honored on file creation; chmod defensively
		// in case a parent process pre-created the file with permissive perms.
		await fsp.chmod(destTokenPath, 0o600);
		return;
	}

	const existing = (await fsp.readFile(destTokenPath, "utf8")).trim();
	if (existing === token) {
		// Idempotent re-run — already correct; force perms regardless.
		await fsp.chmod(destTokenPath, 0o600);
		return;
	}

	if (!options.force) {
		throw new Error(
			[
				`Refusing to overwrite ${destTokenPath} — it contains a different token.`,
				"Re-run with --force to overwrite the per-profile token.",
			].join("\n"),
		);
	}

	if (!options.yes) {
		const ok = await prompts.confirm({
			message: `Overwrite the existing token at ${destTokenPath}?`,
			default: false,
		});
		if (!ok) {
			throw new Error("Aborted by user.");
		}
	}

	await fsp.writeFile(destTokenPath, newline, {
		mode: 0o600,
		encoding: "utf8",
	});
	await fsp.chmod(destTokenPath, 0o600);
}

async function ensureActiveProfile(name: string): Promise<void> {
	await fsp.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
	let current: string | null = null;
	if (await pathExists(ACTIVE_PROFILE_FILE)) {
		current = (await fsp.readFile(ACTIVE_PROFILE_FILE, "utf8")).trim();
	}
	if (current === name) return;
	await fsp.writeFile(ACTIVE_PROFILE_FILE, `${name}\n`, {
		mode: 0o644,
		encoding: "utf8",
	});
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await fsp.access(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Profile names land in filesystem paths and the active-profile marker.
 * Same conservative charset as `profile add` to avoid `..` traversal,
 * shell metacharacters, and Unicode lookalikes.
 */
function isSafeName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name);
}

// Re-export internals so the integration test (and follow-up commands)
// can compose them without re-implementing the idempotency rules.
export { CONFIG_PATH, PROFILES_DIR, TOKEN_PATH };
