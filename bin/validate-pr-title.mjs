#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONVENTIONAL_TITLE_RE =
	/^(?<type>build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([a-z0-9][a-z0-9._/-]*\))?(?<breaking>!)?: .+/u;
const RELEASE_PLEASE_TITLE_RE = /^chore\(main\): release \d+\.\d+\.\d+$/u;
const RELEASEABLE_TYPES = new Set(["feat", "fix"]);

const PUBLISHED_PATHS = [
	"README.md",
	"LICENSE",
	"package.json",
	"pnpm-lock.yaml",
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
