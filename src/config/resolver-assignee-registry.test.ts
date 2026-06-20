import { beforeEach, describe, expect, it, vi } from "vitest";

// Composition test for the DEV-4871 registry layering in resolveAssignee:
// registry-first (when opt-in), config fallback otherwise. Mocks the thin
// registry client and the bundled config so we assert the branch the caller
// actually takes.
const { mockIsConfigured, mockResolveViaRegistry } = vi.hoisted(() => ({
	mockIsConfigured: vi.fn(),
	mockResolveViaRegistry: vi.fn(),
}));

vi.mock("./registry-resolve.js", () => ({
	isRegistryConfigured: mockIsConfigured,
	resolveViaRegistry: mockResolveViaRegistry,
}));

vi.mock("./config.js", () => ({
	loadConfig: () => ({
		members: {
			aliases: { dima: "Dmitrii" },
			uuids: { Dmitrii: "config-uuid-dmitrii" },
			handles: {},
			fullNames: {},
		},
	}),
}));

import { resolveAssignee } from "./resolver.js";

describe("resolveAssignee — opt-in registry layering (DEV-4871)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns the registry UUID when configured and the registry resolves", async () => {
		mockIsConfigured.mockReturnValue(true);
		mockResolveViaRegistry.mockResolvedValue("registry-uuid-dmitrii");
		await expect(resolveAssignee("dima", {})).resolves.toBe(
			"registry-uuid-dmitrii",
		);
		expect(mockResolveViaRegistry).toHaveBeenCalledWith("dima");
	});

	it("falls back to config resolveMember when the registry misses", async () => {
		mockIsConfigured.mockReturnValue(true);
		mockResolveViaRegistry.mockResolvedValue(null);
		await expect(resolveAssignee("dima", {})).resolves.toBe(
			"config-uuid-dmitrii",
		);
	});

	it("never consults the registry when unconfigured — config-only (OSS default)", async () => {
		mockIsConfigured.mockReturnValue(false);
		await expect(resolveAssignee("dima", {})).resolves.toBe(
			"config-uuid-dmitrii",
		);
		expect(mockResolveViaRegistry).not.toHaveBeenCalled();
	});
});
