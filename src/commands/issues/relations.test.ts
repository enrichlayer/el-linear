import { describe, expect, it, vi } from "vitest";

import type { RelatedIssueEntry } from "./relations.js";
import { deleteRelations, selectRelationsToRemove } from "./relations.js";

/**
 * DEV-14607 — `issues relate` could create a relation but nothing could
 * retract one, so a relation recorded from an analysis production later
 * refuted had to stay on the issue. These cover the selection rules, because
 * picking the wrong row here deletes the wrong relation.
 */
const entry = (
	over: Partial<RelatedIssueEntry> & { identifier?: string } = {},
): RelatedIssueEntry => ({
	id: over.id ?? "rel-1",
	type: over.type ?? "blocks",
	direction: over.direction ?? "outgoing",
	issue: over.issue ?? {
		id: "uuid-2",
		identifier: over.identifier ?? "DEV-2",
		title: "Peer",
	},
});

describe("selectRelationsToRemove (DEV-14607)", () => {
	it("picks the relation the flag names", () => {
		const rows = [
			entry({ id: "a", type: "blocks" }),
			entry({ id: "b", type: "related" }),
		];
		const targets = selectRelationsToRemove(rows, { blocks: "DEV-2" });
		expect(targets.map((t) => t.entry.id)).toEqual(["a"]);
		expect(targets[0]?.option).toBe("blocks");
	});

	it("keeps --blocks and --blocked-by apart so neither retracts the other's row", () => {
		// The reader renames the incoming side to blockedBy; these are different
		// rows and confusing them would delete the opposite direction.
		const rows = [
			entry({ id: "out", type: "blocks", direction: "outgoing" }),
			entry({ id: "in", type: "blockedBy", direction: "incoming" }),
		];
		expect(
			selectRelationsToRemove(rows, { blocks: "DEV-2" }).map((t) => t.entry.id),
		).toEqual(["out"]);
		expect(
			selectRelationsToRemove(rows, { blockedBy: "DEV-2" }).map(
				(t) => t.entry.id,
			),
		).toEqual(["in"]);
	});

	it("keeps --duplicate-of to the outgoing row so it cannot retract the reverse", () => {
		// Review finding 99a002ee8d on PR #354: normalizeInverseType renames only
		// `blocks`, so an incoming duplicate ("DEV-2 is a duplicate of DEV-1")
		// reaches the matcher as type `duplicate` exactly like an outgoing one.
		// Matching on type alone therefore retracted the opposite direction, and
		// because every match is taken it deleted both rows at once.
		const rows = [
			entry({ id: "out", type: "duplicate", direction: "outgoing" }),
			entry({ id: "in", type: "duplicate", direction: "incoming" }),
		];
		expect(
			selectRelationsToRemove(rows, { duplicateOf: "DEV-2" }).map(
				(t) => t.entry.id,
			),
		).toEqual(["out"]);
	});

	it("refuses --duplicate-of when only the reverse duplicate exists", () => {
		// The refusal has to be intelligible: the peer the user named really is
		// on the issue, just on the side this flag does not own.
		const rows = [
			entry({ id: "in", type: "duplicate", direction: "incoming" }),
		];
		expect(() =>
			selectRelationsToRemove(rows, { duplicateOf: "DEV-2" }),
		).toThrow(/incoming duplicate DEV-2/);
	});

	it("matches a peer by identifier case-insensitively or by UUID", () => {
		const rows = [entry({ id: "a", type: "related" })];
		for (const named of ["DEV-2", "dev-2", "uuid-2"]) {
			expect(
				selectRelationsToRemove(rows, { relatedTo: named }).map(
					(t) => t.entry.id,
				),
			).toEqual(["a"]);
		}
	});

	it("removes a symmetric related row from either direction", () => {
		// Linear stores one `related` row and the reader reports it as `related`
		// whichever side is queried, so direction must not narrow the match.
		const rows = [
			entry({ id: "inbound", type: "related", direction: "incoming" }),
		];
		expect(
			selectRelationsToRemove(rows, { relatedTo: "DEV-2" }).map(
				(t) => t.entry.id,
			),
		).toEqual(["inbound"]);
	});

	it("takes every duplicate row of the same type so none is left invisible", () => {
		const rows = [
			entry({ id: "a", type: "related" }),
			entry({ id: "b", type: "related" }),
		];
		expect(
			selectRelationsToRemove(rows, { relatedTo: "DEV-2" }).map(
				(t) => t.entry.id,
			),
		).toEqual(["a", "b"]);
	});

	it("selects each named peer in a comma-separated list", () => {
		const rows = [
			entry({ id: "a", type: "related", identifier: "DEV-2" }),
			entry({
				id: "b",
				type: "related",
				issue: { id: "uuid-3", identifier: "DEV-3", title: "Other" },
			}),
		];
		expect(
			selectRelationsToRemove(rows, { relatedTo: "DEV-2,DEV-3" }).map(
				(t) => t.entry.id,
			),
		).toEqual(["a", "b"]);
	});

	it("names what is actually there when the relation does not exist", () => {
		const rows = [entry({ id: "a", type: "related" })];
		expect(() => selectRelationsToRemove(rows, { blocks: "DEV-2" })).toThrow(
			/No blocks relation to DEV-2 to remove.*has: outgoing related DEV-2/s,
		);
	});

	it("says so plainly when the issue has no relations at all", () => {
		expect(() => selectRelationsToRemove([], { blocks: "DEV-9" })).toThrow(
			/No blocks relation to DEV-9 to remove. This issue has no relations./,
		);
	});

	it("selects nothing when no flag is given", () => {
		expect(selectRelationsToRemove([entry()], {})).toEqual([]);
	});
});

describe("deleteRelations (DEV-14607)", () => {
	it("addresses each row by its own relation id", async () => {
		const rawRequest = vi
			.fn()
			.mockResolvedValue({ issueRelationDelete: { success: true } });
		const targets = selectRelationsToRemove(
			[entry({ id: "rel-7", type: "duplicate" })],
			{ duplicateOf: "DEV-2" },
		);
		const removed = await deleteRelations(targets, {
			rawRequest,
		} as unknown as Parameters<typeof deleteRelations>[1]);
		expect(removed.map((r) => r.id)).toEqual(["rel-7"]);
		expect(rawRequest.mock.calls[0]?.[1]).toEqual({ id: "rel-7" });
	});

	it("fails loudly when Linear reports the delete unsuccessful", async () => {
		const rawRequest = vi
			.fn()
			.mockResolvedValue({ issueRelationDelete: { success: false } });
		const targets = selectRelationsToRemove([entry({ id: "rel-8" })], {
			blocks: "DEV-2",
		});
		await expect(
			deleteRelations(targets, {
				rawRequest,
			} as unknown as Parameters<typeof deleteRelations>[1]),
		).rejects.toThrow(/Linear refused to remove the blocks relation to DEV-2/);
	});
});
