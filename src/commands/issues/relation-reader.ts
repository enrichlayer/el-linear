import { IssueRelationType } from "@linear/sdk";
import { GET_ISSUE_RELATIONS_PAGE_QUERY } from "../../queries/issues.js";
import type { RelationPeerNode } from "../../queries/issues-types.js";
import type { AuthOptions } from "../../utils/auth.js";
import { createGraphQLService } from "../../utils/graphql-service.js";
import { IDENTIFIER_REGEX } from "../../utils/protected-ranges.js";
import { RelationReadError } from "../../utils/relation-read-error.js";
import {
	buildIncomingRelationEntries,
	buildOutgoingRelationEntries,
	type RelatedIssueEntry,
} from "./relations.js";

/** Fixed read bounds, shared by standalone and included relation reads. */
export const RELATION_READ_LIMITS = Object.freeze({
	pageSize: 50,
	pages: 40,
	rows: 1000,
	bytes: 1024 * 1024,
	timeoutMs: 6000,
});

const relationTypes = new Set<string>(Object.values(IssueRelationType));
const identifierPattern = new RegExp(`^(?:${IDENTIFIER_REGEX.source})$`);
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

function requireValid(condition: unknown, detail: string): asserts condition {
	if (!condition) throw new RelationReadError(detail);
}

function isNamed(value: unknown): value is { id: string; name: string } {
	return record(value) && text(value.id) && text(value.name);
}

function peerIsValid(value: unknown): value is RelationPeerNode {
	return (
		record(value) &&
		text(value.id) &&
		typeof value.identifier === "string" &&
		identifierPattern.test(value.identifier) &&
		typeof value.title === "string" &&
		(value.state === null || isNamed(value.state)) &&
		(value.priority === null ||
			(Number.isInteger(value.priority) &&
				Number(value.priority) >= 0 &&
				Number(value.priority) <= 4)) &&
		(value.assignee === null || isNamed(value.assignee)) &&
		(value.team === null ||
			(record(value.team) && text(value.team.key) && isNamed(value.team)))
	);
}

interface Cursor {
	after: string | null;
	done: boolean;
	seen: Set<string>;
	ids: Set<string>;
}

/**
 * Read both complete connections before returning any relation rows. Failure
 * never returns a partial array. Enumeration completeness is distinct from
 * issue-state policy: a schema-valid null state remains absent in formatted
 * output, so consumers must still require readable blocker state themselves.
 */
export async function readIssueRelations(issueId: string, auth: AuthOptions) {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = performance.now() + RELATION_READ_LIMITS.timeoutMs;
	const work = async () => {
		const service = await createGraphQLService(auth, {
			signal: controller.signal,
		});
		const outgoing: RelatedIssueEntry[] = [];
		const incoming: RelatedIssueEntry[] = [];
		const out: Cursor = {
			after: null,
			done: false,
			seen: new Set(),
			ids: new Set(),
		};
		const into: Cursor = {
			after: null,
			done: false,
			seen: new Set(),
			ids: new Set(),
		};
		let root: { id: string; identifier: string; title: string } | undefined;
		let bytes = 0;
		for (let page = 0; !out.done || !into.done; page++) {
			requireValid(
				!controller.signal.aborted && performance.now() < deadline,
				"read deadline exceeded",
			);
			requireValid(page < RELATION_READ_LIMITS.pages, "page limit exceeded");
			const result = await service.rawRequest<unknown>(
				GET_ISSUE_RELATIONS_PAGE_QUERY,
				{
					id: issueId,
					first: RELATION_READ_LIMITS.pageSize,
					outAfter: out.after,
					inAfter: into.after,
					outgoing: !out.done,
					incoming: !into.done,
				},
			);
			requireValid(
				!controller.signal.aborted && performance.now() < deadline,
				"read deadline exceeded",
			);
			bytes += Buffer.byteLength(JSON.stringify(result) ?? "");
			requireValid(
				bytes <= RELATION_READ_LIMITS.bytes,
				"response byte limit exceeded",
			);
			requireValid(
				record(result) && record(result.issue),
				"issue missing from relation read",
			);
			const issue = result.issue;
			requireValid(
				issue.id === issueId &&
					text(issue.identifier) &&
					identifierPattern.test(issue.identifier) &&
					typeof issue.title === "string",
				"invalid or changed issue scope",
			);
			requireValid(
				!root || root.identifier === issue.identifier,
				"issue identifier changed during read",
			);
			root ??= {
				id: issueId,
				identifier: issue.identifier,
				title: issue.title,
			};
			for (const [key, peerKey, cursor, target] of [
				["relations", "relatedIssue", out, outgoing],
				["inverseRelations", "issue", into, incoming],
			] as const) {
				if (cursor.done) continue;
				const connection = issue[key];
				requireValid(
					record(connection) &&
						Array.isArray(connection.nodes) &&
						record(connection.pageInfo),
					"missing connection or pagination metadata",
				);
				const { nodes, pageInfo } = connection;
				requireValid(
					nodes.length <= RELATION_READ_LIMITS.pageSize,
					"page row limit exceeded",
				);
				requireValid(
					typeof pageInfo.hasNextPage === "boolean" &&
						(pageInfo.endCursor === null || text(pageInfo.endCursor)),
					"invalid pagination metadata",
				);
				for (const row of nodes) {
					requireValid(
						record(row) &&
							text(row.id) &&
							typeof row.type === "string" &&
							relationTypes.has(row.type) &&
							peerIsValid(row[peerKey]),
						"invalid relation or missing peer",
					);
					requireValid(
						!cursor.ids.has(row.id),
						"duplicate relation across pages",
					);
					cursor.ids.add(row.id);
					const peer = row[peerKey] as RelationPeerNode;
					target.push(
						...(key === "relations"
							? buildOutgoingRelationEntries([
									{ id: row.id, type: row.type, relatedIssue: peer },
								])
							: buildIncomingRelationEntries([
									{ id: row.id, type: row.type, issue: peer },
								])),
					);
					requireValid(
						outgoing.length + incoming.length <= RELATION_READ_LIMITS.rows,
						"total row limit exceeded",
					);
				}
				if (pageInfo.hasNextPage) {
					requireValid(
						nodes.length > 0 &&
							text(pageInfo.endCursor) &&
							!cursor.seen.has(pageInfo.endCursor),
						"non-progressing pagination cursor",
					);
					cursor.seen.add(pageInfo.endCursor);
					cursor.after = pageInfo.endCursor;
				} else cursor.done = true;
			}
		}
		requireValid(root, "issue missing from relation read");
		const data = [...outgoing, ...incoming];
		const result = {
			...root,
			data,
			meta: { count: data.length, relations_complete: true as const },
		};
		requireValid(
			Buffer.byteLength(JSON.stringify(result, null, 2)) <=
				RELATION_READ_LIMITS.bytes,
			"output byte limit exceeded",
		);
		requireValid(
			!controller.signal.aborted && performance.now() < deadline,
			"read deadline exceeded",
		);
		return result;
	};
	try {
		return await Promise.race([
			work(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new RelationReadError("read deadline exceeded"));
				}, RELATION_READ_LIMITS.timeoutMs);
			}),
		]);
	} catch (error) {
		if (error instanceof RelationReadError) throw error;
		throw new RelationReadError(
			error instanceof Error ? error.message : String(error),
			{ cause: error },
		);
	} finally {
		if (timer) clearTimeout(timer);
		controller.abort();
	}
}
