# Gate telemetry (optional, opt-in)

`el-linear issues create` runs a **duplicate-detection gate**: before creating
an issue it searches for a similar existing one and blocks (listing the
candidates) when the title overlap crosses a threshold. `--allow-duplicate`
proceeds anyway. See `config.validation.duplicateThreshold` in
[configuration.md](./configuration.md).

To let you tell whether that gate is **noisy** — firing on too many legitimate
issues — el-linear can record each decision to a small local file. The headline
metric is the **override-rate**:

```
override-rate = overridden / (blocked + overridden)
```

Every `--allow-duplicate` is you telling the gate it was wrong; a high
override-rate means the threshold should be retuned.

## This is off by default

el-linear is open-source and **writes nothing** unless telemetry is actually
configured. Emission turns on only when:

| Condition | Result |
|-----------|--------|
| `EL_TELEMETRY_DISABLED` is set | **Off.** Hard opt-out, wins over everything. |
| `EL_TELEMETRY_DIR=<path>` is set | **On** → writes to `<path>/gate-events.jsonl` (created on demand). Setting an explicit destination is the opt-in. |
| neither is set | **On only if `~/.cache/el-telemetry/` already exists** (i.e. you already run the Enrich Layer telemetry tooling). A fresh install has no such directory, so nothing is written. |

There is **no server and no database** — the ledger is a plain append-only
JSONL file on your machine. Nothing is sent anywhere.

To enable it on an open-source install, just point it at a directory:

```bash
export EL_TELEMETRY_DIR="$HOME/.el-linear-telemetry"
```

## The ledger format

Each gate decision appends one JSON line to `gate-events.jsonl`:

```json
{
  "ts": "2026-06-20T07:56:40.322Z",
  "kind": "gate",
  "name": "el-linear",
  "subcommand": "issues create",
  "metadata": {
    "gate": "issues-create-dup",
    "outcome": "blocked",
    "top_score": 0.62,
    "candidate_count": 2
  }
}
```

| Field | Meaning |
|-------|---------|
| `ts` | ISO-8601 timestamp of the decision. |
| `metadata.gate` | Stable gate id (`issues-create-dup`). |
| `metadata.outcome` | `blocked` (gate stopped creation) or `overridden` (`--allow-duplicate` proceeded past a would-fire). |
| `metadata.top_score` | Highest candidate similarity (0–1) that triggered the gate. |
| `metadata.candidate_count` | How many candidates crossed the threshold. |

`--skip-validation` is a blanket bypass and records **nothing** — it isn't a
gate-specific override, so counting it would distort the override-rate.

Writes are best-effort: if the file can't be written, issue creation proceeds
normally and no error is raised.

## Reading it

Because it's plain JSONL, any tool works. To compute override-rate with `jq`:

```bash
LEDGER="${EL_TELEMETRY_DIR:-$HOME/.cache/el-telemetry}/gate-events.jsonl"

jq -rs '
  map(.metadata) |
  (map(select(.outcome=="blocked"))    | length) as $blocked |
  (map(select(.outcome=="overridden")) | length) as $overridden |
  ($blocked + $overridden) as $total |
  "blocked=\($blocked) overridden=\($overridden) " +
  "override_rate=\(if $total>0 then ($overridden*100/$total|floor) else 0 end)%"
' "$LEDGER"
```

Enrich Layer's internal tooling ships a reference reader,
`el-telemetry gates --days 90`, which aggregates the same ledger and prints a
per-gate override-rate table. It is not part of this open-source package; the
schema above is the contract, so you can read the ledger with the snippet above
or build your own consumer.
