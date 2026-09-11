# Relations and auto-linking

Apply these mutation procedures only within an authorized write task. A read-only search can report candidates without linking them. The account, ownership and authority rules in [the entry point](../SKILL.md) still apply.

### Cross-linking: be generous, link proactively, don't wait ([DEV-5853](https://linear.app/verticalint/issue/DEV-5853/))

**The default is to link, not to ask.** A cross-link is cheap and reversible; a *missing* link is invisible and costs reviewers and SOP tooling the context they need. When you identify an issue that is **related** / a **blocker** / a **follow-up** / the **origin** of the work in front of you, create the relation yourself — don't stage the candidates and wait for the human to name them, and don't hedge with "tell me if you want these linked."

- **At create time**, pass `--related-to "<ids>"` / `--parent <id>` / `--blocked-by <id>` directly on `issues create` — this path typically passes the classifier, so link generously the moment you file.
- **After the fact**, call `el-linear issues relate <source> --related-to "<ids>"` (or `--blocked-by` / `--blocks` / `--duplicate-of`) proactively, the same way.
- Over-linking is self-correcting (a wrong relation is one command to remove); under-linking is not. When in doubt, link.

The one exception is below: if the auto-mode permission classifier actually blocks a specific post-hoc `relate` call, that block — not caution — is your signal to surface the candidates for a one-word confirm.

When `el-linear issues search` (or the cross-resource `search`) returns rows
carrying issue identifiers, the JSON envelope embeds a `_warnings` line
starting with `relation_candidates:` enumerating the candidate IDs. Treat it
as a **convenience list of link candidates, not a stop sign** — under the
proactive default above, relate the ones that are genuinely related/blocking
without waiting to be told. Prefer create-time `--related-to` when the search
ran as part of filing a new issue (create-time relations typically pass the
classifier); otherwise call `issues relate` directly.

**Residual auto-mode constraint (the only reason to pause).** Claude Code's
auto-mode permission classifier *may* block a standalone `issues relate
--related-to "<ids>"` when it judges the IDs *agent-inferred* (surfaced by
your own search) rather than *user-specified*, because each peer is a write
target. A standing user instruction to cross-link generously is itself
authorization — so proceed by default. But if a specific `relate` call is
**actually blocked** by the classifier, that block is your cue: surface the
candidate IDs to the user for a one-word confirm, then re-run with the
user-named IDs (which pass). This is the **exception path**, not the default —
do not pre-emptively withhold links the classifier would have allowed. Two
ways to keep it frictionless: file relations at create time (`--related-to`),
or the operator adds a permission rule / runs non-auto-mode so post-hoc
`relate` never trips.

If `--include-closed` search returns no matches, no `relation_candidates:`
warning is emitted and the flow proceeds normally.

### Viewing existing relations

```bash
el-linear issues related ENG-123 2>&1
```

Returns all relations (related, blocks, blockedBy, duplicate) with direction, state, and assignee. Use this before creating follow-up work to understand the context around an issue.

### Adding relations to an existing issue

To attach a relation to an issue that **already exists** (triage, splitting findings into separate issues, backfilling related work), use `issues relate` — or pass the same flags to `issues update`:

```bash
# Dedicated relation command
el-linear issues relate ENG-123 --related-to "ENG-456,ENG-789" 2>&1
el-linear issues relate ENG-123 --blocked-by "ENG-400" 2>&1
el-linear issues relate ENG-123 --duplicate-of "ENG-111" 2>&1

# Or alongside a field update in one call
el-linear issues update ENG-123 --status "In Progress" --related-to "ENG-456" 2>&1
```

Both `issues relate` and `issues update` accept `--related-to`, `--blocks`, `--blocked-by`, and `--duplicate-of` (comma-separated identifiers; `--duplicate-of` takes a single issue). `issues create` accepts the same flags.

> **Gotcha:** `--related-to` is **not** valid on `issues update` in el-linear < 1.12. On older versions it fails with `error: unknown option '--related-to'` — use `el-linear issues relate <id> --related-to …` instead. `issues relate` has always supported it.

### Auto-linking issue references on create/update

`el-linear issues create`, `el-linear issues update`, `el-linear comments create`, and `el-linear comments update` run the same auto-linking flow on text being written:

1. **Wrap as markdown links.** Bare identifiers (`ENG-100`, `DESIGN-22`) are rewritten to `[ENG-100](https://linear.app/<workspace>/issue/ENG-100/)`. Skipped inside fenced code blocks, inline backticks, existing markdown links, angle-bracket autolinks, and bare URLs.
2. **Validate first.** Identifiers that don't resolve in the workspace (e.g. ISO codes like `ISO-1424`) are left as plain text — no link, no relation.
3. **Create sidebar relations** on the parent issue. Default is `related`. Prose keywords upgrade the type:
   - `blocked by X` / `depends on X` / `waiting on X` → `blocks` (X→source)
   - `blocks X` / `prerequisite for X` → `blocks` (source→X)
   - `duplicates X` / `duplicate of X` → `duplicate` (source→X)
   - `duplicated by X` → `duplicate` (X→source)

The output includes an `autoLinked` field with `linked`, `skipped`, and `failed` arrays.

- A reference is **skipped** when any relation already exists.
- A reference is **failed** when the identifier doesn't resolve.
- Pass `--no-auto-link` on `create`/`update` to opt out of both wrapping and sidebar relation creation.

To backfill an existing issue:

```bash
el-linear issues link-references ENG-123                      # description only
el-linear issues link-references ENG-123 --include-comments   # description + comments
el-linear issues link-references ENG-123 --dry-run            # preview
```
