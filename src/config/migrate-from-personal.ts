/**
 * Plan + apply the personal-to-team-backed config slim.
 *
 * After the team-config split (DEV-4172 / ALL-964) members typically still
 * carry full duplicates of the now-shared keys in their personal/profile
 * configs. The duplicates are silent shadows when identical and silent
 * divergences when they drift. This module computes a per-file plan:
 *
 *  - **Top-level shadowable keys** (`members`, `teams`, `labels`,
 *    `statusDefaults`, `teamAliases`) are *dropped* only when the personal
 *    copy is a strict subset of team (zero divergence and zero non-trivial
 *    personal-only entries). Otherwise the key is left untouched and the
 *    diff is reported, so a human resolves it.
 *  - The deprecated `brand: { name, reject }` key is dropped when content-
 *    identical to an existing team `terms[]` entry; otherwise it is
 *    *converted* into a personal `terms[]` entry (no shadowing of team).
 *  - Genuinely personal keys (`defaultTeam`, `defaultLabels`,
 *    `teamConfigPath`, anything not in the shadowable set or `brand`) are
 *    never touched.
 *
 * Pure: no fs / no process / no logging. The caller does I/O. DEV-4458.
 */

/** Top-level keys typically owned by the team config layer. */
export const TEAM_SHADOWABLE_KEYS = [
	"members",
	"teams",
	"labels",
	"statusDefaults",
	"teamAliases",
] as const;
export type TeamShadowableKey = (typeof TEAM_SHADOWABLE_KEYS)[number];

// Permissive JSON value type — config files are arbitrary JSON.
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| { [k: string]: JsonValue }
	| JsonValue[];

export type JsonObject = { [k: string]: JsonValue };

/** Per-key decision in the plan. */
export interface KeyAction {
	key: string;
	action: "drop" | "keep-divergent" | "keep-additions" | "absent";
	/** Leaves whose personal value matched team exactly. */
	matchCount: number;
	/** Leaves whose personal value differs from team (would be a silent shadow). */
	divergentCount: number;
	/** Non-trivial personal-only leaves (would be lost if dropped). */
	additionCount: number;
	/** First few divergent / addition paths, for human-readable context. */
	sampleDivergent?: string[];
	sampleAdditions?: string[];
}

/** What we did with the deprecated `brand` key. */
export interface BrandAction {
	status:
		| "absent"
		| "drop-duplicate"
		| "convert-to-term" /** Couldn't convert safely (e.g. existing personal `terms` is malformed). */
		| "keep-malformed";
	/** When status === "convert-to-term", the new entry appended to terms[]. */
	convertedTo?: { canonical: string; reject: string[] };
	reason?: string;
}

export interface MigrationPlan {
	keys: KeyAction[];
	brand: BrandAction;
	warnings: string[];
}

export interface MigrationResult {
	slimmed: JsonObject;
	plan: MigrationPlan;
}

/** A canonical JSON-friendly deep equality. */
export function deepEqual(a: JsonValue, b: JsonValue): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, b[i]));
	}
	if (typeof a === "object") {
		const ak = Object.keys(a).sort();
		const bk = Object.keys(b as JsonObject).sort();
		if (ak.length !== bk.length) return false;
		if (ak.some((k, i) => k !== bk[i])) return false;
		return ak.every((k) =>
			deepEqual((a as JsonObject)[k], (b as JsonObject)[k]),
		);
	}
	return false;
}

function isTriviallyEmpty(v: JsonValue | undefined): boolean {
	if (v === undefined || v === null) return true;
	if (Array.isArray(v)) return v.length === 0;
	if (typeof v === "object") return Object.keys(v).length === 0;
	return false;
}

function isPlainObject(v: JsonValue | undefined): v is JsonObject {
	return v !== null && typeof v === "object" && !Array.isArray(v);
}

interface DiffAccumulator {
	matches: number;
	divergent: string[];
	additions: string[];
}

/**
 * Walk personal and classify each LEAF against team at the same path:
 *   match     — present in team with the same value
 *   divergent — present in team with a different value (would silently shadow)
 *   addition  — absent from team and non-trivially non-empty (would be lost)
 *
 * Trivially-empty containers (e.g. `members.handles.github = {}`) are not
 * counted as additions — dropping them loses no information.
 */
function classifyDeep(
	personal: JsonValue | undefined,
	team: JsonValue | undefined,
	path: string,
	out: DiffAccumulator,
): void {
	if (personal === undefined) return;
	// Both objects → recurse into keys.
	if (isPlainObject(personal) && isPlainObject(team)) {
		for (const k of Object.keys(personal)) {
			classifyDeep(personal[k], team[k], path ? `${path}.${k}` : k, out);
		}
		return;
	}
	// Personal is a leaf (primitive / array / object without a matching team obj).
	if (team === undefined) {
		if (!isTriviallyEmpty(personal)) out.additions.push(path);
		return;
	}
	if (deepEqual(personal, team)) {
		out.matches += 1;
	} else {
		out.divergent.push(path);
	}
}

function planTopLevelKey(
	key: string,
	personal: JsonValue | undefined,
	team: JsonValue | undefined,
): KeyAction {
	if (personal === undefined) {
		return {
			key,
			action: "absent",
			matchCount: 0,
			divergentCount: 0,
			additionCount: 0,
		};
	}
	const acc: DiffAccumulator = { matches: 0, divergent: [], additions: [] };
	classifyDeep(personal, team, key, acc);
	const action: KeyAction["action"] =
		acc.divergent.length === 0 && acc.additions.length === 0
			? "drop"
			: acc.divergent.length > 0
				? "keep-divergent"
				: "keep-additions";
	const ka: KeyAction = {
		key,
		action,
		matchCount: acc.matches,
		divergentCount: acc.divergent.length,
		additionCount: acc.additions.length,
	};
	if (acc.divergent.length > 0) ka.sampleDivergent = acc.divergent.slice(0, 5);
	if (acc.additions.length > 0) ka.sampleAdditions = acc.additions.slice(0, 5);
	return ka;
}

interface BrandShape {
	name: string;
	reject: string[];
}

function readBrand(personal: JsonObject): BrandShape | null {
	const raw = personal.brand;
	if (!isPlainObject(raw)) return null;
	const name = raw.name;
	const reject = raw.reject;
	if (typeof name !== "string") return null;
	if (!Array.isArray(reject) || !reject.every((r) => typeof r === "string")) {
		return null;
	}
	return { name, reject: reject as string[] };
}

interface TermShape {
	canonical: string;
	reject: string[];
}

function readTeamTerms(team: JsonObject): TermShape[] {
	const t = team.terms;
	if (!Array.isArray(t)) return [];
	const out: TermShape[] = [];
	for (const e of t) {
		if (!isPlainObject(e)) continue;
		const canonical = e.canonical;
		const reject = e.reject;
		if (typeof canonical !== "string") continue;
		if (!Array.isArray(reject) || !reject.every((r) => typeof r === "string")) {
			continue;
		}
		out.push({ canonical, reject: reject as string[] });
	}
	return out;
}

function brandMatchesTerm(brand: BrandShape, term: TermShape): boolean {
	return brand.name === term.canonical && deepEqual(brand.reject, term.reject);
}

/**
 * Compute the slimmed config + the plan that explains it. Pure.
 *
 * @param personal The personal/profile config object as parsed from disk.
 * @param team     The active team config object as parsed from disk. Pass
 *                 `{}` if no team config is configured — every shadowable
 *                 key becomes either `keep-additions` or `keep-divergent`,
 *                 so nothing gets dropped (correct: without team there is
 *                 nothing to fall back to).
 */
export function planMigration(
	personal: JsonObject,
	team: JsonObject,
): MigrationResult {
	const warnings: string[] = [];
	const slimmed: JsonObject = { ...personal };

	const keyActions: KeyAction[] = TEAM_SHADOWABLE_KEYS.map((key) =>
		planTopLevelKey(key, personal[key], team[key]),
	);
	for (const ka of keyActions) {
		if (ka.action === "drop") delete slimmed[ka.key];
	}

	// Brand → terms.
	let brand: BrandAction;
	const brandShape = readBrand(personal);
	if (brandShape === null) {
		brand = { status: "absent" };
	} else {
		const teamTerms = readTeamTerms(team);
		const dup = teamTerms.find((t) => brandMatchesTerm(brandShape, t));
		if (dup !== undefined) {
			delete slimmed.brand;
			brand = {
				status: "drop-duplicate",
				reason: `brand is content-identical to team terms entry "${dup.canonical}"`,
			};
		} else if (personal.terms !== undefined && !Array.isArray(personal.terms)) {
			// Refuse to convert: an existing personal `terms` field is not an
			// array (likely a hand-edit gone wrong). The strict-subset gate
			// elsewhere never silently destroys info — neither should this
			// path. Leave brand AND terms as-is; surface as a warning so a
			// human can resolve.
			brand = {
				status: "keep-malformed",
				reason:
					"existing personal 'terms' field is not an array; leaving 'brand' and 'terms' untouched for human review",
			};
			warnings.push(
				`Cannot convert deprecated 'brand': existing 'terms' field is not an array (got ${typeof personal.terms}). Left 'brand' and 'terms' as-is — fix 'terms' to a proper array of { canonical, reject } entries and re-run.`,
			);
		} else {
			// Convert: append a personal terms entry, drop brand.
			delete slimmed.brand;
			const existing = Array.isArray(slimmed.terms)
				? (slimmed.terms as JsonValue[])
				: [];
			const converted: TermShape = {
				canonical: brandShape.name,
				reject: brandShape.reject,
			};
			slimmed.terms = [...existing, { ...converted }];
			brand = {
				status: "convert-to-term",
				convertedTo: converted,
				reason:
					teamTerms.length === 0
						? "team config has no terms; converted brand to a personal terms entry"
						: "brand does not match any team terms entry; converted to a personal terms entry",
			};
			if (teamTerms.length > 0) {
				warnings.push(
					`brand on this file diverges from team terms — preserved as a personal terms entry. Review whether the team config should adopt it.`,
				);
			}
		}
	}

	return { slimmed, plan: { keys: keyActions, brand, warnings } };
}
