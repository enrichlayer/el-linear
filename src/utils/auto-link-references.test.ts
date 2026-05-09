import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	GET_ISSUE_RELATIONS_QUERY,
	ISSUE_RELATION_CREATE_MUTATION,
} from "../queries/issues.js";
import { autoLinkReferences } from "./auto-link-references.js";
import type { GraphQLService } from "./graphql-service.js";
import type { LinearService } from "./linear-service.js";

interface RelationsResponse {
	issue: {
		relations: {
			nodes: Array<{
				id: string;
				type: string;
				relatedIssue: { id: string; identifier: string; title: string };
			}>;
		};
		inverseRelations: {
			nodes: Array<{
				id: string;
				type: string;
				issue: { id: string; identifier: string; title: string };
			}>;
		};
	};
}

function makeRelationsResponse(args: {
	outgoing?: Array<{
		identifier: string;
		uuid: string;
		type: string;
		title?: string;
	}>;
	incoming?: Array<{
		identifier: string;
		uuid: string;
		type: string;
		title?: string;
	}>;
}): RelationsResponse {
	return {
		issue: {
			relations: {
				nodes: (args.outgoing ?? []).map((r, i) => ({
					id: `rel-out-${i}`,
					type: r.type,
					relatedIssue: {
						id: r.uuid,
						identifier: r.identifier,
						title: r.title ?? r.identifier,
					},
				})),
			},
			inverseRelations: {
				nodes: (args.incoming ?? []).map((r, i) => ({
					id: `rel-in-${i}`,
					type: r.type,
					issue: {
						id: r.uuid,
						identifier: r.identifier,
						title: r.title ?? r.identifier,
					},
				})),
			},
		},
	};
}

function makeRelationCreateResponse(args: {
	type: string;
	reverse: boolean;
	peer: { id: string; identifier: string; title: string };
}) {
	// Mirror the GraphQL response shape: result has both `issue` and `relatedIssue`.
	// Whichever side wasn't the source is the "peer" we extract for the linked entry.
	const sourcePlaceholder = {
		id: "uuid-source",
		identifier: "EMW-258",
		title: "source",
	};
	return {
		issueRelationCreate: {
			success: true,
			issueRelation: {
				id: "rel-x",
				type: args.type,
				issue: args.reverse ? args.peer : sourcePlaceholder,
				relatedIssue: args.reverse ? sourcePlaceholder : args.peer,
			},
		},
	};
}

function makeServices() {
	const rawRequest = vi.fn();
	const resolveIssueId = vi.fn<(id: string) => Promise<string>>();
	const graphQLService = { rawRequest } as unknown as GraphQLService;
	const linearService = { resolveIssueId } as unknown as LinearService;
	return { rawRequest, resolveIssueId, graphQLService, linearService };
}

describe("autoLinkReferences", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns empty result and makes no API calls when description has no references", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "no references in this body",
			graphQLService,
			linearService,
		});
		expect(result).toEqual({ linked: [], skipped: [], failed: [] });
		expect(rawRequest).not.toHaveBeenCalled();
		expect(resolveIssueId).not.toHaveBeenCalled();
	});

	it("returns empty result for empty/null description and no comments", async () => {
		const { rawRequest, graphQLService, linearService } = makeServices();
		expect(
			await autoLinkReferences({
				issueId: "uuid-source",
				identifier: "EMW-258",
				description: null,
				graphQLService,
				linearService,
			}),
		).toEqual({ linked: [], skipped: [], failed: [] });
		expect(rawRequest).not.toHaveBeenCalled();
	});

	it("creates a related relation for a new bare reference", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-target");
		rawRequest.mockResolvedValueOnce(
			makeRelationCreateResponse({
				type: "related",
				reverse: false,
				peer: {
					id: "uuid-target",
					identifier: "DEV-3592",
					title: "Original framing",
				},
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "based on DEV-3592",
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([
			{
				identifier: "DEV-3592",
				title: "Original framing",
				type: "related",
				reverse: false,
			},
		]);
		expect(result.skipped).toEqual([]);
		expect(result.failed).toEqual([]);
		expect(rawRequest).toHaveBeenNthCalledWith(
			2,
			ISSUE_RELATION_CREATE_MUTATION,
			{
				input: {
					issueId: "uuid-source",
					relatedIssueId: "uuid-target",
					type: "related",
				},
			},
		);
	});

	it("creates a 'blocks' relation when prose says 'blocked by' (reversed)", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-blocker");
		rawRequest.mockResolvedValueOnce(
			makeRelationCreateResponse({
				type: "blocks",
				reverse: true,
				peer: {
					id: "uuid-blocker",
					identifier: "DEV-100",
					title: "Blocking issue",
				},
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "blocked by DEV-100",
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([
			{
				identifier: "DEV-100",
				title: "Blocking issue",
				type: "blocks",
				reverse: true,
			},
		]);
		// Reversed: source becomes target
		expect(rawRequest).toHaveBeenNthCalledWith(
			2,
			ISSUE_RELATION_CREATE_MUTATION,
			{
				input: {
					issueId: "uuid-blocker",
					relatedIssueId: "uuid-source",
					type: "blocks",
				},
			},
		);
	});

	it("creates a 'blocks' relation when prose says 'blocks' (forward)", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-target");
		rawRequest.mockResolvedValueOnce(
			makeRelationCreateResponse({
				type: "blocks",
				reverse: false,
				peer: { id: "uuid-target", identifier: "DEV-200", title: "Downstream" },
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "this blocks DEV-200",
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([
			{
				identifier: "DEV-200",
				title: "Downstream",
				type: "blocks",
				reverse: false,
			},
		]);
		expect(rawRequest).toHaveBeenNthCalledWith(
			2,
			ISSUE_RELATION_CREATE_MUTATION,
			{
				input: {
					issueId: "uuid-source",
					relatedIssueId: "uuid-target",
					type: "blocks",
				},
			},
		);
	});

	it("creates a 'duplicate' relation when prose says 'duplicates'", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-orig");
		rawRequest.mockResolvedValueOnce(
			makeRelationCreateResponse({
				type: "duplicate",
				reverse: false,
				peer: { id: "uuid-orig", identifier: "DEV-50", title: "The original" },
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "this duplicates DEV-50",
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([
			{
				identifier: "DEV-50",
				title: "The original",
				type: "duplicate",
				reverse: false,
			},
		]);
		expect(rawRequest).toHaveBeenNthCalledWith(
			2,
			ISSUE_RELATION_CREATE_MUTATION,
			{
				input: {
					issueId: "uuid-source",
					relatedIssueId: "uuid-orig",
					type: "duplicate",
				},
			},
		);
	});

	it("creates a reversed duplicate when prose says 'duplicated by'", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-dup");
		rawRequest.mockResolvedValueOnce(
			makeRelationCreateResponse({
				type: "duplicate",
				reverse: true,
				peer: { id: "uuid-dup", identifier: "EMW-100", title: "The dup" },
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "this was duplicated by EMW-100",
			graphQLService,
			linearService,
		});

		expect(result.linked[0].reverse).toBe(true);
		expect(rawRequest).toHaveBeenNthCalledWith(
			2,
			ISSUE_RELATION_CREATE_MUTATION,
			{
				input: {
					issueId: "uuid-dup",
					relatedIssueId: "uuid-source",
					type: "duplicate",
				},
			},
		);
	});

	it("skips a reference already linked as related (outgoing)", async () => {
		const { rawRequest, graphQLService, linearService } = makeServices();
		rawRequest.mockResolvedValueOnce(
			makeRelationsResponse({
				outgoing: [
					{ identifier: "DEV-3592", uuid: "uuid-target", type: "related" },
				],
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "based on DEV-3592",
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([]);
		expect(result.skipped).toEqual([
			{
				identifier: "DEV-3592",
				existingType: "related",
				inferredType: "related",
			},
		]);
		expect(rawRequest).toHaveBeenCalledTimes(1);
	});

	it("does NOT upgrade an existing 'related' to 'blocks' even when prose says 'blocked by'", async () => {
		const { rawRequest, graphQLService, linearService } = makeServices();
		rawRequest.mockResolvedValueOnce(
			makeRelationsResponse({
				outgoing: [
					{ identifier: "DEV-100", uuid: "uuid-blocker", type: "related" },
				],
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "actually, blocked by DEV-100",
			graphQLService,
			linearService,
		});

		// Inferred is blocks, but skipped because existing relation (related) shouldn't be auto-upgraded
		expect(result.linked).toEqual([]);
		expect(result.skipped).toEqual([
			{
				identifier: "DEV-100",
				existingType: "related",
				inferredType: "blocks",
			},
		]);
		expect(rawRequest).toHaveBeenCalledTimes(1);
	});

	it("skips a reference already linked as blockedBy (incoming, normalized)", async () => {
		const { rawRequest, graphQLService, linearService } = makeServices();
		rawRequest.mockResolvedValueOnce(
			makeRelationsResponse({
				incoming: [
					{ identifier: "DEV-100", uuid: "uuid-blocker", type: "blocks" },
				],
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "see DEV-100 for context",
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([]);
		expect(result.skipped).toEqual([
			{
				identifier: "DEV-100",
				existingType: "blockedBy",
				inferredType: "related",
			},
		]);
	});

	it("scans comments when --include-comments equivalent input is provided", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-from-comment");
		rawRequest.mockResolvedValueOnce(
			makeRelationCreateResponse({
				type: "related",
				reverse: false,
				peer: {
					id: "uuid-from-comment",
					identifier: "DEV-77",
					title: "From comment",
				},
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "no refs in description",
			comments: ["here is a follow-up — see DEV-77"],
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([
			{
				identifier: "DEV-77",
				title: "From comment",
				type: "related",
				reverse: false,
			},
		]);
	});

	it("merges description + comments and prefers description's stronger inference", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-blocker");
		rawRequest.mockResolvedValueOnce(
			makeRelationCreateResponse({
				type: "blocks",
				reverse: true,
				peer: { id: "uuid-blocker", identifier: "DEV-100", title: "Blocker" },
			}),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "blocked by DEV-100",
			comments: ["btw also see DEV-100 in passing"],
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([
			{
				identifier: "DEV-100",
				title: "Blocker",
				type: "blocks",
				reverse: true,
			},
		]);
		expect(rawRequest).toHaveBeenNthCalledWith(
			2,
			ISSUE_RELATION_CREATE_MUTATION,
			{
				input: {
					issueId: "uuid-blocker",
					relatedIssueId: "uuid-source",
					type: "blocks",
				},
			},
		);
	});

	it("records a failed entry when resolveIssueId throws", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockRejectedValueOnce(
			new Error('Issue "GHOST-999" not found'),
		);

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "see GHOST-999",
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([]);
		expect(result.skipped).toEqual([]);
		expect(result.failed).toEqual([
			{ identifier: "GHOST-999", reason: 'Issue "GHOST-999" not found' },
		]);
	});

	it("dryRun: reports what would be linked without calling create mutation", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-target");

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "blocked by DEV-100",
			graphQLService,
			linearService,
			dryRun: true,
		});

		expect(result.linked).toEqual([
			{ identifier: "DEV-100", title: "", type: "blocks", reverse: true },
		]);
		expect(rawRequest).toHaveBeenCalledTimes(1);
		expect(rawRequest).toHaveBeenCalledWith(GET_ISSUE_RELATIONS_QUERY, {
			id: "uuid-source",
		});
	});

	it("excludes self references", async () => {
		const { rawRequest, graphQLService, linearService } = makeServices();
		const result = await autoLinkReferences({
			issueId: "uuid-self",
			identifier: "EMW-258",
			description: "this issue (EMW-258) and EMW-258 again",
			graphQLService,
			linearService,
		});
		expect(result).toEqual({ linked: [], skipped: [], failed: [] });
		expect(rawRequest).not.toHaveBeenCalled();
	});

	it("records failure when create mutation throws", async () => {
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		resolveIssueId.mockResolvedValueOnce("uuid-target");
		rawRequest.mockRejectedValueOnce(new Error("rate limited"));

		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: "see DEV-3592",
			graphQLService,
			linearService,
		});

		expect(result.linked).toEqual([]);
		expect(result.failed).toEqual([
			{ identifier: "DEV-3592", reason: "rate limited" },
		]);
	});

	it("caps the number of candidates at 50 per call (ALL-935 DoS guard)", async () => {
		// A description with 200 unique fake identifiers — pre-fix, this
		// would fire 200 resolveIssueId calls before deciding none
		// resolved. Post-fix, only the first 50 are processed and the
		// overflow is reported as a single synthetic failure entry.
		const { rawRequest, resolveIssueId, graphQLService, linearService } =
			makeServices();
		rawRequest.mockResolvedValueOnce(makeRelationsResponse({}));
		// Every resolution fails with "not found" — none of the fake IDs exist.
		resolveIssueId.mockRejectedValue(new Error("not found"));

		const lots = Array.from({ length: 200 }, (_, i) => `AAA-${i + 1}`).join(
			", ",
		);
		const result = await autoLinkReferences({
			issueId: "uuid-source",
			identifier: "EMW-258",
			description: `see ${lots}`,
			graphQLService,
			linearService,
		});

		// 1 overflow entry (pushed first) + 50 real resolution attempts = 51 failed.
		expect(result.failed).toHaveLength(51);
		expect(result.failed[0]).toEqual({
			identifier: "+150 more",
			reason: expect.stringContaining("Too many candidate references"),
		});
		// And exactly 50 resolveIssueId calls — one per processed candidate.
		expect(resolveIssueId).toHaveBeenCalledTimes(50);
	});
});
