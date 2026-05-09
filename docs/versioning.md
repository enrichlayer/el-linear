# Versioning policy

`@enrichlayer/el-linear` follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`) with a team convention layered on top: **default toward PATCH** unless the change clearly justifies more.

The intent is that consumers — humans and LLMs writing wrapping scripts — can upgrade aggressively within a major line without re-reading docs.

## When to use PATCH (`1.8.0` → `1.8.1`)

- Bug fixes
- Test fixes / flake elimination
- Internal refactors with no public API change
- Documentation
- **Additive enhancements that don't change existing behavior**, including:
  - New optional flags with safe defaults (e.g. `--format summary`)
  - New helper / utility / formatter that's opt-in
  - Performance improvements that don't shift output

If existing users running existing commands wouldn't notice the change without reading the changelog, ship it as patch.

## When to use MINOR (`1.8.0` → `1.9.0`)

- New top-level command surface that changes ergonomics significantly (a new subcommand group, a new mandatory workflow step)
- Default behavior changes that callers will notice without opting in
- Major new feature with its own configuration surface (a new authentication mode, a new output target like webhook delivery)

## When to use MAJOR (`1.x.x` → `2.0.0`)

- Breaking changes to commands, flags, output shapes, config-file format, env var names
- Renames of binaries, packages, or canonical paths
- Removed flags / commands (after deprecation cycle)
- Default behavior changes that materially shift workflows

## Conventional commits → bump mapping

The repo uses [Conventional Commits](https://www.conventionalcommits.org/). The release-please action maps types to bumps with the standard defaults:

| Commit type | Default bump | Override hint |
|---|---|---|
| `fix:` | PATCH | — |
| `chore:`, `docs:`, `style:`, `refactor:`, `test:`, `build:`, `ci:`, `perf:` | none (no release) | — |
| `feat:` | MINOR | If the feature is purely additive (matches PATCH rules above), tag as `chore:` instead, or include `Release-As: x.y.z` in the commit footer to override. |
| Any with `BREAKING CHANGE:` footer or `!` after type | MAJOR | — |

If your `feat:` change matches the additive-enhancement rules above and you want a patch bump, prefer `chore:` so release-please doesn't propose a minor. The team convention is conservative bumps; reach for minor when ergonomics actually shift.

## Release process

Two paths: automatic (default) and manual (bootstrap or hotfix).

### Automatic — release-please (default)

1. PR with conventional commits merges to `main`.
2. [`release-please`](https://github.com/googleapis/release-please-action) opens (or updates) a "Release vX.Y.Z" PR aggregating commits since the last release. The PR contains the `package.json` version bump and the `CHANGELOG.md` entry. No manual edits.
3. Review the release PR, merge it.
4. release-please tags `vX.Y.Z` on merge. The existing [`release.yml`](../.github/workflows/release.yml) workflow picks up the tag, verifies the version, runs gitleaks, builds, and publishes to npm.

### Manual (bootstrap / hotfix only)

1. Edit `package.json` version + `CHANGELOG.md` directly.
2. Merge the PR.
3. From `main`: `git tag -a vX.Y.Z -m "release X.Y.Z"` then `git push origin vX.Y.Z`.
4. `release.yml` publishes to npm.

This path is for the bootstrap commit that introduces release-please itself, or for emergency out-of-band releases. The default flow is the automatic one above.

## What does NOT trigger a release

- A merge to `main` with only `chore:` / `docs:` / `style:` / `refactor:` / `test:` / `build:` / `ci:` / `perf:` commits since the last release.
- A merge that doesn't touch the package (e.g., README-only changes that aren't in `package.json#files`). release-please will still open a release PR if the changelog grows; merge it only when you actually want a publish.
