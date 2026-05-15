/**
 * Tests for the profile resolver in `paths.ts`. The session override
 * setter is global state, so each test resets it explicitly.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ACTIVE_PROFILE_FILE,
	CONFIG_PATH,
	getSessionProfileOverride,
	LOCAL_CONFIG_PATH,
	PROFILES_DIR,
	type ProfileFsOps,
	profilePaths,
	resolveActiveProfile,
	setActiveProfileForSession,
	TOKEN_PATH,
} from "./paths.js";

function makeFsOps(presence: Record<string, string | null>): ProfileFsOps {
	return {
		existsSync: (p: string) => Object.hasOwn(presence, p),
		readFileSync: (p: string) => {
			if (!Object.hasOwn(presence, p)) {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			}
			return presence[p] ?? "";
		},
	};
}

describe("setActiveProfileForSession + getSessionProfileOverride", () => {
	afterEach(() => setActiveProfileForSession(null));

	it("stores and clears the per-session override", () => {
		expect(getSessionProfileOverride()).toBeNull();
		setActiveProfileForSession("forage");
		expect(getSessionProfileOverride()).toBe("forage");
		setActiveProfileForSession(null);
		expect(getSessionProfileOverride()).toBeNull();
	});

	it("trims whitespace and treats empty / whitespace-only as null", () => {
		setActiveProfileForSession("  forage  ");
		expect(getSessionProfileOverride()).toBe("forage");
		setActiveProfileForSession("   ");
		expect(getSessionProfileOverride()).toBeNull();
		setActiveProfileForSession("");
		expect(getSessionProfileOverride()).toBeNull();
	});
});

describe("profilePaths", () => {
	it("builds <CONFIG_DIR>/profiles/<name>/{config.json,local.json,token}", () => {
		const r = profilePaths("forage");
		expect(r.name).toBe("forage");
		expect(r.configPath).toBe(`${PROFILES_DIR}/forage/config.json`);
		expect(r.localConfigPath).toBe(`${PROFILES_DIR}/forage/local.json`);
		expect(r.tokenPath).toBe(`${PROFILES_DIR}/forage/token`);
	});
});

describe("resolveActiveProfile — priority order", () => {
	beforeEach(() => setActiveProfileForSession(null));
	afterEach(() => setActiveProfileForSession(null));

	it("returns the legacy single-file layout when nothing is configured", () => {
		const fsOps = makeFsOps({});
		const r = resolveActiveProfile({}, fsOps);
		expect(r.name).toBeNull();
		expect(r.configPath).toBe(CONFIG_PATH);
		expect(r.localConfigPath).toBe(LOCAL_CONFIG_PATH);
		expect(r.tokenPath).toBe(TOKEN_PATH);
	});

	it("respects the per-session override above all other sources", () => {
		setActiveProfileForSession("override");
		const fsOps = makeFsOps({ [ACTIVE_PROFILE_FILE]: "ondisk\n" });
		const r = resolveActiveProfile({ EL_LINEAR_PROFILE: "envprofile" }, fsOps);
		expect(r.name).toBe("override");
		expect(r.configPath).toContain("/profiles/override/config.json");
		expect(r.localConfigPath).toContain("/profiles/override/local.json");
	});

	it("uses EL_LINEAR_PROFILE env when no session override", () => {
		const fsOps = makeFsOps({ [ACTIVE_PROFILE_FILE]: "ondisk\n" });
		const r = resolveActiveProfile({ EL_LINEAR_PROFILE: "envprofile" }, fsOps);
		expect(r.name).toBe("envprofile");
	});

	it("uses the on-disk active-profile marker when no session/env override", () => {
		const fsOps = makeFsOps({ [ACTIVE_PROFILE_FILE]: "ondisk\n" });
		const r = resolveActiveProfile({}, fsOps);
		expect(r.name).toBe("ondisk");
		expect(r.configPath).toContain("/profiles/ondisk/config.json");
		expect(r.localConfigPath).toContain("/profiles/ondisk/local.json");
	});

	it("ignores empty / whitespace marker files", () => {
		const fsOps = makeFsOps({ [ACTIVE_PROFILE_FILE]: "   \n" });
		const r = resolveActiveProfile({}, fsOps);
		expect(r.name).toBeNull();
		expect(r.configPath).toBe(CONFIG_PATH);
	});

	it("ignores empty / whitespace EL_LINEAR_PROFILE", () => {
		const fsOps = makeFsOps({});
		const r = resolveActiveProfile({ EL_LINEAR_PROFILE: "   " }, fsOps);
		expect(r.name).toBeNull();
		expect(r.configPath).toBe(CONFIG_PATH);
	});

	it("trims whitespace from the on-disk marker", () => {
		const fsOps = makeFsOps({ [ACTIVE_PROFILE_FILE]: "  ondisk  \n" });
		const r = resolveActiveProfile({}, fsOps);
		expect(r.name).toBe("ondisk");
	});
});
