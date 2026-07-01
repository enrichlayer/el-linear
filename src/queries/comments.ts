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

export const GET_COMMENT_QUERY = `
  query GetComment($id: String, $hash: String) {
    comment(id: $id, hash: $hash) {
      id
      body
      url
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

// commentDelete returns a DeletePayload (`{ success }`) — no `comment` node,
// since the entity is gone. The @linear/sdk exposes this as
// `client.deleteComment(id)`, but the standalone comment commands all go
// through raw mutations on `graphQLService` (create/update need `bodyData`,
// which the SDK's typed input wraps awkwardly), so delete stays on the same
// raw path for a consistent, single-mock test surface.
export const DELETE_COMMENT_MUTATION = `
  mutation DeleteComment($id: String!) {
    commentDelete(id: $id) {
      success
    }
  }
`;
