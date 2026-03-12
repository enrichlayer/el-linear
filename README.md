# el-linear

Enrich Layer CLI for Linear.app — deterministic team/label/member resolution, brand validation, status defaults, and natural language search.

## Install

```bash
cd tools/cli/el-linear
npm install
npm run build
npm link  # makes `el-linear` available globally
```

Requires Node.js >= 22.

## Authentication

The API token is resolved in order:

1. `--api-token <token>` flag
2. `LINEAR_API_TOKEN` environment variable
3. `~/.config/el-linear/token` file
4. `~/.linear_api_token` file

## Commands

### Search

| Command | Description |
|---------|-------------|
| `search <query>` | Natural language search across issues, projects, initiatives, and documents |

```bash
el-linear search "login authentication bug"
el-linear search "database optimization" --type issue --team DEV
el-linear search "onboarding" --type issue,project --limit 20
```

Options: `--type <types>` (comma-separated: issue, project, initiative, document), `--team <team>`, `-l, --limit <n>` (default: 10)

### Issues

| Command | Description |
|---------|-------------|
| `issues list` | List issues (with team filter) |
| `issues search <query>` | Search issues by text or filters |
| `issues create <title>` | Create an issue with auto-resolution |
| `issues read <issueId>` | Read a single issue by identifier or UUID |
| `issues update <issueId>` | Update an existing issue |
| `issues history <issueId>` | Show state transition history (time in each status) |
| `issues relate <issueId>` | Create issue relations (blocks, related-to, duplicate-of) |

Issue output includes AI-generated summaries when available.

Both UUIDs and identifiers like `DEV-123` are supported for all issue commands.

### Comments

| Command | Description |
|---------|-------------|
| `comments create <issueId>` | Add a comment to an issue |

### Labels

| Command | Description |
|---------|-------------|
| `labels list` | List labels (optionally filtered by team) |
| `labels create <name>` | Create a label on a team |
| `labels retire <labelId>` | Soft-delete a label (can be restored) |
| `labels restore <labelId>` | Restore a previously retired label |

### Releases

| Command | Description |
|---------|-------------|
| `releases list` | List releases (optionally filtered by pipeline) |
| `releases read <releaseId>` | Get release details including linked documents |
| `releases create <name>` | Create a new release in a pipeline |
| `releases pipelines` | List release pipelines and their stages |

Requires the Release Management feature to be enabled in your Linear workspace.

### Projects

| Command | Description |
|---------|-------------|
| `projects list` | List projects |

### Cycles

| Command | Description |
|---------|-------------|
| `cycles list` | List cycles (with team/active filters) |
| `cycles read <cycleIdOrName>` | Read a cycle with its issues |

### Project Milestones

| Command | Description |
|---------|-------------|
| `project-milestones list` | List milestones for a project |
| `project-milestones read <id>` | Read milestone details with issues |
| `project-milestones create <name>` | Create a new milestone |
| `project-milestones update <id>` | Update a milestone |

### Documents

| Command | Description |
|---------|-------------|
| `documents list` | List documents (filter by project or issue) |
| `documents create` | Create a document (optionally linked to an issue) |
| `documents read <documentId>` | Read a document |
| `documents update <documentId>` | Update a document |
| `documents delete <documentId>` | Delete (trash) a document |

### Embeds (File Operations)

| Command | Description |
|---------|-------------|
| `embeds download <url>` | Download a file from Linear storage |
| `embeds upload <file>` | Upload a file to Linear storage |

### Other

| Command | Description |
|---------|-------------|
| `teams list` | List teams |
| `users list` | List users |
| `graphql [query]` | Execute raw GraphQL queries |
| `usage` | Show usage info for all commands |

All `list` commands support `-l, --limit <n>`.

## EL-Specific Features

### Natural Language Search

Uses Linear's semantic search API to find issues, projects, initiatives, and documents using natural language queries:

```bash
el-linear search "improve API response times"
el-linear search "customer onboarding flow" --type issue --team DEV
```

### Deterministic Name Resolution

Names resolve to UUIDs via config — no fuzzy matching:

```bash
el-linear issues create "Title" --team FE --assignee dima --labels "feature-request"
```

- `--team FE` resolves team key to UUID (case-insensitive)
- `--assignee dima` resolves alias "dima" to Dmitrii to UUID
- `--labels "feature-request"` resolves per-team label UUID

### Brand Validation

Issue titles and descriptions are checked for common misspellings of "Enrich Layer" (e.g., "EnrichLayer", "enrichlayer"). Warns by default, blocks with `--strict`.

### Status Defaults

- No project assigned: status = "Triage"
- Has assignee + project: status = "Todo"
- Explicit `--status` always wins

### Default Labels

The `--claude` flag adds the workspace-level "claude" label automatically.

### Issue Summaries

All issue output automatically includes AI-generated summaries from Linear when available. The summary is extracted from Linear's Prosemirror document format and included as plain text.

## Configuration

Default config has empty values. Create `~/.config/el-linear/config.json` with your workspace UUIDs:

```json
{
  "defaultTeam": "DEV",
  "defaultLabels": ["claude"],
  "brand": {
    "name": "Enrich Layer",
    "reject": ["EnrichLayer", "Enrichlayer"]
  },
  "members": {
    "aliases": { "dima": "Dmitrii" },
    "uuids": { "Dmitrii": "uuid-here" }
  },
  "teams": { "DEV": "uuid-here", "FE": "uuid-here" },
  "labels": {
    "workspace": { "claude": "uuid-here" },
    "teams": { "FE": { "feature-request": "uuid-here" } }
  },
  "statusDefaults": {
    "noProject": "Triage",
    "withAssigneeAndProject": "Todo"
  }
}
```

See `config.example.json` for a full example. User config is deep-merged with defaults.

## Development

```bash
npm run start          # run from source (tsx)
npm run build          # compile TypeScript
npm run test           # run tests (vitest)
npm run test:watch     # run tests in watch mode
npm run lint           # lint with Biome
npm run lint:fix       # auto-fix lint issues
```

## License

MIT
