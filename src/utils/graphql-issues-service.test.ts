import { describe, expect, it, vi } from "vitest";

vi.mock("@linear/sdk", () => ({
	LinearClient: class MockLinearClient {
		client = { rawRequest: vi.fn() };
	},
}));

const { GraphQLIssuesService } = await import("./graphql-issues-service.js");
const { GraphQLService } = await import("./graphql-service.js");
const { LinearService } = await import("./linear-service.js");

function createService() {
	const graphQLService = new GraphQLService({ apiKey: "token" });
	const linearService = new LinearService({ apiKey: "token" });
	return new GraphQLIssuesService(graphQLService, linearService);
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
			const result = service.transformIssueData({
				id: "issue-1",
				identifier: "DEV-100",
				url: "https://linear.app/acme/issue/DEV-100/test-issue",
				title: "Test Issue",
				priority: 2,
				labels: { nodes: [] },
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-02T00:00:00.000Z",
			});

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

		it("transforms issue with state, assignee, and team", () => {
			const service = createService();
			const result = service.transformIssueData({
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
			});

			expect(result.state).toEqual({ id: "state-1", name: "In Progress" });
			expect(result.assignee).toEqual({ id: "user-1", name: "Alice" });
			expect(result.team).toEqual({ id: "team-1", key: "DEV", name: "Dev" });
		});

		it("transforms issue delegate", () => {
			const service = createService();
			const result = service.transformIssueData({
				id: "issue-1",
				identifier: "DEV-100",
				title: "Test",
				priority: 1,
				delegate: { id: "agent-1", name: "Claude" },
				labels: { nodes: [] },
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			});

			expect(result.delegate).toEqual({ id: "agent-1", name: "Claude" });
		});

		it("transforms labels", () => {
			const service = createService();
			const result = service.transformIssueData({
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
			});

			expect(result.labels).toEqual([
				{ id: "label-1", name: "bug" },
				{ id: "label-2", name: "feature" },
			]);
		});

		it("transforms project, cycle, and milestone refs", () => {
			const service = createService();
			const result = service.transformIssueData({
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
			});

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
			const result = service.transformIssueData({
				id: "issue-1",
				identifier: "DEV-100",
				title: "Test",
				priority: 0,
				parent: { id: "parent-1", identifier: "DEV-50", title: "Parent" },
				children: {
					nodes: [{ id: "child-1", identifier: "DEV-101", title: "Sub-task" }],
				},
				labels: { nodes: [] },
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			});

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
			const result = service.transformIssueData({
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
			});

			expect(result.comments).toHaveLength(1);
			expect(result.comments![0].body).toBe("Looks good");
			expect(result.comments![0].user).toEqual({ id: "user-1", name: "Bob" });
		});

		it("extracts summary from completed generation", () => {
			const service = createService();
			const result = service.transformIssueData({
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
			});

			expect(result.summary).toBe("This issue addresses a bug fix.");
		});

		it("returns undefined summary when generation not completed", () => {
			const service = createService();
			const result = service.transformIssueData({
				id: "issue-1",
				identifier: "DEV-100",
				title: "Test",
				priority: 0,
				summary: { generationStatus: "pending" },
				labels: { nodes: [] },
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			});

			expect(result.summary).toBeUndefined();
		});
	});
});
