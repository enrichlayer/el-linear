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

export const BATCH_RESOLVE_FOR_SEARCH_QUERY = `
  query BatchResolveForSearch(
    $teamKey: String
    $teamName: String
    $projectName: String
    $assigneeEmail: String
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

    projects(filter: { name: { eqIgnoreCase: $projectName } }, first: 1) {
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

export const BATCH_RESOLVE_FOR_UPDATE_QUERY = `
  query BatchResolveForUpdate(
    $projectName: String
    $teamKey: String
    $issueNumber: Float
    $milestoneName: String
  ) {
    projects(filter: { name: { eqIgnoreCase: $projectName } }, first: 1) {
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
    ) {
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

export const BATCH_RESOLVE_FOR_CREATE_QUERY = `
  query BatchResolveForCreate(
    $teamKey: String
    $teamName: String
    $projectName: String
    $parentTeamKey: String
    $parentIssueNumber: Float
    $milestoneName: String
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

    projects(filter: { name: { eqIgnoreCase: $projectName } }, first: 1) {
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
    ) {
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
