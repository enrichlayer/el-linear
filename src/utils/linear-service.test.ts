import { describe, expect, it, vi } from "vitest";

const mockTeams = vi.fn();
const mockTeam = vi.fn();
const mockUsers = vi.fn();
const mockIssues = vi.fn();
const mockWorkflowStates = vi.fn();
const mockCycles = vi.fn();
const mockCycle = vi.fn();
const mockProjects = vi.fn();
const mockIssueLabels = vi.fn();
const mockIssueLabel = vi.fn();
const mockCreateComment = vi.fn();

vi.mock("@linear/sdk", () => ({
	LinearClient: class MockLinearClient {
		teams = mockTeams;
		team = mockTeam;
		users = mockUsers;
		issues = mockIssues;
		workflowStates = mockWorkflowStates;
		cycles = mockCycles;
		cycle = mockCycle;
		projects = mockProjects;
		issueLabels = mockIssueLabels;
		issueLabel = mockIssueLabel;
		createComment = mockCreateComment;
	},
}));

const { LinearService } = await import("./linear-service.js");

describe("LinearService", () => {
	describe("resolveIssueId", () => {
		it("returns UUID directly", async () => {
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveIssueId(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(result).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
		});

		it("resolves identifier like DEV-123", async () => {
			mockIssues.mockResolvedValue({ nodes: [{ id: "resolved-uuid" }] });
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveIssueId("DEV-123");
			expect(result).toBe("resolved-uuid");
		});

		it("throws when identifier not found", async () => {
			mockIssues.mockResolvedValue({ nodes: [] });
			const service = new LinearService({ apiKey: "token" });
			await expect(service.resolveIssueId("DEV-999")).rejects.toThrow(
				'Issue "DEV-999" not found',
			);
		});
	});

	describe("resolveTeamId", () => {
		const teamNodes = [
			{ id: "dev-uuid", key: "DEV", name: "Dev" },
			{ id: "fe-uuid", key: "FE", name: "Frontend (Lander/Docs/Blog/UIX)" },
			{ id: "emw-uuid", key: "EMW", name: "Endpoints middleware" },
			{ id: "inf-uuid", key: "INF", name: "Infra" },
		];
		const allTeams = {
			nodes: teamNodes,
			pageInfo: { hasNextPage: false },
			fetchNext: vi.fn(),
		};
		const noMatch = { nodes: [] };

		it("returns UUID directly", async () => {
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveTeamId(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(result).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
		});

		it("resolves by exact team key via server-side filter", async () => {
			mockTeams.mockResolvedValueOnce({ nodes: [{ id: "dev-uuid" }] });
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveTeamId("dev");
			expect(result).toBe("dev-uuid");
		});

		it("resolves by exact team name via server-side filter", async () => {
			mockTeams
				.mockResolvedValueOnce(noMatch) // key lookup
				.mockResolvedValueOnce({ nodes: [{ id: "inf-uuid" }] }); // name lookup
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveTeamId("infra");
			expect(result).toBe("inf-uuid");
		});

		it("resolves by unambiguous prefix on name", async () => {
			mockTeams
				.mockResolvedValueOnce(noMatch) // key lookup
				.mockResolvedValueOnce(noMatch) // name lookup
				.mockResolvedValueOnce(allTeams); // fetch all for prefix
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveTeamId("front");
			expect(result).toBe("fe-uuid");
		});

		it("resolves by unambiguous prefix on key", async () => {
			mockTeams
				.mockResolvedValueOnce(noMatch) // key lookup
				.mockResolvedValueOnce(noMatch) // name lookup
				.mockResolvedValueOnce(allTeams); // fetch all for prefix
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveTeamId("em");
			expect(result).toBe("emw-uuid");
		});

		it("throws on ambiguous prefix with candidates", async () => {
			mockTeams
				.mockResolvedValueOnce(noMatch)
				.mockResolvedValueOnce(noMatch)
				.mockResolvedValueOnce({
					nodes: [
						{ id: "1", key: "INF", name: "Infra" },
						{ id: "2", key: "INT", name: "Integration" },
					],
					pageInfo: { hasNextPage: false },
					fetchNext: vi.fn(),
				});
			const service = new LinearService({ apiKey: "token" });
			await expect(service.resolveTeamId("in")).rejects.toThrow("Candidates:");
		});

		it("throws when team not found and lists available teams", async () => {
			mockTeams
				.mockResolvedValueOnce(noMatch)
				.mockResolvedValueOnce(noMatch)
				.mockResolvedValueOnce(allTeams);
			const service = new LinearService({ apiKey: "token" });
			await expect(service.resolveTeamId("NOPE")).rejects.toThrow(
				"Available teams:",
			);
		});
	});

	describe("resolveStatusId", () => {
		it("returns UUID directly", async () => {
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveStatusId(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(result).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
		});

		it("resolves by name", async () => {
			mockWorkflowStates.mockResolvedValue({ nodes: [{ id: "status-uuid" }] });
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveStatusId("In Progress");
			expect(result).toBe("status-uuid");
		});

		it("throws when status not found", async () => {
			mockWorkflowStates.mockResolvedValue({ nodes: [] });
			const service = new LinearService({ apiKey: "token" });
			await expect(service.resolveStatusId("Nonexistent")).rejects.toThrow(
				'Status "Nonexistent" not found',
			);
		});

		it("includes team context in error message", async () => {
			mockWorkflowStates.mockResolvedValue({ nodes: [] });
			const service = new LinearService({ apiKey: "token" });
			await expect(
				service.resolveStatusId("Nonexistent", "team-id"),
			).rejects.toThrow("for team team-id");
		});

		it("falls back to Backlog when Triage not found for a team", async () => {
			mockWorkflowStates
				.mockResolvedValueOnce({ nodes: [] }) // Triage not found
				.mockResolvedValueOnce({ nodes: [{ id: "backlog-uuid" }] }); // Backlog found
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveStatusId("Triage", "team-id");
			expect(result).toBe("backlog-uuid");
		});

		it("throws when Triage not found and Backlog also missing", async () => {
			mockWorkflowStates
				.mockResolvedValueOnce({ nodes: [] }) // Triage not found
				.mockResolvedValueOnce({ nodes: [] }); // Backlog also not found
			const service = new LinearService({ apiKey: "token" });
			await expect(
				service.resolveStatusId("Triage", "team-id"),
			).rejects.toThrow('Status "Triage" for team team-id not found.');
		});
	});

	describe("resolveProjectId", () => {
		it("returns UUID directly", async () => {
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectId(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(result).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
		});

		it("resolves by name", async () => {
			mockProjects.mockResolvedValue({ nodes: [{ id: "project-uuid" }] });
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectId("My Project");
			expect(result).toBe("project-uuid");
		});

		it("throws when project not found", async () => {
			mockProjects.mockResolvedValue({ nodes: [] });
			const service = new LinearService({ apiKey: "token" });
			await expect(service.resolveProjectId("Nonexistent")).rejects.toThrow(
				'Project "Nonexistent" not found',
			);
		});

		it("resolves a Linear project URL via slugId filter (includeArchived)", async () => {
			mockProjects.mockResolvedValue({ nodes: [{ id: "slug-uuid" }] });
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectId(
				"https://linear.app/verticalint/project/tools-and-standardization-40815d9beb16/overview",
			);
			expect(result).toBe("slug-uuid");
			expect(mockProjects).toHaveBeenCalledWith(
				expect.objectContaining({
					filter: {
						slugId: { eq: "tools-and-standardization-40815d9beb16" },
					},
					// URLs in the wild commonly point at archived projects; the
					// slugId path must resolve them so the caller can inspect.
					includeArchived: true,
				}),
			);
		});

		it("resolves a bare slug-id via slugId filter", async () => {
			mockProjects.mockResolvedValue({ nodes: [{ id: "slug-uuid-2" }] });
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectId(
				"customer-api-abc123def456",
			);
			expect(result).toBe("slug-uuid-2");
			expect(mockProjects).toHaveBeenCalledWith(
				expect.objectContaining({
					filter: { slugId: { eq: "customer-api-abc123def456" } },
				}),
			);
		});

		it("throws when a slug-id form does not match (no name fallback)", async () => {
			// `nodes: []` simulates Linear returning no project for this
			// slugId. We assert the resolver doesn't silently fall back to a
			// name-based eqIgnoreCase query (which would never match a URL) —
			// the last and only filter shape sent for this call is the slugId one.
			mockProjects.mockResolvedValue({ nodes: [] });
			const service = new LinearService({ apiKey: "token" });
			await expect(
				service.resolveProjectId(
					"https://linear.app/x/project/missing-aaaaaaaaaaaa/overview",
				),
			).rejects.toThrow("not found");
			expect(mockProjects).toHaveBeenLastCalledWith(
				expect.objectContaining({
					filter: { slugId: { eq: "missing-aaaaaaaaaaaa" } },
				}),
			);
		});

		// DEV-4103: --team scopes the resolver, ambiguous-name errors otherwise.
		describe("DEV-4103: --team disambiguation", () => {
			it("scopes the name lookup through Team.projects when --team is provided (DEV-5325)", async () => {
				// Team resolution first: DEV → uuid-dev. Then the TEAM's
				// projects connection — ProjectFilter rejects a `teams`
				// relation filter against the live schema (DEV-5325), so the
				// lookup must NOT go through client.projects with a teams
				// filter (the pre-fix shape GraphQL-errored in production).
				mockTeams.mockResolvedValueOnce({
					nodes: [{ id: "uuid-dev", key: "DEV", name: "Dev" }],
				});
				const mockTeamProjects = vi.fn().mockResolvedValueOnce({
					nodes: [{ id: "shared-id-dev" }],
				});
				mockTeam.mockResolvedValueOnce({ projects: mockTeamProjects });
				const service = new LinearService({ apiKey: "token" });
				const result = await service.resolveProjectId("Shared Name", "DEV");
				expect(result).toBe("shared-id-dev");
				expect(mockTeam).toHaveBeenCalledWith("uuid-dev");
				expect(mockTeamProjects).toHaveBeenLastCalledWith(
					expect.objectContaining({
						filter: { name: { eqIgnoreCase: "Shared Name" } },
						first: 5,
					}),
				);
				// The invalid shape must not be sent at all.
				expect(mockProjects).not.toHaveBeenCalledWith(
					expect.objectContaining({
						filter: expect.objectContaining({
							teams: expect.anything(),
						}),
					}),
				);
			});

			it("throws ambiguous when multiple projects share a name and no --team is set", async () => {
				// Pretend both DEV and INF have a project called "Shared Name".
				mockProjects.mockResolvedValueOnce({
					nodes: [
						{
							id: "shared-id-dev",
							name: "Shared Name",
							teams: () =>
								Promise.resolve({ nodes: [{ id: "uuid-dev", key: "DEV" }] }),
						},
						{
							id: "shared-id-inf",
							name: "Shared Name",
							teams: () =>
								Promise.resolve({ nodes: [{ id: "uuid-inf", key: "INF" }] }),
						},
					],
				});
				const service = new LinearService({ apiKey: "token" });
				await expect(service.resolveProjectId("Shared Name")).rejects.toThrow(
					/Multiple projects.*Shared Name.*DEV.*INF/s,
				);
			});

			it("includes team context in the not-found message when --team is set", async () => {
				mockTeams.mockResolvedValueOnce({
					nodes: [{ id: "uuid-dev", key: "DEV", name: "Dev" }],
				});
				// DEV-5325: team-scoped lookups go through Team.projects.
				mockTeam.mockResolvedValueOnce({
					projects: vi.fn().mockResolvedValueOnce({ nodes: [] }),
				});
				const service = new LinearService({ apiKey: "token" });
				await expect(
					service.resolveProjectId("Nonexistent", "DEV"),
				).rejects.toThrow('Project "Nonexistent" on team "DEV" not found.');
			});
		});
	});

	describe("normalizeProjectInput", () => {
		it("passes UUIDs through unchanged without an API call", async () => {
			const service = new LinearService({ apiKey: "token" });
			const before = mockProjects.mock.calls.length;
			const result = await service.normalizeProjectInput(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(result).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
			expect(mockProjects.mock.calls.length).toBe(before);
		});

		it("passes plain names through unchanged without an API call", async () => {
			const service = new LinearService({ apiKey: "token" });
			const before = mockProjects.mock.calls.length;
			const result = await service.normalizeProjectInput("Customer API");
			expect(result).toBe("Customer API");
			expect(mockProjects.mock.calls.length).toBe(before);
		});

		it("resolves URL inputs to a UUID via slugId", async () => {
			mockProjects.mockResolvedValue({ nodes: [{ id: "resolved-uuid" }] });
			const service = new LinearService({ apiKey: "token" });
			const result = await service.normalizeProjectInput(
				"https://linear.app/x/project/foo-1234567890ab/overview",
			);
			expect(result).toBe("resolved-uuid");
		});
	});

	describe("getTeams", () => {
		it("returns sorted teams", async () => {
			mockTeams.mockResolvedValue({
				nodes: [
					{ id: "2", key: "FE", name: "Frontend", description: null },
					{ id: "1", key: "BE", name: "Backend", description: "Core API" },
				],
			});
			const service = new LinearService({ apiKey: "token" });
			const result = await service.getTeams();
			expect(result[0].name).toBe("Backend");
			expect(result[1].name).toBe("Frontend");
		});
	});

	describe("getUsers", () => {
		it("returns sorted users", async () => {
			mockUsers.mockResolvedValue({
				nodes: [
					{
						id: "2",
						name: "Zara",
						displayName: "Zara",
						email: "z@test.com",
						active: true,
					},
					{
						id: "1",
						name: "Alice",
						displayName: "Alice",
						email: "a@test.com",
						active: true,
					},
				],
			});
			const service = new LinearService({ apiKey: "token" });
			const result = await service.getUsers();
			expect(result[0].name).toBe("Alice");
			expect(result[1].name).toBe("Zara");
		});
	});
});

// DEV-5325: `--team` scoping must go through Team.projects — ProjectFilter
// rejects a `teams` relation filter against the live schema, so the pre-fix
// `client.projects({ filter: { teams: { some: … } } })` shape GraphQL-errored
// in production ("Field \"teams\" is not defined by type \"ProjectFilter\"").
describe("getProjects team scoping (DEV-5325)", () => {
	const projectNode = {
		id: "p1",
		name: "Proj",
		description: "",
		state: "started",
		progress: 0,
		teams: () => Promise.resolve({ nodes: [] }),
		lead: Promise.resolve(undefined),
	};

	it("uses the team's projects connection when teamId is set", async () => {
		const mockTeamProjects = vi.fn().mockResolvedValueOnce({
			nodes: [projectNode],
			pageInfo: { hasNextPage: false },
		});
		mockTeam.mockResolvedValueOnce({ projects: mockTeamProjects });
		const service = new LinearService({ apiKey: "token" });
		const result = await service.getProjects(10, { teamId: "uuid-dev" });
		expect(result).toHaveLength(1);
		expect(mockTeam).toHaveBeenCalledWith("uuid-dev");
		expect(mockTeamProjects).toHaveBeenCalledWith(
			expect.objectContaining({ first: 10, includeArchived: false }),
		);
		// The invalid ProjectFilter.teams shape must never be sent.
		const sentFilter = mockTeamProjects.mock.calls[0][0].filter;
		expect(sentFilter?.teams).toBeUndefined();
		expect(mockProjects).not.toHaveBeenCalledWith(
			expect.objectContaining({
				filter: expect.objectContaining({ teams: expect.anything() }),
			}),
		);
	});

	it("uses the global projects connection without teamId", async () => {
		mockProjects.mockResolvedValueOnce({
			nodes: [projectNode],
			pageInfo: { hasNextPage: false },
		});
		const service = new LinearService({ apiKey: "token" });
		const result = await service.getProjects(10, {});
		expect(result).toHaveLength(1);
		expect(mockProjects).toHaveBeenCalledWith(
			expect.objectContaining({ first: 10 }),
		);
	});
});
