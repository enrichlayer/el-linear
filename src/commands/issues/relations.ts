/**
 * Issue-relation helpers — `transformIssueRelation` for the create
 * path, plus the `RelatedIssueEntry` builders used by the
 * `issues related` query path.
 *
 * Extracted from `commands/issues.ts` (ALL-938) so that file can
 * focus on commander wiring + handlers.
 */

import {
	ISSUE_RELATION_CREATE_MUTATION,
	ISSUE_RELATION_DELETE_MUTATION,
} from "../../queries/issues.js";
import type {
	IssueRelationCreateResponse,
	IssueRelationDeleteResponse,
	RelationIncomingNode,
	RelationOutgoingNode,
	RelationPeerNode,
} from "../../queries/issues-types.js";
import type {
	LinearIssueRelation,
	LinearPriority,
} from "../../types/linear.js";
import type { GraphQLService } from "../../utils/graphql-service.js";
import type { LinearService } from "../../utils/linear-service.js";
import { splitList } from "../../utils/validators.js";

type CreatedIssueRelation = NonNullable<
	IssueRelationCreateResponse["issueRelationCreate"]["issueRelation"]
>;

function transformIssueRelation(
	rel: CreatedIssueRelation,
): LinearIssueRelation {
	return {
		id: rel.id,
		type: rel.type,
		issue: {
			id: rel.issue.id,
			identifier: rel.issue.identifier,
			title: rel.issue.title,
		},
		relatedIssue: {
			id: rel.relatedIssue.id,
			identifier: rel.relatedIssue.identifier,
			title: rel.relatedIssue.title,
		},
	};
}

/**
 * Walk the `--related-to` / `--blocks` / `--blocked-by` /
 * `--duplicate-of` flags and create the corresponding
 * IssueRelation rows. Used by `issues create`.
 */
export async function createRelations(
	sourceId: string,
	options: Record<string, unknown>,
	graphQLService: GraphQLService,
	linearService: LinearService,
): Promise<LinearIssueRelation[]> {
	const relations: LinearIssueRelation[] = [];

	for (const spec of RELATION_SPECS) {
		const value = options[spec.option] as string | undefined;
		if (!value) {
			continue;
		}
		for (const id of splitList(value)) {
			const targetId = await linearService.resolveIssueId(id);
			const result =
				await graphQLService.rawRequest<IssueRelationCreateResponse>(
					ISSUE_RELATION_CREATE_MUTATION,
					{
						input: {
							issueId: spec.reverse ? targetId : sourceId,
							relatedIssueId: spec.reverse ? sourceId : targetId,
							type: spec.type,
						},
					},
				);
			const issueRelation = result.issueRelationCreate.issueRelation;
			if (!issueRelation) {
				throw new Error(
					`Failed to create ${spec.type} relation from ${sourceId} to ${id}`,
				);
			}
			relations.push(transformIssueRelation(issueRelation));
		}
	}

	return relations;
}

/**
 * The flag table `createRelations` walks, shared with the removal path so a
 * relation can only be retracted through the same spelling that created it.
 * `blockedBy` is the reverse of `blocks`; the reader normalizes the incoming
 * direction to `blockedBy`, which is what `removalType` matches against.
 */
const RELATION_SPECS: {
	option: string;
	type: string;
	/** The type as the relation reader reports it from the source's view. */
	removalType: string;
	/**
	 * Which side of the relation this flag owns, where the reported type alone
	 * does not say. `normalizeInverseType` renames only `blocks`, so `blocks`
	 * and `blockedBy` are already distinct types and need no direction, and
	 * `related` is symmetric so narrowing it would refuse a legitimate
	 * removal. A duplicate is reported as `duplicate` from both sides, so
	 * without this the flag would retract the opposite direction.
	 */
	removalDirection?: RelatedIssueEntry["direction"];
	reverse?: boolean;
}[] = [
	{ option: "relatedTo", type: "related", removalType: "related" },
	{ option: "blocks", type: "blocks", removalType: "blocks" },
	{
		option: "blockedBy",
		type: "blocks",
		removalType: "blockedBy",
		reverse: true,
	},
	{
		option: "duplicateOf",
		type: "duplicate",
		removalType: "duplicate",
		removalDirection: "outgoing",
	},
];

export interface RelatedIssueEntry {
	direction: "outgoing" | "incoming";
	id: string;
	issue: {
		id: string;
		identifier: string;
		title: string;
		state?: { id: string; name: string };
		priority?: LinearPriority;
		assignee?: { id: string; name: string };
		team?: { id: string; key: string; name: string };
	};
	type: string;
}

/**
 * Invert relation type for incoming (inverse) relations so the output
 * reads naturally from the perspective of the queried issue. E.g. if
 * DEV-100 "blocks" DEV-200, and we query DEV-200, the inverse relation
 * type is "blocks" but direction is incoming → "blockedBy".
 */
function normalizeInverseType(type: string): string {
	if (type === "blocks") {
		return "blockedBy";
	}
	return type;
}

function buildRelatedIssueSummary(
	peer: RelationPeerNode,
): RelatedIssueEntry["issue"] {
	return {
		id: peer.id,
		identifier: peer.identifier,
		title: peer.title,
		...(peer.state
			? { state: { id: peer.state.id, name: peer.state.name } }
			: {}),
		...(peer.priority == null ? {} : { priority: peer.priority }),
		...(peer.assignee
			? {
					assignee: {
						id: peer.assignee.id,
						name: peer.assignee.name,
					},
				}
			: {}),
		...(peer.team
			? {
					team: {
						id: peer.team.id,
						key: peer.team.key,
						name: peer.team.name,
					},
				}
			: {}),
	};
}

export function buildOutgoingRelationEntries(
	nodes: RelationOutgoingNode[] | undefined,
): RelatedIssueEntry[] {
	const entries: RelatedIssueEntry[] = [];
	for (const rel of nodes ?? []) {
		if (!rel.relatedIssue) {
			continue;
		}
		entries.push({
			id: rel.id,
			type: rel.type,
			direction: "outgoing",
			issue: buildRelatedIssueSummary(rel.relatedIssue),
		});
	}
	return entries;
}

export function buildIncomingRelationEntries(
	nodes: RelationIncomingNode[] | undefined,
): RelatedIssueEntry[] {
	const entries: RelatedIssueEntry[] = [];
	for (const rel of nodes ?? []) {
		if (!rel.issue) {
			continue;
		}
		entries.push({
			id: rel.id,
			type: normalizeInverseType(rel.type),
			direction: "incoming",
			issue: buildRelatedIssueSummary(rel.issue),
		});
	}
	return entries;
}

/** One relation selected for removal, with the flag that asked for it. */
export interface RelationRemovalTarget {
	entry: RelatedIssueEntry;
	/** The flag spelling the caller used, for the confirmation line. */
	option: string;
	/** What the caller named on the command line, for error text. */
	requested: string;
}

/**
 * PURE — pick the relations the `--related-to` / `--blocks` / `--blocked-by` /
 * `--duplicate-of` flags name, from relations already read (DEV-14607).
 *
 * A peer is matched on identifier (case-insensitively, since Linear
 * identifiers are upper-case and callers type either) or on UUID, because
 * `issues unrelate DEV-1 --blocks DEV-2` and the resolved id must both work.
 *
 * `related` is symmetric: Linear stores one row and the reader reports it as
 * `related` whichever side is queried, so direction is not part of the match.
 * `blocks` is directional, and the reader renames the incoming side to
 * `blockedBy`, so `--blocks` and `--blocked-by` select different rows and
 * neither can retract the other's.
 *
 * Returns every match rather than the first: a duplicate pair of the same
 * type between the same two issues is removable in one pass instead of
 * leaving a second invisible row behind.
 */
export function selectRelationsToRemove(
	entries: RelatedIssueEntry[],
	options: Record<string, unknown>,
): RelationRemovalTarget[] {
	const targets: RelationRemovalTarget[] = [];
	const chosen = new Set<string>();
	for (const spec of RELATION_SPECS) {
		const value = options[spec.option] as string | undefined;
		if (!value) {
			continue;
		}
		for (const requested of splitList(value)) {
			const wanted = requested.trim().toLowerCase();
			const matches = entries.filter(
				(entry) =>
					entry.type === spec.removalType &&
					(spec.removalDirection === undefined ||
						entry.direction === spec.removalDirection) &&
					(entry.issue.identifier.toLowerCase() === wanted ||
						entry.issue.id.toLowerCase() === wanted),
			);
			if (matches.length === 0) {
				throw new Error(
					`No ${spec.removalType} relation to ${requested} to remove. ` +
						(entries.length === 0
							? "This issue has no relations."
							: // The direction is part of the listing because a flag that
								// owns one side refuses the other, and naming only the type
								// would list the peer the user just asked for as if absent.
								`This issue has: ${entries
									.map(
										(entry) =>
											`${entry.direction} ${entry.type} ${entry.issue.identifier}`,
									)
									.join(", ")}.`),
				);
			}
			for (const entry of matches) {
				if (chosen.has(entry.id)) {
					continue;
				}
				chosen.add(entry.id);
				targets.push({ entry, option: spec.option, requested });
			}
		}
	}
	return targets;
}

/**
 * Delete the selected relations. Each row is addressed by its own id, so a
 * concurrent change to the issue's other relations cannot redirect a delete.
 */
export async function deleteRelations(
	targets: RelationRemovalTarget[],
	graphQLService: GraphQLService,
): Promise<RelatedIssueEntry[]> {
	const removed: RelatedIssueEntry[] = [];
	for (const target of targets) {
		const result = await graphQLService.rawRequest<IssueRelationDeleteResponse>(
			ISSUE_RELATION_DELETE_MUTATION,
			{ id: target.entry.id },
		);
		if (!result.issueRelationDelete.success) {
			throw new Error(
				`Linear refused to remove the ${target.entry.type} relation to ${target.entry.issue.identifier} (relation ${target.entry.id})`,
			);
		}
		removed.push(target.entry);
	}
	return removed;
}
