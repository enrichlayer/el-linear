# Changelog

All notable changes to `@enrichlayer/el-linear` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [1.9.0](https://github.com/enrichlayer/el-linear/compare/v1.8.1...v1.9.0) (2026-05-09)


### Features

* **auth:** add OAuth 2.0 (PKCE) authentication ([#18](https://github.com/enrichlayer/el-linear/issues/18)) ([4e3b59f](https://github.com/enrichlayer/el-linear/commit/4e3b59f501e975b7b291d6926dba16a7d5a4bd0d))
* **auth:** migrate command call sites to OAuth-aware getActiveAuth ([#19](https://github.com/enrichlayer/el-linear/issues/19)) ([76c7e8d](https://github.com/enrichlayer/el-linear/commit/76c7e8d70527644c4661f7805a02b7792a2922e1))
* **auth:** wire OAuth into FileService (last unmigrated auth path) ([#20](https://github.com/enrichlayer/el-linear/issues/20)) ([57a3d59](https://github.com/enrichlayer/el-linear/commit/57a3d59f2fa623de95a066eaad1f9cb1301d6eba))
* defaults (assignee, priority), disk cache, wizard prompts, team OAuth config ([#22](https://github.com/enrichlayer/el-linear/issues/22)) ([0525c2f](https://github.com/enrichlayer/el-linear/commit/0525c2f8a96c584f09ef900b6b307201888addea))
* **filters:** add --name to users/labels/projects list, --state/--exclude-state/--active to projects list ([#36](https://github.com/enrichlayer/el-linear/issues/36)) ([a52f005](https://github.com/enrichlayer/el-linear/commit/a52f005ea049038ea16fecd600d57dda9dd9b162))
* **format:** add --format summary for human-readable output ([#28](https://github.com/enrichlayer/el-linear/issues/28)) ([2bdf3d2](https://github.com/enrichlayer/el-linear/commit/2bdf3d24107b5d996738b54fbac07930c8fff5ae))
* **init:** interactive setup wizard (linctl init) ([#7](https://github.com/enrichlayer/el-linear/issues/7)) ([23c62f8](https://github.com/enrichlayer/el-linear/commit/23c62f8b7e7a72b57ea5c99e3d6711dfba3cc469))
* **profiles:** legacy config detection + migrate-legacy command [ALL-922,ALL-923] ([#17](https://github.com/enrichlayer/el-linear/issues/17)) ([4536396](https://github.com/enrichlayer/el-linear/commit/45363962c905f35a0a3f7928561a93518e540c86))
* **profiles:** switch between multiple Linear workspaces ([#15](https://github.com/enrichlayer/el-linear/issues/15)) ([0bd6c37](https://github.com/enrichlayer/el-linear/commit/0bd6c3742e2e74b4a72197818d594d47a9f725a7))
* **refs:** add wrap subcommand with markdown + slack emitters [ALL-917] ([#10](https://github.com/enrichlayer/el-linear/issues/10)) ([16ceea9](https://github.com/enrichlayer/el-linear/commit/16ceea954fbaef14ee2562234a3f9c215f44553c))


### Bug Fixes

* **auth:** serialize OAuth refresh against concurrent CLIs (ALL-931) ([#32](https://github.com/enrichlayer/el-linear/issues/32)) ([f569221](https://github.com/enrichlayer/el-linear/commit/f569221e7f490d549876800cf91cec2ed388b832))
* bump CLI version string to 1.4.0 (matching package.json + tag) ([#16](https://github.com/enrichlayer/el-linear/issues/16)) ([77e7c16](https://github.com/enrichlayer/el-linear/commit/77e7c169e67f2ff698539f0a6355ab3288843217))
* **profile:** atomic writes for migrate-legacy (ALL-932) ([#30](https://github.com/enrichlayer/el-linear/issues/30)) ([01131d1](https://github.com/enrichlayer/el-linear/commit/01131d10fc98822a1c6fb7a9fb783be6d0199ccb))
* **refs:** share protected-range scanner between wrap + extract (ALL-933) ([#33](https://github.com/enrichlayer/el-linear/issues/33)) ([9405eca](https://github.com/enrichlayer/el-linear/commit/9405eca427d2d7bd5c15d92cf20e49f187572832))
* **security:** OAuth callback + headless paste + data-file allowlist + rate limit (ALL-935 batch 2) ([#37](https://github.com/enrichlayer/el-linear/issues/37)) ([403a38a](https://github.com/enrichlayer/el-linear/commit/403a38abec6d3e792939b72cd0f041430c29c92f))
* **security:** redaction + scheme allowlist + unicode mentions (ALL-935) ([#35](https://github.com/enrichlayer/el-linear/issues/35)) ([5c344e9](https://github.com/enrichlayer/el-linear/commit/5c344e9e3ab8805cbdbf0d9aba8ad1741887aeff))
* **security:** snapshot oauthStatePath + profile-keyed loadConfig cache (ALL-935 deferred) ([#46](https://github.com/enrichlayer/el-linear/issues/46)) ([e614bff](https://github.com/enrichlayer/el-linear/commit/e614bffc852402813c75e51ecaf0b411f57431da))
* **summary:** sanitize terminal output + harden numeric edges (ALL-934) ([#31](https://github.com/enrichlayer/el-linear/issues/31)) ([3d1535a](https://github.com/enrichlayer/el-linear/commit/3d1535a5af7fd95ef7666e0c1ff97131a767ed8f))

## [Unreleased]

### Changed

- **Split `commands/issues.ts` into focused modules.** The 1865-line
  file mixed branch helpers, description prep, the wrap-and-resolve
  pipeline, the auto-link hook, and ten command handlers into a
  single module. Two helper modules carved out:
  - `commands/issues/branch.ts` — `toBranchName`, `gitCheckoutBranch`,
    + the Linear-branchName regex.
  - `commands/issues/description.ts` — `readDescriptionFile`,
    `resolveDescription`, the shared `wrapAndResolveRefs` core,
    `prepareAutoLinkedDescription`, `prepareDescriptionRewrite`,
    `pushDescriptionUpdate`, and `maybeAutoLink`.

  `commands/issues.ts` is now 1588 lines (was 1865) and focused on
  commander wiring + handlers + the remaining helpers
  (`createRelations`, attachment glue, retrolink, link-references).
  No behavior change; 1201/1201 tests still pass. Refs ALL-938.

### Security

- **OAuth read-modify-write now snapshots the target path.** Pre-fix,
  `readOAuthState` and `writeOAuthState` each called `oauthStatePath()`
  independently — if `setActiveProfileForSession()` ran between them
  (no current code path triggers this; defense in depth), the read
  and write would target different profiles. Post-fix, both helpers
  accept an explicit `targetPath` and `ensureFreshAccessToken` resolves
  the path once at the top of the lock-protected critical section.
  ALL-935 deferred fix.
- **`loadConfig` cache is now profile-keyed.** Pre-fix, switching the
  active profile mid-process and calling `loadConfig` again returned
  the OLD profile's config until `_resetConfigCacheForTests` ran.
  Post-fix, each profile (and the legacy single-file layout, keyed
  as `null`) gets its own cache slot. Today's CLI always sets the
  profile in `preAction` before any command body runs, so this is
  latent — but the keyed cache makes the behavior future-proof and
  removes a test-isolation footgun. ALL-935 deferred fix.

### Changed

- **Generic `table-formatter.ts` shared between issues and projects.**
  `commands/projects.ts` carried an 80-line `formatProjectsOutput`
  that reinvented column-width math, table padding, CSV quoting, and
  markdown pipe syntax — duplicating the renderers in
  `utils/table-formatter.ts` (which were hardcoded to `LinearIssue`).
  The renderers now take generic `ColumnDef<T>` /
  `MarkdownColumnDef<T>` and `commands/projects.ts` declares its
  own column definitions and calls the same
  `renderFixedWidthTable` / `renderCsv` / `renderMarkdownTable`
  helpers. Output is byte-equivalent. Refs ALL-938.
- **Typed `SearchIssueArgs` for `GraphQLIssuesService.searchIssues`.**
  Same treatment as `CreateIssueArgs` and `UpdateIssueArgs` — typed
  shape covers the two search modes (full-text query + structured
  filter) with appropriate fields for each. Caller sites in
  `commands/issues.ts` (`handleListIssues` and `handleSearchIssues`)
  now construct the typed args directly. Refs ALL-937.
- **Typed `UpdateIssueArgs` for `GraphQLIssuesService.updateIssue`.**
  Same treatment as `CreateIssueArgs` — `id` is required, the helper
  pipeline (`resolveUpdateContext`, `extractMilestoneNodes`,
  `resolveCycleIdForUpdate`, `resolveStatusIdForUpdate`,
  `buildUpdateInput`) all take the typed shape, the internal
  `as string`/`as string[]` casts are gone, and `buildUpdateArgs` in
  `commands/issues.ts` returns the typed args directly. Refs ALL-937.
- **Typed `CreateIssueArgs` for `GraphQLIssuesService.createIssue`.**
  The method (and its private helpers `resolveCreateFields`,
  `buildCreateInput`, `buildCreateResolveVariables`) used to accept
  `Record<string, unknown>` and re-cast every property internally
  (`args.assigneeId as string`, `args.labelIds as string[]`, etc.).
  A typo in a caller — `assigeeId` vs `assigneeId` — compiled
  cleanly and silently dropped the field. Now the args take a
  typed interface, the casts inside are gone, and the typo
  becomes a `tsc` error. First slice of the ALL-937 type-design
  refactor. Refs ALL-937.

### Changed

- **`splitList` accepts `string | undefined | null | false`** and
  returns `[]` for any falsy value, including commander's `false`
  (which is what `--no-foo` produces). Removes the per-callsite
  truthy-guard footgun. Refs ALL-938.
- **`outputWarning` no longer takes an unused `_type` parameter.** The
  three callers (`term-enforcer`, `issue-validation`, `issues create`)
  passed category strings (`"term_enforcement"`, `"validation"`,
  `"missing_fields"`) that the function never read. Drop the param;
  category info that mattered was already in the warning text.
  Refs ALL-938.
- **Funnel direct `process.stderr.write` calls through `logger.error`**
  in `graphql-issues-service.ts`, `disk-cache.ts`, and `commands/refs.ts`.
  Three of the four sites now go through the same exit point as the
  rest of the code's stderr output. Remaining `process.stdout.write`
  calls (jq result, `refs wrap` payload, `gdoc` markdown,
  `main.ts:110` JSON-error envelope) are intentional raw-stream emits
  and stay direct. Refs ALL-938.

### Changed

- **Extract shared `wrapAndResolveRefs` core for description
  rewriting.** `prepareAutoLinkedDescription` (issues create/update)
  and `prepareDescriptionRewrite` (`issues link-references
  --rewrite-description`) used to carry near-duplicate 25-line
  bodies that differed only in their return shape and opt-out
  semantics. Both now call one shared validate-refs-then-wrap
  helper; the wrappers handle the per-caller policy (the
  `--no-auto-link` opt-out, `preResolved: undefined` vs empty Map
  signaling). One place to fix bugs in the pipeline. Refs ALL-938.

### Changed

- **Centralized list-table renderer in the summary formatter.** The
  13 `formatXList` functions in `src/utils/formatters/summary.ts`
  used to inline their own column-width math, header/separator
  wiring, and footer pluralization. They now declare a `ColumnDef[]`
  and delegate to one shared `renderTable<T>` helper. Output is
  byte-identical (1200 tests still pass), but adding a new
  resource's table or adjusting an existing one is now a column
  declaration instead of 25 lines of width-math boilerplate. Refs
  ALL-938.

### Removed

- **Dead `outputSuccessAs` export** and the companion `meta.kind`
  inference path (`mapHint` table + `inferListKind` envelope hint
  lookup). `outputSuccessAs` had zero callers outside its own
  definition; no `outputSuccess({...})` site set `meta.kind`. Net
  ~50 lines deleted across `src/utils/output.ts` and
  `src/utils/formatters/summary.ts`. If a future caller needs
  shape-pinning, the right move is to wire the explicit kind into
  the existing dispatch instead of resurrecting the dead path.
  Refs ALL-938.
- **Double `--raw` unwrap in `emitSummary`.** `outputSuccess` already
  unwraps `{ data: [...] }` envelopes on the rawMode path; the second
  unwrap inside `emitSummary` was dead defensive code that obscured
  data flow. Refs ALL-938.

### Changed

- **`handleReadIssue` and `readIssues` consolidated.** Both functions
  were byte-equivalent; `commands/issues.ts` now imports `readIssues`
  from `commands/read-shortcut.ts` so the `issues read` subcommand
  and the top-level `read` shortcut go through one implementation.
  Refs ALL-938.

### Security

- **OAuth callback page no longer reflects attacker-controlled prose.**
  Previously the `error_description` from the redirect URL was
  embedded into the local listener's HTML response (with `<>&`
  stripped). An attacker who knew the local listener port could fire
  `http://localhost:<port>/oauth/callback?error=phish&error_description=Your+account+is+compromised…`
  and have arbitrary phishing prose render in the user's browser
  before the legitimate redirect arrived. Now the page renders a
  fixed string ("Authorization failed. Return to your terminal —
  the CLI has the details."); the upstream detail is logged to the
  CLI where it belongs. Refs ALL-935.
- **`init oauth` headless flow rejects bare-code pastes by default.**
  Pre-fix, pasting just the authorization code (no surrounding URL)
  silently fabricated `state = expectedState`, defeating the OAuth
  CSRF check entirely. Post-fix, the prompt requires the FULL
  callback URL — paste it as-is and the resolver verifies `state`
  matches. Bare-code paste is still available behind
  `--unsafe-bare-code` for SSH / restricted-container scenarios where
  the user genuinely can't copy the URL, but the flag's name + help
  text now tell them what they're trading away. Refs ALL-935.
- **`templates --data-file` rejects absolute / `..`-traversing paths
  by default.** Pre-fix, a CI invocation or scripted caller passing
  an attacker-controlled `--data-file` could read any file (e.g.
  `~/.aws/credentials.json`, `/etc/passwd`) and ship its contents
  into Linear's API via the `templateData` field. Post-fix, the
  resolver rejects paths starting with `/`, `../`, or `..\`; opt in
  with `--allow-absolute` if you really need it. Refs ALL-935.
- **Auto-link reference resolution caps candidates at 50 per call.**
  A description containing hundreds of fake identifiers (`AAA-1, …,
  AAA-999`) used to trigger one GraphQL roundtrip per identifier
  before deciding none resolved — a foot-gun DoS-for-self vector.
  Now the resolver processes the first 50 candidates and reports
  the overflow as a single synthetic `failed` entry. Refs ALL-935.
- **`sanitizeForLog` now also redacts OAuth tokens.** Previously the
  redaction regex only matched the `lin_api_…` prefix; OAuth access
  and refresh tokens (`lin_oauth_…`) were left visible. A
  high-entropy fallback also redacts 40+ char Bearer-style payloads
  adjacent to `Authorization` / `Bearer` keywords, catching future
  token shapes we haven't anticipated.

### Fixed

- **ProseMirror link marks now reject unsafe URL schemes.** Comments
  / issue descriptions containing `[label](javascript:…)`,
  `[label](data:…)`, `[label](vbscript:…)`, or `[label](file://…)`
  used to flow into Linear's API with the dangerous href intact;
  now the link mark is silently dropped (label survives as plain
  text). `http`, `https`, `mailto`, `linear`, and schemeless /
  relative hrefs still pass through. Defense in depth — Linear's
  web UI almost certainly has its own sanitizer, but we don't want
  to depend on that.
- **Mention regex is now Unicode-aware.** `@(\w+)` was ASCII-only,
  so `@Юрий`, `@Niño`, or any non-Latin name silently failed to
  resolve. Bare-name auto-mention had the same limitation via
  `\b…\b`. Both now use `\p{L}\p{N}_` lookarounds and the `/u`
  flag, so Cyrillic / accented Latin / CJK names match correctly.
- **`extractIssueReferences` honors the wrapper's protected ranges.**
  Previously the extractor only stripped fenced code blocks; identifiers
  inside markdown links (`[label](https://x/DEV-100)`), bare URLs
  (`https://github.com/org/repo/DEV-100.md`), inline backticks, Slack
  links, and angle-bracket autolinks were extracted as phantom
  relations. Now the extractor uses the same protection scanner as
  `wrapIssueReferencesAsLinks`, so the wrap→extract composition is
  symmetric and the DEV-3606 bug class (transform/consumer disagreement)
  is closed at the source. Shared scanner lives at
  `src/utils/protected-ranges.ts`. Closes ALL-933.
- **`--format summary` strips terminal control sequences** before
  rendering issue / comment / project text. ANSI/OSC/CSI byte
  injection in titles or descriptions no longer hijacks the user's
  terminal — anyone with workspace write access used to be able to
  emit `\x1b]8;;https://evil/\x07Click\x1b]8;;\x07` in an issue title
  and have it render as a misleading clickable hyperlink. Newlines and
  tabs are preserved; everything else in C0/C1 + DEL is dropped.
- **`clipDescription` now enforces a 4096-char cap** in addition to
  the existing 10-line cap. A single-line 5MB description previously
  passed the line check and was dumped verbatim to stdout.
- **`truncate(s, 0)` returns the empty string** instead of `s.slice(0,
  -1) + "…"` (which silently produced a 5-char output for a request of
  0). `truncate(s, 1)` returns `"…"` explicitly. No production caller
  hits these boundaries today; the helper is now contract-correct
  for future reuse. Closes ALL-934.

### Security

- **OAuth refresh is now serialized across concurrent processes.** When
  the access token is near expiry, the refresh path acquires an
  exclusive file lock on the `oauth.json` sidecar before reading,
  refreshing, and writing. Without this, two parallel `el-linear`
  invocations (parallel CI matrix, two terminal tabs, watchdog scripts)
  would both observe an expired state, both call `refreshTokens` with
  the same refresh token, and both write — Linear's OAuth server
  invalidates the loser's token, and the loser's next refresh
  permanently fails. The lock makes the loser re-read the freshly-
  written state inside the critical section and use the winner's tokens
  instead of issuing a duplicate refresh. Stale locks (process crashed
  mid-refresh) are detected via mtime and stolen after 30s. Closes
  ALL-931.
- **Atomic writes for `profile migrate-legacy`.** The migrate-legacy
  command's config / token / active-profile writes now go through the
  existing `atomicWrite` helper (write-tmp + rename) instead of raw
  `fs.writeFile`. Closes two failure modes: (a) partial writes on SIGINT
  / OOM / power loss, which previously left a corrupt config or token
  file; (b) a TOCTOU window when overwriting a pre-existing token file
  at mode `0o644` — the freshly-written token sat at the looser mode
  until a follow-up `chmod` ran, and a concurrent reader could grab it
  during that window. atomicWrite creates the tmp file at the requested
  mode and renames into place, so the destination atomically transitions
  from old-content-old-mode to new-content-new-mode. Closes ALL-932.

The audit-related fixes above close the highest-impact P2 hardening
findings from the 2026-05-09 product-finalizer audit. Tracked under
ALL-935; remaining items continue to be tracked there.

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
