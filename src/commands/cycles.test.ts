import type { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockGetCycles = vi.fn();
const mockResolveCycleId = vi.fn();
const mockGetCycleById = vi.fn();
const mockService = {
	getCycles: mockGetCycles,
	resolveCycleId: mockResolveCycleId,
	getCycleById: mockGetCycleById,
};
const mockCreateLinearService = vi.fn().mockReturnValue(mockService);
const mockOutputSuccess = vi.fn();
const mockResolveTeam = vi.fn().mockImplementation((v: string) => v);

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: mockCreateLinearService,
}));

vi.mock("../utils/output.js", async () => ({
	handleAsyncCommand: (await import("../__tests__/test-helpers.js"))
		.passthroughHandleAsyncCommand,
	outputSuccess: mockOutputSuccess,
}));

vi.mock("../config/resolver.js", () => ({
	resolveTeam: mockResolveTeam,
}));

vi.mock("../utils/error-messages.js", () => ({
	requiresParameterError: (param: string, requires: string) =>
		new Error(`${param} requires ${requires}`),
	invalidParameterError: (param: string, msg: string) =>
		new Error(`${param}: ${msg}`),
	notFoundError: (entity: string, value: string, ctx: string) =>
		new Error(`${entity} not found ${ctx} "${value}"`),
}));

const { setupCyclesCommands } = await import("./cycles.js");

describe("cycles", () => {
	let program: Command;

	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveTeam.mockImplementation((v: string) => v);
		program = createTestProgram();
		setupCyclesCommands(program);
	});

	describe("list", () => {
		it("calls getCycles with default limit", async () => {
			mockGetCycles.mockResolvedValue([]);
			await runCommand(program, ["cycles", "list"]);
			expect(mockGetCycles).toHaveBeenCalledWith(undefined, undefined, 50);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [],
				meta: { count: 0 },
			});
		});

		it("passes --team through resolveTeam", async () => {
			mockResolveTeam.mockReturnValue("team-uuid-123");
			mockGetCycles.mockResolvedValue([]);
			await runCommand(program, ["cycles", "list", "--team", "ENG"]);
			expect(mockResolveTeam).toHaveBeenCalledWith("ENG");
			expect(mockGetCycles).toHaveBeenCalledWith(
				"team-uuid-123",
				undefined,
				50,
			);
		});

		it("passes --active flag", async () => {
			mockGetCycles.mockResolvedValue([]);
			await runCommand(program, ["cycles", "list", "--active"]);
			expect(mockGetCycles).toHaveBeenCalledWith(undefined, true, 50);
		});

		it("--around-active without --team throws", async () => {
			suppressExit();
			await expect(
				runCommand(program, ["cycles", "list", "--around-active", "2"]),
			).rejects.toThrow("--around-active requires --team");
		});

		it("--around-active filters cycles around active", async () => {
			const cycles = [
				{ number: 1, isActive: false },
				{ number: 2, isActive: false },
				{ number: 3, isActive: true },
				{ number: 4, isActive: false },
				{ number: 5, isActive: false },
				{ number: 6, isActive: false },
			];
			mockGetCycles.mockResolvedValue(cycles);
			await runCommand(program, [
				"cycles",
				"list",
				"--team",
				"ENG",
				"--around-active",
				"1",
			]);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: [
					{ number: 2, isActive: false },
					{ number: 3, isActive: true },
					{ number: 4, isActive: false },
				],
				meta: { count: 3 },
			});
		});
	});

	describe("read", () => {
		it("resolves cycle ID and calls getCycleById", async () => {
			mockResolveCycleId.mockResolvedValue("cycle-uuid-abc");
			mockGetCycleById.mockResolvedValue({
				id: "cycle-uuid-abc",
				name: "Cycle 5",
			});
			await runCommand(program, ["cycles", "read", "Cycle 5"]);
			expect(mockResolveCycleId).toHaveBeenCalledWith("Cycle 5", undefined);
			expect(mockGetCycleById).toHaveBeenCalledWith("cycle-uuid-abc", 50);
			expect(mockOutputSuccess).toHaveBeenCalledWith({
				id: "cycle-uuid-abc",
				name: "Cycle 5",
			});
		});
	});
});
