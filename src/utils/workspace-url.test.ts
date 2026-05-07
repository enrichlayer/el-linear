import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadConfig = vi.fn();
vi.mock("../config/config.js", () => ({
	loadConfig: mockLoadConfig,
}));

const { getWorkspaceUrlKey, _resetWorkspaceUrlKeyCache } = await import(
	"./workspace-url.js"
);

interface FakeGraphQLService {
	rawRequest: ReturnType<typeof vi.fn>;
}

function makeService(): FakeGraphQLService {
	return { rawRequest: vi.fn() };
}

const baseConfig = {
	defaultTeam: "",
	defaultLabels: [],
	labels: { workspace: {}, teams: {} },
	members: { aliases: {}, fullNames: {}, handles: {}, uuids: {} },
	teams: {},
	teamAliases: {},
	statusDefaults: { noProject: "Triage", withAssigneeAndProject: "Todo" },
	terms: [],
	workspaceUrlKey: "",
};

describe("getWorkspaceUrlKey", () => {
	beforeEach(() => {
		_resetWorkspaceUrlKeyCache();
		vi.clearAllMocks();
	});

	it("returns config.workspaceUrlKey when set, without calling the API", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "acme" });
		const service = makeService();

		const result = await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
		);

		expect(result).toBe("acme");
		expect(service.rawRequest).not.toHaveBeenCalled();
	});

	it("queries viewer.organization.urlKey when config has no override", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });
		const service = makeService();
		service.rawRequest.mockResolvedValue({
			viewer: { organization: { urlKey: "fetched" } },
		});

		const result = await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
		);

		expect(result).toBe("fetched");
		expect(service.rawRequest).toHaveBeenCalledWith(
			expect.stringContaining("ViewerOrgUrlKey"),
		);
	});

	it("caches the result so subsequent calls do not hit the API", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });
		const service = makeService();
		service.rawRequest.mockResolvedValue({
			viewer: { organization: { urlKey: "cached" } },
		});

		const a = await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
		);
		const b = await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
		);

		expect(a).toBe("cached");
		expect(b).toBe("cached");
		expect(service.rawRequest).toHaveBeenCalledTimes(1);
		expect(mockLoadConfig).toHaveBeenCalledTimes(1);
	});

	it("throws when API returns no urlKey", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });
		const service = makeService();
		service.rawRequest.mockResolvedValue({
			viewer: { organization: { urlKey: "" } },
		});

		await expect(
			getWorkspaceUrlKey(
				service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
			),
		).rejects.toThrow(/Could not resolve.*workspace URL key/i);
	});

	it("_resetWorkspaceUrlKeyCache forces refetch", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });
		const service = makeService();
		service.rawRequest.mockResolvedValue({
			viewer: { organization: { urlKey: "first" } },
		});

		await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
		);
		_resetWorkspaceUrlKeyCache();
		service.rawRequest.mockResolvedValue({
			viewer: { organization: { urlKey: "second" } },
		});
		const after = await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
		);

		expect(after).toBe("second");
		expect(service.rawRequest).toHaveBeenCalledTimes(2);
	});
});
