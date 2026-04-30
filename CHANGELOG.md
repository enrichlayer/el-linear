# Changelog

All notable changes to `@enrichlayer/linctl` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/enrichlayer/linctl/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/enrichlayer/linctl/releases/tag/v1.1.0
