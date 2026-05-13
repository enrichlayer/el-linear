import { describe, expect, it } from "vitest";
import { parseProjectSlugId } from "./project-slug.js";

describe("parseProjectSlugId", () => {
	describe("URL form", () => {
		it("extracts slugId from a canonical project URL", () => {
			expect(
				parseProjectSlugId(
					"https://linear.app/verticalint/project/tools-and-standardization-40815d9beb16/overview",
				),
			).toBe("tools-and-standardization-40815d9beb16");
		});

		it("accepts a URL without trailing path", () => {
			expect(
				parseProjectSlugId(
					"https://linear.app/verticalint/project/customer-api-abc123def456",
				),
			).toBe("customer-api-abc123def456");
		});

		it("accepts a URL with query string", () => {
			expect(
				parseProjectSlugId(
					"https://linear.app/verticalint/project/customer-api-abc123def456?foo=bar",
				),
			).toBe("customer-api-abc123def456");
		});

		it("accepts a URL with anchor", () => {
			expect(
				parseProjectSlugId(
					"https://linear.app/acme/project/foo-1234567890ab#section",
				),
			).toBe("foo-1234567890ab");
		});

		it("tolerates surrounding whitespace", () => {
			expect(
				parseProjectSlugId(
					"  https://linear.app/x/project/y-1234567890ab/overview  ",
				),
			).toBe("y-1234567890ab");
		});

		it("returns null when the URL path segment doesn't look like a slug-id", () => {
			expect(
				parseProjectSlugId("https://linear.app/x/project/just-a-name/overview"),
			).toBeNull();
		});

		it("returns null for an issue URL (not a project URL)", () => {
			expect(
				parseProjectSlugId("https://linear.app/verticalint/issue/DEV-1234"),
			).toBeNull();
		});
	});

	describe("bare slug-id form", () => {
		it("accepts a kebab-case slug with 12-hex suffix", () => {
			expect(parseProjectSlugId("tools-and-standardization-40815d9beb16")).toBe(
				"tools-and-standardization-40815d9beb16",
			);
		});

		it("accepts a single-segment slug with 12-hex suffix", () => {
			expect(parseProjectSlugId("foo-abc123def456")).toBe("foo-abc123def456");
		});

		it("is case-insensitive on the hex segment", () => {
			expect(parseProjectSlugId("foo-ABC123DEF456")).toBe("foo-ABC123DEF456");
		});
	});

	describe("rejects non-slug inputs", () => {
		it("returns null for a UUID", () => {
			expect(
				parseProjectSlugId("4a5b7f75-e969-4eb9-91f8-7202086b943f"),
			).toBeNull();
		});

		it("returns null for a plain project name", () => {
			expect(parseProjectSlugId("Customer API")).toBeNull();
		});

		it("returns null for an empty string", () => {
			expect(parseProjectSlugId("")).toBeNull();
		});

		it("returns null for whitespace only", () => {
			expect(parseProjectSlugId("   ")).toBeNull();
		});

		it("returns null when hex suffix is the wrong length", () => {
			expect(parseProjectSlugId("foo-abc123")).toBeNull(); // 6 chars, too short
			expect(parseProjectSlugId("foo-abc123def4567")).toBeNull(); // 13 chars
		});

		it("returns null when there is no hex suffix at all", () => {
			expect(parseProjectSlugId("just-a-kebab-name")).toBeNull();
		});
	});
});
