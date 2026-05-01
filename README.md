# linctl

A pragmatic CLI for [Linear.app](https://linear.app) — deterministic team /
label / member resolution, structured issue validation, configurable term
enforcement, and a GraphQL escape hatch for everything that isn't a
first-class command.

> **Note on naming.** This package was previously published as
> `@enrichlayer/el-linear` with binary `el-linear`. The current name is
> `@enrichlayer/linctl` (binary `linctl`). See [CHANGELOG.md](./CHANGELOG.md)
> for the migration recipe.

## Install

```bash
pnpm add -g @enrichlayer/linctl
# or
npm install -g @enrichlayer/linctl
```

Requires Node.js ≥ 22.

## Quickstart

```bash
# 1. Set your Linear API token
export LINEAR_API_TOKEN="lin_api_..."  # from https://linear.app/settings/account/security

# 2. Sanity-check
linctl teams list

# 3. Create your first issue
linctl issues create "Investigate flaky deploy" \
  --team ENG --assignee alice --project "Reliability" \
  --description "..."
```

Output is JSON by default. Pipe through `jq` for ad-hoc queries, or use the
built-in `--jq` / `--fields` / `--raw` flags.

## Why linctl

The Linear API + SDK are excellent. linctl adds the layer above them that
every team ends up writing themselves:

| Concern | What linctl gives you |
|---------|----------------------|
| **Name resolution** | Map team keys, member aliases, and label names to UUIDs from one config file. No fuzzy matching, no API roundtrips per call. |
| **Issue hygiene** | Required labels, required assignee, required project, type-label-to-verb conventions — all configurable. Warn or hard-fail. |
| **Term enforcement** | Catch misspellings of brand and project names in issue titles and descriptions ("EnrichLayer" → "Enrich Layer"). |
| **Status defaults** | "No project? → Triage. Has assignee+project? → Todo." Per-workspace, configurable. |
| **Auto-link & relate** | When you write `EMW-258` in a description, linctl wraps it as a markdown link **and** creates the corresponding sidebar relation. Prose like "blocked by EMW-258" infers the relation type. |
| **`--claude` flag** | Tag issues delegated to [Claude Code](https://claude.ai/code) for autonomous work. The label is plain config; the flag is muscle memory. |
| **GraphQL escape hatch** | Anything not covered by built-in commands: `linctl graphql '{ viewer { id } }'`. Schema introspection included. |
| **Bundled Claude skill** | The published tarball includes a `claude-skills/linear-operations/` directory you can symlink into your project's `.claude/skills/`. |

## Authentication

The API token is resolved in this order:

1. `--api-token <token>` flag.
2. `LINEAR_API_TOKEN` environment variable.
3. `~/.config/linctl/token` file (recommended for human use).
4. `~/.linear_api_token` file (legacy, still honored).

linctl never logs the token.

## Configuration

linctl reads `~/.config/linctl/config.json` on startup. All keys are
optional; defaults work for casual use.

```json
{
  "defaultTeam": "ENG",
  "defaultLabels": ["claude"],
  "members": {
    "aliases": { "alice": "Alice Anderson" },
    "uuids": { "Alice Anderson": "<uuid-from-linear>" }
  },
  "teams": { "ENG": "<uuid-from-linear>" },
  "labels": {
    "workspace": { "claude": "<uuid-from-linear>" },
    "teams": { "ENG": { "feature": "<uuid-from-linear>" } }
  },
  "statusDefaults": {
    "noProject": "Triage",
    "withAssigneeAndProject": "Todo"
  },
  "terms": [
    { "canonical": "Enrich Layer", "reject": ["EnrichLayer", "enrichlayer"] }
  ]
}
```

A full reference with every key documented lives in [config.example.json](./config.example.json).

UUIDs come from the Linear UI (URL bars, settings pages) or via linctl
itself: `linctl teams list --raw | jq '.[] | {key, id}'`, etc.

## Term enforcement (with brand-promotion examples)

The `terms` rules let you keep a list of canonical names and the misspellings
to reject. linctl warns (or in `--strict` mode, throws) when an issue title
or description contains a rejected form.

```json
{
  "terms": [
    { "canonical": "Enrich Layer", "reject": ["EnrichLayer", "enrichlayer", "Enrichlayer"] },
    { "canonical": "Linear",       "reject": ["linear.app", "Linear App"] },
    { "canonical": "GitHub",       "reject": ["Github", "GitHUB"] }
  ]
}
```

```bash
$ linctl issues create "Add EnrichLayer auth flow" --team ENG --description "..." --strict
Term enforcement failed:
  - Found "EnrichLayer" — use "Enrich Layer" instead (1 occurrence)
```

URLs and file paths are exempt — `enrichlayer.com` and `path/to/enrichlayer`
are allowed even though `enrichlayer` is rejected.

If you don't define any rules, term enforcement is a no-op.

## The `--claude` delegation pattern

`linctl issues create` accepts `--claude`, which applies the workspace label
configured at `config.labels.workspace.claude`. The label is the contract:
it tells [Claude Code](https://claude.ai/code) "this issue is delegated to
you for autonomous execution."

```bash
linctl issues create "Migrate auth middleware to new session store" \
  --team ENG --assignee alice --project "Auth Refactor" \
  --description "..." --claude
```

Claude finds delegated work with `linctl issues search "claude" --status "Todo"`.

## Commands at a glance

```bash
linctl usage                  # full reference for all commands
linctl <command> --help       # detailed help for one command
```

| Group | Common commands |
|-------|-----------------|
| Issues | `issues {list, search, create, read, update, delete, history, related, link-references}` |
| Comments | `comments {list, create, update}` |
| Labels | `labels {list, create, retire, restore}` |
| Projects | `projects {list, add-team, remove-team}` |
| Cycles | `cycles {list, read}` |
| Documents | `documents {list, read, create, update, delete}` |
| Releases | `releases {list, read, create, pipelines}` |
| Files | `embeds {upload, download}`, `attachments {list, create, delete}` |
| Search | `search <query>` (semantic, cross-resource) |
| Escape hatch | `graphql [query]` (with `--introspect`) |
| Config | `config show`, `users list`, `teams list`, `templates list` |

All `list` subcommands support `-l, --limit <n>`. All commands accept the
top-level filters: `--raw`, `--jq <expr>`, `--fields <list>`.

## Use with Claude Code

linctl ships a Claude Code skill at `claude-skills/linear-operations/SKILL.md`.
After installing the package, symlink it into your project:

```bash
PKG=$(npm root -g)/@enrichlayer/linctl
ln -s "$PKG/claude-skills/linear-operations" .claude/skills/linear-operations
```

The skill teaches Claude Code linctl's syntax, the duplicate/related issue
check, the label taxonomy, the auto-link flow, and the `--claude` delegation
pattern.

## Development

```bash
git clone https://github.com/enrichlayer/linctl.git
cd linctl
pnpm install

pnpm test                # vitest
pnpm exec tsc --noEmit   # typecheck
pnpm exec biome check src/
pnpm run build
node dist/main.js --version
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

## Built by

[Enrich Layer](https://enrichlayer.com) — data enrichment APIs.

## License

[MIT](./LICENSE).
