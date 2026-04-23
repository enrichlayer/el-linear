import { readFileSync } from "node:fs";
import type { Command, OptionValues } from "commander";
import { resolveUserDisplayName } from "../config/resolver.js";
import {
  CREATE_COMMENT_MUTATION,
  LIST_COMMENTS_QUERY,
  UPDATE_COMMENT_MUTATION,
} from "../queries/comments.js";
import type { GraphQLResponseData } from "../types/linear.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { resolveMentions } from "../utils/mention-resolver.js";
import { handleAsyncCommand, outputSuccess } from "../utils/output.js";

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
  graphQLService: ReturnType<typeof createGraphQLService>,
): Promise<string | undefined> {
  try {
    const result = await graphQLService.rawRequest("{ viewer { id } }");
    const viewer = result.viewer as { id?: string } | undefined;
    return viewer?.id;
  } catch {
    return;
  }
}

function transformComment(comment: GraphQLResponseData): Record<string, unknown> {
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

async function handleCreateComment(
  issueId: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const body = readBody(options);
  const resolvedIssueId = await linearService.resolveIssueId(issueId);

  const autoMention = options.autoMention !== false;
  const selfUserId = autoMention ? await fetchSelfUserId(graphQLService) : undefined;
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
    result = await graphQLService.rawRequest(CREATE_COMMENT_MUTATION, { input });
  } catch (err: unknown) {
    // If ProseMirror document is invalid (e.g. unsupported markdown syntax),
    // fall back to raw body text and let Linear handle the conversion.
    const msg = err instanceof Error ? err.message : String(err);
    if (input.bodyData && msg.includes("prosemirror")) {
      const fallbackInput: Record<string, unknown> = { issueId: resolvedIssueId, body };
      result = await graphQLService.rawRequest(CREATE_COMMENT_MUTATION, { input: fallbackInput });
    } else {
      throw err;
    }
  }
  const mutation = result.commentCreate as GraphQLResponseData;
  if (!mutation.success) {
    throw new Error("Failed to create comment");
  }
  outputSuccess(transformComment(mutation.comment as GraphQLResponseData));
}

async function handleUpdateComment(
  commentId: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const body = readBody(options);

  const autoMention = options.autoMention !== false;
  const selfUserId = autoMention ? await fetchSelfUserId(graphQLService) : undefined;
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
  outputSuccess(transformComment(mutation.comment as GraphQLResponseData));
}

async function handleListComments(
  issueId: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
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
  const nodes = (commentsData.nodes as GraphQLResponseData[]).map(transformComment);
  outputSuccess({
    data: nodes,
    meta: {
      count: nodes.length,
      issue: issue.identifier as string,
    },
  });
}

export function setupCommentsCommands(program: Command): void {
  const comments = program.command("comments").alias("comment").description("Comment operations");
  comments.action(() => comments.help());

  comments
    .command("create <issueId>")
    .description("Create new comment on issue.")
    .addHelpText(
      "after",
      "\nBoth UUID and identifiers like ABC-123 are supported.\nBare references to known team members (e.g. 'Dima') are auto-converted to @mentions — pass --no-auto-mention to disable.",
    )
    .option("--body <body>", "comment body (inline)")
    .option("--file <path>", "read comment body from file")
    .option("--no-auto-mention", "do not auto-convert bare team-member names to @mentions")
    .action(handleAsyncCommand(handleCreateComment));

  comments
    .command("update <commentId>")
    .description("Update an existing comment.")
    .option("--body <body>", "new comment body (inline)")
    .option("--file <path>", "read new comment body from file")
    .option("--no-auto-mention", "do not auto-convert bare team-member names to @mentions")
    .action(handleAsyncCommand(handleUpdateComment));

  comments
    .command("list <issueId>")
    .description("List comments on an issue.")
    .addHelpText("after", "\nBoth UUID and identifiers like ABC-123 are supported.")
    .option("-l, --limit <number>", "limit results", "25")
    .action(handleAsyncCommand(handleListComments));
}
