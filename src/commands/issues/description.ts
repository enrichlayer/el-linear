/**
 * Description-handling helpers for issues create/update and the
 * `issues link-references --rewrite-description` flow.
 *
 * Three concerns live here:
 *
 *  1. Resolving the description value from `--description`,
 *     `--description-file`, or `--template`.
 *  2. The shared wrap-and-resolve pipeline (`wrapAndResolveRefs`)
 *     used by the create/update path and the rewrite-description
 *     path. Both wrap valid identifiers as markdown links and
 *     return the resolved id→uuid map for downstream auto-link.
 *  3. The post-create/update `maybeAutoLink` hook that creates
 *     sidebar relations for refs in the description.
 *
 * Extracted from `commands/issues.ts` (ALL-938) so that file can
 * focus on commander wiring + handlers.
 */

import fs from "node:fs";
import type { OptionValues } from "commander";
import { loadConfig } from "../../config/config.js";
import { UPDATE_ISSUE_MUTATION } from "../../queries/issues.js";
import type { UpdateIssueResponse } from "../../queries/issues-types.js";
import {
	type AutoLinkResult,
	autoLinkReferences,
} from "../../utils/auto-link-references.js";
import type { GraphQLService } from "../../utils/graphql-service.js";
import { extractIssueReferences } from "../../utils/issue-reference-extractor.js";
import { wrapIssueReferencesAsLinks } from "../../utils/issue-reference-wrapper.js";
import type { LinearService } from "../../utils/linear-service.js";
import { validateReferences } from "../../utils/validate-references.js";
import { getWorkspaceUrlKey } from "../../utils/workspace-url.js";

/**
 * Read description from a file path or stdin ("-").
 * Avoids shell escaping issues when descriptions contain special characters.
 */
export function readDescriptionFile(filePath: string): string {
	if (filePath === "-") {
		return fs.readFileSync(0, "utf8").trim();
	}
	if (!fs.existsSync(filePath)) {
		throw new Error(`Description file not found: ${filePath}`);
	}
	return fs.readFileSync(filePath, "utf8").trim();
}

/**
 * Resolve the description from --description, --description-file, or
 * --template (looked up in `config.descriptionTemplates`).
 *
 * Precedence: --description-file > --description > --template
 *
 * Passing --template alongside --description / --description-file is
 * a usage error — the explicit body and a template both producing
 * content would silently drop one. We throw so the user picks one.
 */
export function resolveDescription(options: OptionValues): string | undefined {
	const hasInline =
		typeof options.description === "string" && options.description.length > 0;
	const hasFile = Boolean(options.descriptionFile);
	const hasTemplate = typeof options.template === "string" && options.template;

	if (hasTemplate && (hasInline || hasFile)) {
		throw new Error(
			"--template is mutually exclusive with --description / --description-file. " +
				"Pick one.",
		);
	}

	if (hasFile) {
		return readDescriptionFile(options.descriptionFile as string);
	}
	if (hasInline) {
		return options.description as string;
	}
	if (hasTemplate) {
		const templates = loadConfig().descriptionTemplates ?? {};
		const body = templates[options.template as string];
		if (!body) {
			const available = Object.keys(templates).sort();
			const hint = available.length
				? `Available templates: ${available.join(", ")}`
				: "No templates configured. Add one under `descriptionTemplates` in your config.";
			throw new Error(`Template "${options.template}" not found. ${hint}`);
		}
		return body;
	}
	return undefined;
}

export interface PreparedDescription {
	/** The (possibly rewritten) description text to send to Linear */
	description: string | undefined;
	/** Map<identifier, uuid> of refs that resolved — passed to autoLink to avoid re-resolution */
	preResolved: Map<string, string>;
	/** True when the original description was rewritten (i.e. at least one link was wrapped) */
	rewritten: boolean;
}

/**
 * Shared core for the wrap-and-resolve pipeline used by both the
 * create/update path (`prepareAutoLinkedDescription`) and the
 * `link-references --rewrite-description` path
 * (`prepareDescriptionRewrite`).
 *
 * Returns:
 *   - `wrapped: undefined` when the original description had no
 *     resolvable refs to wrap (no-op for the caller),
 *   - `wrapped: <string>` when at least one ref was wrapped,
 *   - `preResolved` — the validated id→uuid map, passed downstream
 *     to `autoLinkReferences` to skip a second resolve roundtrip.
 */
async function wrapAndResolveRefs(
	description: string,
	selfIdentifier: string | undefined,
	linearService: LinearService,
	graphQLService: GraphQLService,
): Promise<{
	wrapped: string | undefined;
	preResolved: Map<string, string>;
}> {
	const refs = extractIssueReferences(description, selfIdentifier);
	if (refs.length === 0) {
		return { wrapped: undefined, preResolved: new Map() };
	}
	const preResolved = await validateReferences(
		refs.map((r) => r.identifier),
		linearService,
	);
	if (preResolved.size === 0) {
		return { wrapped: undefined, preResolved };
	}
	const validIds = new Set(preResolved.keys());
	const urlKey = await getWorkspaceUrlKey(graphQLService);
	const rewritten = wrapIssueReferencesAsLinks(description, validIds, urlKey);
	return {
		wrapped: rewritten === description ? undefined : rewritten,
		preResolved,
	};
}

/**
 * Pre-process a description before sending to Linear:
 *  1. Extract all issue references.
 *  2. Validate them (drop ones that don't resolve in the workspace —
 *     handles "ISO-1424"-style false positives).
 *  3. Wrap valid identifiers as markdown links — skipping any
 *     already inside a link, code block, or backtick span.
 *
 * No-ops (returns the original description with an empty map) when:
 *  - description is empty/undefined
 *  - the user passed `--no-auto-link`
 */
export async function prepareAutoLinkedDescription(
	description: string | undefined,
	options: OptionValues,
	selfIdentifier: string | undefined,
	linearService: LinearService,
	graphQLService: GraphQLService,
): Promise<PreparedDescription> {
	if (!description || options.autoLink === false) {
		return { description, preResolved: new Map(), rewritten: false };
	}
	const { wrapped, preResolved } = await wrapAndResolveRefs(
		description,
		selfIdentifier,
		linearService,
		graphQLService,
	);
	return {
		description: wrapped ?? description,
		preResolved,
		rewritten: wrapped !== undefined,
	};
}

export interface PreparedRewrite {
	/** Resolved id→uuid map (passed to autoLink to skip duplicate resolution) */
	preResolved: Map<string, string> | undefined;
	/** New description text — undefined when wrapping wouldn't change anything */
	wrapped: string | undefined;
}

/**
 * Prepare a description rewrite for `link-references --rewrite-description`.
 * Same wrap-and-resolve core; different return shape so the caller can
 * skip the rewrite mutation when nothing would change.
 */
export async function prepareDescriptionRewrite(
	description: string,
	selfIdentifier: string,
	linearService: LinearService,
	graphQLService: GraphQLService,
): Promise<PreparedRewrite> {
	if (!description) {
		return { preResolved: undefined, wrapped: undefined };
	}
	const { wrapped, preResolved } = await wrapAndResolveRefs(
		description,
		selfIdentifier,
		linearService,
		graphQLService,
	);
	return {
		// `link-references --rewrite-description` historically used
		// `preResolved: undefined` to mean "no refs at all"; preserve
		// that signal so the existing call site keeps the same shape.
		preResolved: preResolved.size === 0 ? undefined : preResolved,
		wrapped,
	};
}

export async function pushDescriptionUpdate(
	issueUuid: string,
	description: string,
	graphQLService: GraphQLService,
): Promise<void> {
	const updateResult = await graphQLService.rawRequest<UpdateIssueResponse>(
		UPDATE_ISSUE_MUTATION,
		{ id: issueUuid, input: { description } },
	);
	if (!updateResult.issueUpdate.success) {
		throw new Error("Failed to rewrite description");
	}
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
 * Run auto-linking for issue references found in a description, unless
 * the user opted out with `--no-auto-link` or no description was
 * provided. Returns undefined when nothing was linked / skipped /
 * failed (so callers can omit the field from JSON output).
 */
export async function maybeAutoLink(
	input: MaybeAutoLinkInput,
): Promise<AutoLinkResult | undefined> {
	const {
		issueId,
		identifier,
		description,
		options,
		graphQLService,
		linearService,
		preResolved,
	} = input;
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
	if (
		result.linked.length === 0 &&
		result.skipped.length === 0 &&
		result.failed.length === 0
	) {
		return;
	}
	return result;
}
