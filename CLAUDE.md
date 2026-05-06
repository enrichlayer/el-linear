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

## Common tasks

### Add a Linear command

Most things should start as a `el-linear graphql` invocation. If you find
yourself running the same query repeatedly, promote it to a first-class
command:

1. Add the GraphQL query to `src/queries/<resource>.ts`.
2. Add a service method in `src/utils/linear-service.ts` (for paginated
   lists, where the SDK's pagination helper saves work) or call
   `graphQLService.rawRequest()` directly otherwise.
3. Add the command in `src/commands/<resource>.ts` with a setup function.
4. Wire it into `src/main.ts`.
5. Test with mocked `graphQLService` and `linearService`.

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
