/**
 * `issues read --with` parser (DEV-4476).
 *
 * Opt-in includes for `issues read`. Each value names an additional block
 * of data to fetch alongside the base issue and inject into the JSON
 * envelope. Comma-separated; whitespace tolerated; unknown values rejected
 * with a structured error naming the candidates (deterministic-CLI
 * doctrine — fail fast in the CLI, not in the consumer's script).
 *
 * Currently supported:
 *   - `relations` — fetches `Issue.relations` + `Issue.inverseRelations`
 *                   and adds a `relations` array to the envelope.
 *
 * Reserved for future MRs (the value space is a closed set so adding more
 * later is back-compat):
 *   - `children`  — refetch with expanded sub-issue fragment (state,
 *                   assignee, priority — beyond the default id/identifier/
 *                   title trio that's already in the envelope).
 *   - `comments`  — no-op for fetching (comments are already in the
 *                   default envelope via `_WITH_COMMENTS` fragment) but
 *                   would gate explicit summary-format rendering.
 *
 * Doctrine note: comments are intentionally NOT included today because
 * adding `--with comments` would imply that comments are *off* by default,
 * which would be a breaking JSON-shape change.
 */

export const WITH_INCLUDE_VALUES = ["relations"] as const;
export type WithInclude = (typeof WITH_INCLUDE_VALUES)[number];

export interface ParsedWithIncludes {
	relations: boolean;
}

/**
 * Parse a `--with <names>` argument. Returns a flag object so call sites
 * read `if (includes.relations)` instead of `Set.has("relations")`.
 *
 * Empty / whitespace-only values are caller errors (commander allows
 * `--with ""` through) — reject with the same message as unknown values
 * so the user gets one consistent failure mode.
 */
export function parseWithIncludes(raw: string): ParsedWithIncludes {
	const names = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	if (names.length === 0) {
		throw new Error(
			`--with requires at least one include name. Supported: ${WITH_INCLUDE_VALUES.join(", ")}`,
		);
	}
	const includes: ParsedWithIncludes = { relations: false };
	for (const name of names) {
		if (!(WITH_INCLUDE_VALUES as readonly string[]).includes(name)) {
			throw new Error(
				`--with: unknown include "${name}". Supported: ${WITH_INCLUDE_VALUES.join(", ")}`,
			);
		}
		// Narrowing: only assignable members of ParsedWithIncludes.
		if (name === "relations") {
			includes.relations = true;
		}
	}
	return includes;
}
