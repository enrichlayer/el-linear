import { readFileSync } from "node:fs";
import type { Command, OptionValues } from "commander";
import {
	TEMPLATE_BY_ID_QUERY,
	TEMPLATE_CREATE_MUTATION,
	TEMPLATE_DELETE_MUTATION,
	TEMPLATE_UPDATE_MUTATION,
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

	templates
		.command("create")
		.description("Create a new issue / document / project template")
		.requiredOption(
			"--type <type>",
			"template kind (issue, document, project, recurringIssue)",
		)
		.requiredOption("--name <name>", "template display name")
		.requiredOption(
			"--team-id <id>",
			"team id (UUID) the template belongs to. See `el-linear teams list`",
		)
		.option("--description <text>", "description shown in the template picker")
		.option(
			"--data <json>",
			"templateData as a JSON string (typically { title, description, labelIds, priority })",
		)
		.option(
			"--data-file <path>",
			"templateData read from a JSON file. Mutually exclusive with --data",
		)
		.option("--icon <name>", "Lucide icon name shown in the picker")
		.option("--color <hex>", "color (hex) for the template badge")
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const graphQLService = await createGraphQLService(rootOpts);

				const templateData = parseTemplateData(options);
				const input: Record<string, unknown> = {
					type: options.type,
					name: options.name,
					teamId: options.teamId,
				};
				if (options.description) input.description = options.description;
				if (templateData !== undefined) input.templateData = templateData;
				if (options.icon) input.icon = options.icon;
				if (options.color) input.color = options.color;

				const result = await graphQLService.rawRequest(
					TEMPLATE_CREATE_MUTATION,
					{ input },
				);
				const payload = result.templateCreate as unknown as {
					success: boolean;
					template: TemplateResult;
				};
				if (!payload?.success) {
					throw new Error("templateCreate returned success=false");
				}
				outputSuccess(payload.template);
			}),
		);

	templates
		.command("update <templateId>")
		.description(
			"Update a template's name, description, templateData, icon, or color",
		)
		.option("--name <name>", "new display name")
		.option("--description <text>", "new description")
		.option("--data <json>", "new templateData as a JSON string")
		.option("--data-file <path>", "new templateData read from a JSON file")
		.option("--icon <name>", "Lucide icon name")
		.option("--color <hex>", "color (hex)")
		.option("--team-id <id>", "move the template to a different team")
		.action(
			handleAsyncCommand(
				async (templateId: string, options: OptionValues, command: Command) => {
					const rootOpts = getRootOpts(command);
					const graphQLService = await createGraphQLService(rootOpts);

					const input: Record<string, unknown> = {};
					if (options.name) input.name = options.name;
					if (options.description !== undefined) {
						input.description = options.description;
					}
					const templateData = parseTemplateData(options);
					if (templateData !== undefined) input.templateData = templateData;
					if (options.icon) input.icon = options.icon;
					if (options.color) input.color = options.color;
					if (options.teamId) input.teamId = options.teamId;

					if (Object.keys(input).length === 0) {
						throw new Error(
							"templates update: at least one of --name, --description, --data, --data-file, --icon, --color, --team-id is required",
						);
					}

					const result = await graphQLService.rawRequest(
						TEMPLATE_UPDATE_MUTATION,
						{ id: templateId, input },
					);
					const payload = result.templateUpdate as unknown as {
						success: boolean;
						template: TemplateResult;
					};
					if (!payload?.success) {
						throw new Error("templateUpdate returned success=false");
					}
					outputSuccess(payload.template);
				},
			),
		);

	templates
		.command("delete <templateId>")
		.description("Delete a template (cannot be undone)")
		.action(
			handleAsyncCommand(
				async (
					templateId: string,
					_options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const graphQLService = await createGraphQLService(rootOpts);
					const result = await graphQLService.rawRequest(
						TEMPLATE_DELETE_MUTATION,
						{ id: templateId },
					);
					const payload = result.templateDelete as unknown as {
						success: boolean;
					};
					if (!payload?.success) {
						throw new Error("templateDelete returned success=false");
					}
					outputSuccess({ id: templateId, deleted: true });
				},
			),
		);
}

/**
 * Resolve `--data <json>` or `--data-file <path>` into the parsed
 * templateData object. Returns undefined when neither flag was set
 * so the caller can omit the field from the input object.
 */
function parseTemplateData(options: OptionValues): unknown {
	if (options.data && options.dataFile) {
		throw new Error("Pass either --data or --data-file, not both");
	}
	if (options.data) {
		try {
			return JSON.parse(options.data as string);
		} catch (err) {
			throw new Error(
				`--data is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	if (options.dataFile) {
		const raw = readFileSync(options.dataFile as string, "utf8");
		try {
			return JSON.parse(raw);
		} catch (err) {
			throw new Error(
				`--data-file ${String(options.dataFile)} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	return undefined;
}
