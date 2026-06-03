import { describe, expect, it } from "vitest";
import {
	deepEqual,
	type JsonObject,
	planMigration,
	TEAM_SHADOWABLE_KEYS,
} from "./migrate-from-personal.js";

// ── Shared fixtures ───────────────────────────────────────────────────

const TEAM: JsonObject = {
	members: {
		aliases: { alice: "Alice A.", bob: "Bob B." },
		uuids: { "Alice A.": "uuid-a", "Bob B.": "uuid-b" },
		handles: {},
		fullNames: {},
	},
	teams: { DEV: "team-dev-uuid", FE: "team-fe-uuid" },
	labels: {
		workspace: { claude: "wl-claude" },
		teams: { DEV: { feature: "lbl-dev-feature" } },
	},
	statusDefaults: { noProject: "Triage", withAssigneeAndProject: "Todo" },
	teamAliases: { frontend: "FE", "front-end": "FE" },
	terms: [
		{
			canonical: "Enrich Layer",
			reject: ["EnrichLayer", "Enrichlayer"],
		},
	],
};

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}

// ── deepEqual ─────────────────────────────────────────────────────────

describe("deepEqual", () => {
	it("compares primitives, arrays, and objects deeply", () => {
		expect(deepEqual(1, 1)).toBe(true);
		expect(deepEqual("a", "a")).toBe(true);
		expect(deepEqual(null, null)).toBe(true);
		expect(deepEqual([1, 2], [1, 2])).toBe(true);
		expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
		expect(
			deepEqual({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } }),
		).toBe(true);
	});

	it("distinguishes different values, types, and shapes", () => {
		expect(deepEqual(1, 2)).toBe(false);
		expect(deepEqual([1, 2], [2, 1])).toBe(false);
		expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(deepEqual([], {})).toBe(false);
		expect(deepEqual(null, {})).toBe(false);
	});
});

// ── planMigration: top-level shadowable keys ─────────────────────────

describe("planMigration — shadowable keys", () => {
	it("drops keys that are exact duplicates of team (the common case)", () => {
		const personal: JsonObject = {
			defaultTeam: "DEV",
			members: clone(TEAM.members) as JsonValue,
			teams: clone(TEAM.teams) as JsonValue,
			labels: clone(TEAM.labels) as JsonValue,
			statusDefaults: clone(TEAM.statusDefaults) as JsonValue,
			teamAliases: clone(TEAM.teamAliases) as JsonValue,
		} as JsonObject;
		const { slimmed, plan } = planMigration(personal, TEAM);

		// Every shadowable key dropped, defaultTeam preserved.
		for (const k of TEAM_SHADOWABLE_KEYS) {
			expect(slimmed[k]).toBeUndefined();
			const ka = plan.keys.find((a) => a.key === k);
			expect(ka?.action).toBe("drop");
			expect(ka?.divergentCount).toBe(0);
			expect(ka?.additionCount).toBe(0);
		}
		expect(slimmed.defaultTeam).toBe("DEV");
	});

	it("ignores trivially-empty personal-only containers (e.g. handles.github = {})", () => {
		const personal: JsonObject = {
			members: {
				aliases: { alice: "Alice A.", bob: "Bob B." },
				uuids: { "Alice A.": "uuid-a", "Bob B.": "uuid-b" },
				handles: { github: {} }, // trivial — no info lost
				fullNames: {},
			},
		};
		const { slimmed, plan } = planMigration(personal, TEAM);
		const ka = plan.keys.find((a) => a.key === "members");
		expect(ka?.action).toBe("drop");
		expect(ka?.additionCount).toBe(0);
		expect(slimmed.members).toBeUndefined();
	});

	it("preserves a key when personal has a real divergence (silent-shadow risk)", () => {
		const personal: JsonObject = {
			teams: { DEV: "team-dev-OVERRIDDEN", FE: "team-fe-uuid" },
		};
		const { slimmed, plan } = planMigration(personal, TEAM);
		const ka = plan.keys.find((a) => a.key === "teams");
		expect(ka?.action).toBe("keep-divergent");
		expect(ka?.divergentCount).toBe(1);
		expect(ka?.sampleDivergent).toEqual(["teams.DEV"]);
		// Slimmed must retain the divergent key as-is (don't silently kill it).
		expect(slimmed.teams).toEqual(personal.teams);
	});

	it("preserves a key when personal has a genuine non-trivial addition", () => {
		const personal: JsonObject = {
			teamAliases: {
				frontend: "FE",
				"front-end": "FE",
				myWeirdAlias: "FE", // not in team
			},
		};
		const { slimmed, plan } = planMigration(personal, TEAM);
		const ka = plan.keys.find((a) => a.key === "teamAliases");
		expect(ka?.action).toBe("keep-additions");
		expect(ka?.additionCount).toBe(1);
		expect(ka?.sampleAdditions).toEqual(["teamAliases.myWeirdAlias"]);
		expect(slimmed.teamAliases).toEqual(personal.teamAliases);
	});

	it("reports 'absent' for a shadowable key not present in personal", () => {
		const { plan } = planMigration({} as JsonObject, TEAM);
		for (const k of TEAM_SHADOWABLE_KEYS) {
			const ka = plan.keys.find((a) => a.key === k);
			expect(ka?.action).toBe("absent");
		}
	});

	it("does not touch genuinely personal keys", () => {
		const personal: JsonObject = {
			defaultTeam: "DEV",
			defaultLabels: ["claude"],
			teamConfigPath: "/abs/path/to/team.json",
			workspaceUrlKey: "verticalint",
		};
		const { slimmed } = planMigration(personal, TEAM);
		expect(slimmed.defaultTeam).toBe("DEV");
		expect(slimmed.defaultLabels).toEqual(["claude"]);
		expect(slimmed.teamConfigPath).toBe("/abs/path/to/team.json");
		expect(slimmed.workspaceUrlKey).toBe("verticalint");
	});
});

// ── planMigration: brand → terms migration ───────────────────────────

describe("planMigration — deprecated brand", () => {
	it("drops brand when content-identical to an existing team terms[] entry", () => {
		const personal: JsonObject = {
			brand: {
				name: "Enrich Layer",
				reject: ["EnrichLayer", "Enrichlayer"],
			},
		};
		const { slimmed, plan } = planMigration(personal, TEAM);
		expect(slimmed.brand).toBeUndefined();
		expect(slimmed.terms).toBeUndefined(); // no new personal terms needed
		expect(plan.brand.status).toBe("drop-duplicate");
		expect(plan.warnings).toEqual([]);
	});

	it("converts brand to a personal terms[] entry when divergent + warns", () => {
		const personal: JsonObject = {
			brand: {
				name: "Enrich Layer",
				reject: ["EnrichLayer", "different-reject-list"],
			},
		};
		const { slimmed, plan } = planMigration(personal, TEAM);
		expect(slimmed.brand).toBeUndefined();
		expect(plan.brand.status).toBe("convert-to-term");
		expect(plan.brand.convertedTo).toEqual({
			canonical: "Enrich Layer",
			reject: ["EnrichLayer", "different-reject-list"],
		});
		expect(Array.isArray(slimmed.terms)).toBe(true);
		const terms = slimmed.terms as JsonObject[];
		expect(terms[0]).toEqual({
			canonical: "Enrich Layer",
			reject: ["EnrichLayer", "different-reject-list"],
		});
		expect(plan.warnings.length).toBe(1);
	});

	it("converts brand when team has no terms — silently (no warning)", () => {
		const teamNoTerms = clone(TEAM) as JsonObject;
		delete teamNoTerms.terms;
		const personal: JsonObject = {
			brand: { name: "Acme", reject: ["acme", "ACME"] },
		};
		const { slimmed, plan } = planMigration(personal, teamNoTerms);
		expect(slimmed.brand).toBeUndefined();
		expect(plan.brand.status).toBe("convert-to-term");
		expect(plan.warnings).toEqual([]);
		expect(slimmed.terms).toEqual([
			{ canonical: "Acme", reject: ["acme", "ACME"] },
		]);
	});

	it("appends to an existing personal terms[] when converting (preserves prior entries)", () => {
		const personal: JsonObject = {
			brand: { name: "Acme", reject: ["acme"] },
			terms: [{ canonical: "Preexisting", reject: ["pre"] }],
		};
		const { slimmed } = planMigration(personal, TEAM);
		expect(slimmed.terms).toEqual([
			{ canonical: "Preexisting", reject: ["pre"] },
			{ canonical: "Acme", reject: ["acme"] },
		]);
	});

	it("reports 'absent' when brand isn't present", () => {
		const { plan } = planMigration({} as JsonObject, TEAM);
		expect(plan.brand.status).toBe("absent");
	});

	it("treats a malformed brand (missing/wrong-typed fields) as absent", () => {
		const personal: JsonObject = {
			brand: { name: 42 } as unknown as JsonValue,
		};
		const { slimmed, plan } = planMigration(personal, TEAM);
		expect(plan.brand.status).toBe("absent");
		// Malformed brand is left in slimmed as-is; we don't pretend to clean it.
		expect(slimmed.brand).toEqual({ name: 42 });
	});
});

// ── planMigration: no-team-config edge case ──────────────────────────

describe("planMigration — without a team config", () => {
	it("never drops keys when team is empty (no fallback exists)", () => {
		const personal: JsonObject = {
			members: clone(TEAM.members) as JsonValue,
			teams: clone(TEAM.teams) as JsonValue,
		};
		const { slimmed, plan } = planMigration(personal, {});
		// With empty team, every entry in personal is a 'personal-only addition'
		// at the leaf level, so the keys stay (keep-additions).
		expect(slimmed.members).toBeDefined();
		expect(slimmed.teams).toBeDefined();
		for (const ka of plan.keys) {
			if (ka.action === "absent") continue;
			expect(ka.action).not.toBe("drop");
		}
	});
});

// Local re-import for the JsonValue type used in fixtures above.
type JsonValue = import("./migrate-from-personal.js").JsonValue;
