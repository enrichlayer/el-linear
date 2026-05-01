export const SEMANTIC_SEARCH_QUERY = `
  query SemanticSearch($query: String!, $maxResults: Int, $filters: SemanticSearchFilters) {
    semanticSearch(query: $query, maxResults: $maxResults, filters: $filters) {
      results {
        type
        issue {
          id
          identifier
          title
          priority
          state { id name }
          team { id key name }
          assignee { id name url }
          project { id name }
        }
        project {
          id
          name
          state
        }
        initiative {
          id
          name
          status
        }
        document {
          id
          title
          slugId
          project { id name }
        }
      }
    }
  }
`;
