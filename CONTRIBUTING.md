# Contributing to el-linear

Thanks for considering a contribution. el-linear is a small, focused CLI — most
work falls into one of three buckets:

1. **Adding a Linear command** that maps onto an existing Linear API resource.
2. **Fixing CLI ergonomics** — error messages, output formatting, flags.
3. **Improving the Claude Code skill** that ships with the package.

## Setup

```bash
git clone https://github.com/enrichlayer/el-linear.git
cd el-linear
pnpm install
pnpm test          # 56 files, 770+ tests
pnpm exec tsc --noEmit
pnpm exec biome check src/
pnpm run build
node dist/main.js --version
```

You'll need:

- Node ≥ 22
- pnpm ≥ 10
- A Linear personal API token (https://linear.app/settings/account/security)
  in `LINEAR_API_TOKEN` or `~/.config/el-linear/token` for any test that hits the
  live API. The default test suite mocks Linear and runs offline.

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

Profile resolution (multi-workspace support) is centralized in
`src/config/paths.ts` — see the **Profiles** section of the README.

## Workflow

We use trunk-based development. Branch off `main`, open a PR, get a green CI,
land. There's no `dev` branch.

```bash
git checkout -b add-batch-archive
# ...edit...
pnpm test && pnpm exec biome check --fix src/
git commit -m "feat: add batch archive command"
git push -u origin add-batch-archive
gh pr create   # opens the PR template in $EDITOR — fill in each section
```

> Use plain `gh pr create` (not `--fill`): `--fill` reuses the commit message as
> the body and skips `.github/PULL_REQUEST_TEMPLATE.md`, so the What / Why / How
> / Test sections never get prompted. The web UI loads the template automatically.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — user-visible feature.
- `fix:` — bug fix.
- `chore:` — internals, dependency bumps, repo hygiene.
- `refactor:` — rework with no behavior change.
- `docs:` — README/CHANGELOG/CONTRIBUTING updates.
- `test:` — test-only changes.

The commit subject becomes the changelog line, so write it as if the user
will read it.

## Code style

- TypeScript, strict mode. No `any` without a written reason.
- Biome handles formatting + lint. `pnpm exec biome check --fix src/` before
  pushing.
- Tests use vitest. Co-locate with source: `foo.ts` + `foo.test.ts`.
- Each command has a setup function (`setupFooCommands(program)`) imported by
  `src/main.ts`.

## Adding a Linear command

Most Linear resources are reachable via the existing `el-linear graphql` escape
hatch — that's often enough. If you find yourself running the same query
repeatedly, that's a candidate for a first-class command.

1. **Check the `@linear/sdk` first.** If the call is expressible as
   `client.foo({...})`, add a service method on `LinearService` and skip the
   raw-query step — the SDK gives typed inputs, pagination helpers, and one
   place to absorb schema changes (see the SDK-preference rule in `CLAUDE.md`).
2. Only if the SDK can't express it: add the GraphQL query to
   `src/queries/<resource>.ts`, with a docstring naming the SDK gap (batching,
   missing field, mutation the SDK doesn't expose) so the next maintainer can
   revisit on SDK upgrades.
3. Call it from a service method in `src/utils/linear-service.ts` (for
   paginated lists) or via `graphQLService.rawRequest` for the raw-query path.
4. Add the command to `src/commands/<resource>.ts` with a `setup<Resource>Commands(program)` export.
5. Wire it into `src/main.ts`.
6. Tests: cover the command with mocked `graphQLService` / `linearService`.

The structural test in `src/commands/cli-consistency.test.ts` enforces:

- All `list` subcommands accept `--limit`.
- All connection queries use `nodes { ... }` (Linear's pagination shape).

## Reporting bugs

Open an issue with:

1. The exact command you ran.
2. The output you got (run with `EL_LINEAR_DEBUG=1` for stack traces).
3. The output you expected.

Don't paste your API token. el-linear never logs it, but redact it in shell
output you copy.

## Security

Found a vulnerability? Email security@enrichlayer.com instead of opening a
public issue. We'll acknowledge within two business days.
