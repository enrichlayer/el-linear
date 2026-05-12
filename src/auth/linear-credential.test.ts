import { describe, expectTypeOf, it } from "vitest";
import type { LinearCredential } from "./linear-credential.js";

describe("LinearCredential discriminated union (DEV-4068 T7)", () => {
	it("accepts apiKey arm and oauthToken arm", () => {
		const a: LinearCredential = { apiKey: "lin_api_test" };
		const b: LinearCredential = { oauthToken: "lin_oauth_test" };
		void a;
		void b;
	});

	it("structurally narrows on which key is present", () => {
		const auth = {} as LinearCredential;
		if ("oauthToken" in auth) {
			// Inside the oauth arm, `oauthToken` is required string.
			expectTypeOf(auth.oauthToken).toEqualTypeOf<string>();
			// @ts-expect-error -- apiKey is not on the oauthToken arm
			void auth.apiKey;
		} else {
			// Inside the apiKey arm, `apiKey` is required string.
			expectTypeOf(auth.apiKey).toEqualTypeOf<string>();
			// @ts-expect-error -- oauthToken is not on the apiKey arm
			void auth.oauthToken;
		}
	});

	it("rejects the dropped bare-string legacy arm", () => {
		// @ts-expect-error -- bare string is no longer a valid credential
		const bad: LinearCredential = "lin_api_test";
		void bad;
	});

	it("rejects an empty object (must include exactly one key)", () => {
		// @ts-expect-error -- {} missing apiKey AND oauthToken
		const bad: LinearCredential = {};
		void bad;
	});
});
