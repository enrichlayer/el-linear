# Labels, titles and terms

Load this when choosing or changing labels or titles. Preserve [the common scope and metadata rules](../SKILL.md); creating a label or editing term configuration requires applicable authority.

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

### Title Readability — plain language, jargon in the body

**The title says what problem is being solved, in words a non-author can read.** The title is the shared surface — a teammate scanning the board, a manager triaging priority, a future picker deciding what to pick up. If it only parses for the person who wrote it that week, that whole audience is locked out. This applies to **MR/PR titles too** — they front the same board.

**Keep the mechanism detail — function names, env-var constants, symbol soup — in the description, not the title.** Moving it into the body doesn't lose precision; it puts precision where the reader who opens the issue actually wants it. The title carries the *problem*; the body carries the *how*.

- **Lead with the problem or outcome**, not the internal symbol at the center of it.
- **Move code identifiers, env-var constants, and file/function names into the body**, under a `## …` heading where they read as helpful context.
- **Proper nouns that ARE the clearest name stay.** The name of a tool, service, or protocol a teammate would recognize (a CLI name, `Vault`, `CI`, `OAuth`) is not jargon — don't paraphrase it into vagueness. The test is "would a teammate recognize this?", not "does it contain a lowercase token?".
- **Don't overcorrect into mush.** "Fix the thing that was broken" is worse than a jargon title — specificity still matters, just express it in problem terms.

Before → after:

| ❌ Jargon title | ✅ Plain-language title |
|---|---|
| `parseTokenBucket drops refill when lastRefillTs is unset` | Fix rate limiter losing its refill allowance after an idle period |
| `AUTH_SESSION_TTL mismatch logs out users early in refreshSession` | Fix users getting logged out before their session length expires |
| `Extract validateEntry into shared pkg (3 hand-rolled copies)` | Extract the duplicated entry validator into a shared package |

The mechanism (`parseTokenBucket`, `AUTH_SESSION_TTL`, `refreshSession`, the three copies) still gets stated — in the **description**, where it reads as context instead of a barrier.

### Rules

- **Create missing labels liberally** — `el-linear labels create "my-label" --team ENG`.
- **`--claude` flag** adds the workspace-level "claude" label automatically.
- Resolve routine domain labels from the current issue or canonical workspace taxonomy; ask only if a consequential domain choice remains ambiguous.

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
