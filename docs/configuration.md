# Configuration reference

el-linear reads its main configuration from `~/.config/el-linear/`, with
separate files for credentials and optional local OAuth app defaults:

| File | Mode | Purpose |
|------|------|---------|
| `config.json` | `0644` | All non-secret config — team/member/label maps, defaults, term-enforcement rules. |
| `token` | `0600` | Linear personal API token. Never embedded in `config.json`. |
| `oauth.json` | `0600` | OAuth access/refresh token state written by `el-linear init oauth`. |
| `team-oauth.json` | `0600` or `0644` | Optional local OAuth app defaults. Not packaged, not required. |

This document is the canonical reference. **An LLM (or a human, or a script) can construct an equivalent config without ever running `el-linear init`** by writing the relevant files directly to the locations and shapes documented below.

---

## File locations

```
~/.config/el-linear/
├── config.json                        # this file
├── token                              # 0600, single line: lin_api_...
├── oauth.json                         # 0600, OAuth state if `init oauth` was used
├── team-oauth.json                    # optional OAuth app defaults
└── .init-aliases-progress             # transient, written by `el-linear init aliases` on quit
```

The `~/.config/el-linear/` directory itself should be `0700`. el-linear creates it with the right mode when any wizard step runs; if you create it manually, do `mkdir -p -m 0700 ~/.config/el-linear`.

`token` should contain only the token text + a trailing newline:

```bash
printf '%s\n' "lin_api_yourkeyhere" > ~/.config/el-linear/token
chmod 0600 ~/.config/el-linear/token
```

---

## Optional team OAuth app defaults

`el-linear init oauth` uses OAuth 2.0 with PKCE. Without a local defaults file,
the wizard asks the user to register their own Linear OAuth app and paste the
`client_id`.

Teams that maintain a shared Linear OAuth app can materialize this file from a
password manager:

```json
{
  "linearOAuth": {
    "actor": "user",
    "clientId": "your-linear-oauth-client-id",
    "redirectPort": 8765,
    "scopes": ["read", "write", "issues:create", "comments:create"],
    "passwordManagerPath": "op://vault/item/client_id"
  }
}
```

Fields:

- `actor` — optional OAuth actor, either `user` or `app`. Defaults to `user`.
  Use `app` for Linear agent/service-account app users.
- `clientId` — required Linear OAuth client ID. This is not a secret.
- `redirectPort` — optional localhost callback port. Defaults to `8765`.
- `scopes` — optional scope list. Defaults to `read`, `write`,
  `issues:create`, `comments:create`.
- `passwordManagerPath` — optional human/script metadata showing where the
  config came from. el-linear does not execute password-manager commands from
  this value.

When `actor` is `app`, `scopes` may include `app:assignable` and
`app:mentionable`, but must not include `admin`.

The default path is `~/.config/el-linear/team-oauth.json`. Set
`EL_LINEAR_OAUTH_CONFIG=/path/to/team-oauth.json` to use another file.

Do not include `client_secret` in this shared file. Public/native PKCE is the
intended flow for the CLI.

---

## Top-level config schema

`config.json` is a flat object. Every key is optional. Unknown keys are preserved on writes (el-linear's wizard does shallow merging plus alias-key bookkeeping; it does not remove fields it doesn't recognise).

```jsonc
{
  // Default team for `el-linear issues create` when --team is omitted.
  // Must be a key in the `teams` map below, or a Linear team UUID.
  "defaultTeam": "ENG",

  // Labels applied automatically to every new issue. Each entry must resolve
  // via `labels.workspace` or `labels.teams[teamKey]`.
  "defaultLabels": ["claude"],

  // Optional override for the workspace URL key (the segment after `linear.app/`).
  // When omitted, el-linear fetches it from `viewer.organization.urlKey` once
  // per session and caches in memory.
  "workspaceUrlKey": "enrichlayer",

  // Status defaults for issues create. Either string is the human-readable
  // name of a workflow state in any team; el-linear resolves it per-team at runtime.
  "statusDefaults": {
    "noProject": "Triage",
    "withAssigneeAndProject": "Todo"
  },

  // Team key → team UUID. Populated by `el-linear init workspace`. You can
  // also fetch keys + ids via `el-linear teams list --raw`.
  "teams": {
    "ENG": "f0b3d1a8-...",
    "DESIGN": "9d4e7c6f-..."
  },

  // Optional: extra keys that resolve to a real team key.
  // Example: `--team engineering` → `ENG`.
  "teamAliases": {
    "engineering": "ENG"
  },

  // Member resolution. Four sub-maps; all optional.
  "members": {
    // Short alias → full display name. Used for `--assignee alice`,
    // `@alice` mentions, etc. Aliases are case-insensitive on lookup.
    "aliases": {
      "alice": "Alice Anderson",
      "ali": "Alice Anderson"
    },
    // Display name → user UUID. Linear's UUID for that account.
    "uuids": {
      "Alice Anderson": "8f1c0e6a-...",
      "Bob Brown": "ad7c2e34-..."
    },
    // User UUID → display name. Used to resolve UUID → human name in output.
    // Keys here are UUIDs; values are names.
    "fullNames": {
      "8f1c0e6a-...": "Alice Anderson",
      "ad7c2e34-...": "Bob Brown"
    },
    // Platform handles → display name. el-linear supports github + gitlab
    // out of the box; you can add more (the keys are arbitrary strings).
    "handles": {
      "github": {
        "alice-gh": "Alice Anderson"
      },
      "gitlab": {
        "alice-gl": "Alice Anderson"
      }
    }
  },

  // Label resolution. Two scopes:
  //   workspace — labels available across all teams (e.g. "claude")
  //   teams[teamKey] — team-scoped labels
  "labels": {
    "workspace": {
      "claude": "1d8e0210-..."
    },
    "teams": {
      "ENG": {
        "feature": "7c2a30fb-...",
        "bug": "0a3471d2-..."
      }
    }
  },

  // Term-enforcement rules. el-linear warns (or in `--strict` mode, throws)
  // when an issue title or description contains a rejected variant of any
  // canonical name. URLs and file paths are exempt from the check.
  "terms": [
    {
      "canonical": "Enrich Layer",
      "reject": ["EnrichLayer", "enrichlayer", "Enrichlayer"]
    },
    {
      "canonical": "Linear",
      "reject": ["linear.app", "Linear App"]
    }
  ],

  // Optional: validation toggles. When omitted, validation is enabled with
  // the default `typeLabels` set.
  "validation": {
    "enabled": true,
    "typeLabels": ["bug", "feature", "chore", "refactor", "spike"],
    // Duplicate-detection gate on `issues create` (default: on when validation
    // is enabled). Blocks creation when a similar existing issue is found.
    "duplicateDetection": true,
    // Jaccard title-similarity threshold (0–1) above which an existing issue
    // is surfaced as a possible duplicate (advisory — see below). Default
    // 0.35. Lower = more aggressive.
    "duplicateThreshold": 0.35,
    // Jaccard title-similarity threshold (0–1) above which a candidate HARD
    // blocks creation (throws; requires --allow-duplicate). Below this (but
    // at/above duplicateThreshold) is advisory only — printed, creation
    // proceeds. Default 0.6. See docs/telemetry.md (DEV-5590) for why the
    // gate is two-tier.
    "duplicateHardBlockThreshold": 0.6,
    // OPT-IN SOP-label parent gate (default: off). When true, `issues create`
    // requires an issue carrying an SOP-type label (see `sopLabels`) to point
    // at a parent SOP via `--parent` or `--related-to`, and blocks otherwise.
    // Bypass a single create with `--allow-unparented-sop`. Left off for the
    // open-source audience — "SOP" is a workspace-specific label taxonomy.
    "sopLabelParentGate": false,
    // Label names (matched case-insensitively) that mark an issue as an SOP
    // for `sopLabelParentGate`. Default ["SOP"].
    "sopLabels": ["SOP"],
    // OPT-IN goal-completion gate (default: off). "warn" prints a stderr
    // warning, "block" stops creation, when the description has no
    // "Done when" / acceptance-criteria section with a falsifiable criterion.
    // Bypass a single create with --allow-vague-goal. Left off for the
    // open-source audience — a concrete-goals convention isn't universal.
    "goalCompletionGate": false,
    // Section headers (matched case-insensitively, ## / ### / **bold** forms)
    // accepted as the goal-completion section for `goalCompletionGate`.
    // Default ["Done when", "Done-when", "Acceptance criteria",
    // "Success criteria"].
    "goalSectionHeaders": ["Done when", "Acceptance criteria"],
    // OPT-IN intake-decision gate (default: off). "warn" advises and
    // "block" refuses issue creation until the description records, in order,
    // whether the work is needed and worth doing, what existing/duplicate work
    // was checked, its canonical owner, its concrete placement, and a PROCEED
    // decision. The narrow override
    // --allow-missing-intake-decision is recorded.
    "intakeDecisionGate": false,
    // Section headers accepted for the intake decision. Default
    // ["Intake decision"].
    "intakeSectionHeaders": ["Intake decision"]
  }
}
```

### Identity resolver hook (`identity.resolver`)

**Optional.** A command el-linear shells out to in order to resolve a person.

```jsonc
{
  "identity": {
    // argv array — el-linear appends the identifier as the FINAL element
    "resolver": ["el-identity", "resolve"],
    // optional; a resolver slower than this is treated as a miss (default 8000)
    "resolverTimeoutMs": 8000
  }
}
```

Use it when your organization keeps a people registry that knows things Linear
does not — that `jd` is a person, or that a GitLab handle and a Linear handle
belong to the same human. Linear's API can already resolve names and emails; this is for
everything else.

**Why a command and not a URL + credentials.** el-linear is MIT and most installs
are not ours, so it must not bake in anybody's auth scheme. Baking one in means
the next organization needs Infisical, or 1Password, or a plain env var, or SSO —
and patches this package to get it. A command has no such problem: the credential
lives entirely inside whatever you point it at. Adding a secret backend is writing
a different script.

**Contract.** el-linear runs `<resolver argv...> <identifier>` with no shell (the
identifier is untrusted input, so it is always an argv element — a name like
`"; rm -rf /"` is a literal argument, never a command) and reads **stdout**:

| Resolver prints | Result |
| --- | --- |
| a bare UUID (`3f2a…`) | resolved |
| `{"linearId": "3f2a…"}` | resolved |
| `{"data": {"linearId": "…"}}` | resolved (an `{data, meta}` envelope) |
| a **non**-UUID, or nothing | **miss** |
| non-zero exit / timeout / binary not found | **miss** |

A non-UUID string is deliberately a miss, not an answer: handing a bogus id to
the API produces an opaque `Argument Validation Error`, whereas a miss falls
through cleanly. An identifier starting with `-` is refused outright — it is never
a valid Linear identifier, and it would otherwise be parsed as a flag by *your*
resolver.

The resolver inherits your environment (it needs it to reach its own secret
backend) **except `LINEAR_API_TOKEN`**, which is removed: the resolver resolves
people, it never talks to Linear, and there is no reason for the CLI's most
sensitive secret to be in its blast radius.

**Fail-open.** Unconfigured, or on any failure, resolution falls through to the
next layer and finally to Linear's own user lookup — exactly as it behaves with
no `identity` block at all. A broken resolver degrades el-linear; it never breaks
it. The hook never throws.

Because every failure is a silent miss, a broken resolver is otherwise invisible
— you just see an unexplained pause. Run with `EL_LINEAR_DEBUG=1` to have the
miss explained on stderr (exit code, stderr excerpt, unparseable output).

**Personal config only — the team layer cannot set this.** `identity.resolver`
names a binary el-linear will *spawn*. A team config layer (`teamConfigPath` /
`EL_LINEAR_TEAM_CONFIG`) arrives from someone else's repository, and nobody
reviews a config file expecting it to hand them a subprocess — honoring it there
would turn "clone this repo and run el-linear" into arbitrary code execution. So
the resolver is read **only** from your personal `config.json` or the env var.
The loader strips `identity` from the team layer, exactly as it has always
stripped `teamConfigPath`. An organization shipping a resolver to its developers
should write it into their personal config at setup time.

**Timeout.** `resolverTimeoutMs` must be a positive number; `0` is *not* "no
timeout" and is ignored in favor of the 8000 ms default. (Node would treat `0` as
"wait forever", which inside a synchronous call is an unkillable hang — the one
failure mode fail-open cannot save you from.)

**Repeated identifiers are resolved once** per process, so `--subscriber a,b,a`
costs one subprocess for `a`, not two. Nothing is cached to disk: a stale
identity cache is exactly the drift this hook exists to remove.

**Windows.** The command is spawned without a shell (the identifier is untrusted
input and must never reach `cmd.exe`), which means an npm shim like
`el-identity.cmd` will **not** be found — Node refuses `.cmd`/`.bat` without a
shell. On Windows, point `resolver` at a real executable, or at the
interpreter plus script (e.g. `["node", "C:/path/to/resolver.js"]`).

Override or disable per invocation with `EL_LINEAR_IDENTITY_RESOLVER`
(whitespace-separated command; empty string = off):

```bash
EL_LINEAR_IDENTITY_RESOLVER="" el-linear issues create ...   # ignore the hook once
```

Any script satisfying the contract works. A trivial one:

```bash
#!/bin/sh
# my-resolver — look "$1" up however you like, print the Linear UUID.
curl -fsS -H "Authorization: Bearer $(get-my-secret)" \
     "https://registry.internal/people/$1" | jq -r .linearId
```

### SOP-label parent gate (`validation.sopLabelParentGate`)

An **opt-in** create-time gate: when the issue being created carries an
SOP-type label (any name in `sopLabels`, default `["SOP"]`, matched
case-insensitively), `issues create` requires `--parent` or `--related-to` to
resolve to **another SOP-labeled issue**, and blocks otherwise. The rationale is
topological — an SOP with no parent SOP is unfindable by downstream SOP tooling
and breaks the catalog tree — so the gate turns that "always give an SOP a
parent SOP" convention into a deterministic refusal rather than a prose rule.

It is **off by default** (unlike the duplicate-detection gate, which defaults
on) because "SOP" is a workspace-specific label taxonomy, not something a fresh
OSS install should be surprised by. Turn it on per workspace:

```json
{ "validation": { "enabled": true, "sopLabelParentGate": true } }
```

Escape hatches, in order of narrowness:

- `--allow-unparented-sop` — create this one SOP issue without a parent SOP
  (records an override for gate telemetry, mirroring `--allow-duplicate`).
- `--skip-validation` — blanket bypass of all create validation, including this
  gate.
- `validation.sopLabelParentGate: false` (or omitting it) — disable the gate.

The parent-label lookup distinguishes two failure modes. A reference that
**cleanly doesn't resolve** — a typo'd or nonexistent identifier — is treated as
an invalid parent and **blocks** (naming the ref), so a mistyped `--related-to`
can't slip an orphan SOP onto the board. A **transport/service error** (network,
GraphQL 5xx, timeout) **fails open** with a warning and records a `fail-open`
gate event, so infra trouble can't block legitimate creation. A genuinely
resolvable non-SOP parent always hard-blocks.

### Goal-completion gate (`validation.goalCompletionGate`)

An **opt-in** create-time gate that checks the description for a
**goal-completion section** — a `Done when` (or `Acceptance criteria`,
`Success criteria`, `Done-when`, matched case-insensitively via the same
`##` / `###` / `**bold**` header forms `issues read --field` understands) —
containing at least one **falsifiable criterion**. The rationale is
concrete-goals (RFC-0027 discussion): a goal a later session can't mechanically
verify gives the implementing agent no terminal state to converge on, so the
gate turns "state how you'll know it's done" from prose advice into a
deterministic check.

A criterion counts as falsifiable when any one of these is present in the
section: a **command** (inline code or a fenced block), a **threshold number or
percentage**, a **named artifact path** (`src/foo.ts`, `report.json`), an
**exit-code / status assertion** ("exits non-zero", "tests pass", "CI green"),
or an explicit **"verifiable via X"** phrase. A section made only of bare
quality adjectives ("improved", "better", "cleaner", "faster") with no number,
command, or artifact does **not** count.

Two modes (default off):

```json
{ "validation": { "enabled": true, "goalCompletionGate": "warn" } }
```

- `"warn"` — print a stderr warning naming what's missing; creation proceeds
  (recorded as an `advisory` gate event).
- `"block"` — stop creation with a non-zero exit listing what's missing
  (recorded as a `blocked` gate event).
- absent / `false` — dormant (the open-source default).

It is **off by default** (like the SOP gate) because a concrete-goals
convention isn't universal to every workspace; the Enrich Layer shared team
config enables `"warn"` separately. Override the accepted section headers with
`goalSectionHeaders`.

Escape hatches, in order of narrowness:

- `--allow-vague-goal` — create this one issue without a falsifiable
  goal-completion section (records an `overridden` gate event, mirroring
  `--allow-duplicate` / `--allow-unparented-sop`).
- `--skip-validation` — blanket bypass of all create validation, including this
  gate.
- `validation.goalCompletionGate: false` (or omitting it) — disable the gate.

The gate is purely local (no network). On the `--from-template` path with no
local `--description` override, the description is instantiated server-side and
is invisible to a client-side check, so the gate no-ops there (same
client-side-visibility gap as the duplicate-detection gate on a
template-resolved title).

### Intake-decision gate (`validation.intakeDecisionGate`)

An **opt-in** create-time gate that requires the issue author to finish intake
before mutating Linear. It deliberately does not guess whether work is valuable
or where it belongs. Instead, it makes those judgments explicit and checks
that they appear in this exact order:

```markdown
## Intake decision
- Needed: Yes — <why this is needed>
- Worth doing: Yes — <why the value exceeds the cost>
- Existing work: <duplicate/search result and evidence>
- Owner: <canonical owner or source of truth>
- Placement: <team/project/repository/document path>
- Decision: PROCEED
```

`Needed` and `Worth doing` require an explicit `Yes` plus a reason. `Owner` and
`Placement` reject empty and placeholder values such as `TBD`. Only `PROCEED`
creates an issue; rejected work should not become backlog by default.

Two modes (default off):

```json
{ "validation": { "enabled": true, "intakeDecisionGate": "block" } }
```

- `"warn"` — record an advisory and create the issue.
- `"block"` — stop before resolver or service work and record a blocked gate.
- absent / `false` — dormant for open-source consumers.

`--allow-missing-intake-decision` is the only CLI override. It records an
`overridden` gate event so exceptions remain visible. `--skip-validation` does
not bypass this gate. On `--from-template`, a missing local description blocks
when the gate is enabled because the server-side template body cannot be
verified before creation; provide a local description or use the narrow
override.

A complete minimal config (token + defaultTeam only) is enough for most basic use:

```json
{
  "defaultTeam": "ENG",
  "teams": { "ENG": "f0b3d1a8-1234-5678-9abc-def012345678" }
}
```

---

## What each `el-linear init` step writes

The wizard is split into four steps. Each step is also a stand-alone sub-command (`el-linear init token`, `el-linear init workspace`, `el-linear init aliases`, `el-linear init defaults`). This section maps each step onto the exact config keys it sets so you can construct an equivalent config without the wizard.

### Step 1 — `init token`

**Reads from user:** Linear personal API token via hidden input.

**Writes:** `~/.config/el-linear/token` (mode `0600`), single line.

**Validates:** calls `query { viewer { id name email displayName organization { urlKey name } } }` — refuses to save the token if the call fails.

**No changes to `config.json`.**

Equivalent without the wizard:

```bash
printf '%s\n' "lin_api_yourkeyhere" > ~/.config/el-linear/token
chmod 0600 ~/.config/el-linear/token
```

### Step 2 — `init workspace`

**Reads from user:** optional default team (single-select from the list of teams the token can see).

**Writes to `config.json`:**
- `defaultTeam` — the picked team key, or unset if user skipped.
- `teams` — full team-key → UUID map for every team visible to the token.
- `workspaceUrlKey` — fetched from `viewer.organization.urlKey`.

Equivalent JSON for an "ENG" default with three visible teams:

```json
{
  "defaultTeam": "ENG",
  "teams": {
    "ENG": "f0b3d1a8-...",
    "DESIGN": "9d4e7c6f-...",
    "OPS": "5b2891ce-..."
  },
  "workspaceUrlKey": "your-workspace-key"
}
```

### Step 3 — `init aliases`

**Reads from user:** for each Linear user (paginated via `query { users(first: 100, after: $cursor) { ... } }`), the four-way menu:

| Action | What happens |
|--------|-------------|
| `keep` | No-op for that user. Default. |
| `edit` | Replace this user's aliases / handles with the entered values. |
| `append` | Add new aliases / handles to existing ones. |
| `clear` | Remove all aliases / handles for this user. |
| `quit` | Save progress to `.init-aliases-progress` and exit the walk. |

After `quit`, re-running `el-linear init aliases` resumes from where you left off. Progress file is removed once the walk completes.

**Writes to `config.json`:** edits the `members` sub-tree. For each user UUID + display name pair:
- `members.uuids[displayName] = userId`
- `members.fullNames[userId] = displayName`
- `members.aliases[alias] = displayName` for each alias key
- `members.handles.github[handle] = displayName` (if a github handle was set)
- `members.handles.gitlab[handle] = displayName` (if a gitlab handle was set)

Equivalent JSON for two users:

```json
{
  "members": {
    "aliases": {
      "alice": "Alice Anderson",
      "ali": "Alice Anderson",
      "bob": "Bob Brown"
    },
    "uuids": {
      "Alice Anderson": "8f1c0e6a-...",
      "Bob Brown": "ad7c2e34-..."
    },
    "fullNames": {
      "8f1c0e6a-...": "Alice Anderson",
      "ad7c2e34-...": "Bob Brown"
    },
    "handles": {
      "github": { "alice-gh": "Alice Anderson" },
      "gitlab": {}
    }
  }
}
```

#### `init aliases --import users.csv` — batch path

CSV format. Header line is required. Lines starting with `#` are comments. Aliases column is comma-separated *inside the cell* (quote the cell if it contains commas).

```csv
email,aliases,github,gitlab
alice@example.com,"alice,ali",alice-gh,
bob@example.com,bob,,bob-gl
# comment lines are skipped
```

Each row's `email` is matched against `viewer.organization`'s users. Unmatched rows are reported and skipped. A non-empty cell *replaces* the user's existing aliases / handle for that platform; an empty cell leaves them alone.

### Step 4 — `init defaults`

**Reads from user:** three optional sub-prompts — default labels, status defaults, term-enforcement rules.

**Writes to `config.json`:**
- `defaultLabels` — array of label keys.
- `statusDefaults` — `{ noProject, withAssigneeAndProject }`.
- `terms` — array of `{ canonical, reject }` rules.

Equivalent JSON:

```json
{
  "defaultLabels": ["claude"],
  "statusDefaults": {
    "noProject": "Triage",
    "withAssigneeAndProject": "Todo"
  },
  "terms": [
    { "canonical": "Enrich Layer", "reject": ["EnrichLayer", "enrichlayer"] }
  ]
}
```

---

## Idempotency rules

Re-running any step (or the full wizard) preserves data not touched by that step:

- `init token` does not touch `config.json`.
- `init workspace` only writes `defaultTeam`, `teams`, `workspaceUrlKey`. The `members.*`, `labels.*`, `terms`, `defaultLabels`, `statusDefaults` keys are left exactly as they were.
- `init aliases` only edits the `members.*` sub-tree, scoped to the users you actually changed (keep/skip is a no-op).
- `init defaults` only writes `defaultLabels`, `statusDefaults`, `terms`.

The wizard sorts `config.json` keys before writing, so re-running with no input changes produces a byte-identical file.

If you maintain `config.json` by hand (or via an LLM), the runtime loader does the same shallow-merge against built-in defaults and will preserve any extra keys you add.

---

## Programmatic config generation

For LLM-driven setup (e.g. asking Claude to write a config without running the wizard):

1. Read the token from a 1Password / vault item or user prompt — write to `~/.config/el-linear/token` with mode `0600`.
2. Discover team and user UUIDs:
   ```bash
   # Teams
   el-linear teams list --raw | jq '[.[] | {key, id}]'
   # Users (paginated automatically)
   el-linear users list --active --raw | jq '[.[] | {id, displayName, email}]'
   # Workspace urlKey
   el-linear graphql '{ viewer { organization { urlKey } } }' --raw | jq -r '.viewer.organization.urlKey'
   ```
3. Construct `config.json` against the schema above.
4. Validate by running `el-linear config show` — it prints the merged config exactly as the loader sees it.

---

## Migration from the legacy `linctl`

If you have an existing `~/.config/linctl/config.json` from the brief period when the package was published as `@enrichlayer/linctl`:

```bash
mkdir -p -m 0700 ~/.config/el-linear
mv ~/.config/linctl/config.json ~/.config/el-linear/config.json
mv ~/.config/linctl/token ~/.config/el-linear/token
chmod 0600 ~/.config/el-linear/token
rmdir ~/.config/linctl
```

The runtime loader auto-migrates the legacy `brand: { name, reject }` shape to a single entry in `terms[]` and warns once. To clean up the warning, run `el-linear init defaults` and re-confirm the term-enforcement rules.

The legacy `~/.config/linctl/` location is also read as a fallback if the new path is empty, so the move is optional for one release.

## Identity registry resolution (opt-in, Enrich Layer-only)

Person resolution for **`--assignee` and `--delegate`** (on `issues`/`batch`,
including the batch search/create fast-paths) can optionally resolve an
identifier through the company-wide identity registry
([DEV-4827](https://linear.app/verticalint/issue/DEV-4827/)) before falling back
to the bundled `members` config. This is **off by default and EL-internal** —
el-linear is open-source, so a fresh install does nothing here and never
contacts a network service. (`--subscriber` stays config-only for now —
registry parity is tracked in
[DEV-4880](https://linear.app/verticalint/issue/DEV-4880/).)

Activate it (Enrich Layer machines only) by setting the registry URL; add the
Cloudflare-Access service-token pair when the registry is fronted by CF Access:

| Variable | Purpose |
|---|---|
| `EL_IDENTITY_URL` | Control Panel base URL, e.g. `https://control-panel.enrichlayer.com`. **Unset = feature disabled.** |
| `EL_IDENTITY_CF_ACCESS_CLIENT_ID` | CF-Access service-token id (optional). |
| `EL_IDENTITY_CF_ACCESS_CLIENT_SECRET` | CF-Access service-token secret (optional). |

When set, `--assignee dima` / `--delegate dima` resolves `dima` → the person's
Linear UUID via `GET <EL_IDENTITY_URL>/api/people/resolve`. Resolution **fails
open**: on a
miss, an unreachable registry, a CF-Access challenge, or a malformed response it
silently falls back to the config-based `resolveMember`, so a registry hiccup
never breaks a command. The same env-var names are shared with the tools
`@enrichlayer/el-identity` client, so one `.env.local` configures both.
