const ATTACHMENT_FRAGMENT = `
  id
  title
  url
  createdAt
  updatedAt
`;

export const CREATE_ATTACHMENT_MUTATION = `
  mutation AttachmentCreate($input: AttachmentCreateInput!) {
    attachmentCreate(input: $input) {
      success
      attachment {
        ${ATTACHMENT_FRAGMENT}
      }
    }
  }
`;

export const DELETE_ATTACHMENT_MUTATION = `
  mutation AttachmentDelete($id: String!) {
    attachmentDelete(id: $id) {
      success
    }
  }
`;

export const LIST_ATTACHMENTS_QUERY = `
  query ListAttachments($issueId: String!) {
    issue(id: $issueId) {
      attachments {
        nodes {
          ${ATTACHMENT_FRAGMENT}
        }
      }
    }
  }
`;
