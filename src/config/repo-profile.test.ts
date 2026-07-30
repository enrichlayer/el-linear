/**
 * Tests for the repo→Linear-profile resolver + pin write helpers (DEV-7277).
 *
 * All git/fs access is injected via `RepoProfileOps` so these run hermetically
 * with no real repo, tmpdir, or env mutation. The file formats + precedence
 * mirror the shared el-git contract; keep these in step with any change to
 * `resolveRepoLinearProfile` in cli-package-info.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyGlobalPin,
	applyRepoLocalPin,
	globalPinTablePath,
	LINEAR_PROFILE_REPO_FILE,
	parseGitRemoteFullpath,
	type RepoProfileOps,
	removeGlobalPin,
	removeRepoLocalPin,
	resolveRepoLinearProfile,
} from "./repo-profile.js";

/**
 * Build ops backed by an in-memory file map + fixed repo root / origin.
 */
function makeOps(opts: {
	files?: Record<string, string>;
	root?: string | null;
	origin?: string | null;
}): RepoProfileOps {
	const files = opts.files ?? {};
	return {
		existsSync: (p) => Object.hasOwn(files, p),
		readFileSync: (p) => {
			if (!Object.hasOwn(files, p)) {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			}
			return files[p] as string;
		},
		repoRoot: () => opts.root ?? null,
		originFullpath: () => opts.origin ?? null,
	};
}

const XDG = "/xdg";
const ENV = { XDG_CONFIG_HOME: XDG } as NodeJS.ProcessEnv;
const GLOBAL_TABLE = path.join(XDG, "el-git", "linear-profiles.json");

describe("parseGitRemoteFullpath", () => {
	it("parses scp-style git@host:owner/repo.git", () => {
		expect(
			parseGitRemoteFullpath("git@github.com:enrichlayer/el-linear.git"),
		).toBe("enrichlayer/el-linear");
	});

	it("parses https://host/owner/repo(.git) with and without .git", () => {
		expect(
			parseGitRemoteFullpath("https://github.com/enrichlayer/el-linear.git"),
		).toBe("enrichlayer/el-linear");
		expect(
			parseGitRemoteFullpath("https://github.com/enrichlayer/el-linear"),
		).toBe("enrichlayer/el-linear");
	});

	it("returns null for empty / unparseable input", () => {
		expect(parseGitRemoteFullpath("")).toBeNull();
		expect(parseGitRemoteFullpath(null)).toBeNull();
		expect(parseGitRemoteFullpath("   ")).toBeNull();
	});
});

describe("resolveRepoLinearProfile — precedence", () => {
	const root = "/repo";
	const repoFile = path.join(root, LINEAR_PROFILE_REPO_FILE);

	it("prefers the repo-local .el-git.json (source repo-file)", () => {
		const ops = makeOps({
			root,
			origin: "enrichlayer/el-linear",
			files: {
				[repoFile]: JSON.stringify({ linearProfile: "forage" }),
				[GLOBAL_TABLE]: JSON.stringify({
					profiles: { "enrichlayer/el-linear": "other" },
				}),
			},
		});
		expect(resolveRepoLinearProfile("/repo", { ops, env: ENV })).toEqual({
			profile: "forage",
			source: "repo-file",
		});
	});

	it("falls back to the global exact owner/repo key (source user-config)", () => {
		const ops = makeOps({
			root,
			origin: "enrichlayer/el-linear",
			files: {
				[GLOBAL_TABLE]: JSON.stringify({
					profiles: { "enrichlayer/el-linear": "work" },
				}),
			},
		});
		expect(resolveRepoLinearProfile("/repo", { ops, env: ENV })).toEqual({
			profile: "work",
			source: "user-config",
		});
	});

	it("matches the owner/* wildcard when no exact key exists", () => {
		const ops = makeOps({
			root,
			origin: "enrichlayer/some-other-repo",
			files: {
				[GLOBAL_TABLE]: JSON.stringify({
					profiles: { "enrichlayer/*": "work" },
				}),
			},
		});
		expect(resolveRepoLinearProfile("/repo", { ops, env: ENV })).toEqual({
			profile: "work",
			source: "user-config",
		});
	});

	it("prefers an exact key over the owner/* wildcard", () => {
		const ops = makeOps({
			root,
			origin: "enrichlayer/el-linear",
			files: {
				[GLOBAL_TABLE]: JSON.stringify({
					profiles: {
						"enrichlayer/el-linear": "exact",
						"enrichlayer/*": "wild",
					},
				}),
			},
		});
		expect(resolveRepoLinearProfile("/repo", { ops, env: ENV })?.profile).toBe(
			"exact",
		);
	});

	it("returns null when nothing pins the repo", () => {
		const ops = makeOps({ root, origin: "enrichlayer/el-linear", files: {} });
		expect(resolveRepoLinearProfile("/repo", { ops, env: ENV })).toBeNull();
	});

	it("returns null when not inside a git repo and no global match", () => {
		const ops = makeOps({ root: null, origin: null, files: {} });
		expect(resolveRepoLinearProfile("/tmp", { ops, env: ENV })).toBeNull();
	});

	it("still consults the global table when outside a repo but origin is known", () => {
		// repoRoot null, but originFullpath resolvable: exercises the fallback arm.
		const ops = makeOps({
			root: null,
			origin: "enrichlayer/el-linear",
			files: {
				[GLOBAL_TABLE]: JSON.stringify({
					profiles: { "enrichlayer/el-linear": "work" },
				}),
			},
		});
		expect(resolveRepoLinearProfile("/x", { ops, env: ENV })?.profile).toBe(
			"work",
		);
	});

	it("fails open + warns on a malformed repo file rather than throwing", () => {
		const warned: string[] = [];
		const ops = makeOps({
			root,
			origin: "enrichlayer/el-linear",
			files: { [path.join(root, LINEAR_PROFILE_REPO_FILE)]: "{ not json" },
		});
		expect(
			resolveRepoLinearProfile("/repo", {
				ops,
				env: ENV,
				onMalformedConfig: (f) => warned.push(f),
			}),
		).toBeNull();
		expect(warned).toHaveLength(1);
	});

	it("ignores a blank linearProfile value", () => {
		const ops = makeOps({
			root,
			origin: "enrichlayer/el-linear",
			files: {
				[path.join(root, LINEAR_PROFILE_REPO_FILE)]: JSON.stringify({
					linearProfile: "   ",
				}),
			},
		});
		expect(resolveRepoLinearProfile("/repo", { ops, env: ENV })).toBeNull();
	});
});

describe("globalPinTablePath", () => {
	it("honors XDG_CONFIG_HOME", () => {
		expect(globalPinTablePath(ENV)).toBe(GLOBAL_TABLE);
	});
});

describe("applyRepoLocalPin", () => {
	it("creates a new file body when none exists", () => {
		const out = applyRepoLocalPin(null, "forage");
		expect(JSON.parse(out)).toEqual({ linearProfile: "forage" });
		expect(out.endsWith("\n")).toBe(true);
	});

	it("merges into existing JSON without clobbering sibling keys", () => {
		const existing = JSON.stringify({ keep: "me", linearProfile: "old" });
		const out = applyRepoLocalPin(existing, "new");
		expect(JSON.parse(out)).toEqual({ keep: "me", linearProfile: "new" });
	});

	it("throws rather than clobbering malformed JSON", () => {
		expect(() => applyRepoLocalPin("{ bad", "x")).toThrow(/malformed JSON/);
	});

	it.each([
		"[]",
		"null",
		'"keep"',
		"   ",
	])("refuses valid non-object or empty JSON instead of clobbering %j", (existing) => {
		expect(() => applyRepoLocalPin(existing, "x")).toThrow(/malformed JSON/);
	});
});

describe("removeRepoLocalPin", () => {
	it("returns null (delete) when the pin was the only key", () => {
		expect(
			removeRepoLocalPin(JSON.stringify({ linearProfile: "x" })),
		).toBeNull();
	});

	it("preserves sibling keys and drops only linearProfile", () => {
		const out = removeRepoLocalPin(
			JSON.stringify({ keep: "me", linearProfile: "x" }),
		);
		expect(JSON.parse(out as string)).toEqual({ keep: "me" });
	});

	it("leaves a file with no linearProfile untouched", () => {
		const existing = JSON.stringify({ keep: "me" });
		expect(removeRepoLocalPin(existing)).toBe(existing);
	});

	it("returns null for an absent file", () => {
		expect(removeRepoLocalPin(null)).toBeNull();
	});

	it.each([
		"[]",
		"null",
		'"keep"',
		"   ",
	])("refuses valid non-object or empty JSON instead of deleting %j", (existing) => {
		expect(() => removeRepoLocalPin(existing)).toThrow(/malformed JSON/);
	});
});

describe("removeGlobalPin", () => {
	it("removes only the exact owner/repo entry and preserves wildcards", () => {
		const out = removeGlobalPin(
			JSON.stringify({
				profiles: {
					"enrichlayer/el-linear": "work",
					"enrichlayer/*": "default",
				},
				other: true,
			}),
			"enrichlayer/el-linear",
		);
		expect(JSON.parse(out as string)).toEqual({
			profiles: { "enrichlayer/*": "default" },
			other: true,
		});
	});

	it("returns null when the removed mapping was the file's only data", () => {
		expect(
			removeGlobalPin(
				JSON.stringify({
					profiles: { "enrichlayer/el-linear": "work" },
				}),
				"enrichlayer/el-linear",
			),
		).toBeNull();
	});

	it("leaves an unrelated global table byte-identical", () => {
		const existing = JSON.stringify({ profiles: { "a/b": "one" } });
		expect(removeGlobalPin(existing, "c/d")).toBe(existing);
	});
});

describe("applyGlobalPin", () => {
	it("creates the profiles table when none exists", () => {
		const out = applyGlobalPin(null, "enrichlayer/el-linear", "work");
		expect(JSON.parse(out)).toEqual({
			profiles: { "enrichlayer/el-linear": "work" },
		});
	});

	it("merges into an existing table without dropping other entries", () => {
		const existing = JSON.stringify({
			profiles: { "a/b": "one" },
			other: true,
		});
		const out = applyGlobalPin(existing, "c/d", "two");
		expect(JSON.parse(out)).toEqual({
			profiles: { "a/b": "one", "c/d": "two" },
			other: true,
		});
	});

	it("overwrites the value for a key that already exists", () => {
		const existing = JSON.stringify({ profiles: { "a/b": "one" } });
		const out = applyGlobalPin(existing, "a/b", "two");
		expect(JSON.parse(out)).toEqual({ profiles: { "a/b": "two" } });
	});

	it.each([
		"[]",
		"null",
		'"keep"',
		"   ",
	])("refuses valid non-object or empty JSON instead of clobbering %j", (existing) => {
		expect(() => applyGlobalPin(existing, "a/b", "two")).toThrow(
			/malformed JSON/,
		);
	});
});
