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

### PR title guard

Because release-please reads conventional commit subjects on `main`, CI validates
PR titles before merge:

- Every PR title must start with a Conventional Commit type.
- PRs touching published el-linear surface (`src/`, `claude-skills/`,
  `README.md`, `LICENSE`, `package.json`, or release-please metadata) must use a
  releaseable type: `fix:`, `feat:`, or a breaking-change `!` marker.
- CI/docs/test-only PRs can use non-release conventional types such as `ci:`,
  `docs:`, or `test:`.
- **`pnpm-lock.yaml` is not a published surface.** It is not in `package.json`'s
  `files`, so it is never shipped, and a consumer resolves our dependencies from
  the **ranges in `package.json`** — never from our lockfile. A lockfile-only PR
  (the shape every routine dependabot bump takes) therefore needs no release and
  may use `build(deps):`.
- **`package.json` is checked per-key, not wholesale.** Only the keys that reach a
  consumer make it a published surface:

  | Key | Consumer-visible? |
  |---|---|
  | `dependencies`, `optionalDependencies`, `peerDependencies` | **yes** — resolved at the consumer's install |
  | `engines`, `bin`, `exports`, `files`, `name`, `version` | **yes** |
  | `devDependencies` | **no** — never installed by a consumer, and the build is `tsc`, not a bundler, so no dev tool is inlined into `dist/` |
  | `scripts` | **no** for purely local targets (`lint`, `test`, `typecheck`). **Yes** for two kinds: install-time lifecycle scripts (`preinstall` / `install` / `postinstall` / `prepare`), which run on a **consumer's** machine — and build/publish-time scripts (`build`, `prepack`, `prepublishOnly`, …), which run on the **release runner** and **produce the published `dist/`**. Editing `scripts.build` changes the bytes in the tarball even though it touches no dependency. |

  So a **major** dev-dependency bump — which rewrites the range in `package.json`
  and is the one dependabot shape the lockfile rule above does not cover — passes
  with `build(deps-dev):` and cuts no release. A **runtime** dependency range bump
  still requires `fix:`/`feat:` and still cuts a release: that half is the reason
  the gate exists.

  **Fail-closed:** if the check cannot read both sides of the `package.json` diff
  (file added or deleted, unparseable, shallow fetch), it falls back to treating the
  whole file as published. A release gate that guesses "probably fine" when it cannot
  see the diff is not a gate.
- release-please release PRs titled like `chore(main): release 1.37.3` are
  accepted.

This is intentionally deterministic: a source change titled
`DEV-1234 add a flag` fails before merge because it would land on `main` without
opening a release PR.

#### ⚠️ A single-commit PR squashes under the COMMIT subject, not the PR title

The guard above validates the **PR title** — but that is not always what lands on
`main`, and release-please only ever reads what lands.

This repo's `squash_merge_commit_title` is **`COMMIT_OR_PR_TITLE`**, which means:

| PR has… | Squash subject comes from |
|---|---|
| exactly **one** commit | the **commit** subject — the PR title is ignored |
| **two or more** commits | the **PR title** |

Rebase-merge and merge-commit are also enabled, and both land the original commit
subjects verbatim regardless of the PR title.

**So retitling a single-commit PR does not change what release-please sees.** A PR
whose commit says `docs:` but whose title says `feat:` will squash as `docs:`,
publish nothing — and the `validate` check will be **green**, because it only ever
looked at the title.

If you retitle a PR to make it releaseable, make the **commit subject** match:

```bash
git commit --amend -m "feat(scope): ..."   # single-commit PR
git push --force-with-lease
```

…or push a second, correctly-typed commit (which also works, since two commits make
the squash use the PR title).

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
