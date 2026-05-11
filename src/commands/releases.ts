import type { Command, OptionValues } from "commander";
import {
	CREATE_RELEASE_MUTATION,
	GET_RELEASE_BY_ID_QUERY,
	GET_RELEASE_PIPELINES_QUERY,
	GET_RELEASES_QUERY,
} from "../queries/releases.js";
import type {
	CreatedReleaseNode,
	CreateReleaseResponse,
	GetReleaseByIdResponse,
	GetReleasePipelinesResponse,
	GetReleasesResponse,
	ReleaseDetailNode,
	ReleaseListNode,
} from "../queries/releases-types.js";
import type { LinearRelease } from "../types/linear.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { parsePositiveInt } from "../utils/validators.js";

function transformRelease(
	release: ReleaseListNode | ReleaseDetailNode | CreatedReleaseNode,
): LinearRelease {
	// Lifecycle timestamps + dates only exist on the list/detail node shapes,
	// not on the create-mutation shape; read defensively rather than splitting
	// the function in two.
	const r = release as Partial<ReleaseListNode> & ReleaseListNode;
	const documents = (release as Partial<ReleaseDetailNode>).documents?.nodes;
	return {
		id: release.id,
		name: release.name,
		description: release.description ?? undefined,
		version: release.version ?? undefined,
		url: release.url ?? undefined,
		startDate: r.startDate ?? undefined,
		targetDate: r.targetDate ?? undefined,
		startedAt: r.startedAt ?? undefined,
		completedAt: r.completedAt ?? undefined,
		canceledAt: r.canceledAt ?? undefined,
		stage: release.stage
			? {
					id: release.stage.id,
					name: release.stage.name,
					type: release.stage.type,
				}
			: undefined,
		pipeline: release.pipeline
			? {
					id: release.pipeline.id,
					name: release.pipeline.name,
				}
			: undefined,
		documents: documents?.map((d) => ({
			id: d.id,
			title: d.title,
			slugId: d.slugId,
		})),
		createdAt: release.createdAt,
		updatedAt: release.updatedAt,
	};
}

async function handleCreateRelease(
	name: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);

	const pipelines =
		await graphQLService.rawRequest<GetReleasePipelinesResponse>(
			GET_RELEASE_PIPELINES_QUERY,
			{ first: 50 },
		);
	const pipelineNodes = pipelines.releasePipelines.nodes;
	const pipeline = pipelineNodes.find(
		(p) =>
			p.id === options.pipeline ||
			p.name.toLowerCase() === options.pipeline.toLowerCase(),
	);
	if (!pipeline) {
		const available = pipelineNodes.map((p) => p.name).join(", ");
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
		const stage = pipeline.stages.nodes.find(
			(s) =>
				s.id === options.stage ||
				s.name.toLowerCase() === options.stage.toLowerCase(),
		);
		if (stage) {
			input.stageId = stage.id;
		}
	}

	const result = await graphQLService.rawRequest<CreateReleaseResponse>(
		CREATE_RELEASE_MUTATION,
		{ input },
	);
	if (!result.releaseCreate.success || !result.releaseCreate.release) {
		throw new Error(`Failed to create release "${name}"`);
	}
	outputSuccess(transformRelease(result.releaseCreate.release));
}

export function setupReleasesCommands(program: Command): void {
	const releases = program
		.command("releases")
		.description("Release operations");
	releases.action(() => releases.help());

	releases
		.command("list")
		.description("List releases")
		.option("--pipeline <pipeline>", "filter by pipeline name or ID")
		.option("-l, --limit <number>", "limit results", "25")
		.action(
			handleAsyncCommand(async (options: OptionValues, command: Command) => {
				const rootOpts = getRootOpts(command);
				const graphQLService = await createGraphQLService(rootOpts);
				const filter: Record<string, unknown> = {};
				if (options.pipeline) {
					filter.pipeline = { name: { eqIgnoreCase: options.pipeline } };
				}
				const result = await graphQLService.rawRequest<GetReleasesResponse>(
					GET_RELEASES_QUERY,
					{
						first: parsePositiveInt(options.limit, "--limit"),
						filter: Object.keys(filter).length > 0 ? filter : undefined,
					},
				);
				const data = result.releases.nodes.map(transformRelease);
				outputSuccess({ data, meta: { count: data.length } });
			}),
		);

	releases
		.command("read <releaseId>")
		.description("Get release details including linked documents")
		.action(
			handleAsyncCommand(
				async (releaseId: string, _options: OptionValues, command: Command) => {
					const rootOpts = getRootOpts(command);
					const graphQLService = await createGraphQLService(rootOpts);
					const result =
						await graphQLService.rawRequest<GetReleaseByIdResponse>(
							GET_RELEASE_BY_ID_QUERY,
							{ id: releaseId },
						);
					if (!result.release) {
						throw new Error(`Release "${releaseId}" not found`);
					}
					outputSuccess(transformRelease(result.release));
				},
			),
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
				const rootOpts = getRootOpts(command);
				const graphQLService = await createGraphQLService(rootOpts);
				const result =
					await graphQLService.rawRequest<GetReleasePipelinesResponse>(
						GET_RELEASE_PIPELINES_QUERY,
						{ first: 50 },
					);
				const data = result.releasePipelines.nodes.map((p) => ({
					id: p.id,
					name: p.name,
					stages: p.stages.nodes.map((s) => ({
						id: s.id,
						name: s.name,
						type: s.type,
						color: s.color,
					})),
				}));
				outputSuccess({ data, meta: { count: data.length } });
			}),
		);
}
