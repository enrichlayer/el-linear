const PROJECT_UPDATE_FRAGMENT = `
  id
  body
  health
  url
  slugId
  createdAt
  updatedAt
  editedAt
  user {
    id
    name
    displayName
  }
  project {
    id
    name
  }
`;

export const CREATE_PROJECT_UPDATE_MUTATION = `
  mutation ProjectUpdateCreate($input: ProjectUpdateCreateInput!) {
    projectUpdateCreate(input: $input) {
      success
      projectUpdate {
        ${PROJECT_UPDATE_FRAGMENT}
      }
    }
  }
`;

export const LIST_PROJECT_UPDATES_QUERY = `
  query ListProjectUpdates($projectId: String!, $first: Int!) {
    project(id: $projectId) {
      id
      name
      projectUpdates(first: $first) {
        nodes {
          ${PROJECT_UPDATE_FRAGMENT}
        }
      }
    }
  }
`;

export const GET_PROJECT_UPDATE_BY_ID_QUERY = `
  query GetProjectUpdate($id: String!) {
    projectUpdate(id: $id) {
      ${PROJECT_UPDATE_FRAGMENT}
    }
  }
`;
