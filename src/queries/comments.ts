export const LIST_COMMENTS_QUERY = `
  query ListComments($issueId: String!, $first: Int) {
    issue(id: $issueId) {
      id
      identifier
      comments(first: $first, orderBy: createdAt) {
        nodes {
          id
          body
          createdAt
          updatedAt
          user {
            id
            name
            displayName
            url
          }
        }
      }
    }
  }
`;

export const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id
        body
        createdAt
        updatedAt
        user {
          id
          name
          displayName
          url
        }
      }
    }
  }
`;

export const UPDATE_COMMENT_MUTATION = `
  mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
    commentUpdate(id: $id, input: $input) {
      success
      comment {
        id
        body
        createdAt
        updatedAt
        user {
          id
          name
          displayName
          url
        }
        issue {
          id
          identifier
        }
      }
    }
  }
`;
