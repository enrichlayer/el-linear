const PROJECT_FIELDS = `
  id
  name
  description
  state
  progress
  targetDate
  createdAt
  updatedAt
  lead { id name }
  teams { nodes { id key name } }
`;

/**
 * Fetch project summaries, embedded teams, and lead in one paginated request.
 * The conditional team branch replaces SDK relation follow-ups and keeps both
 * request count and GraphQL complexity visible at one catalog boundary.
 */
export const GET_PROJECTS_CATALOG_QUERY = `
  query GetProjectsCatalog(
    $filter: ProjectFilter
		$teamId: String!
		$teamScoped: Boolean!
    $first: Int!
    $after: String
  ) {
    projects(filter: $filter, first: $first, after: $after, orderBy: updatedAt, includeArchived: false) @skip(if: $teamScoped) {
      nodes { ${PROJECT_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
    team(id: $teamId) @include(if: $teamScoped) {
      projects(filter: $filter, first: $first, after: $after, orderBy: updatedAt, includeArchived: false) {
        nodes { ${PROJECT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/** Batch label metadata and parent/team relations into one bounded catalog read. */
export const GET_LABELS_CATALOG_QUERY = `
  query GetLabelsCatalog($filter: IssueLabelFilter, $first: Int!) {
    issueLabels(filter: $filter, first: $first) {
      nodes {
        id
        name
        color
        isGroup
        parent { id name }
        team { id key name }
      }
    }
  }
`;

/** Batch cycle summaries and their team relation instead of resolving each edge. */
export const GET_CYCLES_CATALOG_QUERY = `
  query GetCyclesCatalog($filter: CycleFilter, $first: Int!) {
    cycles(filter: $filter, first: $first, orderBy: createdAt) {
      nodes {
        id
        name
        number
        startsAt
        endsAt
        isActive
        isPrevious
        isNext
        progress
        issueCountHistory
        team { id key name }
      }
    }
  }
`;

/**
 * Read one cycle and its bounded issue catalog in a single query, avoiding the
 * SDK's per-issue relation fan-out while keeping the issue page size explicit.
 */
export const GET_CYCLE_DETAIL_QUERY = `
  query GetCycleDetail($id: String!, $issuesFirst: Int!) {
    cycle(id: $id) {
      id
      name
      number
      startsAt
      endsAt
      isActive
      isPrevious
      isNext
      progress
      issueCountHistory
      team { id key name }
      issues(first: $issuesFirst) {
        nodes {
          id
          identifier
          url
          title
          description
          priority
          estimate
          createdAt
          updatedAt
          state { id name }
          assignee { id name }
          team { id key name }
          project { id name }
          labels { nodes { id name } }
        }
      }
    }
  }
`;

/**
 * Resolve a project name/slug with one bounded query. The conditional team
 * branch performs scoping server-side without a separate project catalog read.
 */
export const RESOLVE_PROJECT_QUERY = `
  query ResolveProjectCatalog(
    $filter: ProjectFilter!
		$teamId: String!
		$teamScoped: Boolean!
    $includeArchived: Boolean!
  ) {
    projects(filter: $filter, first: 5, includeArchived: $includeArchived) @skip(if: $teamScoped) {
      nodes {
        id
        name
        teams { nodes { id key name } }
      }
    }
    team(id: $teamId) @include(if: $teamScoped) {
      projects(filter: $filter, first: 5, includeArchived: $includeArchived) {
        nodes {
          id
          name
          teams { nodes { id key name } }
        }
      }
    }
  }
`;
