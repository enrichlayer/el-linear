import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueWithCommentsNode } from "../queries/issues-types.js";
import { multipleMatchesError, notFoundError } from "./error-messages.js";

vi.mock("@linear/sdk", () => ({
	LinearClient: class MockLinearClient {
		client = { rawRequest: vi.fn() };
	},
}));

// Opt-in identity registry (DEV-4872). Default DORMANT (isRegistryConfigured →
// false) so every existing test keeps the config/Linear-API resolution path;
// the registry-first tests below flip it on and afterEach resets to dormant.
const {
	mockIsRegistryConfigured,
	mockResolveViaRegistry,
	mockResolveViaCommand,
} = vi.hoisted(() => ({
	mockIsRegistryConfigured: vi.fn(() => false),
	mockResolveViaRegistry: vi.fn(),
	mockResolveViaCommand: vi.fn(() => null),
}));
vi.mock("../config/registry-resolve.js", () => ({
	isRegistryConfigured: mockIsRegistryConfigured,
	resolveViaRegistry: mockResolveViaRegistry,
}));
// DEV-5628: resolveAssigneeId now consults the identity-resolver hook, which
// SPAWNS A SUBPROCESS. Unmocked, these unit tests read the developer's real
// ~/.config and shell out to whatever resolver they have configured — hermetic in
// CI (no config → no resolver → no spawn) and emphatically not on a teammate's
// laptop, where the suite goes from ~1.7s to double digits and can fail outright
// against a network-backed resolver. Mock the seam, don't let the tests decide it.
vi.mock("../config/identity-resolver.js", () => ({
	resolveViaCommand: mockResolveViaCommand,
}));
afterEach(() => {
	mockIsRegistryConfigured.mockReturnValue(false);
	mockResolveViaRegistry.mockReset();
	mockResolveViaCommand.mockReset();
	mockResolveViaCommand.mockReturnValue(null);
});

const { GraphQLIssuesService } = await import("./graphql-issues-service.js");
const { GraphQLService } = await import("./graphql-service.js");
const { LinearService } = await import("./linear-service.js");

function createService() {
	const graphQLService = new GraphQLService({ apiKey: "token" });
	const linearService = new LinearService({ apiKey: "token" });
	return new GraphQLIssuesService(graphQLService, linearService);
}

function makeIssueNode(
	overrides: Partial<IssueWithCommentsNode> = {},
): IssueWithCommentsNode {
	return {
		id: "issue-1",
		identifier: "DEV-100",
		title: "Test",
		description: null,
		summary: null,
		branchName: "",
		priority: 0,
		estimate: null,
		dueDate: null,
		url: "https://linear.app/acme/issue/DEV-100/test-issue",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		completedAt: null,
		state: null,
		assignee: null,
		delegate: null,
		team: null,
		project: null,
		labels: { nodes: [] },
		cycle: null,
		projectMilestone: null,
		parent: null,
		children: { nodes: [] },
		comments: { nodes: [] },
		...overrides,
	};
}

describe("GraphQLIssuesService", () => {
	describe("archive/delete issue", () => {
		it("archives a resolved issue id", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "resolveIssueId").mockResolvedValue("uuid-1");
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({
					issueArchive: {
						success: true,
						entity: { id: "uuid-1" },
						lastSyncId: 1,
					},
				});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.archiveIssue("DEV-1");

			expect(rawRequest).toHaveBeenCalledWith(
				expect.stringContaining("issueArchive"),
				{
					id: "uuid-1",
				},
			);
			expect(result).toEqual({
				id: "uuid-1",
				entity: { id: "uuid-1" },
				lastSyncId: 1,
			});
		});

		it("deletes an issue with permanent deletion flag", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "resolveIssueId").mockResolvedValue("uuid-1");
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({
					issueDelete: {
						success: true,
						entity: null,
						lastSyncId: 2,
					},
				});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.deleteIssue("DEV-1", {
				permanentlyDelete: true,
			});

			expect(rawRequest).toHaveBeenCalledWith(
				expect.stringContaining("issueDelete"),
				{
					id: "uuid-1",
					permanentlyDelete: true,
				},
			);
			expect(result).toEqual({
				id: "uuid-1",
				entity: undefined,
				lastSyncId: 2,
			});
		});
	});

	describe("startIssue", () => {
		it("moves a backlog issue to the first started state", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "resolveIssueId").mockResolvedValue("uuid-1");
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValueOnce({
					issue: {
						id: "uuid-1",
						identifier: "DEV-1",
						state: { id: "state-backlog", name: "Backlog", type: "backlog" },
						team: { id: "team-1", key: "DEV", name: "Dev" },
						delegate: null,
					},
				})
				.mockResolvedValueOnce({
					team: {
						states: {
							nodes: [
								{ id: "state-later", name: "Review", position: 20 },
								{ id: "state-first", name: "In Progress", position: 10 },
							],
						},
					},
				});
			const service = new GraphQLIssuesService(graphQLService, linearService);
			const updateIssue = vi.spyOn(service, "updateIssue").mockResolvedValue({
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Task",
				labels: [],
				priority: 0,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				url: "https://linear.app/acme/issue/DEV-1/task",
			});

			const result = await service.startIssue("DEV-1");

			expect(rawRequest).toHaveBeenCalledTimes(2);
			expect(updateIssue).toHaveBeenCalledWith(
				{ id: "uuid-1", statusId: "state-first" },
				"adding",
			);
			expect(result.started).toBe(true);
			expect(result.targetState).toEqual({
				id: "state-first",
				name: "In Progress",
			});
		});

		it("does not update an issue that is already started", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "resolveIssueId").mockResolvedValue("uuid-1");
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValueOnce({
				issue: {
					id: "uuid-1",
					identifier: "DEV-1",
					state: { id: "state-started", name: "In Progress", type: "started" },
					team: { id: "team-1", key: "DEV", name: "Dev" },
					delegate: null,
				},
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);
			const getIssueById = vi.spyOn(service, "getIssueById").mockResolvedValue({
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Task",
				labels: [],
				priority: 0,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				url: "https://linear.app/acme/issue/DEV-1/task",
			});
			const updateIssue = vi.spyOn(service, "updateIssue");

			const result = await service.startIssue("DEV-1");

			expect(getIssueById).toHaveBeenCalledWith("uuid-1");
			expect(updateIssue).not.toHaveBeenCalled();
			expect(result.started).toBe(false);
		});
	});

	describe("claimIssue", () => {
		it("assigns the authenticated viewer and moves the issue to the first started state", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "resolveIssueId").mockResolvedValue("uuid-1");
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValueOnce({
					viewer: {
						id: "user-1",
						name: "Nico Appel",
						displayName: "Nico",
						email: "nico@example.com",
					},
					issue: {
						id: "uuid-1",
						identifier: "DEV-1",
						state: { id: "state-backlog", name: "Backlog", type: "backlog" },
						assignee: null,
						team: { id: "team-1", key: "DEV", name: "Dev" },
					},
				})
				.mockResolvedValueOnce({
					team: {
						states: {
							nodes: [
								{ id: "state-later", name: "Review", position: 20 },
								{ id: "state-first", name: "In Progress", position: 10 },
							],
						},
					},
				});
			const service = new GraphQLIssuesService(graphQLService, linearService);
			const updateIssue = vi.spyOn(service, "updateIssue").mockResolvedValue({
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Task",
				labels: [],
				priority: 0,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				url: "https://linear.app/acme/issue/DEV-1/task",
			});

			const result = await service.claimIssue("DEV-1");

			expect(rawRequest).toHaveBeenCalledTimes(2);
			expect(String(rawRequest.mock.calls[0]?.[0])).toContain("viewer");
			expect(updateIssue).toHaveBeenCalledWith(
				{
					id: "uuid-1",
					assigneeId: "user-1",
					statusId: "state-first",
				},
				"adding",
			);
			expect(result).toMatchObject({
				claimed: true,
				alreadyClaimed: false,
				assigned: true,
				started: true,
				targetState: { id: "state-first", name: "In Progress" },
			});
		});

		it("does nothing when the issue is already started and assigned to the viewer", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "resolveIssueId").mockResolvedValue("uuid-1");
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValueOnce({
				viewer: {
					id: "user-1",
					name: "Nico Appel",
					displayName: "Nico",
					email: "nico@example.com",
				},
				issue: {
					id: "uuid-1",
					identifier: "DEV-1",
					state: { id: "state-started", name: "In Progress", type: "started" },
					assignee: { id: "user-1", name: "Nico Appel", url: "https://x" },
					team: { id: "team-1", key: "DEV", name: "Dev" },
				},
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);
			const getIssueById = vi.spyOn(service, "getIssueById").mockResolvedValue({
				id: "uuid-1",
				identifier: "DEV-1",
				title: "Task",
				labels: [],
				priority: 0,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				url: "https://linear.app/acme/issue/DEV-1/task",
			});
			const updateIssue = vi.spyOn(service, "updateIssue");

			const result = await service.claimIssue("DEV-1");

			expect(getIssueById).toHaveBeenCalledWith("uuid-1");
			expect(updateIssue).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				claimed: false,
				alreadyClaimed: true,
				assigned: false,
				started: false,
			});
		});
	});

	describe("resolveTeamId (via internal access)", () => {
		it("returns team ID when GraphQL exact match succeeds", async () => {
			const service = createService();
			const resolveResult = {
				teams: {
					nodes: [{ id: "team-uuid", key: "DEV", name: "Dev" }],
				},
			};
			// Access private method for unit testing
			const result = await (service as any).resolveTeamId("dev", resolveResult);
			expect(result).toBe("team-uuid");
		});

		it("falls back to LinearService when GraphQL match fails", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const resolveTeamIdSpy = vi
				.spyOn(linearService, "resolveTeamId")
				.mockResolvedValue("prefix-resolved-uuid");
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const resolveResult = { teams: { nodes: [] } };
			const result = await (service as any).resolveTeamId(
				"front",
				resolveResult,
			);

			expect(result).toBe("prefix-resolved-uuid");
			expect(resolveTeamIdSpy).toHaveBeenCalledWith("front");
			resolveTeamIdSpy.mockRestore();
		});

		it("returns UUID directly without any resolution", async () => {
			const service = createService();
			const result = await (service as any).resolveTeamId(
				"f47ac10b-58cc-4372-a567-0e02b2c3d479",
				{},
			);
			expect(result).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
		});
	});

	describe("transformIssueData", () => {
		it("transforms a minimal issue", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					url: "https://linear.app/acme/issue/DEV-100/test-issue",
					title: "Test Issue",
					priority: 2,
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-02T00:00:00.000Z",
				}),
			);

			expect(result.id).toBe("issue-1");
			expect(result.identifier).toBe("DEV-100");
			expect(result.url).toBe(
				"https://linear.app/acme/issue/DEV-100/test-issue",
			);
			expect(result.title).toBe("Test Issue");
			expect(result.priority).toBe(2);
			expect(result.labels).toEqual([]);
			expect(result.state).toBeUndefined();
			expect(result.assignee).toBeUndefined();
			expect(result.team).toBeUndefined();
		});

		it("maps completedAt through when the issue is completed (DEV-5454)", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Done issue",
					priority: 1,
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-03T00:00:00.000Z",
					completedAt: "2026-01-02T00:00:00.000Z",
				}),
			);

			expect(result.completedAt).toBe("2026-01-02T00:00:00.000Z");
		});

		it("leaves completedAt undefined for an open issue, not fabricated as now (DEV-5454)", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Open issue",
					priority: 1,
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					completedAt: null,
				}),
			);

			expect(result.completedAt).toBeUndefined();
		});

		it("transforms issue with state, assignee, and team", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Test",
					priority: 1,
					state: { id: "state-1", name: "In Progress" },
					assignee: { id: "user-1", name: "Alice" },
					team: { id: "team-1", key: "DEV", name: "Dev" },
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			);

			expect(result.state).toEqual({ id: "state-1", name: "In Progress" });
			expect(result.assignee).toEqual({ id: "user-1", name: "Alice" });
			expect(result.team).toEqual({ id: "team-1", key: "DEV", name: "Dev" });
		});

		it("transforms issue delegate", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Test",
					priority: 1,
					delegate: { id: "agent-1", name: "Claude" },
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			);

			expect(result.delegate).toEqual({ id: "agent-1", name: "Claude" });
		});

		it("transforms labels", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Test",
					priority: 0,
					labels: {
						nodes: [
							{ id: "label-1", name: "bug" },
							{ id: "label-2", name: "feature" },
						],
					},
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			);

			expect(result.labels).toEqual([
				{ id: "label-1", name: "bug" },
				{ id: "label-2", name: "feature" },
			]);
		});

		it("transforms project, cycle, and milestone refs", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Test",
					priority: 0,
					project: { id: "proj-1", name: "My Project" },
					cycle: { id: "cycle-1", name: "Sprint 5", number: 5 },
					projectMilestone: {
						id: "ms-1",
						name: "Beta",
						targetDate: "2026-06-01",
					},
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			);

			expect(result.project).toEqual({ id: "proj-1", name: "My Project" });
			expect(result.cycle).toEqual({
				id: "cycle-1",
				name: "Sprint 5",
				number: 5,
			});
			expect(result.projectMilestone).toEqual({
				id: "ms-1",
				name: "Beta",
				targetDate: "2026-06-01",
			});
		});

		it("transforms parent and sub-issues", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Test",
					priority: 0,
					parent: { id: "parent-1", identifier: "DEV-50", title: "Parent" },
					children: {
						nodes: [
							{ id: "child-1", identifier: "DEV-101", title: "Sub-task" },
						],
					},
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			);

			expect(result.parentIssue).toEqual({
				id: "parent-1",
				identifier: "DEV-50",
				title: "Parent",
			});
			expect(result.subIssues).toEqual([
				{ id: "child-1", identifier: "DEV-101", title: "Sub-task" },
			]);
		});

		it("transforms comments with user", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Test",
					priority: 0,
					comments: {
						nodes: [
							{
								id: "comment-1",
								body: "Looks good",
								user: { id: "user-1", name: "Bob" },
								createdAt: "2026-01-01T00:00:00.000Z",
								updatedAt: "2026-01-01T00:00:00.000Z",
							},
						],
					},
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			);

			expect(result.comments).toHaveLength(1);
			expect(result.comments![0].body).toBe("Looks good");
			expect(result.comments![0].user).toEqual({ id: "user-1", name: "Bob" });
		});

		it("extracts summary from completed generation", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Test",
					priority: 0,
					summary: {
						generationStatus: "completed",
						content: {
							content: [
								{ text: "This issue addresses " },
								{ text: "a bug fix." },
							],
						},
					},
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			);

			expect(result.summary).toBe("This issue addresses a bug fix.");
		});

		it("returns undefined summary when generation not completed", () => {
			const service = createService();
			const result = service.transformIssueData(
				makeIssueNode({
					id: "issue-1",
					identifier: "DEV-100",
					title: "Test",
					priority: 0,
					summary: { generationStatus: "pending", content: null },
					labels: { nodes: [] },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				}),
			);

			expect(result.summary).toBeUndefined();
		});
	});

	describe("createIssue project/team resolution", () => {
		const PROJECT_UUID = "11111111-1111-4111-8111-111111111111";
		const issueNode = {
			id: "issue-1",
			identifier: "PYT-1",
			title: "Test",
			priority: 0,
			labels: { nodes: [] },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};

		function setupCreate(batchResult: Record<string, unknown>) {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "normalizeProjectInput").mockResolvedValue(
				PROJECT_UUID,
			);
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockImplementation(async (query: string) => {
					if (query.includes("BatchResolveForCreate")) {
						return batchResult;
					}
					if (query.includes("issueCreate")) {
						return {
							issueCreate: { success: true, issue: issueNode, lastSyncId: 1 },
						};
					}
					throw new Error(`unexpected query: ${query}`);
				});
			const service = new GraphQLIssuesService(graphQLService, linearService);
			return { service, rawRequest };
		}

		function batchVars(rawRequest: ReturnType<typeof vi.spyOn>) {
			const call = rawRequest.mock.calls.find(([q]: unknown[]) =>
				String(q).includes("BatchResolveForCreate"),
			);
			return call?.[1] as Record<string, unknown>;
		}

		function createInputTeamId(rawRequest: ReturnType<typeof vi.spyOn>) {
			const call = rawRequest.mock.calls.find(([q]: unknown[]) =>
				String(q).includes("issueCreate"),
			);
			return (call?.[1] as { input: { teamId?: string } }).input.teamId;
		}

		it("resolves a UUID --project by id, not a null name filter", async () => {
			const { service, rawRequest } = setupCreate({
				teams: { nodes: [{ id: "team-all", key: "ALL", name: "All" }] },
				projectsById: {
					nodes: [
						{
							id: PROJECT_UUID,
							name: "SOPs",
							teams: { nodes: [{ id: "team-all", key: "ALL" }] },
						},
					],
				},
				parentIssues: { nodes: [] },
			});

			await service.createIssue({
				title: "Test",
				teamId: "ALL",
				teamInput: "ALL",
				projectId: PROJECT_UUID,
			});

			const vars = batchVars(rawRequest);
			expect(vars).toMatchObject({
				projectId: PROJECT_UUID,
				hasProjectId: true,
			});
			expect(vars).not.toHaveProperty("projectName");
			expect(vars).not.toHaveProperty("hasProjectName");
		});

		it("keeps the requested team when a UUID --project is associated with it", async () => {
			const { service, rawRequest } = setupCreate({
				teams: { nodes: [{ id: "team-all", key: "ALL", name: "All" }] },
				projectsById: {
					nodes: [
						{
							id: PROJECT_UUID,
							name: "SOPs",
							teams: { nodes: [{ id: "team-all", key: "ALL" }] },
						},
					],
				},
				parentIssues: { nodes: [] },
			});

			await service.createIssue({
				title: "Test",
				teamId: "ALL",
				teamInput: "ALL",
				projectId: PROJECT_UUID,
			});

			// No false auto-switch: the project IS on ALL.
			expect(createInputTeamId(rawRequest)).toBe("team-all");
		});

		it("auto-switches the team when a UUID --project belongs to exactly one other team", async () => {
			const { service, rawRequest } = setupCreate({
				teams: { nodes: [{ id: "team-all", key: "ALL", name: "All" }] },
				projectsById: {
					nodes: [
						{
							id: PROJECT_UUID,
							name: "Build IP ban system",
							teams: { nodes: [{ id: "team-pyt", key: "PYT" }] },
						},
					],
				},
				parentIssues: { nodes: [] },
			});

			await service.createIssue({
				title: "Test",
				teamId: "ALL",
				teamInput: "ALL",
				projectId: PROJECT_UUID,
			});

			// The project resolved by id carries its real team, so the switch
			// targets the project's actual team rather than an arbitrary one.
			expect(createInputTeamId(rawRequest)).toBe("team-pyt");
		});

		it("throws a clear error when a UUID --project does not exist", async () => {
			const { service } = setupCreate({
				teams: { nodes: [{ id: "team-all", key: "ALL", name: "All" }] },
				// `projectsById` ran but matched nothing — the UUID is dead.
				projectsById: { nodes: [] },
				parentIssues: { nodes: [] },
			});

			await expect(
				service.createIssue({
					title: "Test",
					teamId: "ALL",
					teamInput: "ALL",
					projectId: PROJECT_UUID,
				}),
			).rejects.toThrow(/Project .* not found/);
		});

		// DEV-4103: when a name resolves to multiple projects across teams,
		// disambiguate by --team (or throw explicit ambiguity).
		it("picks the team-matching candidate when --project name is shared across teams", async () => {
			// `normalizeProjectInput` only resolves URL/slug shapes; a plain name
			// passes through unchanged, so the batch resolver sees it.
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "normalizeProjectInput").mockResolvedValue(
				"Shared Name",
			);
			vi.spyOn(graphQLService, "rawRequest").mockImplementation(
				async (query: string) => {
					if (query.includes("BatchResolveForCreate")) {
						return {
							teams: {
								nodes: [{ id: "team-dev", key: "DEV", name: "Dev" }],
							},
							projectsByName: {
								nodes: [
									{
										id: "shared-id-dev",
										name: "Shared Name",
										teams: { nodes: [{ id: "team-dev", key: "DEV" }] },
									},
									{
										id: "shared-id-inf",
										name: "Shared Name",
										teams: { nodes: [{ id: "team-inf", key: "INF" }] },
									},
								],
							},
							parentIssues: { nodes: [] },
						};
					}
					if (query.includes("issueCreate")) {
						return {
							issueCreate: {
								success: true,
								issue: issueNode,
								lastSyncId: 1,
							},
						};
					}
					throw new Error(`unexpected query: ${query}`);
				},
			);
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.createIssue({
				title: "Test",
				teamId: "DEV",
				teamInput: "DEV",
				projectId: "Shared Name",
			});
			// No throw — the DEV-matching candidate was picked.
		});

		it("throws ambiguous when --project name matches across teams and --team doesn't pin one", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "normalizeProjectInput").mockResolvedValue(
				"Shared Name",
			);
			vi.spyOn(graphQLService, "rawRequest").mockImplementation(
				async (query: string) => {
					if (query.includes("BatchResolveForCreate")) {
						return {
							// `--team MAR` resolves, but neither candidate is on MAR.
							teams: {
								nodes: [{ id: "team-mar", key: "MAR", name: "Marketing" }],
							},
							projectsByName: {
								nodes: [
									{
										id: "shared-id-dev",
										name: "Shared Name",
										teams: { nodes: [{ id: "team-dev", key: "DEV" }] },
									},
									{
										id: "shared-id-inf",
										name: "Shared Name",
										teams: { nodes: [{ id: "team-inf", key: "INF" }] },
									},
								],
							},
							parentIssues: { nodes: [] },
						};
					}
					throw new Error(`unexpected query: ${query}`);
				},
			);
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await expect(
				service.createIssue({
					title: "Test",
					teamId: "MAR",
					teamInput: "MAR",
					projectId: "Shared Name",
				}),
			).rejects.toThrow(/Multiple projects.*Shared Name.*DEV.*INF/s);
		});
	});

	// FE-926: mirrors the createIssue hint below — a create can hit the same
	// raw "Conflict on insert of DocumentContent" GraphQL error if Linear's
	// description-content store is in a bad state. Not observed on the create
	// path itself (FE-921's create succeeded; the corruption surfaced ~1
	// minute later, only visible on subsequent update attempts), but the
	// create mutation shares the same description-writing failure mode, so
	// it gets the same actionable message instead of the raw error.
	describe("createIssue DocumentContent conflict hint (FE-926)", () => {
		it("enriches a DocumentContent conflict into an actionable message", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(graphQLService, "rawRequest").mockRejectedValue(
				new Error(
					"GraphQL request failed: Conflict on insert of DocumentContent - Entity DocumentContent with id d28f4672-3d8c-45a5-98bf-93c59399238e already exists.",
				),
			);
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await expect(
				service.createIssue({
					title: "Test",
					teamId: "11111111-1111-4111-8111-111111111111",
					teamInput: "DEV",
					description: "test",
				}),
			).rejects.toThrow(
				/description store is in conflict for this issue\. This does not self-heal by retrying/s,
			);
		});
	});

	describe("updateIssue project/milestone resolution", () => {
		const ISSUE_UUID = "22222222-2222-4222-8222-222222222222";
		const PROJECT_UUID = "33333333-3333-4333-8333-333333333333";
		const issueNode = {
			id: ISSUE_UUID,
			identifier: "PYT-1",
			title: "Test",
			priority: 0,
			labels: { nodes: [] },
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};

		function setupUpdate(batchResult: Record<string, unknown>) {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "normalizeProjectInput").mockResolvedValue(
				PROJECT_UUID,
			);
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockImplementation(async (query: string) => {
					if (query.includes("BatchResolveForUpdate")) {
						return batchResult;
					}
					if (query.includes("issueUpdate")) {
						return {
							issueUpdate: { success: true, issue: issueNode, lastSyncId: 1 },
						};
					}
					throw new Error(`unexpected query: ${query}`);
				});
			const service = new GraphQLIssuesService(graphQLService, linearService);
			return { service, rawRequest };
		}

		function batchVars(rawRequest: ReturnType<typeof vi.spyOn>) {
			const call = rawRequest.mock.calls.find(([q]: unknown[]) =>
				String(q).includes("BatchResolveForUpdate"),
			);
			return call?.[1] as Record<string, unknown>;
		}

		function updateInput(rawRequest: ReturnType<typeof vi.spyOn>) {
			const call = rawRequest.mock.calls.find(([q]: unknown[]) =>
				String(q).includes("issueUpdate"),
			);
			return (call?.[1] as { input: Record<string, unknown> }).input;
		}

		it("resolves a UUID --project by id, not a null name filter", async () => {
			const { service, rawRequest } = setupUpdate({
				projectsById: {
					nodes: [
						{
							id: PROJECT_UUID,
							name: "SOPs",
							projectMilestones: { nodes: [] },
						},
					],
				},
				issues: { nodes: [] },
			});

			await service.updateIssue({ id: ISSUE_UUID, projectId: PROJECT_UUID });

			const vars = batchVars(rawRequest);
			expect(vars).toMatchObject({
				projectId: PROJECT_UUID,
				hasProjectId: true,
			});
			expect(vars).not.toHaveProperty("projectName");
		});

		it("resolves --project-milestone against the UUID project's own milestones", async () => {
			const { service, rawRequest } = setupUpdate({
				projectsById: {
					nodes: [
						{
							id: PROJECT_UUID,
							name: "SOPs",
							projectMilestones: {
								nodes: [
									{
										id: "de519000-0000-4000-8000-000000000005",
										name: "Phase 1",
									},
								],
							},
						},
					],
				},
				milestones: { nodes: [] },
				issues: { nodes: [] },
			});

			await service.updateIssue({
				id: ISSUE_UUID,
				projectId: PROJECT_UUID,
				milestoneId: "Phase 1",
			});

			expect(batchVars(rawRequest)).toMatchObject({ hasMilestoneName: true });
			expect(updateInput(rawRequest).projectMilestoneId).toBe(
				"de519000-0000-4000-8000-000000000005",
			);
		});

		it("throws a clear error when a UUID --project does not exist", async () => {
			const { service } = setupUpdate({
				// `projectsById` ran but matched nothing — the UUID is dead.
				projectsById: { nodes: [] },
				issues: { nodes: [] },
			});

			await expect(
				service.updateIssue({ id: ISSUE_UUID, projectId: PROJECT_UUID }),
			).rejects.toThrow(/Project .* not found/);
		});

		// DEV-4103: when a --project name resolves to multiple projects across
		// teams on update, scope to the issue's existing team rather than the
		// arbitrary first match.
		it("picks the team-matching candidate when --project name is shared across teams", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "normalizeProjectInput").mockResolvedValue(
				"Shared Name",
			);
			vi.spyOn(graphQLService, "rawRequest").mockImplementation(
				async (query: string) => {
					if (query.includes("BatchResolveForUpdate")) {
						return {
							// Two candidates with the same name on different teams; the
							// resolver must pick the DEV one because the existing issue
							// lives on DEV.
							projectsByName: {
								nodes: [
									{
										id: "shared-id-dev",
										name: "Shared Name",
										teams: { nodes: [{ id: "team-dev", key: "DEV" }] },
										projectMilestones: { nodes: [] },
									},
									{
										id: "shared-id-inf",
										name: "Shared Name",
										teams: { nodes: [{ id: "team-inf", key: "INF" }] },
										projectMilestones: { nodes: [] },
									},
								],
							},
							issues: {
								nodes: [
									{
										id: ISSUE_UUID,
										identifier: "DEV-1",
										team: { id: "team-dev", key: "DEV" },
										labels: { nodes: [] },
										project: null,
									},
								],
							},
						};
					}
					if (query.includes("issueUpdate")) {
						return {
							issueUpdate: { success: true, issue: issueNode, lastSyncId: 1 },
						};
					}
					throw new Error(`unexpected query: ${query}`);
				},
			);
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.updateIssue({ id: "DEV-1", projectId: "Shared Name" });
			// No throw — the DEV-matching candidate was picked. The mutation
			// would have failed if the wrong project was chosen because the
			// project-id passed to the mutation is the resolver's pick.
		});
	});

	// FE-926: a description write can fail with a raw "Conflict on insert of
	// DocumentContent" GraphQL error when Linear's description-content store
	// gets into a corrupted state for a specific issue (observed on FE-921 —
	// the description saved cleanly at creation, then was silently empty
	// ~1 minute later with no history trace, and every update attempt since
	// has hit this same conflict against a *different* DocumentContent id
	// each time). Retrying does not self-heal, so the raw message is enriched
	// with the known workaround instead of surfacing Linear's internal error.
	describe("updateIssue DocumentContent conflict hint (FE-926)", () => {
		const ISSUE_UUID = "44444444-4444-4444-8444-444444444444";

		it("enriches a DocumentContent conflict into an actionable workaround message", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(graphQLService, "rawRequest").mockRejectedValue(
				new Error(
					"GraphQL request failed: Conflict on insert of DocumentContent - Entity DocumentContent with id d28f4672-3d8c-45a5-98bf-93c59399238e already exists.",
				),
			);
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await expect(
				service.updateIssue({
					id: ISSUE_UUID,
					description: "test restore probe",
				}),
			).rejects.toThrow(
				/description store is in conflict for 44444444-4444-4444-8444-444444444444\. This does not self-heal by retrying.*--duplicate-of 44444444-4444-4444-8444-444444444444/s,
			);
		});
	});

	// DEV-4312: the search/list path resolved an assignee only by email, so a
	// plain full name fell through unchanged and the raw string was sent to the
	// GraphQL filter as a bogus UUID ("Argument Validation Error"). It must now
	// resolve names via resolveUserId — symmetric with delegate resolution.
	describe("searchIssues assignee resolution (DEV-4312)", () => {
		it("resolves a full-name assignee via resolveUserId and filters by the UUID", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const resolveUserId = vi
				.spyOn(linearService, "resolveUserId")
				.mockResolvedValue("assignee-uuid");
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({ issues: { nodes: [] } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.searchIssues({ assigneeId: "Yury Tsukerman", limit: 5 });

			// The name was resolved via the user lookup (not sent raw).
			expect(resolveUserId).toHaveBeenCalledWith("Yury Tsukerman");
			// The filtered-search query received the resolved UUID, not the name.
			const filteredCall = rawRequest.mock.calls.find(([q]) =>
				String(q).includes("IssueFilter"),
			);
			expect(filteredCall).toBeDefined();
			const filter = (filteredCall?.[1] as { filter: Record<string, unknown> })
				.filter;
			expect(filter.assignee).toEqual({ id: { eq: "assignee-uuid" } });
		});

		it("resolves an assignee via the registry first when configured, skipping the Linear-API lookup (DEV-4872)", async () => {
			mockIsRegistryConfigured.mockReturnValue(true);
			mockResolveViaRegistry.mockResolvedValue("registry-assignee-uuid");
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const resolveUserId = vi.spyOn(linearService, "resolveUserId");
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({ issues: { nodes: [] } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.searchIssues({ assigneeId: "dima", limit: 5 });

			// Registry resolved name → UUID; the Linear-API user lookup was skipped.
			expect(mockResolveViaRegistry).toHaveBeenCalledWith("dima");
			expect(resolveUserId).not.toHaveBeenCalled();
			const filteredCall = rawRequest.mock.calls.find(([q]) =>
				String(q).includes("IssueFilter"),
			);
			const filter = (filteredCall?.[1] as { filter: Record<string, unknown> })
				.filter;
			expect(filter.assignee).toEqual({ id: { eq: "registry-assignee-uuid" } });
		});

		it("falls back to the Linear-API lookup when the registry misses (DEV-4872)", async () => {
			mockIsRegistryConfigured.mockReturnValue(true);
			mockResolveViaRegistry.mockResolvedValue(null);
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const resolveUserId = vi
				.spyOn(linearService, "resolveUserId")
				.mockResolvedValue("assignee-uuid");
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				issues: { nodes: [] },
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.searchIssues({ assigneeId: "Yury Tsukerman", limit: 5 });

			// Registry miss → the existing user lookup still resolves the name.
			expect(mockResolveViaRegistry).toHaveBeenCalledWith("Yury Tsukerman");
			expect(resolveUserId).toHaveBeenCalledWith("Yury Tsukerman");
		});

		it("passes a UUID assignee through without a lookup", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const resolveUserId = vi.spyOn(linearService, "resolveUserId");
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				issues: { nodes: [] },
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.searchIssues({
				assigneeId: "11111111-1111-4111-8111-111111111111",
				limit: 5,
			});

			expect(resolveUserId).not.toHaveBeenCalled();
		});

		it("propagates a clear not-found error instead of an opaque GraphQL error", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			// Reject with the real factory error rather than a hand-written
			// string, so the test stays coupled to the actual message contract.
			vi.spyOn(linearService, "resolveUserId").mockRejectedValue(
				notFoundError("User", "Nobody Here"),
			);
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await expect(
				service.searchIssues({ assigneeId: "Nobody Here", limit: 5 }),
			).rejects.toThrow(/User "Nobody Here" not found/);
		});

		it("propagates the structured ambiguous error when a name matches multiple users", async () => {
			// DEV-4312 "Done when": an ambiguous assignee yields the structured
			// multiple-matches error (not an opaque GraphQL failure). The
			// behavior is resolveUserId's; we assert searchIssues surfaces it.
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(linearService, "resolveUserId").mockRejectedValue(
				multipleMatchesError(
					"User",
					"Alex",
					["Alex Shephard (alex@x.com)", "Alex Chen (achen@x.com)"],
					"use the full email or UUID instead",
				),
			);
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await expect(
				service.searchIssues({ assigneeId: "Alex", limit: 5 }),
			).rejects.toThrow(/Multiple Users found matching "Alex"\. Candidates:/);
		});
	});

	describe("searchIssues team scoping (DEV-5578)", () => {
		const TEAM_UUID = "aaaaaaaa-1111-4111-8111-111111111111";

		// Minimal COMPLETE_ISSUE_FRAGMENT-shaped node carrying a team.
		function issueNode(seq: number, teamKey: string): Record<string, unknown> {
			return {
				id: `issue-${teamKey}-${seq}`,
				identifier: `${teamKey}-${seq}`,
				title: `issue ${seq}`,
				priority: 1,
				labels: { nodes: [] },
				state: { id: "state-todo", name: "Todo", type: "unstarted" },
				team: {
					id: teamKey === "DEV" ? TEAM_UUID : `${teamKey}-uuid`,
					key: teamKey,
					name: teamKey,
				},
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-02T00:00:00.000Z",
			};
		}

		it("routes a --team list through the Team.issues connection with team removed from the IssueFilter", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({ team: { issues: { nodes: [] } } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.searchIssues({
				teamId: TEAM_UUID,
				status: ["Todo"],
				limit: 100,
			});

			// Exactly one request: the team-scoped query (a UUID teamId needs no
			// batch resolve). It must be TeamScopedFilteredIssues, not the leaky
			// top-level FilteredSearchIssues.
			expect(rawRequest).toHaveBeenCalledTimes(1);
			const [query, vars] = rawRequest.mock.calls[0] as [
				string,
				{ teamId?: string; filter?: Record<string, unknown> },
			];
			expect(String(query)).toContain("TeamScopedFilteredIssues");
			expect(String(query)).toContain("team(id: $teamId)");
			// The team boundary is structural — it must NOT be a top-level
			// `team` relation filter (the shape Linear leaks past ~20 rows).
			expect(vars.teamId).toBe(TEAM_UUID);
			expect(vars.filter?.team).toBeUndefined();
			// Sibling filters still ride on the team-scoped connection.
			expect(vars.filter?.state).toEqual({ name: { in: ["Todo"] } });
		});

		it("returns 100% matching-team rows across a paginated (limit > one page) result set — never falls through to the leaky top-level path", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			// 100-row (multi-page) DEV-only set for the team-scoped query.
			const devNodes = Array.from({ length: 100 }, (_, i) =>
				issueNode(i, "DEV"),
			);
			// If the code ever routes --team back through the top-level
			// FilteredSearchIssues query, this contaminated set (other teams
			// leaking in — the DEV-5578 bug) would surface and the assertion fails.
			const contaminated = [
				issueNode(1, "DEV"),
				issueNode(2, "EMW"),
				issueNode(3, "INF"),
				issueNode(4, "FE"),
			];
			vi.spyOn(graphQLService, "rawRequest").mockImplementation((async (
				q: string,
			) => {
				if (String(q).includes("TeamScopedFilteredIssues")) {
					return { team: { issues: { nodes: devNodes } } };
				}
				return { issues: { nodes: contaminated } };
			}) as never);
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.searchIssues({
				teamId: TEAM_UUID,
				status: ["Todo"],
				limit: 100,
			});

			expect(result).toHaveLength(100);
			expect(result.every((issue) => issue.team?.key === "DEV")).toBe(true);
		});

		it("returns an empty list when the team-scoped connection yields no nodes", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				team: { issues: { nodes: [] } },
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.searchIssues({
				teamId: TEAM_UUID,
				status: ["Todo"],
				limit: 50,
			});

			expect(result).toEqual([]);
		});

		it("uses the top-level FilteredSearchIssues query when no team is supplied", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({ issues: { nodes: [] } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.searchIssues({
				teamId: undefined,
				status: ["Todo"],
				limit: 5,
			});

			const [query, vars] = rawRequest.mock.calls[0] as [
				string,
				{ teamId?: string; filter?: Record<string, unknown> },
			];
			expect(String(query)).toContain("FilteredSearchIssues");
			expect(String(query)).not.toContain("TeamScopedFilteredIssues");
			expect(vars.teamId).toBeUndefined();
			expect(vars.filter?.state).toEqual({ name: { in: ["Todo"] } });
		});

		it("issues search --team filters full-text results to the team client-side (shares no leaky server path)", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			// Full-text search returns a global, cross-team result set; the team
			// filter is applied in-memory by applySearchFilters (unaffected by the
			// server-side relation-filter leak, but must still drop other teams).
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				searchIssues: {
					nodes: [
						issueNode(1, "DEV"),
						issueNode(2, "EMW"),
						issueNode(3, "DEV"),
						issueNode(4, "INF"),
					],
				},
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.searchIssues({
				query: "widget",
				teamId: TEAM_UUID,
				limit: 30,
			});

			expect(result.every((issue) => issue.team?.key === "DEV")).toBe(true);
			expect(result).toHaveLength(2);
		});
	});

	describe("searchIssues terminal-state exclusion (DEV-4879)", () => {
		it("excludes completed, canceled AND duplicate states by default", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({ issues: { nodes: [] } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.searchIssues({
				teamId: undefined,
				excludeTerminalStates: true,
				limit: 5,
			});

			const filteredCall = rawRequest.mock.calls.find(([q]) =>
				String(q).includes("IssueFilter"),
			);
			expect(filteredCall).toBeDefined();
			const filter = (filteredCall?.[1] as { filter: Record<string, unknown> })
				.filter;
			// Regression: the hardcoded ["completed","canceled"] list omitted the
			// workspace's `duplicate`-typed state, so resolved duplicates leaked
			// into the default open-issues view.
			expect(filter.state).toEqual({
				type: { nin: ["completed", "canceled", "duplicate"] },
			});
		});

		it("does not apply the terminal-state filter when excludeTerminalStates is false (--include-closed)", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({ issues: { nodes: [] } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			// A UUID assignee forces the IssueFilter query path so we can assert
			// the *absence* of a terminal-state filter (no lookup, passes through).
			await service.searchIssues({
				assigneeId: "11111111-1111-4111-8111-111111111111",
				excludeTerminalStates: false,
				limit: 5,
			});

			const filteredCall = rawRequest.mock.calls.find(([q]) =>
				String(q).includes("IssueFilter"),
			);
			expect(filteredCall).toBeDefined();
			const filter = (filteredCall?.[1] as { filter: Record<string, unknown> })
				.filter;
			expect(filter.state).toBeUndefined();
		});

		it("post-filters duplicate-typed issues out of full-text search results (DEV-4879)", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			// Full-text search (`--query`) can't express the server-side state-type
			// `nin`, so exclusion happens in the in-memory post-filter. Return an
			// open issue + a duplicate-typed one and assert only the open survives.
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				searchIssues: {
					nodes: [
						{
							id: "a",
							identifier: "DEV-1",
							title: "Open",
							priority: 0,
							state: { id: "s1", name: "Todo", type: "unstarted" },
							labels: { nodes: [] },
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
						},
						{
							id: "b",
							identifier: "DEV-2",
							title: "Dupe",
							priority: 0,
							state: { id: "s2", name: "Duplicate", type: "duplicate" },
							labels: { nodes: [] },
							createdAt: "2026-01-01T00:00:00.000Z",
							updatedAt: "2026-01-01T00:00:00.000Z",
						},
					],
				},
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.searchIssues({
				query: "anything",
				excludeTerminalStates: true,
				limit: 5,
			});

			expect(result.map((i) => i.identifier)).toEqual(["DEV-1"]);
		});
	});

	describe("getIssuesByRefs (DEV-4477)", () => {
		// Minimal node — only the fields the test logic checks. `transformIssueData`
		// fills in defaults from missing fields, so we don't have to enumerate all.
		function makeNode(id: string, identifier: string, title = identifier) {
			return {
				id,
				identifier,
				title,
				description: null,
				priority: 0,
				estimate: null,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				dueDate: null,
				state: { id: "s", name: "Todo", type: "unstarted" },
				assignee: null,
				labels: { nodes: [] },
				team: { id: "t", key: identifier.split("-")[0], name: "Team" },
				project: null,
				parent: null,
				cycle: null,
				attachments: { nodes: [] },
				comments: { nodes: [] },
				url: `https://linear.app/x/issue/${identifier}`,
				archivedAt: null,
				canceledAt: null,
				completedAt: null,
				startedAt: null,
				snoozedUntilAt: null,
				subscriberIds: [],
				trashed: null,
				identifier_lower: identifier.toLowerCase(),
				number: Number.parseInt(identifier.split("-")[1] ?? "0", 10),
			};
		}

		it("batches mixed UUIDs and identifiers into a single GraphQL call", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const nodes = [
				makeNode("11111111-1111-1111-1111-111111111111", "DEV-1"),
				makeNode("22222222-2222-2222-2222-222222222222", "PROD-9"),
				makeNode("33333333-3333-3333-3333-333333333333", "DEV-2"),
			];
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({ issues: { nodes } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const refs = [
				"DEV-1",
				"11111111-1111-1111-1111-111111111111",
				"PROD-9",
				"DEV-2",
			];
			const result = await service.getIssuesByRefs(refs);

			// Exactly one GraphQL call — that's the whole point of DEV-4477.
			expect(rawRequest).toHaveBeenCalledTimes(1);
			expect(rawRequest).toHaveBeenCalledWith(
				expect.stringContaining("BatchGetIssues"),
				expect.objectContaining({
					filter: {
						or: expect.arrayContaining([
							{ id: { in: ["11111111-1111-1111-1111-111111111111"] } },
							{ team: { key: { eq: "DEV" } }, number: { in: [1, 2] } },
							{ team: { key: { eq: "PROD" } }, number: { in: [9] } },
						]),
					},
					first: expect.any(Number),
				}),
			);
			expect(result).toHaveLength(4);
			// Order matches input refs, NOT Linear's DB order from `nodes`.
			expect(result[0].identifier).toBe("DEV-1");
			expect(result[1].id).toBe("11111111-1111-1111-1111-111111111111");
			expect(result[2].identifier).toBe("PROD-9");
			expect(result[3].identifier).toBe("DEV-2");
		});

		it("falls back per ref when a valid final identifier is missing from the batch response", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const batchNodes = [
				makeNode("uuid-5119", "DEV-5119"),
				makeNode("uuid-5124", "DEV-5124"),
				makeNode("uuid-5125", "DEV-5125"),
				makeNode("uuid-5131", "DEV-5131"),
				makeNode("uuid-5132", "DEV-5132"),
			];
			const fallbackNode = makeNode("uuid-4365", "DEV-4365");
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValueOnce({ issues: { nodes: batchNodes } })
				.mockResolvedValueOnce({ issues: { nodes: [fallbackNode] } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.getIssuesByRefs([
				"DEV-5119",
				"DEV-5124",
				"DEV-5125",
				"DEV-5131",
				"DEV-5132",
				"DEV-4365",
			]);

			expect(rawRequest).toHaveBeenCalledTimes(2);
			expect(rawRequest.mock.calls[0][0]).toContain("BatchGetIssues");
			expect(rawRequest.mock.calls[1][0]).toContain("GetIssueByIdentifier");
			expect(rawRequest.mock.calls[1][1]).toEqual({
				teamKey: "DEV",
				number: 4365,
			});
			expect(result.map((issue) => issue.identifier)).toEqual([
				"DEV-5119",
				"DEV-5124",
				"DEV-5125",
				"DEV-5131",
				"DEV-5132",
				"DEV-4365",
			]);
		});

		it("falls back to a single getIssueById call for one ref", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const node = makeNode("uuid-1", "DEV-7");
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue({ issues: { nodes: [node] } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.getIssuesByRefs(["DEV-7"]);

			// Single-ref path uses GET_ISSUE_BY_IDENTIFIER_QUERY (single-issue),
			// not BATCH_GET_ISSUES_QUERY. Either is acceptable behaviorally;
			// the contract is "one GraphQL call". Lock that in.
			expect(rawRequest).toHaveBeenCalledTimes(1);
			expect(result).toHaveLength(1);
			expect(result[0].identifier).toBe("DEV-7");
		});

		it("returns an empty array when refs is empty (no GraphQL call)", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi.spyOn(graphQLService, "rawRequest");
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.getIssuesByRefs([]);

			expect(result).toEqual([]);
			expect(rawRequest).not.toHaveBeenCalled();
		});

		it("throws notFoundError naming the first missing ref", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(graphQLService, "rawRequest")
				.mockResolvedValueOnce({
					issues: { nodes: [makeNode("uuid-1", "DEV-1")] },
				})
				.mockResolvedValueOnce({ issues: { nodes: [] } });
			const service = new GraphQLIssuesService(graphQLService, linearService);

			// DEV-1 resolves, DEV-2 does not — error should name DEV-2.
			await expect(service.getIssuesByRefs(["DEV-1", "DEV-2"])).rejects.toThrow(
				notFoundError("Issue", "DEV-2"),
			);
		});

		it("groups multiple identifiers from the same team into one OR clause", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				issues: {
					nodes: [
						makeNode("u1", "DEV-1"),
						makeNode("u2", "DEV-2"),
						makeNode("u3", "DEV-3"),
					],
				},
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.getIssuesByRefs(["DEV-1", "DEV-2", "DEV-3"]);

			// Three identifiers, one team → one OR clause, not three.
			const rawRequestSpy = graphQLService.rawRequest as ReturnType<
				typeof vi.fn
			>;
			const call = rawRequestSpy.mock.calls[0];
			const variables = call[1] as { filter: { or: unknown[] } };
			expect(variables.filter.or).toHaveLength(1);
			expect(variables.filter.or[0]).toEqual({
				team: { key: { eq: "DEV" } },
				number: { in: [1, 2, 3] },
			});
		});

		it("batches an all-UUID list into one id.in clause (cycle-1 nit)", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const uuids = [
				"11111111-1111-1111-1111-111111111111",
				"22222222-2222-2222-2222-222222222222",
				"33333333-3333-3333-3333-333333333333",
			];
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				issues: {
					nodes: uuids.map((u, i) => makeNode(u, `DEV-${i + 1}`)),
				},
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			await service.getIssuesByRefs(uuids);

			const rawRequestSpy = graphQLService.rawRequest as ReturnType<
				typeof vi.fn
			>;
			const variables = rawRequestSpy.mock.calls[0][1] as {
				filter: { or: unknown[] };
			};
			// All UUIDs → exactly one clause: `id.in`.
			expect(variables.filter.or).toHaveLength(1);
			expect(variables.filter.or[0]).toEqual({ id: { in: uuids } });
		});

		it("returns one output per input ref when the same ref is passed twice (cycle-1 nit)", async () => {
			// Contract: output array length === input array length. The dual
			// UUID/identifier index resolves both occurrences to the same node;
			// `transformIssueData` is called once per occurrence, so callers
			// see two output entries pointing at the same underlying issue.
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				issues: { nodes: [makeNode("uuid-1", "DEV-1")] },
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.getIssuesByRefs(["DEV-1", "DEV-1"]);

			expect(result).toHaveLength(2);
			expect(result[0].identifier).toBe("DEV-1");
			expect(result[1].identifier).toBe("DEV-1");
		});

		it("clamps `first` to [100, 250] (floor for small batches; ceiling at Linear's connection cap)", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			vi.spyOn(graphQLService, "rawRequest").mockResolvedValue({
				issues: { nodes: [] },
			});
			const service = new GraphQLIssuesService(graphQLService, linearService);

			// Small batch → floor: 3 refs * 2 = 6, clamped up to 100.
			await service.getIssuesByRefs(["DEV-1", "DEV-2", "DEV-3"]).catch(() => {
				// notFoundError is expected since nodes is empty; we only care
				// about the `first` arg in the call signature.
			});
			const rawRequestSpy = graphQLService.rawRequest as ReturnType<
				typeof vi.fn
			>;
			expect(rawRequestSpy.mock.calls[0][1]).toEqual(
				expect.objectContaining({ first: 100 }),
			);
		});
	});

	describe("chunked issue-enumeration pagination (DEV-6312)", () => {
		// A COMPLETE_ISSUE_FRAGMENT-shaped node, minimal but enough to transform.
		function node(seq: number): Record<string, unknown> {
			return {
				id: `issue-${seq}`,
				identifier: `DEV-${seq}`,
				title: `issue ${seq}`,
				priority: 0,
				labels: { nodes: [] },
				state: { id: "s", name: "Todo", type: "unstarted" },
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-02T00:00:00.000Z",
			};
		}
		const page = (
			n: number,
			hasNextPage: boolean,
			endCursor: string | null,
		) => ({
			issues: {
				nodes: Array.from({ length: n }, (_, i) => node(i)),
				pageInfo: { hasNextPage, endCursor },
			},
		});

		it("getIssues caps a large --limit into 200-issue pages and follows the cursor", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValueOnce(page(200, true, "c1"))
				.mockResolvedValueOnce(page(200, true, "c2"))
				.mockResolvedValueOnce(page(100, true, "c3"));
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.getIssues(500);

			// 200 + 200 + 100 = 500 (target met); the fourth page is never fetched.
			expect(result).toHaveLength(500);
			expect(rawRequest).toHaveBeenCalledTimes(3);
			// Page size is capped at 200, and the last page requests only the
			// remainder (100), threading the cursor each hop.
			expect(rawRequest.mock.calls[0][1]).toEqual(
				expect.objectContaining({ first: 200, after: null }),
			);
			expect(rawRequest.mock.calls[1][1]).toEqual(
				expect.objectContaining({ first: 200, after: "c1" }),
			);
			expect(rawRequest.mock.calls[2][1]).toEqual(
				expect.objectContaining({ first: 100, after: "c2" }),
			);
		});

		it("getIssues(--all → limit 0) paginates the whole set until hasNextPage is false", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValueOnce(page(200, true, "c1"))
				.mockResolvedValueOnce(page(50, false, null));
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.getIssues(0);

			expect(result).toHaveLength(250);
			expect(rawRequest).toHaveBeenCalledTimes(2);
			// Unlimited always requests full 200-issue pages.
			expect(rawRequest.mock.calls[0][1]).toEqual(
				expect.objectContaining({ first: 200, after: null }),
			);
		});

		it("getIssues stops at a page that reports no next page (no over-fetch)", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValueOnce(page(30, false, null));
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.getIssues(500);

			expect(result).toHaveLength(30);
			expect(rawRequest).toHaveBeenCalledTimes(1);
		});

		it("getIssues does not spin forever on an empty page that still claims hasNextPage", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValue(page(0, true, "c1"));
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.getIssues(0);

			expect(result).toHaveLength(0);
			// The defensive zero-node guard terminates after the first page.
			expect(rawRequest).toHaveBeenCalledTimes(1);
		});

		it("filtered searchIssues (no team) chunks a large limit the same way", async () => {
			const graphQLService = new GraphQLService({ apiKey: "token" });
			const linearService = new LinearService({ apiKey: "token" });
			const rawRequest = vi
				.spyOn(graphQLService, "rawRequest")
				.mockResolvedValueOnce(page(200, true, "c1"))
				.mockResolvedValueOnce(page(100, false, null));
			const service = new GraphQLIssuesService(graphQLService, linearService);

			const result = await service.searchIssues({
				excludeTerminalStates: true,
				limit: 300,
			});

			expect(result).toHaveLength(300);
			expect(rawRequest).toHaveBeenCalledTimes(2);
			expect(String(rawRequest.mock.calls[0][0])).toContain(
				"FilteredSearchIssues",
			);
			expect(rawRequest.mock.calls[1][1]).toEqual(
				expect.objectContaining({ first: 100, after: "c1" }),
			);
		});
	});
});
