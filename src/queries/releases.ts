export const GET_RELEASES_QUERY = `
  query GetReleases($first: Int!, $filter: ReleaseFilter) {
    releases(first: $first, filter: $filter) {
      nodes {
        id
        name
        description
        version
        url
        startDate
        targetDate
        startedAt
        completedAt
        canceledAt
        stage { id name type color }
        pipeline { id name }
        createdAt
        updatedAt
      }
    }
  }
`;

export const GET_RELEASE_BY_ID_QUERY = `
  query GetReleaseById($id: String!) {
    release(id: $id) {
      id
      name
      description
      version
      url
      startDate
      targetDate
      startedAt
      completedAt
      canceledAt
      stage { id name type color }
      pipeline { id name }
      documents {
        nodes {
          id
          title
          slugId
        }
      }
      createdAt
      updatedAt
    }
  }
`;

export const CREATE_RELEASE_MUTATION = `
  mutation CreateRelease($input: ReleaseCreateInput!) {
    releaseCreate(input: $input) {
      success
      release {
        id
        name
        description
        version
        url
        stage { id name type color }
        pipeline { id name }
        createdAt
        updatedAt
      }
    }
  }
`;

export const GET_RELEASE_PIPELINES_QUERY = `
  query GetReleasePipelines($first: Int!) {
    releasePipelines(first: $first) {
      nodes {
        id
        name
        stages {
          nodes {
            id
            name
            type
            color
          }
        }
      }
    }
  }
`;
