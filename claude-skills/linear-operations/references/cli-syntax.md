# CLI syntax and errors

Match these details to the executable version. Use `el-linear <command> --help` for the operation at hand. File-sourced project text uses the two fields described in [projects](projects.md#content-vs-description).

## CLI Syntax Rules

Run `el-linear usage` for the full command reference. Non-obvious rules:

- **Always append `2>&1`** to capture errors.
- **Labels are comma-separated** — `--labels "feature,backend"` (not repeated flags).
- **Singular/plural interchangeable** — `issues`/`issue`, `labels`/`label`, etc.
- **Subcommand aliases** — `read`/`view`/`get`/`show`, `update`/`edit`/`set`.
- **`--jq` for GraphQL filtering** — never pipe through `jq` directly (zsh escaping breaks `!=`).
- **`--raw` flag** strips the `{ data, meta }` wrapper — emits just the array.
- **Body/description/content from a file** — `issues create`/`update` take `--description-file <path>`; `comments create`/`update` take `--body-file <path>`; **`projects create`/`update` take `--content-file <path>`** (the project's full markdown **content**, not its short `description` — see [Content vs Description](projects.md#content-vs-description)). Prefer the file form for any body with backticks, fenced code, or markdown tables — it sidesteps shell-quoting traps (the same reason `el-git mr comment --body-file` exists). The inline and file flags are **mutually exclusive** (passing both errors); file-sourced bodies get the same auto-link / auto-mention treatment as inline text.

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
