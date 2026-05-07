import type { Command, OptionValues } from "commander";
import {
	TEMPLATE_BY_ID_QUERY,
	TEMPLATES_LIST_QUERY,
} from "../queries/templates.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

interface TemplateResult {
	createdAt: string;
	creator: { id: string; name: string } | null;
	description: string | null;
	id: string;
	name: string;
	team: { id: string; key: string; name: string } | null;
	templateData: unknown;
	type: string;
	updatedAt: string;
}

function formatTemplateSummary(t: TemplateResult): Record<string, unknown> {
	return {
		id: t.id,
		name: t.name,
		type: t.type,
		description: t.description,
		team: t.team?.key ?? null,
		creator: t.creator?.name ?? null,
		updatedAt: t.updatedAt,
	};
}

export function setupTemplatesCommands(program: Command): void {
	const templates = program
		.command("templates")
		.description(
			"Template operations (issue, document, and project templates)",
		);
	templates.action(() => templates.help());

	templates
		.command("list")
		.alias("ls")
		.description("List all templates")
		.option(
			"--type <type>",
			"filter by type (issue, document, project, recurringIssue)",
		)
		.option("-l, --limit <number>", "limit results", "50")
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const graphQLService = await createGraphQLService(rootOpts);
				const limit = parsePositiveInt(options.limit, "--limit");
				const result = await graphQLService.rawRequest(TEMPLATES_LIST_QUERY);
				let items = (result.templates as unknown as TemplateResult[]) ?? [];

				if (options.type) {
					const filterType = options.type.toLowerCase();
					items = items.filter((t) => t.type.toLowerCase() === filterType);
				}

				items = items.slice(0, limit);

				outputSuccess({
					data: items.map(formatTemplateSummary),
					meta: { count: items.length },
				});
			}),
		);

	templates
		.command("read <templateId>")
		.description("Read a template including its full content (templateData)")
		.action(
			handleAsyncCommand(
				async (
					templateId: string,
					_options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const graphQLService = await createGraphQLService(rootOpts);
					const result = await graphQLService.rawRequest(TEMPLATE_BY_ID_QUERY, {
						id: templateId,
					});
					const template = result.template as unknown as
						| TemplateResult
						| undefined;
					if (!template) {
						throw new Error(`Template "${templateId}" not found`);
					}
					outputSuccess(template);
				},
			),
		);
}
