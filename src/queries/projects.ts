export const TEAM_LOOKUP_QUERY = `
  query TeamLookup($key: String) {
    teams(filter: { or: [{ key: { eq: $key } }, { name: { eq: $key } }] }, first: 1) {
      nodes { id key name }
    }
  }
`;

export const PROJECT_BY_ID_QUERY = `
  query ProjectById($id: String!) {
    project(id: $id) {
      id
      name
      teams {
        nodes { id key name }
      }
    }
  }
`;

/**
 * Full single-project read for `el-linear projects read` (DEV-4610). Carries
 * everything the `--format summary` project renderer shows (name, state, lead,
 * teams, target, progress, url) plus the long-form `description`/`content` the
 * JSON envelope exposes — so callers no longer fall back to a raw `graphql`
 * query for a project URL or its content. The `progress` + `teams` fields also
 * make the payload self-describing to the summary kind-inference.
 */
export const PROJECT_READ_QUERY = `
  query ProjectRead($id: String!) {
    project(id: $id) {
      id
      name
      state
      progress
      url
      startDate
      targetDate
      description
      content
      lead { id name displayName }
      teams {
        nodes { id key name }
      }
    }
  }
`;

export const GET_PROJECT_QUERY = `
  query GetProject($name: String!) {
    projects(filter: { name: { eqIgnoreCase: $name } }, first: 1) {
      nodes {
        id
        name
        teams {
          nodes {
            id
            key
            name
          }
        }
      }
    }
  }
`;

export const GET_PROJECT_TEAM_ISSUES_QUERY = `
  query GetProjectTeamIssues($projectId: String!, $teamId: String!) {
    project(id: $projectId) {
      id
      name
      teams {
        nodes {
          id
          key
          name
        }
      }
      issues(filter: { team: { id: { eq: $teamId } } }, first: 50) {
        nodes {
          id
          identifier
          title
        }
      }
    }
  }
`;

export const SEARCH_PROJECTS_BY_NAME_QUERY = `
  query SearchProjectsByName($name: String!) {
    projects(filter: { name: { containsIgnoreCase: $name } }, first: 10) {
      nodes {
        id
        name
        state
        teams {
          nodes { id key name }
        }
      }
    }
  }
`;

export const CREATE_PROJECT_MUTATION = `
  mutation CreateProject($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      success
      project {
        id
        name
        state
        teams {
          nodes { id key name }
        }
      }
    }
  }
`;

export const UPDATE_PROJECT_MUTATION = `
  mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
    projectUpdate(id: $id, input: $input) {
      success
      project {
        id
        name
        teams {
          nodes {
            id
            key
            name
          }
        }
      }
    }
  }
`;

export const ARCHIVE_PROJECT_MUTATION = `
  mutation ArchiveProject($id: String!) {
    projectArchive(id: $id) {
      success
      lastSyncId
      entity {
        id
      }
    }
  }
`;

export const DELETE_PROJECT_MUTATION = `
  mutation DeleteProject($id: String!) {
    projectDelete(id: $id) {
      success
      lastSyncId
      entity {
        id
      }
    }
  }
`;
