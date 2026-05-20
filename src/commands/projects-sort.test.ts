import { describe, expect, it } from "vitest";
import type { LinearProject } from "../types/linear.js";
import { sortActiveFirst } from "./projects.js";

// Test-only factory: every field a `LinearProject` requires except the ones
// the sort actually inspects. Keeps the test data focused on `state` and
// makes it obvious which fields participate in ordering.
function p(id: string, state: string): LinearProject {
	return {
		id,
		name: id,
		state,
		progress: 0,
		teams: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("sortActiveFirst (DEV-4175)", () => {
	it("orders active states ahead of terminal states", () => {
		const ordered = sortActiveFirst([
			p("c", "completed"),
			p("s", "started"),
			p("x", "canceled"),
			p("pl", "planned"),
		]);
		expect(ordered.map((proj) => proj.id)).toEqual(["s", "pl", "c", "x"]);
	});

	it("orders within the active set: started < planned < paused < backlog", () => {
		const ordered = sortActiveFirst([
			p("b", "backlog"),
			p("pa", "paused"),
			p("pl", "planned"),
			p("s", "started"),
		]);
		expect(ordered.map((proj) => proj.id)).toEqual(["s", "pl", "pa", "b"]);
	});

	it("is stable within a rank: preserves upstream updatedAt order", () => {
		// Inputs all have the same state ("started"), so the sort must not
		// reorder them — the upstream `updatedAt`-descending order from
		// `getProjects` is what callers see for ties.
		const input = [p("a", "started"), p("b", "started"), p("c", "started")];
		expect(sortActiveFirst(input).map((proj) => proj.id)).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("sorts unknown states to the end without throwing", () => {
		// `LinearProject.state` is typed `string`, but the SDK occasionally
		// returns values outside our enumerated set (e.g. `archived` from a
		// Linear feature flag). Those should sink to the end rather than
		// pollute the active band.
		const ordered = sortActiveFirst([
			p("u1", "archived"),
			p("s", "started"),
			p("u2", "some-future-state"),
		]);
		expect(ordered.map((proj) => proj.id)).toEqual(["s", "u1", "u2"]);
	});

	it("returns an empty array for empty input", () => {
		expect(sortActiveFirst([])).toEqual([]);
	});

	it("does not mutate the input array", () => {
		const input = [p("c", "completed"), p("s", "started")];
		const snapshot = input.map((proj) => proj.id);
		sortActiveFirst(input);
		expect(input.map((proj) => proj.id)).toEqual(snapshot);
	});
});
