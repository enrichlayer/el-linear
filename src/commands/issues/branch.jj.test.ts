import { beforeEach, describe, expect, it, vi } from "vitest";

// DEV-8479 -- the jj ladder with `jj` stubbed out. The real-binary legs in
// branch.test.ts prove the revset semantics but skip wherever jj is not
// installed (CI included); these pin what the resolver ASKS jj and how it
// reads the answers, so the trunk guard and the read-only flags are checked
// everywhere.
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
	execFileSync: mockExecFileSync,
}));

const { currentJjBookmark } = await import("./branch.js");

const SIBLING = "bookmarks() & @-::";
const GUARD = "@- & (trunk() | immutable())";

/** Answer each `jj log -r <revset>` from `answers`; an Error entry throws. */
function stubJj(answers: Record<string, string | Error>): void {
	mockExecFileSync.mockImplementation((_bin: string, args: string[]) => {
		const answer = answers[args[args.indexOf("-r") + 1]] ?? "";
		if (answer instanceof Error) {
			throw answer;
		}
		return Buffer.from(answer);
	});
}

function askedRevsets(): string[] {
	return (mockExecFileSync.mock.calls as [string, string[]][]).map(
		([, args]) => args[args.indexOf("-r") + 1],
	);
}

describe("currentJjBookmark with a stubbed jj (DEV-8479)", () => {
	beforeEach(() => {
		mockExecFileSync.mockReset();
	});

	it("reads without snapshotting and asks for bare bookmark names", () => {
		stubJj({ "@": "feature/DEV-1-x\n" });
		expect(currentJjBookmark()).toBe("feature/DEV-1-x");
		const [bin, args] = mockExecFileSync.mock.calls[0] as [string, string[]];
		expect(bin).toBe("jj");
		expect(args[0]).toBe("--ignore-working-copy");
		expect(args).toContain('local_bookmarks.map(|b| b.name()) ++ "\\n"');
	});

	it("skips the sibling rung when @'s parent is trunk or immutable", () => {
		stubJj({ [GUARD]: "abc123\n", [SIBLING]: "feature/DEV-2-unrelated\n" });
		expect(currentJjBookmark()).toBeNull();
		expect(askedRevsets()).not.toContain(SIBLING);
	});

	it("uses the sibling rung when @'s parent is mutable work", () => {
		stubJj({ [GUARD]: "", [SIBLING]: "feature/DEV-3-sibling\n" });
		expect(currentJjBookmark()).toBe("feature/DEV-3-sibling");
	});

	it("fails closed when the trunk check cannot run", () => {
		stubJj({
			[GUARD]: new Error("jj: bad revset"),
			[SIBLING]: "feature/DEV-4-x\n",
		});
		expect(currentJjBookmark()).toBeNull();
		expect(askedRevsets()).not.toContain(SIBLING);
	});

	it("passes --ignore-working-copy to every jj call", () => {
		stubJj({ [GUARD]: "", [SIBLING]: "" });
		currentJjBookmark();
		expect(mockExecFileSync).toHaveBeenCalledTimes(4);
		for (const [, args] of mockExecFileSync.mock.calls as [
			string,
			string[],
		][]) {
			expect(args[0]).toBe("--ignore-working-copy");
		}
	});
});
