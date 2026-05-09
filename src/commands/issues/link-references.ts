/**
 * `el-linear issues link-references` handler.
 *
 * Two modes:
 *   - Single-issue (`<issueId>`): scan one issue's description (and
 *     optionally its comments) for issue refs, create sidebar
 *     relations for any that aren't already linked, optionally
 *     rewrite the description to wrap the bare refs as markdown
 *     links.
 *   - Batch (`--team <key>`): walk the team's recent issues and run
 *     the same auto-link pass on each. Description rewrite is
 *     intentionally disabled in batch mode — bulk rewrites
 *     bot-author every issue's revision history, which makes
 *     "who edited this?" attribution noisy.
 *
 * Extracted from `commands/issues.ts` (ALL-938) so that file can
 * focus on commander wiring + the create / update / read / search
 * handlers.
 */

import type { Command, OptionValues } from "commander";
import { resolveTeam } from "../../config/resolver.js";
import { LIST_COMMENTS_QUERY } from "../../queries/comments.js";
import type { ListCommentsResponse } from "../../queries/comments-types.js";
import {
	GET_ISSUE_RELATIONS_QUERY,
	SCAN_ISSUES_QUERY,
} from "../../queries/issues.js";
import type { GraphQLResponseData } from "../../types/linear.js";
import {
	type AutoLinkResult,
	autoLinkReferences,
} from "../../utils/auto-link-references.js";
import {
	createGraphQLService,
	type GraphQLService,
} from "../../utils/graphql-service.js";
import {
	createLinearService,
	type LinearService,
} from "../../utils/linear-service.js";
import { outputSuccess } from "../../utils/output.js";
import { getRootOpts } from "../../utils/root-opts.js";
import {
	prepareDescriptionRewrite,
	pushDescriptionUpdate,
} from "./description.js";

async function fetchCommentBodies(
	issueUuid: string,
	graphQLService: GraphQLService,
): Promise<string[]> {
	const result = await graphQLService.rawRequest<ListCommentsResponse>(
		LIST_COMMENTS_QUERY,
		{
			issueId: issueUuid,
			first: 250,
		},
	);
	const nodes = result.issue?.comments.nodes ?? [];
	return nodes.map((c) => c.body).filter((b) => b.length > 0);
}

async function linkReferencesForIssue(args: {
	issueUuid: string;
	identifier: string;
	description: string;
	includeComments: boolean;
	dryRun: boolean;
	graphQLService: GraphQLService;
	linearService: LinearService;
	preResolved?: Map<string, string>;
}): Promise<AutoLinkResult> {
	const comments = args.includeComments
		? await fetchCommentBodies(args.issueUuid, args.graphQLService)
		: undefined;
	return autoLinkReferences({
		issueId: args.issueUuid,
		identifier: args.identifier,
		description: args.description,
		comments,
		dryRun: args.dryRun,
		graphQLService: args.graphQLService,
		linearService: args.linearService,
		preResolved: args.preResolved,
	});
}

async function handleLinkReferencesSingle(
	issueId: string,
	options: OptionValues,
	graphQLService: GraphQLService,
	linearService: LinearService,
): Promise<void> {
	const resolvedId = await linearService.resolveIssueId(issueId);
	// GET_ISSUE_RELATIONS_QUERY also returns description, so this single call gives us everything
	// we need for the description-only path. Comments are fetched separately on demand.
	const issueResult = await graphQLService.rawRequest(
		GET_ISSUE_RELATIONS_QUERY,
		{
			id: resolvedId,
		},
	);
	if (!issueResult.issue) {
		throw new Error(`Issue "${issueId}" not found`);
	}
	const issue = issueResult.issue as GraphQLResponseData;
	const identifier = issue.identifier as string;
	const description = (issue.description as string | null | undefined) ?? "";

	const dryRun = Boolean(options.dryRun);
	const includeComments = Boolean(options.includeComments);
	const rewriteDescription = Boolean(options.rewriteDescription);

	// If rewriting, validate refs once up front so we can both wrap the description and
	// pass the resolved map down to autoLink — avoids a second resolve round trip.
	const rewrite = rewriteDescription
		? await prepareDescriptionRewrite(
				description,
				identifier,
				linearService,
				graphQLService,
			)
		: { preResolved: undefined, wrapped: undefined };

	const autoLinked = await linkReferencesForIssue({
		issueUuid: resolvedId,
		identifier,
		description,
		includeComments,
		dryRun,
		graphQLService,
		linearService,
		preResolved: rewrite.preResolved,
	});

	let descriptionRewritten = false;
	if (rewriteDescription && rewrite.wrapped && !dryRun) {
		await pushDescriptionUpdate(resolvedId, rewrite.wrapped, graphQLService);
		descriptionRewritten = true;
	}

	outputSuccess({
		id: resolvedId,
		identifier,
		title: issue.title as string,
		autoLinked,
		...(rewriteDescription
			? {
					descriptionRewritten,
					...(dryRun && rewrite.wrapped
						? { descriptionPreview: rewrite.wrapped }
						: {}),
				}
			: {}),
		meta: {
			dryRun,
			includeComments,
			...(rewriteDescription ? { rewriteDescription: true } : {}),
		},
	});
}

interface BatchEntry {
	autoLinked: AutoLinkResult;
	identifier: string;
}

async function handleLinkReferencesBatch(
	teamInput: string,
	options: OptionValues,
	graphQLService: GraphQLService,
	linearService: LinearService,
): Promise<void> {
	const teamId = resolveTeam(teamInput);
	const limit = options.limit
		? Number.parseInt(options.limit as string, 10)
		: 100;
	if (!Number.isFinite(limit) || limit <= 0) {
		throw new Error(
			`--limit must be a positive integer, got: ${options.limit}`,
		);
	}

	const dryRun = Boolean(options.dryRun);
	const includeComments = Boolean(options.includeComments);

	const scan = await graphQLService.rawRequest(SCAN_ISSUES_QUERY, {
		filter: { team: { id: { eq: teamId } } },
		first: limit,
	});
	const issues = (scan.issues as GraphQLResponseData | undefined)?.nodes as
		| GraphQLResponseData[]
		| undefined;
	const nodes = issues ?? [];

	const entries: BatchEntry[] = [];
	for (const node of nodes) {
		const issueUuid = node.id as string;
		const identifier = node.identifier as string;
		const description = (node.description as string | null | undefined) ?? "";
		const autoLinked = await linkReferencesForIssue({
			issueUuid,
			identifier,
			description,
			includeComments,
			dryRun,
			graphQLService,
			linearService,
		});
		entries.push({ identifier, autoLinked });
	}

	// Summary counts across the batch
	const totalLinked = entries.reduce(
		(n, e) => n + e.autoLinked.linked.length,
		0,
	);
	const totalSkipped = entries.reduce(
		(n, e) => n + e.autoLinked.skipped.length,
		0,
	);
	const totalFailed = entries.reduce(
		(n, e) => n + e.autoLinked.failed.length,
		0,
	);

	outputSuccess({
		data: entries,
		meta: {
			count: entries.length,
			team: teamInput,
			dryRun,
			includeComments,
			totals: {
				linked: totalLinked,
				skipped: totalSkipped,
				failed: totalFailed,
			},
		},
	});
}

export async function handleLinkReferencesIssue(
	issueIdOrTeamFlag: string | undefined,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);

	if (options.team) {
		if (issueIdOrTeamFlag) {
			throw new Error(
				"Provide either an issueId positional argument OR --team, not both. With --team, omit the issueId.",
			);
		}
		if (options.rewriteDescription) {
			throw new Error(
				"--rewrite-description is single-issue only. Use it case by case (one issueId per invocation) — bulk description rewrites bot-author the whole team's history.",
			);
		}
		return handleLinkReferencesBatch(
			options.team as string,
			options,
			graphQLService,
			linearService,
		);
	}

	if (!issueIdOrTeamFlag) {
		throw new Error(
			"issueId is required (or use --team <key> to scan a whole team)",
		);
	}
	return handleLinkReferencesSingle(
		issueIdOrTeamFlag,
		options,
		graphQLService,
		linearService,
	);
}
