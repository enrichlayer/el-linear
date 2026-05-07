/**
 * Step 4 of the wizard: default labels, default assignee, default priority,
 * status defaults, term enforcement, cache TTL.
 *
 * All optional. Each subsection asks "change?" with default=N so re-running
 * with no input is a no-op.
 */

import { confirm, input, select } from "@inquirer/prompts";
import { parseCsvList, type WizardConfig } from "./shared.js";

export interface DefaultsStepResult {
	defaultLabels: string[] | undefined;
	/**
	 * Default assignee identifier (alias / display name / email / UUID — same
	 * shapes resolveAssignee accepts) for `issues create`. The wizard does NOT
	 * validate this against Linear (no API call) — the runtime resolver handles
	 * validation at issue-create time, keeping the wizard offline.
	 */
	defaultAssignee: string | undefined;
	/**
	 * Default priority keyword: `none|urgent|high|medium|normal|low`. Stored
	 * as-is; the runtime path runs it through validatePriority() to get the
	 * Linear priority number.
	 */
	defaultPriority: string | undefined;
	/**
	 * Status defaults. Both fields are optional so the wizard preserves
	 * partial existing configs (`{ noProject: "Backlog" }` only) byte-for-byte
	 * when the user skips the edit step. The runtime config loader applies
	 * fallbacks at read time.
	 */
	statusDefaults:
		| { noProject?: string; withAssigneeAndProject?: string }
		| undefined;
	terms: Array<{ canonical: string; reject: string[] }> | undefined;
	/** TTL (seconds) for `teams list` / `labels list` / `projects list` disk
	 * cache. `0` disables. */
	cacheTTLSeconds: number | undefined;
}

const STATUS_FALLBACK = { noProject: "Triage", withAssigneeAndProject: "Todo" };
const CACHE_TTL_FALLBACK = 3600;

const PRIORITY_CHOICES = [
	{ name: "none", value: "none" },
	{ name: "urgent", value: "urgent" },
	{ name: "high", value: "high" },
	{ name: "medium", value: "medium" },
	{ name: "normal", value: "normal" },
	{ name: "low", value: "low" },
];

export async function runDefaultsStep(
	existing: WizardConfig,
): Promise<DefaultsStepResult> {
	// Idempotency rule: when the user skips a sub-section, return the existing
	// value byte-for-byte. We deliberately do NOT spread or backfill optional
	// fields (a partial { noProject: "Backlog" } stays partial) so re-running
	// with no input produces a byte-identical config.
	const result: DefaultsStepResult = {
		defaultLabels: existing.defaultLabels,
		defaultAssignee: existing.defaultAssignee,
		defaultPriority: existing.defaultPriority,
		statusDefaults: existing.statusDefaults,
		terms: existing.terms,
		cacheTTLSeconds: existing.cacheTTLSeconds,
	};

	// ── Default labels ────────────────────────────────────────────────
	const currentLabels = existing.defaultLabels ?? [];
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
		const parsed = parseCsvList(raw);
		result.defaultLabels = parsed.length > 0 ? parsed : undefined;
	}

	// ── Default assignee ──────────────────────────────────────────────
	console.log(
		`  Current default assignee: ${existing.defaultAssignee ?? "(none)"}`,
	);
	const editAssignee = await confirm({
		message: "Change default assignee for new issues?",
		default: false,
	});
	if (editAssignee) {
		// We deliberately don't validate against Linear here — the wizard runs
		// offline-friendly. The runtime resolver (resolveAssignee) catches
		// typos at issue-create time. "none" is the explicit-clear sentinel
		// so users have an unambiguous way to wipe the field.
		const raw = (
			await input({
				message: "Default assignee (alias, name, email, or 'none' to clear):",
				default: existing.defaultAssignee ?? "",
			})
		).trim();
		if (!raw || raw.toLowerCase() === "none") {
			result.defaultAssignee = undefined;
		} else {
			result.defaultAssignee = raw;
		}
	}

	// ── Default priority ──────────────────────────────────────────────
	console.log(
		`  Current default priority: ${existing.defaultPriority ?? "(none)"}`,
	);
	const editPriority = await confirm({
		message: "Change default priority for new issues?",
		default: false,
	});
	if (editPriority) {
		// `select` always picks one option — so picking "none" stores the
		// keyword string "none" (Linear's "No priority"), distinct from
		// `undefined` which means "no default at all".
		const choice = await select({
			message: "Default priority:",
			choices: PRIORITY_CHOICES,
			default: existing.defaultPriority ?? "none",
		});
		result.defaultPriority = choice;
	}

	// ── Status defaults ────────────────────────────────────────────────
	const cur = existing.statusDefaults;
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

	// ── Cache TTL ─────────────────────────────────────────────────────
	const currentTTL = existing.cacheTTLSeconds ?? CACHE_TTL_FALLBACK;
	console.log(`  Current cache TTL: ${currentTTL}s`);
	const editTTL = await confirm({
		message: "Change cache TTL?",
		default: false,
	});
	if (editTTL) {
		const raw = await input({
			message: "Cache TTL in seconds (0 to disable):",
			default: String(currentTTL),
			// `validate` runs per submit; we reject anything that isn't a
			// non-negative integer literal. Number("") is `0` (truthy by
			// the integer test) so we explicitly require non-empty input —
			// otherwise an empty submission would silently store 0.
			validate: (value: string) => {
				const trimmed = value.trim();
				if (trimmed === "") {
					return "Enter a non-negative integer (e.g. 3600 for 1 hour, 0 to disable).";
				}
				const n = Number(trimmed);
				if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
					return "Enter a non-negative integer (e.g. 3600 for 1 hour, 0 to disable).";
				}
				return true;
			},
		});
		result.cacheTTLSeconds = Number(raw);
	}

	// ── Term enforcement ───────────────────────────────────────────────
	const currentTerms = existing.terms ?? [];
	console.log(`  Current term-enforcement rules: ${currentTerms.length}`);
	for (const t of currentTerms) {
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
		const reject = parseCsvList(rejectRaw);
		if (reject.length === 0) {
			console.log("  No variants given — skipping this rule.");
			continue;
		}
		terms.push({ canonical, reject });
	}
	return terms;
}
