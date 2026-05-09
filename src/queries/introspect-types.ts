/**
 * Typed response shapes for `INTROSPECT_TYPE_QUERY` /
 * `INTROSPECT_ROOT_QUERY`. See `./issues-types.ts` for the
 * rationale (ALL-937).
 *
 * GraphQL introspection types are recursive (a type contains
 * fields whose types contain fields…). We model the recursion
 * shallowly — only as deep as the queries actually select.
 */

export interface IntrospectTypeRefShallow {
	name: string | null;
	kind: string;
	ofType: { name: string | null } | null;
}

export interface IntrospectTypeRef {
	name: string | null;
	kind: string;
	ofType: IntrospectTypeRefShallow | null;
}

export interface IntrospectArg {
	name: string;
	type: IntrospectTypeRef;
}

export interface IntrospectField {
	name: string;
	description: string | null;
	type: IntrospectTypeRef;
	args: IntrospectArg[];
}

export interface IntrospectEnumValue {
	name: string;
	description: string | null;
}

export interface IntrospectInputField {
	name: string;
	type: IntrospectTypeRef;
}

/** Mirrors the inner `__type` shape selected by `INTROSPECT_TYPE_QUERY`. */
export interface IntrospectTypeNode {
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
