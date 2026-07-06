import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTestProgram,
	runCommand,
	suppressExit,
} from "../__tests__/test-helpers.js";

const mockGetUsers = vi.fn().mockResolvedValue({ users: [] });
const mockGetUser = vi.fn();
const mockService = { getUsers: mockGetUsers, getUser: mockGetUser };
const mockCreateLinearService = vi.fn().mockReturnValue(mockService);
const mockOutputSuccess = vi.fn();

vi.mock("../utils/linear-service.js", () => ({
	createLinearService: mockCreateLinearService,
}));

vi.mock("../utils/output.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../utils/output.js")>();
	return {
		...actual,
		outputSuccess: mockOutputSuccess,
	};
});

const { setupUsersCommands } = await import("./users.js");

describe("users commands", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		suppressExit();
	});

	describe("users list", () => {
		it("calls getUsers with default limit and no active filter", async () => {
			const program = createTestProgram();
			setupUsersCommands(program);
			await runCommand(program, ["users", "list"]);

			expect(mockGetUsers).toHaveBeenCalledWith(undefined, 100, undefined);
		});

		it("passes --active flag correctly", async () => {
			const program = createTestProgram();
			setupUsersCommands(program);
			await runCommand(program, ["users", "list", "--active"]);

			expect(mockGetUsers).toHaveBeenCalledWith(true, 100, undefined);
		});

		it("passes custom limit", async () => {
			const program = createTestProgram();
			setupUsersCommands(program);
			await runCommand(program, ["users", "list", "--limit", "50"]);

			expect(mockGetUsers).toHaveBeenCalledWith(undefined, 50, undefined);
		});

		it("passes --name as third arg", async () => {
			const program = createTestProgram();
			setupUsersCommands(program);
			await runCommand(program, ["users", "list", "--name", "yury"]);

			expect(mockGetUsers).toHaveBeenCalledWith(undefined, 100, "yury");
		});

		it("outputs result via outputSuccess", async () => {
			const usersData = [{ id: "u1", name: "Alice" }];
			mockGetUsers.mockResolvedValue(usersData);

			const program = createTestProgram();
			setupUsersCommands(program);
			await runCommand(program, ["users", "list"]);

			expect(mockOutputSuccess).toHaveBeenCalledWith({
				data: usersData,
				meta: { count: 1 },
			});
		});
	});

	// DEV-5612: single-user lookup, the natural complement to `users list`.
	describe("users read", () => {
		it("resolves the id and outputs the single user", async () => {
			const user = { id: "u1", displayName: "Alice", email: "a@x.com" };
			mockGetUser.mockResolvedValue(user);

			const program = createTestProgram();
			setupUsersCommands(program);
			await runCommand(program, ["users", "read", "alice@x.com"]);

			expect(mockGetUser).toHaveBeenCalledWith("alice@x.com");
			expect(mockOutputSuccess).toHaveBeenCalledWith({ data: user });
		});

		it("propagates a not-found error", async () => {
			mockGetUser.mockRejectedValue(new Error('User "nobody" not found.'));

			const program = createTestProgram();
			setupUsersCommands(program);
			await runCommand(program, ["users", "read", "nobody"]);

			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});
});
