/**
 * Read an error's `cause` chain as text (DEV-14754).
 *
 * WHY THIS EXISTS. `Error` chains are how TypeScript code says "command X
 * failed because of Y" — `new Error(msg, { cause })` has been standard since
 * ES2022, and every wrapper in this CLI that adds context ("creating issue
 * failed", "refreshing the token failed") does exactly that. The error
 * envelope used to publish only `error.message`, so the moment any layer
 * re-worded a failure, the reason the command actually failed was gone: a
 * schema refusal and a rate limit became byte-identical strings on the one
 * surface a shell-out caller parses.
 *
 * Kept structural (no `instanceof Error`) for the same reason
 * `readGraphQLErrorDetail` is: an error that crossed a module-instance
 * boundary — a duplicated dependency copy, a test mock — is still an error.
 *
 * Length is deliberately not bounded here. The envelope's emitters bound what
 * they print, and a second cap at a different threshold would truncate the
 * same string twice; `MAX_CHAIN_DEPTH` bounds the walk itself.
 */

/** How far a chain is followed. Wrappers nest shallowly; a longer chain is a loop. */
const MAX_CHAIN_DEPTH = 4;

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * The text for one link.
 *
 * Errors and error-shaped objects both carry `message`; a serialized failure
 * (a JSON envelope, a rehydrated Temporal failure) is a plain object, which
 * `instanceof Error` would reduce to `[object Object]`.
 */
function messageOf(value: unknown): string {
	if (isObjectLike(value)) {
		const message = value.message;
		if (typeof message === "string") {
			return message;
		}
	}
	return value instanceof Error ? value.message : String(value);
}

/**
 * The links of a chain, outermost first, starting with `value` itself.
 *
 * Stops at the first link without a `cause`, on a repeated link (identity), or
 * at `MAX_CHAIN_DEPTH`: a `cause` can point back into its own chain, and the
 * error path must terminate rather than recurse.
 */
export function errorChain(value: unknown): unknown[] {
	const links: unknown[] = [];
	const seen = new Set<unknown>();
	let current: unknown = value;
	while (current !== undefined && current !== null) {
		links.push(current);
		// A cycle can only be built out of object identities; primitives are
		// compared structurally by Set anyway.
		if (seen.has(current)) {
			links.pop();
			break;
		}
		seen.add(current);
		if (links.length >= MAX_CHAIN_DEPTH || !isObjectLike(current)) {
			break;
		}
		current = current.cause;
	}
	return links;
}

/**
 * A chain rendered as one line: segments joined with `: `, blanks dropped, and
 * a segment already visible in an earlier one removed.
 *
 * The comparison is containment rather than equality because composing a
 * wrapper's message out of the inner one is the normal way to add context
 * (`GraphQL request failed: ${err.message}\`) — the inner text is then already
 * on the line, and printing it twice only makes the reason harder to find. So
 * a chain of `fetch failed` → `connect ECONNREFUSED …` under a message that
 * already ends in `fetch failed` renders the one detail that is new.
 *
 * `alreadyVisible` is the text the caller prints beside the chain — the outer
 * `error` message — so a segment that appears there is not repeated either.
 *
 * Returns `""` for an absent or empty chain, so a caller can decide by truth
 * rather than by shape.
 */
export function errorChainMessage(
	value: unknown,
	alreadyVisible?: string,
): string {
	const segments: string[] = [];
	const visible = alreadyVisible ? [alreadyVisible] : [];
	for (const link of errorChain(value)) {
		const segment = messageOf(link).trim();
		if (segment === "" || visible.some((seen) => seen.includes(segment))) {
			continue;
		}
		segments.push(segment);
		visible.push(segment);
	}
	return segments.join(": ");
}
