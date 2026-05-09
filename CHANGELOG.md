# Changelog

All notable changes to `@enrichlayer/el-linear` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **`--format summary` coverage** for `documents list/read`, `templates
  list/read`, `attachments list`, and `releases list/read`. These were
  previously falling back to the generic key/value renderer because no
  dedicated formatter existed; with this release they each get a stable
  table layout matching the rest of the resource types. Closes ALL-936.
- **README and SKILL.md guidance** explicitly steers callers (and LLM
  agents) toward `--format summary` instead of `python -c "json.load..."`
  / `jq` pipelines for human-readable output. The skill lists concrete
  anti-patterns to avoid.

### Fixed

- **`--from-template` no longer requires a local title.** When
  `el-linear issues create --from-template <id>` is invoked without a
  positional/`--title` value, the create mutation now omits the title
  field so Linear copies the template's title server-side, matching the
  documented behavior.
- **`--version` reports the package version.** The `commander` version
  literal had drifted past the published `package.json` version.

### Security

- **Profile name validation tightened.** Path traversal via `--profile`,
  `EL_LINEAR_PROFILE`, and the `~/.config/el-linear/active-profile`
  marker file is now rejected at every entry point. Previously only the
  `profile add/use/remove/migrate-legacy` subcommands validated; the
  three other entry points let `../../../tmp/x` style names through to
  `path.join()`. The shared `isSafeProfileName` helper now lives in
  `src/config/paths.ts`.
- **Cross-profile token-leak guard.** When a profile is explicitly
  selected (`--profile`, `EL_LINEAR_PROFILE`, or active-profile marker)
  and its token file is missing, the CLI now throws instead of silently
  falling back to the legacy single-file token. Falling back posted
  writes to the wrong workspace.
- **Prototype pollution guard in config merge.** A hand-edited
  `~/.config/el-linear/config.json` containing `__proto__`,
  `constructor`, or `prototype` keys is now ignored during `deepMerge`.

## [1.8.1] — 2026-05-09

Adds a global `--format summary` output mode for human-readable rendering
of single-resource and list payloads. Designed to replace the
`el-linear ... | python -c "json.load(...)"` and `jq` pipelines that
every consumer (humans and LLMs) ends up writing to extract a brief
summary from the default JSON envelope.

### Added

- **`--format <kind>` root flag.** Accepts `json` (default, unchanged
  behavior) or `summary`. The `summary` mode emits a fixed
  human-readable rendering with stable field ordering per resource
  type. Format value is also accepted on the per-command `--format`
  options of `issues list`, `issues search`, and `projects list`
  alongside the existing `table` / `md` / `csv` options.
- **Summary formatters** for issues (single + list), projects
  (single + list), comments (single + list), cycles (single + list),
  project milestones (single + list), teams (list), labels (list),
  users (single + list), search results (cross-resource list), plus
  a generic key/value fallback for resource shapes the dispatcher
  doesn't recognize. Single-issue summary shows identifier, title,
  state, assignee, project, labels, URL, and the first ten lines of
  the description with a truncation footer.
- **Bundled SKILL.md guidance.** `claude-skills/linear-operations/SKILL.md`
  now opens with an explicit instruction to prefer `--format summary`
  over piping through `jq` or `python -c` for terminal / agent output.
  Ships in the npm tarball.

### Behavior

- Existing JSON output is unchanged when `--format` is not set or set
  to `json`. `--raw`, `--jq`, and `--fields` continue to work in
  json mode.
- `--raw` composes with `--format summary` (an envelope `{data:[...]}`
  is unwrapped before formatting). `--jq` and `--fields` do not
  compose with summary mode — they're JSON-shape filters.


## [1.7.0] — 2026-05-08

This release rounds out the issue-creation defaults and adds disk caching
for the workspace list commands. Drops the need for a personal-skill
"always set this" rule for assignee + priority on every `issues create`.

### Added

- **`config.defaultAssignee` + `--no-assignee` flag.** Optional default
  assignee for `el-linear issues create`, applied when `--assignee` is not
  passed. Accepts the same shapes as the `--assignee` flag (alias, display
  name, email, or UUID). Pass `--no-assignee` to skip both flag and config
  for one invocation. Surfaced in the `init defaults` wizard with a
  prompt that accepts `none` as an explicit clear.
- **`config.defaultPriority`.** Optional default priority for both
  `el-linear issues create` and `el-linear issues update`. Accepts the
  same keywords/numbers as `--priority`
  (`none|urgent|high|medium|normal|low` / `0`–`4`). Surfaced in the
  `init defaults` wizard via a select prompt. The runtime path runs the
  stored value through `validatePriority` so a bad config value fails fast.
- **`config.cacheTTLSeconds` + `--no-cache` flag.** Configures the TTL
  (in seconds) of the new on-disk cache for `teams list`, `labels list`,
  and `projects list`. Defaults to `3600` (1 hour) when omitted. A value
  of `0` disables the cache. The `--no-cache` root flag bypasses the
  cache for one invocation. Surfaced in the `init defaults` wizard with
  numeric validation.
- **Disk cache for `teams list` / `labels list` / `projects list`.** Lives
  at `<profile-dir>/cache/<key>.json`, profile-aware so caches don't bleed
  between profiles. Keys include filter parameters (e.g.
  `labels-list-team:ENG-limit:100`) so different filter combos don't
  collide. Atomic writes (tmp + rename, mode 0644). Corrupt or
  unknown-version envelopes are silently treated as a miss and refetched.
  Write errors log to stderr but never fail the user's command.

### Changed

- **`init defaults` wizard now covers the new fields.** Three new
  sub-prompts (default assignee, default priority, cache TTL) sit between
  the existing prompts. Each defaults to "skip" so re-running the wizard
  with no input still produces a byte-identical config.

## [1.6.0] — 2026-05-08

This release completes OAuth 2.0 coverage across every CLI command and adds
two issue-authoring conveniences.

### OAuth completion

In 1.5.0 OAuth was wired into `init oauth` + storage + the `GraphQLService` /
`LinearService` constructors, but command call sites still resolved through
the personal-token-only `getApiToken()`. Two follow-ups landed:

- **Every command now uses the OAuth-aware resolver.** `createGraphQLService`
  and `createLinearService` are now async and dispatch through
  `getActiveAuth()`, which auto-refreshes near-expiry OAuth tokens. ~85 call
  sites migrated; the `--api-token` / `LINEAR_API_TOKEN` overrides keep
  working at the same precedence as before.
- **`FileService` now supports OAuth too.** `attachments create`,
  `embeds upload/download`, `issues create --attachment`, and the image-inlining
  in `issues read` / `read-shortcut` all worked under personal tokens but
  silently 401'd for OAuth users because `FileService` sent
  `Authorization: <token>` (no Bearer prefix). Now it accepts the same
  discriminated-union as the other services and sends the right header
  shape per credential kind.

### Added

- **`config.messageFooter` + `--footer` / `--no-footer` flags.** Text appended
  to issue descriptions on `el-linear issues create` and to comment bodies on
  `el-linear comments create`. Treat the value as a literal string — include
  any `\n\n---\n` separator yourself if you want a horizontal rule. The
  `--footer "..."` flag overrides the configured value for one invocation;
  `--no-footer` skips both flag and config.
- **`config.descriptionTemplates` + `--template <name>` flag.** Named
  description boilerplates for `el-linear issues create`. When `--template
  bug` is passed and neither `--description` nor `--description-file` is
  set, the template body is used as the description. Combining `--template`
  with an explicit description is a usage error (we throw rather than
  silently dropping one).

### Changed

- **`--priority none` now works** on `issues create` / `issues update`.
  Previously the keyword was rejected for create/update even though `0`
  ("No priority") is a real Linear state. `validatePriority` now accepts
  the full keyword set the filter parser already supported:
  `none`/`urgent`/`high`/`medium`/`normal`/`low` and numbers `0`–`4`. The
  `--priority` help text on every subcommand was updated to match.

## [1.5.0] — 2026-05-07

Two unrelated additions this release: OAuth 2.0 authentication, and a
migration path off the legacy single-file config layout.

### OAuth 2.0 (PKCE) authentication

A parallel to personal API tokens. Run `el-linear init oauth` to register
a Linear OAuth app, walk through the PKCE consent flow in your browser,
and persist tokens to `~/.config/el-linear/<profile>/oauth.json` (mode
0600). Access tokens auto-refresh in the background; refresh-token
failure surfaces as a clear "re-run `el-linear init oauth`" error.
Personal-token auth is unchanged and remains the default.

- `el-linear init oauth --revoke` — revoke stored OAuth tokens and remove
  `oauth.json`.
- `el-linear init oauth --no-browser` — force the headless paste-the-code
  fallback (for SSH sessions, sandboxed containers, etc.).
- `el-linear init oauth --port <n>` — override the localhost callback port
  (default 8765).
- Multi-select scope picker for the eight Linear OAuth scopes; defaults to
  `read`, `write`, `issues:create`, `comments:create`.
- `GraphQLService` now accepts either a personal API token or
  `{ oauthToken }`, sending the right `Authorization` header shape per
  Linear's docs (no `Bearer` prefix for personal tokens; `Bearer ` for
  OAuth).

### Legacy config migration

This release closes the gap between the legacy single-file config layout
(v1.0–1.3) and the named-profiles layout introduced in 1.4. Users who
upgraded with a legacy `config.json` still on disk but no usable token
were hitting a dead-end "Authentication required" error with no
documented recovery path. 1.5 detects that state automatically and ships
a one-shot migration command.

- **`el-linear profile migrate-legacy`** — copy the legacy
  `~/.config/el-linear/{config.json,token}` into a named profile in one
  step. Validates the token via `viewer { ... }` before writing anything
  to disk. Each step (profile dir, config copy, token write,
  active-profile marker) is independently idempotent. Token sources, in
  priority: `--token-from <path>`, `EL_LINEAR_TOKEN` env, hidden
  interactive prompt. Refuses to clobber a differing existing config or
  token unless `--force` is passed (and confirms interactively unless
  `--yes` is also passed). Never deletes the legacy files — rollback is
  always available.
- **Legacy-config drift detection** — when an auth call would otherwise
  fail with "No API token found", el-linear now checks for the
  post-upgrade drift state (legacy `config.json` present, no token, no
  profiles) and emits a one-shot stderr hint pointing the user at
  `migrate-legacy`. The hint also catches the related "broken
  active-profile pointer" case (`active-profile` names a profile whose
  dir doesn't exist) and points at `el-linear profile use`.
- `EL_LINEAR_SKIP_MIGRATION_HINT=1` — silences the hint for users who've
  decided to stay on the legacy single-file layout intentionally. Read at
  emission time so toggling it between commands works.

### Notes
- The migration hint is rate-limited to once per process and writes to
  stderr only, so machine callers parsing JSON on stdout are not affected.
- The underlying auth error still fires after the hint, so scripts continue
  to see the same non-zero exit code and parseable error payload.

## [1.4.0] — 2026-05-07

This release adds named **profiles** so you can switch between multiple Linear
workspaces without juggling tokens or config files. It also introduces an
`AGENTS.md` for OpenAI Codex compatibility (parallel to the existing
`CLAUDE.md`).

### Added
- **Profiles** — store multiple `(token, default team, workspaceUrlKey)`
  triples under `~/.config/el-linear/profiles/<name>/` and switch via
  `--profile <name>` or the `EL_LINEAR_PROFILE` env var. Useful for clients
  / contractor work / personal vs corporate accounts.
- `AGENTS.md` — Codex-format guidance (mirrors `CLAUDE.md`).

## [1.3.0] — 2026-05-06

This release adds `el-linear refs wrap`, a stdin/stdout filter that turns bare
Linear issue identifiers in arbitrary text (release notes, Slack drafts,
meeting notes, etc.) into real links.

### Added
- `el-linear refs wrap` — read text from stdin (or `--file <path>`) and rewrite
  every recognized Linear issue identifier as a link, validated against the
  workspace. Unresolvable IDs (e.g. ISO codes) are left as plain text.
- `--target markdown` (default) emits `[DEV-123](https://linear.app/...)`.
- `--target slack` emits Slack mrkdwn `<https://linear.app/...|DEV-123>`.
- `--no-validate` skips workspace validation and wraps every regex match;
  prints a stderr advisory so the warning can be redirected separately from
  the rewritten stdout stream.

### Changed
- `wrapIssueReferencesAsLinks` now accepts an optional fourth `target`
  argument (defaulting to `"markdown"`) and protects existing Slack-style
  `<url|label>` links from re-wrapping. Existing callers (`issues
  create/update`, `comments create/update`) keep their previous behavior.

## [1.2.0] — 2026-05-06

This release adds the interactive setup wizard, `el-linear init`, plus a
documented configuration schema so any LLM or script can produce an
equivalent config without running the prompts. It also reverts the
in-progress rename to `@enrichlayer/linctl` (never published) — the
package stays at `@enrichlayer/el-linear` because of an npm name
collision with [dorkitude/linctl](https://github.com/dorkitude/linctl).

### Reverted rename

The `1.1.0` migration recipe (renaming to `@enrichlayer/linctl`) is
withdrawn. The shipped name and binary remain `el-linear`. For users who
followed the migration locally during the brief window where the rename
was on `main`:

- `~/.config/linctl/` is read as a legacy fallback if `~/.config/el-linear/`
  is empty. Move it back at your leisure.
- `LINCTL_DEBUG` is honored as a legacy alias for `EL_LINEAR_DEBUG`.

### Added
- `el-linear init` — full setup wizard. Skip is the default at every prompt;
  only the API token is required.
- `el-linear init token` — set or replace the Linear API token (validates
  by calling `viewer { ... }` before saving).
- `el-linear init workspace` — pick a default team, refresh the team UUID
  cache, fetch `workspaceUrlKey` from `viewer.organization.urlKey`.
- `el-linear init aliases` — walk Linear users one-by-one, with a 4-way
  per-user menu (keep / edit / append / clear) plus quit-and-resume.
  Progress is persisted to `~/.config/el-linear/.init-aliases-progress`.
- `el-linear init aliases --import users.csv` — batch import aliases and
  GitHub / GitLab handles from a CSV.
- `el-linear init defaults` — default labels, status defaults, term
  enforcement rules.
- `docs/configuration.md` — full config reference. Documents what each
  wizard step writes so the config can be authored programmatically.

### Idempotency
Every wizard step reads existing config first, shows the current value,
and defaults the prompt to "keep as-is". Running the wizard twice with no
input changes produces a byte-identical `config.json` (keys are sorted on
write).

## [1.1.0] — 2026-04-30

This release renames the package from `@enrichlayer/el-linear` to
`@enrichlayer/linctl` ahead of an open-source release. It generalizes the
internal feature set, removes brand-specific defaults, and ships a Claude
Code skill with the package.

### Added
- Bundled Claude Code skill at `claude-skills/linear-operations/` — included
  in the published tarball so consumers can symlink it into their projects.
- `terms: TermRule[]` config key — multi-rule term enforcement (replaces the
  single-rule `brand: { name, reject }`). The legacy shape auto-migrates with
  a deprecation warning.
- Optional `workspaceUrlKey` config key to override the workspace slug used
  when wrapping issue references as markdown links. When omitted, linctl
  fetches it from `viewer.organization.urlKey` once per session.
- `LINCTL_DEBUG=1` env var enables debug stack traces (the legacy
  `EL_LINEAR_DEBUG` is honored as a fallback for one release).

### Changed
- **Renamed binary**: `el-linear` → `linctl`. Update your shell scripts and
  any CI invocations.
- **Renamed package**: `@enrichlayer/el-linear` → `@enrichlayer/linctl`.
- **Renamed config dir**: `~/.config/el-linear/` → `~/.config/linctl/`. If
  you have an existing config there, copy it (or symlink the new path to
  the old file).
- The `brand-validator` module is now `term-enforcer` with a more general
  multi-rule shape. Existing `brand: { name, reject }` configs are auto-
  migrated on load.

### Removed
- Hardcoded `verticalint` workspace URL key. Use `config.workspaceUrlKey`
  to override, or rely on the runtime API lookup.

### Migration

```bash
# 1. Move config (or set up a symlink — both work)
mv ~/.config/el-linear ~/.config/linctl

# 2. Re-link your CLI (if you used npm link locally)
cd path/to/linctl && npm link

# 3. Update aliases / scripts
sed -i.bak 's/\bel-linear\b/linctl/g' your-scripts.sh
```

The legacy `brand` config block is auto-migrated to `terms[]` on first run.


[Unreleased]: https://github.com/enrichlayer/el-linear/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.7.0
[1.6.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.6.0
[1.5.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.5.0
[1.4.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.4.0
[1.3.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.3.0
[1.2.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.2.0
[1.1.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.1.0
