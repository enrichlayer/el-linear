import { describe, expect, it, vi } from "vitest";

vi.mock("./config.js", () => ({
	loadConfig: vi.fn(() => ({
		statusDefaults: {
			noProject: "Triage",
			withAssigneeAndProject: "Todo",
		},
	})),
}));

const { resolveDefaultStatus } = await import("./status-defaults.js");

describe("resolveDefaultStatus", () => {
	it("returns explicit status when provided", () => {
		const result = resolveDefaultStatus({
			explicitStatus: "In Progress",
			hasAssignee: false,
			hasProject: false,
		});
		expect(result).toBe("In Progress");
	});

	it("returns Todo when has assignee and project", () => {
		const result = resolveDefaultStatus({
			hasAssignee: true,
			hasProject: true,
		});
		expect(result).toBe("Todo");
	});

	it("returns Triage when missing assignee", () => {
		const result = resolveDefaultStatus({
			hasAssignee: false,
			hasProject: true,
		});
		expect(result).toBe("Triage");
	});

	it("returns Triage when missing project", () => {
		const result = resolveDefaultStatus({
			hasAssignee: true,
			hasProject: false,
		});
		expect(result).toBe("Triage");
	});

	it("returns Triage when missing both", () => {
		const result = resolveDefaultStatus({
			hasAssignee: false,
			hasProject: false,
		});
		expect(result).toBe("Triage");
	});

	it("explicit status takes priority over assignee+project", () => {
		const result = resolveDefaultStatus({
			explicitStatus: "Done",
			hasAssignee: true,
			hasProject: true,
		});
		expect(result).toBe("Done");
	});
});
