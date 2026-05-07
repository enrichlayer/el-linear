# el-linear changes for Kamal

Three things you can drop from your personal skill once this lands.

## 1. Message footer (config + flag)

Auto-appends to issue descriptions and comment bodies on `create` paths.

```jsonc
// ~/.config/el-linear/profiles/<you>/config.json
{
  "messageFooter": "\n\n— Kamal · filed via el-linear"
}
```

Per-invocation overrides:

```bash
el-linear issues create "..." --footer "\n\n— hot take, may be wrong"
el-linear comments create DEV-100 --body "..." --no-footer
```

Treated as a literal string — include the `\n\n---\n` separator yourself if you want a horizontal rule. Update paths (`issues update`, `comments update`) **don't** auto-inject — the user is overwriting an existing body and we don't want to silently mutate it.

## 2. Description templates (config + `--template` flag)

Replaces hand-rolled "always paste this when creating a bug" rules.

```jsonc
{
  "descriptionTemplates": {
    "bug": "## Steps to reproduce\n\n1. ...\n\n## Expected\n\n...\n\n## Actual\n\n...",
    "spike": "## Question\n\n...\n\n## Time-box\n\n2 days",
    "feature": "## Why we need this\n\n...\n\n## Done when\n\n- ..."
  }
}
```

```bash
el-linear issues create "Login fails on Safari" --team PYT --template bug
```

Mutually exclusive with `--description` / `--description-file` — the CLI errors out if you pass both. Unknown template names error with a list of available ones.

## 3. `--priority none` now works

Was rejected before (only `1`–`4` and the rated keywords were accepted). Now the create / update / filter paths all accept the same keyword set:

```
none | urgent | high | medium | normal | low
0    | 1      | 2    | 3      | 3      | 4
```

`0` and `none` both mean "No priority" — Linear stores that as a real state, not absence.

## What you can drop from your personal skill

- The bullet that says "if `--description` not provided, paste this template" — replaced by `descriptionTemplates` + `--template`.
- Any sign-off rule ("always end with — Kamal") — replaced by `messageFooter`.
- The footnote that says "if you mean no-priority, use 0 not 'none'" — fixed in `validatePriority`.

## Still in your court (we agreed these belong in your personal skill)

- Auto-label rules ("title contains 'bug:' → add bug label")
- Default project / cycle ("current sprint")

These are about issue *intent*, not Linear field defaults — they're a fit for `~/.claude/skills/` rather than el-linear config.

## Coming next (separate threads)

- `defaultAssignee` / `defaultPriority` / `defaultStatus` config fields (the rest of your defaults table)
- Disk-level cache for `teams list` / `labels list` / `projects list` with TTL — so `_kamal/cache` becomes redundant
- `el-linear init` prompts for all of the above so new users discover them without reading source

If you want any of those prioritized, ping me.
