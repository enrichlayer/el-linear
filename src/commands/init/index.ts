/**
 * Setup wizard for first-time el-linear users.
 *
 * Top-level command:
 *   el-linear init                  — full wizard (token → workspace → aliases → defaults)
 *
 * Sub-commands (each idempotent, runnable in isolation):
 *   el-linear init token            — set/replace the API token
 *   el-linear init workspace        — pick a default team
 *   el-linear init aliases          — walk users for aliases / handles (resumable)
 *   el-linear init aliases --import users.csv
 *   el-linear init defaults         — default labels, status, term enforcement
 *
 * Skip is the default at every prompt. Only `init token` is required for a
 * first-time setup; everything else can be skipped and revisited later.
 */

import type { Command } from "commander";
import {
	type AliasUpdate,
	mergeAliasesIntoConfig,
	runAliasesImport,
	runAliasesStep,
} from "./aliases.js";
import { runDefaultsStep } from "./defaults.js";
import { runOAuthRevoke, runOAuthStep } from "./oauth.js";
import {
	assignDefined,
	printStep,
	readConfig,
	type WizardConfig,
	writeConfig,
} from "./shared.js";
import { runTokenStep } from "./token.js";
import { runWorkspaceStep } from "./workspace.js";

/**
 * Wrap a wizard handler so that pressing Ctrl+C at any inquirer prompt exits
 * cleanly with code 130 (the standard SIGINT exit code) instead of dumping a
 * stack trace. inquirer throws an `ExitPromptError` whose `name === "ExitPromptError"`;
 * we catch by name to avoid a hard import dependency on the internal class.
 */
function withCleanExit<TArgs extends unknown[]>(
	fn: (...args: TArgs) => Promise<void>,
): (...args: TArgs) => Promise<void> {
	return async (...args: TArgs) => {
		try {
			await fn(...args);
		} catch (err) {
			if (err instanceof Error && err.name === "ExitPromptError") {
				// biome-ignore lint/suspicious/noConsole: wizard
				console.log("\n  Cancelled.");
				process.exit(130);
			}
			throw err;
		}
	};
}

export function setupInitCommands(program: Command): void {
	const init = program
		.command("init")
		.description("Interactive setup wizard for first-time el-linear users")
		.option("--force", "ignore existing config when prompting")
		.action(
			withCleanExit(async (options: { force?: boolean }) => {
				await runFullWizard({ force: options.force ?? false });
			}),
		);

	init
		.command("token")
		.description("Set or replace the Linear API token")
		.option("--force", "always replace existing token")
		.action(
			withCleanExit(async (options: { force?: boolean }) => {
				printStep("token", "Linear API token");
				await runTokenStep({ force: options.force ?? false });
			}),
		);

	init
		.command("oauth")
		.description(
			"Authorize via OAuth 2.0 (PKCE) — alternative to a personal API token",
		)
		.option("--force", "ignore existing tokens; re-authorize unconditionally")
		.option("--revoke", "revoke and remove the stored OAuth tokens")
		.option(
			"--no-browser",
			"skip the browser-open + localhost listener; paste the code manually",
		)
		.option(
			"--port <port>",
			"localhost callback port (default 8765)",
			(value) => Number.parseInt(value, 10),
		)
		.action(
			withCleanExit(
				async (options: {
					force?: boolean;
					revoke?: boolean;
					browser?: boolean;
					port?: number;
				}) => {
					printStep("oauth", "Linear OAuth (PKCE)");
					if (options.revoke) {
						const result = await runOAuthRevoke();
						console.log(`  ${result.message}`);
						return;
					}
					await runOAuthStep({
						force: options.force ?? false,
						// commander's `--no-browser` produces `browser: false`.
						noBrowser: options.browser === false,
						port: options.port,
					});
				},
			),
		);

	init
		.command("workspace")
		.description("Set the default team and refresh team UUID cache")
		.action(
			withCleanExit(async () => {
				const tokenResult = await runTokenStep();
				const existing = await readConfig();
				printStep("workspace", "Workspace defaults");
				const ws = await runWorkspaceStep(
					tokenResult.token,
					tokenResult.viewer.organization.urlKey,
					existing,
				);
				const merged: WizardConfig = assignDefined(existing, {
					defaultTeam: ws.defaultTeam,
					teams: { ...(existing.teams ?? {}), ...ws.teams },
					// Don't clobber a manual urlKey override — same idempotency
					// rule as the full wizard.
					workspaceUrlKey: existing.workspaceUrlKey ?? ws.workspaceUrlKey,
				});
				await writeConfig(merged);
				// biome-ignore lint/suspicious/noConsole: wizard
				console.log("  ✓ Workspace defaults saved.");
			}),
		);

	init
		.command("aliases")
		.description(
			"Walk Linear users to add aliases / GitHub / GitLab handles (resumable)",
		)
		.option(
			"--import <csv>",
			"Batch import from a CSV with columns: email,aliases,github,gitlab",
		)
		.option("--force", "skip the 'walk now?' prompt")
		.action(
			withCleanExit(async (options: { import?: string; force?: boolean }) => {
				const tokenResult = await runTokenStep();
				const existing = await readConfig();
				printStep("aliases", "Member aliases");

				let updates: Map<string, AliasUpdate>;
				if (options.import) {
					const result = await runAliasesImport(
						tokenResult.token,
						options.import,
					);
					updates = result.updates;
					if (result.skipped.length > 0) {
						// biome-ignore lint/suspicious/noConsole: wizard
						console.log(
							`  Skipped ${result.skipped.length} unmatched email(s): ${result.skipped.join(", ")}`,
						);
					}
				} else {
					updates = await runAliasesStep(tokenResult.token, existing, {
						force: options.force ?? false,
					});
				}

				if (updates.size === 0) {
					// biome-ignore lint/suspicious/noConsole: wizard
					console.log("  No alias changes — config unchanged.");
					return;
				}

				const merged = mergeAliasesIntoConfig(existing, updates);
				await writeConfig(merged);
				// biome-ignore lint/suspicious/noConsole: wizard
				console.log(`  ✓ Updated aliases for ${updates.size} user(s).`);
			}),
		);

	init
		.command("defaults")
		.description("Default labels, status defaults, term enforcement rules")
		.action(
			withCleanExit(async () => {
				const existing = await readConfig();
				printStep("defaults", "Defaults");
				const result = await runDefaultsStep(existing);
				const merged: WizardConfig = assignDefined(existing, {
					defaultLabels: result.defaultLabels,
					statusDefaults: result.statusDefaults,
					terms: result.terms,
				});
				await writeConfig(merged);
				// biome-ignore lint/suspicious/noConsole: wizard
				console.log("  ✓ Defaults saved.");
			}),
		);
}

/**
 * Full wizard: walk through all four steps in sequence. Each step writes its
 * own slice of the config and is restartable on its own.
 */
export async function runFullWizard(
	options: { force?: boolean } = {},
): Promise<void> {
	const opts = { force: options.force ?? false };
	await runFullWizardImpl(opts);
}

async function runFullWizardImpl(options: { force: boolean }): Promise<void> {
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("Welcome to el-linear. This wizard will set up your config.");
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(
		"Skip is the default at every prompt; only the API token is required.\n",
	);

	const existing = await readConfig();

	// Step 1: token (required)
	printStep("1/4", "Linear API token");
	const tokenResult = await runTokenStep({ force: options.force });

	// Step 2: workspace
	printStep("2/4", "Workspace defaults");
	const ws = await runWorkspaceStep(
		tokenResult.token,
		tokenResult.viewer.organization.urlKey,
		existing,
	);

	// Step 3: aliases
	printStep("3/4", "Member aliases");
	const aliasUpdates = await runAliasesStep(tokenResult.token, existing);

	// Step 4: defaults
	printStep("4/4", "Defaults");
	const defaults = await runDefaultsStep(existing);

	// Merge everything and write atomically at the end.
	// Idempotency rule: only write a key when the user explicitly changed it.
	// `existing.X ?? new.X` preserves any manual override the user may have
	// in config.json (self-hosted Linear urlKey, custom default team, etc.).
	// `assignDefined` skips undefined values so the resulting object's own-
	// property set matches what JSON.stringify would actually serialize.
	let merged: WizardConfig = assignDefined(existing, {
		// defaults step: result is `existing.X` itself when the user skipped
		// the edit branch, so direct assignment is safe.
		defaultLabels: defaults.defaultLabels,
		statusDefaults: defaults.statusDefaults,
		terms: defaults.terms,
		// workspace step: `ws.defaultTeam` may be the existing value (user
		// skipped) or a new pick.
		defaultTeam: ws.defaultTeam,
		// Always merge the team UUID cache (additive, not destructive).
		teams: { ...(existing.teams ?? {}), ...ws.teams },
		// workspaceUrlKey: never clobber an existing manual override.
		workspaceUrlKey: existing.workspaceUrlKey ?? ws.workspaceUrlKey,
	});
	if (aliasUpdates.size > 0) {
		merged = mergeAliasesIntoConfig(merged, aliasUpdates);
	}
	await writeConfig(merged);

	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("\n✓ Setup complete.");
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("  Token:  ~/.config/el-linear/token (mode 0600)");
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("  Config: ~/.config/el-linear/config.json");
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("\nTry: el-linear teams list");
}
