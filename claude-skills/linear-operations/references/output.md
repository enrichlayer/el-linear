# Output and read operations

These read surfaces do not authorize issue changes, relations or implementation. Reuse [the common contract](../SKILL.md) and choose the section for the requested output.

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

#### Citing an issue's stated rationale: `--body` or `--field`, never `--format summary`

**`--format summary` truncates the description.** That is correct for scanning a board and wrong the moment you quote, cite, or reason from what an issue *says*. A research pass once read an issue with `--format summary`, saw a truncated description, and published the opposite of the design position that issue states outright — the fix was one command with a different flag, run twenty minutes too late.

So: the moment a claim is about an issue's **stated rationale** — what a decision claimed at the time, why an approach was chosen, what a spec requires — read `--body` (or `--field <section>` for one section) and quote from that.

```bash
# ✅ Reasoning from what the issue actually says
el-linear issues read DEV-123 --body 2>&1
el-linear issues read DEV-123 --field "Why we need this" 2>&1

# ❌ Citing a summary — the description you are quoting may be cut off
el-linear issues read DEV-123 --format summary 2>&1
```

The scope is narrow and worth stating precisely: an issue body is a weak source for *system behavior* — it records what someone intended, not what the code does — but it is the **authoritative** artifact for what a decision claimed at the time. Use it for the second, not the first.

#### An umbrella's status is not delivery evidence

A parent or umbrella issue's own status says nothing reliable about whether the work shipped. Read its children and slices, then read the artifact.

```bash
el-linear issues related DEV-100 --format summary 2>&1
```

Neither direction is safe on its own:

- **Canceled does not mean abandoned.** An umbrella is routinely closed as bookkeeping after its slices land — one was reported as "abandoned" in a research document while all six of its children were Done and the code was in production.
- **Done children do not prove delivery either.** A child can be a duplicate, a rename, or an administrative closure.

The tracker is a lead. The **merged MR or the deployed code** is the evidence — go look at it before writing "shipped" or "abandoned".

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

Empty output from a `--body` surface is never a silent success. `comments list
--body` exits 1 with `el-linear: DEV-123 has no comments` on stderr when the
issue has none (and `… has N comments, none with a body` when every body came
back blank), matching `comments read --body`'s guard — so "no comments" stays
distinguishable from "the fetch silently dropped the list". `--format summary`
(`(no results)`) and the JSON envelope (`meta.count`) report emptiness in band
and stay exit 0.

### Attachment reads and downloads

List attachments first, then use the attachment ID or exact title. Text files
can be streamed directly; binary files require an explicit download path.

```bash
el-linear attachments list DEV-123 --format summary
el-linear attachments read DEV-123 <attachment-id>
el-linear attachments download DEV-123 <attachment-id> --output /tmp/report.pdf
```

Do not reconstruct authenticated `curl` commands from attachment URLs. The
attachment commands use the active Linear profile and reject binary stdout.

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

- **Single resources:** `issues read`, `comments read`, `projects read`, `cycles read`, `project-milestones read`, `project-updates read`, `documents read`, `templates read`, releases (`graphql` query results), `users read`
- **Lists:** `issues list`, `issues search`, `projects list`, `comments list`, `cycles list`, `project-milestones list`, `project-updates list`, `labels list`, `teams list`, `users list`, `documents list`, `templates list`, `attachments list`, `releases list`, and the cross-resource `search` command

Commands without a dedicated formatter (e.g. `config show`, custom `graphql` queries) fall back to a generic key/value rendering of their JSON payload.
