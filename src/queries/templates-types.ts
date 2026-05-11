/**
 * Typed response shapes for the queries in `./templates.ts`.
 * See `./issues-types.ts` for the rationale (ALL-937).
 *
 * Note: `templates` is unusual — it returns the array directly rather
 * than wrapped in `{ nodes: ... }`. The response type below mirrors
 * what the API actually returns, not the connection convention.
 */

interface TemplateTeamRef {
	id: string;
	key: string;
	name: string;
}

interface TemplateCreatorRef {
	id: string;
	name: string;
}

/**
 * Mirrors the template selection set used by `TEMPLATES_LIST_QUERY` /
 * `TEMPLATE_BY_ID_QUERY` / `TEMPLATE_CREATE_MUTATION` /
 * `TEMPLATE_UPDATE_MUTATION`. (Some of those omit `creator` and
 * `createdAt`; we model the union — consumers only read what their
 * query selected.)
 */
export interface TemplateNode {
	id: string;
	name: string;
	type: string;
	description: string | null;
	templateData: unknown;
	createdAt: string;
	updatedAt: string;
	team: TemplateTeamRef | null;
	creator: TemplateCreatorRef | null;
}

export interface TemplatesListResponse {
	templates: TemplateNode[];
}

export interface GetTemplateResponse {
	template: TemplateNode | null;
}

export interface CreateTemplateResponse {
	templateCreate: {
		success: boolean;
		lastSyncId?: number;
		template: TemplateNode | null;
	};
}

export interface UpdateTemplateResponse {
	templateUpdate: {
		success: boolean;
		lastSyncId?: number;
		template: TemplateNode | null;
	};
}

export interface DeleteTemplateResponse {
	templateDelete: {
		success: boolean;
		lastSyncId?: number;
	};
}
