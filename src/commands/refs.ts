import { existsSync, readFileSync, statSync } from "node:fs";
import type { Command, OptionValues } from "commander";
import { createGraphQLService } from "../utils/graphql-service.js";
import { extractIssueReferences } from "../utils/issue-reference-extractor.js";
import {
	type WrapTarget,
	wrapIssueReferencesAsLinks,
} from "../utils/issue-reference-wrapper.js";
import { createLinearService } from "../utils/linear-service.js";
import { logger } from "../utils/logger.js";
import { handleAsyncCommand } from "../utils/output.js";
import { getRootOpts } from "../utils/root-opts.js";
import { validateReferences } from "../utils/validate-references.js";
import { getWorkspaceUrlKey } from "../utils/workspace-url.js";

const VALID_TARGETS: ReadonlySet<WrapTarget> = new Set(["markdown", "slack"]);

function isWrapTarget(value: string): value is WrapTarget {
	return (VALID_TARGETS as ReadonlySet<string>).has(value);
}

/**
 * Read all input bytes from a Readable stream as a UTF-8 string. Used to slurp
 * stdin when the user pipes content (`el-linear refs wrap < input.md`).
 */
async function readAllStdin(): Promise<string> {
	if (process.stdin.isTTY) {
		throw new Error(
			"No input provided. Pipe text to stdin or pass --file <path>.",
		);
	}
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

interface WrapDeps {
	resolveValidIdentifiers: (ids: readonly string[]) => Promise<Set<string>>;
	resolveUrlKey: () => Promise<string>;
}

interface WrapInput {
	text: string;
	target: WrapTarget;
	validate: boolean;
}

/**
 * Pure-ish core of `refs wrap` — split out so tests can drive it directly with
 * a stubbed `WrapDeps`, no commander parsing or stdin/fs IO.
 */
export async function wrapRefsCore(
	input: WrapInput,
	deps: WrapDeps,
): Promise<string> {
	const refs = extractIssueReferences(input.text);
	if (refs.length === 0) {
		return input.text;
	}
	const candidateIds = refs.map((r) => r.identifier);
	let validIds: Set<string>;
	if (input.validate) {
		validIds = await deps.resolveValidIdentifiers(candidateIds);
	} else {
		// --no-validate: trust every regex match, skip the API.
		validIds = new Set(candidateIds);
	}
	if (validIds.size === 0) {
		return input.text;
	}
	const urlKey = await deps.resolveUrlKey();
	return wrapIssueReferencesAsLinks(input.text, validIds, urlKey, input.target);
}

/**
 * Return `path` if it resolves to an existing regular file on disk, else
 * `null`. Used by `handleWrap` to disambiguate the `el-linear refs wrap <arg>`
 * shape between "wrap this literal text" and "wrap the contents of this file".
 *
 * Concerns intentionally NOT addressed:
 *   - Symlinks → resolved transparently by `statSync` (followSymlinks=true).
 *   - Directories → returned as null (statSync().isFile() is false).
 *   - Permission-denied / EACCES → returned as null; the caller falls back to
 *     treating the arg as text. The eventual `readFileSync` would surface the
 *     real error if the user did mean a file.
 *
 * Reference: DEV-4077 (vertical-int/tools MR !516 / !517 incident reports).
 */
function pathIfExistingFile(candidate: string): string | null {
	if (!candidate || candidate.includes("\n")) return null;
	try {
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return candidate;
		}
	} catch {
		// EACCES / EPERM / ELOOP → treat as not-a-file; downstream text path
		// either passes through harmlessly or raises a more useful error.
	}
	return null;
}

interface HandleWrapOptions extends OptionValues {
	file?: string;
	target?: string;
	validate?: boolean;
	workspaceUrlKey?: string;
}

async function handleWrap(
	textArgs: string[],
	options: HandleWrapOptions,
	command: Command,
): Promise<void> {
	const target = options.target ?? "markdown";
	if (!isWrapTarget(target)) {
		throw new Error(
			`Invalid --target "${target}". Expected one of: ${[...VALID_TARGETS].join(", ")}`,
		);
	}
	// `validate` is `true` by default and `false` when `--no-validate` is passed.
	const validate = options.validate !== false;

	// Input precedence: positional args > --file > stdin. A single positional
	// arg that resolves to an existing file is treated as a file path (the
	// natural `el-linear refs wrap body.md` shape that users hit blind);
	// otherwise positional args are joined as text. This auto-detect closes
	// DEV-4077: the published v1.8.1 rejected `wrap <file>` outright, and the
	// v1.10.0 source treated it as literal text — producing silently wrong
	// output instead of an error. With this change, either form works.
	let text: string;
	if (textArgs.length === 1) {
		const positionalFile = pathIfExistingFile(textArgs[0]);
		if (positionalFile !== null) {
			if (typeof options.file === "string" && options.file.length > 0) {
				throw new Error(
					`Both a positional file path (${positionalFile}) and --file ${options.file} were provided. Use one or the other.`,
				);
			}
			text = readFileSync(positionalFile, "utf8");
		} else {
			text = textArgs[0];
		}
	} else if (textArgs.length > 1) {
		text = textArgs.join(" ");
	} else if (typeof options.file === "string" && options.file.length > 0) {
		text = readFileSync(options.file, "utf8");
	} else {
		text = await readAllStdin();
	}

	const rootOpts = getRootOpts(command);

	const deps: WrapDeps = {
		async resolveValidIdentifiers(ids) {
			const linearService = await createLinearService(rootOpts);
			const map = await validateReferences(ids, linearService);
			return new Set(map.keys());
		},
		async resolveUrlKey() {
			// When --workspace-url-key or EL_LINEAR_WORKSPACE_URL_KEY supplies
			// the key, the live lookup never fires — skip the GraphQL service
			// instantiation entirely so `refs wrap --no-validate` works offline.
			const override = options.workspaceUrlKey;
			if (override || process.env.EL_LINEAR_WORKSPACE_URL_KEY) {
				return getWorkspaceUrlKey(undefined, { override });
			}
			const graphQLService = await createGraphQLService(rootOpts);
			return getWorkspaceUrlKey(graphQLService);
		},
	};

	if (!validate) {
		// stderr advisory only — keeps stdout a clean text stream for piping.
		logger.error(
			"el-linear refs wrap: --no-validate set; emitting links for every regex match without checking the workspace.",
		);
	}

	const wrapped = await wrapRefsCore({ text, target, validate }, deps);
	process.stdout.write(wrapped);
}

export function setupRefsCommands(program: Command): void {
	const refs = program
		.command("refs")
		.description(
			"Operations on Linear issue references found in arbitrary text.",
		);
	refs.action(() => refs.help());

	refs
		.command("wrap")
		.description(
			"Wrap recognized Linear issue identifiers in input text as links. " +
				"Input precedence: positional args > --file > stdin. A single positional " +
				"arg that resolves to an existing file is read as a file (so " +
				"`el-linear refs wrap body.md` works the same as `--file body.md`); " +
				"otherwise positional args are joined as literal text. " +
				"Writes the result to stdout. By default, each candidate identifier " +
				"is validated against the workspace; unresolvable ones are left as " +
				"plain text.",
		)
		.argument(
			"[text...]",
			"input text OR a path to a file. A single positional arg that exists as a file is read; otherwise positional args are joined as literal text with a single space.",
		)
		.option("--file <path>", "read input from a file instead of stdin")
		.option(
			"--target <target>",
			"output format: markdown (default) or slack",
			"markdown",
		)
		.option(
			"--no-validate",
			"skip workspace validation; wrap every regex match. Faster, but may produce broken links for IDs that don't exist.",
		)
		.option(
			"--workspace-url-key <key>",
			"workspace URL key (the segment after linear.app/). Overrides config + env var. With --no-validate, makes the command fully offline.",
		)
		.action(handleAsyncCommand(handleWrap));
}
