import type { Command, OptionValues } from "commander";
import {
  CREATE_RELEASE_MUTATION,
  GET_RELEASE_BY_ID_QUERY,
  GET_RELEASE_PIPELINES_QUERY,
  GET_RELEASES_QUERY,
} from "../queries/releases.js";
import type { GraphQLResponseData, LinearRelease } from "../types/linear.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

function transformRelease(release: GraphQLResponseData): LinearRelease {
  return {
    id: release.id as string,
    name: release.name as string,
    description: (release.description as string) || undefined,
    version: (release.version as string) || undefined,
    url: (release.url as string) || undefined,
    startDate: (release.startDate as string) || undefined,
    targetDate: (release.targetDate as string) || undefined,
    startedAt: (release.startedAt as string) || undefined,
    completedAt: (release.completedAt as string) || undefined,
    canceledAt: (release.canceledAt as string) || undefined,
    stage: release.stage
      ? {
          id: (release.stage as GraphQLResponseData).id as string,
          name: (release.stage as GraphQLResponseData).name as string,
          type: (release.stage as GraphQLResponseData).type as string,
        }
      : undefined,
    pipeline: release.pipeline
      ? {
          id: (release.pipeline as GraphQLResponseData).id as string,
          name: (release.pipeline as GraphQLResponseData).name as string,
        }
      : undefined,
    documents: (
      (release.documents as GraphQLResponseData)?.nodes as GraphQLResponseData[] | undefined
    )?.map((d: GraphQLResponseData) => ({
      id: d.id as string,
      title: d.title as string,
      slugId: d.slugId as string,
    })),
    createdAt: release.createdAt as string,
    updatedAt: release.updatedAt as string,
  };
}

async function handleCreateRelease(
  name: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);

  const pipelines = await graphQLService.rawRequest(GET_RELEASE_PIPELINES_QUERY, { first: 50 });
  const pipelineNodes = (pipelines.releasePipelines as GraphQLResponseData)?.nodes as
    | GraphQLResponseData[]
    | undefined;
  const pipeline = pipelineNodes?.find(
    (p: GraphQLResponseData) =>
      p.id === options.pipeline ||
      (p.name as string).toLowerCase() === options.pipeline.toLowerCase(),
  );
  if (!pipeline) {
    const available = (pipelineNodes ?? [])
      .map((p: GraphQLResponseData) => p.name as string)
      .join(", ");
    throw new Error(
      `Pipeline "${options.pipeline}" not found. Available: ${available || "none"}`,
    );
  }

  const input: Record<string, unknown> = { name, pipelineId: pipeline.id };
  if (options.description) {
    input.description = options.description;
  }
  if (options.version) {
    input.version = options.version;
  }
  if (options.stage) {
    const stageNodes = (pipeline.stages as GraphQLResponseData)?.nodes as
      | GraphQLResponseData[]
      | undefined;
    const stage = stageNodes?.find(
      (s: GraphQLResponseData) =>
        s.id === options.stage ||
        (s.name as string).toLowerCase() === options.stage.toLowerCase(),
    );
    if (stage) {
      input.stageId = stage.id;
    }
  }

  const result = await graphQLService.rawRequest(CREATE_RELEASE_MUTATION, { input });
  const releaseCreate = result.releaseCreate as GraphQLResponseData | undefined;
  if (!releaseCreate?.success) {
    throw new Error(`Failed to create release "${name}"`);
  }
  outputSuccess(transformRelease(releaseCreate.release as GraphQLResponseData));
}

export function setupReleasesCommands(program: Command): void {
  const releases = program.command("releases").description("Release operations");
  releases.action(() => releases.help());

  releases
    .command("list")
    .description("List releases")
    .option("--pipeline <pipeline>", "filter by pipeline name or ID")
    .option("-l, --limit <number>", "limit results", "25")
    .action(
      handleAsyncCommand(async (options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const graphQLService = createGraphQLService(rootOpts);
        const filter: Record<string, unknown> = {};
        if (options.pipeline) {
          filter.pipeline = { name: { eqIgnoreCase: options.pipeline } };
        }
        const result = await graphQLService.rawRequest(GET_RELEASES_QUERY, {
          first: Number.parseInt(options.limit, 10),
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        });
        const data = (
          ((result.releases as GraphQLResponseData)?.nodes as GraphQLResponseData[]) ?? []
        ).map(transformRelease);
        outputSuccess({ data, meta: { count: data.length } });
      }),
    );

  releases
    .command("read <releaseId>")
    .description("Get release details including linked documents")
    .action(
      handleAsyncCommand(async (releaseId: string, _options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const graphQLService = createGraphQLService(rootOpts);
        const result = await graphQLService.rawRequest(GET_RELEASE_BY_ID_QUERY, { id: releaseId });
        if (!result.release) {
          throw new Error(`Release "${releaseId}" not found`);
        }
        outputSuccess(transformRelease(result.release as GraphQLResponseData));
      }),
    );

  releases
    .command("create <name>")
    .description("Create a new release")
    .requiredOption("--pipeline <pipeline>", "pipeline name or ID")
    .option("-d, --description <desc>", "release description")
    .option("--version <version>", "version string")
    .option("--stage <stage>", "stage name or ID")
    .action(handleAsyncCommand(handleCreateRelease));

  releases
    .command("pipelines")
    .description("List release pipelines and their stages")
    .action(
      handleAsyncCommand(async (_options: OptionValues, command: Command) => {
        const rootOpts = command.parent!.parent!.opts();
        const graphQLService = createGraphQLService(rootOpts);
        const result = await graphQLService.rawRequest(GET_RELEASE_PIPELINES_QUERY, { first: 50 });
        const data = (
          ((result.releasePipelines as GraphQLResponseData)?.nodes as GraphQLResponseData[]) ?? []
        ).map((p: GraphQLResponseData) => ({
          id: p.id,
          name: p.name,
          stages: (((p.stages as GraphQLResponseData)?.nodes as GraphQLResponseData[]) ?? []).map(
            (s: GraphQLResponseData) => ({
              id: s.id,
              name: s.name,
              type: s.type,
              color: s.color,
            }),
          ),
        }));
        outputSuccess({ data, meta: { count: data.length } });
      }),
    );
}
