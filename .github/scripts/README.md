# Review failure diagnostics

`claude-review-diagnostic.mjs` reads only the action's fixed runner-local
`claude-execution-output.json` file. It prints counts, result flags, allowlisted
SDK error enums and validated HTTP statuses from `system/api_retry` envelopes.
It never inspects free-text errors, message content or tool results for a cause.
An empty status list means no structured HTTP status was retained. Unknown,
missing, oversized and invalid input remain explicit.

The workflow runs this after an unsuccessful AI step or a missing action
conclusion. It does not change the failed step's outcome, grant review approval,
retry a model, upload execution files or enable full-output logging. SDK success
and action success are separate fields; neither proves a posted advisory.

Run the real subprocess fixtures with:

```sh
node --test .github/scripts/claude-review-diagnostic.test.mjs
```

Contracts: [action execution file](https://github.com/anthropics/claude-code-action/blob/v1/base-action/src/execution-file.ts),
[Agent SDK envelopes](https://code.claude.com/docs/en/agent-sdk/typescript), and
[public-log security](https://github.com/anthropics/claude-code-action/blob/v1/docs/security.md).
The action may skip workflow-changing PRs during its GitHub token exchange.
That skip remains pending review; it is not provider authentication evidence.
Live diagnosis then requires the normal reviewed workflow rollout, without
changing credentials or bypassing the action's workflow validation.
