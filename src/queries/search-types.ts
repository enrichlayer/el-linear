/**
 * Typed response shapes for `SEMANTIC_SEARCH_QUERY` and the inline
 * templates listing in `commands/search.ts`. See `./issues-types.ts`
 * for the rationale (ALL-937).
 */

export interface SearchIssueRef {
	id: string;
	identifier: string;
	title: string;
	priority: number | null;
	state: { id: string; name: string } | null;
	team: { id: string; key: string; name: string } | null;
	assignee: { id: string; name: string; url: string | null } | null;
	project: { id: string; name: string } | null;
}

export interface SearchProjectRef {
	id: string;
	name: string;
	state: string;
}

export interface SearchInitiativeRef {
	id: string;
	name: string;
	status: string | null;
}

export interface SearchDocumentRef {
	id: string;
	title: string;
	slugId: string | null;
	project: { id: string; name: string } | null;
}

/**
 * Mirrors a single semanticSearch result. The discriminator is `type`,
 * but Linear returns *all* sub-objects nullable per row — only the one
 * matching `type` is populated. Modelled as fully-optional sub-objects
 * to match runtime reality.
 */
export interface SemanticSearchResult {
	type: string;
	issue: SearchIssueRef | null;
	project: SearchProjectRef | null;
	initiative: SearchInitiativeRef | null;
	document: SearchDocumentRef | null;
}

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
