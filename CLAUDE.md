# el-linear

CLI tool for Linear.app with Enrich Layer-specific conventions. Built on `@linear/sdk` v76 and Commander.js.

## Quick Reference

```bash
npm run start          # run from source via tsx
npm run build          # tsc → dist/
npm run test           # vitest run
npm run lint           # biome check
```

## Architecture

```
src/
├── main.ts                      # CLI entry point, registers all commands
├── commands/                    # Commander.js command definitions
│   ├── search.ts                # Semantic search + template search
│   ├── issues.ts                # Issue CRUD + history + relations + batch get
│   ├── releases.ts              # Releases CRUD + pipelines
│   ├── labels.ts                # Labels CRUD + retire/restore
│   ├── documents.ts             # Documents CRUD + issue linking
│   ├── templates.ts             # Template list + read
│   ├── graphql.ts               # Raw GraphQL + schema introspection
│   ├── attachments.ts           # File attachments on issues
│   ├── comments.ts              # Issue comments (create, update, list)
│   ├── cycles.ts                # Cycle list + read with issues
│   ├── embeds.ts                # Linear file upload/download
│   ├── gdoc.ts                  # Google Docs → Linear markdown
│   ├── project-milestones.ts    # Milestone CRUD within projects
│   ├── projects.ts              # Project list + team management
│   ├── teams.ts                 # Team list
│   └── users.ts                 # User list (with --active filter)
├── queries/                     # GraphQL query/mutation constants
│   ├── common.ts                # Shared issue fragments
│   ├── issues.ts                # Issue queries
│   ├── search.ts                # Semantic search query
│   ├── releases.ts              # Release queries
│   ├── labels.ts                # Label queries
│   ├── cycles.ts                # Cycle resolution queries
│   ├── attachments.ts           # Attachment queries
│   ├── comments.ts              # Comment queries
│   ├── documents.ts             # Document queries
│   ├── project-milestones.ts    # Milestone queries
│   └── projects.ts              # Project queries
├── utils/
│   ├── graphql-service.ts       # Raw GraphQL client (fetch-based)
│   ├── graphql-issues-service.ts # Issue-specific query orchestration
│   ├── linear-service.ts        # SDK-based service (teams, users, labels, cycles)
│   ├── output.ts                # JSON output helpers (outputSuccess, handleAsyncCommand)
│   └── ...
├── config/
│   ├── config.ts                # External config loading (~/.config/el-linear/config.json)
│   ├── resolver.ts              # Deterministic name → UUID resolution
│   ├── brand-validator.ts       # "Enrich Layer" spelling enforcement
│   └── status-defaults.ts       # Auto-status assignment rules
└── types/
    └── linear.ts                # All entity types + GraphQLResponseData
```

## Output Format (for callers parsing JSON)

All output is a single JSON object on stdout. Errors also go to stdout (not stderr) so `2>&1` is safe.

**List commands** return `{ data: [...], meta: { count: N } }`:
```json
{ "data": [{ "id": "...", "name": "..." }], "meta": { "count": 2 } }
```

**Single resource** (read, create, update) returns a flat object:
```json
{ "id": "...", "identifier": "DEV-123", "title": "..." }
```

**Errors** return `{ "error": "message" }` and exit code 1.

**Warnings** are embedded as `_warnings: [...]` in object responses (not in arrays).

**`--raw` flag**: Strips the `{ data, meta }` wrapper from list output, emitting just the array. Useful for piping into `jq '.[]'` or Python list iteration without navigating `.data` first.

```bash
# Default:  { "data": [...], "meta": { "count": 5 } }
# With --raw: [...]
el-linear projects list --raw 2>&1 | jq '.[0].name'
```

**Always check for the `error` key before accessing result fields:**
```python
result = json.loads(output)
if "error" in result:
    raise Exception(result["error"])
# Now safe to access result["data"] or result["identifier"]
```

## Key Patterns

### Command Structure

Every command group follows the same pattern:

```typescript
export function setupXYZCommands(program: Command): void {
  const xyz = program.command("xyz").description("...");
  xyz.action(() => xyz.help());

  xyz.command("list")
    .option("-l, --limit <number>", "limit results", "25")
    .action(handleAsyncCommand(async (options, command) => {
      const rootOpts = command.parent!.parent!.opts();
      // create service, fetch data, outputSuccess(result)
    }));
}
```

- All commands use `handleAsyncCommand()` for error handling
- All output goes through `outputSuccess()` (JSON to stdout)
- All `list` commands must have `-l, --limit <number>` (enforced by test)
- Register new command groups in `main.ts`

### GraphQL Queries

Queries live in `src/queries/*.ts` as exported template literal constants:

```typescript
export const MY_QUERY = `
  query MyQuery($id: String!) {
    myEntity(id: $id) {
      id
      name
      relatedItems {
        nodes { id name }  # Connection types MUST use nodes { ... }
      }
    }
  }
`;
```

**Connection types**: Linear's API returns paginated collections as Connection types. Always use `{ nodes { ... } }` to access items. This is enforced by `graphql-queries.test.ts`.

**Known Connection fields**: `issues`, `labels`, `teams`, `users`, `projects`, `documents`, `releases`, `cycles`, `comments`, `children`, `attachments`, `stateHistory`, `projectMilestones`, `stages`, `releasePipelines`, `searchIssues`, `milestones`, `parentIssues`, `issueLabels`.

**Adding a new query**:
1. Create or update the appropriate file in `src/queries/`
2. Add the export to `ALL_QUERIES` in `src/queries/graphql-queries.test.ts`
3. If it uses a new Connection field, add it to `CONNECTION_FIELDS` in the test

### GraphQL Type Safety

`GraphQLResponseData` uses a strict recursive type — not `Record<string, any>`. Accessing nested properties requires explicit narrowing:

```typescript
const result = await graphQLService.rawRequest(MY_QUERY, { id });
const entity = result.myEntity as GraphQLResponseData;
const name = entity.name as string;
const items = entity.relatedItems as GraphQLResponseData;
const nodes = items.nodes as GraphQLResponseData[];
```

### Two Service Layers

- **`GraphQLService`** (`graphql-service.ts`): Raw GraphQL client. Use for custom queries, mutations, new entity types.
- **`LinearService`** (`linear-service.ts`): Uses `@linear/sdk` client. Handles teams, users, labels, cycles — entities with complex SDK pagination.

For issues, use `GraphQLIssuesService` which orchestrates batch resolution (team names → IDs, label names → IDs, etc.) in a single query.

### Name Resolution

EL-specific config maps human-readable names to UUIDs:
- Teams: `--team DEV` → UUID via `config.teams`
- Members: `--assignee dima` → alias resolution via `config.members`
- Labels: `--labels "feature-request"` → per-team UUID via `config.labels`

Config loads from `~/.config/el-linear/config.json`, deep-merged with defaults.

## Testing

Tests use Vitest. Two categories:

1. **Unit tests** (7 files): Config resolution, parsing, formatting, validation
2. **Structural tests** (2 files):
   - `graphql-queries.test.ts`: Parses all GraphQL queries and validates Connection fields use `nodes` wrapper
   - `cli-consistency.test.ts`: Validates all `list` commands have `--limit`

Run: `npm test`

When adding new commands or queries, the structural tests will fail if you forget to:
- Add `--limit` to a new `list` command
- Add `nodes { ... }` to a Connection field in a query
- Register a new query export in the test's `ALL_QUERIES` list

## Common Tasks

### Add a new command group

1. Create `src/commands/myentity.ts` with `setupMyEntityCommands(program)`
2. Create `src/queries/myentity.ts` with query constants
3. Register in `src/main.ts`
4. Add query exports to `ALL_QUERIES` in `graphql-queries.test.ts`
5. Ensure `list` has `--limit` (CLI consistency test will enforce this)

### Add a field to issue output

1. Update `ISSUE_CORE_FIELDS` in `src/queries/common.ts`
2. Update `LinearIssue` type in `src/types/linear.ts`
3. Map the field in `transformIssueData()` in `src/utils/graphql-issues-service.ts`

### Introspect the Linear schema

Use the dedicated `introspect` command instead of raw `__type` queries:

```bash
# List all root query fields (with optional filter)
el-linear introspect
el-linear introspect --filter template

# Inspect a specific type
el-linear introspect Release
el-linear introspect Template
```

**Always introspect before writing raw GraphQL.** Do not guess field names — the API will reject unknown fields and the error messages suggest alternatives but don't show the correct structure.

### Filtering GraphQL output with --jq

Use the `--jq` flag instead of piping through `jq`. This avoids shell escaping issues (especially `!=` vs `\!=` in zsh):

```bash
# Instead of: el-linear graphql '{ ... }' | jq '.some.filter'
# Use:
el-linear graphql '{ initiatives(first: 50) { nodes { name projects { nodes { name state } } } } }' \
  --jq '.initiatives.nodes[] | "\(.name) → \([.projects.nodes[] | select(.state != "canceled") | .name] | join(", "))"' \
  2>&1
```

The `--jq` flag normalizes `\!=` to `!=` automatically, so shell escaping mistakes don't break filters.
