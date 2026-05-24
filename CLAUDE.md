# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

`el-linear` is a CLI for Linear.app, written in TypeScript. It wraps the
`@linear/sdk` for some calls and uses raw GraphQL for others. The CLI is
built with [commander](https://www.npmjs.com/package/commander).

## Architecture

The annotated `src/` source-tree map lives in
[CONTRIBUTING.md](CONTRIBUTING.md#architecture) — read it on demand rather than
carrying it in every session's context.

## Profiles

Multiple Linear workspaces (e.g. day-job + side-project) share the same
binary via named **profiles**. A profile is a directory under
`~/.config/el-linear/profiles/<name>/` that holds its own `token` +
`config.json`.

**Resolution order (highest first):**

1. `--profile <name>` flag (per-invocation override)
2. `EL_LINEAR_PROFILE` env var
3. `~/.config/el-linear/active-profile` (single-line marker file)
4. Legacy single-file paths (`~/.config/el-linear/{token,config.json}`)

The legacy fallback means existing single-profile users see no
behavior change — multi-profile is purely opt-in.

**Touch points** (single source of truth: `src/config/paths.ts`):

- `resolveActiveProfile(env, fsOps) → ProfilePaths` — pure resolution.
- `setActiveProfileForSession(name)` — `main.ts` calls this from the
  preAction hook when `--profile` is passed.
- `loadConfig` (`src/config/config.ts`) and `getApiToken`
  (`src/utils/auth.ts`) both call `resolveActiveProfile()` and pick
  the active profile's path, falling back to the legacy path when the
  per-profile file is missing.
- The init wizard's `readConfig / writeConfig / readToken / writeToken`
  in `src/commands/init/shared.ts` operate on the active profile's
  paths, so `el-linear init` (and every `init <step>`) writes to the
  right place automatically.

**Subcommands:** `el-linear profile {list,current,use,add,remove}`
(see `src/commands/profile.ts`).

## Conventions

- **No `any`** without a written reason. Strict TypeScript.
- **Co-located tests**: `foo.ts` lives next to `foo.test.ts`. vitest, mock-heavy.
- **One setup function per command file** named `setup<Resource>Commands(program)`, imported by `main.ts`.
- **Output is JSON by default.** Use `outputSuccess(...)` / `outputWarning(...)` / `handleAsyncCommand(...)` from `utils/output.ts`. Never `console.log`.
- **Always lint before push**: `pnpm exec biome check --fix src/`.
- **American English** in code, comments, docstrings, CHANGELOG, README, and commit messages. `behavior`, `honor`, `color`, `serialize`, `recognize` — not `behaviour`, `honour`, `colour`, `serialise`, `recognise`. The package is published on npm under an American audience and the Linear API uses American spellings; staying consistent avoids the mixed-spelling drift that `git grep` reveals every few months.
- **Prefer the `@linear/sdk` over raw GraphQL.** When an `@linear/sdk` method covers the call (e.g. `client.issues`, `client.users`, `client.issueLabels`, `client.team(id).projects()`), use it via `LinearService` rather than writing a new query string for `graphQLService.rawRequest()`. The SDK gives you typed inputs, automatic pagination helpers, and one place to absorb schema changes. Reach for raw GraphQL **only** when the SDK can't express the call without losing something concrete — and call out why in a docstring on the query string. Legitimate reasons:
  - **Batching with `@include`/`@skip` directives** — e.g. fetching team `projects + members + labels` in one round-trip when the SDK would force three.
  - **Selecting fields the SDK's typed wrappers omit** — anything on `viewer.organization`, attachment metadata Linear added after the SDK release, raw connection cursors, etc.
  - **Mutations the SDK doesn't expose** (rare; document the SDK gap in the docstring so we can revisit on SDK upgrades).
  - **Performance-critical loops** where the SDK's per-edge resolver promises produce N+1 round-trips.

  Bare "we want a custom field set" is not a sufficient reason — `client.issues({ ... })` already lets you destructure exactly the fields you need.

  This rule and the deterministic-CLI rule below own **different layers** and don't conflict: the `@linear/sdk` preference governs the **data-fetch layer** (how a command talks to Linear — typing, pagination, schema absorption), while "deterministic CLI over skill prose" governs the **command/surfacing layer** (turning those results into structured output, truncation cues, and typed errors). The CLI doesn't re-implement what the SDK already provides — it surfaces it.

- **Prefer deterministic CLI behavior over skill prose** — the team-wide rationale lives in the canonical **"Deterministic Tools Over Prose"** section of the **`vertical-int/tools` repo's `CLAUDE.md`** (a sibling repo, not a path inside this checkout); don't restate it here. In *this* repo it means the affordances belong in code, not in `claude-skills/` markdown: truncation cues via `outputWarning` when `nodes.length === limit`; identifier-shape acceptance (URLs, slugs, short UUID prefixes) in the resolvers; structured `ambiguous` / not-found errors with candidate matches; and title/label-shape enforcement in `issue-validation.ts`. When tempted to add a "do X, then check Y" step to a skill, make the CLI do/detect/refuse it instead — the default reviewer question on a skill PR is **"why isn't this in the CLI?"**

## Common tasks

### Add a Linear command

The full step-by-step (SDK-first check → query → service → command → wire →
test) lives in [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-linear-command).

### Debug a failing test

```bash
pnpm exec vitest run src/path/to/foo.test.ts
EL_LINEAR_DEBUG=1 node dist/main.js <command> --api-token "$LINEAR_API_TOKEN"
```

`EL_LINEAR_DEBUG=1` enables stack traces on errors.

## What NOT to do

- Don't add features that require a config the user has to learn unless
  they're broadly useful. el-linear already has a lot of surface area.
- Don't change the JSON output shape of existing commands without a
  CHANGELOG entry. The CLI is meant to be machine-readable; downstream
  scripts depend on the shape.
- Don't introduce a third dependency on a fuzzy-matching library. Member
  / team / label resolution is deterministic by design.
