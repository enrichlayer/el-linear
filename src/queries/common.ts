const ISSUE_CORE_FIELDS = `
  id
  identifier
  title
  description
  summary { content generationStatus }
  branchName
  priority
  estimate
  dueDate
  url
  createdAt
  updatedAt
`;

const ISSUE_STATE_FRAGMENT = `
  state {
    id
    name
  }
`;

const ISSUE_ASSIGNEE_FRAGMENT = `
  assignee {
    id
    name
    url
  }
`;

const ISSUE_TEAM_FRAGMENT = `
  team {
    id
    key
    name
  }
`;

const ISSUE_PROJECT_FRAGMENT = `
  project {
    id
    name
  }
`;

const ISSUE_LABELS_FRAGMENT = `
  labels {
    nodes {
      id
      name
    }
  }
`;

const ISSUE_CYCLE_FRAGMENT = `
  cycle {
    id
    name
    number
  }
`;

const ISSUE_PROJECT_MILESTONE_FRAGMENT = `
  projectMilestone {
    id
    name
    targetDate
  }
`;

const ISSUE_COMMENTS_FRAGMENT = `
  comments {
    nodes {
      id
      body
      createdAt
      updatedAt
      user {
        id
        name
        url
      }
    }
  }
`;

const ISSUE_PARENT_FRAGMENT = `
  parent {
    id
    identifier
    title
  }
`;

const ISSUE_CHILDREN_FRAGMENT = `
  children {
    nodes {
      id
      identifier
      title
    }
  }
`;

export const COMPLETE_ISSUE_FRAGMENT = `
  ${ISSUE_CORE_FIELDS}
  ${ISSUE_STATE_FRAGMENT}
  ${ISSUE_ASSIGNEE_FRAGMENT}
  ${ISSUE_TEAM_FRAGMENT}
  ${ISSUE_PROJECT_FRAGMENT}
  ${ISSUE_LABELS_FRAGMENT}
  ${ISSUE_CYCLE_FRAGMENT}
  ${ISSUE_PROJECT_MILESTONE_FRAGMENT}
  ${ISSUE_PARENT_FRAGMENT}
  ${ISSUE_CHILDREN_FRAGMENT}
`;

export const COMPLETE_ISSUE_WITH_COMMENTS_FRAGMENT = `
  ${COMPLETE_ISSUE_FRAGMENT}
  ${ISSUE_COMMENTS_FRAGMENT}
`;
