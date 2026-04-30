import { Command } from "commander";
import { vi } from "vitest";

/**
 * Create a Commander program with --api-token set, suitable for testing commands.
 * Suppresses Commander's exitOverride and output to prevent test exits.
 */
export function createTestProgram(): Command {
  const program = new Command();
  program.option("--api-token <token>", "API token");
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  return program;
}

/**
 * Parse args through a test program. Returns the captured outputSuccess calls.
 */
export async function runCommand(program: Command, args: string[]): Promise<void> {
  await program.parseAsync(["node", "linctl", "--api-token", "test-token", ...args]);
}

/**
 * Suppress process.exit from outputError in handleAsyncCommand.
 */
export function suppressExit(): void {
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
}

/**
 * Transparent handleAsyncCommand mock — lets errors propagate for testing.
 * Use inside vi.mock("../utils/output.js", ...) factories.
 */
export function passthroughHandleAsyncCommand(
  fn: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => fn(...args);
}
