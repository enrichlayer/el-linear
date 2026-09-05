# Project operations

Load this for project discovery or an authorized project write. Reuse confirmed metadata and preserve [the account and authority rules](../SKILL.md). Use [CLI syntax](cli-syntax.md) for content-file handling.

## Project Management Gotchas

### Content vs Description

Linear projects have two text fields — **both must be populated**:

- `description` — short summary (max 255 chars), shown in lists.
- `content` — full markdown body, shown in main panel.

If you only set one, the other shows blank.

### Cross-Team Projects

Creating an issue on team X with a project from team Y → "Project not in same team" error. Fix:

```bash
el-linear projects add-team "Project Name" ENG 2>&1
```

**Never use raw `projectUpdate` with `teamIds`** — it replaces the entire team list. Always use `projects add-team` / `remove-team`.

### Project Updates (status posts) — mind the naming collision

Linear has two unrelated things spelled almost the same:

- `projectUpdate(id, input)` — the mutation that **edits a project** (the one warned about just above). Surfaced by the `projects` command.
- `ProjectUpdate` — a **status post** in a project's Updates feed (progress + a health color). Surfaced by the dedicated `project-updates` command:

```bash
# Post a status update to a project (appears in the Updates feed)
el-linear project-updates create --project "Auth Refactor" \
  --body "Shipped the session-store migration; rollout at 60%." \
  --health onTrack   # onTrack | atRisk | offTrack — omit to leave unset

el-linear project-updates list --project "Auth Refactor"
el-linear project-updates read <updateId>
```

`--body` / `--body-file` are mutually exclusive (one required); `--body-file` avoids shell-quoting for markdown/tables. `--health` is validated against the enum before the API call. `--diff-hidden` hides the auto-generated progress diff on the update. `-q/--quiet` prints `<health>  <url>`. A status update is not the same as a project **document** (`documents create --project`) — use a document for durable reference content, a project update for point-in-time progress.

### Discovery Before Creation

Always check if a project exists before creating: `el-linear projects list`.

The CLI emits a `results_truncated` warning in `_warnings` when the result set hits `--limit` — bump `--limit` (the suggested next size is in the warning text) or narrow via `--name` / `--state` and retry. Linear URLs and bare slug-ids (`https://linear.app/<workspace>/project/<slug>-<12-hex>/...` or bare `<slug>-<12-hex>`) resolve directly when passed to `--project` — no need to extract a human-readable name yourself.

**If the user names a project that doesn't surface, do not substitute a different one.** Broaden the search (drop `--state` / `--active` / `--name` filters, then bump `--limit`); if it still doesn't appear, **ask** the user before falling back. Substituting a wrong project silently is worse than asking one extra question.
