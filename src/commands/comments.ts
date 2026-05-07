import { readFileSync } from "node:fs";
import type { Command, OptionValues } from "commander";
import { resolveUserDisplayName } from "../config/resolver.js";
import {
	CREATE_COMMENT_MUTATION,
	LIST_COMMENTS_QUERY,
	UPDATE_COMMENT_MUTATION,
} from "../queries/comments.js";
import type { GraphQLResponseData } from "../types/linear.js";
import {
	type AutoLinkResult,
	autoLinkReferences,
} from "../utils/auto-link-references.js";
import { applyFooter } from "../utils/footer.js";
import {
	createGraphQLService,
	type GraphQLService,
} from "../utils/graphql-service.js";
import { extractIssueReferences } from "../utils/issue-reference-extractor.js";
import { wrapIssueReferencesAsLinks } from "../utils/issue-reference-wrapper.js";
import {
	createLinearService,
	type LinearService,
} from "../utils/linear-service.js";
import { resolveMentions } from "../utils/mention-resolver.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { validateReferences } from "../utils/validate-references.js";
import { getWorkspaceUrlKey } from "../utils/workspace-url.js";

// Match Linear's bodyData validation error in multiple phrasings so a wording
// tweak on their side doesn't silently regress the fallback path.
const BODY_DATA_ERROR_RE = /prosemirror|bodydata|invalid.*body/i;
const ISSUE_IDENTIFIER_REGEX = /^[A-Z][A-Z0-9]*-\d+$/;

function readBody(options: OptionValues): string {
	if (options.file) {
		return readFileSync(options.file, "utf-8");
	}
	if (options.body) {
		return options.body;
	}
	throw new Error("Either --body or --file is required");
}

async function fetchSelfUserId(
	graphQLService: GraphQLService,
): Promise<string | undefined> {
	try {
		const result = await graphQLService.rawRequest("{ viewer { id } }");
		const viewer = result.viewer as { id?: string } | undefined;
		return viewer?.id;
	} catch {
		return;
	}
}

function transformComment(
	comment: GraphQLResponseData,
): Record<string, unknown> {
	const user = comment.user as GraphQLResponseData;
	return {
		id: comment.id as string,
		body: comment.body as string,
		user: {
			id: user.id as string,
			name: resolveUserDisplayName(user.id as string, user.name as string),
			url: (user.url as string | undefined) || undefined,
		},
		createdAt: comment.createdAt as string,
		updatedAt: comment.updatedAt as string,
	};
}

interface PreparedCommentBody {
	body: string;
	preResolved: Map<string, string>;
}

/**
 * Wrap valid issue references in a comment body as markdown links — same logic as for
 * issue descriptions. Returns the rewritten body plus the validated identifier→UUID map
 * so the caller can reuse it for sidebar relation creation without re-resolving.
 *
 * No-op (returns the original body with an empty map) when:
 * - body has no candidate refs
 * - the user passed `--no-auto-link`
 */
async function prepareCommentBodyWithLinks(
	body: string,
	options: OptionValues,
	linearService: LinearService,
	graphQLService: GraphQLService,
): Promise<PreparedCommentBody> {
	if (options.autoLink === false || !body) {
		return { body, preResolved: new Map() };
	}
	const refs = extractIssueReferences(body);
	if (refs.length === 0) {
		return { body, preResolved: new Map() };
	}
	const preResolved = await validateReferences(
		refs.map((r) => r.identifier),
		linearService,
	);
	if (preResolved.size === 0) {
		return { body, preResolved };
	}
	const validIds = new Set(preResolved.keys());
	const urlKey = await getWorkspaceUrlKey(graphQLService);
	const wrapped = wrapIssueReferencesAsLinks(body, validIds, urlKey);
	return { body: wrapped, preResolved };
}

/**
 * After a comment is saved, create sidebar relations on the parent issue for the
 * referenced issues — same de-dup and prose-keyword inference logic as descriptions.
 * Returns undefined when nothing was linked, skipped, or failed.
 */
async function autoLinkCommentReferences(args: {
	parentIssueUuid: string;
	parentIssueIdentifier: string;
	body: string;
	preResolved: Map<string, string>;
	options: OptionValues;
	graphQLService: GraphQLService;
	linearService: LinearService;
}): Promise<AutoLinkResult | undefined> {
	if (args.options.autoLink === false) {
		return;
	}
	const result = await autoLinkReferences({
		issueId: args.parentIssueUuid,
		identifier: args.parentIssueIdentifier,
		description: args.body,
		preResolved: args.preResolved,
		graphQLService: args.graphQLService,
		linearService: args.linearService,
	});
	if (
		result.linked.length === 0 &&
		result.skipped.length === 0 &&
		result.failed.length === 0
	) {
		return;
	}
	return result;
}

async function handleCreateComment(
	issueId: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	// Apply messageFooter (config or --footer flag) before any further
	// processing, so auto-link / mention-resolution see it as part of the body.
	// Commander parses --no-footer as `options.footer === false`.
	const noFooter = options.footer === false;
	const explicitFooter =
		typeof options.footer === "string" ? options.footer : undefined;
	const rawBody =
		applyFooter(readBody(options), {
			footer: explicitFooter,
			noFooter,
		}) ?? "";
	const resolvedIssueId = await linearService.resolveIssueId(issueId);

	// Wrap valid refs as markdown links before mention resolution. Idempotent against
	// already-wrapped refs.
	const { body, preResolved } = await prepareCommentBodyWithLinks(
		rawBody,
		options,
		linearService,
		graphQLService,
	);

	const autoMention = options.autoMention !== false;
	const selfUserId = autoMention
		? await fetchSelfUserId(graphQLService)
		: undefined;
	const mentionResult = await resolveMentions(body, linearService, {
		autoMention,
		selfUserId,
	});
	const input: Record<string, unknown> = { issueId: resolvedIssueId };
	if (mentionResult) {
		input.bodyData = mentionResult.bodyData;
	} else {
		input.body = body;
	}

	let result: Record<string, unknown>;
	try {
		result = await graphQLService.rawRequest(CREATE_COMMENT_MUTATION, {
			input,
		});
	} catch (err: unknown) {
		// If the bodyData ProseMirror document is rejected (invalid shape,
		// unsupported node, schema change), fall back to raw body text and let
		// Linear handle the conversion server-side.
		const msg = err instanceof Error ? err.message : String(err);
		if (input.bodyData && BODY_DATA_ERROR_RE.test(msg)) {
			const fallbackInput: Record<string, unknown> = {
				issueId: resolvedIssueId,
				body,
			};
			result = await graphQLService.rawRequest(CREATE_COMMENT_MUTATION, {
				input: fallbackInput,
			});
		} else {
			throw err;
		}
	}
	const mutation = result.commentCreate as GraphQLResponseData;
	if (!mutation.success) {
		throw new Error("Failed to create comment");
	}
	// We don't have the parent issue's identifier from the create mutation response,
	// but we don't need it for self-exclusion in comments — wrapping a self-ref in a
	// comment body is harmless. Use the user-provided issueId if it looks like one.
	const parentIdentifier = ISSUE_IDENTIFIER_REGEX.test(issueId)
		? issueId.toUpperCase()
		: "";
	// Pass rawBody (pre-wrap) to autoLink so prose-keyword inference ("blocked by", etc.)
	// sees `keyword DEV-100` rather than `keyword [DEV-100](url)`. After wrapping the inserted
	// `[` defeats the trailing-whitespace anchor and inference falls back to "related".
	const autoLinked = await autoLinkCommentReferences({
		parentIssueUuid: resolvedIssueId,
		parentIssueIdentifier: parentIdentifier,
		body: rawBody,
		preResolved,
		options,
		graphQLService,
		linearService,
	});
	const output = transformComment(mutation.comment as GraphQLResponseData);
	outputSuccess(autoLinked ? { ...output, autoLinked } : output);
}

async function handleUpdateComment(
	commentId: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const rawBody = readBody(options);

	const { body, preResolved } = await prepareCommentBodyWithLinks(
		rawBody,
		options,
		linearService,
		graphQLService,
	);

	const autoMention = options.autoMention !== false;
	const selfUserId = autoMention
		? await fetchSelfUserId(graphQLService)
		: undefined;
	const mentionResult = await resolveMentions(body, linearService, {
		autoMention,
		selfUserId,
	});
	const input: Record<string, unknown> = {};
	if (mentionResult) {
		input.bodyData = mentionResult.bodyData;
	} else {
		input.body = body;
	}

	const result = await graphQLService.rawRequest(UPDATE_COMMENT_MUTATION, {
		id: commentId,
		input,
	});
	const mutation = result.commentUpdate as GraphQLResponseData;
	if (!mutation.success) {
		throw new Error("Failed to update comment");
	}
	const comment = mutation.comment as GraphQLResponseData;
	const issue = comment.issue as GraphQLResponseData | undefined;
	let autoLinked: AutoLinkResult | undefined;
	if (issue) {
		// rawBody (pre-wrap) — see note in handleCreateComment about keyword inference
		autoLinked = await autoLinkCommentReferences({
			parentIssueUuid: issue.id as string,
			parentIssueIdentifier: (issue.identifier as string) ?? "",
			body: rawBody,
			preResolved,
			options,
			graphQLService,
			linearService,
		});
	}
	const output = transformComment(comment);
	outputSuccess(autoLinked ? { ...output, autoLinked } : output);
}

async function handleListComments(
	issueId: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const resolvedId = await linearService.resolveIssueId(issueId);
	const result = await graphQLService.rawRequest(LIST_COMMENTS_QUERY, {
		issueId: resolvedId,
		first: Number.parseInt(options.limit, 10),
	});
	const issue = result.issue as GraphQLResponseData;
	if (!issue) {
		throw new Error(`Issue "${issueId}" not found`);
	}
	const commentsData = issue.comments as GraphQLResponseData;
	const nodes = (commentsData.nodes as GraphQLResponseData[]).map(
		transformComment,
	);
	outputSuccess({
		data: nodes,
		meta: {
			count: nodes.length,
			issue: issue.identifier as string,
		},
	});
}

export function setupCommentsCommands(program: Command): void {
	const comments = program
		.command("comments")
		.alias("comment")
		.description("Comment operations");
	comments.action(() => comments.help());

	comments
		.command("create <issueId>")
		.description("Create new comment on issue.")
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported.\nBare references to known team members (e.g. 'Dima') are auto-converted to @mentions — pass --no-auto-mention to disable.\nIssue identifiers (e.g. DEV-123) are wrapped as markdown links and added as 'related' relations on the parent issue — pass --no-auto-link to disable.",
		)
		.option("--body <body>", "comment body (inline)")
		.option("--file <path>", "read comment body from file")
		.option(
			"--no-auto-mention",
			"do not auto-convert bare team-member names to @mentions",
		)
		.option(
			"--no-auto-link",
			"skip wrapping issue refs as markdown links and creating sidebar relations",
		)
		.option(
			"--footer <text>",
			"text appended to the comment body (overrides config.messageFooter)",
		)
		.option("--no-footer", "skip the configured messageFooter for this comment")
		.action(handleAsyncCommand(handleCreateComment));

	comments
		.command("update <commentId>")
		.description("Update an existing comment.")
		.option("--body <body>", "new comment body (inline)")
		.option("--file <path>", "read new comment body from file")
		.option(
			"--no-auto-mention",
			"do not auto-convert bare team-member names to @mentions",
		)
		.option(
			"--no-auto-link",
			"skip wrapping issue refs as markdown links and creating sidebar relations",
		)
		.action(handleAsyncCommand(handleUpdateComment));

	comments
		.command("list <issueId>")
		.description("List comments on an issue.")
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported.",
		)
		.option("-l, --limit <number>", "limit results", "25")
		.action(handleAsyncCommand(handleListComments));
}
