import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outputUsageInfo } from "./usage.js";

describe("outputUsageInfo", () => {
	beforeEach(() => {
		vi.spyOn(process.stdout, "write").mockReturnValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("collects and outputs leaf subcommands", () => {
		const program = new Command("cli");
		const group = program.command("issues").description("Issue commands");
		group.command("list").description("List issues");
		group.command("read").description("Read an issue");

		const outputHelpCalls: string[] = [];
		for (const cmd of group.commands) {
			vi.spyOn(cmd, "outputHelp").mockImplementation(() => {
				outputHelpCalls.push(cmd.name());
			});
		}

		outputUsageInfo(program);
		expect(outputHelpCalls).toEqual(["list", "read"]);
	});

	it("sorts subcommands alphabetically by full path", () => {
		const program = new Command("cli");
		const zGroup = program.command("zzz").description("Z group");
		zGroup.command("alpha").description("A");
		const aGroup = program.command("aaa").description("A group");
		aGroup.command("beta").description("B");

		const outputOrder: string[] = [];
		for (const group of [zGroup, aGroup]) {
			for (const cmd of group.commands) {
				vi.spyOn(cmd, "outputHelp").mockImplementation(() => {
					outputOrder.push(`${group.name()} ${cmd.name()}`);
				});
			}
		}

		outputUsageInfo(program);
		expect(outputOrder).toEqual(["aaa beta", "zzz alpha"]);
	});

	it("includes leaf commands at any nesting depth", () => {
		const program = new Command("cli");
		program.command("version").description("Show version");
		const group = program.command("issues").description("Issues");
		group.command("list").description("List issues");

		const outputOrder: string[] = [];
		for (const cmd of program.commands) {
			if (cmd.commands.length === 0) {
				vi.spyOn(cmd, "outputHelp").mockImplementation(() => {
					outputOrder.push(cmd.name());
				});
			}
			for (const sub of cmd.commands) {
				vi.spyOn(sub, "outputHelp").mockImplementation(() => {
					outputOrder.push(sub.name());
				});
			}
		}

		outputUsageInfo(program);
		expect(outputOrder).toEqual(["list", "version"]);
	});
});
