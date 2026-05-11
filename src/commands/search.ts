import type { Command, OptionValues } from "commander";
import { resolveTeam, resolveUserDisplayName } from "../config/resolver.js";
import { SEMANTIC_SEARCH_QUERY } from "../queries/search.js";
import type {
	SearchTemplateNode,
	SearchTemplatesResponse,
	SemanticSearchResponse,
	SemanticSearchResult,
} from "../queries/search-types.js";
import type { GraphQLService } from "../utils/graphql-service.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

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
	r: SemanticSearchResult,
): Record<string, unknown> {
	switch (r.type) {
		case "issue": {
			const issue = r.issue;
			return {
				type: "issue",
				identifier: issue?.identifier,
				title: issue?.title,
				state: issue?.state?.name,
				team: issue?.team?.key,
				assignee: issue?.assignee
					? resolveUserDisplayName(issue.assignee.id, issue.assignee.name)
					: undefined,
				priority: issue?.priority ?? undefined,
				project: issue?.project?.name,
				id: issue?.id,
			};
		}
		case "project": {
			return {
				type: "project",
				name: r.project?.name,
				state: r.project?.state,
				id: r.project?.id,
			};
		}
		case "initiative": {
			return {
				type: "initiative",
				name: r.initiative?.name,
				status: r.initiative?.status ?? undefined,
				id: r.initiative?.id,
			};
		}
		case "document": {
			return {
				type: "document",
				title: r.document?.title,
				project: r.document?.project?.name,
				slugId: r.document?.slugId ?? undefined,
				id: r.document?.id,
			};
		}
		default:
			return { type: r.type, id: null };
	}
}

function matchesQuery(name: string, query: string): boolean {
	const lower = name.toLowerCase();
	const terms = query.toLowerCase().split(WHITESPACE_RE);
	return terms.every((term) => lower.includes(term));
}

function searchTemplates(
	templates: SearchTemplateNode[],
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
): Promise<SemanticSearchResponse> {
	const filters: Record<string, unknown> = {};
	if (teamOption) {
		filters.issues = { team: { id: { eq: resolveTeam(teamOption) } } };
	}
	return graphQLService.rawRequest<SemanticSearchResponse>(
		SEMANTIC_SEARCH_QUERY,
		{
			query,
			maxResults: limit,
			filters: Object.keys(filters).length > 0 ? filters : undefined,
		},
	);
}

function extractSemanticResults(
	semanticResult: SemanticSearchResponse,
	requestedTypes: string[] | null,
	onlyTemplates: boolean,
): Record<string, unknown>[] {
	let results = semanticResult.semanticSearch?.results ?? [];

	if (requestedTypes && !onlyTemplates) {
		const semanticTypes = requestedTypes.filter((t) => t !== "template");
		results = results.filter((r) => semanticTypes.includes(r.type));
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
					const rootOpts = getRootOpts(command);
					const graphQLService = await createGraphQLService(rootOpts);
					const limit = parsePositiveInt(options.limit, "--limit");

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
							? graphQLService.rawRequest<SearchTemplatesResponse>(
									TEMPLATES_QUERY,
								)
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
						const templates = templateResult.templates ?? [];
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
