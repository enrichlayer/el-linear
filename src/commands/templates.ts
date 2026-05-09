import { readFileSync } from "node:fs";
import type { Command, OptionValues } from "commander";
import {
	TEMPLATE_BY_ID_QUERY,
	TEMPLATE_CREATE_MUTATION,
	TEMPLATE_DELETE_MUTATION,
	TEMPLATE_UPDATE_MUTATION,
	TEMPLATES_LIST_QUERY,
} from "../queries/templates.js";
import type {
	CreateTemplateResponse,
	DeleteTemplateResponse,
	GetTemplateResponse,
	TemplateNode,
	TemplatesListResponse,
	UpdateTemplateResponse,
} from "../queries/templates-types.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

function formatTemplateSummary(t: TemplateNode): Record<string, unknown> {
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
				const result =
					await graphQLService.rawRequest<TemplatesListResponse>(
						TEMPLATES_LIST_QUERY,
					);
				let items = result.templates ?? [];

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
					const result = await graphQLService.rawRequest<GetTemplateResponse>(
						TEMPLATE_BY_ID_QUERY,
						{ id: templateId },
					);
					if (!result.template) {
						throw new Error(`Template "${templateId}" not found`);
					}
					outputSuccess(result.template);
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
			"templateData read from a JSON file (relative path). Mutually exclusive with --data",
		)
		.option(
			"--allow-absolute",
			"allow --data-file to read absolute or `..`-traversing paths (file contents are sent to Linear's API)",
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

				const result = await graphQLService.rawRequest<CreateTemplateResponse>(
					TEMPLATE_CREATE_MUTATION,
					{ input },
				);
				if (!result.templateCreate.success || !result.templateCreate.template) {
					throw new Error("templateCreate returned success=false");
				}
				outputSuccess(result.templateCreate.template);
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
		.option(
			"--data-file <path>",
			"new templateData read from a JSON file (relative path)",
		)
		.option(
			"--allow-absolute",
			"allow --data-file to read absolute or `..`-traversing paths",
		)
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

					const result =
						await graphQLService.rawRequest<UpdateTemplateResponse>(
							TEMPLATE_UPDATE_MUTATION,
							{ id: templateId, input },
						);
					if (
						!result.templateUpdate.success ||
						!result.templateUpdate.template
					) {
						throw new Error("templateUpdate returned success=false");
					}
					outputSuccess(result.templateUpdate.template);
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
					const result =
						await graphQLService.rawRequest<DeleteTemplateResponse>(
							TEMPLATE_DELETE_MUTATION,
							{ id: templateId },
						);
					if (!result.templateDelete.success) {
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
		const dataFile = String(options.dataFile);
		// Reject absolute paths and `..` traversal unless explicitly
		// allowed. CI invocations or scripted callers can pass an
		// attacker-controlled path otherwise (e.g. `~/.aws/credentials.json`,
		// `/etc/passwd`) and have its contents flow into Linear's API
		// via the `templateData` field.
		if (!options.allowAbsolute && /^(\/|\.\.\/|\.\.\\)/.test(dataFile)) {
			throw new Error(
				`--data-file ${dataFile} resolves outside the current directory. Pass --allow-absolute to opt in (sends file contents to Linear's API).`,
			);
		}
		const raw = readFileSync(dataFile, "utf8");
		try {
			return JSON.parse(raw);
		} catch (err) {
			throw new Error(
				`--data-file ${dataFile} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	return undefined;
}
