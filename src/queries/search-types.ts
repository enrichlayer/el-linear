/**
 * Typed response shapes for `SEMANTIC_SEARCH_QUERY` and the inline
 * templates listing in `commands/search.ts`. See `./issues-types.ts`
 * for the rationale (ALL-937).
 */

import type { LinearPriority } from "../types/linear.js";

interface SearchIssueRef {
	id: string;
	identifier: string;
	title: string;
	priority: LinearPriority | null;
	state: { id: string; name: string } | null;
	team: { id: string; key: string; name: string } | null;
	assignee: { id: string; name: string; url: string | null } | null;
	project: { id: string; name: string } | null;
}

interface SearchProjectRef {
	id: string;
	name: string;
	state: string;
}

interface SearchInitiativeRef {
	id: string;
	name: string;
	status: string | null;
}

interface SearchDocumentRef {
	id: string;
	title: string;
	slugId: string | null;
	project: { id: string; name: string } | null;
}

/**
 * A single semanticSearch result. Discriminated union on `type` — given
 * a row, only the field named by `type` is meaningful (the other three
 * are absent / null on the wire). Consumers `switch (r.type)` and access
 * the corresponding payload directly; the compiler statically rejects
 * cross-arm access like `r.project` in a `case "issue"` branch.
 *
 * The payload itself is `| null` because Linear can return null when
 * the underlying entity was deleted between indexing and query time —
 * that's an orthogonal concern from the discriminant.
 *
 * The four `type` literals match Linear's `semanticSearch.results.type`
 * enum verbatim — keep in lock-step with the GraphQL schema's enum.
 */
export type SemanticSearchResult =
	| { type: "issue"; issue: SearchIssueRef | null }
	| { type: "project"; project: SearchProjectRef | null }
	| { type: "initiative"; initiative: SearchInitiativeRef | null }
	| { type: "document"; document: SearchDocumentRef | null };

export interface SemanticSearchResponse {
	semanticSearch: {
		results: SemanticSearchResult[];
	} | null;
}

/**
 * Mirrors the inline `TEMPLATES_QUERY` in `commands/search.ts` —
 * a smaller selection set than the full templates query, dropping
 * fields the search command doesn't display.
 */
export interface SearchTemplateNode {
	id: string;
	name: string;
	type: string;
	description: string | null;
	team: { key: string } | null;
	creator: { name: string } | null;
}

export interface SearchTemplatesResponse {
	templates: SearchTemplateNode[];
}
