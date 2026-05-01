export const FIND_PARENT_LABEL_QUERY = `
  query FindParentLabel($name: String!, $teamId: ID!) {
    issueLabels(filter: {
      and: [
        { name: { eq: $name } }
        { team: { id: { eq: $teamId } } }
      ]
    }, first: 1) {
      nodes { id name isGroup }
    }
  }
`;

export const CREATE_LABEL_MUTATION = `
  mutation CreateLabel($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      success
      issueLabel {
        id
        name
        color
        team { id key name }
        parent { id name }
      }
    }
  }
`;

export const RETIRE_LABEL_MUTATION = `
  mutation RetireLabel($id: String!) {
    issueLabelRetire(id: $id) {
      success
      issueLabel {
        id
        name
        color
        retiredAt
        team { id key name }
      }
    }
  }
`;

export const RESTORE_LABEL_MUTATION = `
  mutation RestoreLabel($id: String!) {
    issueLabelRestore(id: $id) {
      success
      issueLabel {
        id
        name
        color
        team { id key name }
      }
    }
  }
`;
