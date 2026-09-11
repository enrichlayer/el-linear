# Issue creation and intake

Read this before creating an issue. Reuse the common contract in [the entry point](../SKILL.md). Read [labels and titles](labels-and-titles.md) before choosing them, [relations](relations.md) when related work or text references are present, and [CLI syntax](cli-syntax.md) before writing a body from a file.

## Intent-Driven Issue Writing

Every issue should communicate **why** the work matters and **what** success looks like. This creates a track record of reasoning and gives the assignee room to find better solutions.

### Principles

1. **Lead with intent.** Start with why this work matters. The "Why we need this" section should explain real motivation (business problem, user pain, strategic context) — not restate the title.
2. **Describe outcomes.** "Done when" criteria describe what success looks like. The assignee may find a more elegant path than the one you'd prescribe.
3. **Respect expertise.** Provide context the assignee might lack (what a tool is, links to docs, business reasoning). Specific instructions are fine when you have relevant domain knowledge — but always pair them with the intent so the assignee understands the goal behind them.

### Example

```markdown
## Intake decision
- Needed: Yes — contact tracking is split across spreadsheets, Linear, and memory.
- Worth doing: Yes — outbound scale makes the fragmentation costly now, not later.
- Existing work: searched "CRM", "contact tracking" with --include-closed; no duplicate.
- Owner: Nico (operations tooling).
- Placement: OPS / Sales infrastructure; self-hosted on the Hetzner box.
- Decision: PROCEED

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

## Intake Decision Block (MANDATORY, blocking)

**`el-linear issues create` refuses any description without a `## Intake decision` section.** It must open the description, and the six lines must appear in this order:

```markdown
## Intake decision
- Needed: Yes — <why this is needed>
- Worth doing: Yes — <why the value exceeds the cost>
- Existing work: <duplicate/search result and evidence>
- Owner: <canonical owner or source of truth>
- Placement: <team/project/repository/document path>
- Decision: PROCEED
```

Write it **before** composing the rest of the body. The gate runs before the create POST, so omitting it fails the call outright — nothing is written, and a finished issue body then has to be reassembled around a section you were never told to include.

The point is that the decision is *recorded*, not merely reached: `Existing work` cites the search you actually ran, and `Owner`/`Placement` name a concrete destination rather than a plausible one. It is the same discipline the two gates below enforce mechanically, applied to the judgment they cannot check.

Escape hatch: `--allow-missing-intake-decision`, which is recorded. It exists for an **accountable human** who has approved an exceptional create — not for an agent that would rather not write the block. `--skip-validation` also bypasses it but disables every other field check too, so prefer the narrow flag.

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
> `--skip-validation` also bypasses it but skips all field validation. A typo'd
> or nonexistent parent reference **blocks** (naming the ref) so a mistake can't
> orphan an SOP; a transport/service error **fails open** with a warning (and a
> `fail-open` gate event); a resolvable non-SOP parent hard-blocks.

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

- **`el-catalog commands --search "<intent>"`** / `el-catalog clis --search` — the **authoritative** check for a command/subcommand; it deterministically indexes every `<cli> <subcommand>`. Confirm with `<cli> <subcommand> --help` (and `<cli> --help` — a flag may be a global option absent from the subcommand's help).
- For a hook/guard, grep the source (e.g. `cli/el-hook/src/checks`) — but **empty grep output is inconclusive, not proof of absence**. A mis-quoted glob or bad flag makes grep exit silently with zero matches (`grep --include=*.ts …` errors under zsh, returning nothing for a symbol that exists). Never read a raw grep's silence as "doesn't exist" for the command check — that is exactly what `el-catalog` is for.

Skipping it cost real rework across sessions: a hook guard and `--jq`/`--fields` flags filed as "features" though both already existed and worked, and a near-duplicate `el-git` subcommand built after a raw grep silently misfired (the `el-catalog` search would have found the existing one) — every premise caught only at implementation.

## Pre-Creation Validation Checklist

Complete ALL items before creating any issue:

- [ ] **Intake decision** — description opens with the `## Intake decision` block (above). Blocking.
- [ ] **Duplicate & related check** — searched for existing issues, linked related ones (above).
- [ ] **Team, assignee and project** — reuse same-task confirmed values and their evidence; resolve routine missing fields from the current issue or canonical workspace mappings. Use `teams list`, `users list --active` or [project discovery](projects.md#discovery-before-creation) when needed. Ask only if consequential placement or ownership ambiguity remains. If a user-named project cannot be resolved after discovery, ask; never silently substitute one.
- [ ] **Labels** — exactly 1 type label + 1–2 domain labels (see [Label Taxonomy](labels-and-titles.md#label-taxonomy)).
- [ ] **Title** — action verb matching the type label, sentence case, specific scope, **plain-language and jargon-free** (see [title conventions](labels-and-titles.md#title-verb-convention)).
- [ ] **Description** — 2–4 sentences with context and intent, formatted with **bold** and `inline code`.
- [ ] **"Why we need this"** — genuine motivation, not a restatement of the title.

Every required field must be resolved before creation. Missing information is a reason to inspect current evidence first, not to repeat settled questions. Ask only for the unresolved consequential choice or required authority; continue independent work while that answer is pending.

## The `--claude` Delegation Pattern

`el-linear issues create` accepts a `--claude` flag that applies the workspace-level "claude" label (configured at `config.labels.workspace.claude`). This is the canonical signal that an issue is **delegated to Claude Code** for autonomous execution.

```bash
el-linear issues create "Migrate auth middleware to new session store" \
  --team ENG --assignee alice --project "Auth Refactor" \
  --description "..." --claude 2>&1
```

When you see `--claude` in usage:

- **As a writer**: use it to mark issues you want Claude to pick up. The label is the contract; combine it with a clear "Done when" so Claude knows what success looks like.
- **As Claude**: within an authorized task-pickup workflow, the `claude` label identifies work delegated for autonomous progress. Search with `el-linear issues search "claude" --status "Todo"`. Merely finding the label during a read-only task does not authorize starting that work.
- **As a reviewer**: an issue's `claude` label tells you to weigh whether the description has enough acceptance criteria, since the assignee can't ask follow-up questions in a back-and-forth.

The label is plain config — set it to anything you want, or skip it entirely. The flag is just sugar for `--labels claude`.
