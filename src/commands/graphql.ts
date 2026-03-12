import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Command, OptionValues } from "commander";
import { INTROSPECT_ROOT_QUERY, INTROSPECT_TYPE_QUERY } from "../queries/introspect.js";
import type { GraphQLResponseData } from "../types/linear.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

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

  const rootOpts = command.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const result = await graphQLService.rawRequest(finalQuery, variables);

  if (options.jq) {
    const json = JSON.stringify(result);
    // Normalize common shell-escape artifacts that Claude generates:
    // \!= → != (zsh history expansion escaping leaks into jq filters)
    const filter = options.jq.replace(/\\!/g, "!");
    try {
      const output = execFileSync("jq", ["-r", filter], {
        input: json,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      process.stdout.write(output);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`jq filter failed: ${msg}`);
    }
  } else {
    outputSuccess(result);
  }
}

export function setupGraphQLCommands(program: Command): void {
  // Primary command: el-linear graphql '{ ... }' (backward compatible)
  program
    .command("graphql [query]")
    .description("Execute a raw GraphQL query against the Linear API.")
    .option("--file <path>", "read query from a file")
    .option("--variables <json>", "JSON string of variables")
    .option("--jq <filter>", "apply a jq filter to the output (avoids shell escaping issues)")
    .action(handleAsyncCommand(executeQuery));

  // Separate introspect command
  program
    .command("introspect [typeName]")
    .description(
      "Introspect the Linear GraphQL schema. Without args lists root query fields; with a type name shows its fields and args.",
    )
    .option("--filter <pattern>", "filter fields by name (case-insensitive substring match)")
    .action(
      handleAsyncCommand(
        async (typeName: string | undefined, options: OptionValues, command: Command) => {
          const rootOpts = command.parent!.opts();
          const graphQLService = createGraphQLService(rootOpts);

          if (typeName) {
            const result = await graphQLService.rawRequest(INTROSPECT_TYPE_QUERY, { typeName });
            const typeInfo = result.__type as GraphQLResponseData | undefined;
            if (!typeInfo) {
              throw new Error(`Type "${typeName}" not found in schema`);
            }
            outputSuccess(typeInfo);
          } else {
            const result = await graphQLService.rawRequest(INTROSPECT_ROOT_QUERY);
            const queryType = result.__type as GraphQLResponseData | undefined;
            let fields = (queryType?.fields as GraphQLResponseData[] | undefined) ?? [];

            if (options.filter) {
              const pattern = options.filter.toLowerCase();
              fields = fields.filter((f) =>
                (f.name as string).toLowerCase().includes(pattern),
              );
            }

            const summary = fields.map((f) => ({
              name: f.name,
              description: f.description ?? null,
              args: ((f.args as GraphQLResponseData[] | undefined) ?? []).map((a) => a.name),
            }));
            outputSuccess({ fields: summary, count: summary.length });
          }
        },
      ),
    );
}
