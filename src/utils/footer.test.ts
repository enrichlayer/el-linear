import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadConfig = vi.fn();
vi.mock("../config/config.js", () => ({
	loadConfig: mockLoadConfig,
}));

const { applyFooter } = await import("./footer.js");

const baseConfig = {
	defaultTeam: "",
	defaultLabels: [],
	labels: { workspace: {}, teams: {} },
	members: { aliases: {}, fullNames: {}, handles: {}, uuids: {} },
	teams: {},
	teamAliases: {},
	statusDefaults: { noProject: "Triage", withAssigneeAndProject: "Todo" },
	terms: [],
};

describe("applyFooter", () => {
	beforeEach(() => {
		mockLoadConfig.mockReset();
		mockLoadConfig.mockReturnValue(baseConfig);
	});

	it("returns body unchanged when no footer configured and no flag", () => {
		expect(applyFooter("hello", {})).toBe("hello");
	});

	it("appends config.messageFooter when set", () => {
		mockLoadConfig.mockReturnValue({
			...baseConfig,
			messageFooter: "\n\n— sent via el-linear",
		});
		expect(applyFooter("hello", {})).toBe("hello\n\n— sent via el-linear");
	});

	it("--footer overrides config", () => {
		mockLoadConfig.mockReturnValue({
			...baseConfig,
			messageFooter: "\n\n— config footer",
		});
		expect(applyFooter("hello", { footer: "\n— flag footer" })).toBe(
			"hello\n— flag footer",
		);
	});

	it("--no-footer skips both flag and config", () => {
		mockLoadConfig.mockReturnValue({
			...baseConfig,
			messageFooter: "\n\n— config footer",
		});
		expect(
			applyFooter("hello", { footer: "\n— flag footer", noFooter: true }),
		).toBe("hello");
	});

	it("returns the footer alone when body is undefined and footer is set", () => {
		expect(applyFooter(undefined, { footer: "alone" })).toBe("alone");
	});

	it("returns undefined when body is undefined and no footer", () => {
		expect(applyFooter(undefined, {})).toBeUndefined();
	});

	it("treats empty string footer as no footer", () => {
		mockLoadConfig.mockReturnValue({ ...baseConfig, messageFooter: "" });
		expect(applyFooter("hello", {})).toBe("hello");
	});
});
