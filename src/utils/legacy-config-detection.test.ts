/**
 * Tests for the pure drift detector. We mock the FS operations rather than
 * touch real disk so every branch (including the unreadable-profiles-dir
 * fallback) is reachable without elevated permissions.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	ACTIVE_PROFILE_FILE,
	CONFIG_PATH,
	PROFILES_DIR,
	TOKEN_PATH,
} from "../config/paths.js";
import {
	type DetectionFsOps,
	detectLegacyDrift,
} from "./legacy-config-detection.js";

interface FakeFsState {
	files: Record<string, string>;
	dirs: Record<string, string[]>;
	/** Force readdirSync to throw — simulates a permissions error. */
	readdirThrows?: Set<string>;
}

function makeFs(state: FakeFsState): DetectionFsOps {
	return {
		existsSync: (p) =>
			Object.hasOwn(state.files, p) || Object.hasOwn(state.dirs, p),
		readFileSync: (p) => {
			if (!Object.hasOwn(state.files, p)) {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			}
			return state.files[p];
		},
		readdirSync: (p) => {
			if (state.readdirThrows?.has(p)) {
				throw new Error("EACCES");
			}
			if (!Object.hasOwn(state.dirs, p)) {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			}
			return state.dirs[p];
		},
	};
}

describe("detectLegacyDrift", () => {
	it("returns no-drift on a freshly-onboarded machine (nothing on disk)", () => {
		const fs = makeFs({ files: {}, dirs: {} });
		expect(detectLegacyDrift(fs)).toEqual({ kind: "no-drift" });
	});

	it("returns no-drift on a healthy single-file install (legacy config + legacy token both present)", () => {
		const fs = makeFs({
			files: {
				[CONFIG_PATH]: '{"defaultTeam":"ENG"}',
				[TOKEN_PATH]: "lin_api_test_xxxxxxxxxxxxxxxx",
			},
			dirs: {},
		});
		expect(detectLegacyDrift(fs)).toEqual({ kind: "no-drift" });
	});

	it("returns no-drift when a profile is configured (legacy config + populated profiles dir)", () => {
		const fs = makeFs({
			files: {
				[CONFIG_PATH]: '{"defaultTeam":"ENG"}',
				[ACTIVE_PROFILE_FILE]: "work\n",
				[path.join(PROFILES_DIR, "work", "token")]: "lin_api_test_xxxxxxxxxxx",
			},
			dirs: {
				[PROFILES_DIR]: ["work"],
				[path.join(PROFILES_DIR, "work")]: ["token", "config.json"],
			},
		});
		expect(detectLegacyDrift(fs)).toEqual({ kind: "no-drift" });
	});

	it("returns legacy-no-token when legacy config exists but token does not, and no profiles", () => {
		const fs = makeFs({
			files: { [CONFIG_PATH]: '{"defaultTeam":"ENG"}' },
			dirs: {},
		});
		expect(detectLegacyDrift(fs)).toEqual({
			kind: "legacy-no-token",
			legacyConfigPath: CONFIG_PATH,
		});
	});

	it("returns legacy-no-token when profiles dir exists but is empty", () => {
		const fs = makeFs({
			files: { [CONFIG_PATH]: '{"defaultTeam":"ENG"}' },
			dirs: { [PROFILES_DIR]: [] },
		});
		expect(detectLegacyDrift(fs)).toEqual({
			kind: "legacy-no-token",
			legacyConfigPath: CONFIG_PATH,
		});
	});

	it("returns broken-active-profile when active-profile points at a missing dir", () => {
		const fs = makeFs({
			files: {
				[CONFIG_PATH]: '{"defaultTeam":"ENG"}',
				[ACTIVE_PROFILE_FILE]: "ghost\n",
			},
			dirs: { [PROFILES_DIR]: [] },
		});
		expect(detectLegacyDrift(fs)).toEqual({
			kind: "broken-active-profile",
			pointedAt: "ghost",
		});
	});

	it("ignores an empty active-profile marker (whitespace-only) and falls through", () => {
		const fs = makeFs({
			files: {
				[CONFIG_PATH]: '{"defaultTeam":"ENG"}',
				[ACTIVE_PROFILE_FILE]: "  \n",
			},
			dirs: {},
		});
		expect(detectLegacyDrift(fs)).toEqual({
			kind: "legacy-no-token",
			legacyConfigPath: CONFIG_PATH,
		});
	});

	it("treats unreadable profiles dir as empty (does not crash detection)", () => {
		const fs = makeFs({
			files: { [CONFIG_PATH]: '{"defaultTeam":"ENG"}' },
			dirs: { [PROFILES_DIR]: [] },
			readdirThrows: new Set([PROFILES_DIR]),
		});
		expect(detectLegacyDrift(fs)).toEqual({
			kind: "legacy-no-token",
			legacyConfigPath: CONFIG_PATH,
		});
	});

	it("classifies broken-active-profile *before* legacy-no-token (broken pointer wins)", () => {
		// User has legacy config, no token, no profiles, and an active-profile
		// marker pointing somewhere bogus. The right hint is "switch profile",
		// not "migrate" — broken-active-profile is the more specific signal.
		const fs = makeFs({
			files: {
				[CONFIG_PATH]: '{"defaultTeam":"ENG"}',
				[ACTIVE_PROFILE_FILE]: "ghost\n",
			},
			dirs: {},
		});
		expect(detectLegacyDrift(fs)).toEqual({
			kind: "broken-active-profile",
			pointedAt: "ghost",
		});
	});

	it("returns no-drift when neither legacy config nor profiles exist (truly fresh)", () => {
		const fs = makeFs({ files: {}, dirs: {} });
		expect(detectLegacyDrift(fs)).toEqual({ kind: "no-drift" });
	});
});
