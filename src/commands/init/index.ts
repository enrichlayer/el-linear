/**
 * Setup wizard for first-time linctl users.
 *
 * Top-level command:
 *   linctl init                  — full wizard (token → workspace → aliases → defaults)
 *
 * Sub-commands (each idempotent, runnable in isolation):
 *   linctl init token            — set/replace the API token
 *   linctl init workspace        — pick a default team
 *   linctl init aliases          — walk users for aliases / handles (resumable)
 *   linctl init aliases --import users.csv
 *   linctl init defaults         — default labels, status, term enforcement
 *
 * Skip is the default at every prompt. Only `init token` is required for a
 * first-time setup; everything else can be skipped and revisited later.
 */

import type { Command } from "commander";
import {
	type AliasUpdate,
	fetchAllUsers,
	mergeAliasesIntoConfig,
	runAliasesImport,
	runAliasesStep,
} from "./aliases.js";
import { runDefaultsStep } from "./defaults.js";
import {
	printStep,
	readConfig,
	type WizardConfig,
	writeConfig,
} from "./shared.js";
import { runTokenStep } from "./token.js";
import { runWorkspaceStep } from "./workspace.js";

export function setupInitCommands(program: Command): void {
	const init = program
		.command("init")
		.description("Interactive setup wizard for first-time linctl users")
		.option("--force", "ignore existing config when prompting")
		.action(async (options: { force?: boolean }) => {
			await runFullWizard({ force: options.force ?? false });
		});

	init
		.command("token")
		.description("Set or replace the Linear API token")
		.option("--force", "always replace existing token")
		.action(async (options: { force?: boolean }) => {
			printStep("token", "Linear API token");
			await runTokenStep({ force: options.force ?? false });
		});

	init
		.command("workspace")
		.description("Set the default team and refresh team UUID cache")
		.action(async () => {
			const tokenResult = await runTokenStep();
			const existing = await readConfig();
			printStep("workspace", "Workspace defaults");
			const ws = await runWorkspaceStep(
				tokenResult.token,
				tokenResult.viewer.organization.urlKey,
				existing,
			);
			const merged: WizardConfig = {
				...existing,
				defaultTeam: ws.defaultTeam,
				teams: { ...(existing.teams ?? {}), ...ws.teams },
				workspaceUrlKey: ws.workspaceUrlKey,
			};
			await writeConfig(merged);
			// biome-ignore lint/suspicious/noConsole: wizard
			console.log("  ✓ Workspace defaults saved.");
		});

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
		.action(async (options: { import?: string; force?: boolean }) => {
			const tokenResult = await runTokenStep();
			const existing = await readConfig();
			printStep("aliases", "Member aliases");

			let updates: Map<string, AliasUpdate>;
			if (options.import) {
				// The import path returns email-keyed updates; map to UUID-keyed.
				const byEmail = await runAliasesImport(options.import);
				const users = await fetchAllUsers(tokenResult.token);
				const byEmailLower = new Map<string, (typeof users)[number]>();
				for (const u of users) {
					if (u.email) byEmailLower.set(u.email.toLowerCase(), u);
				}
				updates = new Map<string, AliasUpdate>();
				const skipped: string[] = [];
				for (const [email, update] of byEmail) {
					const user = byEmailLower.get(email);
					if (!user) {
						skipped.push(email);
						continue;
					}
					updates.set(user.id, { ...update, displayName: user.displayName });
				}
				if (skipped.length > 0) {
					// biome-ignore lint/suspicious/noConsole: wizard
					console.log(
						`  Skipped ${skipped.length} unmatched email(s): ${skipped.join(", ")}`,
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
		});

	init
		.command("defaults")
		.description("Default labels, status defaults, term enforcement rules")
		.action(async () => {
			const existing = await readConfig();
			printStep("defaults", "Defaults");
			const result = await runDefaultsStep(existing);
			const merged: WizardConfig = {
				...existing,
				defaultLabels: result.defaultLabels,
				statusDefaults: result.statusDefaults,
				terms: result.terms,
			};
			await writeConfig(merged);
			// biome-ignore lint/suspicious/noConsole: wizard
			console.log("  ✓ Defaults saved.");
		});
}

/**
 * Full wizard: walk through all four steps in sequence. Each step writes its
 * own slice of the config and is restartable on its own.
 */
async function runFullWizard(options: { force: boolean }): Promise<void> {
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("Welcome to linctl. This wizard will set up your config.");
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
	let merged: WizardConfig = {
		...existing,
		defaultLabels: defaults.defaultLabels,
		defaultTeam: ws.defaultTeam,
		statusDefaults: defaults.statusDefaults,
		teams: { ...(existing.teams ?? {}), ...ws.teams },
		terms: defaults.terms,
		workspaceUrlKey: ws.workspaceUrlKey,
	};
	if (aliasUpdates.size > 0) {
		merged = mergeAliasesIntoConfig(merged, aliasUpdates);
	}
	await writeConfig(merged);

	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("\n✓ Setup complete.");
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("  Token:  ~/.config/linctl/token (mode 0600)");
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("  Config: ~/.config/linctl/config.json");
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log("\nTry: linctl teams list");
}
