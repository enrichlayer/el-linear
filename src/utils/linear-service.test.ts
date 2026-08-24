import { beforeEach, describe, expect, it, vi } from "vitest";
import { readGraphQLErrorDetail } from "./linear-graphql-error.js";

const mockTeams = vi.fn();
const mockTeam = vi.fn();
const mockUsers = vi.fn();
const mockUser = vi.fn();
const mockIssues = vi.fn();
const mockWorkflowStates = vi.fn();
const mockCycles = vi.fn();
const mockCycle = vi.fn();
const mockProjects = vi.fn();
const mockProjectStatuses = vi.fn();
const mockIssueLabels = vi.fn();
const mockIssueLabel = vi.fn();
const mockCreateComment = vi.fn();
const mockRawRequest = vi.fn();

vi.mock("@linear/sdk", () => ({
	LinearClient: class MockLinearClient {
		client = { rawRequest: mockRawRequest };
		teams = mockTeams;
		team = mockTeam;
		users = mockUsers;
		user = mockUser;
		issues = mockIssues;
		workflowStates = mockWorkflowStates;
		cycles = mockCycles;
		cycle = mockCycle;
		projects = mockProjects;
		projectStatuses = mockProjectStatuses;
		issueLabels = mockIssueLabels;
		issueLabel = mockIssueLabel;
		createComment = mockCreateComment;
	},
}));

const {
	LinearService,
	instrumentClientCredentialsRenewal,
	instrumentLinearGraphQLErrorClassification,
} = await import("./linear-service.js");

// Reset every mock before each test so tests are order-independent: call
// logs, queued `mockResolvedValueOnce` entries, AND base implementations.
// `resetAllMocks` (not `clearAllMocks`, which resets call history only and
// leaves once-queues intact) is what actually prevents the DEV-5325 failure
// mode — a test under-consuming its once-queue leaking into a neighbor.
// Every test below sets its own resolved values, so resetting here is safe.
beforeEach(() => {
	vi.resetAllMocks();
});

describe("LinearService", () => {
	describe("SDK GraphQL error classification", () => {
		it.each([
			{
				name: "HTTP 429",
				error: { status: 429, message: "Ratelimit exceeded" },
				expected: { httpStatus: 429, code: null, retryable: true },
			},
			{
				name: "permanent HTTP 403",
				error: { status: 403, message: "Forbidden" },
				expected: { httpStatus: 403, code: null, retryable: false },
			},
			{
				name: "RATELIMITED GraphQL code",
				error: {
					status: 400,
					message: "Rate limited",
					raw: {
						response: {
							errors: [{ extensions: { code: "RATELIMITED" } }],
						},
					},
				},
				expected: {
					httpStatus: 400,
					code: "RATELIMITED",
					retryable: true,
				},
			},
			{
				name: "no-response transport failure",
				error: new Error("fetch failed"),
				expected: { httpStatus: null, code: null, retryable: true },
			},
		])(
			"classifies $name at the shared SDK request boundary",
			async ({ error, expected }) => {
				const sdk = {
					_request: vi.fn().mockRejectedValue(error),
				};
				instrumentLinearGraphQLErrorClassification(sdk as never);

				let thrown: unknown;
				try {
					await sdk._request("query Viewer { viewer { id } }");
				} catch (caught) {
					thrown = caught;
				}

				expect(readGraphQLErrorDetail(thrown)).toEqual(expected);
				expect((thrown as Error).message).toBe(error.message);
			},
		);

		it("leaves local not-found failures unclassified", async () => {
			mockIssues.mockResolvedValue({ nodes: [] });
			const service = new LinearService({ apiKey: "token" });

			let thrown: unknown;
			try {
				await service.resolveIssueId("DEV-999");
			} catch (caught) {
				thrown = caught;
			}

			expect(readGraphQLErrorDetail(thrown)).toBeNull();
			expect((thrown as Error).message).toContain('Issue "DEV-999" not found');
		});
	});

	it("renews the SDK transport once after HTTP 401", async () => {
		const request = vi
			.fn()
			.mockRejectedValueOnce({ status: 401 })
			.mockResolvedValueOnce({ nodes: [{ id: "team" }] });
		const setHeader = vi.fn();
		const renewAccessToken = vi.fn().mockResolvedValue("renewed-token");
		const client = { client: { request, setHeader } };
		instrumentClientCredentialsRenewal(client as never, renewAccessToken);

		await expect(client.client.request("query")).resolves.toEqual({
			nodes: [{ id: "team" }],
		});
		expect(renewAccessToken).toHaveBeenCalledTimes(1);
		expect(setHeader).toHaveBeenCalledWith(
			"authorization",
			"Bearer renewed-token",
		);
	});

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
			mockRawRequest.mockResolvedValue({
				data: {
					projects: {
						nodes: [
							{ id: "project-uuid", name: "My Project", teams: { nodes: [] } },
						],
					},
				},
			});
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectId("My Project");
			expect(result).toBe("project-uuid");
		});

		it("throws when project not found", async () => {
			mockRawRequest.mockResolvedValue({
				data: { projects: { nodes: [] } },
			});
			const service = new LinearService({ apiKey: "token" });
			await expect(service.resolveProjectId("Nonexistent")).rejects.toThrow(
				'Project "Nonexistent" not found',
			);
		});

		it("resolves a Linear project URL via slugId filter (includeArchived)", async () => {
			mockRawRequest.mockResolvedValue({
				data: {
					projects: {
						nodes: [{ id: "slug-uuid", name: "Tools", teams: { nodes: [] } }],
					},
				},
			});
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectId(
				"https://linear.app/verticalint/project/tools-and-standardization-40815d9beb16/overview",
			);
			expect(result).toBe("slug-uuid");
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					filter: {
						slugId: { eq: "tools-and-standardization-40815d9beb16" },
					},
					includeArchived: true,
				}),
			);
		});

		it("resolves a bare slug-id via slugId filter", async () => {
			mockRawRequest.mockResolvedValue({
				data: {
					projects: {
						nodes: [
							{ id: "slug-uuid-2", name: "Customer", teams: { nodes: [] } },
						],
					},
				},
			});
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectId(
				"customer-api-abc123def456",
			);
			expect(result).toBe("slug-uuid-2");
			expect(mockRawRequest).toHaveBeenCalledWith(
				expect.any(String),
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
			mockRawRequest.mockResolvedValue({ data: { projects: { nodes: [] } } });
			const service = new LinearService({ apiKey: "token" });
			await expect(
				service.resolveProjectId(
					"https://linear.app/x/project/missing-aaaaaaaaaaaa/overview",
				),
			).rejects.toThrow("not found");
			expect(mockRawRequest).toHaveBeenLastCalledWith(
				expect.any(String),
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
				mockRawRequest.mockResolvedValueOnce({
					data: {
						team: {
							projects: {
								nodes: [
									{
										id: "shared-id-dev",
										name: "Shared Name",
										teams: { nodes: [] },
									},
								],
							},
						},
					},
				});
				const service = new LinearService({ apiKey: "token" });
				const result = await service.resolveProjectId("Shared Name", "DEV");
				expect(result).toBe("shared-id-dev");
				expect(mockRawRequest).toHaveBeenLastCalledWith(
					expect.any(String),
					expect.objectContaining({
						filter: { name: { eqIgnoreCase: "Shared Name" } },
						teamId: "uuid-dev",
						teamScoped: true,
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
				mockRawRequest.mockResolvedValueOnce({
					data: {
						projects: {
							nodes: [
								{
									id: "shared-id-dev",
									name: "Shared Name",
									teams: {
										nodes: [{ id: "uuid-dev", key: "DEV", name: "Dev" }],
									},
								},
								{
									id: "shared-id-inf",
									name: "Shared Name",
									teams: {
										nodes: [{ id: "uuid-inf", key: "INF", name: "Infra" }],
									},
								},
							],
						},
					},
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
				mockRawRequest.mockResolvedValueOnce({
					data: { team: { projects: { nodes: [] } } },
				});
				const service = new LinearService({ apiKey: "token" });
				await expect(
					service.resolveProjectId("Nonexistent", "DEV"),
				).rejects.toThrow('Project "Nonexistent" on team "DEV" not found.');
			});
		});
	});

	describe("resolveProjectStatusId", () => {
		const workspaceStatuses = {
			nodes: [
				{ id: "backlog-uuid", name: "Backlog", type: "backlog" },
				{ id: "planned-uuid", name: "Planned", type: "planned" },
				{ id: "started-uuid", name: "In Progress", type: "started" },
				{ id: "completed-uuid", name: "Completed", type: "completed" },
				{ id: "canceled-uuid", name: "Canceled", type: "canceled" },
			],
		};

		it("returns UUID directly without an API call", async () => {
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectStatusId(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(result).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
			expect(mockProjectStatuses).not.toHaveBeenCalled();
		});

		it("resolves by exact name", async () => {
			mockProjectStatuses.mockResolvedValue(workspaceStatuses);
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectStatusId("Completed");
			expect(result).toBe("completed-uuid");
		});

		it("resolves case-insensitively", async () => {
			mockProjectStatuses.mockResolvedValue(workspaceStatuses);
			const service = new LinearService({ apiKey: "token" });
			const result = await service.resolveProjectStatusId("in progress");
			expect(result).toBe("started-uuid");
		});

		it("throws when the status is not found and lists the workspace's valid statuses", async () => {
			mockProjectStatuses.mockResolvedValue(workspaceStatuses);
			const service = new LinearService({ apiKey: "token" });
			// "Paused" is the natural word to reach for, but this workspace's
			// configured set has no status of that name (DEV-7021's motivating trap).
			// Substring match (not exact-string) mirrors resolveTeamId's sibling
			// "Available teams:" assertion — notFoundError's exact whitespace
			// between "not found." and the hint is an implementation detail.
			await expect(service.resolveProjectStatusId("Paused")).rejects.toThrow(
				'Project status "Paused"',
			);
			await expect(service.resolveProjectStatusId("Paused")).rejects.toThrow(
				"Available statuses: Backlog, Planned, In Progress, Completed, Canceled",
			);
		});
	});

	describe("normalizeProjectInput", () => {
		it("passes UUIDs through unchanged without an API call", async () => {
			const service = new LinearService({ apiKey: "token" });
			const result = await service.normalizeProjectInput(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(result).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
			expect(mockProjects).not.toHaveBeenCalled();
		});

		it("passes plain names through unchanged without an API call", async () => {
			const service = new LinearService({ apiKey: "token" });
			const result = await service.normalizeProjectInput("Customer API");
			expect(result).toBe("Customer API");
			expect(mockProjects).not.toHaveBeenCalled();
		});

		it("resolves URL inputs to a UUID via slugId", async () => {
			mockRawRequest.mockResolvedValue({
				data: {
					projects: {
						nodes: [{ id: "resolved-uuid", name: "Foo", teams: { nodes: [] } }],
					},
				},
			});
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

	// DEV-5612: single-user lookup by UUID, email, or name — the complement
	// to getUsers/`users list`.
	describe("getUser", () => {
		it("resolves a bare UUID directly, then fetches that user", async () => {
			mockUser.mockResolvedValue({
				id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
				name: "Alice",
				displayName: "Alice",
				email: "a@test.com",
				active: true,
			});
			const service = new LinearService({ apiKey: "token" });
			const result = await service.getUser(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(mockUsers).not.toHaveBeenCalled();
			expect(mockUser).toHaveBeenCalledWith(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
			);
			expect(result).toEqual({
				id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
				name: "Alice",
				displayName: "Alice",
				email: "a@test.com",
				active: true,
			});
		});

		it("resolves by email, then fetches that user", async () => {
			mockUsers.mockResolvedValue({
				nodes: [{ id: "alice-id", displayName: "Alice", email: "a@test.com" }],
			});
			mockUser.mockResolvedValue({
				id: "alice-id",
				name: "Alice",
				displayName: "Alice",
				email: "a@test.com",
				active: true,
			});
			const service = new LinearService({ apiKey: "token" });
			const result = await service.getUser("a@test.com");
			expect(mockUsers).toHaveBeenCalledWith(
				expect.objectContaining({
					filter: { email: { eq: "a@test.com" } },
				}),
			);
			expect(mockUser).toHaveBeenCalledWith("alice-id");
			expect(result.id).toBe("alice-id");
		});

		it("resolves by unambiguous display name", async () => {
			mockUsers.mockResolvedValueOnce({
				nodes: [{ id: "alice-id", displayName: "Alice", email: "a@test.com" }],
			});
			mockUser.mockResolvedValue({
				id: "alice-id",
				name: "Alice",
				displayName: "Alice",
				email: "a@test.com",
				active: true,
			});
			const service = new LinearService({ apiKey: "token" });
			const result = await service.getUser("Alice");
			expect(mockUser).toHaveBeenCalledWith("alice-id");
			expect(result.id).toBe("alice-id");
		});

		it("throws a not-found error when nothing matches", async () => {
			mockUsers.mockResolvedValue({ nodes: [] });
			const service = new LinearService({ apiKey: "token" });
			await expect(service.getUser("nobody")).rejects.toThrow(/not found/i);
			expect(mockUser).not.toHaveBeenCalled();
		});

		it("throws a multiple-matches error on an ambiguous name", async () => {
			mockUsers.mockResolvedValueOnce({
				nodes: [
					{ id: "a1", displayName: "Alex", email: "a1@test.com" },
					{ id: "a2", displayName: "Alex", email: "a2@test.com" },
				],
			});
			const service = new LinearService({ apiKey: "token" });
			await expect(service.getUser("Alex")).rejects.toThrow(/multiple/i);
			expect(mockUser).not.toHaveBeenCalled();
		});
	});
});

describe("bounded catalog queries", () => {
	const projectNode = {
		id: "p1",
		name: "Proj",
		description: "",
		state: "started",
		progress: 0,
		teams: { nodes: [{ id: "t1", key: "DEV", name: "Dev" }] },
		lead: { id: "u1", name: "Alice" },
		createdAt: "2026-08-01T00:00:00Z",
		updatedAt: "2026-08-02T00:00:00Z",
		targetDate: null,
	};

	it("selects project relationships in the same team-scoped request", async () => {
		mockRawRequest.mockResolvedValueOnce({
			data: {
				team: {
					projects: {
						nodes: [projectNode],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		});
		const service = new LinearService({ apiKey: "token" });
		const result = await service.getProjects(10, { teamId: "uuid-dev" });
		expect(result[0]).toMatchObject({
			teams: [{ key: "DEV" }],
			lead: { name: "Alice" },
		});
		expect(mockRawRequest).toHaveBeenCalledTimes(1);
		expect(mockRawRequest).toHaveBeenCalledWith(
			expect.stringContaining("team(id: $teamId)"),
			expect.objectContaining({
				teamId: "uuid-dev",
				teamScoped: true,
				first: 10,
			}),
		);
	});

	it("paginates --all by connection pages rather than project count", async () => {
		mockRawRequest
			.mockResolvedValueOnce({
				data: {
					projects: {
						nodes: [projectNode],
						pageInfo: { hasNextPage: true, endCursor: "next" },
					},
				},
			})
			.mockResolvedValueOnce({
				data: {
					projects: {
						nodes: [{ ...projectNode, id: "p2" }],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			});
		const service = new LinearService({ apiKey: "token" });
		const result = await service.getProjects(0);
		expect(result.map((project) => project.id)).toEqual(["p1", "p2"]);
		expect(mockRawRequest).toHaveBeenLastCalledWith(
			expect.any(String),
			expect.objectContaining({ after: "next", first: 250 }),
		);
	});

	it("selects label parent and team without relationship fetches", async () => {
		mockRawRequest.mockResolvedValueOnce({
			data: {
				issueLabels: {
					nodes: [
						{
							id: "l1",
							name: "bug",
							color: "#f00",
							isGroup: false,
							parent: { id: "g1", name: "Type" },
							team: { id: "t1", key: "DEV", name: "Dev" },
						},
					],
				},
			},
		});
		const service = new LinearService({ apiKey: "token" });
		await expect(service.getLabels()).resolves.toEqual({
			labels: [
				expect.objectContaining({
					group: { id: "g1", name: "Type" },
					team: { id: "t1", key: "DEV", name: "Dev" },
				}),
			],
		});
		expect(mockRawRequest).toHaveBeenCalledTimes(1);
	});

	it("selects each cycle team in the cycle-list request", async () => {
		mockRawRequest.mockResolvedValueOnce({
			data: {
				cycles: {
					nodes: [
						{
							id: "c1",
							name: "Cycle 1",
							number: 1,
							startsAt: null,
							endsAt: null,
							isActive: true,
							isPrevious: false,
							isNext: false,
							progress: 0.5,
							issueCountHistory: [1],
							team: { id: "t1", key: "DEV", name: "Dev" },
						},
					],
				},
			},
		});
		const service = new LinearService({ apiKey: "token" });
		const cycles = await service.getCycles(undefined, true, 20);
		expect(cycles[0]).toMatchObject({ team: { key: "DEV" } });
		expect(mockRawRequest).toHaveBeenCalledTimes(1);
		expect(mockRawRequest).toHaveBeenCalledWith(
			expect.stringContaining("team { id key name }"),
			expect.objectContaining({
				filter: { isActive: { eq: true } },
				first: 20,
			}),
		);
	});

	it("selects cycle team and issue relationships in one detail request", async () => {
		mockRawRequest.mockResolvedValueOnce({
			data: {
				cycle: {
					id: "c1",
					name: "Cycle 1",
					number: 1,
					startsAt: "2026-08-01T00:00:00Z",
					endsAt: "2026-08-14T00:00:00Z",
					isActive: true,
					isPrevious: false,
					isNext: false,
					progress: 0.5,
					issueCountHistory: [1],
					team: { id: "t1", key: "DEV", name: "Dev" },
					issues: {
						nodes: [
							{
								id: "i1",
								identifier: "DEV-1",
								url: "https://linear.app/issue/DEV-1",
								title: "Issue",
								description: null,
								priority: 2,
								estimate: null,
								createdAt: "2026-08-01T00:00:00Z",
								updatedAt: "2026-08-02T00:00:00Z",
								state: { id: "s1", name: "Todo" },
								assignee: null,
								team: { id: "t1", key: "DEV", name: "Dev" },
								project: { id: "p1", name: "Tools" },
								labels: { nodes: [{ id: "l1", name: "bug" }] },
							},
						],
					},
				},
			},
		});
		const service = new LinearService({ apiKey: "token" });
		const detail = await service.getCycleById("c1", 50);
		expect(detail.issues[0]).toMatchObject({
			identifier: "DEV-1",
			state: { name: "Todo" },
			labels: [{ name: "bug" }],
		});
		expect(mockRawRequest).toHaveBeenCalledTimes(1);
	});
});
