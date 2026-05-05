/**
 * Step 4 of the wizard: default labels, status defaults, term enforcement.
 *
 * All optional. Each subsection asks "change?" with default=N so re-running
 * with no input is a no-op.
 */

import { confirm, input } from "@inquirer/prompts";
import type { WizardConfig } from "./shared.js";

export interface DefaultsStepResult {
	defaultLabels: string[] | undefined;
	statusDefaults:
		| { noProject: string; withAssigneeAndProject: string }
		| undefined;
	terms: Array<{ canonical: string; reject: string[] }> | undefined;
}

const STATUS_FALLBACK = { noProject: "Triage", withAssigneeAndProject: "Todo" };

function parseCsv(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export async function runDefaultsStep(
	existing: WizardConfig,
): Promise<DefaultsStepResult> {
	const result: DefaultsStepResult = {
		defaultLabels: existing.defaultLabels,
		statusDefaults: existing.statusDefaults
			? {
					noProject:
						existing.statusDefaults.noProject ?? STATUS_FALLBACK.noProject,
					withAssigneeAndProject:
						existing.statusDefaults.withAssigneeAndProject ??
						STATUS_FALLBACK.withAssigneeAndProject,
				}
			: undefined,
		terms: existing.terms,
	};

	// ── Default labels ────────────────────────────────────────────────
	const currentLabels = existing.defaultLabels ?? [];
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(
		`  Current default labels: ${currentLabels.length > 0 ? currentLabels.join(", ") : "(none)"}`,
	);
	const editLabels = await confirm({
		message: "Change default labels for new issues?",
		default: false,
	});
	if (editLabels) {
		const raw = await input({
			message: "Default labels (comma-separated, blank for none):",
			default: currentLabels.join(", "),
		});
		const parsed = parseCsv(raw);
		result.defaultLabels = parsed.length > 0 ? parsed : undefined;
	}

	// ── Status defaults ────────────────────────────────────────────────
	const cur = existing.statusDefaults;
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(
		`  Current status defaults: noProject=${cur?.noProject ?? STATUS_FALLBACK.noProject}, ` +
			`withAssigneeAndProject=${cur?.withAssigneeAndProject ?? STATUS_FALLBACK.withAssigneeAndProject}`,
	);
	const editStatus = await confirm({
		message: "Change status defaults?",
		default: false,
	});
	if (editStatus) {
		const noProject = await input({
			message: "Status when no project assigned:",
			default: cur?.noProject ?? STATUS_FALLBACK.noProject,
		});
		const withAP = await input({
			message: "Status when assignee + project both set:",
			default:
				cur?.withAssigneeAndProject ?? STATUS_FALLBACK.withAssigneeAndProject,
		});
		result.statusDefaults = {
			noProject: noProject.trim(),
			withAssigneeAndProject: withAP.trim(),
		};
	}

	// ── Term enforcement ───────────────────────────────────────────────
	const currentTerms = existing.terms ?? [];
	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(`  Current term-enforcement rules: ${currentTerms.length}`);
	for (const t of currentTerms) {
		// biome-ignore lint/suspicious/noConsole: wizard
		console.log(`    "${t.canonical}" rejects: ${t.reject.join(", ")}`);
	}
	const editTerms = await confirm({
		message:
			currentTerms.length === 0
				? "Set up term-enforcement rules?"
				: "Change term-enforcement rules?",
		default: false,
	});
	if (editTerms) {
		result.terms = await collectTermsInteractively(currentTerms);
	}

	return result;
}

async function collectTermsInteractively(
	initial: Array<{ canonical: string; reject: string[] }>,
): Promise<Array<{ canonical: string; reject: string[] }>> {
	const terms: Array<{ canonical: string; reject: string[] }> = [...initial];

	// biome-ignore lint/suspicious/noConsole: wizard
	console.log(
		"  Term enforcement catches misspellings of brand or product names in issue titles " +
			"and descriptions. Define the canonical form and a list of rejected variants.",
	);

	if (terms.length > 0) {
		const replace = await confirm({
			message: `Replace the existing ${terms.length} rule(s) instead of appending?`,
			default: false,
		});
		if (replace) terms.length = 0;
	}

	for (;;) {
		const canonical = (
			await input({
				message:
					terms.length === 0
						? "Canonical form (e.g. 'Enrich Layer'):"
						: "Add another? Canonical form (blank to finish):",
				default: "",
			})
		).trim();
		if (!canonical) break;
		const rejectRaw = await input({
			message: `Rejected variants of "${canonical}" (comma-separated, e.g. EnrichLayer, enrichlayer):`,
		});
		const reject = parseCsv(rejectRaw);
		if (reject.length === 0) {
			// biome-ignore lint/suspicious/noConsole: wizard
			console.log("  No variants given — skipping this rule.");
			continue;
		}
		terms.push({ canonical, reject });
	}
	return terms;
}
