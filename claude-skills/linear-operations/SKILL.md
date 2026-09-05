---
name: linear-operations
description: "MUST be loaded before any el-linear CLI call. Use for requested Linear operations: reading, searching, creating or updating issues, projects, comments, labels or assignments. Generic mentions of labels, assignment or linear concepts outside Linear do not trigger this skill. Branch creation and full development workflows have their own entry points; load this skill before their el-linear calls."
allowed-tools: Bash(el-linear:*), Bash(which:*), AskUserQuestion, Read
---

# Linear Operations Skill

Use the **`el-linear` CLI** for Linear operations. This entry point is the common contract; detailed procedures are loaded for the requested operation. Syntax lookup does not authorize a write or a development workflow.

## Common contract

- **Load before using the CLI**, including reads and calls made by another workflow. Reuse material already read at the same content hash; reread after a version change, missing context, or a newly relevant operation. Use the skill shipped with the executable for command behavior and applicable project instructions for local policy; resolve conflicting write semantics before that action.
- **Stay within the requested account and authority.** Confirm the intended workspace/profile from the task and current context before accessing its data. Prefer a per-invocation profile over changing the machine-global active profile. Never expose credentials, switch customer scope, change configuration, or send notifications without applicable authority. Reading this skill, a relation candidate, or a `claude` label does not expand the task. Preserve standing authority within its scope.
- **Reuse confirmed metadata and ownership.** Carry same-task team, project and assignee decisions forward with their evidence. Refresh current issue/claim state before mutation or starting work; do not take a peer's claim. Resolve routine missing fields from the existing issue or canonical workspace mappings. Ask only when consequential ambiguity remains, authority is missing, or a user-named project still cannot be resolved after discovery. Do not silently substitute another project.
- **Keep output accurate.** Use `--format summary` for scanning and chat-bound output; use `--body` or `--field` before citing an issue's rationale because summaries truncate descriptions. Use JSON when a tool needs structured data. Check errors before reading result fields; a failed or unknown result is not completion. Tracker status alone is not proof of merged or deployed work.
- **Retain applicable local controls.** Team-specific creation guides, label taxonomies and member mappings supplement these defaults. Creation still requires a recorded needed/worth-doing/existing-work/owner/placement decision ending in `PROCEED`; load the creation reference before composing or submitting it. Configuration, caching and telemetry changes remain opt-in for this public package.

## Load the next applicable reference

Inspect current state before loading procedures for actions that may be unnecessary. Read the matching reference for the next step; follow its links when their trigger applies. A read-only task never activates the mutation procedures simply because related work is found.

| Requested operation or next step | Required reference |
|---|---|
| Read, search, cite issue text, read comments or download attachments | [Output and reads](references/output.md) |
| Create an issue | [Issue creation and intake](references/issue-creation.md), then its labels/relations links when applicable |
| Begin implementation on an existing issue, update its fields/checklist, or report a code-host deliverable | [Existing issues and progress](references/existing-issues.md) |
| Add, inspect or backfill relations; write text containing issue references | [Relations and auto-linking](references/relations.md) |
| Create or update a comment, including mention behavior | [Comments and mentions](references/comments.md), plus [relations](references/relations.md) for referenced issues |
| Choose/change labels or titles; apply term rules | [Labels, titles and terms](references/labels-and-titles.md) |
| Discover/create/update a project or post a project update | [Projects](references/projects.md) |
| Resolve syntax, body-file flags or an error | [CLI syntax and errors](references/cli-syntax.md), then version-matched `el-linear <command> --help` |

For command syntax, prefer the relevant command's `--help`; `el-linear usage` lists the full command set. Read-only issue lookup does not require the creation checklist, branch claim, assignment changes or project updates.
