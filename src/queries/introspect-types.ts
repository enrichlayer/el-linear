/**
 * Typed response shapes for `INTROSPECT_TYPE_QUERY` /
 * `INTROSPECT_ROOT_QUERY`. See `./issues-types.ts` for the
 * rationale (ALL-937).
 *
 * GraphQL introspection types are recursive (a type contains
 * fields whose types contain fields…). We model the recursion
 * shallowly — only as deep as the queries actually select.
 */

interface IntrospectTypeRefShallow {
	name: string | null;
	kind: string;
	ofType: { name: string | null } | null;
}

interface IntrospectTypeRef {
	name: string | null;
	kind: string;
	ofType: IntrospectTypeRefShallow | null;
}

interface IntrospectArg {
	name: string;
	type: IntrospectTypeRef;
}

interface IntrospectField {
	name: string;
	description: string | null;
	type: IntrospectTypeRef;
	args: IntrospectArg[];
}

interface IntrospectEnumValue {
	name: string;
	description: string | null;
}

interface IntrospectInputField {
	name: string;
	type: IntrospectTypeRef;
}

/** Mirrors the inner `__type` shape selected by `INTROSPECT_TYPE_QUERY`. */
interface IntrospectTypeNode {
	name: string;
	kind: string;
	description: string | null;
	fields: IntrospectField[] | null;
	enumValues: IntrospectEnumValue[] | null;
	inputFields: IntrospectInputField[] | null;
}

export interface IntrospectTypeResponse {
	__type: IntrospectTypeNode | null;
}

/** `INTROSPECT_ROOT_QUERY` selects only fields (with args). */
export interface IntrospectRootResponse {
	__type: {
		fields: IntrospectField[];
	} | null;
}
