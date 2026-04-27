import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Command, OptionValues } from "commander";
import { enforceBrandName } from "../config/brand-validator.js";
import { loadConfig } from "../config/config.js";
import { enforceValidation, validateIssueCreation } from "../config/issue-validation.js";
import { resolveAssignee, resolveLabels, resolveMember, resolveTeam } from "../config/resolver.js";
import { resolveDefaultStatus } from "../config/status-defaults.js";
import { LIST_COMMENTS_QUERY } from "../queries/comments.js";
import {
  GET_ISSUE_RELATIONS_QUERY,
  GET_ISSUE_STATE_HISTORY_QUERY,
  ISSUE_RELATION_CREATE_MUTATION,
  SCAN_ISSUES_QUERY,
} from "../queries/issues.js";
import type {
  GraphQLResponseData,
  IssueStateSpan,
  LinearAttachment,
  LinearIssue,
  LinearIssueRelation,
} from "../types/linear.js";
import { getApiToken } from "../utils/auth.js";
import { type AutoLinkResult, autoLinkReferences } from "../utils/auto-link-references.js";
import { downloadLinearUploads } from "../utils/download-uploads.js";
import { FileService } from "../utils/file-service.js";
import { createGraphQLAttachmentsService } from "../utils/graphql-attachments-service.js";
import { GraphQLIssuesService } from "../utils/graphql-issues-service.js";
import { createGraphQLService, type GraphQLService } from "../utils/graphql-service.js";
import { extractIssueReferences } from "../utils/issue-reference-extractor.js";
import {
  DEFAULT_WORKSPACE_URL_KEY,
  wrapIssueReferencesAsLinks,
} from "../utils/issue-reference-wrapper.js";
import { createLinearService, type LinearService } from "../utils/linear-service.js";
import { logger } from "../utils/logger.js";
import { handleAsyncCommand, outputSuccess, outputWarning } from "../utils/output.js";
import { formatCsv, formatMarkdown, formatTable } from "../utils/table-formatter.js";
import { validateReferences } from "../utils/validate-references.js";
import { parsePriorityFilter, splitList, validatePriority } from "../utils/validators.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico"]);

const LINEAR_BRANCH_REGEX = /^([a-zA-Z]+)-(\d+)-(.+)$/;
const COMMIT_HASH_PREFIX_REGEX = /^[a-f0-9]+ /;

/**
 * Transform Linear's branchName (e.g. "dev-3549-slug") into our convention:
 * "feature/DEV-3549-slug" — uppercase team key with a configurable prefix.
 */
function toBranchName(linearBranchName: string, prefix = "feature/"): string {
  // Linear branch names look like "dev-123-some-slug"
  // We need to uppercase the team key: "DEV-123-some-slug"
  const match = linearBranchName.match(LINEAR_BRANCH_REGEX);
  if (!match) {
    return `${prefix}${linearBranchName}`;
  }
  const [, teamKey, number, slug] = match;
  return `${prefix}${teamKey.toUpperCase()}-${number}-${slug}`;
}

/**
 * Check out a new git branch. Warns and skips if not in a git repo.
 * Throws if the branch already exists.
 */
function gitCheckoutBranch(branchName: string): void {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "pipe" });
  } catch {
    outputWarning("Not inside a git repository — skipping branch checkout.");
    return;
  }
  execFileSync("git", ["checkout", "-b", branchName], { stdio: "pipe" });
}

/**
 * Read description from a file path or stdin ("-").
 * Avoids shell escaping issues when descriptions contain special characters.
 */
function readDescriptionFile(filePath: string): string {
  if (filePath === "-") {
    return fs.readFileSync(0, "utf8").trim();
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Description file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

/**
 * Resolve the description from --description, --description-file, or both.
 * --description-file takes precedence when both are provided.
 */
function resolveDescription(options: OptionValues): string | undefined {
  if (options.descriptionFile) {
    return readDescriptionFile(options.descriptionFile);
  }
  return options.description;
}

function isImageFile(filename: string): boolean {
  const ext = filename.lastIndexOf(".");
  return ext !== -1 && IMAGE_EXTENSIONS.has(filename.slice(ext).toLowerCase());
}

function transformIssueRelation(rel: GraphQLResponseData): LinearIssueRelation {
  const issue = rel.issue as GraphQLResponseData;
  const relatedIssue = rel.relatedIssue as GraphQLResponseData;
  return {
    id: rel.id as string,
    type: rel.type as string,
    issue: {
      id: issue.id as string,
      identifier: issue.identifier as string,
      title: issue.title as string,
    },
    relatedIssue: {
      id: relatedIssue.id as string,
      identifier: relatedIssue.identifier as string,
      title: relatedIssue.title as string,
    },
  };
}

async function createRelations(
  sourceId: string,
  options: Record<string, unknown>,
  graphQLService: GraphQLService,
  linearService: LinearService,
): Promise<LinearIssueRelation[]> {
  const relations: LinearIssueRelation[] = [];

  const relationSpecs: { option: string; type: string; reverse?: boolean }[] = [
    { option: "relatedTo", type: "related" },
    { option: "blocks", type: "blocks" },
    { option: "blockedBy", type: "blocks", reverse: true },
    { option: "duplicateOf", type: "duplicate" },
  ];

  for (const spec of relationSpecs) {
    const value = options[spec.option] as string | undefined;
    if (!value) {
      continue;
    }
    for (const id of splitList(value)) {
      const targetId = await linearService.resolveIssueId(id);
      const rel = await graphQLService.rawRequest(ISSUE_RELATION_CREATE_MUTATION, {
        input: {
          issueId: spec.reverse ? targetId : sourceId,
          relatedIssueId: spec.reverse ? sourceId : targetId,
          type: spec.type,
        },
      });
      const create = rel.issueRelationCreate as GraphQLResponseData | undefined;
      const issueRelation = create?.issueRelation as GraphQLResponseData;
      relations.push(transformIssueRelation(issueRelation));
    }
  }

  return relations;
}

interface PreparedDescription {
  /** The (possibly rewritten) description text to send to Linear */
  description: string | undefined;
  /** Map<identifier, uuid> of refs that resolved — passed to autoLink to avoid re-resolution */
  preResolved: Map<string, string>;
  /** True when the original description was rewritten (i.e. at least one link was wrapped) */
  rewritten: boolean;
}

/**
 * Pre-process a description before sending to Linear:
 * 1. Extract all issue references from the description.
 * 2. Validate them (drop those that don't resolve in this workspace — handles "ISO-1424"-style false positives).
 * 3. Wrap valid identifiers as markdown links — skipping any already inside a link, code block, or backtick span.
 *
 * Returns the rewritten description plus the validated map for downstream auto-linking.
 *
 * No-ops (returns the original description with an empty map) when:
 * - description is empty/undefined
 * - the user passed `--no-auto-link`
 */
async function prepareAutoLinkedDescription(
  description: string | undefined,
  options: OptionValues,
  selfIdentifier: string | undefined,
  linearService: LinearService,
): Promise<PreparedDescription> {
  if (!description || options.autoLink === false) {
    return { description, preResolved: new Map(), rewritten: false };
  }
  const refs = extractIssueReferences(description, selfIdentifier);
  if (refs.length === 0) {
    return { description, preResolved: new Map(), rewritten: false };
  }
  const preResolved = await validateReferences(
    refs.map((r) => r.identifier),
    linearService,
  );
  if (preResolved.size === 0) {
    return { description, preResolved, rewritten: false };
  }
  const validIds = new Set(preResolved.keys());
  const wrapped = wrapIssueReferencesAsLinks(description, validIds, DEFAULT_WORKSPACE_URL_KEY);
  return {
    description: wrapped,
    preResolved,
    rewritten: wrapped !== description,
  };
}

interface MaybeAutoLinkInput {
  description: string | null | undefined;
  graphQLService: GraphQLService;
  identifier: string;
  issueId: string;
  linearService: LinearService;
  options: OptionValues;
  preResolved?: Map<string, string>;
}

/**
 * Run auto-linking for issue references found in a description, unless the user opted out
 * with --no-auto-link or no description was provided. Returns undefined when nothing was linked
 * and nothing was skipped/failed (so callers can omit the field from JSON output).
 */
async function maybeAutoLink(input: MaybeAutoLinkInput): Promise<AutoLinkResult | undefined> {
  const { issueId, identifier, description, options, graphQLService, linearService, preResolved } =
    input;
  if (options.autoLink === false) {
    return;
  }
  if (!description) {
    return;
  }
  const result = await autoLinkReferences({
    issueId,
    identifier,
    description,
    graphQLService,
    linearService,
    preResolved,
  });
  if (result.linked.length === 0 && result.skipped.length === 0 && result.failed.length === 0) {
    return;
  }
  return result;
}

function validateUpdateOptions(options: OptionValues): void {
  if (options.parentTicket && options.clearParentTicket) {
    throw new Error("Cannot use --parent-ticket and --clear-parent-ticket together");
  }
  if (options.projectMilestone && options.clearProjectMilestone) {
    throw new Error("Cannot use --project-milestone and --clear-project-milestone together");
  }
  if (options.cycle && options.clearCycle) {
    throw new Error("Cannot use --cycle and --clear-cycle together");
  }
  if (options.labelBy && !options.labels) {
    throw new Error("--label-by requires --labels to be specified");
  }
  if (options.clearLabels && options.labels) {
    throw new Error("--clear-labels cannot be used with --labels");
  }
  if (options.clearLabels && options.labelBy) {
    throw new Error("--clear-labels cannot be used with --label-by");
  }
  if (options.labelBy && !["adding", "overwriting"].includes(options.labelBy)) {
    throw new Error("--label-by must be either 'adding' or 'overwriting'");
  }
  if (options.description && options.appendDescription) {
    throw new Error("Cannot use --description and --append-description together");
  }
}

function buildUpdateArgs(
  issueId: string,
  options: OptionValues,
  assigneeId?: string,
): Record<string, unknown> {
  let labelIds: string[] | undefined;
  if (options.clearLabels) {
    labelIds = [];
  } else if (options.labels) {
    labelIds = splitList(options.labels);
  }

  return {
    id: issueId,
    title: options.title,
    description: options.description,
    statusId: options.status,
    priority: options.priority ? validatePriority(options.priority) : undefined,
    assigneeId,
    projectId: options.project,
    labelIds,
    parentId: options.parentTicket || (options.clearParentTicket ? null : undefined),
    milestoneId: options.projectMilestone || (options.clearProjectMilestone ? null : undefined),
    cycleId: options.cycle || (options.clearCycle ? null : undefined),
    dueDate: options.dueDate || (options.clearDueDate ? null : undefined),
  };
}

function outputIssues(
  issues: LinearIssue[],
  format: string | undefined,
  fields: string | undefined,
  meta: Record<string, unknown>,
): void {
  const fieldList = fields ? splitList(fields) : undefined;
  if (format === "table") {
    logger.info(formatTable(issues, fieldList));
    logger.info(`\n${issues.length} issues`);
  } else if (format === "md" || format === "markdown") {
    logger.info(formatMarkdown(issues, fieldList));
  } else if (format === "csv") {
    logger.info(formatCsv(issues, fieldList));
  } else {
    outputSuccess({ data: issues, meta: { count: issues.length, ...meta } });
  }
}

function sortIssues(issues: LinearIssue[], sort: string | undefined): LinearIssue[] {
  if (!sort) {
    return issues;
  }
  const sorted = [...issues];
  switch (sort) {
    case "priority":
      sorted.sort((a, b) => {
        const pa = a.priority === 0 ? 5 : a.priority;
        const pb = b.priority === 0 ? 5 : b.priority;
        return pa - pb;
      });
      break;
    case "status":
      sorted.sort((a, b) => (a.state?.name ?? "").localeCompare(b.state?.name ?? ""));
      break;
    case "created":
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "updated":
      sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      break;
    default:
      break;
  }
  return sorted;
}

async function handleListIssues(options: OptionValues, command: Command): Promise<void> {
  if (options.label && !options.labels) {
    options.labels = options.label;
  }
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const issuesService = new GraphQLIssuesService(graphQLService, linearService);

  const hasFilters =
    options.team ||
    options.labels ||
    options.status ||
    options.assignee ||
    options.project ||
    options.project === false ||
    options.priority;
  if (hasFilters) {
    const searchArgs: Record<string, unknown> = {
      teamId: options.team ? resolveTeam(options.team) : undefined,
      assigneeId: options.assignee ? await resolveAssignee(options.assignee, rootOpts) : undefined,
      projectId: options.project || undefined,
      noProject: options.project === false,
      labelNames: options.labels ? splitList(options.labels) : undefined,
      status: options.status ? splitList(options.status) : undefined,
      priority: options.priority ? parsePriorityFilter(options.priority) : undefined,
      orderBy: options.sort === "created" ? "createdAt" : "updatedAt",
      limit: Number.parseInt(options.limit, 10),
    };
    const result = sortIssues(await issuesService.searchIssues(searchArgs), options.sort);
    outputIssues(result, options.format, options.fields, { team: options.team });
  } else {
    const result = sortIssues(
      await issuesService.getIssues(Number.parseInt(options.limit, 10)),
      options.sort,
    );
    outputIssues(result, options.format, options.fields, {});
  }
}

async function handleSearchIssues(
  query: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  if (options.label && !options.labels) {
    options.labels = options.label;
  }
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const issuesService = new GraphQLIssuesService(graphQLService, linearService);

  const searchArgs: Record<string, unknown> = {
    query,
    teamId: options.team ? resolveTeam(options.team) : undefined,
    assigneeId: options.assignee ? await resolveAssignee(options.assignee, rootOpts) : undefined,
    projectId: options.project || undefined,
    noProject: options.project === false,
    status: options.status ? splitList(options.status) : undefined,
    labelNames: options.labels ? splitList(options.labels) : undefined,
    priority: options.priority ? parsePriorityFilter(options.priority) : undefined,
    limit: Number.parseInt(options.limit, 10),
  };
  const result = sortIssues(await issuesService.searchIssues(searchArgs), options.sort);
  outputIssues(result, options.format, options.fields, { query });
}

async function resolveCreateInputs(
  title: string,
  options: OptionValues,
  rootOpts: Record<string, unknown>,
): Promise<{
  teamInput: string;
  teamId: string;
  assigneeId: string | undefined;
  labelIds: string[];
  status: string | undefined;
  subscriberIds: string[] | undefined;
}> {
  const config = loadConfig();
  enforceBrandName(title, options.description, options.strict);

  // --- Validation (labels, description, assignee, project, title) ---
  // Controlled by config.validation.enabled (default: true).
  // Bypassed by --skip-validation flag.
  if (!options.skipValidation) {
    const rawLabels = options.labels ? splitList(options.labels) : null;
    const description = resolveDescription(options);
    const validationResult = validateIssueCreation({
      labels: rawLabels,
      description: description || undefined,
      title,
      assignee: options.assignee,
      project: options.project,
    });

    // Apply normalized labels back so resolution uses the canonical names
    if (validationResult.normalizedLabels) {
      options.labels = validationResult.normalizedLabels.join(",");
    }

    enforceValidation(validationResult);
  }
  if (!options.priority) {
    outputWarning(
      "Creating issue without --priority. Consider specifying it for better triage.",
      "missing_fields",
    );
  }

  const teamInput = options.team || config.defaultTeam;
  const teamId = resolveTeam(teamInput);
  const assigneeId = options.assignee
    ? await resolveAssignee(options.assignee, rootOpts)
    : undefined;

  let labelIds: string[] = [];
  if (options.labels) {
    labelIds = resolveLabels(splitList(options.labels), teamInput);
  }
  if (options.claude) {
    const claudeId = config.labels.workspace.claude;
    if (claudeId && !labelIds.includes(claudeId)) {
      labelIds.push(claudeId);
    }
  }

  const status = resolveDefaultStatus({
    explicitStatus: options.status,
    hasAssignee: !!assigneeId,
    hasProject: !!options.project,
  });

  let subscriberIds: string[] | undefined;
  if (options.subscriber) {
    subscriberIds = splitList(options.subscriber).map((s: string) => resolveMember(s));
  }

  return { teamInput, teamId, assigneeId, labelIds, status, subscriberIds };
}

interface UploadResult {
  assetUrl: string;
  filename: string;
  success: true;
}

async function uploadAttachmentsIfNeeded(
  options: OptionValues,
  rootOpts: OptionValues,
): Promise<UploadResult[]> {
  if (!options.attachment) {
    return [];
  }
  const paths: string[] = Array.isArray(options.attachment)
    ? options.attachment
    : [options.attachment];
  const apiToken = getApiToken(rootOpts);
  const fileService = new FileService(apiToken);
  const results: UploadResult[] = [];
  for (const filePath of paths) {
    const result = await fileService.uploadFile(filePath);
    if (!result.success) {
      throw new Error(`Attachment upload failed for ${filePath}: ${result.error}`);
    }
    results.push(result);
  }
  return results;
}

function buildDescriptionWithAttachments(
  baseDescription: string,
  uploadResults: UploadResult[],
): string {
  let description = baseDescription;
  for (const uploadResult of uploadResults) {
    if (isImageFile(uploadResult.filename)) {
      const imageMarkdown = `\n\n![${uploadResult.filename}](${uploadResult.assetUrl})`;
      description = description ? description + imageMarkdown : imageMarkdown.trimStart();
    }
  }
  return description;
}

async function handleCreateIssue(
  title: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const { teamInput, teamId, assigneeId, labelIds, status, subscriberIds } =
    await resolveCreateInputs(title, options, rootOpts);

  const uploadResults = await uploadAttachmentsIfNeeded(options, rootOpts);
  const description = buildDescriptionWithAttachments(
    resolveDescription(options) || "",
    uploadResults,
  );

  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const issuesService = new GraphQLIssuesService(graphQLService, linearService);

  // Wrap valid issue identifiers as markdown links before creating, so the description
  // saved on Linear has clickable refs from the start. Self-reference can't apply here
  // because the issue doesn't exist yet — pass undefined.
  const prepared = await prepareAutoLinkedDescription(
    description || undefined,
    options,
    undefined,
    linearService,
  );

  const result = await issuesService.createIssue({
    title,
    teamId,
    teamInput,
    description: prepared.description,
    assigneeId,
    priority: options.priority ? validatePriority(options.priority) : undefined,
    projectId: options.project,
    statusId: status,
    labelIds: labelIds.length > 0 ? labelIds : undefined,
    parentId: options.parentTicket,
    milestoneId: options.projectMilestone,
    cycleId: options.cycle,
    subscriberIds,
    dueDate: options.dueDate,
  });
  const relations = await createRelations(result.id, options, graphQLService, linearService);
  const autoLinked = await maybeAutoLink({
    issueId: result.id,
    identifier: result.identifier,
    description: prepared.description,
    options,
    preResolved: prepared.preResolved,
    graphQLService,
    linearService,
  });

  // Images are already embedded inline as markdown in the description,
  // so only create separate attachment records for non-image files.
  const attachments: LinearAttachment[] = [];
  if (uploadResults.length > 0) {
    const attachmentsService = createGraphQLAttachmentsService(rootOpts);
    for (const uploadResult of uploadResults) {
      if (!isImageFile(uploadResult.filename)) {
        const attachment = await attachmentsService.createAttachment({
          issueId: result.id,
          url: uploadResult.assetUrl,
          title: uploadResult.filename,
        });
        attachments.push(attachment);
      }
    }
  }

  let branch: string | undefined;
  if (options.checkout && result.branchName) {
    branch = toBranchName(result.branchName);
    gitCheckoutBranch(branch);
  }

  const output = {
    ...result,
    ...(branch ? { branch } : {}),
    ...(relations.length > 0 ? { relations } : {}),
    ...(autoLinked ? { autoLinked } : {}),
    ...(attachments.length === 1
      ? { attachment: attachments[0] }
      : attachments.length > 1
        ? { attachments }
        : {}),
  };
  outputSuccess(output);
}

async function handleHistoryIssue(
  issueId: string,
  _options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);

  const resolvedId = await linearService.resolveIssueId(issueId);
  const result = await graphQLService.rawRequest(GET_ISSUE_STATE_HISTORY_QUERY, {
    id: resolvedId,
  });

  if (!result.issue) {
    throw new Error(`Issue "${issueId}" not found`);
  }

  const issue = result.issue as GraphQLResponseData;
  const stateHistory = issue.stateHistory as GraphQLResponseData | undefined;
  const spans: IssueStateSpan[] = (
    (stateHistory?.nodes as GraphQLResponseData[] | undefined) ?? []
  ).map((span: GraphQLResponseData) => ({
    state: {
      id: (span.state as GraphQLResponseData).id as string,
      name: (span.state as GraphQLResponseData).name as string,
      type: (span.state as GraphQLResponseData).type as string,
    },
    startedAt: span.startedAt as string,
    endedAt: (span.endedAt as string) || undefined,
  }));

  outputSuccess({
    id: issue.id as string,
    identifier: issue.identifier as string,
    title: issue.title as string,
    stateHistory: spans,
    meta: { count: spans.length },
  });
}

async function handleRelateIssue(
  issueId: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);

  const sourceId = await linearService.resolveIssueId(issueId);
  const relations = await createRelations(sourceId, options, graphQLService, linearService);

  if (relations.length === 0) {
    throw new Error(
      "Specify at least one of: --related-to, --blocks, --blocked-by, --duplicate-of",
    );
  }

  outputSuccess({
    data: relations,
    meta: { count: relations.length, source: issueId },
  });
}

interface RelatedIssueEntry {
  direction: "outgoing" | "incoming";
  id: string;
  issue: {
    id: string;
    identifier: string;
    title: string;
    state?: { id: string; name: string };
    priority?: number;
    assignee?: { id: string; name: string };
    team?: { id: string; key: string; name: string };
  };
  type: string;
}

/**
 * Invert relation type for incoming (inverse) relations so the output
 * reads naturally from the perspective of the queried issue.
 * e.g. if DEV-100 "blocks" DEV-200, and we query DEV-200,
 * the inverse relation type is "blocks" but direction is incoming → "blockedBy".
 */
function normalizeInverseType(type: string): string {
  if (type === "blocks") {
    return "blockedBy";
  }
  return type;
}

function buildRelatedIssueSummary(peer: GraphQLResponseData): RelatedIssueEntry["issue"] {
  const state = peer.state as GraphQLResponseData | undefined;
  const assignee = peer.assignee as GraphQLResponseData | undefined;
  const team = peer.team as GraphQLResponseData | undefined;
  return {
    id: peer.id as string,
    identifier: peer.identifier as string,
    title: peer.title as string,
    ...(state ? { state: { id: state.id as string, name: state.name as string } } : {}),
    ...(peer.priority == null ? {} : { priority: peer.priority as number }),
    ...(assignee ? { assignee: { id: assignee.id as string, name: assignee.name as string } } : {}),
    ...(team
      ? { team: { id: team.id as string, key: team.key as string, name: team.name as string } }
      : {}),
  };
}

function buildRelationEntries(
  nodes: GraphQLResponseData[] | undefined,
  peerKey: "relatedIssue" | "issue",
  direction: "outgoing" | "incoming",
  normalizeType: (raw: string) => string,
): RelatedIssueEntry[] {
  const entries: RelatedIssueEntry[] = [];
  for (const rel of nodes ?? []) {
    const peer = rel[peerKey] as GraphQLResponseData | undefined;
    if (!peer) {
      continue;
    }
    entries.push({
      id: rel.id as string,
      type: normalizeType(rel.type as string),
      direction,
      issue: buildRelatedIssueSummary(peer),
    });
  }
  return entries;
}

async function handleRelatedIssues(
  issueId: string,
  _options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);

  const resolvedId = await linearService.resolveIssueId(issueId);
  const result = await graphQLService.rawRequest(GET_ISSUE_RELATIONS_QUERY, {
    id: resolvedId,
  });

  if (!result.issue) {
    throw new Error(`Issue "${issueId}" not found`);
  }

  const issue = result.issue as GraphQLResponseData;
  const relations = issue.relations as GraphQLResponseData | undefined;
  const inverseRelations = issue.inverseRelations as GraphQLResponseData | undefined;

  const entries: RelatedIssueEntry[] = [
    ...buildRelationEntries(
      relations?.nodes as GraphQLResponseData[] | undefined,
      "relatedIssue",
      "outgoing",
      (raw) => raw,
    ),
    ...buildRelationEntries(
      inverseRelations?.nodes as GraphQLResponseData[] | undefined,
      "issue",
      "incoming",
      normalizeInverseType,
    ),
  ];

  outputSuccess({
    id: issue.id as string,
    identifier: issue.identifier as string,
    title: issue.title as string,
    data: entries,
    meta: { count: entries.length },
  });
}

async function fetchCommentBodies(
  issueUuid: string,
  graphQLService: GraphQLService,
): Promise<string[]> {
  const result = await graphQLService.rawRequest(LIST_COMMENTS_QUERY, {
    issueId: issueUuid,
    first: 250,
  });
  const issue = result.issue as GraphQLResponseData | undefined;
  const comments = issue?.comments as GraphQLResponseData | undefined;
  const nodes = (comments?.nodes as GraphQLResponseData[] | undefined) ?? [];
  return nodes
    .map((c) => c.body as string | null | undefined)
    .filter((b): b is string => typeof b === "string" && b.length > 0);
}

async function linkReferencesForIssue(args: {
  issueUuid: string;
  identifier: string;
  description: string;
  includeComments: boolean;
  dryRun: boolean;
  graphQLService: GraphQLService;
  linearService: LinearService;
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
  const issueResult = await graphQLService.rawRequest(GET_ISSUE_RELATIONS_QUERY, {
    id: resolvedId,
  });
  if (!issueResult.issue) {
    throw new Error(`Issue "${issueId}" not found`);
  }
  const issue = issueResult.issue as GraphQLResponseData;
  const identifier = issue.identifier as string;
  const description = (issue.description as string | null | undefined) ?? "";

  const dryRun = Boolean(options.dryRun);
  const includeComments = Boolean(options.includeComments);
  const autoLinked = await linkReferencesForIssue({
    issueUuid: resolvedId,
    identifier,
    description,
    includeComments,
    dryRun,
    graphQLService,
    linearService,
  });

  outputSuccess({
    id: resolvedId,
    identifier,
    title: issue.title as string,
    autoLinked,
    meta: { dryRun, includeComments },
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
  const limit = options.limit ? Number.parseInt(options.limit as string, 10) : 100;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`--limit must be a positive integer, got: ${options.limit}`);
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
  const totalLinked = entries.reduce((n, e) => n + e.autoLinked.linked.length, 0);
  const totalSkipped = entries.reduce((n, e) => n + e.autoLinked.skipped.length, 0);
  const totalFailed = entries.reduce((n, e) => n + e.autoLinked.failed.length, 0);

  outputSuccess({
    data: entries,
    meta: {
      count: entries.length,
      team: teamInput,
      dryRun,
      includeComments,
      totals: { linked: totalLinked, skipped: totalSkipped, failed: totalFailed },
    },
  });
}

function handleLinkReferencesIssue(
  issueIdOrTeamFlag: string | undefined,
  options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);

  if (options.team) {
    if (issueIdOrTeamFlag) {
      throw new Error(
        "Provide either an issueId positional argument OR --team, not both. With --team, omit the issueId.",
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
    throw new Error("issueId is required (or use --team <key> to scan a whole team)");
  }
  return handleLinkReferencesSingle(issueIdOrTeamFlag, options, graphQLService, linearService);
}

async function handleReadIssue(
  issueIds: string[],
  _options: OptionValues,
  command: Command,
): Promise<void> {
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const issuesService = new GraphQLIssuesService(graphQLService, linearService);
  const apiToken = getApiToken(rootOpts);
  if (issueIds.length === 1) {
    const issue = await issuesService.getIssueById(issueIds[0]);
    const resolved = await downloadLinearUploads(issue, apiToken);
    outputSuccess(resolved);
  } else {
    const results = await Promise.all(
      issueIds.map(async (id) => {
        const issue = await issuesService.getIssueById(id);
        return downloadLinearUploads(issue, apiToken);
      }),
    );
    outputSuccess(results);
  }
}

async function handleUpdateIssue(
  issueId: string,
  options: OptionValues,
  command: Command,
): Promise<void> {
  // Normalize aliases
  if (options.state && !options.status) {
    options.status = options.state;
  }
  if (options.label && !options.labels) {
    options.labels = options.label;
  }
  // Resolve --description-file before validation
  if (options.descriptionFile) {
    options.description = readDescriptionFile(options.descriptionFile);
  }
  validateUpdateOptions(options);
  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);

  if (options.appendDescription) {
    const resolved = await linearService.resolveIssueId(issueId);
    const current = await graphQLService.rawRequest(
      "query($id: String!) { issue(id: $id) { description } }",
      { id: resolved },
    );
    const issue = current.issue as GraphQLResponseData | undefined;
    const existing = (issue?.description as string) ?? "";
    options.description = `${existing}\n${options.appendDescription}`;
  }

  if (options.title || options.description) {
    enforceBrandName(options.title || "", options.description, options.strict);
  }
  // Wrap valid refs as markdown links before sending the update. Idempotent against
  // already-wrapped refs (the wrapper skips text inside existing markdown link syntax).
  const prepared = options.description
    ? await prepareAutoLinkedDescription(
        options.description as string,
        options,
        undefined,
        linearService,
      )
    : { description: undefined, preResolved: new Map<string, string>(), rewritten: false };
  if (prepared.description !== undefined) {
    options.description = prepared.description;
  }

  const issuesService = new GraphQLIssuesService(graphQLService, linearService);
  const assigneeId = options.assignee
    ? await resolveAssignee(options.assignee, rootOpts)
    : undefined;
  const updateArgs = buildUpdateArgs(issueId, options, assigneeId);
  const result = await issuesService.updateIssue(updateArgs, options.labelBy || "adding");
  const autoLinked = options.description
    ? await maybeAutoLink({
        issueId: result.id,
        identifier: result.identifier,
        description: options.description as string,
        options,
        preResolved: prepared.preResolved,
        graphQLService,
        linearService,
      })
    : undefined;
  outputSuccess(autoLinked ? { ...result, autoLinked } : result);
}

async function handleRetrolink(options: OptionValues, command: Command): Promise<void> {
  // 1. Read current branch
  let currentBranch: string;
  try {
    currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch {
    throw new Error("Not inside a git repository.");
  }
  if (currentBranch === "main" || currentBranch === "master") {
    throw new Error(`Cannot retrolink the '${currentBranch}' branch.`);
  }

  // 2. Read commit messages on this branch vs base
  const base = options.base || "main";
  let commitLog: string;
  try {
    commitLog = execFileSync("git", ["log", `${base}..HEAD`, "--oneline"], {
      stdio: "pipe",
    })
      .toString()
      .trim();
  } catch {
    commitLog = "";
  }

  const commits = commitLog
    ? commitLog.split("\n").map((line: string) => line.replace(COMMIT_HASH_PREFIX_REGEX, ""))
    : [];

  // 3. Build title and description
  const title = options.title || (commits.length > 0 ? commits[0] : currentBranch);
  const description =
    commits.length > 0
      ? commits.map((msg: string) => `- ${msg}`).join("\n")
      : `Retrolinked from branch: ${currentBranch}`;

  const rootOpts = command.parent!.parent!.opts();
  const graphQLService = createGraphQLService(rootOpts);
  const linearService = createLinearService(rootOpts);
  const issuesService = new GraphQLIssuesService(graphQLService, linearService);

  let result: LinearIssue;

  if (options.issue) {
    // Link to existing issue — fetch it and rename branch
    const issueId = options.issue as string;
    result = await issuesService.getIssueById(issueId);
  } else {
    // Create new issue
    const config = loadConfig();
    const teamInput = options.team || config.defaultTeam;
    if (!teamInput) {
      throw new Error("Team is required. Use --team or set a defaultTeam in config.");
    }
    const teamId = resolveTeam(teamInput);

    result = await issuesService.createIssue({
      title,
      teamId,
      description,
    });
  }

  // Rename branch to match issue
  const oldBranch = currentBranch;
  let newBranch: string | undefined;
  if (result.branchName) {
    newBranch = toBranchName(result.branchName);
    execFileSync("git", ["branch", "-m", oldBranch, newBranch], { stdio: "pipe" });
  }

  outputSuccess({
    ...result,
    oldBranch,
    ...(newBranch ? { branch: newBranch } : {}),
  });
}

export function setupIssuesCommands(program: Command): void {
  const issues = program.command("issues").alias("issue").description("Issue operations");
  issues.action(() => issues.help());

  issues
    .command("list")
    .description("List issues.")
    .option("-l, --limit <number>", "limit results", "25")
    .option("--team <team>", "filter by team key (EL: resolves names)")
    .option("--assignee <assignee>", "filter by assignee (name, alias, or ID)")
    .option("--project <project>", "filter by project name or ID")
    .option("--no-project", "filter issues with no project assigned")
    .option("--labels <labels>", "filter by labels (comma-separated names)")
    .option("--label <labels>", "alias for --labels")
    .option("--status <status>", "filter by status (comma-separated, e.g. Todo,Backlog)")
    .option(
      "--priority <priority>",
      "filter by priority (comma-separated: urgent,high,medium,low,none or 0-4)",
    )
    .option("--sort <field>", "sort results (priority, status, created, updated)")
    .option("--format <format>", "output format (json, table, md, csv)", "json")
    .option(
      "--fields <fields>",
      "columns for table/csv (comma-separated: identifier,title,status,priority,assignee,project,team,labels,updated)",
    )
    .action(handleAsyncCommand(handleListIssues));

  issues
    .command("search <query>")
    .description("Search issues.")
    .option("--team <team>", "filter by team key, name, or ID")
    .option("--assignee <assignee>", "filter by assignee (name, alias, or ID)")
    .option("--project <project>", "filter by project name or ID")
    .option("--no-project", "filter issues with no project assigned")
    .option("--status <status>", "filter by status (comma-separated)")
    .option("--labels <labels>", "filter by labels (comma-separated names)")
    .option("--label <labels>", "alias for --labels")
    .option(
      "--priority <priority>",
      "filter by priority (comma-separated: urgent,high,medium,low,none or 0-4)",
    )
    .option("--sort <field>", "sort results (priority, status, created, updated)")
    .option("--format <format>", "output format (json, table, md, csv)", "json")
    .option("--fields <fields>", "columns for table/csv output")
    .option("-l, --limit <number>", "limit results", "10")
    .action(handleAsyncCommand(handleSearchIssues));

  issues
    .command("create [title]")
    .description(
      "Create new issue (EL-enhanced: name/alias resolution, brand validation, status defaults).",
    )
    .option("-t, --title <title>", "issue title (alternative to positional argument)")
    .option("-d, --description <desc>", "issue description")
    .option("--description-file <path>", "read description from file (use - for stdin)")
    .option("-a, --assignee <assignee>", "assign to user (name, alias, or UUID)")
    .option("-p, --priority <priority>", "priority: name (urgent/high/medium/low) or number (1-4)")
    .option("--project <project>", "add to project (name or ID)")
    .option("--team <team>", "team key or name (default: from config)")
    .option("--labels <labels>", "labels (comma-separated names, auto-resolved per team)")
    .option("--label <labels>", "alias for --labels")
    .option("--claude", "add the workspace-level 'claude' label")
    .option("--project-milestone <milestone>", "project milestone name or ID")
    .option("--cycle <cycle>", "cycle name or ID")
    .option("--status <status>", "status name or ID")
    .option("--parent-ticket <parentId>", "parent issue ID or identifier")
    .option("--subscriber <subscribers>", "subscribers (comma-separated names, aliases, or UUIDs)")
    .option("--strict", "strict brand validation (error instead of warning)")
    .option("--related-to <issues>", "related issues (comma-separated identifiers)")
    .option("--blocks <issues>", "issues this blocks (comma-separated identifiers)")
    .option("--blocked-by <issues>", "issues blocking this (comma-separated identifiers)")
    .option(
      "--attachment <path>",
      "attach a file (image, PDF, etc.) to the created issue (repeatable)",
      (value: string, prev: string[] | undefined) => (prev ? [...prev, value] : [value]),
    )
    .option("--due-date <date>", "due date (YYYY-MM-DD)")
    .option("--checkout", "create and checkout a git branch named after the issue")
    .option("--skip-validation", "skip all validation (labels, description, assignee, project)")
    .option("--no-auto-link", "skip auto-linking issue references found in the description")
    .action(
      handleAsyncCommand(
        (titleArg: string | undefined, options: OptionValues, command: Command) => {
          // Normalize --label alias to --labels
          if (options.label && !options.labels) {
            options.labels = options.label;
          }
          const title = options.title || titleArg;
          if (!title) {
            throw new Error(
              "Title is required. Provide it as a positional argument or with --title.",
            );
          }
          return handleCreateIssue(title, options, command);
        },
      ),
    );

  issues
    .command("read <issueId...>")
    .alias("view")
    .alias("get")
    .alias("show")
    .description("Get issue details. Accepts multiple IDs for batch retrieval.")
    .addHelpText(
      "after",
      "\nBoth UUID and identifiers like ABC-123 are supported.\nMultiple IDs: el-linear issue get DEV-123 DEV-456 DEV-789",
    )
    .action(handleAsyncCommand(handleReadIssue));

  issues
    .command("update <issueId>")
    .alias("edit")
    .alias("set")
    .description("Update an issue (EL-enhanced: name/alias resolution).")
    .addHelpText("after", "\nBoth UUID and identifiers like ABC-123 are supported.")
    .option("-t, --title <title>", "new title")
    .option("-d, --description <desc>", "new description")
    .option("--description-file <path>", "read description from file (use - for stdin)")
    .option("--append-description <text>", "append text to the existing description")
    .option("-s, --status <status>", "new status name or ID")
    .option("--state <status>", "alias for --status (new status name or ID)")
    .option(
      "-p, --priority <priority>",
      "new priority: name (urgent/high/medium/low) or number (1-4)",
    )
    .option("--assignee <assignee>", "new assignee (name, alias, or UUID)")
    .option("--project <project>", "new project (name or ID)")
    .option("--labels <labels>", "labels (comma-separated names or IDs)")
    .option("--label <labels>", "alias for --labels")
    .option("--label-by <mode>", "how to apply labels: 'adding' (default) or 'overwriting'")
    .option("--clear-labels", "remove all labels from issue")
    .option("--parent-ticket <parentId>", "set parent issue")
    .option("--clear-parent-ticket", "clear parent relationship")
    .option("--project-milestone <milestone>", "set project milestone")
    .option("--clear-project-milestone", "clear project milestone")
    .option("--cycle <cycle>", "set cycle")
    .option("--clear-cycle", "clear cycle")
    .option("--due-date <date>", "due date (YYYY-MM-DD)")
    .option("--clear-due-date", "clear due date")
    .option("--strict", "strict brand validation")
    .option("--no-auto-link", "skip auto-linking issue references found in the description")
    .action(handleAsyncCommand(handleUpdateIssue));

  issues
    .command("history <issueId>")
    .description("Show issue state transition history (time in each status).")
    .addHelpText("after", "\nBoth UUID and identifiers like ABC-123 are supported.")
    .action(handleAsyncCommand(handleHistoryIssue));

  issues
    .command("relate <issueId>")
    .description("Create issue relations.")
    .option("--related-to <issues>", "related issues (comma-separated)")
    .option("--blocks <issues>", "issues this blocks (comma-separated)")
    .option("--blocked-by <issues>", "issues blocking this (comma-separated)")
    .option("--duplicate-of <issue>", "mark as duplicate of another issue")
    .action(handleAsyncCommand(handleRelateIssue));

  issues
    .command("related <issueId>")
    .alias("relations")
    .description("List all relations for an issue (related, blocks, blockedBy, duplicate).")
    .addHelpText("after", "\nBoth UUID and identifiers like ABC-123 are supported.")
    .action(handleAsyncCommand(handleRelatedIssues));

  issues
    .command("link-references [issueId]")
    .description(
      "Scan an issue's description (and optionally comments) for issue identifiers and auto-create relations for any not already linked. Default relation is 'related'; prose keywords like 'blocked by' or 'duplicates' upgrade the type.",
    )
    .addHelpText(
      "after",
      "\nBoth UUID and identifiers like ABC-123 are supported.\nSkips references that already have any relation (related, blocks, blockedBy, duplicate) to the source issue.\nKeyword detection: 'blocked by'/'depends on' → blocks, 'blocks' → blocks, 'duplicates'/'duplicate of' → duplicate, 'duplicated by' → duplicate (reversed).\nUse --team <key> to backfill an entire team instead of a single issue.",
    )
    .option("--dry-run", "show what would be linked without creating relations")
    .option("--include-comments", "also scan comment bodies for references")
    .option("--team <team>", "batch mode: scan all issues in a team (omit issueId)")
    .option("--limit <number>", "max issues to scan in --team mode", "100")
    .action(handleAsyncCommand(handleLinkReferencesIssue));

  issues
    .command("retrolink")
    .description(
      "Link current branch to a Linear issue. Creates a new issue by default, or links to an existing one with --issue.",
    )
    .option("--issue <issueId>", "link to an existing issue instead of creating one (e.g. INF-459)")
    .option("--team <team>", "team key or name (required if creating, not needed with --issue)")
    .option("--title <title>", "override auto-generated title (default: first commit message)")
    .option("--base <branch>", "base branch for log comparison", "main")
    .action(handleAsyncCommand(handleRetrolink));
}
