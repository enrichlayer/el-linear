# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

`el-linear` is a CLI for Linear.app, written in TypeScript. It wraps the
`@linear/sdk` for some calls and uses raw GraphQL for others. The CLI is
built with [commander](https://www.npmjs.com/package/commander).

## Architecture

```
src/
├── main.ts               # commander entry; wires every setupXCommands()
├── commands/             # user-facing subcommands
│   ├── issues.ts         # CRUD + history + relations + auto-link
│   ├── comments.ts       # comment CRUD with mention resolution
│   ├── labels.ts
│   ├── projects.ts, teams.ts, users.ts, cycles.ts, releases.ts, …
│   ├── search.ts         # semantic search
│   ├── graphql.ts        # raw GraphQL escape hatch
│   └── config.ts         # config show/init
├── config/
│   ├── config.ts         # ~/.config/el-linear/config.json loader
│   ├── resolver.ts       # name → UUID resolution (teams, members, labels)
│   ├── term-enforcer.ts  # configurable term-spelling enforcement
│   ├── issue-validation.ts
│   └── status-defaults.ts
├── queries/              # GraphQL query/mutation strings, per resource
├── utils/
│   ├── graphql-service.ts        # raw GraphQL client (uses @linear/sdk's transport)
│   ├── linear-service.ts         # SDK wrapper for paginated lists
│   ├── auth.ts                   # token resolution
│   ├── mention-resolver.ts       # @user → prosemirror mention
│   ├── issue-reference-wrapper.ts # ENG-100 → markdown link
│   ├── auto-link-references.ts   # creates sidebar relations
│   ├── workspace-url.ts          # caches viewer.organization.urlKey
│   └── output.ts, table-formatter.ts, validators.ts, logger.ts
└── types/                # shared types
```

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

- **Always prefer deterministic CLI behavior over skill markdown.** This is the default — the skill is a last resort. When the same outcome can be achieved by code in this CLI or by a markdown rule in `claude-skills/`, code wins, every time. A rule in `SKILL.md` relies on every agent reading and following it — probabilistic, and it fails silently when the agent skims past the section. A check or affordance in the CLI runs every time, returns structured output, and is unit-testable. Before adding a step to a skill ("do X, then check Y, then ask Z"), ask whether the CLI could: (a) make X automatic, (b) detect Y and emit a structured warning, or (c) refuse Z with a typed error. If yes, file a Linear issue or write the code first; the skill should only fill the gaps the tool genuinely can't close. Concrete patterns that belong in the tool, not the skill:

  - **Pagination / truncation cues** — emit `pageInfo.hasNextPage` or a `results_truncated` warning when `nodes.length === limit`, instead of telling agents to "bump `--limit`".
  - **Identifier shapes** — accept the formats users actually paste (URLs, slugs, short UUID prefixes) in resolvers, instead of telling agents to parse them in markdown.
  - **Disambiguation** — return a structured `ambiguous` error with candidate matches, instead of telling agents to "ask the user."
  - **Title / label conventions** — enforce in `issue-validation.ts` so the create call rejects bad shapes (or enriches the error with suggestions), instead of documenting "use this verb."

  **Skill prose is reserved for non-deterministic, judgment-based problems** that the tool genuinely cannot encode: when to broaden a search, who to ask, what to do when a CLI call returns ambiguous results, when to escalate to the user vs. proceed. If a rule can be expressed as "the CLI does X, then if Y, do Z" with no human judgment in the middle, it belongs in the CLI. Reverse pressure: when a skill PR is proposed, the default reviewer question is **"why isn't this in the CLI?"** — and the burden is on the skill change to justify why a deterministic implementation isn't feasible.

## Common tasks

### Add a Linear command

Most things should start as a `el-linear graphql` invocation. If you find
yourself running the same query repeatedly, promote it to a first-class
command:

1. **Check the SDK first.** Open `@linear/sdk`'s exported `LinearClient`
   methods. If the call is expressible as `client.foo({...})`, add a
   service method on `LinearService` and skip steps 2-3 of the GraphQL
   path. The SDK-preference rule above applies.
2. Only if the SDK can't express it: add the GraphQL query to
   `src/queries/<resource>.ts` with a docstring naming the SDK gap
   (batching, missing field, etc.) so the next maintainer can revisit
   on SDK upgrades.
3. Call it from a service method in `src/utils/linear-service.ts` (for
   paginated lists, where the SDK's pagination helper saves work) or via
   `graphQLService.rawRequest()` for the raw-query path.
4. Add the command in `src/commands/<resource>.ts` with a setup function.
5. Wire it into `src/main.ts`.
6. Test with mocked `graphQLService` and `linearService`.

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
