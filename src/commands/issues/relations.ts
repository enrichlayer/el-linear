/**
 * Issue-relation helpers — `transformIssueRelation` for the create
 * path, plus the `RelatedIssueEntry` builders used by the
 * `issues related` query path.
 *
 * Extracted from `commands/issues.ts` (ALL-938) so that file can
 * focus on commander wiring + handlers.
 */

import { ISSUE_RELATION_CREATE_MUTATION } from "../../queries/issues.js";
import type {
	IssueRelationCreateResponse,
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

	const relationSpecs: { option: string; type: string; reverse?: boolean }[] = [
		{ option: "relatedTo", type: "related" },
		{ option: "blocks", type: "blocks" },
		{ option: "blockedBy", type: "blocks", reverse: true },
		{ option: "duplicateOf", type: "duplicate" },
	];

	for (const spec of relationSpecs) {
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
