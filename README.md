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

el-linear supports either OAuth or a personal Linear API token. OAuth is
configured with:

```bash
el-linear init oauth
```

By default, that command walks you through registering your own Linear OAuth
app. Teams can make the flow a single browser authorization step by writing a
local, untracked app-defaults file at `~/.config/el-linear/team-oauth.json`
or pointing `EL_LINEAR_OAUTH_CONFIG` at one:

```json
{
  "linearOAuth": {
    "clientId": "your-linear-oauth-client-id",
    "redirectPort": 8765,
    "scopes": ["read", "write", "issues:create", "comments:create"],
    "passwordManagerPath": "op://vault/item/client_id"
  }
}
```

`passwordManagerPath` is optional metadata for humans/scripts; el-linear does
not execute password-manager commands from it. Do not put a `client_secret` in
this shared file. The OAuth flow uses PKCE.

At runtime, credentials are resolved in this order:

1. `--api-token <token>` flag.
2. `LINEAR_API_TOKEN` environment variable.
3. **Active profile's** OAuth state (`oauth.json`) from `el-linear init oauth`.
4. **Active profile's** `~/.config/el-linear/profiles/<name>/token` file (see *Profiles* below).
5. `~/.config/el-linear/token` file (legacy single-profile, recommended for human use when only one workspace is needed).
6. `~/.linear_api_token` file (legacy, still honored).

el-linear never logs the token.

## Profiles

Use **profiles** to switch between multiple Linear workspaces (e.g.
day-job and side-project) with separate tokens + configs.

```bash
# Create a profile + run the init wizard scoped to it.
# After this finishes, <name> becomes the active profile.
el-linear profile add forage

# Switch the default at any time:
el-linear profile use day-job
el-linear profile current        # → day-job
el-linear profile list           # all profiles + which is active

# One-off override for a single command:
el-linear --profile forage issues list
EL_LINEAR_PROFILE=forage el-linear teams list

# Remove a profile (token + config gone; confirms first):
el-linear profile remove old-profile
```

Each profile lives at `~/.config/el-linear/profiles/<name>/` and owns:

- `token` — its Linear API token (mode 0600)
- `config.json` — its full el-linear config (defaultTeam, terms, etc.)

The active profile is selected by, in priority:

1. `--profile <name>` flag (per-invocation)
2. `EL_LINEAR_PROFILE` env var
3. `~/.config/el-linear/active-profile` (one-line marker, written by `profile use`)
4. Legacy single-file layout (`~/.config/el-linear/{token,config.json}`)

The legacy fallback means **existing single-profile users see no
behavior change** — profiles are purely opt-in.

## Migrating from v1.0–1.3

Versions 1.0–1.3 stored everything in the single-file layout
(`~/.config/el-linear/{token,config.json}`). 1.4 introduced **named
profiles** (`~/.config/el-linear/profiles/<name>/{token,config.json}`) and
the legacy single-file layout still works as a fallback.

Some upgrade paths leave the legacy `config.json` on disk (with all your
member aliases and brand rules) but no usable token, in which case every
command fails with a generic `No API token found` error. 1.5 detects this
state and prints a one-line stderr hint *before* the auth error fires:

```
el-linear: legacy config detected at ~/.config/el-linear/config.json
but no token. Migrate with:

  el-linear profile migrate-legacy [--name <profile>]

Or suppress this hint with EL_LINEAR_SKIP_MIGRATION_HINT=1.
```

Run the suggested command to copy your legacy config into a named profile
in one step:

```bash
# Default target name is "default"; pass --name to choose another.
el-linear profile migrate-legacy

# CI / scripted: read the token from a file, skip all prompts.
el-linear profile migrate-legacy \
  --name work \
  --token-from /path/to/token.txt \
  --yes

# Pick the token up from an env var instead.
EL_LINEAR_TOKEN=lin_api_xxx el-linear profile migrate-legacy --yes
```

The migration is **idempotent** — re-running with the same inputs is a no-op.
If the destination profile already has a different `config.json` or token,
the command refuses unless you pass `--force` (and confirms before
overwriting unless you also pass `--yes`).

The legacy `~/.config/el-linear/config.json` is **never deleted** — you keep
a rollback path. Once you've verified the new profile works, you can remove
the legacy file by hand at your leisure.

If you've decided to stay on the legacy single-file layout intentionally,
suppress the hint with:

```bash
export EL_LINEAR_SKIP_MIGRATION_HINT=1
```

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
| Refs | `refs wrap` (rewrite issue identifiers in arbitrary text as links) |
| Escape hatch | `graphql [query]` (with `--introspect`) |
| Config | `config show`, `users list`, `teams list`, `templates list` |

All `list` subcommands support `-l, --limit <n>`. All commands accept the
top-level filters: `--format <json|summary>`, `--raw`, `--jq <expr>`, `--fields <list>`.

## Output formats

Every command accepts `--format <kind>` at the root:

- `--format json` (default) — emits the full structured envelope. Stable
  shape across releases. Composes with `--jq`, `--fields`, and `--raw`.
- `--format summary` — emits a fixed human-readable rendering. Stable
  field set per resource (identifier, title, state, assignee, project,
  labels, URL for issues; analogous fields for projects, comments,
  cycles, milestones, teams, labels, users). Use this for terminals,
  agents, or anywhere you'd otherwise pipe through `jq` / `python -c`
  to extract a few fields.

```bash
el-linear issues read DEV-123 --format summary
# DEV-123  Fix login flicker on Safari 17
# State:    In Progress
# Assignee: Alice
# Project:  Auth Refactor
# Labels:   Feature, tool
# URL:      https://linear.app/acme/issue/DEV-123/...
#
#   Login button briefly disappears when the form first loads.
#   Repro on Safari 17 / iOS 17. Chrome / Firefox unaffected.
#   ... (truncated; --format json for full body)

el-linear issues search "auth" --format summary
# ID        TITLE                                                    STATE        ASSIGNEE
# ---------------------------------------------------------------------------------------
# DEV-100   Migrate auth middleware to new session store             In Progress  Alice
# DEV-104   Auth callback returns 502 under load                     Todo         Bob
#
# 2 issues
```

Existing `issues list`, `issues search`, and `projects list` commands
continue to accept their per-command formats too: `table`, `md`,
`markdown`, `csv` — those go to the per-command rendering path. The
global `summary` value works on every read/list command.

`--format summary` does not compose with `--jq` (jq is JSON-only) or
`--fields` (fields filter the JSON shape, not the rendered text). Use
`--raw` together with `--format summary` to render a list envelope as a
bare item-list rather than an envelope.

## Wrapping Linear references in arbitrary text

`el-linear refs wrap` takes plain text on stdin (or via `--file`) and rewrites
every recognized Linear issue identifier (e.g. `DEV-123`, `LIN-1`) as a real
link. By default it validates each candidate against the workspace — strings
that match the `[A-Z]+-\d+` shape but aren't real issues (e.g. `ISO-1424`)
are left untouched.

```bash
# stdin → stdout, markdown output (default)
echo "see DEV-100 and ISO-1424" | el-linear refs wrap
# → see [DEV-100](https://linear.app/acme/issue/DEV-100/) and ISO-1424

# read from a file
el-linear refs wrap --file notes.md > notes.linked.md

# Slack mrkdwn output: <url|label>
el-linear refs wrap --target slack < release-notes.md

# offline regex-only fallback — wraps every match, no API calls,
# may produce broken links for IDs that don't exist in the workspace
el-linear refs wrap --no-validate < notes.md
```

Wrapping is **idempotent** — running it again on already-wrapped output is a
no-op. Refs are also skipped inside fenced code blocks, inline backticks,
existing markdown or Slack links, angle-bracket autolinks, and bare URLs, so
it's safe to pipe documents that already contain a mix of formatted links
and bare identifiers.

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
