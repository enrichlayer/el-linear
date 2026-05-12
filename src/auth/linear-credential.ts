/**
 * Shared credential shape consumed by the Linear-talking service classes
 * (`GraphQLService`, `LinearService`, `FileService`). Pre-DEV-4068 T7,
 * each service declared its own `*ServiceAuth` type — three byte-identical
 * unions plus a deprecated `string` arm that only tests exercised. The
 * three duplicates would inevitably drift; the single shared shape forces
 * lock-step.
 *
 * The discriminant is structural — TypeScript narrows on `"apiKey" in
 * auth` vs `"oauthToken" in auth`. An explicit `kind` tag would force
 * every call site (including ~40 tests) to thread it through; the
 * structural form keeps the existing `{ apiKey: "..." }` /
 * `{ oauthToken: "..." }` literal usage working unchanged.
 *
 * The runtime difference between the two arms is the `Authorization`
 * header shape:
 *   - apiKey:    `Authorization: <token>`        (no Bearer prefix)
 *   - oauthToken: `Authorization: Bearer <token>`
 *
 * The `string` arm was dropped — tests now construct with
 * `{ apiKey: "test-token" }` (mechanical rewrite, no semantic change).
 */
export type LinearCredential = { apiKey: string } | { oauthToken: string };
