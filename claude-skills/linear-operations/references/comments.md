# Comments and mentions

Read this before an authorized comment write. Comments can notify people; follow [the common authority rules](../SKILL.md). Use [CLI syntax](cli-syntax.md) for body-file flags and [relations](relations.md#auto-linking-issue-references-on-createupdate) when the text references issues.

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
