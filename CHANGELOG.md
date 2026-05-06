# Changelog

All notable changes to `@enrichlayer/el-linear` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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


[Unreleased]: https://github.com/enrichlayer/el-linear/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.4.0
[1.3.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.3.0
[1.2.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.2.0
[1.1.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.1.0
