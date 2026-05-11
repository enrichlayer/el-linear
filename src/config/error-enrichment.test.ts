import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphQLService } from "../utils/graphql-service.js";
import type { LinearService } from "../utils/linear-service.js";
import type { ValidationResult } from "./issue-validation.js";

interface ServiceBundle {
	graphQLService: GraphQLService;
	linearService: LinearService;
}

// Mock config: validation enabled, basic config shape with one alias mapping.
const mockConfig: Record<string, unknown> = {
	validation: {
		enabled: true,
		typeLabels: ["bug", "feature", "refactor", "chore", "spike"],
	},
	teams: {
		DEV: "team-dev-uuid",
	},
	teamAliases: {},
	members: {
		aliases: { dima: "Dima" },
		fullNames: {},
		handles: {},
		uuids: {},
	},
	labels: {
		workspace: {},
		teams: {},
	},
};

vi.mock("./config.js", () => ({
	loadConfig: vi.fn(() => mockConfig),
}));

vi.mock("../utils/output.js", () => ({
	outputWarning: vi.fn(),
}));

const { enrichValidationErrors } = await import("./error-enrichment.js");
const { validateIssueCreation } = await import("./issue-validation.js");

// --- Helpers ---

interface MockServices {
	graphQLService: { rawRequest: ReturnType<typeof vi.fn> };
	linearService: { resolveTeamId: ReturnType<typeof vi.fn> };
}

function makeServices(teamData: unknown): MockServices {
	return {
		graphQLService: {
			rawRequest: vi.fn().mockResolvedValue({ team: teamData }),
		},
		linearService: {
			resolveTeamId: vi.fn().mockResolvedValue("team-dev-uuid"),
		},
	};
}

function projectsPayload(names: string[]) {
	return names.map((n, i) => ({ id: `p${i}`, name: n, state: "started" }));
}

function membersPayload(rows: Array<{ name: string; displayName?: string }>) {
	return rows.map((r, i) => ({
		id: `u${i}`,
		name: r.name,
		displayName: r.displayName,
		email: `${r.name.toLowerCase()}@example.com`,
		active: true,
	}));
}

function labelsPayload(names: string[]) {
	return names.map((n, i) => ({ id: `l${i}`, name: n, isGroup: false }));
}

// `services` mock types are loose because the real signatures involve
// classes; cast through `unknown` at the call site to avoid `any`.
function asServices(s: MockServices): ServiceBundle {
	return s as unknown as ServiceBundle;
}

describe("enrichValidationErrors", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("is a no-op when --team is not set", async () => {
		const result: ValidationResult = {
			errors: ["Missing --project. ..."],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({});
		await enrichValidationErrors(
			result,
			{ team: undefined, title: "Fix bug" },
			asServices(services),
		);
		expect(services.graphQLService.rawRequest).not.toHaveBeenCalled();
		expect(result.errors[0]).toBe("Missing --project. ...");
	});

	it("is a no-op when there are no errors", async () => {
		const result: ValidationResult = {
			errors: [],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({});
		await enrichValidationErrors(
			result,
			{ team: "DEV", title: "Fix bug" },
			asServices(services),
		);
		expect(services.graphQLService.rawRequest).not.toHaveBeenCalled();
	});

	it("appends project suggestions to a Missing --project error", async () => {
		const result: ValidationResult = {
			errors: [
				"Missing --project. Every issue must belong to a project.\n  Use `el-linear projects list` to find valid projects.",
			],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({
			id: "team-dev-uuid",
			key: "DEV",
			name: "Dev",
			projects: { nodes: projectsPayload(["Q2 Roadmap", "Refactor Sprint"]) },
		});

		await enrichValidationErrors(
			result,
			{ team: "DEV", title: "Fix something" },
			asServices(services),
		);

		expect(services.graphQLService.rawRequest).toHaveBeenCalledTimes(1);
		const [, vars] = services.graphQLService.rawRequest.mock.calls[0];
		expect(vars).toMatchObject({
			teamId: "team-dev-uuid",
			includeProjects: true,
			includeMembers: false,
			includeLabels: false,
		});
		expect(result.errors[0]).toContain("Suggestions");
		expect(result.errors[0]).toContain('--project "Q2 Roadmap"');
		expect(result.errors[0]).toContain('--project "Refactor Sprint"');
	});

	it("appends assignee suggestions to a Missing --assignee error using alias when available", async () => {
		const result: ValidationResult = {
			errors: [
				"Missing --assignee. Every issue must have an assignee.\n  Use `el-linear users list --active` to find valid assignees.",
			],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({
			id: "team-dev-uuid",
			key: "DEV",
			name: "Dev",
			members: {
				nodes: membersPayload([
					{ name: "Dima", displayName: "Dima Y" },
					{ name: "Kamal", displayName: "Kamal M" },
				]),
			},
		});

		await enrichValidationErrors(
			result,
			{ team: "DEV", title: "Add feature" },
			asServices(services),
		);

		// Dima has an alias in the mock config → use alias; Kamal has none → use displayName.
		expect(result.errors[0]).toContain("--assignee dima");
		expect(result.errors[0]).toContain("--assignee Kamal M");
	});

	it("appends label suggestions plus verb-based type inference to a Missing --labels error", async () => {
		const result: ValidationResult = {
			errors: [
				'Missing --labels. At least one label is required, including a type label.\n  Valid type labels: bug, feature, refactor, chore, spike\n  Example: --labels "bug,backend"',
			],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({
			id: "team-dev-uuid",
			key: "DEV",
			name: "Dev",
			labels: {
				nodes: labelsPayload([
					"bug",
					"feature",
					"backend",
					"frontend",
					"infra",
				]),
			},
		});

		await enrichValidationErrors(
			result,
			{ team: "DEV", title: "Fix login flow on Safari" },
			asServices(services),
		);

		// Verb "Fix" → bug type.
		expect(result.errors[0]).toContain('Inferred from title: type label "bug"');
		expect(result.errors[0]).toContain('title starts with "Fix"');
		expect(result.errors[0]).toContain("Suggestions");
		expect(result.errors[0]).toContain("Valid type labels");
		expect(result.errors[0]).toContain("Common domain labels");
	});

	it.each([
		["Fix the broken thing", "bug", "Fix"],
		["Add a new endpoint", "feature", "Add"],
		["Refactor the payments module", "refactor", "Refactor"],
		["Update the deps", "chore", "Update"],
		["Research GraphQL caching options", "spike", "Research"],
	])("infers type label from leading verb for title %s", async (title, expectedType, expectedVerb) => {
		const result: ValidationResult = {
			errors: ["Missing --labels. ..."],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({
			id: "team-dev-uuid",
			key: "DEV",
			name: "Dev",
			labels: { nodes: labelsPayload(["bug", "feature", "backend"]) },
		});
		await enrichValidationErrors(
			result,
			{ team: "DEV", title },
			asServices(services),
		);
		expect(result.errors[0]).toContain(
			`Inferred from title: type label "${expectedType}"`,
		);
		expect(result.errors[0]).toContain(`title starts with "${expectedVerb}"`);
	});

	it("does not add inference hint when title verb is not recognized", async () => {
		const result: ValidationResult = {
			errors: ["Missing --labels. ..."],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({
			id: "team-dev-uuid",
			key: "DEV",
			name: "Dev",
			labels: { nodes: labelsPayload(["bug", "backend"]) },
		});
		await enrichValidationErrors(
			result,
			{ team: "DEV", title: "Dashboard auth failing for some users" },
			asServices(services),
		);
		expect(result.errors[0]).not.toContain("Inferred from title");
		// Suggestions block still shown.
		expect(result.errors[0]).toContain("Suggestions");
	});

	it("appends label suggestions to a Missing type label error", async () => {
		const result: ValidationResult = {
			errors: [
				"Missing type label. Exactly one required.\n  Valid type labels: bug, feature, refactor, chore, spike\n  Provided labels: backend",
			],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({
			id: "team-dev-uuid",
			key: "DEV",
			name: "Dev",
			labels: { nodes: labelsPayload(["bug", "feature", "backend"]) },
		});
		await enrichValidationErrors(
			result,
			{ team: "DEV", title: "Add feature X" },
			asServices(services),
		);
		expect(result.errors[0]).toContain("Suggestions");
		expect(result.errors[0]).toContain("feature");
	});

	it("batches a single GraphQL call covering all missing fields", async () => {
		const result: ValidationResult = {
			errors: [
				"Missing --project. ...",
				"Missing --assignee. ...",
				"Missing --labels. ...",
			],
			warnings: [],
			normalizedLabels: null,
		};
		const services = makeServices({
			id: "team-dev-uuid",
			key: "DEV",
			name: "Dev",
			projects: { nodes: projectsPayload(["P1"]) },
			members: { nodes: membersPayload([{ name: "Dima" }]) },
			labels: { nodes: labelsPayload(["bug", "backend"]) },
		});
		await enrichValidationErrors(
			result,
			{ team: "DEV", title: "Fix x" },
			asServices(services),
		);
		expect(services.graphQLService.rawRequest).toHaveBeenCalledTimes(1);
		const [, vars] = services.graphQLService.rawRequest.mock.calls[0];
		expect(vars).toMatchObject({
			includeProjects: true,
			includeMembers: true,
			includeLabels: true,
		});
	});

	it("swallows graphQL errors and leaves the original error in place", async () => {
		const original = "Missing --project. ...";
		const result: ValidationResult = {
			errors: [original],
			warnings: [],
			normalizedLabels: null,
		};
		const services = {
			graphQLService: {
				rawRequest: vi.fn().mockRejectedValue(new Error("network down")),
			},
			linearService: {
				resolveTeamId: vi.fn().mockResolvedValue("team-dev-uuid"),
			},
		};
		await enrichValidationErrors(
			result,
			{ team: "DEV", title: "Fix x" },
			asServices(services),
		);
		expect(result.errors[0]).toBe(original);
	});

	it("integrates with validateIssueCreation output (composition test)", async () => {
		// Run real validation, then enrich. Asserts the prefix-match contract
		// between the two — guards against the DEV-3606-style silent break.
		const vResult = validateIssueCreation({
			title: "Fix login flow",
			description:
				"Something is broken and needs fixing right now to unblock users.",
			labels: null,
			assignee: undefined,
			project: undefined,
		});
		expect(vResult.errors.length).toBeGreaterThanOrEqual(3);

		const services = makeServices({
			id: "team-dev-uuid",
			key: "DEV",
			name: "Dev",
			projects: { nodes: projectsPayload(["Sprint 12"]) },
			members: { nodes: membersPayload([{ name: "Dima" }]) },
			labels: { nodes: labelsPayload(["bug", "backend"]) },
		});

		await enrichValidationErrors(
			vResult,
			{ team: "DEV", title: "Fix login flow" },
			asServices(services),
		);

		const joined = vResult.errors.join("\n---\n");
		expect(joined).toContain('--project "Sprint 12"');
		expect(joined).toContain("--assignee dima");
		expect(joined).toContain('Inferred from title: type label "bug"');
	});
});
