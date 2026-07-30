/**
 * Repo-aware Linear-profile resolution (DEV-7277).
 *
 * el-linear supports multiple named profiles (one Linear workspace each). When
 * a user works across several workspaces the machine-global `active-profile`
 * marker is a foot-gun: whichever workspace was last `profile use`d becomes the
 * default for EVERY repo, so a write lands in the wrong workspace.
 *
 * This module lets a repo PIN the profile it belongs to, read from two on-disk
 * sources in precedence order:
 *   1. Repo-root `.el-git.json`: `{ "linearProfile": "<name>" }`.
 *   2. `${XDG_CONFIG_HOME:-~/.config}/el-git/linear-profiles.json`:
 *      `{ "profiles": { "owner/repo": "<name>", "owner/*": "<name>" } }` — keys
 *      are the origin remote's `owner/repo`; an exact key wins over the
 *      `owner/*` wildcard.
 *
 * ── SHARED CROSS-TOOL CONTRACT — DO NOT DRIFT ────────────────────────────────
 * The file names, shapes, and precedence here are the SAME contract el-git
 * (DEV-6465) and el-session (DEV-7131) already read/write via the internal
 * `@enrichlayer/cli-package-info` module (`resolveRepoLinearProfile`). el-linear
 * is a standalone MIT package published to public npm; cli-package-info is
 * published only to an internal GitLab registry, so depending on it would break
 * public installs. Instead this file re-implements the EXACT same formats and
 * precedence. The filename stays `.el-git.json` (NOT a new `.el-linear` file) on
 * purpose — it is the established shared location el-session already reads. If
 * you change anything here, change the canonical impl at
 * `tools/cli/cli-package-info/src/index.cjs` in lock-step or the tools silently
 * disagree about which workspace a repo belongs to.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Trust note (inherited from the shared contract): the repo-local file is read
 * from whatever repo you `cd` into, including an untrusted clone. Blast radius
 * is bounded to selecting a profile NAME — worst case is a wrong-workspace
 * lookup or a rejected name, never code execution. Callers still validate the
 * resolved name with `isSafeProfileName` before it reaches any path join.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Repo-local pin file, at the git repo root. Shared with el-git/el-session. */
export const LINEAR_PROFILE_REPO_FILE = ".el-git.json";
/** Global pin table filename, under `<config>/el-git/`. */
export const LINEAR_PROFILE_USER_CONFIG = "linear-profiles.json";

/** Where the resolved pin came from. Mirrors the shared contract's `source`. */
export type RepoProfileSource = "repo-file" | "user-config";

export interface RepoLinearProfile {
	profile: string;
	source: RepoProfileSource;
}

/**
 * Injected I/O seam so resolution is unit-testable without a real git repo or
 * tmpdirs — mirrors the `ProfileFsOps` pattern in `paths.ts` and the `ops`
 * injection in the canonical cli-package-info impl.
 */
export interface RepoProfileOps {
	existsSync: (p: string) => boolean;
	readFileSync: (p: string) => string;
	/** Git repo root for `cwd`, or null when not inside a repo. */
	repoRoot: (cwd: string) => string | null;
	/** Origin remote parsed to `owner/repo`, or null when unavailable. */
	originFullpath: (cwd: string) => string | null;
}

export interface ResolveRepoProfileOptions {
	ops?: Partial<RepoProfileOps>;
	env?: NodeJS.ProcessEnv;
	/** Called with the offending file path when a config JSON is malformed. */
	onMalformedConfig?: (filePath: string) => void;
}

/** `${XDG_CONFIG_HOME:-~/.config}/el-git`. Env-injectable for tests. */
export function linearProfileConfigDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const xdg = (env.XDG_CONFIG_HOME ?? "").trim();
	return xdg
		? path.join(xdg, "el-git")
		: path.join(os.homedir(), ".config", "el-git");
}

export function globalPinTablePath(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return path.join(linearProfileConfigDir(env), LINEAR_PROFILE_USER_CONFIG);
}

// `git@host:owner/repo.git` and `https://host/owner/repo(.git)` → `owner/repo`.
// Byte-for-byte mirror of cli-package-info's `parseGitRemoteFullpath`.
const GIT_SCP_REMOTE_RE = /^[^@/]+@[^:]+:(.+)$/;
const GIT_REMOTE_LEADING_SLASHES_RE = /^\/+/;
const GIT_REMOTE_DOT_GIT_RE = /\.git$/;
const GIT_REMOTE_TRAILING_SLASHES_RE = /\/+$/;

export function parseGitRemoteFullpath(
	url: string | null | undefined,
): string | null {
	if (typeof url !== "string" || !url.trim()) {
		return null;
	}
	const trimmed = url.trim();
	const scp = trimmed.match(GIT_SCP_REMOTE_RE);
	let rawPath: string | null;
	if (scp) {
		rawPath = scp[1] ?? null;
	} else {
		try {
			rawPath = new URL(trimmed).pathname;
		} catch {
			rawPath = null;
		}
	}
	if (!rawPath) {
		return null;
	}
	const cleaned = rawPath
		.replace(GIT_REMOTE_LEADING_SLASHES_RE, "")
		.replace(GIT_REMOTE_DOT_GIT_RE, "")
		.replace(GIT_REMOTE_TRAILING_SLASHES_RE, "");
	return cleaned || null;
}

/** Real git/fs implementations. Overridden per-field in tests. */
export function defaultRepoProfileOps(): RepoProfileOps {
	return {
		existsSync: (p) => fs.existsSync(p),
		readFileSync: (p) => fs.readFileSync(p, "utf8"),
		repoRoot: (cwd) => {
			try {
				return execFileSync("git", ["rev-parse", "--show-toplevel"], {
					cwd,
					encoding: "utf8",
					stdio: ["pipe", "pipe", "pipe"],
				}).trim();
			} catch {
				return null;
			}
		},
		originFullpath: (cwd) => {
			try {
				const url = execFileSync("git", ["remote", "get-url", "origin"], {
					cwd,
					encoding: "utf8",
					stdio: ["pipe", "pipe", "pipe"],
				}).trim();
				return parseGitRemoteFullpath(url);
			} catch {
				return null;
			}
		},
	};
}

function readJsonObject(
	filePath: string,
	ops: RepoProfileOps,
	onWarn?: (filePath: string) => void,
): Record<string, unknown> | null {
	if (!ops.existsSync(filePath)) {
		return null;
	}
	try {
		const parsed = JSON.parse(ops.readFileSync(filePath));
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		// Fail open — a malformed config must never take down unrelated
		// commands — but surface it so a fat-fingered mapping doesn't hide as a
		// confusing lookup miss two steps downstream.
		onWarn?.(filePath);
		return null;
	}
}

/**
 * Resolve the profile a repo is pinned to, or null when it has no pin.
 * Repo-local `.el-git.json` wins over the global `owner/repo` table; within the
 * table an exact key wins over the `owner/*` wildcard.
 */
export function resolveRepoLinearProfile(
	cwd: string = process.cwd(),
	opts: ResolveRepoProfileOptions = {},
): RepoLinearProfile | null {
	const ops: RepoProfileOps = {
		...defaultRepoProfileOps(),
		...(opts.ops ?? {}),
	};
	const env = opts.env ?? process.env;
	const onWarn = opts.onMalformedConfig;

	const root = ops.repoRoot(cwd);
	if (root) {
		const repoConfig = readJsonObject(
			path.join(root, LINEAR_PROFILE_REPO_FILE),
			ops,
			onWarn,
		);
		const fromRepo = repoConfig?.linearProfile;
		if (typeof fromRepo === "string" && fromRepo.trim()) {
			return { profile: fromRepo.trim(), source: "repo-file" };
		}
	}

	const userConfig = readJsonObject(globalPinTablePath(env), ops, onWarn);
	const table = userConfig?.profiles;
	if (typeof table !== "object" || table === null) {
		return null;
	}
	const fullpath = ops.originFullpath(cwd);
	if (!fullpath) {
		return null;
	}
	const lookup = table as Record<string, unknown>;
	const exact = lookup[fullpath];
	if (typeof exact === "string" && exact.trim()) {
		return { profile: exact.trim(), source: "user-config" };
	}
	const wildcard = lookup[`${fullpath.split("/")[0]}/*`];
	if (typeof wildcard === "string" && wildcard.trim()) {
		return { profile: wildcard.trim(), source: "user-config" };
	}
	return null;
}

// ---- Write helpers (pure) ----------------------------------------------------
//
// The pin/unpin commands do the actual fs I/O; these pure string→string helpers
// hold the merge logic so it is unit-testable and can't clobber sibling keys.

function parseMutableJsonObject(
	existing: string | null,
	fileName: string,
): Record<string, unknown> {
	if (existing === null) {
		return {};
	}
	try {
		const parsed = JSON.parse(existing);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error("expected a JSON object");
		}
		return parsed as Record<string, unknown>;
	} catch {
		throw new Error(
			`Refusing to edit malformed JSON in ${fileName}. Fix or remove it, then retry.`,
		);
	}
}

/**
 * Merge `{ linearProfile: name }` into an existing `.el-git.json` body,
 * preserving every other key. `existing` is the current file text (or null when
 * the file is absent). Returns the new file text (2-space, trailing newline).
 */
export function applyRepoLocalPin(
	existing: string | null,
	name: string,
): string {
	const obj = parseMutableJsonObject(existing, LINEAR_PROFILE_REPO_FILE);
	obj.linearProfile = name;
	return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Remove the `linearProfile` key from an existing `.el-git.json` body,
 * preserving other keys. Returns the new file text, or null when the file
 * should be deleted (it held only the pin / was absent / becomes empty).
 */
export function removeRepoLocalPin(existing: string | null): string | null {
	if (existing === null) {
		return null;
	}
	const obj = parseMutableJsonObject(existing, LINEAR_PROFILE_REPO_FILE);
	if (!("linearProfile" in obj)) {
		// Nothing to remove; leave the file exactly as-is.
		return existing;
	}
	delete obj.linearProfile;
	if (Object.keys(obj).length === 0) {
		return null;
	}
	return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Merge `profiles[fullpath] = name` into the global pin table body, preserving
 * every other entry. Returns the new file text (2-space, trailing newline).
 */
export function applyGlobalPin(
	existing: string | null,
	fullpath: string,
	name: string,
): string {
	const obj = parseMutableJsonObject(existing, LINEAR_PROFILE_USER_CONFIG);
	const table =
		typeof obj.profiles === "object" &&
		obj.profiles !== null &&
		!Array.isArray(obj.profiles)
			? (obj.profiles as Record<string, unknown>)
			: {};
	table[fullpath] = name;
	obj.profiles = table;
	return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Remove an exact `owner/repo` entry from the global pin table. Preserves
 * wildcard entries and unrelated top-level keys. Returns null only when the
 * file is absent or becomes empty after removal.
 */
export function removeGlobalPin(
	existing: string | null,
	fullpath: string,
): string | null {
	if (existing === null) {
		return null;
	}
	const obj = parseMutableJsonObject(existing, LINEAR_PROFILE_USER_CONFIG);
	if (
		typeof obj.profiles !== "object" ||
		obj.profiles === null ||
		Array.isArray(obj.profiles)
	) {
		return existing;
	}
	const table = obj.profiles as Record<string, unknown>;
	if (!(fullpath in table)) {
		return existing;
	}
	delete table[fullpath];
	if (Object.keys(table).length === 0) {
		delete obj.profiles;
	}
	if (Object.keys(obj).length === 0) {
		return null;
	}
	return `${JSON.stringify(obj, null, 2)}\n`;
}
