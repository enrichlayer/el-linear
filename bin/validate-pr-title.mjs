#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONVENTIONAL_TITLE_RE =
	/^(?<type>build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([a-z0-9][a-z0-9._/-]*\))?(?<breaking>!)?: .+/u;
const RELEASE_PLEASE_TITLE_RE = /^chore\(main\): release \d+\.\d+\.\d+$/u;
const RELEASEABLE_TYPES = new Set(["feat", "fix"]);

// Paths whose contents REACH A CONSUMER of the published npm package, so a change
// to one must cut a release (hence a `fix:`/`feat:` title that release-please sees).
//
// `pnpm-lock.yaml` is deliberately NOT here (DEV-6064). It is not in package.json's
// `files` (`dist/`, `claude-skills/`, `LICENSE`, `README.md`), so it is never
// published — and a dependent resolves our dependencies from the RANGES in
// `package.json`, never from our lockfile. A lockfile-only change therefore cannot
// reach a consumer and does not warrant a release.
//
// Listing it made every dependabot PR permanently red (dependabot always titles
// `build(deps):` and always touches only the lockfile), which is strictly worse than
// no bot: the red gets ignored, and a real security bump gets ignored with it. The
// rule's intent survives without it — `package.json` is still listed, so a genuinely
// consumer-visible dependency change (a range bump, a new or moved dep) still
// demands a releaseable title.
const PUBLISHED_PATHS = [
	"README.md",
	"LICENSE",
	"package.json",
	"release-please-config.json",
	".release-please-manifest.json",
];

const PUBLISHED_PREFIXES = ["src/", "claude-skills/"];

export function isPublishedSurfacePath(path) {
	return (
		PUBLISHED_PATHS.includes(path) ||
		PUBLISHED_PREFIXES.some((prefix) => path.startsWith(prefix))
	);
}

export function titleInfo(title) {
	if (RELEASE_PLEASE_TITLE_RE.test(title)) {
		return { kind: "release-please", releaseable: true, type: "chore" };
	}

	const match = title.match(CONVENTIONAL_TITLE_RE);
	if (!match?.groups) {
		return { kind: "invalid", releaseable: false, type: null };
	}

	const type = match.groups.type;
	return {
		kind: "conventional",
		releaseable: RELEASEABLE_TYPES.has(type) || Boolean(match.groups.breaking),
		type,
	};
}

export function validatePrTitle(title, changedFiles = []) {
	const normalizedTitle = title.trim();
	const info = titleInfo(normalizedTitle);
	const publishedFiles = changedFiles.filter(isPublishedSurfacePath);

	if (!normalizedTitle) {
		return {
			ok: false,
			message:
				"PR title is empty. Use a conventional title such as fix(cli): add search alias.",
		};
	}

	if (info.kind === "invalid") {
		return {
			ok: false,
			message:
				"PR title must start with a Conventional Commit type, for example fix(cli): add search alias. This keeps squash-merge commits visible to release-please.",
		};
	}

	if (publishedFiles.length > 0 && !info.releaseable) {
		return {
			ok: false,
			message: `PR touches published el-linear surface (${publishedFiles
				.slice(0, 5)
				.join(
					", ",
				)}${publishedFiles.length > 5 ? ", ..." : ""}) but title type "${info.type}" will not trigger release-please. Use fix: or feat: unless this is a release PR.`,
		};
	}

	return { ok: true, message: "PR title is release-safe." };
}

function parseArgs(argv) {
	const options = {
		title: process.env.PR_TITLE ?? process.env.GITHUB_PR_TITLE ?? "",
		base: process.env.PR_TITLE_BASE ?? "",
		changedFiles: [],
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--title") {
			options.title = argv[++index] ?? "";
		} else if (arg === "--base") {
			options.base = argv[++index] ?? "";
		} else if (arg === "--changed-file") {
			options.changedFiles.push(argv[++index] ?? "");
		} else if (arg === "--changed-files") {
			options.changedFiles.push(
				...(argv[++index] ?? "")
					.split(/\r?\n|,/u)
					.map((file) => file.trim())
					.filter(Boolean),
			);
		}
	}

	return options;
}

function changedFilesFromGit(base) {
	if (!base) return [];

	const output = execFileSync(
		"git",
		["diff", "--name-only", `${base}...HEAD`],
		{
			encoding: "utf8",
		},
	);
	return output
		.split(/\r?\n/u)
		.map((file) => file.trim())
		.filter(Boolean);
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const changedFiles =
		options.changedFiles.length > 0
			? options.changedFiles
			: changedFilesFromGit(options.base);
	const result = validatePrTitle(options.title, changedFiles);

	if (result.ok) {
		console.log(result.message);
		return;
	}

	console.error(result.message);
	process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
