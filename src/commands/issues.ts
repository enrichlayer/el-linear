import { execFileSync } from "node:child_process";
import type { Command, OptionValues } from "commander";
import { loadConfig } from "../config/config.js";
import {
	enforceValidation,
	validateIssueCreation,
} from "../config/issue-validation.js";
import {
	resolveAssignee,
	resolveLabels,
	resolveMember,
	resolveTeam,
} from "../config/resolver.js";
import { resolveDefaultStatus } from "../config/status-defaults.js";
import { enforceTerms } from "../config/term-enforcer.js";
import {
	GET_ISSUE_RELATIONS_QUERY,
	GET_ISSUE_STATE_HISTORY_QUERY,
} from "../queries/issues.js";
import type {
	GetIssueRelationsResponse,
	GetIssueStateHistoryResponse,
} from "../queries/issues-types.js";
import type {
	IssueStateSpan,
	LinearAttachment,
	LinearIssue,
	LinearPriority,
} from "../types/linear.js";
import { createFileService } from "../utils/file-service.js";
import { applyFooter } from "../utils/footer.js";
import { createGraphQLAttachmentsService } from "../utils/graphql-attachments-service.js";
import {
	GraphQLIssuesService,
	type SearchIssueArgs,
	type UpdateIssueArgs,
} from "../utils/graphql-issues-service.js";
import { createGraphQLService } from "../utils/graphql-service.js";
import { createLinearService } from "../utils/linear-service.js";
import { logger } from "../utils/logger.js";
import {
	handleAsyncCommand,
	outputSuccess,
	outputWarning,
} from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import {
	formatCsv,
	formatMarkdown,
	formatTable,
} from "../utils/table-formatter.js";
import {
	parsePositiveInt,
	parsePriorityFilter,
	splitList,
	validatePriority,
} from "../utils/validators.js";
import { gitCheckoutBranch, toBranchName } from "./issues/branch.js";
import {
	maybeAutoLink,
	prepareAutoLinkedDescription,
	readDescriptionFile,
	resolveDescription,
} from "./issues/description.js";
import { handleLinkReferencesIssue } from "./issues/link-references.js";
import {
	buildIncomingRelationEntries,
	buildOutgoingRelationEntries,
	createRelations,
	type RelatedIssueEntry,
} from "./issues/relations.js";
import { readIssues } from "./read-shortcut.js";

const IMAGE_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".svg",
	".ico",
]);

const COMMIT_HASH_PREFIX_REGEX = /^[a-f0-9]+ /;

function isImageFile(filename: string): boolean {
	const ext = filename.lastIndexOf(".");
	return ext !== -1 && IMAGE_EXTENSIONS.has(filename.slice(ext).toLowerCase());
}

function validateUpdateOptions(options: OptionValues): void {
	if (options.parentTicket && options.clearParentTicket) {
		throw new Error(
			"Cannot use --parent-ticket and --clear-parent-ticket together",
		);
	}
	if (options.projectMilestone && options.clearProjectMilestone) {
		throw new Error(
			"Cannot use --project-milestone and --clear-project-milestone together",
		);
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
		throw new Error(
			"Cannot use --description and --append-description together",
		);
	}
}

function buildUpdateArgs(
	issueId: string,
	options: OptionValues,
	assigneeId?: string,
): UpdateIssueArgs {
	let labelIds: string[] | undefined;
	if (options.clearLabels) {
		labelIds = [];
	} else if (options.labels) {
		labelIds = splitList(options.labels);
	}

	// On update, fall back to config.defaultPriority only when --priority
	// wasn't passed. This keeps every update setting a priority for users who
	// want a workspace-wide baseline (e.g. all unassigned triage tickets bump
	// to "medium"). To leave priority untouched, omit defaultPriority from
	// config — the field is opt-in.
	const priorityInput =
		typeof options.priority === "string"
			? options.priority
			: loadConfig().defaultPriority;

	return {
		id: issueId,
		title: options.title,
		description: options.description,
		statusId: options.status,
		priority: priorityInput ? validatePriority(priorityInput) : undefined,
		assigneeId,
		projectId: options.project,
		labelIds,
		parentId:
			options.parentTicket || (options.clearParentTicket ? null : undefined),
		milestoneId:
			options.projectMilestone ||
			(options.clearProjectMilestone ? null : undefined),
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

function sortIssues(
	issues: LinearIssue[],
	sort: string | undefined,
): LinearIssue[] {
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
			sorted.sort((a, b) =>
				(a.state?.name ?? "").localeCompare(b.state?.name ?? ""),
			);
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

async function handleListIssues(
	options: OptionValues,
	command: Command,
): Promise<void> {
	if (options.label && !options.labels) {
		options.labels = options.label;
	}
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
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
		const searchArgs: SearchIssueArgs = {
			teamId: options.team ? resolveTeam(options.team) : undefined,
			assigneeId: options.assignee
				? await resolveAssignee(options.assignee, rootOpts)
				: undefined,
			projectId: options.project || undefined,
			noProject: options.project === false,
			labelNames: options.labels ? splitList(options.labels) : undefined,
			status: options.status ? splitList(options.status) : undefined,
			priority: options.priority
				? parsePriorityFilter(options.priority)
				: undefined,
			orderBy: options.sort === "created" ? "createdAt" : "updatedAt",
			limit: parsePositiveInt(options.limit, "--limit"),
		};
		const result = sortIssues(
			await issuesService.searchIssues(searchArgs),
			options.sort,
		);
		outputIssues(result, options.format, options.fields, {
			team: options.team,
		});
	} else {
		const result = sortIssues(
			await issuesService.getIssues(parsePositiveInt(options.limit, "--limit")),
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
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const issuesService = new GraphQLIssuesService(graphQLService, linearService);

	const searchArgs: SearchIssueArgs = {
		query,
		teamId: options.team ? resolveTeam(options.team) : undefined,
		assigneeId: options.assignee
			? await resolveAssignee(options.assignee, rootOpts)
			: undefined,
		projectId: options.project || undefined,
		noProject: options.project === false,
		status: options.status ? splitList(options.status) : undefined,
		labelNames: options.labels ? splitList(options.labels) : undefined,
		priority: options.priority
			? parsePriorityFilter(options.priority)
			: undefined,
		limit: parsePositiveInt(options.limit, "--limit"),
	};
	const result = sortIssues(
		await issuesService.searchIssues(searchArgs),
		options.sort,
	);
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
	/** Resolved priority (0-4) or undefined when no priority was set
	 * by --priority or config.defaultPriority. */
	priority: LinearPriority | undefined;
}> {
	const config = loadConfig();
	enforceTerms([title, options.description], { strict: options.strict });

	// Effective assignee: explicit --assignee wins; --no-assignee (commander
	// parses as `assignee === false`) skips both flag and config; otherwise
	// fall back to config.defaultAssignee. Computed BEFORE validation so the
	// "assignee required" rule sees the resolved value, not undefined.
	const noAssignee = options.assignee === false;
	const explicitAssignee =
		typeof options.assignee === "string" ? options.assignee : undefined;
	const effectiveAssignee = noAssignee
		? undefined
		: (explicitAssignee ?? config.defaultAssignee);

	// Effective priority: explicit --priority wins; otherwise fall back to
	// config.defaultPriority. Both go through validatePriority so a bad config
	// value fails fast with a useful error.
	const effectivePriorityInput =
		typeof options.priority === "string"
			? options.priority
			: config.defaultPriority;

	// --- Validation (labels, description, assignee, project, title) ---
	// Controlled by config.validation.enabled (default: true).
	// Bypassed by --skip-validation flag, OR by --from-template which
	// defers field provision to Linear's server-side template
	// instantiation. With --from-template + no overrides, the
	// resulting issue inherits title/description/labels/etc. from the
	// template — running the local validator against undefined fields
	// would produce a false-negative "Missing --labels" error.
	const hasFromTemplate =
		typeof options.fromTemplate === "string" && options.fromTemplate;
	if (!options.skipValidation && !hasFromTemplate) {
		const rawLabels = options.labels ? splitList(options.labels) : null;
		const description = resolveDescription(options);
		const validationResult = validateIssueCreation({
			labels: rawLabels,
			description: description || undefined,
			title,
			assignee: effectiveAssignee,
			project: options.project,
		});

		// Apply normalized labels back so resolution uses the canonical names
		if (validationResult.normalizedLabels) {
			options.labels = validationResult.normalizedLabels.join(",");
		}

		enforceValidation(validationResult);
	}
	if (!effectivePriorityInput) {
		outputWarning(
			"Creating issue without --priority. Consider specifying it for better triage.",
		);
	}

	const teamInput = options.team || config.defaultTeam;
	const teamId = resolveTeam(teamInput);
	const assigneeId = effectiveAssignee
		? await resolveAssignee(effectiveAssignee, rootOpts)
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
		subscriberIds = splitList(options.subscriber).map((s: string) =>
			resolveMember(s),
		);
	}

	const priority = effectivePriorityInput
		? validatePriority(effectivePriorityInput)
		: undefined;

	return {
		teamInput,
		teamId,
		assigneeId,
		labelIds,
		status,
		subscriberIds,
		priority,
	};
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
	const fileService = await createFileService(rootOpts);
	const results: UploadResult[] = [];
	for (const filePath of paths) {
		const result = await fileService.uploadFile(filePath);
		if (!result.success) {
			throw new Error(
				`Attachment upload failed for ${filePath}: ${result.error}`,
			);
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
			description = description
				? description + imageMarkdown
				: imageMarkdown.trimStart();
		}
	}
	return description;
}

async function handleCreateIssue(
	title: string | undefined,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const {
		teamInput,
		teamId,
		assigneeId,
		labelIds,
		status,
		subscriberIds,
		priority,
	} = await resolveCreateInputs(title ?? "", options, rootOpts);

	const uploadResults = await uploadAttachmentsIfNeeded(options, rootOpts);
	const descriptionWithAttachments = buildDescriptionWithAttachments(
		resolveDescription(options) || "",
		uploadResults,
	);
	// Append messageFooter (config or --footer flag) so auto-link picks up any
	// issue refs in the footer too. --no-footer skips both flag and config.
	// Commander parses --no-footer as `options.footer === false`.
	const noFooter = options.footer === false;
	const explicitFooter =
		typeof options.footer === "string" ? options.footer : undefined;
	const description =
		applyFooter(descriptionWithAttachments, {
			footer: explicitFooter,
			noFooter,
		}) ?? "";

	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const issuesService = new GraphQLIssuesService(graphQLService, linearService);

	// Wrap valid issue identifiers as markdown links before creating, so the description
	// saved on Linear has clickable refs from the start. Self-reference can't apply here
	// because the issue doesn't exist yet — pass undefined.
	const prepared = await prepareAutoLinkedDescription(
		description || undefined,
		options,
		undefined,
		linearService,
		graphQLService,
	);

	const result = await issuesService.createIssue({
		// title is omitted when --from-template is set without an override,
		// so Linear copies the template's title server-side.
		...(title ? { title } : {}),
		teamId,
		teamInput,
		description: prepared.description,
		assigneeId,
		priority,
		projectId: options.project,
		statusId: status,
		labelIds: labelIds.length > 0 ? labelIds : undefined,
		parentId: options.parentTicket,
		milestoneId: options.projectMilestone,
		cycleId: options.cycle,
		subscriberIds,
		dueDate: options.dueDate,
		// Linear server-side template instantiation. When set,
		// Linear copies the template's title/description/labels/priority
		// onto the new issue; any explicit field above wins by override.
		...(typeof options.fromTemplate === "string" && options.fromTemplate
			? { templateId: options.fromTemplate as string }
			: {}),
	});
	const relations = await createRelations(
		result.id,
		options,
		graphQLService,
		linearService,
	);
	// Pass the ORIGINAL description (pre-wrap) so the extractor's prose-keyword inference
	// ("blocked by", "duplicates", etc.) sees `keyword DEV-100` instead of `keyword [DEV-100](url)`.
	// After wrapping, the keyword regex's trailing-whitespace anchor fails to match the inserted `[`.
	const autoLinked = await maybeAutoLink({
		issueId: result.id,
		identifier: result.identifier,
		description: description || undefined,
		options,
		preResolved: prepared.preResolved,
		graphQLService,
		linearService,
	});

	// Images are already embedded inline as markdown in the description,
	// so only create separate attachment records for non-image files.
	const attachments: LinearAttachment[] = [];
	if (uploadResults.length > 0) {
		const attachmentsService = await createGraphQLAttachmentsService(rootOpts);
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
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);

	const resolvedId = await linearService.resolveIssueId(issueId);
	const result = await graphQLService.rawRequest<GetIssueStateHistoryResponse>(
		GET_ISSUE_STATE_HISTORY_QUERY,
		{ id: resolvedId },
	);

	if (!result.issue) {
		throw new Error(`Issue "${issueId}" not found`);
	}

	const issue = result.issue;
	const spans: IssueStateSpan[] = issue.stateHistory.nodes.map((span) => ({
		state: {
			id: span.state.id,
			name: span.state.name,
			type: span.state.type,
		},
		startedAt: span.startedAt,
		endedAt: span.endedAt ?? undefined,
	}));

	outputSuccess({
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		stateHistory: spans,
		meta: { count: spans.length },
	});
}

async function handleRelateIssue(
	issueId: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);

	const sourceId = await linearService.resolveIssueId(issueId);
	const relations = await createRelations(
		sourceId,
		options,
		graphQLService,
		linearService,
	);

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

async function handleRelatedIssues(
	issueId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);

	const resolvedId = await linearService.resolveIssueId(issueId);
	const result = await graphQLService.rawRequest<GetIssueRelationsResponse>(
		GET_ISSUE_RELATIONS_QUERY,
		{ id: resolvedId },
	);

	if (!result.issue) {
		throw new Error(`Issue "${issueId}" not found`);
	}

	const issue = result.issue;

	const entries: RelatedIssueEntry[] = [
		...buildOutgoingRelationEntries(issue.relations.nodes),
		...buildIncomingRelationEntries(issue.inverseRelations.nodes),
	];

	outputSuccess({
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		data: entries,
		meta: { count: entries.length },
	});
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
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);

	if (options.appendDescription) {
		const resolved = await linearService.resolveIssueId(issueId);
		const current = await graphQLService.rawRequest<{
			issue: { description: string | null } | null;
		}>("query($id: String!) { issue(id: $id) { description } }", {
			id: resolved,
		});
		const existing = current.issue?.description ?? "";
		options.description = `${existing}\n${options.appendDescription}`;
	}

	if (options.title || options.description) {
		enforceTerms([options.title, options.description], {
			strict: options.strict,
		});
	}
	// Save the original (pre-wrap) description so we can pass it to maybeAutoLink later.
	// The wrapped form breaks prose-keyword inference because the inserted `[` defeats the
	// trailing-whitespace anchor in patterns like /\bblocked by\s*$/.
	const originalDescription = options.description as string | undefined;
	// Wrap valid refs as markdown links before sending the update. Idempotent against
	// already-wrapped refs (the wrapper skips text inside existing markdown link syntax).
	const prepared = options.description
		? await prepareAutoLinkedDescription(
				options.description as string,
				options,
				undefined,
				linearService,
				graphQLService,
			)
		: {
				description: undefined,
				preResolved: new Map<string, string>(),
				rewritten: false,
			};
	if (prepared.description !== undefined) {
		options.description = prepared.description;
	}

	const issuesService = new GraphQLIssuesService(graphQLService, linearService);
	const assigneeId = options.assignee
		? await resolveAssignee(options.assignee, rootOpts)
		: undefined;
	const updateArgs = buildUpdateArgs(issueId, options, assigneeId);
	const result = await issuesService.updateIssue(
		updateArgs,
		options.labelBy || "adding",
	);
	const autoLinked = originalDescription
		? await maybeAutoLink({
				issueId: result.id,
				identifier: result.identifier,
				description: originalDescription,
				options,
				preResolved: prepared.preResolved,
				graphQLService,
				linearService,
			})
		: undefined;
	outputSuccess(autoLinked ? { ...result, autoLinked } : result);
}

async function handleArchiveIssue(
	issueId: string,
	_options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const issuesService = new GraphQLIssuesService(graphQLService, linearService);
	const result = await issuesService.archiveIssue(issueId);
	outputSuccess({
		success: true,
		archived: true,
		...result,
	});
}

async function handleDeleteIssue(
	issueId: string,
	options: OptionValues,
	command: Command,
): Promise<void> {
	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
	const issuesService = new GraphQLIssuesService(graphQLService, linearService);
	const permanentlyDelete = Boolean(options.permanentlyDelete || options.hard);
	const result = await issuesService.deleteIssue(issueId, {
		permanentlyDelete,
	});
	outputSuccess({
		success: true,
		deleted: true,
		permanentlyDeleted: permanentlyDelete,
		...result,
	});
}

async function handleRetrolink(
	options: OptionValues,
	command: Command,
): Promise<void> {
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
		? commitLog
				.split("\n")
				.map((line: string) => line.replace(COMMIT_HASH_PREFIX_REGEX, ""))
		: [];

	// 3. Build title and description
	const title =
		options.title || (commits.length > 0 ? commits[0] : currentBranch);
	const description =
		commits.length > 0
			? commits.map((msg: string) => `- ${msg}`).join("\n")
			: `Retrolinked from branch: ${currentBranch}`;

	const rootOpts = getRootOpts(command);
	const graphQLService = await createGraphQLService(rootOpts);
	const linearService = await createLinearService(rootOpts);
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
			throw new Error(
				"Team is required. Use --team or set a defaultTeam in config.",
			);
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
		// `--` BEFORE the ref operands terminates option parsing so a
		// name starting with `-` (server bug, malicious slug, forked
		// Linear-compatible API) is parsed as a ref name rather than a
		// git flag. Defense in depth — the default feature/ prefix
		// already blocks the common case, but the prefix is configurable
		// (DEV-4064).
		execFileSync("git", ["branch", "-m", "--", oldBranch, newBranch], {
			stdio: "pipe",
		});
	}

	outputSuccess({
		...result,
		oldBranch,
		...(newBranch ? { branch: newBranch } : {}),
	});
}

export function setupIssuesCommands(program: Command): void {
	const issues = program
		.command("issues")
		.alias("issue")
		.description("Issue operations");
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
		.option(
			"--status <status>",
			"filter by status (comma-separated, e.g. Todo,Backlog)",
		)
		.option(
			"--priority <priority>",
			"filter by priority (comma-separated: urgent,high,medium,low,none or 0-4)",
		)
		.option(
			"--sort <field>",
			"sort results (priority, status, created, updated)",
		)
		.option(
			"--format <format>",
			"output format (json, summary, table, md, csv)",
			"json",
		)
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
		.option(
			"--sort <field>",
			"sort results (priority, status, created, updated)",
		)
		.option(
			"--format <format>",
			"output format (json, summary, table, md, csv)",
			"json",
		)
		.option("--fields <fields>", "columns for table/csv output")
		.option("-l, --limit <number>", "limit results", "10")
		.action(handleAsyncCommand(handleSearchIssues));

	issues
		.command("create [title]")
		.description(
			"Create new issue (EL-enhanced: name/alias resolution, brand validation, status defaults).",
		)
		.option(
			"-t, --title <title>",
			"issue title (alternative to positional argument)",
		)
		.option("-d, --description <desc>", "issue description")
		.option(
			"--description-file <path>",
			"read description from file (use - for stdin)",
		)
		.option(
			"--template <name>",
			"use a named description template from config.descriptionTemplates",
		)
		.option(
			"--from-template <id>",
			"instantiate the issue from a Linear server-side template (UUID from `el-linear templates list`). Sets templateId on the underlying issueCreate mutation; Linear copies the template's title, description, labels, priority, etc. as the new issue's defaults. Override any field with the matching --title / --description / --labels flag.",
		)
		.option(
			"-a, --assignee <assignee>",
			"assign to user (name, alias, or UUID)",
		)
		.option(
			"--no-assignee",
			"create unassigned even when config.defaultAssignee is set",
		)
		.option(
			"-p, --priority <priority>",
			"priority: name (none/urgent/high/medium/normal/low) or number (0-4)",
		)
		.option("--project <project>", "add to project (name or ID)")
		.option("--team <team>", "team key or name (default: from config)")
		.option(
			"--labels <labels>",
			"labels (comma-separated names, auto-resolved per team)",
		)
		.option("--label <labels>", "alias for --labels")
		.option("--claude", "add the workspace-level 'claude' label")
		.option("--project-milestone <milestone>", "project milestone name or ID")
		.option("--cycle <cycle>", "cycle name or ID")
		.option("--status <status>", "status name or ID")
		.option("--parent-ticket <parentId>", "parent issue ID or identifier")
		.option(
			"--subscriber <subscribers>",
			"subscribers (comma-separated names, aliases, or UUIDs)",
		)
		.option("--strict", "strict brand validation (error instead of warning)")
		.option(
			"--related-to <issues>",
			"related issues (comma-separated identifiers)",
		)
		.option(
			"--blocks <issues>",
			"issues this blocks (comma-separated identifiers)",
		)
		.option(
			"--blocked-by <issues>",
			"issues blocking this (comma-separated identifiers)",
		)
		.option(
			"--attachment <path>",
			"attach a file (image, PDF, etc.) to the created issue (repeatable)",
			(value: string, prev: string[] | undefined) =>
				prev ? [...prev, value] : [value],
		)
		.option("--due-date <date>", "due date (YYYY-MM-DD)")
		.option(
			"--checkout",
			"create and checkout a git branch named after the issue",
		)
		.option(
			"--skip-validation",
			"skip all validation (labels, description, assignee, project)",
		)
		.option(
			"--no-auto-link",
			"skip auto-linking issue references found in the description",
		)
		.option(
			"--footer <text>",
			"text appended to the description (overrides config.messageFooter)",
		)
		.option("--no-footer", "skip the configured messageFooter for this issue")
		.action(
			handleAsyncCommand(
				(
					titleArg: string | undefined,
					options: OptionValues,
					command: Command,
				) => {
					// Normalize --label alias to --labels
					if (options.label && !options.labels) {
						options.labels = options.label;
					}
					const title = options.title || titleArg;
					// --from-template lets Linear copy the template's title, so a
					// local title is optional in that path. Without --from-template,
					// the create mutation requires a title up front.
					const fromTemplate =
						typeof options.fromTemplate === "string" && options.fromTemplate;
					if (!title && !fromTemplate) {
						throw new Error(
							"Title is required. Provide it as a positional argument, with --title, or use --from-template to copy the template's title.",
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
		.option(
			"--field <name>",
			'Extract a single named section from the issue description (e.g. "Done when"). ' +
				"Matches H2/H3 headers and bold pseudo-headers case-insensitively. " +
				"Outputs the section text only — no JSON envelope. Single-issue only.",
		)
		.addHelpText(
			"after",
			'\nBoth UUID and identifiers like ABC-123 are supported.\nMultiple IDs: el-linear issue get DEV-123 DEV-456 DEV-789\nExtract a section: el-linear issue read DEV-123 --field "Done when"',
		)
		.action(handleAsyncCommand(readIssues));

	issues
		.command("update <issueId>")
		.alias("edit")
		.alias("set")
		.description("Update an issue (EL-enhanced: name/alias resolution).")
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported.",
		)
		.option("-t, --title <title>", "new title")
		.option("-d, --description <desc>", "new description")
		.option(
			"--description-file <path>",
			"read description from file (use - for stdin)",
		)
		.option(
			"--append-description <text>",
			"append text to the existing description",
		)
		.option("-s, --status <status>", "new status name or ID")
		.option("--state <status>", "alias for --status (new status name or ID)")
		.option(
			"-p, --priority <priority>",
			"new priority: name (none/urgent/high/medium/normal/low) or number (0-4)",
		)
		.option("--assignee <assignee>", "new assignee (name, alias, or UUID)")
		.option("--project <project>", "new project (name or ID)")
		.option("--labels <labels>", "labels (comma-separated names or IDs)")
		.option("--label <labels>", "alias for --labels")
		.option(
			"--label-by <mode>",
			"how to apply labels: 'adding' (default) or 'overwriting'",
		)
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
		.option(
			"--no-auto-link",
			"skip auto-linking issue references found in the description",
		)
		.action(handleAsyncCommand(handleUpdateIssue));

	issues
		.command("archive <issueId>")
		.description("Archive an issue.")
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported.",
		)
		.action(handleAsyncCommand(handleArchiveIssue));

	issues
		.command("delete <issueId>")
		.description("Delete (trash) an issue.")
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported. Use --permanently-delete only when you intend to skip Linear's grace period; Linear requires admin permissions.",
		)
		.option(
			"--permanently-delete",
			"skip Linear's 30-day grace period (admin only)",
		)
		.option("--hard", "alias for --permanently-delete")
		.action(handleAsyncCommand(handleDeleteIssue));

	issues
		.command("hard-delete <issueId>")
		.description("Permanently delete an issue immediately (admin only).")
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported.",
		)
		.action(
			handleAsyncCommand(
				(issueId: string, options: OptionValues, command: Command) =>
					handleDeleteIssue(
						issueId,
						{ ...options, permanentlyDelete: true },
						command,
					),
			),
		);

	issues
		.command("history <issueId>")
		.description("Show issue state transition history (time in each status).")
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported.",
		)
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
		.description(
			"List all relations for an issue (related, blocks, blockedBy, duplicate).",
		)
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported.",
		)
		.action(handleAsyncCommand(handleRelatedIssues));

	issues
		.command("link-references [issueId]")
		.description(
			"Scan an issue's description (and optionally comments) for issue identifiers and auto-create relations for any not already linked. Default relation is 'related'; prose keywords like 'blocked by' or 'duplicates' upgrade the type.",
		)
		.addHelpText(
			"after",
			"\nBoth UUID and identifiers like ABC-123 are supported.\nSkips references that already have any relation (related, blocks, blockedBy, duplicate) to the source issue.\nKeyword detection: 'blocked by'/'depends on' → blocks, 'blocks' → blocks, 'duplicates'/'duplicate of' → duplicate, 'duplicated by' → duplicate (reversed).\nUse --team <key> to backfill an entire team instead of a single issue.\nUse --rewrite-description to also wrap bare identifiers as markdown links inside the description (single-issue only).",
		)
		.option("--dry-run", "show what would be linked without creating relations")
		.option("--include-comments", "also scan comment bodies for references")
		.option(
			"--team <team>",
			"batch mode: scan all issues in a team (omit issueId)",
		)
		.option("--limit <number>", "max issues to scan in --team mode", "100")
		.option(
			"--rewrite-description",
			"also rewrite the issue description to wrap bare identifiers as markdown links (single-issue only; not allowed with --team)",
		)
		.action(handleAsyncCommand(handleLinkReferencesIssue));

	issues
		.command("retrolink")
		.description(
			"Link current branch to a Linear issue. Creates a new issue by default, or links to an existing one with --issue.",
		)
		.option(
			"--issue <issueId>",
			"link to an existing issue instead of creating one (e.g. INF-459)",
		)
		.option(
			"--team <team>",
			"team key or name (required if creating, not needed with --issue)",
		)
		.option(
			"--title <title>",
			"override auto-generated title (default: first commit message)",
		)
		.option("--base <branch>", "base branch for log comparison", "main")
		.action(handleAsyncCommand(handleRetrolink));
}
