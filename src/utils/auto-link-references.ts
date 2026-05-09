import {
	GET_ISSUE_RELATIONS_QUERY,
	ISSUE_RELATION_CREATE_MUTATION,
} from "../queries/issues.js";
import type {
	GetIssueRelationsResponse,
	IssueRelationCreateResponse,
	RelationIncomingNode,
	RelationOutgoingNode,
} from "../queries/issues-types.js";
import type { GraphQLService } from "./graphql-service.js";
import {
	extractIssueReferences,
	type IssueReference,
	type IssueRelationType,
} from "./issue-reference-extractor.js";
import type { LinearService } from "./linear-service.js";

export interface AutoLinkLinked {
	identifier: string;
	/** True when source/target were swapped on the create (e.g. "blocked by X" → X→source) */
	reverse: boolean;
	title: string;
	type: IssueRelationType;
}

export interface AutoLinkSkipped {
	existingType: string;
	identifier: string;
	/** Type that would have been created had the reference been new */
	inferredType: IssueRelationType;
}

export interface AutoLinkFailed {
	identifier: string;
	reason: string;
}

export interface AutoLinkResult {
	failed: AutoLinkFailed[];
	linked: AutoLinkLinked[];
	skipped: AutoLinkSkipped[];
}

interface AutoLinkInput {
	/** Optional comment bodies to also scan (description wins for type inference on conflicts) */
	comments?: string[] | undefined;
	/** Description text to scan for references */
	description: string | null | undefined;
	/** When true, skip the create mutation but still report what would be linked */
	dryRun?: boolean;
	graphQLService: GraphQLService;
	/** Human identifier of the source issue (e.g. "EMW-258") — used to skip self-references */
	identifier: string;
	/** Resolved UUID of the source issue */
	issueId: string;
	linearService: LinearService;
	/**
	 * Optional pre-resolved Map<identifier, uuid>. When provided, the linker uses these
	 * UUIDs instead of re-calling resolveIssueId. Identifiers absent from the map are
	 * still resolved on-demand (so callers can pass partial maps).
	 */
	preResolved?: Map<string, string>;
}

interface ExistingRelations {
	/** Map from referenced issue identifier → existing relation type */
	byIdentifier: Map<string, string>;
	/** Map from referenced issue UUID → existing relation type (for de-dup post-resolution) */
	byUuid: Map<string, string>;
}

function specificity(ref: IssueReference): number {
	if (ref.type === "duplicate") {
		return 3;
	}
	if (ref.type === "blocks") {
		return 2;
	}
	return 1;
}

/**
 * Merge candidates from multiple sources (description, comments) into one list,
 * keeping the strongest (most-specific) inference per identifier. The first source
 * wins on ties — so callers should pass description first.
 */
function mergeCandidates(...sources: IssueReference[][]): IssueReference[] {
	const byId = new Map<string, IssueReference>();
	for (const refs of sources) {
		for (const ref of refs) {
			const existing = byId.get(ref.identifier);
			if (!existing || specificity(ref) > specificity(existing)) {
				byId.set(ref.identifier, ref);
			}
		}
	}
	return [...byId.values()];
}

function mergeOutgoingRelations(
	nodes: RelationOutgoingNode[],
	out: ExistingRelations,
): void {
	for (const rel of nodes) {
		const peer = rel.relatedIssue;
		if (!peer) {
			continue;
		}
		if (!out.byIdentifier.has(peer.identifier)) {
			out.byIdentifier.set(peer.identifier, rel.type);
		}
		if (!out.byUuid.has(peer.id)) {
			out.byUuid.set(peer.id, rel.type);
		}
	}
}

function mergeIncomingRelations(
	nodes: RelationIncomingNode[],
	out: ExistingRelations,
): void {
	for (const rel of nodes) {
		const peer = rel.issue;
		if (!peer) {
			continue;
		}
		// Normalize incoming "blocks" → "blockedBy" so the reported type reads naturally
		const type = rel.type === "blocks" ? "blockedBy" : rel.type;
		if (!out.byIdentifier.has(peer.identifier)) {
			out.byIdentifier.set(peer.identifier, type);
		}
		if (!out.byUuid.has(peer.id)) {
			out.byUuid.set(peer.id, type);
		}
	}
}

async function fetchExistingRelations(
	issueId: string,
	graphQLService: GraphQLService,
): Promise<ExistingRelations> {
	const result = await graphQLService.rawRequest<GetIssueRelationsResponse>(
		GET_ISSUE_RELATIONS_QUERY,
		{ id: issueId },
	);
	const out: ExistingRelations = { byIdentifier: new Map(), byUuid: new Map() };
	if (!result.issue) {
		return out;
	}
	mergeOutgoingRelations(result.issue.relations.nodes, out);
	mergeIncomingRelations(result.issue.inverseRelations.nodes, out);
	return out;
}

type CandidateOutcome =
	| { kind: "linked"; entry: AutoLinkLinked; resolvedId: string }
	| { kind: "skipped"; entry: AutoLinkSkipped; resolvedId?: string }
	| { kind: "failed"; entry: AutoLinkFailed }
	| { kind: "self" };

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function createTypedRelation(
	ref: IssueReference,
	sourceId: string,
	resolvedId: string,
	graphQLService: GraphQLService,
): Promise<AutoLinkLinked> {
	const result = await graphQLService.rawRequest<IssueRelationCreateResponse>(
		ISSUE_RELATION_CREATE_MUTATION,
		{
			input: {
				issueId: ref.reverse ? resolvedId : sourceId,
				relatedIssueId: ref.reverse ? sourceId : resolvedId,
				type: ref.type,
			},
		},
	);
	const issueRelation = result.issueRelationCreate.issueRelation;
	// The peer (the issue NOT identified by `sourceId`) is whichever side wasn't the source
	const peer = ref.reverse ? issueRelation?.issue : issueRelation?.relatedIssue;
	return {
		identifier: peer?.identifier ?? ref.identifier,
		title: peer?.title ?? "",
		type: ref.type,
		reverse: ref.reverse,
	};
}

async function processCandidate(
	ref: IssueReference,
	ctx: {
		sourceId: string;
		existing: ExistingRelations;
		dryRun: boolean;
		graphQLService: GraphQLService;
		linearService: LinearService;
		preResolved?: Map<string, string>;
	},
): Promise<CandidateOutcome> {
	const existingType = ctx.existing.byIdentifier.get(ref.identifier);
	if (existingType) {
		return {
			kind: "skipped",
			entry: {
				identifier: ref.identifier,
				existingType,
				inferredType: ref.type,
			},
		};
	}

	let resolvedId: string;
	const cached = ctx.preResolved?.get(ref.identifier);
	if (cached) {
		resolvedId = cached;
	} else {
		try {
			resolvedId = await ctx.linearService.resolveIssueId(ref.identifier);
		} catch (err) {
			return {
				kind: "failed",
				entry: { identifier: ref.identifier, reason: describeError(err) },
			};
		}
	}

	if (resolvedId === ctx.sourceId) {
		return { kind: "self" };
	}
	const existingByUuid = ctx.existing.byUuid.get(resolvedId);
	if (existingByUuid) {
		return {
			kind: "skipped",
			entry: {
				identifier: ref.identifier,
				existingType: existingByUuid,
				inferredType: ref.type,
			},
			resolvedId,
		};
	}

	if (ctx.dryRun) {
		return {
			kind: "linked",
			entry: {
				identifier: ref.identifier,
				title: "",
				type: ref.type,
				reverse: ref.reverse,
			},
			resolvedId,
		};
	}

	try {
		const linked = await createTypedRelation(
			ref,
			ctx.sourceId,
			resolvedId,
			ctx.graphQLService,
		);
		return { kind: "linked", entry: linked, resolvedId };
	} catch (err) {
		return {
			kind: "failed",
			entry: { identifier: ref.identifier, reason: describeError(err) },
		};
	}
}

export async function autoLinkReferences(
	input: AutoLinkInput,
): Promise<AutoLinkResult> {
	const {
		issueId,
		identifier,
		description,
		comments,
		graphQLService,
		linearService,
		dryRun,
		preResolved,
	} = input;
	const linked: AutoLinkLinked[] = [];
	const skipped: AutoLinkSkipped[] = [];
	const failed: AutoLinkFailed[] = [];

	const descriptionRefs = extractIssueReferences(description ?? "", identifier);
	const commentRefs = (comments ?? []).flatMap((body) =>
		extractIssueReferences(body, identifier),
	);
	const merged = mergeCandidates(descriptionRefs, commentRefs);
	// Cap the number of candidates we'll resolve per call. A malicious
	// (or merely careless) issue body containing hundreds of fake
	// identifiers — `AAA-1, AAA-2, …, AAA-999` — would otherwise trigger
	// 999 GraphQL roundtrips before deciding none resolve. Realistic
	// human-authored bodies stay well under this cap.
	const MAX_CANDIDATES_PER_CALL = 50;
	const candidates = merged.slice(0, MAX_CANDIDATES_PER_CALL);
	if (merged.length > MAX_CANDIDATES_PER_CALL) {
		const overflow = merged.length - MAX_CANDIDATES_PER_CALL;
		failed.push({
			identifier: `+${overflow} more`,
			reason: `Too many candidate references (${merged.length}); only the first ${MAX_CANDIDATES_PER_CALL} are processed.`,
		});
	}
	if (candidates.length === 0) {
		return { linked, skipped, failed };
	}

	const existing = await fetchExistingRelations(issueId, graphQLService);
	const ctx = {
		sourceId: issueId,
		existing,
		dryRun: Boolean(dryRun),
		graphQLService,
		linearService,
		preResolved,
	};

	for (const ref of candidates) {
		const outcome = await processCandidate(ref, ctx);
		if (outcome.kind === "linked") {
			linked.push(outcome.entry);
			// Track in the existing maps so the same ref repeated in input isn't re-linked
			const recordedType =
				ref.reverse && ref.type === "blocks" ? "blockedBy" : ref.type;
			existing.byIdentifier.set(ref.identifier, recordedType);
			existing.byUuid.set(outcome.resolvedId, recordedType);
		} else if (outcome.kind === "skipped") {
			skipped.push(outcome.entry);
		} else if (outcome.kind === "failed") {
			failed.push(outcome.entry);
		}
	}

	return { linked, skipped, failed };
}
