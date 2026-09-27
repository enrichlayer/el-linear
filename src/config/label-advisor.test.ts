import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type LabelAdvisorInput,
	labelAdvisorCommand,
	parseLabelAdvisorOutput,
	runLabelAdvisor,
} from "./label-advisor.js";

const INPUT: LabelAdvisorInput = {
	team: "DEV",
	project: "Tools and standardization",
	title: "Fix the thing",
	description: "## Done when\n- [ ] it works",
	labels: ["bug"],
	state: "Todo",
};

describe("labelAdvisorCommand", () => {
	it("is off when nothing is configured", () => {
		expect(labelAdvisorCommand({}, {})).toBeNull();
		expect(
			labelAdvisorCommand({ labelAdvisor: { command: [] } }, {}),
		).toBeNull();
	});

	it("reads config and lets the env override or disable it", () => {
		const config = { labelAdvisor: { command: ["rubric", "--advise"] } };
		expect(labelAdvisorCommand(config, {})).toEqual(["rubric", "--advise"]);
		expect(
			labelAdvisorCommand(config, { EL_LINEAR_LABEL_ADVISOR: "other --json" }),
		).toEqual(["other", "--json"]);
		expect(
			labelAdvisorCommand(config, { EL_LINEAR_LABEL_ADVISOR: "  " }),
		).toBeNull();
	});
});

describe("parseLabelAdvisorOutput", () => {
	it.each([
		["bare array", '["bot"]', ["bot"], null],
		[
			"object",
			'{"labels":["bot"],"reason":"rubric: BOT"}',
			["bot"],
			"rubric: BOT",
		],
		["envelope", '{"data":{"labels":["bot"]},"meta":{}}', ["bot"], null],
		["empty advice", '{"labels":[]}', [], null],
		["dedupe", '["bot","Bot"]', ["bot"], null],
	])("accepts %s", (_name, stdout, labels, reason) => {
		expect(parseLabelAdvisorOutput(stdout)).toEqual({
			ok: true,
			labels,
			reason,
			receipt: null,
		});
	});

	it("accepts receipt policy fields next to a consent label (DEV-10455)", () => {
		expect(
			parseLabelAdvisorOutput(
				JSON.stringify({
					labels: ["bot"],
					reason: "rubric: BOT",
					receipt: { repo: " acme/tools ", reason: "rubric consent" },
				}),
			),
		).toEqual({
			ok: true,
			labels: ["bot"],
			reason: "rubric: BOT",
			receipt: { repo: "acme/tools", reason: "rubric consent" },
		});
	});

	it.each([
		["empty output", ""],
		["non-JSON", "bot"],
		["missing labels", '{"reason":"x"}'],
		["non-string label", "[1]"],
		["empty label", '[""]'],
		["comma label", '["bot,urgent"]'],
		["control characters", '["bot\\n"]'],
		["non-string reason", '{"labels":["bot"],"reason":5}'],
		["scalar", "true"],
		["non-object receipt", '{"labels":["bot"],"receipt":"acme/tools"}'],
		["receipt without repo", '{"labels":["bot"],"receipt":{"reason":"x"}}'],
		["receipt without reason", '{"labels":["bot"],"receipt":{"repo":"a/b"}}'],
		[
			"receipt repo with control characters",
			'{"labels":["bot"],"receipt":{"repo":"a/b\\n","reason":"x"}}',
		],
	])("fails closed on %s", (_name, stdout) => {
		const result = parseLabelAdvisorOutput(stdout);
		expect(result.ok).toBe(false);
	});
});

describe("runLabelAdvisor (real subprocess)", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "el-linear-advisor-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function script(body: string): string[] {
		const path = join(dir, "advisor.mjs");
		writeFileSync(path, body);
		return [process.execPath, path];
	}

	it("returns null when unconfigured", () => {
		expect(runLabelAdvisor(INPUT, {}, {})).toBeNull();
	});

	it("passes the proposed issue as JSON on stdin and parses the answer", () => {
		const seen = join(dir, "stdin.json");
		const command = script(`
			import { readFileSync, writeFileSync } from "node:fs";
			const input = readFileSync(0, "utf8");
			writeFileSync(${JSON.stringify(seen)}, input);
			process.stdout.write(JSON.stringify({ labels: ["bot"], reason: "rubric: BOT" }));
		`);
		const result = runLabelAdvisor(INPUT, { labelAdvisor: { command } }, {});
		expect(result).toEqual({
			ok: true,
			labels: ["bot"],
			reason: "rubric: BOT",
			receipt: null,
		});
		expect(JSON.parse(readFileSync(seen, "utf8"))).toEqual(INPUT);
	});

	it("does not hand the advisor Linear's token", () => {
		const command = script(
			`process.stdout.write(JSON.stringify(process.env.LINEAR_API_TOKEN ? ["leak"] : []));`,
		);
		const result = runLabelAdvisor(
			INPUT,
			{ labelAdvisor: { command } },
			{ ...process.env, LINEAR_API_TOKEN: "lin_api_test" },
		);
		expect(result).toEqual({
			ok: true,
			labels: [],
			reason: null,
			receipt: null,
		});
	});

	it("fails on a non-zero exit even when it printed labels", () => {
		const command = script(
			`process.stdout.write('["bot"]'); process.stderr.write("boom\\n"); process.exit(3);`,
		);
		const result = runLabelAdvisor(INPUT, { labelAdvisor: { command } }, {});
		expect(result).toMatchObject({ ok: false });
		expect(result && !result.ok && result.error).toContain("exited 3: boom");
	});

	it("fails on a timeout", () => {
		const command = script(
			`process.stdout.write('["bot"]'); setTimeout(() => {}, 10000);`,
		);
		const result = runLabelAdvisor(
			INPUT,
			{ labelAdvisor: { command, timeoutMs: 200 } },
			{},
		);
		expect(result).toMatchObject({ ok: false });
	});

	it("fails on a missing binary", () => {
		const result = runLabelAdvisor(
			INPUT,
			{ labelAdvisor: { command: [join(dir, "does-not-exist")] } },
			{},
		);
		expect(result).toMatchObject({ ok: false });
	});
});
