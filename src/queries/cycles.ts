export const FIND_CYCLE_SCOPED_QUERY = `
  query FindCycleScoped($name: String!, $teamId: ID!) {
    cycles(
      filter: {
        and: [
          { name: { eq: $name } }
          { team: { id: { eq: $teamId } } }
        ]
      }
      first: 10
    ) {
      nodes {
        id
        name
        number
        startsAt
        isActive
        isNext
        isPrevious
        team { id key }
      }
    }
  }
`;

export const FIND_CYCLE_GLOBAL_QUERY = `
  query FindCycleGlobal($name: String!) {
    cycles(filter: { name: { eq: $name } }, first: 10) {
      nodes {
        id
        name
        number
        startsAt
        isActive
        isNext
        isPrevious
        team { id key }
      }
    }
  }
`;
