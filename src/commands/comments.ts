import { readFileSync } from "node:fs";
import type { Command, OptionValues } from "commander";
import { resolveUserDisplayName } from "../config/resolver.js";
import {
	CREATE_COMMENT_MUTATION,
	DELETE_COMMENT_MUTATION,
	GET_COMMENT_QUERY,
	LIST_COMMENTS_QUERY,
	UPDATE_COMMENT_MUTATION,
} from "../queries/comments.js";
import type {
	CommentResourceNode,
	CreateCommentResponse,
	DeleteCommentResponse,
	GetCommentResponse,
	ListCommentsResponse,
	UpdateCommentResponse,
} from "../queries/comments-types.js";
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
import { logger } from "../utils/logger.js";
import {
	type MentionReport,
	resolveMentions,
} from "../utils/mention-resolver.js";
import {
	getOutputFormat,
	getQuietMode,
	handleAsyncCommand,
	outputSuccess,
} from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { validateReferences } from "../utils/validate-references.js";
import { parsePositiveInt } from "../utils/validators.js";
import { getWorkspaceUrlKey } from "../utils/workspace-url.js";

// Match Linear's bodyData validation error in multiple phrasings so a wording
// tweak on their side doesn't silently regress the fallback path.
const BODY_DATA_ERROR_RE = /prosemirror|bodydata|invalid.*body/i;
const ISSUE_IDENTIFIER_REGEX = /^[A-Z][A-Z0-9]*-\d+$/;
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENT_ANCHOR_REGEX = /(?:^|[#/])comment-([A-Za-z0-9-]+)/;

/**
 * Structured, machine-readable record of mention resolution, attached to the
 * command output alongside `autoLinked`. `delivered` is false when Linear
 * rejected the structured body and we fell back to plain text — i.e. the
 * resolved mentions did NOT fire notifications.
 */
interface MentionsOutput {
	resolved: { label: string; userId: string }[];
	unresolved: string[];
	delivered: boolean;
}

/**
 * Turn a {@link MentionReport} into the `mentions` output field, or `undefined`
 * when there is nothing to report. `delivered=false` records a bodyData→plain
 * fallback so the JSON output never falsely claims a ping was sent.
 */
function buildMentionsOutput(
	report: MentionReport | null,
	delivered: boolean,
): MentionsOutput | undefined {
	if (!report) {
		return undefined;
	}
	if (report.resolved.length === 0 && report.unresolvedExplicit.length === 0) {
		return undefined;
	}
	return {
		resolved: report.resolved.map((m) => ({
			label: m.label,
			userId: m.userId,
		})),
		unresolved: report.unresolvedExplicit,
		delivered,
	};
}

/**
 * Emit the human-facing side of mention resolution to **stderr** (so it never
 * pollutes the machine-stable stdout line, and survives `--quiet`):
 *   - a loud warning for each explicit `@name` that resolved to nobody,
 *   - a warning when a bodyData rejection dropped resolved mentions,
 *   - under `--quiet`, a one-line confirmation of what resolved (since the
 *     quiet stdout line can't carry the `mentions` field).
 */
function reportMentions(mentions: MentionsOutput | undefined): void {
	if (!mentions) {
		return;
	}
	for (const name of mentions.unresolved) {
		logger.error(
			`⚠ @${name} did not resolve to a team member — left as plain text (no notification sent)`,
		);
	}
	if (!mentions.delivered && mentions.resolved.length > 0) {
		logger.error(
			`⚠ Linear rejected the structured comment body; fell back to plain text — ${mentions.resolved.length} mention(s) were NOT delivered as notifications`,
		);
	}
	// In quiet mode stdout is a single `comment <id>` line with no room for the
	// `mentions` field, so echo a concise confirmation to stderr.
	if (getQuietMode()) {
		const resolved = mentions.delivered
			? mentions.resolved.map((m) => `${m.label}→${m.userId}`).join(", ")
			: "(none delivered)";
		logger.error(
			`mentions: resolved=[${resolved}] unresolved=[${mentions.unresolved.join(", ")}]`,
		);
	}
}

function readBody(options: OptionValues): string {
	// --body and --body-file are two sources for the same field; accepting both
	// would silently drop one. Reject up front (DEV-4450) — the same mutual-
	// exclusivity contract resolveDescription() enforces for --template.
	if (options.body && options.bodyFile) {
		throw new Error(
			"--body and --body-file are mutually exclusive — pass one or the other",
		);
	}
	if (options.bodyFile) {
		return readFileSync(options.bodyFile, "utf-8");
	}
	if (options.body) {
		return options.body;
	}
	throw new Error("Either --body or --body-file is required");
}

async function fetchSelfUserId(
	graphQLService: GraphQLService,
): Promise<string | undefined> {
	try {
		const result = await graphQLService.rawRequest<{
			viewer: { id: string } | null;
		}>("{ viewer { id } }");
		return result.viewer?.id;
	} catch {
		return;
	}
}

function transformComment(
	comment: CommentResourceNode,
	options: { fullBodySummary?: boolean } = {},
): Record<string, unknown> {
	return {
		id: comment.id,
		body: comment.body,
		url: comment.url ?? undefined,
		user: {
			id: comment.user.id,
			name: resolveUserDisplayName(comment.user.id, comment.user.name),
			url: comment.user.url ?? undefined,
		},
		createdAt: comment.createdAt,
		updatedAt: comment.updatedAt,
		...(options.fullBodySummary ? { _summaryFullBody: true } : {}),
	};
}

function normalizeCommentRef(input: string): { id?: string; hash?: string } {
	const trimmed = input.trim();
	const anchorMatch = COMMENT_ANCHOR_REGEX.exec(trimmed);
	const candidate = anchorMatch?.[1] ?? trimmed.replace(/^#?comment-/, "");
	if (UUID_REGEX.test(candidate)) {
		return { id: candidate.toLowerCase() };
	}
	return { hash: candidate };
}

function printRawCommentBody(
	comment: Record<string, unknown>,
	label: string,
): void {
	const body = typeof comment.body === "string" ? comment.body : "";
	if (body.trim() === "") {
		process.stderr.write(`el-linear: comment ${label} has no body\n`);
		process.exit(1);
	}
	process.stdout.write(`${body}\n`);
}

function formatCommentBodyBlocks(comments: Record<string, unknown>[]): string {
	return comments
		.map((comment) => {
			const id = typeof comment.id === "string" ? comment.id : "-";
			const body = typeof comment.body === "string" ? comment.body : "";
			return `comment ${id}\n\n${body}`;
		})
		.join("\n\n---\n\n");
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
	if (mentionResult?.bodyData) {
		input.bodyData = mentionResult.bodyData;
	} else {
		input.body = body;
	}

	// Tracks whether resolved mentions actually shipped as structured nodes;
	// flipped to false if the bodyData fallback below sends plain text instead.
	let mentionsDelivered = true;
	let result: CreateCommentResponse;
	try {
		result = await graphQLService.rawRequest<CreateCommentResponse>(
			CREATE_COMMENT_MUTATION,
			{ input },
		);
	} catch (err: unknown) {
		// If the bodyData ProseMirror document is rejected (invalid shape,
		// unsupported node, schema change), fall back to raw body text and let
		// Linear handle the conversion server-side.
		const msg = err instanceof Error ? err.message : String(err);
		if (input.bodyData && BODY_DATA_ERROR_RE.test(msg)) {
			mentionsDelivered = false;
			const fallbackInput: Record<string, unknown> = {
				issueId: resolvedIssueId,
				body,
			};
			result = await graphQLService.rawRequest<CreateCommentResponse>(
				CREATE_COMMENT_MUTATION,
				{ input: fallbackInput },
			);
		} else {
			throw err;
		}
	}
	const mutation = result.commentCreate;
	if (!mutation.success || !mutation.comment) {
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
	const output = transformComment(mutation.comment);
	const mentions = buildMentionsOutput(mentionResult, mentionsDelivered);
	reportMentions(mentions);
	outputSuccess({
		...output,
		...(autoLinked ? { autoLinked } : {}),
		...(mentions ? { mentions } : {}),
	});
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
	if (mentionResult?.bodyData) {
		input.bodyData = mentionResult.bodyData;
	} else {
		input.body = body;
	}

	let mentionsDelivered = true;
	let result: UpdateCommentResponse;
	try {
		result = await graphQLService.rawRequest<UpdateCommentResponse>(
			UPDATE_COMMENT_MUTATION,
			{ id: commentId, input },
		);
	} catch (err: unknown) {
		// Same defense-in-depth fallback as `handleCreateComment` above: when
		// Linear rejects `bodyData` (schema drift, unsupported node, validator
		// quirk), retry the mutation with raw markdown `body` so the update
		// goes through even if our prosemirror converter has fallen behind a
		// schema change. The asymmetry between create and update used to mean
		// any future drift would silently break updates while creates kept
		// working — DEV-4261 closes that gap. Two call sites is the floor for
		// extraction; copy-then-refactor on the third per the repo convention.
		const msg = err instanceof Error ? err.message : String(err);
		if (input.bodyData && BODY_DATA_ERROR_RE.test(msg)) {
			mentionsDelivered = false;
			const fallbackInput: Record<string, unknown> = { body };
			result = await graphQLService.rawRequest<UpdateCommentResponse>(
				UPDATE_COMMENT_MUTATION,
				{ id: commentId, input: fallbackInput },
			);
		} else {
			throw err;
		}
	}
	const mutation = result.commentUpdate;
	if (!mutation.success || !mutation.comment) {
		throw new Error("Failed to update comment");
	}
	const comment = mutation.comment;
	let autoLinked: AutoLinkResult | undefined;
	if (comment.issue) {
		// rawBody (pre-wrap) — see note in handleCreateComment about keyword inference
		autoLinked = await autoLinkCommentReferences({
			parentIssueUuid: comment.issue.id,
			parentIssueIdentifier: comment.issue.identifier,
			body: rawBody,
			preResolved,
			options,
			graphQLService,
			linearService,
		});
	}
	const output = transformComment(comment);
	const mentions = buildMentionsOutput(mentionResult, mentionsDelivered);
	reportMentions(mentions);
	outputSuccess({
		...output,
		...(autoLinked ? { autoLinked } : {}),
		...(mentions ? { mentions } : {}),
	});
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
	const result = await graphQLService.rawRequest<ListCommentsResponse>(
		LIST_COMMENTS_QUERY,
		{
			issueId: resolvedId,
			first: parsePositiveInt(options.limit, "--limit"),
		},
	);
	if (!result.issue) {
		throw new Error(`Issue "${issueId}" not found`);
	}
	const fullBodySummary =
		options.truncate === false && getOutputFormat() === "summary";
	const nodes = result.issue.comments.nodes.map((comment) =>
		transformComment(comment, { fullBodySummary }),
	);
	if (options.body === true) {
		process.stdout.write(`${formatCommentBodyBlocks(nodes)}\n`);
		return;
	}
	outputSuccess({
		data: nodes,
		meta: {
			count: nodes.length,
			issue: result.issue.identifier,
		},
	});
}

async function handleReadComment(
	commentRef: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const ref = normalizeCommentRef(commentRef);
	const result = await graphQLService.rawRequest<GetCommentResponse>(
		GET_COMMENT_QUERY,
		ref,
	);
	if (!result.comment) {
		throw new Error(`Comment "${commentRef}" not found`);
	}
	const comment = transformComment(result.comment, {
		fullBodySummary: getOutputFormat() === "summary",
	});
	if (options.body === true) {
		printRawCommentBody(comment, commentRef);
		return;
	}
	outputSuccess(comment);
}

async function handleDeleteComment(
	commentId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const result = await graphQLService.rawRequest<DeleteCommentResponse>(
		DELETE_COMMENT_MUTATION,
		{ id: commentId },
	);
	if (!result.commentDelete.success) {
		throw new Error(`Failed to delete comment "${commentId}"`);
	}
	outputSuccess({ id: commentId, deleted: true });
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
		.option("--body-file <path>", "read comment body from file")
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
		.option(
			"-q, --quiet",
			"print one confirmation line (comment <id>) instead of the full JSON",
		)
		.action(handleAsyncCommand(handleCreateComment));

	comments
		.command("update <commentId>")
		.description("Update an existing comment.")
		.option("--body <body>", "new comment body (inline)")
		.option("--body-file <path>", "read new comment body from file")
		.option(
			"--no-auto-mention",
			"do not auto-convert bare team-member names to @mentions",
		)
		.option(
			"--no-auto-link",
			"skip wrapping issue refs as markdown links and creating sidebar relations",
		)
		.option(
			"-q, --quiet",
			"print one confirmation line (comment <id>) instead of the full JSON",
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
		.option(
			"--body",
			"print complete comment bodies as plain text blocks instead of JSON",
		)
		.option(
			"--no-truncate",
			"do not truncate comment bodies in --format summary output",
		)
		.action(handleAsyncCommand(handleListComments));

	comments
		.command("read <commentId>")
		.alias("get")
		.alias("show")
		.description("Read a comment by id or Linear #comment-<hash> anchor.")
		.addHelpText(
			"after",
			"\nAccepts a full comment UUID, a comment-<hash> token, or a URL containing #comment-<hash>.",
		)
		.option("--body", "print the raw comment body with no JSON envelope")
		.option(
			"-q, --quiet",
			"print one confirmation line (comment <id>) instead of the full JSON",
		)
		.action(handleAsyncCommand(handleReadComment));

	comments
		.command("delete <commentId>")
		.alias("remove")
		.alias("rm")
		.description("Delete a comment by its id.")
		.addHelpText(
			"after",
			"\nTakes a comment id (the `id` field from `comments list` / `comments create`), not an issue identifier.",
		)
		.action(handleAsyncCommand(handleDeleteComment));
}
