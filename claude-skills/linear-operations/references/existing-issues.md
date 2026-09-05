## Pre-Work Check (Existing Issues)

Read this when implementation or mutation of an existing issue is authorized. An issue read alone does not trigger these writes. Before mutation, read the current issue and reuse the account, authority and peer-ownership rules in [the entry point](../SKILL.md).

When starting implementation work on an existing issue:

- [ ] **Branch claim path used** — `el-linear issues create --checkout` and `el-linear issues mark-branch ENG-123` automatically claim the issue by assigning it to the current Linear user and moving it to the team's first started state. Use `--no-claim` only when intentionally creating/marking a branch on someone else's behalf.
- [ ] **Project set** — reuse confirmed placement or resolve it from the current issue and canonical workspace mappings. If missing, follow [project discovery](projects.md#discovery-before-creation); ask only when consequential ambiguity remains or the named project cannot be found, then update within the task's authority.
- [ ] **Status appropriate** — if you did not use one of the branch claim paths, move the issue to "In Progress" or your team's equivalent.

Don't start implementation work on an unassigned issue — the assignee is the person accountable. If you did not use one of the branch claim paths (or used `--no-claim`), assign the issue before proceeding.

For a field-only update, retain unrelated metadata and do not claim implementation work. Load [labels and titles](labels-and-titles.md) only when changing those fields, [CLI syntax](cli-syntax.md) for description-file handling, and [relations](relations.md) when the text or update includes issue references. For a partial deliverable that needs a new sub-issue below, load [issue creation and intake](issue-creation.md) first.

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
