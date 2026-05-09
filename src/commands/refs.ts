import { readFileSync } from "node:fs";
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

interface HandleWrapOptions extends OptionValues {
	file?: string;
	target?: string;
	validate?: boolean;
}

async function handleWrap(
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

	const text =
		typeof options.file === "string" && options.file.length > 0
			? readFileSync(options.file, "utf8")
			: await readAllStdin();

	const rootOpts = getRootOpts(command);

	const deps: WrapDeps = {
		async resolveValidIdentifiers(ids) {
			const linearService = await createLinearService(rootOpts);
			const map = await validateReferences(ids, linearService);
			return new Set(map.keys());
		},
		async resolveUrlKey() {
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
				"Reads from stdin (or --file) and writes to stdout. By default, " +
				"each candidate identifier is validated against the workspace; " +
				"unresolvable ones are left as plain text.",
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
		.action(handleAsyncCommand(handleWrap));
}
