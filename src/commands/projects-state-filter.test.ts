import { describe, expect, it } from "vitest";
import { resolveProjectStateFilter } from "./projects.js";

describe("resolveProjectStateFilter", () => {
	it("returns empty when no state flags are passed", () => {
		expect(resolveProjectStateFilter({})).toEqual({});
	});

	it("--active expands to excludeStates [completed, canceled]", () => {
		expect(resolveProjectStateFilter({ active: true })).toEqual({
			excludeStates: ["completed", "canceled"],
		});
	});

	it("--state parses comma-separated states case-insensitively", () => {
		expect(resolveProjectStateFilter({ state: "Started, Planned" })).toEqual({
			states: ["started", "planned"],
		});
	});

	it("--exclude-state parses comma-separated states", () => {
		expect(
			resolveProjectStateFilter({ excludeState: "completed,canceled" }),
		).toEqual({
			excludeStates: ["completed", "canceled"],
		});
	});

	it("rejects unknown state values", () => {
		expect(() => resolveProjectStateFilter({ state: "active" })).toThrow(
			/Invalid state "active"/,
		);
		expect(() =>
			resolveProjectStateFilter({ excludeState: "in-progress" }),
		).toThrow(/Invalid state "in-progress"/);
	});

	it("rejects combinations of --state, --exclude-state, --active", () => {
		expect(() =>
			resolveProjectStateFilter({
				state: "started",
				excludeState: "completed",
			}),
		).toThrow(/mutually exclusive/);
		expect(() =>
			resolveProjectStateFilter({ state: "started", active: true }),
		).toThrow(/mutually exclusive/);
		expect(() =>
			resolveProjectStateFilter({ excludeState: "completed", active: true }),
		).toThrow(/mutually exclusive/);
	});
});
