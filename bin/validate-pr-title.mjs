#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONVENTIONAL_TITLE_RE =
	/^(?<type>build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(?:\([a-z0-9][a-z0-9._/-]*\))?(?<breaking>!)?: .+/u;
const RELEASE_PLEASE_TITLE_RE = /^chore\(main\): release \d+\.\d+\.\d+$/u;
const RELEASEABLE_TYPES = new Set(["feat", "fix"]);

// Paths that must not change without cutting a release — for EITHER of two reasons:
//
//   1. they reach a CONSUMER of the published npm package — `README.md`, `LICENSE`,
//      `package.json`, and everything under `src/` / `claude-skills/` (the last two
//      via PUBLISHED_PREFIXES below); or
//   2. they steer RELEASE-PLEASE ITSELF — `release-please-config.json` and
//      `.release-please-manifest.json`. These are never published and reach no
//      consumer; they are listed because changing them changes how we release.
//
// Both reasons are stated because reason (1) alone is false for the two
// release-please files, and this comment is the authority a future maintainer will
// apply to decide whether some new path belongs here. A criterion that is untrue of
// its own list is worse than none.
//
// `pnpm-lock.yaml` is deliberately NOT here (DEV-6064). It satisfies neither reason:
// it is not in package.json's `files` (`dist/`, `claude-skills/`, `LICENSE`,
// `README.md`) so it is never published, and a dependent resolves our dependencies
// from the RANGES in `package.json`, never from our lockfile. A lockfile-only change
// cannot reach a consumer and does not warrant a release.
//
// Listing it made every dependabot PR permanently red (dependabot always titles
// `build(deps):` and a routine bump touches only the lockfile), which is strictly
// worse than no bot: the red gets ignored, and a real security bump gets ignored with
// it. The rule's intent survives without it — `package.json` is still listed, so a
// genuinely consumer-visible dependency change (a range bump, a new or moved dep)
// still demands a releaseable title.
//
// `package.json` is listed here but is NOT judged by path alone: see
// DEV_ONLY_PACKAGE_KEYS below for the section-aware refinement (DEV-6066).
const PUBLISHED_PATHS = [
	"README.md",
	"LICENSE",
	"package.json",
	"release-please-config.json",
	".release-please-manifest.json",
];

const PUBLISHED_PREFIXES = ["src/", "claude-skills/"];

export const PACKAGE_JSON = "package.json";

// `package.json` is a published surface, but only SOME of its keys reach a consumer
// (DEV-6066). The gate is therefore SECTION-AWARE for this one file: it fires when a
// consumer-visible key actually moved, not merely because the file is in the changed-
// file list.
//
// The check is written as a DENYLIST of provably-invisible keys, not an allowlist of
// visible ones, and that direction is deliberate: it FAILS CLOSED. Any key not named
// here — `main`, `types`, `exports`, `bin`, `files`, `engines`, `dependencies`,
// `optionalDependencies`, `peerDependencies`, `version`, `sideEffects`,
// `publishConfig`, or one npm adds next year — still fires the gate. An allowlist
// would silently pass every key nobody thought to list, which for a release gate is
// the expensive direction to be wrong in.
//
//   devDependencies — never installed by a consumer of the published tarball, and
//                     never inlined into `dist/`: the build is `tsc`, not a bundler.
//                     A devDependency bump is exactly as invisible to a consumer as a
//                     lockfile bump, which DEV-6064 already established.
//   scripts         — dev-only TARGETS (`build`, `lint`, `test`, …) are invisible.
//                     The npm lifecycle scripts below are NOT: they execute on the
//                     consumer's machine at install time, so they are carved back out.
const DEV_ONLY_PACKAGE_KEYS = new Set(["devDependencies", "scripts"]);

// Scripts npm runs on a CONSUMER's machine when our package is installed as a
// dependency. Editing one of these is consumer-visible even though `scripts` as a
// whole is dev-only. (`prepare` runs for git installs of this package.)
const CONSUMER_LIFECYCLE_SCRIPTS = new Set([
	"preinstall",
	"install",
	"postinstall",
	"prepare",
]);

export function isPublishedSurfacePath(path) {
	return (
		PUBLISHED_PATHS.includes(path) ||
		PUBLISHED_PREFIXES.some((prefix) => path.startsWith(prefix))
	);
}

function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b || a === null || b === null) return false;
	if (typeof a !== "object") return false;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((item, index) => deepEqual(item, b[index]));
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	// Key ORDER is not semantic in JSON, so compare by key, not by serialization.
	return aKeys.every(
		(key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]),
	);
}

function changedTopLevelKeys(base, head) {
	const keys = new Set([...Object.keys(base), ...Object.keys(head)]);
	return [...keys].filter((key) => !deepEqual(base[key], head[key])).sort();
}

/**
 * Top-level `package.json` keys that moved AND are visible to a consumer of the
 * published npm package.
 *
 * @param {Record<string, unknown>} base parsed base-ref package.json
 * @param {Record<string, unknown>} head parsed head-ref package.json
 * @returns {string[]} sorted consumer-visible keys; empty means "no consumer can tell"
 */
export function consumerVisiblePackageJsonKeys(base, head) {
	return changedTopLevelKeys(base, head).filter((key) => {
		if (!DEV_ONLY_PACKAGE_KEYS.has(key)) return true;

		if (key === "scripts") {
			// Dev-only targets are invisible; install-time lifecycle scripts are not.
			const scriptKeys = changedTopLevelKeys(
				base.scripts ?? {},
				head.scripts ?? {},
			);
			return scriptKeys.some((script) =>
				CONSUMER_LIFECYCLE_SCRIPTS.has(script),
			);
		}

		return false;
	});
}

function parsePackageJson(source) {
	if (typeof source !== "string" || !source.trim()) return null;
	try {
		const parsed = JSON.parse(source);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed
			: null;
	} catch {
		return null;
	}
}

/**
 * Decide whether a `package.json` edit reaches a consumer.
 *
 * FAIL-CLOSED: without both blobs (not supplied, unparseable, file added or deleted)
 * we cannot prove the change is invisible, so we fall back to the pre-DEV-6066
 * wholesale behavior and treat the file as a published surface. A release gate that
 * guesses "probably fine" when it cannot see the diff is not a gate.
 *
 * @param {{base?: string|null, head?: string|null}} [sources] raw JSON text of each side
 */
export function classifyPackageJsonChange(sources) {
	const base = parsePackageJson(sources?.base);
	const head = parsePackageJson(sources?.head);

	if (!base || !head) {
		return { consumerVisible: true, keys: [], readable: false };
	}

	const keys = consumerVisiblePackageJsonKeys(base, head);
	return { consumerVisible: keys.length > 0, keys, readable: true };
}

/**
 * The changed files that count as a published surface, as human-readable entries.
 * `package.json` is section-aware (DEV-6066) and names the offending keys; every
 * other path is classified by path alone.
 *
 * @param {string[]} changedFiles
 * @param {{packageJson?: {base?: string|null, head?: string|null}}} [context]
 */
export function publishedSurfaceEntries(changedFiles, context = {}) {
	const entries = [];

	for (const path of changedFiles) {
		if (path === PACKAGE_JSON) {
			const verdict = classifyPackageJsonChange(context.packageJson);
			if (!verdict.consumerVisible) continue;
			entries.push(
				verdict.keys.length > 0
					? `${PACKAGE_JSON} (${verdict.keys.join(", ")})`
					: PACKAGE_JSON,
			);
			continue;
		}

		if (isPublishedSurfacePath(path)) entries.push(path);
	}

	return entries;
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

/**
 * @param {string} title the PR title (or, for a single-commit PR, the commit subject)
 * @param {string[]} [changedFiles] paths changed against the base ref
 * @param {{packageJson?: {base?: string|null, head?: string|null}}} [context]
 *   Raw `package.json` text on each side of the diff. A path list alone cannot answer
 *   "did a consumer-visible KEY move", so the section-aware check (DEV-6066) needs the
 *   blobs. Omitting it is safe — the check falls back to the wholesale behavior.
 */
export function validatePrTitle(title, changedFiles = [], context = {}) {
	const normalizedTitle = title.trim();
	const info = titleInfo(normalizedTitle);
	const publishedFiles = publishedSurfaceEntries(changedFiles, context);

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

function git(args) {
	return execFileSync("git", args, { encoding: "utf8" });
}

function changedFilesFromGit(base) {
	if (!base) return [];

	const output = git(["diff", "--name-only", `${base}...HEAD`]);
	return output
		.split(/\r?\n/u)
		.map((file) => file.trim())
		.filter(Boolean);
}

function showBlob(rev, path) {
	try {
		return git(["show", `${rev}:${path}`]);
	} catch {
		// Missing on that side (added / deleted / shallow fetch). classifyPackageJsonChange
		// fails closed on a null blob, which is the behavior we want.
		return null;
	}
}

/**
 * Read `package.json` on both sides of the diff, matching the merge-base semantics of
 * the `base...HEAD` range used for the changed-file list.
 */
function packageJsonSourcesFromGit(base) {
	if (!base) return undefined;

	let mergeBase = base;
	try {
		mergeBase = git(["merge-base", base, "HEAD"]).trim() || base;
	} catch {
		// Shallow clone with no reachable merge-base: compare against the base ref itself.
	}

	return {
		base: showBlob(mergeBase, PACKAGE_JSON),
		head: showBlob("HEAD", PACKAGE_JSON),
	};
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const changedFiles =
		options.changedFiles.length > 0
			? options.changedFiles
			: changedFilesFromGit(options.base);
	const context = changedFiles.includes(PACKAGE_JSON)
		? { packageJson: packageJsonSourcesFromGit(options.base) }
		: {};
	const result = validatePrTitle(options.title, changedFiles, context);

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
