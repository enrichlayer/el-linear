import type { Command, OptionValues } from "commander";
import { resolveTeam, resolveUserDisplayName } from "../config/resolver.js";
import { SEMANTIC_SEARCH_QUERY } from "../queries/search.js";
import type { GraphQLResponseData } from "../types/linear.js";
import type { GraphQLService } from "../utils/graphql-service.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

const TEMPLATES_QUERY = `
  query {
    templates {
      id
      name
      type
      description
      team { key }
      creator { name }
    }
  }
`;

const VALID_TYPES = new Set([
	"issue",
	"project",
	"initiative",
	"document",
	"template",
]);
const WHITESPACE_RE = /\s+/;

function transformSearchResult(
	r: GraphQLResponseData,
): Record<string, unknown> {
	const rType = r.type as string;
	switch (rType) {
		case "issue": {
			const issue = r.issue as GraphQLResponseData | undefined;
			const state = issue?.state as GraphQLResponseData | undefined;
			const team = issue?.team as GraphQLResponseData | undefined;
			const assignee = issue?.assignee as GraphQLResponseData | undefined;
			const project = issue?.project as GraphQLResponseData | undefined;
			return {
				type: "issue",
				identifier: issue?.identifier as string | undefined,
				title: issue?.title as string | undefined,
				state: state?.name as string | undefined,
				team: team?.key as string | undefined,
				assignee: assignee
					? resolveUserDisplayName(
							assignee.id as string,
							assignee.name as string,
						)
					: undefined,
				priority: issue?.priority as number | undefined,
				project: project?.name as string | undefined,
				id: issue?.id as string | undefined,
			};
		}
		case "project": {
			const project = r.project as GraphQLResponseData | undefined;
			return {
				type: "project",
				name: project?.name as string | undefined,
				state: project?.state as string | undefined,
				id: project?.id as string | undefined,
			};
		}
		case "initiative": {
			const initiative = r.initiative as GraphQLResponseData | undefined;
			return {
				type: "initiative",
				name: initiative?.name as string | undefined,
				status: initiative?.status as string | undefined,
				id: initiative?.id as string | undefined,
			};
		}
		case "document": {
			const doc = r.document as GraphQLResponseData | undefined;
			const docProject = doc?.project as GraphQLResponseData | undefined;
			return {
				type: "document",
				title: doc?.title as string | undefined,
				project: docProject?.name as string | undefined,
				slugId: doc?.slugId as string | undefined,
				id: doc?.id as string | undefined,
			};
		}
		default:
			return { type: rType, id: null };
	}
}

interface TemplateNode {
	creator: { name: string } | null;
	description: string | null;
	id: string;
	name: string;
	team: { key: string } | null;
	type: string;
}

function matchesQuery(name: string, query: string): boolean {
	const lower = name.toLowerCase();
	const terms = query.toLowerCase().split(WHITESPACE_RE);
	return terms.every((term) => lower.includes(term));
}

function searchTemplates(
	templates: TemplateNode[],
	query: string,
): Record<string, unknown>[] {
	return templates
		.filter(
			(t) =>
				matchesQuery(t.name, query) ||
				(t.description && matchesQuery(t.description, query)),
		)
		.map((t) => ({
			type: "template",
			name: t.name,
			templateType: t.type,
			team: t.team?.key ?? null,
			creator: t.creator?.name ?? null,
			id: t.id,
		}));
}

function validateTypes(requestedTypes: string[]): void {
	for (const t of requestedTypes) {
		if (!VALID_TYPES.has(t)) {
			throw new Error(
				`Invalid type "${t}". Valid types: ${[...VALID_TYPES].join(", ")}`,
			);
		}
	}
}

function parseTypeFilters(requestedTypes: string[] | null) {
	const onlyTemplates =
		requestedTypes?.length === 1 && requestedTypes[0] === "template";
	const includeTemplates =
		!requestedTypes || requestedTypes.includes("template");
	const includeSemanticTypes =
		!requestedTypes || requestedTypes.some((t: string) => t !== "template");
	return { onlyTemplates, includeTemplates, includeSemanticTypes };
}

function buildSemanticQuery(
	graphQLService: GraphQLService,
	query: string,
	limit: number,
	teamOption: string | undefined,
): Promise<GraphQLResponseData | null> {
	const filters: Record<string, unknown> = {};
	if (teamOption) {
		filters.issues = { team: { id: { eq: resolveTeam(teamOption) } } };
	}
	return graphQLService.rawRequest(SEMANTIC_SEARCH_QUERY, {
		query,
		maxResults: limit,
		filters: Object.keys(filters).length > 0 ? filters : undefined,
	});
}

function extractSemanticResults(
	semanticResult: GraphQLResponseData,
	requestedTypes: string[] | null,
	onlyTemplates: boolean,
): Record<string, unknown>[] {
	const semanticSearch = semanticResult.semanticSearch as
		| GraphQLResponseData
		| undefined;
	let results: GraphQLResponseData[] =
		(semanticSearch?.results as GraphQLResponseData[] | undefined) ?? [];

	if (requestedTypes && !onlyTemplates) {
		const semanticTypes = requestedTypes.filter(
			(t: string) => t !== "template",
		);
		results = results.filter((r: GraphQLResponseData) =>
			semanticTypes.includes(r.type as string),
		);
	}

	return results.map(transformSearchResult);
}

export function setupSearchCommands(program: Command): void {
	program
		.command("search <query>")
		.description(
			"Natural language search across issues, projects, initiatives, documents, and templates.",
		)
		.option(
			"--type <types>",
			"filter by type (comma-separated: issue,project,initiative,document,template)",
		)
		.option("--team <team>", "filter issue results by team key")
		.option("-l, --limit <number>", "max results", "10")
		.action(
			handleAsyncCommand(
				async (query: string, options: OptionValues, command: Command) => {
					const rootOpts = command.parent!.opts();
					const graphQLService = createGraphQLService(rootOpts);
					const limit = Number.parseInt(options.limit, 10);

					const requestedTypes = options.type
						? options.type.split(",").map((t: string) => t.trim().toLowerCase())
						: null;

					if (requestedTypes) {
						validateTypes(requestedTypes);
					}

					const { onlyTemplates, includeTemplates, includeSemanticTypes } =
						parseTypeFilters(requestedTypes);

					const [semanticResult, templateResult] = await Promise.all([
						includeSemanticTypes
							? buildSemanticQuery(graphQLService, query, limit, options.team)
							: null,
						includeTemplates
							? graphQLService.rawRequest(TEMPLATES_QUERY)
							: null,
					]);

					let data: Record<string, unknown>[] = [];

					if (semanticResult) {
						data = extractSemanticResults(
							semanticResult,
							requestedTypes,
							onlyTemplates ?? false,
						);
					}

					if (templateResult) {
						const templates =
							(templateResult.templates as unknown as TemplateNode[]) ?? [];
						data = [...data, ...searchTemplates(templates, query)];
					}

					outputSuccess({
						data: data.slice(0, limit),
						meta: { count: Math.min(data.length, limit), query },
					});
				},
			),
		);
}
