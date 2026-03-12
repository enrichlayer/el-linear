export const INTROSPECT_TYPE_QUERY = `
  query ($typeName: String!) {
    __type(name: $typeName) {
      name
      kind
      description
      fields {
        name
        description
        type { name kind ofType { name kind ofType { name } } }
        args { name type { name kind ofType { name } } }
      }
      enumValues { name description }
      inputFields { name type { name kind ofType { name kind ofType { name } } } }
    }
  }
`;

export const INTROSPECT_ROOT_QUERY = `
  query {
    __type(name: "Query") {
      fields { name description args { name type { name kind ofType { name } } } }
    }
  }
`;
