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
	GraphQLResponseData,
	LinearIssueRelation,
} from "../../types/linear.js";
import type { GraphQLService } from "../../utils/graphql-service.js";
import type { LinearService } from "../../utils/linear-service.js";
import { splitList } from "../../utils/validators.js";

export function transformIssueRelation(
	rel: GraphQLResponseData,
): LinearIssueRelation {
	const issue = rel.issue as GraphQLResponseData;
	const relatedIssue = rel.relatedIssue as GraphQLResponseData;
	return {
		id: rel.id as string,
		type: rel.type as string,
		issue: {
			id: issue.id as string,
			identifier: issue.identifier as string,
			title: issue.title as string,
		},
		relatedIssue: {
			id: relatedIssue.id as string,
			identifier: relatedIssue.identifier as string,
			title: relatedIssue.title as string,
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
			const rel = await graphQLService.rawRequest(
				ISSUE_RELATION_CREATE_MUTATION,
				{
					input: {
						issueId: spec.reverse ? targetId : sourceId,
						relatedIssueId: spec.reverse ? sourceId : targetId,
						type: spec.type,
					},
				},
			);
			const create = rel.issueRelationCreate as GraphQLResponseData | undefined;
			const issueRelation = create?.issueRelation as GraphQLResponseData;
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
		priority?: number;
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
export function normalizeInverseType(type: string): string {
	if (type === "blocks") {
		return "blockedBy";
	}
	return type;
}

export function buildRelatedIssueSummary(
	peer: GraphQLResponseData,
): RelatedIssueEntry["issue"] {
	const state = peer.state as GraphQLResponseData | undefined;
	const assignee = peer.assignee as GraphQLResponseData | undefined;
	const team = peer.team as GraphQLResponseData | undefined;
	return {
		id: peer.id as string,
		identifier: peer.identifier as string,
		title: peer.title as string,
		...(state
			? { state: { id: state.id as string, name: state.name as string } }
			: {}),
		...(peer.priority == null ? {} : { priority: peer.priority as number }),
		...(assignee
			? {
					assignee: {
						id: assignee.id as string,
						name: assignee.name as string,
					},
				}
			: {}),
		...(team
			? {
					team: {
						id: team.id as string,
						key: team.key as string,
						name: team.name as string,
					},
				}
			: {}),
	};
}

export function buildRelationEntries(
	nodes: GraphQLResponseData[] | undefined,
	peerKey: "relatedIssue" | "issue",
	direction: "outgoing" | "incoming",
	normalizeType: (raw: string) => string,
): RelatedIssueEntry[] {
	const entries: RelatedIssueEntry[] = [];
	for (const rel of nodes ?? []) {
		const peer = rel[peerKey] as GraphQLResponseData | undefined;
		if (!peer) {
			continue;
		}
		entries.push({
			id: rel.id as string,
			type: normalizeType(rel.type as string),
			direction,
			issue: buildRelatedIssueSummary(peer),
		});
	}
	return entries;
}
