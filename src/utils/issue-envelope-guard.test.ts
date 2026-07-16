import { describe, expect, it } from "vitest";
import {
	assertNotIssueEnvelope,
	detectIssueEnvelope,
} from "./issue-envelope-guard.js";

/** The shape `issues get --format json` emits, trimmed to the signature keys. */
const ENVELOPE = JSON.stringify({
	id: "uuid-1",
	identifier: "DEV-6092",
	url: "https://linear.app/verticalint/issue/DEV-6092/",
	title: "Some issue",
	description: "## Real body\n\nthe markdown that is about to be destroyed",
	branchName: "dev-6092-some-issue",
	state: { name: "Todo", type: "unstarted" },
});

describe("detectIssueEnvelope", () => {
	it("detects a get --format json envelope", () => {
		const match = detectIssueEnvelope(ENVELOPE);
		expect(match).not.toBeNull();
		expect(match?.identifier).toBe("DEV-6092");
		expect(match?.nested).toBe(false);
	});

	it("flags a doubly-nested (re-corrupted) envelope", () => {
		const nested = JSON.stringify({
			id: "uuid-1",
			identifier: "DEV-6042",
			branchName: "dev-6042",
			state: { name: "Todo" },
			// description is itself a stringified envelope — the recurrence shape
			description: ENVELOPE,
		});
		const match = detectIssueEnvelope(nested);
		expect(match?.identifier).toBe("DEV-6042");
		expect(match?.nested).toBe(true);
	});

	it("returns null for ordinary markdown", () => {
		expect(
			detectIssueEnvelope("## Heading\n\nSome prose about DEV-1."),
		).toBeNull();
		expect(detectIssueEnvelope("")).toBeNull();
		expect(detectIssueEnvelope("Just a sentence.")).toBeNull();
	});

	it("returns null for JSON that is not an issue envelope", () => {
		// A body that happens to be JSON but carries no issue signature.
		expect(detectIssueEnvelope('{"foo": "bar", "count": 3}')).toBeNull();
		// An object with identifier but NO issue-only sibling key — not an envelope.
		expect(detectIssueEnvelope('{"identifier": "DEV-1"}')).toBeNull();
		// Arrays and primitives.
		expect(detectIssueEnvelope("[1, 2, 3]")).toBeNull();
		expect(detectIssueEnvelope('"a string"')).toBeNull();
	});

	it("tolerates leading/trailing whitespace around the envelope", () => {
		expect(detectIssueEnvelope(`\n\n  ${ENVELOPE}\n`)?.identifier).toBe(
			"DEV-6092",
		);
	});
});

describe("assertNotIssueEnvelope", () => {
	it("throws on an envelope body", () => {
		expect(() => assertNotIssueEnvelope(ENVELOPE)).toThrow(/JSON envelope/i);
	});

	it("names the self-overwrite case when the identifier matches the target", () => {
		expect(() =>
			assertNotIssueEnvelope(ENVELOPE, { targetIdentifier: "dev-6092" }),
		).toThrow(/own envelope/i);
	});

	it("does not throw when the override is set", () => {
		expect(() =>
			assertNotIssueEnvelope(ENVELOPE, { allow: true }),
		).not.toThrow();
	});

	it("does not throw for a normal body or undefined", () => {
		expect(() => assertNotIssueEnvelope("## Real body")).not.toThrow();
		expect(() => assertNotIssueEnvelope(undefined)).not.toThrow();
	});
});
