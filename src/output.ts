/**
 * Public output utilities — secondary entry point for cross-CLI reuse.
 *
 * Other Enrich Layer CLIs (el-slack, el-sheets, el-audit, el-git,
 * el-elasticsearch — currently in the `tools` monorepo) should depend on
 * `@enrichlayer/el-linear` and import this module to share the same
 * `--jq` / `--fields` / `--raw` / `--format summary` behavior and the
 * canonical `{ data, meta }` envelope shape. DEV-3799.
 *
 * Why this exists rather than a separate package: linctl is the OSS
 * canonical source of these patterns (DEV-3619, DEV-3637, DEV-3798); it
 * already publishes to npm and ships compiled JS in `dist/`. Treating it
 * as the host of the shared utilities means there is exactly one
 * implementation, exactly one set of tests, and exactly one place where
 * the envelope contract is documented. Tools-repo CLIs pick it up via
 * `pnpm add @enrichlayer/el-linear` and `import { outputSuccess, ... }
 * from "@enrichlayer/el-linear/output"`.
 *
 * Stable API — semver-tracked. Anything re-exported here MUST stay
 * backwards-compatible across minor releases. Adding exports is fine;
 * renaming or removing them is a breaking change.
 *
 * # Wiring (consumer recipe)
 *
 * Each CLI's `main.ts` registers four global options and a `preAction`
 * hook to read them into the shared state:
 *
 * ```ts
 * import { Command } from "commander";
 * import {
 *   setRawMode, setJqFilter, setFieldsFilter, setOutputFormat,
 * } from "@enrichlayer/el-linear/output";
 *
 * const program = new Command()
 *   .option("--raw", "strip { data, meta } wrapper from list output")
 *   .option("--jq <filter>", "apply a jq filter to the JSON output")
 *   .option("--fields <fields>", "comma-separated field allow-list")
 *   .option("--format <fmt>", "json | summary", "json");
 *
 * program.hook("preAction", (_thisCommand, actionCommand) => {
 *   const o = actionCommand.optsWithGlobals();
 *   if (o.raw) setRawMode(true);
 *   if (o.jq) setJqFilter(o.jq);
 *   if (o.fields) {
 *     setFieldsFilter(o.fields.split(",").map((s: string) => s.trim()));
 *   }
 *   setOutputFormat(o.format === "summary" ? "summary" : "json");
 * });
 * ```
 *
 * Then in each subcommand handler emit results via `outputList(data)` /
 * `outputSingle(data)` / `outputSuccess(payload)`, wrap async actions in
 * `handleAsyncCommand`, and buffer informational messages via
 * `outputWarning`. The shared state in this module takes care of `--jq`,
 * `--fields`, `--raw`, and summary rendering uniformly.
 *
 * Adapt the option names and flags to your CLI's existing conventions —
 * the contract is the four setter calls (`setRawMode`, `setJqFilter`,
 * `setFieldsFilter`, `setOutputFormat`), not the literal `--jq` /
 * `--fields` / `--raw` / `--format` names. A CLI that already exposes
 * `--json` / `--summary` shorthands can keep them as long as the
 * preAction hook ends up calling the same setters with equivalent values.
 *
 * # What is NOT exported
 *
 * - `--format summary` dispatch tables are linctl-specific (Linear
 *   resources). Other CLIs that want summary rendering should either
 *   ship `--format json` only or register their own per-command summary
 *   path that does not consume this module's `setOutputFormat("summary")`.
 * - `outputError` is intentionally internal — it calls `process.exit(1)`
 *   directly. Consumers funnel errors through `handleAsyncCommand`, which
 *   in turn calls `outputError`. Don't re-export the bare function; the
 *   wrapper is the contract.
 * - Token-sanitization (`sanitizeForLog`) is internal to the error path.
 *   Consumers that route errors through `handleAsyncCommand` automatically
 *   get token redaction on the error path — no separate redactor needed
 *   for that case. If a consumer wants sanitization for something OTHER
 *   than thrown errors (e.g. a custom debug log), it should pull a small
 *   redactor of its own; coupling token redaction to the output layer
 *   would make this API surface stickier than it needs to be.
 */

export {
	type CliListEnvelope,
	getOutputFormat,
	handleAsyncCommand,
	type ListExtraMeta,
	type ListMeta,
	outputList,
	outputSingle,
	outputSuccess,
	outputWarning,
	resetWarnings,
	setFieldsFilter,
	setJqFilter,
	setOutputFormat,
	setRawMode,
	type WindowedMeta,
	warnIfTruncated,
} from "./utils/output.js";
