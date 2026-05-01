# Contributing to linctl

Thanks for considering a contribution. linctl is a small, focused CLI — most
work falls into one of three buckets:

1. **Adding a Linear command** that maps onto an existing Linear API resource.
2. **Fixing CLI ergonomics** — error messages, output formatting, flags.
3. **Improving the Claude Code skill** that ships with the package.

## Setup

```bash
git clone https://github.com/enrichlayer/linctl.git
cd linctl
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
  in `LINEAR_API_TOKEN` or `~/.config/linctl/token` for any test that hits the
  live API. The default test suite mocks Linear and runs offline.

## Workflow

We use trunk-based development. Branch off `main`, open a PR, get a green CI,
land. There's no `dev` branch.

```bash
git checkout -b add-batch-archive
# ...edit...
pnpm test && pnpm exec biome check --fix src/
git commit -m "feat: add batch archive command"
git push -u origin add-batch-archive
gh pr create --fill
```

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

Most Linear resources are reachable via the existing `linctl graphql` escape
hatch — that's often enough. If you find yourself running the same query
repeatedly, that's a candidate for a first-class command.

1. Add the GraphQL query to `src/queries/<resource>.ts`.
2. Add a service method to `src/utils/linear-service.ts` if SDK pagination
   helps, or call `graphQLService.rawRequest` directly otherwise.
3. Add the command to `src/commands/<resource>.ts` with a `setup<Resource>Commands(program)` export.
4. Wire it into `src/main.ts`.
5. Tests: cover the command with mocked `graphQLService` / `linearService`.

The structural test in `src/commands/cli-consistency.test.ts` enforces:

- All `list` subcommands accept `--limit`.
- All connection queries use `nodes { ... }` (Linear's pagination shape).

## Reporting bugs

Open an issue with:

1. The exact command you ran.
2. The output you got (run with `LINCTL_DEBUG=1` for stack traces).
3. The output you expected.

Don't paste your API token. linctl never logs it, but redact it in shell
output you copy.

## Security

Found a vulnerability? Email security@enrichlayer.com instead of opening a
public issue. We'll acknowledge within two business days.
