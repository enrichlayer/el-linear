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

export const TEMPLATE_CREATE_MUTATION = `
  mutation ($input: TemplateCreateInput!) {
    templateCreate(input: $input) {
      success
      lastSyncId
      template {
        id
        name
        type
        description
        templateData
        team { id key name }
        createdAt
        updatedAt
      }
    }
  }
`;

export const TEMPLATE_UPDATE_MUTATION = `
  mutation ($id: String!, $input: TemplateUpdateInput!) {
    templateUpdate(id: $id, input: $input) {
      success
      lastSyncId
      template {
        id
        name
        type
        description
        templateData
        team { id key name }
        updatedAt
      }
    }
  }
`;

export const TEMPLATE_DELETE_MUTATION = `
  mutation ($id: String!) {
    templateDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;
