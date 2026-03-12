export const TEMPLATES_LIST_QUERY = `
  query {
    templates {
      id
      name
      type
      description
      templateData
      createdAt
      updatedAt
      team { id key name }
      creator { id name }
    }
  }
`;

export const TEMPLATE_BY_ID_QUERY = `
  query ($id: String!) {
    template(id: $id) {
      id
      name
      type
      description
      templateData
      createdAt
      updatedAt
      team { id key name }
      creator { id name }
    }
  }
`;
