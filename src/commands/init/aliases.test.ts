import { describe, expect, it } from "vitest";
import {
	type AliasUpdate,
	findDisplayNameCollisions,
	mergeAliasesIntoConfig,
	parseCsv,
	type User,
} from "./aliases.js";
import type { WizardConfig } from "./shared.js";

const u = (
	id: string,
	displayName: string,
	email: string | null = null,
): User => ({
	id,
	name: displayName,
	email,
	displayName,
});

const baseConfig = (): WizardConfig => ({
	defaultTeam: "ENG",
	members: {
		aliases: {
			alice: "Alice Anderson",
			ali: "Alice Anderson",
			bob: "Bob Brown",
		},
		uuids: { "Alice Anderson": "alice-id", "Bob Brown": "bob-id" },
		fullNames: { "alice-id": "Alice Anderson", "bob-id": "Bob Brown" },
		handles: {
			github: { "alice-gh": "Alice Anderson" },
			gitlab: { "alice-gl": "Alice Anderson" },
		},
	},
	// An unrelated key the wizard doesn't touch — must survive merges.
	terms: [{ canonical: "Enrich Layer", reject: ["EnrichLayer"] }],
});

const update = (overrides: Partial<AliasUpdate>): AliasUpdate => ({
	displayName: "Alice Anderson",
	mode: "keep",
	aliases: [],
	github: { kind: "keep" },
	gitlab: { kind: "keep" },
	...overrides,
});

describe("mergeAliasesIntoConfig", () => {
	it("keep mode is a no-op", () => {
		const config = baseConfig();
		const result = mergeAliasesIntoConfig(
			config,
			new Map([["alice-id", update({ mode: "keep" })]]),
		);
		expect(result.members?.aliases).toEqual(config.members?.aliases);
		expect(result.members?.handles).toEqual(config.members?.handles);
	});

	it("edit replaces this user's aliases without touching other users", () => {
		const result = mergeAliasesIntoConfig(
			baseConfig(),
			new Map([["alice-id", update({ mode: "edit", aliases: ["alex"] })]]),
		);
		// Alice's old aliases (alice, ali) gone; new alias added; bob untouched.
		expect(result.members?.aliases).toEqual({
			alex: "Alice Anderson",
			bob: "Bob Brown",
		});
	});

	it("append keeps existing aliases and adds new ones", () => {
		const result = mergeAliasesIntoConfig(
			baseConfig(),
			new Map([
				["alice-id", update({ mode: "append", aliases: ["alexandra"] })],
			]),
		);
		expect(result.members?.aliases).toEqual({
			alice: "Alice Anderson",
			ali: "Alice Anderson",
			alexandra: "Alice Anderson",
			bob: "Bob Brown",
		});
	});

	it("clear removes all aliases and handles for the user only", () => {
		const result = mergeAliasesIntoConfig(
			baseConfig(),
			new Map([
				[
					"alice-id",
					update({
						mode: "clear",
						github: { kind: "clear" },
						gitlab: { kind: "clear" },
					}),
				],
			]),
		);
		expect(result.members?.aliases).toEqual({ bob: "Bob Brown" });
		expect(result.members?.handles?.github).toEqual({});
		expect(result.members?.handles?.gitlab).toEqual({});
	});

	it("preserves unrelated config keys", () => {
		const config = baseConfig();
		const result = mergeAliasesIntoConfig(
			config,
			new Map([["alice-id", update({ mode: "edit", aliases: ["alex"] })]]),
		);
		expect(result.defaultTeam).toBe("ENG");
		expect(result.terms).toEqual([
			{ canonical: "Enrich Layer", reject: ["EnrichLayer"] },
		]);
	});

	it("setting a github handle replaces previous one for that user", () => {
		const result = mergeAliasesIntoConfig(
			baseConfig(),
			new Map([
				[
					"alice-id",
					update({
						mode: "edit",
						aliases: ["alice"],
						github: { kind: "set", value: "alice-new-gh" },
					}),
				],
			]),
		);
		expect(result.members?.handles?.github).toEqual({
			"alice-new-gh": "Alice Anderson",
		});
	});

	it("creates members sub-tree when starting from empty config", () => {
		const result = mergeAliasesIntoConfig(
			{},
			new Map([
				[
					"alice-id",
					update({
						mode: "edit",
						aliases: ["alice"],
						github: { kind: "set", value: "alice-gh" },
					}),
				],
			]),
		);
		expect(result.members?.uuids).toEqual({ "Alice Anderson": "alice-id" });
		expect(result.members?.fullNames).toEqual({ "alice-id": "Alice Anderson" });
		expect(result.members?.aliases).toEqual({ alice: "Alice Anderson" });
		expect(result.members?.handles?.github).toEqual({
			"alice-gh": "Alice Anderson",
		});
	});

	it("idempotent: running mergeAliasesIntoConfig with all keep updates returns equivalent config", () => {
		const config = baseConfig();
		const updates = new Map([
			["alice-id", update({ displayName: "Alice Anderson", mode: "keep" })],
			["bob-id", update({ displayName: "Bob Brown", mode: "keep" })],
		]);
		const result = mergeAliasesIntoConfig(config, updates);
		expect(result.members?.aliases).toEqual(config.members?.aliases);
		expect(result.members?.handles).toEqual(config.members?.handles);
	});
});

describe("parseCsv", () => {
	it("parses simple rows with header", () => {
		const rows = parseCsv(
			"email,aliases,github,gitlab\nalice@x.com,alice,alice-gh,alice-gl",
		);
		expect(rows).toEqual([
			{
				email: "alice@x.com",
				aliases: "alice",
				github: "alice-gh",
				gitlab: "alice-gl",
			},
		]);
	});

	it("handles quoted cells with commas inside", () => {
		const rows = parseCsv(
			'email,aliases,github,gitlab\nalice@x.com,"alice,ali,al",alice-gh,',
		);
		expect(rows[0].aliases).toBe("alice,ali,al");
		expect(rows[0].gitlab).toBe("");
	});

	it("skips comment lines and blank lines", () => {
		const rows = parseCsv(
			[
				"email,aliases,github,gitlab",
				"# this is a comment",
				"",
				"alice@x.com,alice,,",
				"# another comment",
				"bob@x.com,bob,bob-gh,bob-gl",
			].join("\n"),
		);
		expect(rows).toHaveLength(2);
		expect(rows[0].email).toBe("alice@x.com");
		expect(rows[1].email).toBe("bob@x.com");
	});

	it("handles escaped quotes inside quoted cells", () => {
		const rows = parseCsv(`email,aliases,github,gitlab\nalice@x.com,"a""b",,`);
		expect(rows[0].aliases).toBe('a"b');
	});

	it("returns empty array for empty input", () => {
		expect(parseCsv("")).toEqual([]);
		expect(parseCsv("   \n\n")).toEqual([]);
	});
});
describe("findDisplayNameCollisions", () => {
	it("returns empty map when all display names are unique", () => {
		const result = findDisplayNameCollisions([
			u("id-1", "Alice"),
			u("id-2", "Bob"),
			u("id-3", "Carol"),
		]);
		expect(result.size).toBe(0);
	});

	it("groups users sharing a display name", () => {
		const result = findDisplayNameCollisions([
			u("id-1", "Alex", "alex@a.com"),
			u("id-2", "Alex", "alex@b.com"),
			u("id-3", "Bob"),
		]);
		expect(result.size).toBe(1);
		expect(
			result
				.get("Alex")
				?.map((x) => x.id)
				.sort(),
		).toEqual(["id-1", "id-2"]);
	});

	it("supports more than two colliders for the same name", () => {
		const result = findDisplayNameCollisions([
			u("id-1", "Sam"),
			u("id-2", "Sam"),
			u("id-3", "Sam"),
			u("id-4", "Bob"),
		]);
		expect(result.get("Sam")?.length).toBe(3);
		expect(result.has("Bob")).toBe(false);
	});

	it("treats different display names as non-colliding", () => {
		// Same person, different platforms — emails distinct, names distinct.
		const result = findDisplayNameCollisions([
			u("id-1", "Alice Anderson"),
			u("id-2", "Alice"),
		]);
		expect(result.size).toBe(0);
	});
});

describe("parseCsv — RFC 4180 + injection guards", () => {
	it("handles cells with embedded newlines (RFC 4180)", () => {
		const csv = `email,aliases,github,gitlab\n"alice@x.com","ali\nalex",,`;
		const rows = parseCsv(csv);
		expect(rows).toHaveLength(1);
		expect(rows[0].email).toBe("alice@x.com");
		expect(rows[0].aliases).toBe("ali\nalex");
	});

	it("handles CRLF line endings", () => {
		const csv = "email,aliases,github,gitlab\r\nalice@x.com,alice,,\r\n";
		const rows = parseCsv(csv);
		expect(rows).toHaveLength(1);
		expect(rows[0].email).toBe("alice@x.com");
	});

	it("rejects cells starting with =", () => {
		const csv =
			'email,aliases,github,gitlab\nalice@x.com,"=HYPERLINK(""evil"")",,';
		expect(() => parseCsv(csv)).toThrow(/formula injection/);
	});

	it("rejects cells starting with +, -, @", () => {
		for (const prefix of ["+", "-", "@"]) {
			const csv = `email,aliases,github,gitlab\nalice@x.com,${JSON.stringify(`${prefix}injection`)},,`;
			expect(() => parseCsv(csv), `prefix ${JSON.stringify(prefix)}`).toThrow(
				/formula injection/,
			);
		}
	});

	it("trim strips leading tabs / CRs before the injection check", () => {
		// Cells with leading whitespace would trigger Excel formula evaluation
		// only if the importer preserves the whitespace. Our trim removes it.
		const csv = 'email,aliases,github,gitlab\nalice@x.com,"\t harmless",,';
		expect(() => parseCsv(csv)).not.toThrow();
	});

	it("allows benign cells (alphanumeric, spaces, underscores)", () => {
		const csv = "email,aliases,github,gitlab\nalice@x.com,alice ali,alice-gh,";
		expect(() => parseCsv(csv)).not.toThrow();
	});
});
