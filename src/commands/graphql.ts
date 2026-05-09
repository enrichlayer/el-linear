import fs from "node:fs";
import type { Command, OptionValues } from "commander";
import {
	INTROSPECT_ROOT_QUERY,
	INTROSPECT_TYPE_QUERY,
} from "../queries/introspect.js";
import type {
	IntrospectRootResponse,
	IntrospectTypeResponse,
} from "../queries/introspect-types.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";

async function executeQuery(
	query: string | undefined,
	options: OptionValues,
	command: Command,
): Promise<void> {
	let finalQuery = query;

	if (options.file) {
		if (!fs.existsSync(options.file)) {
			throw new Error(`File not found: ${options.file}`);
		}
		finalQuery = fs.readFileSync(options.file, "utf8").trim();
	}

	if (!finalQuery) {
		throw new Error("Provide a GraphQL query as an argument or via --file");
	}

	let variables: Record<string, unknown> | undefined;
	if (options.variables) {
		try {
			variables = JSON.parse(options.variables);
		} catch {
			throw new Error(`Invalid JSON in --variables: ${options.variables}`);
		}
	}

	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const result = await graphQLService.rawRequest(finalQuery, variables);

	outputSuccess(result);
}

export function setupGraphQLCommands(program: Command): void {
	// Primary command: el-linear graphql '{ ... }' (backward compatible)
	program
		.command("graphql [query]")
		.description("Execute a raw GraphQL query against the Linear API.")
		.option("--file <path>", "read query from a file")
		.option("--variables <json>", "JSON string of variables")
		.action(handleAsyncCommand(executeQuery));

	// Separate introspect command
	program
		.command("introspect [typeName]")
		.description(
			"Introspect the Linear GraphQL schema. Without args lists root query fields; with a type name shows its fields and args.",
		)
		.option(
			"--filter <pattern>",
			"filter fields by name (case-insensitive substring match)",
		)
		.action(
			handleAsyncCommand(
				async (
					typeName: string | undefined,
					options: OptionValues,
					command: Command,
				) => {
					const rootOpts = getRootOpts(command);
					const graphQLService = await createGraphQLService(rootOpts);

					if (typeName) {
						const result =
							await graphQLService.rawRequest<IntrospectTypeResponse>(
								INTROSPECT_TYPE_QUERY,
								{ typeName },
							);
						if (!result.__type) {
							throw new Error(`Type "${typeName}" not found in schema`);
						}
						outputSuccess(result.__type);
					} else {
						const result =
							await graphQLService.rawRequest<IntrospectRootResponse>(
								INTROSPECT_ROOT_QUERY,
							);
						let fields = result.__type?.fields ?? [];

						if (options.filter) {
							const pattern = options.filter.toLowerCase();
							fields = fields.filter((f) =>
								f.name.toLowerCase().includes(pattern),
							);
						}

						const summary = fields.map((f) => ({
							name: f.name,
							description: f.description ?? null,
							args: f.args.map((a) => a.name),
						}));
						outputSuccess({ fields: summary, count: summary.length });
					}
				},
			),
		);
}
