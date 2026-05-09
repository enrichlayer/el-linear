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

# ✅ Just use --format summary
el-linear issues search "..." --limit 10 --format summary 2>&1
el-linear projects list --limit 50 --format summary 2>&1
el-linear issues read DEV-123 --format summary 2>&1
```

The summary formatter exists exactly because every consumer (humans and LLMs) was reinventing the same `python -c` / `jq` extraction in shell. Pick the canonical path; the per-resource format is a stable contract.

### Coverage

`--format summary` is implemented for:

- **Single resources:** `issues read`, `projects read`, `cycles read`, `project-milestones read`, `documents read`, `templates read`, releases (`graphql` query results), `users read`
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

```bash
el-linear issues search "keywords from proposed title" 2>&1
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

### Viewing existing relations

```bash
el-linear issues related ENG-123 2>&1
```

Returns all relations (related, blocks, blockedBy, duplicate) with direction, state, and assignee. Use this before creating follow-up work to understand the context around an issue.

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

- [ ] **Assignee set** — if missing, ask user and update: `el-linear issues update ENG-123 --assignee <name>`.
- [ ] **Project set** — if missing, ask user and update: `el-linear issues update ENG-123 --project "<name>"`.
- [ ] **Status appropriate** — move to "In Progress" or your team's equivalent.

Don't start implementation work on an unassigned issue. The assignee is the person accountable.

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

---

## CLI Syntax Rules

Run `el-linear usage` for the full command reference. Non-obvious rules:

- **Always append `2>&1`** to capture errors.
- **Labels are comma-separated** — `--labels "feature,backend"` (not repeated flags).
- **Singular/plural interchangeable** — `issues`/`issue`, `labels`/`label`, etc.
- **Subcommand aliases** — `read`/`view`/`get`/`show`, `update`/`edit`/`set`.
- **`--jq` for GraphQL filtering** — never pipe through `jq` directly (zsh escaping breaks `!=`).
- **`--raw` flag** strips the `{ data, meta }` wrapper — emits just the array.

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

Always check if a project exists before creating: `el-linear projects list --limit 50`.

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
