import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const ENV_KEY = "EL_LINEAR_WORKSPACE_URL_KEY";

describe("getWorkspaceUrlKey", () => {
	let originalEnv: string | undefined;

	beforeEach(() => {
		_resetWorkspaceUrlKeyCache();
		vi.clearAllMocks();
		originalEnv = process.env[ENV_KEY];
		delete process.env[ENV_KEY];
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env[ENV_KEY];
		} else {
			process.env[ENV_KEY] = originalEnv;
		}
	});

	it("returns options.override when set, without reading config or env", async () => {
		mockLoadConfig.mockReturnValue({
			...baseConfig,
			workspaceUrlKey: "config",
		});
		process.env[ENV_KEY] = "env";
		const service = makeService();

		const result = await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
			{ override: "explicit" },
		);

		expect(result).toBe("explicit");
		expect(service.rawRequest).not.toHaveBeenCalled();
		expect(mockLoadConfig).not.toHaveBeenCalled();
	});

	it("returns the env var when no override is supplied", async () => {
		mockLoadConfig.mockReturnValue({
			...baseConfig,
			workspaceUrlKey: "config",
		});
		process.env[ENV_KEY] = "from-env";
		const service = makeService();

		const result = await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
		);

		expect(result).toBe("from-env");
		expect(service.rawRequest).not.toHaveBeenCalled();
		// Config is not consulted when env wins.
		expect(mockLoadConfig).not.toHaveBeenCalled();
	});

	it("returns config.workspaceUrlKey when no override or env, without calling the API", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "acme" });
		const service = makeService();

		const result = await getWorkspaceUrlKey(
			service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
		);

		expect(result).toBe("acme");
		expect(service.rawRequest).not.toHaveBeenCalled();
	});

	it("queries viewer.organization.urlKey when nothing is configured", async () => {
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

	it("throws when no graphQLService is given and no override/env/config exists", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });

		await expect(getWorkspaceUrlKey(undefined)).rejects.toThrow(
			/no override, env, or config/i,
		);
	});

	it("works offline when override is supplied without a graphQLService", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });

		const result = await getWorkspaceUrlKey(undefined, { override: "offline" });

		expect(result).toBe("offline");
		expect(mockLoadConfig).not.toHaveBeenCalled();
	});

	it("works offline when env var is supplied without a graphQLService", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });
		process.env[ENV_KEY] = "env-offline";

		const result = await getWorkspaceUrlKey(undefined);

		expect(result).toBe("env-offline");
		expect(mockLoadConfig).not.toHaveBeenCalled();
	});

	it("caches the API result so subsequent calls do not hit the network", async () => {
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

	it("does not cache env-supplied values — env changes win on next call", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });
		process.env[ENV_KEY] = "first";

		const first = await getWorkspaceUrlKey(undefined);
		process.env[ENV_KEY] = "second";
		const second = await getWorkspaceUrlKey(undefined);

		expect(first).toBe("first");
		expect(second).toBe("second");
	});

	// DEV-4067: validate env/config values against /^[a-z0-9-]+$/i so a
	// malformed key (`javascript:alert(1)#`, leading space, etc.) can't
	// flow into markdown link URLs verbatim.
	it("throws on env var containing invalid characters (space)", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });
		process.env[ENV_KEY] = " evil ";
		await expect(getWorkspaceUrlKey(undefined)).rejects.toThrow(
			/Invalid Linear workspace URL key/i,
		);
	});

	it("throws on env var containing scheme injection chars", async () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, workspaceUrlKey: "" });
		process.env[ENV_KEY] = "javascript:alert(1)#";
		await expect(getWorkspaceUrlKey(undefined)).rejects.toThrow(
			/Invalid Linear workspace URL key/i,
		);
	});

	it("throws on config.workspaceUrlKey containing invalid characters", async () => {
		mockLoadConfig.mockReturnValue({
			...baseConfig,
			workspaceUrlKey: "ev/il.com",
		});
		const service = makeService();
		await expect(
			getWorkspaceUrlKey(
				service as unknown as Parameters<typeof getWorkspaceUrlKey>[0],
			),
		).rejects.toThrow(/Invalid Linear workspace URL key/i);
	});

	it("throws on --workspace-url-key flag containing invalid characters", async () => {
		await expect(
			getWorkspaceUrlKey(undefined, { override: "ev/il.com" }),
		).rejects.toThrow(/Invalid Linear workspace URL key/i);
	});

	it("accepts mixed-case + digits + hyphens (the URL-key spec)", async () => {
		process.env[ENV_KEY] = "Vertical-Int-1";
		expect(await getWorkspaceUrlKey(undefined)).toBe("Vertical-Int-1");
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
