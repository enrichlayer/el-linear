<p align="center">
  <img src="public/logo-256.png" alt="el-linear logo" width="160" height="160" />
</p>

<h1 align="center">el-linear</h1>

A pragmatic CLI for [Linear.app](https://linear.app) — deterministic team /
label / member resolution, structured issue validation, configurable term
enforcement, and a GraphQL escape hatch for everything that isn't a
first-class command.

> **Note on naming.** This package was briefly published as
> `@enrichlayer/linctl` with binary `linctl`, but reverted to
> `@enrichlayer/el-linear` (binary `el-linear`) because of an npm name
> collision with [dorkitude/linctl](https://github.com/dorkitude/linctl). See
> [CHANGELOG.md](./CHANGELOG.md) for the migration recipe.

## Install

Published on npm as [`@enrichlayer/el-linear`](https://www.npmjs.com/package/@enrichlayer/el-linear).

```bash
pnpm add -g @enrichlayer/el-linear
# or
npm install -g @enrichlayer/el-linear
```

Requires Node.js ≥ 22.

## Quickstart

```bash
# Run the interactive setup wizard. Only the API token is required;
# every other step is skippable and revisitable later.
el-linear init

# Sanity-check
el-linear teams list

# Create your first issue
el-linear issues create "Investigate flaky deploy" \
  --team ENG --assignee alice --project "Reliability" \
  --description "..."
```

`el-linear init` walks you through the API token, default team, member
aliases, and other defaults. Each step is also a stand-alone sub-command
(`el-linear init token`, `el-linear init aliases --import users.csv`, etc.) so
you can revisit individual sections later. Skip is the default at every
prompt — running the wizard twice with no input is a no-op.

If you'd rather skip the wizard entirely, the configuration schema is
fully documented in [docs/configuration.md](./docs/configuration.md) so
any LLM or script can write `~/.config/el-linear/config.json` directly.

Output is JSON by default. Pipe through `jq` for ad-hoc queries, or use
the built-in `--jq` / `--fields` / `--raw` flags.

## Why el-linear

The Linear API + SDK are excellent. el-linear adds the layer above them that
every team ends up writing themselves:

| Concern | What el-linear gives you |
|---------|----------------------|
| **Name resolution** | Map team keys, member aliases, and label names to UUIDs from one config file. No fuzzy matching, no API roundtrips per call. |
| **Issue hygiene** | Required labels, required assignee, required project, type-label-to-verb conventions — all configurable. Warn or hard-fail. |
| **Term enforcement** | Catch misspellings of brand and project names in issue titles and descriptions ("EnrichLayer" → "Enrich Layer"). |
| **Status defaults** | "No project? → Triage. Has assignee+project? → Todo." Per-workspace, configurable. |
| **Auto-link & relate** | When you write `EMW-258` in a description, el-linear wraps it as a markdown link **and** creates the corresponding sidebar relation. Prose like "blocked by EMW-258" infers the relation type. |
| **`--claude` flag** | Tag issues delegated to [Claude Code](https://claude.ai/code) for autonomous work. The label is plain config; the flag is muscle memory. |
| **GraphQL escape hatch** | Anything not covered by built-in commands: `el-linear graphql '{ viewer { id } }'`. Schema introspection included. |
| **Bundled Claude skill** | The published tarball includes a `claude-skills/linear-operations/` directory you can symlink into your project's `.claude/skills/`. |

## Authentication

The API token is resolved in this order:

1. `--api-token <token>` flag.
2. `LINEAR_API_TOKEN` environment variable.
3. `~/.config/el-linear/token` file (recommended for human use).
4. `~/.linear_api_token` file (legacy, still honored).

el-linear never logs the token.

## Configuration

el-linear reads `~/.config/el-linear/config.json` on startup. All keys are
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

UUIDs come from the Linear UI (URL bars, settings pages) or via el-linear
itself: `el-linear teams list --raw | jq '.[] | {key, id}'`, etc.

## Term enforcement (with brand-promotion examples)

The `terms` rules let you keep a list of canonical names and the misspellings
to reject. el-linear warns (or in `--strict` mode, throws) when an issue title
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
$ el-linear issues create "Add EnrichLayer auth flow" --team ENG --description "..." --strict
Term enforcement failed:
  - Found "EnrichLayer" — use "Enrich Layer" instead (1 occurrence)
```

URLs and file paths are exempt — `enrichlayer.com` and `path/to/enrichlayer`
are allowed even though `enrichlayer` is rejected.

If you don't define any rules, term enforcement is a no-op.

## The `--claude` delegation pattern

`el-linear issues create` accepts `--claude`, which applies the workspace label
configured at `config.labels.workspace.claude`. The label is the contract:
it tells [Claude Code](https://claude.ai/code) "this issue is delegated to
you for autonomous execution."

```bash
el-linear issues create "Migrate auth middleware to new session store" \
  --team ENG --assignee alice --project "Auth Refactor" \
  --description "..." --claude
```

Claude finds delegated work with `el-linear issues search "claude" --status "Todo"`.

## Commands at a glance

```bash
el-linear usage                  # full reference for all commands
el-linear <command> --help       # detailed help for one command
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

el-linear ships a Claude Code skill at `claude-skills/linear-operations/SKILL.md`.
After installing the package, symlink it into your project:

```bash
PKG=$(npm root -g)/@enrichlayer/el-linear
ln -s "$PKG/claude-skills/linear-operations" .claude/skills/linear-operations
```

The skill teaches Claude Code el-linear's syntax, the duplicate/related issue
check, the label taxonomy, the auto-link flow, and the `--claude` delegation
pattern.

## Development

```bash
git clone https://github.com/enrichlayer/el-linear.git
cd el-linear
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
