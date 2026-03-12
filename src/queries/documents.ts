const DOCUMENT_FRAGMENT = `
  id
  title
  content
  slugId
  url
  icon
  color
  createdAt
  updatedAt
  creator {
    id
    name
  }
  project {
    id
    name
  }
  issue {
    id
    identifier
    title
  }
`;

export const CREATE_DOCUMENT_MUTATION = `
  mutation DocumentCreate($input: DocumentCreateInput!) {
    documentCreate(input: $input) {
      success
      document {
        ${DOCUMENT_FRAGMENT}
      }
    }
  }
`;

export const UPDATE_DOCUMENT_MUTATION = `
  mutation DocumentUpdate($id: String!, $input: DocumentUpdateInput!) {
    documentUpdate(id: $id, input: $input) {
      success
      document {
        ${DOCUMENT_FRAGMENT}
      }
    }
  }
`;

export const GET_DOCUMENT_QUERY = `
  query GetDocument($id: String!) {
    document(id: $id) {
      ${DOCUMENT_FRAGMENT}
    }
  }
`;

export const LIST_DOCUMENTS_QUERY = `
  query ListDocuments($first: Int!, $filter: DocumentFilter) {
    documents(first: $first, filter: $filter) {
      nodes {
        ${DOCUMENT_FRAGMENT}
      }
    }
  }
`;

export const DELETE_DOCUMENT_MUTATION = `
  mutation DocumentDelete($id: String!) {
    documentDelete(id: $id) {
      success
    }
  }
`;
