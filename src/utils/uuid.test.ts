import { describe, expect, it } from "vitest";
import { isUuid, isUuidPrefix } from "./uuid.js";

describe("isUuid", () => {
	it("returns true for valid lowercase UUID", () => {
		expect(isUuid("4b6bb89a-9348-4ab7-9e01-581040273998")).toBe(true);
	});

	it("returns true for valid uppercase UUID", () => {
		expect(isUuid("4B6BB89A-9348-4AB7-9E01-581040273998")).toBe(true);
	});

	it("returns true for mixed-case UUID", () => {
		expect(isUuid("4b6Bb89a-9348-4Ab7-9e01-581040273998")).toBe(true);
	});

	it("returns false for issue identifier", () => {
		expect(isUuid("DEV-123")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isUuid("")).toBe(false);
	});

	it("returns false for UUID without dashes", () => {
		expect(isUuid("4b6bb89a93484ab79e01581040273998")).toBe(false);
	});

	it("returns false for UUID with extra characters", () => {
		expect(isUuid("4b6bb89a-9348-4ab7-9e01-581040273998x")).toBe(false);
	});
});

describe("isUuidPrefix", () => {
	it("returns true for 8-char hex string", () => {
		expect(isUuidPrefix("2acf31b1")).toBe(true);
		expect(isUuidPrefix("F43F50EA")).toBe(true);
	});

	it("returns false for full UUID", () => {
		expect(isUuidPrefix("4b6bb89a-9348-4ab7-9e01-581040273998")).toBe(false);
	});

	it("returns false for label names", () => {
		expect(isUuidPrefix("frontend")).toBe(false);
		expect(isUuidPrefix("tech-debt")).toBe(false);
		expect(isUuidPrefix("css")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isUuidPrefix("")).toBe(false);
	});
});
