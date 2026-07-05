import {
	COMPLETE_ISSUE_FRAGMENT,
	COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT,
} from "./common.js";

export const GET_ISSUES_QUERY = `
  query GetIssues($first: Int!, $orderBy: PaginationOrderBy) {
    issues(
      first: $first
      orderBy: $orderBy
      filter: {
        state: { type: { neq: "completed" } }
      }
    ) {
      nodes {
        ${COMPLETE_ISSUE_FRAGMENT}
      }
    }
  }
`;

export const SEARCH_ISSUES_QUERY = `
  query SearchIssues($term: String!, $first: Int!) {
    searchIssues(term: $term, first: $first, includeArchived: false) {
      nodes {
        ${COMPLETE_ISSUE_FRAGMENT}
      }
    }
  }
`;

export const FILTERED_SEARCH_ISSUES_QUERY = `
  query FilteredSearchIssues(
    $first: Int!
    $filter: IssueFilter
    $orderBy: PaginationOrderBy
  ) {
    issues(
      first: $first
      filter: $filter
      orderBy: $orderBy
      includeArchived: false
    ) {
      nodes {
        ${COMPLETE_ISSUE_FRAGMENT}
      }
    }
  }
`;

/**
 * Team-scoped variant of `FILTERED_SEARCH_ISSUES_QUERY` (DEV-5578).
 *
 * When a `--team` filter is present, the team boundary is applied
 * *structurally* — the `issues` connection is rooted at the `Team` node
 * (`team(id: $teamId).issues(...)`) rather than passed as a top-level
 * `issues(filter: { team: { id: { eq } } })` relation filter.
 *
 * The top-level relation-filter form is unreliable at scale: Linear's API
 * silently leaks issues from *other* teams once `$first` grows past a small
 * page (~20), so `issues list --team DEV --limit 100` returned issues from
 * EMW/INF/FE too. This is the same class of bug DEV-5325 fixed for
 * `projects list --team` (`ProjectFilter` had no working `teams` relation, so
 * project scoping moved to `Team.projects`). Rooting at the team node keeps
 * the team boundary server-side and exact. The remaining `$filter`
 * (state / labels / assignee / priority / project) is applied on top of the
 * already-team-scoped connection.
 */
export const TEAM_SCOPED_FILTERED_ISSUES_QUERY = `
  query TeamScopedFilteredIssues(
    $teamId: String!
    $first: Int!
    $filter: IssueFilter
    $orderBy: PaginationOrderBy
  ) {
    team(id: $teamId) {
      issues(
        first: $first
        filter: $filter
        orderBy: $orderBy
        includeArchived: false
      ) {
        nodes {
          ${COMPLETE_ISSUE_FRAGMENT}
        }
      }
    }
  }
`;

/**
 * Batch-resolves a search's team/project/assignee/delegate filter inputs.
 *
 * The `projects` block is `@include`-gated: Linear treats a null filter
 * comparator as "no filter", so an always-on block with an unset
 * `$projectName` would fetch an arbitrary project. (Search resolves a UUID
 * `--project` directly without consulting this block, so only the
 * name-resolution arm is needed here.)
 */
export const BATCH_RESOLVE_FOR_SEARCH_QUERY = `
  query BatchResolveForSearch(
    $teamKey: String
    $teamName: String
    $projectName: String
    $hasProjectName: Boolean = false
    $assigneeEmail: String
    $delegateEmail: String
  ) {
    teams(
      filter: {
        or: [
          { key: { eq: $teamKey } }
          { name: { eqIgnoreCase: $teamName } }
        ]
      }
      first: 1
    ) {
      nodes {
        id
        key
        name
      }
    }

    projects(
      filter: { name: { eqIgnoreCase: $projectName } }
      first: 1
    ) @include(if: $hasProjectName) {
      nodes {
        id
        name
      }
    }

    users(filter: { email: { eq: $assigneeEmail } }, first: 1) {
      nodes {
        id
        name
        email
      }
    }

    delegates: users(filter: { email: { eq: $delegateEmail } }, first: 1) {
      nodes {
        id
        name
        email
      }
    }
  }
`;

export const GET_ISSUE_BY_ID_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      ${COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT}
    }
  }
`;

export const GET_ISSUE_BY_IDENTIFIER_QUERY = `
  query GetIssueByIdentifier($teamKey: String!, $number: Float!) {
    issues(
      filter: {
        team: { key: { eq: $teamKey } }
        number: { eq: $number }
      }
      first: 1
    ) {
      nodes {
        ${COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT}
      }
    }
  }
`;

/**
 * Batch issue fetch. Used by `issues read <id...>` (DEV-4477) to collapse
 * N parallel single-issue queries into one round-trip. The `$filter` is
 * a top-level OR built client-side; each OR clause is either:
 *   { id: { in: [...uuids] } }                                  ← all UUIDs in one IN
 *   { team: { key: { eq: <key> } }, number: { in: [...nums] } } ← identifiers
 *                                                                  grouped by team
 * Linear returns nodes in DB order, NOT input order — the caller is
 * responsible for re-sorting to match the input list before surfacing.
 *
 * `$first` is `refCount * 2`, clamped to [100, 250] — the floor absorbs the
 * rare case where Linear returns more rows than requested via OR-clause
 * collisions; the ceiling is Linear's connection-page cap, beyond which the
 * server silently truncates.
 *
 * Raw GraphQL (not @linear/sdk) is required because the SDK's
 * `client.issues({ filter: ... })` strips through the same query under
 * the hood but forces one round-trip per call site; the doctrine in
 * CLAUDE.md ("Performance-critical loops where the SDK's per-edge
 * resolver promises produce N+1 round-trips") explicitly authorizes this.
 */
export const BATCH_GET_ISSUES_QUERY = `
  query BatchGetIssues($filter: IssueFilter!, $first: Int!) {
    issues(filter: $filter, first: $first) {
      nodes {
        ${COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT}
      }
    }
  }
`;

/**
 * Batch-resolves an update's project/milestone/issue inputs.
 *
 * The project and milestone blocks are `@include`-gated for the same
 * reason as `BATCH_RESOLVE_FOR_CREATE_QUERY`: a null filter comparator is
 * a no-op that returns an arbitrary record. A UUID `--project` is resolved
 * by `id` (`projectsById`) so its milestones are still fetched for
 * `--project-milestone` name resolution; a name uses `projectsByName`.
 */
export const BATCH_RESOLVE_FOR_UPDATE_QUERY = `
  query BatchResolveForUpdate(
    $projectName: String
    $projectId: ID
    $hasProjectName: Boolean = false
    $hasProjectId: Boolean = false
    $teamKey: String
    $issueNumber: Float
    $milestoneName: String
    $hasMilestoneName: Boolean = false
  ) {
    projectsByName: projects(
      filter: { name: { eqIgnoreCase: $projectName } }
      first: 5
    ) @include(if: $hasProjectName) {
      nodes {
        id
        name
        teams {
          nodes { id key }
        }
        projectMilestones {
          nodes {
            id
            name
          }
        }
      }
    }

    projectsById: projects(
      filter: { id: { eq: $projectId } }
      first: 1
    ) @include(if: $hasProjectId) {
      nodes {
        id
        name
        projectMilestones {
          nodes {
            id
            name
          }
        }
      }
    }

    milestones: projectMilestones(
      filter: { name: { eq: $milestoneName } }
      first: 1
    ) @include(if: $hasMilestoneName) {
      nodes {
        id
        name
      }
    }

    issues(
      filter: {
        and: [
          { team: { key: { eq: $teamKey } } }
          { number: { eq: $issueNumber } }
        ]
      }
      first: 1
    ) {
      nodes {
        id
        identifier
        team {
          id
          key
        }
        labels {
          nodes {
            id
            name
          }
        }
        project {
          id
          projectMilestones {
            nodes {
              id
              name
            }
          }
        }
      }
    }
  }
`;

export const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        ${COMPLETE_ISSUE_FRAGMENT}
      }
    }
  }
`;

export const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        ${COMPLETE_ISSUE_FRAGMENT}
      }
    }
  }
`;

export const ARCHIVE_ISSUE_MUTATION = `
  mutation ArchiveIssue($id: String!) {
    issueArchive(id: $id) {
      success
      lastSyncId
      entity {
        id
      }
    }
  }
`;

export const DELETE_ISSUE_MUTATION = `
  mutation DeleteIssue($id: String!, $permanentlyDelete: Boolean) {
    issueDelete(id: $id, permanentlyDelete: $permanentlyDelete) {
      success
      lastSyncId
      entity {
        id
      }
    }
  }
`;

/**
 * Batch-resolves a create's team/project/milestone/parent inputs in one
 * round-trip.
 *
 * The project and milestone blocks are gated behind `@include` directives
 * rather than left always-on. Linear treats a null filter comparator
 * (`{ name: { eqIgnoreCase: null } }`) as "no filter" — so an always-on
 * `projects` block with an unset `$projectName` returns an *arbitrary*
 * project, which the caller would then mistake for the user's project
 * (e.g. auto-switching the team to that unrelated project's team). The
 * `has*` booleans ensure a block is fetched only when its input exists.
 *
 * A UUID `--project` is resolved by `id` (`projectsById`) so its team
 * associations are still fetched for team-project validation; a name is
 * resolved by `name` (`projectsByName`). The two are mutually exclusive,
 * but GraphQL forbids two same-aliased fields with differing arguments,
 * so they carry distinct aliases and the service folds whichever ran
 * into `resolveResult.projects`.
 */
export const BATCH_RESOLVE_FOR_CREATE_QUERY = `
  query BatchResolveForCreate(
    $teamKey: String
    $teamName: String
    $projectName: String
    $projectId: ID
    $hasProjectName: Boolean = false
    $hasProjectId: Boolean = false
    $parentTeamKey: String
    $parentIssueNumber: Float
    $milestoneName: String
    $hasMilestoneName: Boolean = false
  ) {
    teams(
      filter: {
        or: [
          { key: { eq: $teamKey } }
          { name: { eqIgnoreCase: $teamName } }
        ]
      }
      first: 1
    ) {
      nodes {
        id
        key
        name
      }
    }

    projectsByName: projects(
      filter: { name: { eqIgnoreCase: $projectName } }
      first: 5
    ) @include(if: $hasProjectName) {
      nodes {
        id
        name
        teams {
          nodes { id key }
        }
        projectMilestones {
          nodes { id name }
        }
      }
    }

    projectsById: projects(
      filter: { id: { eq: $projectId } }
      first: 1
    ) @include(if: $hasProjectId) {
      nodes {
        id
        name
        teams {
          nodes { id key }
        }
        projectMilestones {
          nodes { id name }
        }
      }
    }

    milestones: projectMilestones(
      filter: { name: { eq: $milestoneName } }
      first: 1
    ) @include(if: $hasMilestoneName) {
      nodes {
        id
        name
      }
    }

    parentIssues: issues(
      filter: {
        and: [
          { team: { key: { eq: $parentTeamKey } } }
          { number: { eq: $parentIssueNumber } }
        ]
      }
      first: 1
    ) {
      nodes {
        id
        identifier
      }
    }
  }
`;

/**
 * Build a label-resolution query filtered by names (case-insensitive).
 * Uses `or` + `eqIgnoreCase` since Linear's `in` filter may be case-sensitive.
 */
export function buildResolveLabelsByNameQuery(labelNames: string[]): {
	query: string;
	variables: Record<string, string>;
} {
	const varDecls = labelNames.map((_, i) => `$label${i}: String!`).join(", ");
	const filterConditions = labelNames
		.map((_, i) => `{ name: { eqIgnoreCase: $label${i} } }`)
		.join("\n          ");
	const variables: Record<string, string> = {};
	for (let i = 0; i < labelNames.length; i++) {
		variables[`label${i}`] = labelNames[i];
	}
	const query = `
  query ResolveLabels(${varDecls}) {
    labels: issueLabels(
      filter: {
        or: [
          ${filterConditions}
        ]
      }
      first: 50
    ) {
      nodes {
        id
        name
        isGroup
        team {
          id
        }
      }
    }
  }
`;
	return { query, variables };
}

export const GET_ISSUE_STATE_HISTORY_QUERY = `
  query GetIssueStateHistory($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      stateHistory {
        nodes {
          state { id name type }
          startedAt
          endedAt
        }
      }
    }
  }
`;

export const GET_ISSUE_TEAM_QUERY = `
  query GetIssueTeam($issueId: String!) {
    issue(id: $issueId) {
      team { id }
    }
  }
`;

export const GET_ISSUE_START_CONTEXT_QUERY = `
  query GetIssueStartContext($id: String!) {
    issue(id: $id) {
      id
      identifier
      state { id name type }
      team { id key name }
      delegate { id name url }
    }
  }
`;

/**
 * Batch issue lifecycle/assignee context with the authenticated viewer for the
 * branch auto-claim flow. Raw GraphQL is used because this needs `viewer` plus
 * issue fields in one round-trip; the SDK would make separate calls.
 */
export const GET_ISSUE_CLAIM_CONTEXT_QUERY = `
  query GetIssueClaimContext($id: String!) {
    viewer {
      id
      name
      displayName
      email
    }
    issue(id: $id) {
      id
      identifier
      state { id name type }
      assignee { id name url }
      team { id key name }
    }
  }
`;

export const TEAM_STARTED_STATUSES_QUERY = `
  query TeamStartedStatuses($teamId: String!) {
    team(id: $teamId) {
      states(filter: { type: { eq: "started" } }) {
        nodes {
          id
          name
          position
        }
      }
    }
  }
`;

export const ISSUE_RELATION_CREATE_MUTATION = `
  mutation IssueRelationCreate($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      issueRelation {
        id
        type
        issue {
          id
          identifier
          title
        }
        relatedIssue {
          id
          identifier
          title
        }
      }
    }
  }
`;

export const GET_ISSUE_RELATIONS_QUERY = `
  query GetIssueRelations($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      relations {
        nodes {
          id
          type
          relatedIssue {
            id
            identifier
            title
            state { id name }
            priority
            assignee { id name }
            team { id key name }
          }
        }
      }
      inverseRelations {
        nodes {
          id
          type
          issue {
            id
            identifier
            title
            state { id name }
            priority
            assignee { id name }
            team { id key name }
          }
        }
      }
    }
  }
`;

export const SCAN_ISSUES_QUERY = `
  query ScanIssues($filter: IssueFilter, $first: Int) {
    issues(filter: $filter, first: $first, orderBy: updatedAt) {
      nodes { id identifier description }
    }
  }
`;
