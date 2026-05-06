# Configuration reference

el-linear reads configuration from two files in `~/.config/el-linear/`:

| File | Mode | Purpose |
|------|------|---------|
| `config.json` | `0644` | All non-secret config — team/member/label maps, defaults, term-enforcement rules. |
| `token` | `0600` | Linear personal API token. Never embedded in `config.json`. |

This document is the canonical reference. **An LLM (or a human, or a script) can construct an equivalent config without ever running `el-linear init`** by writing the two files directly to the locations and shapes documented below.

---

## File locations

```
~/.config/el-linear/
├── config.json                        # this file
├── token                              # 0600, single line: lin_api_...
└── .init-aliases-progress             # transient, written by `el-linear init aliases` on quit
```

The `~/.config/el-linear/` directory itself should be `0700`. el-linear creates it with the right mode when any wizard step runs; if you create it manually, do `mkdir -p -m 0700 ~/.config/el-linear`.

`token` should contain only the token text + a trailing newline:

```bash
printf '%s\n' "lin_api_yourkeyhere" > ~/.config/el-linear/token
chmod 0600 ~/.config/el-linear/token
```

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
    "typeLabels": ["bug", "feature", "chore", "refactor", "spike"]
  }
}
```

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
