---
name: linear-operations
description: "MUST be invoked before any el-linear CLI call. Covers el-linear syntax, label taxonomy, duplicate checking, issue creation conventions, and project management. Triggers on: \"create issue\", \"update issue\", \"search issues\", \"Linear\", \"el-linear\", \"label\", \"assign\". NOT for branch creation or full development workflows."
allowed-tools: Bash(el-linear:*), Bash(which:*), AskUserQuestion, Read
---

# Linear Operations Skill

All Linear operations should go through the **`el-linear` CLI**. For command syntax, run `el-linear usage` (all commands) or `el-linear <command> --help`.

This skill covers **mandatory processes and non-obvious rules** — everything the CLI help doesn't tell you.

> **Team-specific overrides.** Many teams keep their own issue-creation guide, label taxonomy, or member alias map. If your project has a `CLAUDE.md` or sibling skill that supplements this one, treat its rules as authoritative on top of these defaults.

## Output formats — use `--format summary` for terminals and agents

`el-linear` defaults to a structured JSON envelope. **For human-readable or chat-bound output, always pass `--format summary`.** Do not pipe el-linear through `python -c "json.load(...)"` or `jq` to pull out title / state / assignee — that is exactly what `--format summary` is for, and it produces a stable rendering across releases.

```bash
el-linear issues read DEV-123 --format summary
# DEV-123  Fix login flicker on Safari 17
# State:    In Progress
# Assignee: Alice
# Project:  Auth Refactor
# Labels:   Feature, tool
# URL:      https://linear.app/acme/issue/DEV-123/...

el-linear issues search "auth" --format summary
# ID        TITLE                                                    STATE        ASSIGNEE
# ---------------------------------------------------------------------------------------
# DEV-100   Migrate auth middleware to new session store             In Progress  Alice
# DEV-104   Auth callback returns 502 under load                     Todo         Bob
#
# 2 issues
```

Use `--format json` (the default — pass nothing) **only** when you genuinely need the full envelope: writing scripts that parse the response, mutating with `--jq`, or chaining into another tool that expects structured data. Default to summary; reach for JSON when the task warrants it.

### Anti-patterns to avoid

If you find yourself writing any of these, you are reaching for the wrong tool:

```bash
# ❌ Don't do this — pipe through python to extract a few fields
el-linear issues search "..." --limit 10 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); ..."

# ❌ Don't do this either — head the JSON to make it manageable
el-linear projects list --limit 50 2>&1 | head -100

# ❌ Don't reach for jq just to print title + state
el-linear issues read DEV-123 --jq '.title + " " + .state.name' 2>&1

# ❌ Don't pipe a read through python just to get the whole description body
el-linear issues read DEV-123 --format json 2>&1 | python3 -c "import json,sys; print(json.load(sys.stdin)['description'])"

# ❌ Don't grep a write's JSON for the new state / url
el-linear issues update DEV-123 --status Done 2>&1 | grep -iE 'state|url'

# ✅ Just use --format summary
el-linear issues search "..." --limit 10 --format summary 2>&1
el-linear projects list --limit 50 --format summary 2>&1
el-linear issues read DEV-123 --format summary 2>&1

# ✅ Whole description as raw text → --body. Terse write confirmation → --quiet
el-linear issues read DEV-123 --body 2>&1
el-linear comments read comment-c5d15b28 --body 2>&1
el-linear comments list DEV-123 --body 2>&1
el-linear comments list DEV-123 --format summary --no-truncate 2>&1
el-linear issues update DEV-123 --status Done --quiet 2>&1
```

The summary formatter exists exactly because every consumer (humans and LLMs) was reinventing the same `python -c` / `jq` extraction in shell. Pick the canonical path; the per-resource format is a stable contract.

### Extracting one description section: `--field`

When you need a single named section out of an issue's markdown description (e.g. "Done when", "Out of scope", "Why we need this"), use `issues read --field`. It matches `##`/`###` headers and bold pseudo-headers (`**Done when**`) case-insensitively, prints just that section's text, and exits non-zero when the section is missing — the canonical replacement for piping into `python3 -c "...desc.find(...)"`.

```bash
# ✅ One section, plain text, scriptable
el-linear issues read DEV-123 --field "Done when" 2>&1

# ❌ Don't do this
el-linear issues read DEV-123 2>&1 | python3 -c "import json,sys; print(json.load(sys.stdin)['description'].split('## Done when')[1].split('##')[0])"
```

`--field` is single-issue only — for batch extraction, fall back to `--jq` on the full JSON.

### The whole description as raw text: `--body`

When you want the **entire** description (not one section) as plain markdown — to read it, diff it, or pipe it to a file — use `issues read --body`. It prints the raw description with real newlines and no JSON envelope, single-issue only, and exits non-zero when the issue has no description. This is the canonical replacement for `... --format json | python3 -c "...['description']"` and the `sed 's/\\n/\n/g'` newline-unescaping hack.

```bash
# ✅ Full description, raw markdown, scriptable
el-linear issues read DEV-123 --body 2>&1

# ❌ Don't do this
el-linear issues read DEV-123 --format json 2>&1 | python3 -c "import json,sys; print(json.load(sys.stdin)['description'])"
```

`--body` is mutually exclusive with `--field` / `--sections` / `--with` (those extract named parts or extend the JSON envelope; `--body` is the whole thing as text).

### Comment reads and full comment bodies

When you need a specific comment, or the full text of a long comment, use the
comments read/list surfaces instead of dumping JSON:

```bash
# ✅ Resolve a Linear permalink anchor or full comment UUID
el-linear comments read comment-c5d15b28 --format summary 2>&1
el-linear comments read comment-c5d15b28 --body 2>&1

# ✅ Full bodies for every comment on an issue
el-linear comments list DEV-123 --body 2>&1
el-linear comments list DEV-123 --format summary --no-truncate 2>&1

# ❌ Don't do this
el-linear comments list DEV-123 --format json 2>&1 | python3 -c "import json,sys; print(json.load(sys.stdin)['data'][0]['body'])"
```

`comments read` accepts a full UUID, `comment-<hash>`, or a URL containing
`#comment-<hash>`. `comments list --format summary` includes each comment id
so you can copy it straight into `comments read`.

### Terse write confirmations: `-q, --quiet`

`issues create|update` and `comments create|update` accept `-q, --quiet`, which prints a single machine-stable confirmation line instead of the full JSON envelope — no need to `grep` the result for the identifier / state / url:

```bash
el-linear issues update DEV-123 --status "In Review" --quiet 2>&1
# DEV-123  In Review  https://linear.app/acme/issue/DEV-123/...

el-linear comments create DEV-123 --body "..." --quiet 2>&1
# comment <id>
```

`--quiet` overrides `--format` (it's the whole point) and is independent of `--fields`/`--jq`.

### When you must reach outside el-linear: prefer `jq` over `python3 -c`

For tools that aren't `el-linear` (e.g. `gh`, `glab`, `kubectl`), prefer `jq` for JSON extraction in one-shot shell commands. `python3 -c "import json,sys; ..."` produces longer, harder-to-read pipelines, and tends to attract incremental complexity (try/except, fallbacks) that `jq` handles inline. Reach for python only when the transformation genuinely needs control flow that's painful in `jq` (e.g. multi-step assembly with intermediate state).

### Coverage

`--format summary` is implemented for:

- **Single resources:** `issues read`, `comments read`, `projects read`, `cycles read`, `project-milestones read`, `documents read`, `templates read`, releases (`graphql` query results), `users read`
- **Lists:** `issues list`, `issues search`, `projects list`, `comments list`, `cycles list`, `project-milestones list`, `labels list`, `teams list`, `users list`, `documents list`, `templates list`, `attachments list`, `releases list`, and the cross-resource `search` command

Commands without a dedicated formatter (e.g. `config show`, custom `graphql` queries) fall back to a generic key/value rendering of their JSON payload.

---

## Intent-Driven Issue Writing

Every issue should communicate **why** the work matters and **what** success looks like. This creates a track record of reasoning and gives the assignee room to find better solutions.

### Principles

1. **Lead with intent.** Start with why this work matters. The "Why we need this" section should explain real motivation (business problem, user pain, strategic context) — not restate the title.
2. **Describe outcomes.** "Done when" criteria describe what success looks like. The assignee may find a more elegant path than the one you'd prescribe.
3. **Respect expertise.** Provide context the assignee might lack (what a tool is, links to docs, business reasoning). Specific instructions are fine when you have relevant domain knowledge — but always pair them with the intent so the assignee understands the goal behind them.

### Example

```markdown
## Set up a self-hosted CRM

The team needs a CRM to replace fragmented contact tracking
(spreadsheets + Linear + memory). Should be production-ready:
reliable, backed up, accessible.

## Why we need this
As we scale outbound, we need customer relationships, pipeline,
and outreach tracked in one place.

## Done when
- Team can access the CRM UI and create/edit contacts.
- Data survives a server restart.
- Accessible via a subdomain with TLS.
```

---

## Duplicate & Related Issues Check (MANDATORY)

**Search before creating. No exceptions.**

> **Now enforced at the CLI ([DEV-4823](https://linear.app/verticalint/issue/DEV-4823/)).** `el-linear issues create` runs a deterministic
> duplicate-detection gate *before* the create POST: it tokenizes the title,
> searches the salient keywords (including closed issues), scores candidates
> by Jaccard title-overlap, and **blocks (exit non-zero) — listing the
> matches (id · title · state · assignee)** — when one crosses the similarity
> threshold (default `0.35`, set `validation.duplicateThreshold` to tune). This
> is the deterministic backstop for the manual check below — don't skip the
> manual review just because the gate exists (it catches title-keyword dupes,
> not semantic ones with different wording). To proceed past a flagged dupe,
> use `--allow-duplicate` (the narrow, correct flag for this gate);
> `--skip-validation` also bypasses it but skips all field validation too, so
> prefer `--allow-duplicate`. Disable just the gate with
> `validation.duplicateDetection: false` (field validation still runs);
> `validation.enabled: false` turns off all validation.

> **SOP-label parent gate ([DEV-5378](https://linear.app/verticalint/issue/DEV-5378/), opt-in).** When enabled, `el-linear issues create` requires an
> issue carrying an **SOP-type label** (any name in `validation.sopLabels`,
> default `["SOP"]`, case-insensitive) to point at a **parent SOP** — `--parent`
> or `--related-to` must resolve to another SOP-labeled issue — and **blocks
> (exit non-zero)** otherwise, naming the rule. An SOP with no parent SOP is
> unfindable by SOP tooling and breaks the catalog topology. It is **off by
> default** (`validation.sopLabelParentGate: true` turns it on; the Enrich Layer
> shared team config flips it on) because "SOP" is a workspace-specific
> taxonomy, not something an open-source install should assume. Escape hatch:
> `--allow-unparented-sop` (narrow, for an intentionally top-level SOP);
> `--skip-validation` also bypasses it but skips all field validation. The
> parent-label lookup is best-effort — an unresolvable reference fails open with
> a warning; a resolvable non-SOP parent hard-blocks.

```bash
# --include-closed is required so previously-completed duplicates surface.
# `issues search` defaults to open states (DEV-4478); the duplicate check
# intentionally widens to Done/Canceled because a closed-out duplicate is
# still a duplicate. (`issues create` runs this same widened search itself
# as the DEV-4823 gate — this manual step is for the semantic/judgment pass.)
el-linear issues search "keywords from proposed title" --include-closed 2>&1
```

1. Extract 2–3 key terms from the proposed title (skip generic words).
2. Review results — classify each match:
   - Same component + same problem = **duplicate** → comment on existing issue, don't create.
   - Same component + different problem = **related** → create new issue with `--related-to`.
   - Same domain but different component = **related** → create new issue with `--related-to`.
   - Unrelated = proceed without linking.
3. If a potential duplicate is found: show the user the existing issue(s), ask whether to comment, mark duplicate, or proceed.
4. If related issues are found, **always create the relation** when creating the new issue:

   ```bash
   el-linear issues create "Title" --team ENG --related-to "ENG-456,ENG-789" ... 2>&1
   ```

### Existence check — before an "add capability X" issue ([DEV-5097](https://linear.app/verticalint/issue/DEV-5097/))

The dup-check above guards against duplicating an *issue*. This guards against duplicating *reality*: before filing an issue to **add** a flag / guard / command / subcommand, confirm it doesn't **already exist**.

- `<cli> <subcommand> --help` (the flag may be a global option absent from the subcommand's help — check `<cli> --help` too).
- `el-catalog commands --search "<intent>"` / `el-catalog clis --search` (the snapshot likely already lists it).
- For a hook/guard, grep the source — e.g. `cli/el-hook/src/checks`.

Skipping it cost two needless branch+MR cycles in one session: a "feature" issue to add a hook guard that already existed and was firing, and one to add `--jq`/`--fields` flags that already worked — both premises only caught at implementation.

When `el-linear issues search` (or the cross-resource `search`) returns rows
carrying issue identifiers, the JSON envelope embeds a `_warnings` line
starting with `relation_candidates:` that enumerates the candidate IDs and
asks the user to reply with which ones to link, and states the skip phrase.

That warning is the authoritative instruction — surface it to the user
verbatim and follow it literally: **do not call `el-linear issues relate`
until the user replies naming the IDs to link.** Only user-named IDs go into
the `issues relate <source> --related-to "<ids>"` call — never pass an ID the
user did not name, even one your own search obviously surfaced. The CLI emits
the full procedure (every candidate ID, the example reply, the skip phrase) in
that one line, so follow it rather than re-deriving or paraphrasing it away.

Why this matters: Claude Code's auto-mode permission classifier blocks
`issues relate --related-to "<ids>"` when the IDs were *agent-inferred*
(came from your own search) rather than *user-specified* (typed by the human),
because each listed peer is a write target. Routing the IDs through an
explicit human reply converts them from agent-inferred → user-specified;
the existing search step (above) stays intact; auto-mode's guard is not
weakened. The fix is the loop shape, not the guard.

Anti-patterns:

- **Calling `issues relate` directly off your own search output** — even if
  the IDs are real and the candidates look obvious, this is the exact path
  the auto-mode guard refuses.
- **Splitting one relate call into N single-ID calls** to "look smaller" —
  same provenance problem, same block, just multiplied.
- **Asking the user a yes/no question** ("Should I link these?") instead of
  having them name the IDs — yes answers stay agent-inferred, the reply
  must carry the IDs to convert them to user-specified.

If `--include-closed` search returns no matches, no `relation_candidates:`
warning is emitted (nothing to confirm) and the flow proceeds normally.

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

---

## Pre-Work Check (Existing Issues)

When starting work on an existing issue (`el-linear issues read ENG-123`):

- [ ] **Branch claim path used** — `el-linear issues create --checkout` and `el-linear issues mark-branch ENG-123` automatically claim the issue by assigning it to the current Linear user and moving it to the team's first started state. Use `--no-claim` only when intentionally creating/marking a branch on someone else's behalf.
- [ ] **Project set** — if missing, ask user and update: `el-linear issues update ENG-123 --project "<name>"`.
- [ ] **Status appropriate** — if you did not use one of the branch claim paths, move the issue to "In Progress" or your team's equivalent.

Don't start implementation work on an unassigned issue — the assignee is the person accountable. If you did not use one of the branch claim paths (or used `--no-claim`), assign the issue before proceeding.

---

## Pre-Creation Validation Checklist

Complete ALL items before creating any issue:

- [ ] **Duplicate & related check** — searched for existing issues, linked related ones (above).
- [ ] **Team** — ask user if unclear (`el-linear teams list`).
- [ ] **Assignee** — ask user if unclear (`el-linear users list --active`).
- [ ] **Project** — always ask user, never guess (`el-linear projects list`).
- [ ] **Labels** — exactly 1 type label + 1–2 domain labels (see Label Taxonomy below).
- [ ] **Title** — action verb matching the type label (see Title Verb Convention), sentence case, specific scope.
- [ ] **Description** — 2–4 sentences with context and intent, formatted with **bold** and `inline code`.
- [ ] **"Why we need this"** — genuine motivation, not a restatement of the title.

If any field is missing, **STOP and use AskUserQuestion**.

---

## The `--claude` Delegation Pattern

`el-linear issues create` accepts a `--claude` flag that applies the workspace-level "claude" label (configured at `config.labels.workspace.claude`). This is the canonical signal that an issue is **delegated to Claude Code** for autonomous execution.

```bash
el-linear issues create "Migrate auth middleware to new session store" \
  --team ENG --assignee alice --project "Auth Refactor" \
  --description "..." --claude 2>&1
```

When you see `--claude` in usage:

- **As a writer**: use it to mark issues you want Claude to pick up. The label is the contract; combine it with a clear "Done when" so Claude knows what success looks like.
- **As Claude**: if you find an issue with the `claude` label, you should treat it as in-scope work for autonomous progress. Search with `el-linear issues search "claude" --status "Todo"`.
- **As a reviewer**: an issue's `claude` label tells you to weigh whether the description has enough acceptance criteria, since the assignee can't ask follow-up questions in a back-and-forth.

The label is plain config — set it to anything you want, or skip it entirely. The flag is just sugar for `--labels claude`.

---

## User @Mentions

Reference team members by name in comments. el-linear resolves both explicit `@name` tokens and bare capitalized references to proper Linear mentions.

```bash
el-linear comments create ENG-123 --body "cc @alice — Bob can you review?" 2>&1
# Both "@alice" and "Bob" become Linear mentions.
```

- **Explicit `@name`** — always resolved. Config alias → display name → name (partial, case-insensitive) → API fallback.
- **Bare capitalized names** — auto-converted by default when they match a configured member. Config-only — no API fallback — so false positives are bounded to your team. Skipped inside inline code, code blocks, and link text. Self-references are skipped.
- **Opt out** per-invocation with `--no-auto-mention`.

Works in comments only (not descriptions).

### Confirming a mention fired (the `mentions` output field)

A real mention lives in the comment's structured `bodyData`, not in the markdown — so a comment whose body reads `@alice` may or may not have actually pinged anyone. **Don't guess: read the `mentions` field** that `comments create|update` attach to their output (the sibling of `autoLinked`):

```jsonc
{
  "id": "…",
  "mentions": {
    "resolved":   [{ "label": "alice", "userId": "…" }],  // real notifications sent
    "unresolved": ["bobby"],                                // explicit @names that matched nobody
    "delivered":  true                                      // false ⇒ Linear rejected bodyData, fell back to plain text
  }
}
```

- An **unresolved** explicit `@name` (typo or unknown handle) is left as plain text — **no notification** — and el-linear prints a loud `⚠ @name did not resolve …` warning to **stderr**. Fix the name and re-comment; never assume the ping landed.
- `delivered: false` means the structured body was rejected and the comment shipped as plain markdown, so the resolved mentions did **not** fire — also warned on stderr.
- Under `--quiet`, the stdout stays the one-line `comment <id>`; the `mentions: resolved=[…] unresolved=[…]` confirmation is echoed to **stderr**.

This makes "a real @mention" a verifiable, deterministic convention rather than a hope ([DEV-4987](https://linear.app/verticalint/issue/DEV-4987/)).

---

## CLI Syntax Rules

Run `el-linear usage` for the full command reference. Non-obvious rules:

- **Always append `2>&1`** to capture errors.
- **Labels are comma-separated** — `--labels "feature,backend"` (not repeated flags).
- **Singular/plural interchangeable** — `issues`/`issue`, `labels`/`label`, etc.
- **Subcommand aliases** — `read`/`view`/`get`/`show`, `update`/`edit`/`set`.
- **`--jq` for GraphQL filtering** — never pipe through `jq` directly (zsh escaping breaks `!=`).
- **`--raw` flag** strips the `{ data, meta }` wrapper — emits just the array.
- **Body/description from a file** — `issues create`/`update` take `--description-file <path>`; `comments create`/`update` take `--body-file <path>`. Prefer the file form for any body with backticks, fenced code, or markdown tables — it sidesteps shell-quoting traps (the same reason `el-git mr comment --body-file` exists). `--body` and `--body-file` are **mutually exclusive** (passing both errors); file-sourced bodies get the same auto-link / auto-mention treatment as inline `--body`.

### Output format

| Command type | Shape |
|--------------|-------|
| List | `{ "data": [...], "meta": { "count": N } }` |
| Single resource | Flat object |
| Error | `{ "error": "message" }` |

---

## Error Handling

1. **Check for `"error"` key** before accessing fields like `identifier`.
2. **Do NOT retry** failed commands — report the error.
3. Common errors and fixes:
   - "Label not found" → check `el-linear labels list --team X`.
   - "Label is a group label" → use a child label, not the parent.
   - "Project may not be associated with this issue's team" → fix with `el-linear projects add-team`.
   - "User not found" → check `el-linear users list --active`.

---

## Label Taxonomy

### Type Labels (Required: exactly 1)

The default el-linear validation expects one of these:

| Label | When |
|-------|------|
| `feature` | New functionality. |
| `bug` | Broken behavior. |
| `refactor` | Improving code without changing behavior. |
| `chore` | Maintenance, dependencies, tooling. |
| `spike` | Research or investigation. |

Customize the set per-config: `validation.typeLabels: ["feature", "bug", ...]`. Domain labels (`frontend`, `backend`, etc.) are not enforced — define your own.

### Title Verb Convention

Title must start with a verb that matches the type label:

- `bug` → Fix, Resolve, Patch, Handle, Address, Correct
- `feature` → Add, Build, Create, Implement, Enable, Ship, Launch, Design, Wire, Integrate
- `chore` → Update, Remove, Clean, Migrate, Deploy, Rotate, Configure, Document, Review, Publish, Standardize, Upgrade
- `spike` → Research, Investigate, Explore, Evaluate, Audit, Benchmark
- `refactor` → Refactor, Restructure, Extract, Decouple, Simplify

### Rules

- **Create missing labels liberally** — `el-linear labels create "my-label" --team ENG`.
- **`--claude` flag** adds the workspace-level "claude" label automatically.
- Ask the user to confirm labels if you're unsure about domain.

---

## Term Enforcement (`config.terms`)

el-linear can flag misspellings of brand or project names in titles and descriptions. Configure rules in `~/.config/el-linear/config.json`:

```json
{
  "terms": [
    { "canonical": "Enrich Layer", "reject": ["EnrichLayer", "enrichlayer"] },
    { "canonical": "Linear", "reject": ["linear.app", "Linear App"] },
    { "canonical": "GitHub", "reject": ["Github", "github"] }
  ]
}
```

When el-linear finds a rejected token in an issue title or description, it warns (or in `--strict` mode, throws). The check tolerates URLs and file paths — `enrichlayer.com` is allowed even though `enrichlayer` is rejected.

If you don't configure any rules, term enforcement is a no-op.

---

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

### Discovery Before Creation

Always check if a project exists before creating: `el-linear projects list`.

The CLI emits a `results_truncated` warning in `_warnings` when the result set hits `--limit` — bump `--limit` (the suggested next size is in the warning text) or narrow via `--name` / `--state` and retry. Linear URLs and bare slug-ids (`https://linear.app/<workspace>/project/<slug>-<12-hex>/...` or bare `<slug>-<12-hex>`) resolve directly when passed to `--project` — no need to extract a human-readable name yourself.

**If the user names a project that doesn't surface, do not substitute a different one.** Broaden the search (drop `--state` / `--active` / `--name` filters, then bump `--limit`); if it still doesn't appear, **ask** the user before falling back. Substituting a wrong project silently is worse than asking one extra question.

---

## Git/GitLab/GitHub Integration

If your Linear workspace is connected to a code host, status transitions happen automatically:

- Creating a PR/MR → linked issue moves to "In Review".
- Merging a PR/MR → linked issue moves to "Done".

No manual status updates needed after PR/MR events.

### Intermediate Deliverable Rule

**Any PR/MR whose branch contains an issue ID will auto-close that issue on merge.** This is dangerous for multi-phase issues where a PR delivers only part of the work.

**Rule:** if the PR doesn't complete ALL acceptance criteria of the parent issue, create a sub-issue and branch from that. The parent stays open.

```text
Parent: ENG-100 "Review API design"          ← stays open
  └─ Sub: ENG-101 "Write API design doc"     ← branch: feature/ENG-101-write-api-design-doc
                                                PR merges → only ENG-101 closes
```

---

## Checklist Progress Tracking

When working on an issue with a checklist, check off items as you complete them.

1. Read the issue: `el-linear issues read ENG-123`.
2. Update the description with checked items: `el-linear issues update ENG-123 --description "..."`.
3. Preserve the rest of the description — only change `- [ ]` to `- [x]`.
4. If all items are done, update the status accordingly.
