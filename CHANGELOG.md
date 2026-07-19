# Changelog

All notable changes to `@enrichlayer/el-linear` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

### Features

* **issues:** add an opt-in intake-decision gate that requires explicit need, value, ownership, placement, and a `PROCEED` decision before creation; `--skip-validation` cannot silently bypass it (DEV-6163)
* **issues:** add an opt-in create-time goal-completion gate — checks the description for a falsifiable "Done when" / acceptance-criteria section, `warn`/`block` modes via `validation.goalCompletionGate`, bypass with `--allow-vague-goal` (DEV-5920)
* **projects:** add `projects update --name/--description/--content` for editing project metadata without raw GraphQL (DEV-5749)

### Bug Fixes

* **issues:** offer the `--parent` sub-issue path when the duplicate gate flags a candidate — the block previously presented only "comment on it instead" and "`--allow-duplicate`", omitting the common case where the new work is a *piece* of the match, which pushed operators into reusing multi-phase parent issues. The remedy is per-tier: the hard block names `--parent <id> --allow-duplicate` (a re-run), while the advisory tier names `issues update <new-id> --parent <id>`, since creation has already proceeded there and a re-run would file a second issue (DEV-6205)
* **issues:** honor read options such as `--body` on the nested `issues read` and `issue read` routes (DEV-6141)
* **quality:** restore a clean full-repository lint baseline (DEV-6142)
* **labels:** resolve `labels create --team` keys and names before creating the label (DEV-5749)

## [1.43.1](https://github.com/enrichlayer/el-linear/compare/v1.43.0...v1.43.1) (2026-07-19)


### Bug Fixes

* **refs:** preserve HTML comment markers (DEV-6481) ([#271](https://github.com/enrichlayer/el-linear/issues/271)) ([7987f89](https://github.com/enrichlayer/el-linear/commit/7987f898b894ee91f5654d72ed90670d80baa6f0))
* **workflow:** retry safe mutations and guard branch markers (DEV-6570) ([#272](https://github.com/enrichlayer/el-linear/issues/272)) ([ff62612](https://github.com/enrichlayer/el-linear/commit/ff626127f21496a0fd10c1db110da25e01906863))

## [1.43.0](https://github.com/enrichlayer/el-linear/compare/v1.42.0...v1.43.0) (2026-07-16)


### Features

* **issues:** auto-chunk issues list so large teams don't hit the GraphQL complexity cap (DEV-6312) ([#268](https://github.com/enrichlayer/el-linear/issues/268)) ([fe9046f](https://github.com/enrichlayer/el-linear/commit/fe9046fb5c3708bafd5fb98c64ff651b234f3845))

## [1.42.0](https://github.com/enrichlayer/el-linear/compare/v1.41.1...v1.42.0) (2026-07-15)


### Features

* add automated advisory PR review GitHub Action ([#259](https://github.com/enrichlayer/el-linear/issues/259)) ([711d4a1](https://github.com/enrichlayer/el-linear/commit/711d4a175bc823833b78972394c03fb7bb5ce699))
* **config:** optional identity-resolver hook (DEV-5628) ([#256](https://github.com/enrichlayer/el-linear/issues/256)) ([0f91e8c](https://github.com/enrichlayer/el-linear/commit/0f91e8c26cf744bfcab88a388b02e70df501a855))


### Bug Fixes

* **ci:** grant Claude review action OIDC permission ([68c0050](https://github.com/enrichlayer/el-linear/commit/68c005085d0e61f9aae181c257f21eea09cce039))

## [1.41.1](https://github.com/enrichlayer/el-linear/compare/v1.41.0...v1.41.1) (2026-07-15)


### Bug Fixes

* **issues:** honor nested read options (DEV-6141) ([#257](https://github.com/enrichlayer/el-linear/issues/257)) ([b58997c](https://github.com/enrichlayer/el-linear/commit/b58997ca33b4097c0658753cae0a363ab8697275))
* **issues:** offer the sub-issue path when the duplicate gate fires ([#263](https://github.com/enrichlayer/el-linear/issues/263)) ([8b05fae](https://github.com/enrichlayer/el-linear/commit/8b05fae7430d50e4cf836cf6447f827c6eb4b28b))
* **lint:** stop the biome scan from following links out of the repo (DEV-6206) ([#264](https://github.com/enrichlayer/el-linear/issues/264)) ([25ca91b](https://github.com/enrichlayer/el-linear/commit/25ca91b817bd66339385f8286b2ea98dbe4fa58e))

## [1.41.0](https://github.com/enrichlayer/el-linear/compare/v1.40.0...v1.41.0) (2026-07-15)


### Features

* **issues:** require explicit intake decisions ([#260](https://github.com/enrichlayer/el-linear/issues/260)) ([9359415](https://github.com/enrichlayer/el-linear/commit/93594153a9851c7dded6d2724a4c055f5f6ee22c))


### Bug Fixes

* **quality:** restore clean lint baseline (DEV-6142) ([#258](https://github.com/enrichlayer/el-linear/issues/258)) ([f6542b9](https://github.com/enrichlayer/el-linear/commit/f6542b928969a81c22373e071080ba75933f53f9))

## [1.40.0](https://github.com/enrichlayer/el-linear/compare/v1.39.0...v1.40.0) (2026-07-14)


### Features

* **projects:** add --content-file to projects create/update (DEV-6033) ([9232e97](https://github.com/enrichlayer/el-linear/commit/9232e97c7513a28bf67f863bbdb9416a5cae8043))
* **skill:** document projects --content-file in the published linear-operations skill (DEV-6033) ([401df22](https://github.com/enrichlayer/el-linear/commit/401df22387be5fd1de108bb9f0ab69f65023d932))

## [1.39.0](https://github.com/enrichlayer/el-linear/compare/v1.38.2...v1.39.0) (2026-07-13)


### Features

* **skill:** require plain-language, jargon-free issue and MR titles (DEV-6051) ([#248](https://github.com/enrichlayer/el-linear/issues/248)) ([e68dc9d](https://github.com/enrichlayer/el-linear/commit/e68dc9d0d7497ad3d0f1980620dc8bda811e688a))

## [1.38.2](https://github.com/enrichlayer/el-linear/compare/v1.38.1...v1.38.2) (2026-07-12)


### Bug Fixes

* **documents:** list directly linked issue documents (DEV-5971) ([#243](https://github.com/enrichlayer/el-linear/issues/243)) ([1d255a7](https://github.com/enrichlayer/el-linear/commit/1d255a7aacf0f478b320c966cb77d7b9a2cbb0d9))

## [1.38.1](https://github.com/enrichlayer/el-linear/compare/v1.38.0...v1.38.1) (2026-07-12)


### Bug Fixes

* **attachments:** add authenticated reads and downloads (DEV-5981) ([#244](https://github.com/enrichlayer/el-linear/issues/244)) ([64e7bdd](https://github.com/enrichlayer/el-linear/commit/64e7bdd647d4b7f4832e6d197a3b67bd57585203))
* **issues:** enrich the DocumentContent write-conflict error with an actionable hint (FE-926) ([#240](https://github.com/enrichlayer/el-linear/issues/240)) ([0fa04af](https://github.com/enrichlayer/el-linear/commit/0fa04af8c41317b1e915a284d3e1bb5ea4bbee15))

## [1.38.0](https://github.com/enrichlayer/el-linear/compare/v1.37.2...v1.38.0) (2026-07-09)


### Features

* **relations:** proactive-first relation_candidates guidance + linear-operations skill (DEV-5853) ([#239](https://github.com/enrichlayer/el-linear/issues/239)) ([4792c05](https://github.com/enrichlayer/el-linear/commit/4792c05a0b92dd3a614f7648829853fe2c89a2ba))


### Bug Fixes

* include test files in typecheck ([#235](https://github.com/enrichlayer/el-linear/issues/235)) ([a53236f](https://github.com/enrichlayer/el-linear/commit/a53236fd514b280b1b1c1721e44eff6ebab21207))
* **release:** guard el-linear PR titles ([#236](https://github.com/enrichlayer/el-linear/issues/236)) ([3c5cf73](https://github.com/enrichlayer/el-linear/commit/3c5cf73a5ba398c10af5320c3d24d2ea8b232735))

## [1.37.2](https://github.com/enrichlayer/el-linear/compare/v1.37.1...v1.37.2) (2026-07-06)


### Bug Fixes

* **init:** skip the Linear system actor in the alias wizard + add direct member edit/clear and users read (DEV-5612) ([#228](https://github.com/enrichlayer/el-linear/issues/228)) ([ff98492](https://github.com/enrichlayer/el-linear/commit/ff984920b77e8305475a0c16050b1db70860c9a9))
* **issues:** make the duplicate-detection gate two-tier to cut the override rate (DEV-5590) ([#227](https://github.com/enrichlayer/el-linear/issues/227)) ([0c506a4](https://github.com/enrichlayer/el-linear/commit/0c506a41e2bb55868d2f4b83741228229b5f48bf))

## [1.37.1](https://github.com/enrichlayer/el-linear/compare/v1.37.0...v1.37.1) (2026-07-06)


### Bug Fixes

* honor --format table/csv with --fields and resolve status/updated aliases on list paths (DEV-5376) ([#224](https://github.com/enrichlayer/el-linear/issues/224)) ([a479985](https://github.com/enrichlayer/el-linear/commit/a479985ab35f93abbeb3df56a99a2c517a59e69f))
* scope issues list --team through Team.issues so the team filter survives pagination (DEV-5578) ([#222](https://github.com/enrichlayer/el-linear/issues/222)) ([eeffa3f](https://github.com/enrichlayer/el-linear/commit/eeffa3f67c26255962445cc8602e09099c69fde2))

## [1.37.0](https://github.com/enrichlayer/el-linear/compare/v1.36.0...v1.37.0) (2026-07-03)


### Features

* expose completedAt on issue reads, lists, search, and tree nodes ([#218](https://github.com/enrichlayer/el-linear/issues/218)) ([a49acbc](https://github.com/enrichlayer/el-linear/commit/a49acbcdc1f13e9ed7e91c395a6e5dba271fc1cc))

## [1.36.0](https://github.com/enrichlayer/el-linear/compare/v1.35.0...v1.36.0) (2026-07-02)


### Features

* **issues:** add opt-in SOP-label parent gate to issues create (DEV-5378) ([#215](https://github.com/enrichlayer/el-linear/issues/215)) ([5442d99](https://github.com/enrichlayer/el-linear/commit/5442d998facf7e8a28c6cefe782420e581a79949))

## [1.35.0](https://github.com/enrichlayer/el-linear/compare/v1.34.1...v1.35.0) (2026-07-02)


### Features

* add project-updates command group (create/list/read) ([#210](https://github.com/enrichlayer/el-linear/issues/210)) ([82e3bef](https://github.com/enrichlayer/el-linear/commit/82e3bef25a1d3ea09bf80d05d6d1207ff945723a))
* add project-updates command group (create/list/read) ([#210](https://github.com/enrichlayer/el-linear/issues/210)) ([82e3bef](https://github.com/enrichlayer/el-linear/commit/82e3bef25a1d3ea09bf80d05d6d1207ff945723a))


### Bug Fixes

* **issue-id:** accept the feat/ branch prefix (DEV-5342) ([#211](https://github.com/enrichlayer/el-linear/issues/211)) ([ec5a698](https://github.com/enrichlayer/el-linear/commit/ec5a6986929b0d4ce7852a2ceae3422bc2f0fe8d))
* **output:** surface warnings on bare-array and --raw output ([#214](https://github.com/enrichlayer/el-linear/issues/214)) ([07ada3c](https://github.com/enrichlayer/el-linear/commit/07ada3c394773dca1a24abefa6c596d73622aa61))

## [1.34.1](https://github.com/enrichlayer/el-linear/compare/v1.34.0...v1.34.1) (2026-07-02)


### Bug Fixes

* **output:** --fields resolves dotted paths, envelope object data, and fails visible on unresolved fields ([#207](https://github.com/enrichlayer/el-linear/issues/207)) ([522d761](https://github.com/enrichlayer/el-linear/commit/522d76124e63de915d17319c995b0ad110e40f6b))
* **projects:** route --team scoping through Team.projects (ProjectFilter has no teams filter) ([#209](https://github.com/enrichlayer/el-linear/issues/209)) ([65dea99](https://github.com/enrichlayer/el-linear/commit/65dea9919ba45c8f503e470c73998152ee7d137d))

## [1.34.0](https://github.com/enrichlayer/el-linear/compare/v1.33.0...v1.34.0) (2026-07-01)


### Features

* **issues:** add no-subcommand read shorthand + related summary table (DEV-5174) ([#205](https://github.com/enrichlayer/el-linear/issues/205)) ([d3ff369](https://github.com/enrichlayer/el-linear/commit/d3ff3695feda0d80b71fff0fe54f2ad250438a90))

## [1.33.0](https://github.com/enrichlayer/el-linear/compare/v1.32.3...v1.33.0) (2026-07-01)


### Features

* accept --parent as alias for --parent-ticket ([#97](https://github.com/enrichlayer/el-linear/issues/97)) ([d26233c](https://github.com/enrichlayer/el-linear/commit/d26233c8fada859c1f80526d10cb547642aaf577))
* **auth:** add OAuth 2.0 (PKCE) authentication ([#18](https://github.com/enrichlayer/el-linear/issues/18)) ([4e3b59f](https://github.com/enrichlayer/el-linear/commit/4e3b59f501e975b7b291d6926dba16a7d5a4bd0d))
* **auth:** migrate command call sites to OAuth-aware getActiveAuth ([#19](https://github.com/enrichlayer/el-linear/issues/19)) ([76c7e8d](https://github.com/enrichlayer/el-linear/commit/76c7e8d70527644c4661f7805a02b7792a2922e1))
* **auth:** wire OAuth into FileService (last unmigrated auth path) ([#20](https://github.com/enrichlayer/el-linear/issues/20)) ([57a3d59](https://github.com/enrichlayer/el-linear/commit/57a3d59f2fa623de95a066eaad1f9cb1301d6eba))
* **branch:** add branch validate subcommand (team-validity gate) ([#194](https://github.com/enrichlayer/el-linear/issues/194)) ([477c732](https://github.com/enrichlayer/el-linear/commit/477c7322c19c474b21e07722609fcc9dae5d18f9))
* **cli:** add cli-introspect + validate-flag for SKILL.md flag-name linting ([#76](https://github.com/enrichlayer/el-linear/issues/76)) ([5e97d5d](https://github.com/enrichlayer/el-linear/commit/5e97d5d4b1427762812ea461781ead8972f7524f))
* **comments:** add 'comments delete' + lock multi-element update parity (DEV-4306) ([#127](https://github.com/enrichlayer/el-linear/issues/127)) ([4dafdef](https://github.com/enrichlayer/el-linear/commit/4dafdefe9d0f6f42966e7ebacf5d36927f763e72))
* **comments:** enforce --body/--body-file mutual exclusivity + document body-file (DEV-4450) ([#143](https://github.com/enrichlayer/el-linear/issues/143)) ([262e017](https://github.com/enrichlayer/el-linear/commit/262e017e24a60099a1ea863cd95d9d95ed2c823a))
* **comments:** rename --file to --body-file on create and update ([#110](https://github.com/enrichlayer/el-linear/issues/110)) ([61caf88](https://github.com/enrichlayer/el-linear/commit/61caf88550c55d114cb7cb85f16e124e50bcaa2d))
* **comments:** report mention resolution + warn on unresolved [@names](https://github.com/names) (DEV-4987) ([#186](https://github.com/enrichlayer/el-linear/issues/186)) ([64a3988](https://github.com/enrichlayer/el-linear/commit/64a398820f92e567f51340f4609f9d41c147a788))
* **config:** add 'config migrate-from-personal' to slim against team (DEV-4458) ([#141](https://github.com/enrichlayer/el-linear/issues/141)) ([c93a096](https://github.com/enrichlayer/el-linear/commit/c93a0966180a9b9ec38b9316ca8008f7f91de013))
* **config:** add `config team` subcommand for wiring shared team config (DEV-4104) ([#114](https://github.com/enrichlayer/el-linear/issues/114)) ([371e7b7](https://github.com/enrichlayer/el-linear/commit/371e7b7be9af68a6decd81e5eb74586b451fddb8))
* **config:** add team/local config split with local.json (DEV-4172) ([#108](https://github.com/enrichlayer/el-linear/issues/108)) ([95bebab](https://github.com/enrichlayer/el-linear/commit/95bebabd17ff6aae0c557b74ea7d5669fccf173b))
* **config:** auto-discover team config from ~/.config/el-tools-root marker (DEV-4258) ([#116](https://github.com/enrichlayer/el-linear/issues/116)) ([414aba9](https://github.com/enrichlayer/el-linear/commit/414aba998ae67eb597f06fa3a42530e05b313e1d))
* **config:** support shared team config file layer ([ea3f282](https://github.com/enrichlayer/el-linear/commit/ea3f28215b2850288254359d654348f907c422c3))
* defaults (assignee, priority), disk cache, wizard prompts, team OAuth config ([#22](https://github.com/enrichlayer/el-linear/issues/22)) ([0525c2f](https://github.com/enrichlayer/el-linear/commit/0525c2f8a96c584f09ef900b6b307201888addea))
* **discovery:** URL/slug project resolution + truncation warning + CLI-first rule ([#100](https://github.com/enrichlayer/el-linear/issues/100)) ([29ea130](https://github.com/enrichlayer/el-linear/commit/29ea1304357e3f123f2ddec54913edc764f30412))
* enrich issues create validation errors with team-scoped suggestions ([#98](https://github.com/enrichlayer/el-linear/issues/98)) ([763a495](https://github.com/enrichlayer/el-linear/commit/763a495afbaecbdc1ab9b1ead9d5656b3d800712))
* **enrich:** route project resolver failures through team-scoped enrichment (DEV-4135) ([#101](https://github.com/enrichlayer/el-linear/issues/101)) ([db6c81d](https://github.com/enrichlayer/el-linear/commit/db6c81d2c9069c50dbb8d15d8afe15fd6ec8af35))
* **filters:** add --name to users/labels/projects list, --state/--exclude-state/--active to projects list ([#36](https://github.com/enrichlayer/el-linear/issues/36)) ([a52f005](https://github.com/enrichlayer/el-linear/commit/a52f005ea049038ea16fecd600d57dda9dd9b162))
* **format:** add --format summary for human-readable output ([#28](https://github.com/enrichlayer/el-linear/issues/28)) ([2bdf3d2](https://github.com/enrichlayer/el-linear/commit/2bdf3d24107b5d996738b54fbac07930c8fff5ae))
* **init:** interactive setup wizard (linctl init) ([#7](https://github.com/enrichlayer/el-linear/issues/7)) ([23c62f8](https://github.com/enrichlayer/el-linear/commit/23c62f8b7e7a72b57ea5c99e3d6711dfba3cc469))
* **issue-id:** accept bug/ and spike/ branch prefixes (DEV-4777) ([#167](https://github.com/enrichlayer/el-linear/issues/167)) ([00c500f](https://github.com/enrichlayer/el-linear/commit/00c500f721b0b6f28b59f8b828187ad7769caed5))
* **issue-id:** accept codex/ branch prefix (DEV-4660) ([#160](https://github.com/enrichlayer/el-linear/issues/160)) ([800418c](https://github.com/enrichlayer/el-linear/commit/800418ca51737274a211627abd6bce22a043e501))
* **issues read:** add --sections for multi-section extraction (DEV-4479) ([#145](https://github.com/enrichlayer/el-linear/issues/145)) ([eeb9a0f](https://github.com/enrichlayer/el-linear/commit/eeb9a0f2e2f405eeeceba37afdd6d05f1d70ed25))
* **issues:** accept relation flags on issues update (DEV-4201) ([#111](https://github.com/enrichlayer/el-linear/issues/111)) ([afa05c5](https://github.com/enrichlayer/el-linear/commit/afa05c501034913ed6c6235f60f8d229eb7dca1b))
* **issues:** add --field flag to issues read for markdown section extraction (ALL-940) ([#71](https://github.com/enrichlayer/el-linear/issues/71)) ([404002f](https://github.com/enrichlayer/el-linear/commit/404002fbf992fc789cb79ba2d02e30d3ad8ec44c))
* **issues:** add --quiet and summary output to issues relate (DEV-5081) ([#191](https://github.com/enrichlayer/el-linear/issues/191)) ([8aaa102](https://github.com/enrichlayer/el-linear/commit/8aaa102d00ccad93ef097b8162210c74c1b0a8e0))
* **issues:** add `issues tree <ID>` for depth-N parent→children walks (DEV-4480) ([#149](https://github.com/enrichlayer/el-linear/issues/149)) ([19ebdbb](https://github.com/enrichlayer/el-linear/commit/19ebdbbc2be74553b324b2d722d4e89a5da4ba34))
* **issues:** add duplicate-detection gate to issues create (DEV-4823) ([#171](https://github.com/enrichlayer/el-linear/issues/171)) ([bb830f5](https://github.com/enrichlayer/el-linear/commit/bb830f5d71fef7496838741426030229bcc7bf0f))
* **issues:** auto-claim on branch creation (DEV-4500) ([#155](https://github.com/enrichlayer/el-linear/issues/155)) ([530ffa1](https://github.com/enrichlayer/el-linear/commit/530ffa1762d36544f713ead0a3c05ab67e64ad51))
* **issues:** default --include-closed off on list/search (DEV-4478) ([#146](https://github.com/enrichlayer/el-linear/issues/146)) ([5edf798](https://github.com/enrichlayer/el-linear/commit/5edf798de1aa6ef8684e7fb4498a36aff6886ed3))
* **issues:** emit dup-gate blocked/overridden telemetry events (DEV-4834) ([#174](https://github.com/enrichlayer/el-linear/issues/174)) ([18afcd3](https://github.com/enrichlayer/el-linear/commit/18afcd3d03eb9a0999125b555ff588b4516df32a))
* **issues:** record branch.&lt;branch&gt;.linearIssue marker on branch creation (DEV-4293) ([#128](https://github.com/enrichlayer/el-linear/issues/128)) ([be59c1d](https://github.com/enrichlayer/el-linear/commit/be59c1da04e7bce600f837290cd22b2101e639fe))
* **output:** add WindowedMeta type to the shared output envelope (DEV-4668) ([#163](https://github.com/enrichlayer/el-linear/issues/163)) ([ed9e448](https://github.com/enrichlayer/el-linear/commit/ed9e4484fc256b1db1b918d93d696b65ff528095))
* **output:** expose @enrichlayer/el-linear/output secondary entry point (DEV-3799) ([#125](https://github.com/enrichlayer/el-linear/issues/125)) ([fb989b0](https://github.com/enrichlayer/el-linear/commit/fb989b00b43e7dd15aaaf6753f67539ac7e5d65b))
* **profiles:** legacy config detection + migrate-legacy command [ALL-922,ALL-923] ([#17](https://github.com/enrichlayer/el-linear/issues/17)) ([4536396](https://github.com/enrichlayer/el-linear/commit/45363962c905f35a0a3f7928561a93518e540c86))
* **profiles:** switch between multiple Linear workspaces ([#15](https://github.com/enrichlayer/el-linear/issues/15)) ([0bd6c37](https://github.com/enrichlayer/el-linear/commit/0bd6c3742e2e74b4a72197818d594d47a9f725a7))
* **projects:** add --team filter to projects list (DEV-4165) ([#104](https://github.com/enrichlayer/el-linear/issues/104)) ([e7c5e0e](https://github.com/enrichlayer/el-linear/commit/e7c5e0e677002fc1d0d08c82eb1312d4dc85d175))
* **projects:** add `projects read` subcommand (DEV-4610) ([#158](https://github.com/enrichlayer/el-linear/issues/158)) ([cd33b33](https://github.com/enrichlayer/el-linear/commit/cd33b3350d0ec4ad3cdf8b16538b50a534fd9067))
* **read,writes:** add --body raw-description output and --quiet one-line write confirmation (DEV-4650) ([#157](https://github.com/enrichlayer/el-linear/issues/157)) ([b6baf62](https://github.com/enrichlayer/el-linear/commit/b6baf628c5abb07624766148e3627784d1fc63d0))
* **read:** add `--with relations` opt-in include (DEV-4476) ([#148](https://github.com/enrichlayer/el-linear/issues/148)) ([86d4268](https://github.com/enrichlayer/el-linear/commit/86d426820980d8860f635583f45bf2fb3a057fa1))
* **read:** batch `issues read <id...>` into a single GraphQL call (DEV-4477) ([#147](https://github.com/enrichlayer/el-linear/issues/147)) ([d0fc818](https://github.com/enrichlayer/el-linear/commit/d0fc81818735a8904ac04a3458716155aef2d6e5))
* **refs wrap:** auto-detect positional file argument (DEV-4077) ([#94](https://github.com/enrichlayer/el-linear/issues/94)) ([1dc2155](https://github.com/enrichlayer/el-linear/commit/1dc2155bfa87efe7d96328f46709e85c4a9dd6ec))
* **refs:** add wrap subcommand with markdown + slack emitters [ALL-917] ([#10](https://github.com/enrichlayer/el-linear/issues/10)) ([16ceea9](https://github.com/enrichlayer/el-linear/commit/16ceea954fbaef14ee2562234a3f9c215f44553c))
* **resolver:** registry resolution for --delegate + batch assignee (DEV-4872) ([#178](https://github.com/enrichlayer/el-linear/issues/178)) ([988430d](https://github.com/enrichlayer/el-linear/commit/988430d98f50ce76ac90fd46dbf27f28c73557f2))
* **resolver:** route --subscriber through the identity registry (DEV-4880) ([#182](https://github.com/enrichlayer/el-linear/issues/182)) ([f33d238](https://github.com/enrichlayer/el-linear/commit/f33d2389e3469289330933d07d08c06646d1fc2c))
* **search:** emit relation_candidates confirmation prompt (DEV-4494) ([#168](https://github.com/enrichlayer/el-linear/issues/168)) ([69e5415](https://github.com/enrichlayer/el-linear/commit/69e54158dae2bd452e8eea7d1a02140d779d28cd))
* **summary:** --format summary honors --fields projection (DEV-4750) ([#166](https://github.com/enrichlayer/el-linear/issues/166)) ([3b46ac9](https://github.com/enrichlayer/el-linear/commit/3b46ac97ffc91ebb50c585279f74305e313d5a9a))
* **validation:** per-team type-label set; DEV uses research not spike (DEV-4084) ([#124](https://github.com/enrichlayer/el-linear/issues/124)) ([dcaf178](https://github.com/enrichlayer/el-linear/commit/dcaf178d4f80c1a4ec71c29146b6fd7cc2a4321e))
* **workspace:** --workspace-url-key flag + EL_LINEAR_WORKSPACE_URL_KEY env (ALL-920) ([#67](https://github.com/enrichlayer/el-linear/issues/67)) ([9ced5d4](https://github.com/enrichlayer/el-linear/commit/9ced5d40a528d7cc19bd6104035cb8c984d258b4))


### Bug Fixes

* append/insert '--' separator on git checkout/branch invocations (DEV-4064) ([#83](https://github.com/enrichlayer/el-linear/issues/83)) ([3b74370](https://github.com/enrichlayer/el-linear/commit/3b74370778548bb384156af2a386393f32f1a99a))
* **auth:** serialize OAuth refresh against concurrent CLIs (ALL-931) ([#32](https://github.com/enrichlayer/el-linear/issues/32)) ([f569221](https://github.com/enrichlayer/el-linear/commit/f569221e7f490d549876800cf91cec2ed388b832))
* bump CLI version string to 1.4.0 (matching package.json + tag) ([#16](https://github.com/enrichlayer/el-linear/issues/16)) ([77e7c16](https://github.com/enrichlayer/el-linear/commit/77e7c169e67f2ff698539f0a6355ab3288843217))
* **comments:** add bodyData fallback to update (parity with create) (DEV-4261) ([#119](https://github.com/enrichlayer/el-linear/issues/119)) ([c54cd8e](https://github.com/enrichlayer/el-linear/commit/c54cd8e98fbac84ea0c84af4d580992703c5eee1))
* **comments:** emit Linear-native prosemirror schema names (DEV-3785) ([#117](https://github.com/enrichlayer/el-linear/issues/117)) ([4d267e6](https://github.com/enrichlayer/el-linear/commit/4d267e68c85af7f5e2acbb72b4baef8c37bcc412))
* **dup-detection:** stopword tool-name boilerplate to cut false positives (DEV-4830) ([#173](https://github.com/enrichlayer/el-linear/issues/173)) ([3b195b6](https://github.com/enrichlayer/el-linear/commit/3b195b6594bea38ccff3ca4bc24ac816c428a411))
* **introspect:** add --check-flag option + explicit return after process.exit ([#79](https://github.com/enrichlayer/el-linear/issues/79)) ([ebba3f8](https://github.com/enrichlayer/el-linear/commit/ebba3f88702bd41e052aeeb84c4dd3d2eebf0124))
* **issues:** batch-resolve null-filter no-op breaks --project & label resolution ([#106](https://github.com/enrichlayer/el-linear/issues/106)) ([d9cbe5c](https://github.com/enrichlayer/el-linear/commit/d9cbe5cb57f6f81c642e3b6abcbc490dbfc00b69))
* **issues:** exclude duplicate-typed states from default list/search (DEV-4879) ([#179](https://github.com/enrichlayer/el-linear/issues/179)) ([5cf6852](https://github.com/enrichlayer/el-linear/commit/5cf68529be5bfb518cc37c1d6717fd3d84a19bb1))
* **issues:** make gate telemetry opt-in for open-source installs (DEV-4839) ([#176](https://github.com/enrichlayer/el-linear/issues/176)) ([760b313](https://github.com/enrichlayer/el-linear/commit/760b313b737118681097e438962da2e3196a1de0))
* **issues:** reject a nonexistent UUID --project with a clear error ([#107](https://github.com/enrichlayer/el-linear/issues/107)) ([dddcdcf](https://github.com/enrichlayer/el-linear/commit/dddcdcf02cf2fa156549bb702993de43ee486f67))
* **issues:** resolve full-name --assignee in list/search (DEV-4312) ([#129](https://github.com/enrichlayer/el-linear/issues/129)) ([a95cd6a](https://github.com/enrichlayer/el-linear/commit/a95cd6a237a3c2b4f6153e6473b4cc907ebc4536))
* **network:** prefer IPv4 for API calls to survive broken-IPv6 networks (DEV-4415) ([#136](https://github.com/enrichlayer/el-linear/issues/136)) ([1ff9290](https://github.com/enrichlayer/el-linear/commit/1ff92908ea5d9a742cdfaf80272ee5e615ae0743))
* **profile:** atomic writes for migrate-legacy (ALL-932) ([#30](https://github.com/enrichlayer/el-linear/issues/30)) ([01131d1](https://github.com/enrichlayer/el-linear/commit/01131d10fc98822a1c6fb7a9fb783be6d0199ccb))
* **projects:** scope --project name resolver by --team (DEV-4103) ([#123](https://github.com/enrichlayer/el-linear/issues/123)) ([3c72a23](https://github.com/enrichlayer/el-linear/commit/3c72a230b6a8dfaae2e3d0979a772a6c627ce263))
* **projects:** surface active projects, support --all, warn on truncation (DEV-4175) ([#113](https://github.com/enrichlayer/el-linear/issues/113)) ([c03ffd3](https://github.com/enrichlayer/el-linear/commit/c03ffd3da2f3fca92ea6a5fb614b17b636869ecd))
* **refs:** share protected-range scanner between wrap + extract (ALL-933) ([#33](https://github.com/enrichlayer/el-linear/issues/33)) ([9405eca](https://github.com/enrichlayer/el-linear/commit/9405eca427d2d7bd5c15d92cf20e49f187572832))
* sanitize OAuth refresh error body at source (DEV-4065) ([#87](https://github.com/enrichlayer/el-linear/issues/87)) ([1e11ac0](https://github.com/enrichlayer/el-linear/commit/1e11ac0417175cc3656cd3d244bd66aa607efe34))
* **security:** close 4 adversarial findings + read --version from package.json ([#75](https://github.com/enrichlayer/el-linear/issues/75)) ([2c429f1](https://github.com/enrichlayer/el-linear/commit/2c429f16fa6ebe449346e2a963fbd3b78fb6c384))
* **security:** OAuth callback + headless paste + data-file allowlist + rate limit (ALL-935 batch 2) ([#37](https://github.com/enrichlayer/el-linear/issues/37)) ([403a38a](https://github.com/enrichlayer/el-linear/commit/403a38abec6d3e792939b72cd0f041430c29c92f))
* **security:** redaction + scheme allowlist + unicode mentions (ALL-935) ([#35](https://github.com/enrichlayer/el-linear/issues/35)) ([5c344e9](https://github.com/enrichlayer/el-linear/commit/5c344e9e3ab8805cbdbf0d9aba8ad1741887aeff))
* **security:** snapshot oauthStatePath + profile-keyed loadConfig cache (ALL-935 deferred) ([#46](https://github.com/enrichlayer/el-linear/issues/46)) ([e614bff](https://github.com/enrichlayer/el-linear/commit/e614bffc852402813c75e51ecaf0b411f57431da))
* serialize init wizard config writes with file lock (DEV-4066) ([#88](https://github.com/enrichlayer/el-linear/issues/88)) ([b32ebe1](https://github.com/enrichlayer/el-linear/commit/b32ebe1f7b10d81365fb62ae32512b27fe285cc8))
* **summary:** capture kind before --fields/--raw strip signature fields (ALL-933) ([#66](https://github.com/enrichlayer/el-linear/issues/66)) ([d7a404f](https://github.com/enrichlayer/el-linear/commit/d7a404f84b4606f3e4da7d28a7c4c5a7341ac71d))
* **summary:** sanitize terminal output + harden numeric edges (ALL-934) ([#31](https://github.com/enrichlayer/el-linear/issues/31)) ([3d1535a](https://github.com/enrichlayer/el-linear/commit/3d1535a5af7fd95ef7666e0c1ff97131a767ed8f))
* validate EL_LINEAR_WORKSPACE_URL_KEY env + config urlKey shape (DEV-4067) ([#85](https://github.com/enrichlayer/el-linear/issues/85)) ([52307c7](https://github.com/enrichlayer/el-linear/commit/52307c74c7795ca7de5ca992a0bed011e3307a09))

## [1.32.3](https://github.com/enrichlayer/el-linear/compare/v1.32.2...v1.32.3) (2026-07-01)


### Features

* **comments:** add comment read and full-body list output (DEV-5212)

## [1.32.2](https://github.com/enrichlayer/el-linear/compare/v1.32.1...v1.32.2) (2026-07-01)


### Bug Fixes

* **skills:** add machine-checkable assertions to linear-operations evals (DEV-5202)

## [1.32.1](https://github.com/enrichlayer/el-linear/compare/v1.32.0...v1.32.1) (2026-07-01)


### Bug Fixes

* **comments:** ignore hyphenated scoped package coordinates during mention parsing (DEV-5202) ([#198](https://github.com/enrichlayer/el-linear/issues/198)) ([8357325](https://github.com/enrichlayer/el-linear/commit/83573259d3557f804c1b0e707bbb2e3375322444))

## [1.32.0](https://github.com/enrichlayer/el-linear/compare/v1.31.0...v1.32.0) (2026-06-30)


### Features

* **branch:** add branch validate subcommand (team-validity gate) ([#194](https://github.com/enrichlayer/el-linear/issues/194)) ([477c732](https://github.com/enrichlayer/el-linear/commit/477c7322c19c474b21e07722609fcc9dae5d18f9))

## [1.31.0](https://github.com/enrichlayer/el-linear/compare/v1.30.0...v1.31.0) (2026-06-29)


### Features

* **issues:** add --quiet and summary output to issues relate (DEV-5081) ([#191](https://github.com/enrichlayer/el-linear/issues/191)) ([8aaa102](https://github.com/enrichlayer/el-linear/commit/8aaa102d00ccad93ef097b8162210c74c1b0a8e0))

## [1.30.0](https://github.com/enrichlayer/el-linear/compare/v1.29.1...v1.30.0) (2026-06-25)


### Features

* **comments:** report mention resolution + warn on unresolved [@names](https://github.com/names) (DEV-4987) ([#186](https://github.com/enrichlayer/el-linear/issues/186)) ([64a3988](https://github.com/enrichlayer/el-linear/commit/64a398820f92e567f51340f4609f9d41c147a788))

## [1.29.1](https://github.com/enrichlayer/el-linear/compare/v1.29.0...v1.29.1) (2026-06-21)


### Bug Fixes

* **issues:** exclude duplicate-typed states from default list/search (DEV-4879) ([#179](https://github.com/enrichlayer/el-linear/issues/179)) ([5cf6852](https://github.com/enrichlayer/el-linear/commit/5cf68529be5bfb518cc37c1d6717fd3d84a19bb1))

## [1.29.0](https://github.com/enrichlayer/el-linear/compare/v1.28.0...v1.29.0) (2026-06-21)


### Features

* **resolver:** registry resolution for --delegate + batch assignee (DEV-4872) ([#178](https://github.com/enrichlayer/el-linear/issues/178)) ([988430d](https://github.com/enrichlayer/el-linear/commit/988430d98f50ce76ac90fd46dbf27f28c73557f2))

## [1.28.0](https://github.com/enrichlayer/el-linear/compare/v1.27.0...v1.28.0) (2026-06-20)


### Features

* **issues:** emit dup-gate blocked/overridden telemetry events (DEV-4834) ([#174](https://github.com/enrichlayer/el-linear/issues/174)) ([18afcd3](https://github.com/enrichlayer/el-linear/commit/18afcd3d03eb9a0999125b555ff588b4516df32a))


### Bug Fixes

* **dup-detection:** stopword tool-name boilerplate to cut false positives (DEV-4830) ([#173](https://github.com/enrichlayer/el-linear/issues/173)) ([3b195b6](https://github.com/enrichlayer/el-linear/commit/3b195b6594bea38ccff3ca4bc24ac816c428a411))
* **issues:** make gate telemetry opt-in for open-source installs (DEV-4839) ([#176](https://github.com/enrichlayer/el-linear/issues/176)) ([760b313](https://github.com/enrichlayer/el-linear/commit/760b313b737118681097e438962da2e3196a1de0))

## [1.27.0](https://github.com/enrichlayer/el-linear/compare/v1.26.0...v1.27.0) (2026-06-19)


### Features

* **issues:** add duplicate-detection gate to issues create (DEV-4823) ([#171](https://github.com/enrichlayer/el-linear/issues/171)) ([bb830f5](https://github.com/enrichlayer/el-linear/commit/bb830f5d71fef7496838741426030229bcc7bf0f))

## [1.26.0](https://github.com/enrichlayer/el-linear/compare/v1.25.0...v1.26.0) (2026-06-18)


### Features

* **search:** emit relation_candidates confirmation prompt (DEV-4494) ([#168](https://github.com/enrichlayer/el-linear/issues/168)) ([69e5415](https://github.com/enrichlayer/el-linear/commit/69e54158dae2bd452e8eea7d1a02140d779d28cd))

## [1.25.0](https://github.com/enrichlayer/el-linear/compare/v1.24.0...v1.25.0) (2026-06-18)


### Features

* **issue-id:** accept bug/ and spike/ branch prefixes (DEV-4777) ([#167](https://github.com/enrichlayer/el-linear/issues/167)) ([00c500f](https://github.com/enrichlayer/el-linear/commit/00c500f721b0b6f28b59f8b828187ad7769caed5))
* **issue-id:** accept codex/ branch prefix (DEV-4660) ([#160](https://github.com/enrichlayer/el-linear/issues/160)) ([800418c](https://github.com/enrichlayer/el-linear/commit/800418ca51737274a211627abd6bce22a043e501))
* **summary:** --format summary honors --fields projection (DEV-4750) ([#166](https://github.com/enrichlayer/el-linear/issues/166)) ([3b46ac9](https://github.com/enrichlayer/el-linear/commit/3b46ac97ffc91ebb50c585279f74305e313d5a9a))

## [1.24.0](https://github.com/enrichlayer/el-linear/compare/v1.23.0...v1.24.0) (2026-06-17)


### Features

* **output:** add WindowedMeta type to the shared output envelope (DEV-4668) ([#163](https://github.com/enrichlayer/el-linear/issues/163)) ([ed9e448](https://github.com/enrichlayer/el-linear/commit/ed9e4484fc256b1db1b918d93d696b65ff528095))

## [1.23.0](https://github.com/enrichlayer/el-linear/compare/v1.22.0...v1.23.0) (2026-06-14)


### Features

* **projects:** add `projects read` subcommand (DEV-4610) ([#158](https://github.com/enrichlayer/el-linear/issues/158)) ([cd33b33](https://github.com/enrichlayer/el-linear/commit/cd33b3350d0ec4ad3cdf8b16538b50a534fd9067))

## [1.22.0](https://github.com/enrichlayer/el-linear/compare/v1.21.0...v1.22.0) (2026-06-11)


### Features

* **issues:** auto-claim on branch creation (DEV-4500) ([#155](https://github.com/enrichlayer/el-linear/issues/155)) ([530ffa1](https://github.com/enrichlayer/el-linear/commit/530ffa1762d36544f713ead0a3c05ab67e64ad51))

## [1.21.0](https://github.com/enrichlayer/el-linear/compare/v1.20.0...v1.21.0) (2026-06-08)


### Features

* **read:** add `--with relations` opt-in include (DEV-4476) ([#148](https://github.com/enrichlayer/el-linear/issues/148)) ([86d4268](https://github.com/enrichlayer/el-linear/commit/86d426820980d8860f635583f45bf2fb3a057fa1))

## [1.20.0](https://github.com/enrichlayer/el-linear/compare/v1.19.0...v1.20.0) (2026-06-06)


### Features

* **comments:** enforce --body/--body-file mutual exclusivity + document body-file (DEV-4450) ([#143](https://github.com/enrichlayer/el-linear/issues/143)) ([262e017](https://github.com/enrichlayer/el-linear/commit/262e017e24a60099a1ea863cd95d9d95ed2c823a))
* **issues read:** add --sections for multi-section extraction (DEV-4479) ([#145](https://github.com/enrichlayer/el-linear/issues/145)) ([eeb9a0f](https://github.com/enrichlayer/el-linear/commit/eeb9a0f2e2f405eeeceba37afdd6d05f1d70ed25))
* **issues:** add `issues tree <ID>` for depth-N parent→children walks (DEV-4480) ([#149](https://github.com/enrichlayer/el-linear/issues/149)) ([19ebdbb](https://github.com/enrichlayer/el-linear/commit/19ebdbbc2be74553b324b2d722d4e89a5da4ba34))
* **issues:** default --include-closed off on list/search (DEV-4478) ([#146](https://github.com/enrichlayer/el-linear/issues/146)) ([5edf798](https://github.com/enrichlayer/el-linear/commit/5edf798de1aa6ef8684e7fb4498a36aff6886ed3))
* **read:** batch `issues read <id...>` into a single GraphQL call (DEV-4477) ([#147](https://github.com/enrichlayer/el-linear/issues/147)) ([d0fc818](https://github.com/enrichlayer/el-linear/commit/d0fc81818735a8904ac04a3458716155aef2d6e5))

## [1.19.0](https://github.com/enrichlayer/el-linear/compare/v1.18.1...v1.19.0) (2026-06-03)


### Features

* **config:** add 'config migrate-from-personal' to slim against team (DEV-4458) ([#141](https://github.com/enrichlayer/el-linear/issues/141)) ([c93a096](https://github.com/enrichlayer/el-linear/commit/c93a0966180a9b9ec38b9316ca8008f7f91de013))

## [1.18.1](https://github.com/enrichlayer/el-linear/compare/v1.18.0...v1.18.1) (2026-05-29)


### Bug Fixes

* **network:** prefer IPv4 for API calls to survive broken-IPv6 networks (DEV-4415) ([#136](https://github.com/enrichlayer/el-linear/issues/136)) ([1ff9290](https://github.com/enrichlayer/el-linear/commit/1ff92908ea5d9a742cdfaf80272ee5e615ae0743))

## [1.18.0](https://github.com/enrichlayer/el-linear/compare/v1.17.0...v1.18.0) (2026-05-24)


### Features

* **comments:** add 'comments delete' + lock multi-element update parity (DEV-4306) ([#127](https://github.com/enrichlayer/el-linear/issues/127)) ([4dafdef](https://github.com/enrichlayer/el-linear/commit/4dafdefe9d0f6f42966e7ebacf5d36927f763e72))
* **issues:** record branch.&lt;branch&gt;.linearIssue marker on branch creation (DEV-4293) ([#128](https://github.com/enrichlayer/el-linear/issues/128)) ([be59c1d](https://github.com/enrichlayer/el-linear/commit/be59c1da04e7bce600f837290cd22b2101e639fe))


### Bug Fixes

* **issues:** resolve full-name --assignee in list/search (DEV-4312) ([#129](https://github.com/enrichlayer/el-linear/issues/129)) ([a95cd6a](https://github.com/enrichlayer/el-linear/commit/a95cd6a237a3c2b4f6153e6473b4cc907ebc4536))

## [1.17.0](https://github.com/enrichlayer/el-linear/compare/v1.16.0...v1.17.0) (2026-05-21)


### Features

* **validation:** per-team type-label set; DEV uses research not spike (DEV-4084) ([#124](https://github.com/enrichlayer/el-linear/issues/124)) ([dcaf178](https://github.com/enrichlayer/el-linear/commit/dcaf178d4f80c1a4ec71c29146b6fd7cc2a4321e))


### Bug Fixes

* **projects:** scope --project name resolver by --team (DEV-4103) ([#123](https://github.com/enrichlayer/el-linear/issues/123)) ([3c72a23](https://github.com/enrichlayer/el-linear/commit/3c72a230b6a8dfaae2e3d0979a772a6c627ce263))

## [1.16.0](https://github.com/enrichlayer/el-linear/compare/v1.15.0...v1.16.0) (2026-05-21)


### Features

* **output:** expose @enrichlayer/el-linear/output secondary entry point (DEV-3799) ([#125](https://github.com/enrichlayer/el-linear/issues/125)) ([fb989b0](https://github.com/enrichlayer/el-linear/commit/fb989b00b43e7dd15aaaf6753f67539ac7e5d65b))


### Bug Fixes

* **comments:** add bodyData fallback to update (parity with create) (DEV-4261) ([#119](https://github.com/enrichlayer/el-linear/issues/119)) ([c54cd8e](https://github.com/enrichlayer/el-linear/commit/c54cd8e98fbac84ea0c84af4d580992703c5eee1))

## [1.15.0](https://github.com/enrichlayer/el-linear/compare/v1.14.0...v1.15.0) (2026-05-20)


### Features

* accept --parent as alias for --parent-ticket ([#97](https://github.com/enrichlayer/el-linear/issues/97)) ([d26233c](https://github.com/enrichlayer/el-linear/commit/d26233c8fada859c1f80526d10cb547642aaf577))
* **auth:** add OAuth 2.0 (PKCE) authentication ([#18](https://github.com/enrichlayer/el-linear/issues/18)) ([4e3b59f](https://github.com/enrichlayer/el-linear/commit/4e3b59f501e975b7b291d6926dba16a7d5a4bd0d))
* **auth:** migrate command call sites to OAuth-aware getActiveAuth ([#19](https://github.com/enrichlayer/el-linear/issues/19)) ([76c7e8d](https://github.com/enrichlayer/el-linear/commit/76c7e8d70527644c4661f7805a02b7792a2922e1))
* **auth:** wire OAuth into FileService (last unmigrated auth path) ([#20](https://github.com/enrichlayer/el-linear/issues/20)) ([57a3d59](https://github.com/enrichlayer/el-linear/commit/57a3d59f2fa623de95a066eaad1f9cb1301d6eba))
* **cli:** add cli-introspect + validate-flag for SKILL.md flag-name linting ([#76](https://github.com/enrichlayer/el-linear/issues/76)) ([5e97d5d](https://github.com/enrichlayer/el-linear/commit/5e97d5d4b1427762812ea461781ead8972f7524f))
* **comments:** rename --file to --body-file on create and update ([#110](https://github.com/enrichlayer/el-linear/issues/110)) ([61caf88](https://github.com/enrichlayer/el-linear/commit/61caf88550c55d114cb7cb85f16e124e50bcaa2d))
* **config:** add `config team` subcommand for wiring shared team config (DEV-4104) ([#114](https://github.com/enrichlayer/el-linear/issues/114)) ([371e7b7](https://github.com/enrichlayer/el-linear/commit/371e7b7be9af68a6decd81e5eb74586b451fddb8))
* **config:** add team/local config split with local.json (DEV-4172) ([#108](https://github.com/enrichlayer/el-linear/issues/108)) ([95bebab](https://github.com/enrichlayer/el-linear/commit/95bebabd17ff6aae0c557b74ea7d5669fccf173b))
* **config:** auto-discover team config from ~/.config/el-tools-root marker (DEV-4258) ([#116](https://github.com/enrichlayer/el-linear/issues/116)) ([414aba9](https://github.com/enrichlayer/el-linear/commit/414aba998ae67eb597f06fa3a42530e05b313e1d))
* **config:** support shared team config file layer ([ea3f282](https://github.com/enrichlayer/el-linear/commit/ea3f28215b2850288254359d654348f907c422c3))
* defaults (assignee, priority), disk cache, wizard prompts, team OAuth config ([#22](https://github.com/enrichlayer/el-linear/issues/22)) ([0525c2f](https://github.com/enrichlayer/el-linear/commit/0525c2f8a96c584f09ef900b6b307201888addea))
* **discovery:** URL/slug project resolution + truncation warning + CLI-first rule ([#100](https://github.com/enrichlayer/el-linear/issues/100)) ([29ea130](https://github.com/enrichlayer/el-linear/commit/29ea1304357e3f123f2ddec54913edc764f30412))
* enrich issues create validation errors with team-scoped suggestions ([#98](https://github.com/enrichlayer/el-linear/issues/98)) ([763a495](https://github.com/enrichlayer/el-linear/commit/763a495afbaecbdc1ab9b1ead9d5656b3d800712))
* **enrich:** route project resolver failures through team-scoped enrichment (DEV-4135) ([#101](https://github.com/enrichlayer/el-linear/issues/101)) ([db6c81d](https://github.com/enrichlayer/el-linear/commit/db6c81d2c9069c50dbb8d15d8afe15fd6ec8af35))
* **filters:** add --name to users/labels/projects list, --state/--exclude-state/--active to projects list ([#36](https://github.com/enrichlayer/el-linear/issues/36)) ([a52f005](https://github.com/enrichlayer/el-linear/commit/a52f005ea049038ea16fecd600d57dda9dd9b162))
* **format:** add --format summary for human-readable output ([#28](https://github.com/enrichlayer/el-linear/issues/28)) ([2bdf3d2](https://github.com/enrichlayer/el-linear/commit/2bdf3d24107b5d996738b54fbac07930c8fff5ae))
* **init:** interactive setup wizard (linctl init) ([#7](https://github.com/enrichlayer/el-linear/issues/7)) ([23c62f8](https://github.com/enrichlayer/el-linear/commit/23c62f8b7e7a72b57ea5c99e3d6711dfba3cc469))
* **issues:** accept relation flags on issues update (DEV-4201) ([#111](https://github.com/enrichlayer/el-linear/issues/111)) ([afa05c5](https://github.com/enrichlayer/el-linear/commit/afa05c501034913ed6c6235f60f8d229eb7dca1b))
* **issues:** add --field flag to issues read for markdown section extraction (ALL-940) ([#71](https://github.com/enrichlayer/el-linear/issues/71)) ([404002f](https://github.com/enrichlayer/el-linear/commit/404002fbf992fc789cb79ba2d02e30d3ad8ec44c))
* **profiles:** legacy config detection + migrate-legacy command [ALL-922,ALL-923] ([#17](https://github.com/enrichlayer/el-linear/issues/17)) ([4536396](https://github.com/enrichlayer/el-linear/commit/45363962c905f35a0a3f7928561a93518e540c86))
* **profiles:** switch between multiple Linear workspaces ([#15](https://github.com/enrichlayer/el-linear/issues/15)) ([0bd6c37](https://github.com/enrichlayer/el-linear/commit/0bd6c3742e2e74b4a72197818d594d47a9f725a7))
* **projects:** add --team filter to projects list (DEV-4165) ([#104](https://github.com/enrichlayer/el-linear/issues/104)) ([e7c5e0e](https://github.com/enrichlayer/el-linear/commit/e7c5e0e677002fc1d0d08c82eb1312d4dc85d175))
* **refs wrap:** auto-detect positional file argument (DEV-4077) ([#94](https://github.com/enrichlayer/el-linear/issues/94)) ([1dc2155](https://github.com/enrichlayer/el-linear/commit/1dc2155bfa87efe7d96328f46709e85c4a9dd6ec))
* **refs:** add wrap subcommand with markdown + slack emitters [ALL-917] ([#10](https://github.com/enrichlayer/el-linear/issues/10)) ([16ceea9](https://github.com/enrichlayer/el-linear/commit/16ceea954fbaef14ee2562234a3f9c215f44553c))
* **workspace:** --workspace-url-key flag + EL_LINEAR_WORKSPACE_URL_KEY env (ALL-920) ([#67](https://github.com/enrichlayer/el-linear/issues/67)) ([9ced5d4](https://github.com/enrichlayer/el-linear/commit/9ced5d40a528d7cc19bd6104035cb8c984d258b4))


### Bug Fixes

* append/insert '--' separator on git checkout/branch invocations (DEV-4064) ([#83](https://github.com/enrichlayer/el-linear/issues/83)) ([3b74370](https://github.com/enrichlayer/el-linear/commit/3b74370778548bb384156af2a386393f32f1a99a))
* **auth:** serialize OAuth refresh against concurrent CLIs (ALL-931) ([#32](https://github.com/enrichlayer/el-linear/issues/32)) ([f569221](https://github.com/enrichlayer/el-linear/commit/f569221e7f490d549876800cf91cec2ed388b832))
* bump CLI version string to 1.4.0 (matching package.json + tag) ([#16](https://github.com/enrichlayer/el-linear/issues/16)) ([77e7c16](https://github.com/enrichlayer/el-linear/commit/77e7c169e67f2ff698539f0a6355ab3288843217))
* **comments:** emit Linear-native prosemirror schema names (DEV-3785) ([#117](https://github.com/enrichlayer/el-linear/issues/117)) ([4d267e6](https://github.com/enrichlayer/el-linear/commit/4d267e68c85af7f5e2acbb72b4baef8c37bcc412))
* **introspect:** add --check-flag option + explicit return after process.exit ([#79](https://github.com/enrichlayer/el-linear/issues/79)) ([ebba3f8](https://github.com/enrichlayer/el-linear/commit/ebba3f88702bd41e052aeeb84c4dd3d2eebf0124))
* **issues:** batch-resolve null-filter no-op breaks --project & label resolution ([#106](https://github.com/enrichlayer/el-linear/issues/106)) ([d9cbe5c](https://github.com/enrichlayer/el-linear/commit/d9cbe5cb57f6f81c642e3b6abcbc490dbfc00b69))
* **issues:** reject a nonexistent UUID --project with a clear error ([#107](https://github.com/enrichlayer/el-linear/issues/107)) ([dddcdcf](https://github.com/enrichlayer/el-linear/commit/dddcdcf02cf2fa156549bb702993de43ee486f67))
* **profile:** atomic writes for migrate-legacy (ALL-932) ([#30](https://github.com/enrichlayer/el-linear/issues/30)) ([01131d1](https://github.com/enrichlayer/el-linear/commit/01131d10fc98822a1c6fb7a9fb783be6d0199ccb))
* **projects:** surface active projects, support --all, warn on truncation (DEV-4175) ([#113](https://github.com/enrichlayer/el-linear/issues/113)) ([c03ffd3](https://github.com/enrichlayer/el-linear/commit/c03ffd3da2f3fca92ea6a5fb614b17b636869ecd))
* **refs:** share protected-range scanner between wrap + extract (ALL-933) ([#33](https://github.com/enrichlayer/el-linear/issues/33)) ([9405eca](https://github.com/enrichlayer/el-linear/commit/9405eca427d2d7bd5c15d92cf20e49f187572832))
* sanitize OAuth refresh error body at source (DEV-4065) ([#87](https://github.com/enrichlayer/el-linear/issues/87)) ([1e11ac0](https://github.com/enrichlayer/el-linear/commit/1e11ac0417175cc3656cd3d244bd66aa607efe34))
* **security:** close 4 adversarial findings + read --version from package.json ([#75](https://github.com/enrichlayer/el-linear/issues/75)) ([2c429f1](https://github.com/enrichlayer/el-linear/commit/2c429f16fa6ebe449346e2a963fbd3b78fb6c384))
* **security:** OAuth callback + headless paste + data-file allowlist + rate limit (ALL-935 batch 2) ([#37](https://github.com/enrichlayer/el-linear/issues/37)) ([403a38a](https://github.com/enrichlayer/el-linear/commit/403a38abec6d3e792939b72cd0f041430c29c92f))
* **security:** redaction + scheme allowlist + unicode mentions (ALL-935) ([#35](https://github.com/enrichlayer/el-linear/issues/35)) ([5c344e9](https://github.com/enrichlayer/el-linear/commit/5c344e9e3ab8805cbdbf0d9aba8ad1741887aeff))
* **security:** snapshot oauthStatePath + profile-keyed loadConfig cache (ALL-935 deferred) ([#46](https://github.com/enrichlayer/el-linear/issues/46)) ([e614bff](https://github.com/enrichlayer/el-linear/commit/e614bffc852402813c75e51ecaf0b411f57431da))
* serialize init wizard config writes with file lock (DEV-4066) ([#88](https://github.com/enrichlayer/el-linear/issues/88)) ([b32ebe1](https://github.com/enrichlayer/el-linear/commit/b32ebe1f7b10d81365fb62ae32512b27fe285cc8))
* **summary:** capture kind before --fields/--raw strip signature fields (ALL-933) ([#66](https://github.com/enrichlayer/el-linear/issues/66)) ([d7a404f](https://github.com/enrichlayer/el-linear/commit/d7a404f84b4606f3e4da7d28a7c4c5a7341ac71d))
* **summary:** sanitize terminal output + harden numeric edges (ALL-934) ([#31](https://github.com/enrichlayer/el-linear/issues/31)) ([3d1535a](https://github.com/enrichlayer/el-linear/commit/3d1535a5af7fd95ef7666e0c1ff97131a767ed8f))
* validate EL_LINEAR_WORKSPACE_URL_KEY env + config urlKey shape (DEV-4067) ([#85](https://github.com/enrichlayer/el-linear/issues/85)) ([52307c7](https://github.com/enrichlayer/el-linear/commit/52307c74c7795ca7de5ca992a0bed011e3307a09))

## [1.14.0](https://github.com/enrichlayer/el-linear/compare/v1.13.0...v1.14.0) (2026-05-20)


### Features

* accept --parent as alias for --parent-ticket ([#97](https://github.com/enrichlayer/el-linear/issues/97)) ([d26233c](https://github.com/enrichlayer/el-linear/commit/d26233c8fada859c1f80526d10cb547642aaf577))
* **auth:** add OAuth 2.0 (PKCE) authentication ([#18](https://github.com/enrichlayer/el-linear/issues/18)) ([4e3b59f](https://github.com/enrichlayer/el-linear/commit/4e3b59f501e975b7b291d6926dba16a7d5a4bd0d))
* **auth:** migrate command call sites to OAuth-aware getActiveAuth ([#19](https://github.com/enrichlayer/el-linear/issues/19)) ([76c7e8d](https://github.com/enrichlayer/el-linear/commit/76c7e8d70527644c4661f7805a02b7792a2922e1))
* **auth:** wire OAuth into FileService (last unmigrated auth path) ([#20](https://github.com/enrichlayer/el-linear/issues/20)) ([57a3d59](https://github.com/enrichlayer/el-linear/commit/57a3d59f2fa623de95a066eaad1f9cb1301d6eba))
* **cli:** add cli-introspect + validate-flag for SKILL.md flag-name linting ([#76](https://github.com/enrichlayer/el-linear/issues/76)) ([5e97d5d](https://github.com/enrichlayer/el-linear/commit/5e97d5d4b1427762812ea461781ead8972f7524f))
* **comments:** rename --file to --body-file on create and update ([#110](https://github.com/enrichlayer/el-linear/issues/110)) ([61caf88](https://github.com/enrichlayer/el-linear/commit/61caf88550c55d114cb7cb85f16e124e50bcaa2d))
* **config:** add `config team` subcommand for wiring shared team config (DEV-4104) ([#114](https://github.com/enrichlayer/el-linear/issues/114)) ([371e7b7](https://github.com/enrichlayer/el-linear/commit/371e7b7be9af68a6decd81e5eb74586b451fddb8))
* **config:** add team/local config split with local.json (DEV-4172) ([#108](https://github.com/enrichlayer/el-linear/issues/108)) ([95bebab](https://github.com/enrichlayer/el-linear/commit/95bebabd17ff6aae0c557b74ea7d5669fccf173b))
* **config:** support shared team config file layer ([ea3f282](https://github.com/enrichlayer/el-linear/commit/ea3f28215b2850288254359d654348f907c422c3))
* defaults (assignee, priority), disk cache, wizard prompts, team OAuth config ([#22](https://github.com/enrichlayer/el-linear/issues/22)) ([0525c2f](https://github.com/enrichlayer/el-linear/commit/0525c2f8a96c584f09ef900b6b307201888addea))
* **discovery:** URL/slug project resolution + truncation warning + CLI-first rule ([#100](https://github.com/enrichlayer/el-linear/issues/100)) ([29ea130](https://github.com/enrichlayer/el-linear/commit/29ea1304357e3f123f2ddec54913edc764f30412))
* enrich issues create validation errors with team-scoped suggestions ([#98](https://github.com/enrichlayer/el-linear/issues/98)) ([763a495](https://github.com/enrichlayer/el-linear/commit/763a495afbaecbdc1ab9b1ead9d5656b3d800712))
* **enrich:** route project resolver failures through team-scoped enrichment (DEV-4135) ([#101](https://github.com/enrichlayer/el-linear/issues/101)) ([db6c81d](https://github.com/enrichlayer/el-linear/commit/db6c81d2c9069c50dbb8d15d8afe15fd6ec8af35))
* **filters:** add --name to users/labels/projects list, --state/--exclude-state/--active to projects list ([#36](https://github.com/enrichlayer/el-linear/issues/36)) ([a52f005](https://github.com/enrichlayer/el-linear/commit/a52f005ea049038ea16fecd600d57dda9dd9b162))
* **format:** add --format summary for human-readable output ([#28](https://github.com/enrichlayer/el-linear/issues/28)) ([2bdf3d2](https://github.com/enrichlayer/el-linear/commit/2bdf3d24107b5d996738b54fbac07930c8fff5ae))
* **init:** interactive setup wizard (linctl init) ([#7](https://github.com/enrichlayer/el-linear/issues/7)) ([23c62f8](https://github.com/enrichlayer/el-linear/commit/23c62f8b7e7a72b57ea5c99e3d6711dfba3cc469))
* **issues:** accept relation flags on issues update (DEV-4201) ([#111](https://github.com/enrichlayer/el-linear/issues/111)) ([afa05c5](https://github.com/enrichlayer/el-linear/commit/afa05c501034913ed6c6235f60f8d229eb7dca1b))
* **issues:** add --field flag to issues read for markdown section extraction (ALL-940) ([#71](https://github.com/enrichlayer/el-linear/issues/71)) ([404002f](https://github.com/enrichlayer/el-linear/commit/404002fbf992fc789cb79ba2d02e30d3ad8ec44c))
* **profiles:** legacy config detection + migrate-legacy command [ALL-922,ALL-923] ([#17](https://github.com/enrichlayer/el-linear/issues/17)) ([4536396](https://github.com/enrichlayer/el-linear/commit/45363962c905f35a0a3f7928561a93518e540c86))
* **profiles:** switch between multiple Linear workspaces ([#15](https://github.com/enrichlayer/el-linear/issues/15)) ([0bd6c37](https://github.com/enrichlayer/el-linear/commit/0bd6c3742e2e74b4a72197818d594d47a9f725a7))
* **projects:** add --team filter to projects list (DEV-4165) ([#104](https://github.com/enrichlayer/el-linear/issues/104)) ([e7c5e0e](https://github.com/enrichlayer/el-linear/commit/e7c5e0e677002fc1d0d08c82eb1312d4dc85d175))
* **refs wrap:** auto-detect positional file argument (DEV-4077) ([#94](https://github.com/enrichlayer/el-linear/issues/94)) ([1dc2155](https://github.com/enrichlayer/el-linear/commit/1dc2155bfa87efe7d96328f46709e85c4a9dd6ec))
* **refs:** add wrap subcommand with markdown + slack emitters [ALL-917] ([#10](https://github.com/enrichlayer/el-linear/issues/10)) ([16ceea9](https://github.com/enrichlayer/el-linear/commit/16ceea954fbaef14ee2562234a3f9c215f44553c))
* **workspace:** --workspace-url-key flag + EL_LINEAR_WORKSPACE_URL_KEY env (ALL-920) ([#67](https://github.com/enrichlayer/el-linear/issues/67)) ([9ced5d4](https://github.com/enrichlayer/el-linear/commit/9ced5d40a528d7cc19bd6104035cb8c984d258b4))


### Bug Fixes

* append/insert '--' separator on git checkout/branch invocations (DEV-4064) ([#83](https://github.com/enrichlayer/el-linear/issues/83)) ([3b74370](https://github.com/enrichlayer/el-linear/commit/3b74370778548bb384156af2a386393f32f1a99a))
* **auth:** serialize OAuth refresh against concurrent CLIs (ALL-931) ([#32](https://github.com/enrichlayer/el-linear/issues/32)) ([f569221](https://github.com/enrichlayer/el-linear/commit/f569221e7f490d549876800cf91cec2ed388b832))
* bump CLI version string to 1.4.0 (matching package.json + tag) ([#16](https://github.com/enrichlayer/el-linear/issues/16)) ([77e7c16](https://github.com/enrichlayer/el-linear/commit/77e7c169e67f2ff698539f0a6355ab3288843217))
* **comments:** emit Linear-native prosemirror schema names (DEV-3785) ([#117](https://github.com/enrichlayer/el-linear/issues/117)) ([4d267e6](https://github.com/enrichlayer/el-linear/commit/4d267e68c85af7f5e2acbb72b4baef8c37bcc412))
* **introspect:** add --check-flag option + explicit return after process.exit ([#79](https://github.com/enrichlayer/el-linear/issues/79)) ([ebba3f8](https://github.com/enrichlayer/el-linear/commit/ebba3f88702bd41e052aeeb84c4dd3d2eebf0124))
* **issues:** batch-resolve null-filter no-op breaks --project & label resolution ([#106](https://github.com/enrichlayer/el-linear/issues/106)) ([d9cbe5c](https://github.com/enrichlayer/el-linear/commit/d9cbe5cb57f6f81c642e3b6abcbc490dbfc00b69))
* **issues:** reject a nonexistent UUID --project with a clear error ([#107](https://github.com/enrichlayer/el-linear/issues/107)) ([dddcdcf](https://github.com/enrichlayer/el-linear/commit/dddcdcf02cf2fa156549bb702993de43ee486f67))
* **profile:** atomic writes for migrate-legacy (ALL-932) ([#30](https://github.com/enrichlayer/el-linear/issues/30)) ([01131d1](https://github.com/enrichlayer/el-linear/commit/01131d10fc98822a1c6fb7a9fb783be6d0199ccb))
* **projects:** surface active projects, support --all, warn on truncation (DEV-4175) ([#113](https://github.com/enrichlayer/el-linear/issues/113)) ([c03ffd3](https://github.com/enrichlayer/el-linear/commit/c03ffd3da2f3fca92ea6a5fb614b17b636869ecd))
* **refs:** share protected-range scanner between wrap + extract (ALL-933) ([#33](https://github.com/enrichlayer/el-linear/issues/33)) ([9405eca](https://github.com/enrichlayer/el-linear/commit/9405eca427d2d7bd5c15d92cf20e49f187572832))
* sanitize OAuth refresh error body at source (DEV-4065) ([#87](https://github.com/enrichlayer/el-linear/issues/87)) ([1e11ac0](https://github.com/enrichlayer/el-linear/commit/1e11ac0417175cc3656cd3d244bd66aa607efe34))
* **security:** close 4 adversarial findings + read --version from package.json ([#75](https://github.com/enrichlayer/el-linear/issues/75)) ([2c429f1](https://github.com/enrichlayer/el-linear/commit/2c429f16fa6ebe449346e2a963fbd3b78fb6c384))
* **security:** OAuth callback + headless paste + data-file allowlist + rate limit (ALL-935 batch 2) ([#37](https://github.com/enrichlayer/el-linear/issues/37)) ([403a38a](https://github.com/enrichlayer/el-linear/commit/403a38abec6d3e792939b72cd0f041430c29c92f))
* **security:** redaction + scheme allowlist + unicode mentions (ALL-935) ([#35](https://github.com/enrichlayer/el-linear/issues/35)) ([5c344e9](https://github.com/enrichlayer/el-linear/commit/5c344e9e3ab8805cbdbf0d9aba8ad1741887aeff))
* **security:** snapshot oauthStatePath + profile-keyed loadConfig cache (ALL-935 deferred) ([#46](https://github.com/enrichlayer/el-linear/issues/46)) ([e614bff](https://github.com/enrichlayer/el-linear/commit/e614bffc852402813c75e51ecaf0b411f57431da))
* serialize init wizard config writes with file lock (DEV-4066) ([#88](https://github.com/enrichlayer/el-linear/issues/88)) ([b32ebe1](https://github.com/enrichlayer/el-linear/commit/b32ebe1f7b10d81365fb62ae32512b27fe285cc8))
* **summary:** capture kind before --fields/--raw strip signature fields (ALL-933) ([#66](https://github.com/enrichlayer/el-linear/issues/66)) ([d7a404f](https://github.com/enrichlayer/el-linear/commit/d7a404f84b4606f3e4da7d28a7c4c5a7341ac71d))
* **summary:** sanitize terminal output + harden numeric edges (ALL-934) ([#31](https://github.com/enrichlayer/el-linear/issues/31)) ([3d1535a](https://github.com/enrichlayer/el-linear/commit/3d1535a5af7fd95ef7666e0c1ff97131a767ed8f))
* validate EL_LINEAR_WORKSPACE_URL_KEY env + config urlKey shape (DEV-4067) ([#85](https://github.com/enrichlayer/el-linear/issues/85)) ([52307c7](https://github.com/enrichlayer/el-linear/commit/52307c74c7795ca7de5ca992a0bed011e3307a09))

## [1.13.0](https://github.com/enrichlayer/el-linear/compare/v1.12.0...v1.13.0) (2026-05-20)


### Features

* accept --parent as alias for --parent-ticket ([#97](https://github.com/enrichlayer/el-linear/issues/97)) ([d26233c](https://github.com/enrichlayer/el-linear/commit/d26233c8fada859c1f80526d10cb547642aaf577))
* **auth:** add OAuth 2.0 (PKCE) authentication ([#18](https://github.com/enrichlayer/el-linear/issues/18)) ([4e3b59f](https://github.com/enrichlayer/el-linear/commit/4e3b59f501e975b7b291d6926dba16a7d5a4bd0d))
* **auth:** migrate command call sites to OAuth-aware getActiveAuth ([#19](https://github.com/enrichlayer/el-linear/issues/19)) ([76c7e8d](https://github.com/enrichlayer/el-linear/commit/76c7e8d70527644c4661f7805a02b7792a2922e1))
* **auth:** wire OAuth into FileService (last unmigrated auth path) ([#20](https://github.com/enrichlayer/el-linear/issues/20)) ([57a3d59](https://github.com/enrichlayer/el-linear/commit/57a3d59f2fa623de95a066eaad1f9cb1301d6eba))
* **cli:** add cli-introspect + validate-flag for SKILL.md flag-name linting ([#76](https://github.com/enrichlayer/el-linear/issues/76)) ([5e97d5d](https://github.com/enrichlayer/el-linear/commit/5e97d5d4b1427762812ea461781ead8972f7524f))
* **comments:** rename --file to --body-file on create and update ([#110](https://github.com/enrichlayer/el-linear/issues/110)) ([61caf88](https://github.com/enrichlayer/el-linear/commit/61caf88550c55d114cb7cb85f16e124e50bcaa2d))
* **config:** add `config team` subcommand for wiring shared team config (DEV-4104) ([#114](https://github.com/enrichlayer/el-linear/issues/114)) ([371e7b7](https://github.com/enrichlayer/el-linear/commit/371e7b7be9af68a6decd81e5eb74586b451fddb8))
* **config:** add team/local config split with local.json (DEV-4172) ([#108](https://github.com/enrichlayer/el-linear/issues/108)) ([95bebab](https://github.com/enrichlayer/el-linear/commit/95bebabd17ff6aae0c557b74ea7d5669fccf173b))
* **config:** support shared team config file layer ([ea3f282](https://github.com/enrichlayer/el-linear/commit/ea3f28215b2850288254359d654348f907c422c3))
* defaults (assignee, priority), disk cache, wizard prompts, team OAuth config ([#22](https://github.com/enrichlayer/el-linear/issues/22)) ([0525c2f](https://github.com/enrichlayer/el-linear/commit/0525c2f8a96c584f09ef900b6b307201888addea))
* **discovery:** URL/slug project resolution + truncation warning + CLI-first rule ([#100](https://github.com/enrichlayer/el-linear/issues/100)) ([29ea130](https://github.com/enrichlayer/el-linear/commit/29ea1304357e3f123f2ddec54913edc764f30412))
* enrich issues create validation errors with team-scoped suggestions ([#98](https://github.com/enrichlayer/el-linear/issues/98)) ([763a495](https://github.com/enrichlayer/el-linear/commit/763a495afbaecbdc1ab9b1ead9d5656b3d800712))
* **enrich:** route project resolver failures through team-scoped enrichment (DEV-4135) ([#101](https://github.com/enrichlayer/el-linear/issues/101)) ([db6c81d](https://github.com/enrichlayer/el-linear/commit/db6c81d2c9069c50dbb8d15d8afe15fd6ec8af35))
* **filters:** add --name to users/labels/projects list, --state/--exclude-state/--active to projects list ([#36](https://github.com/enrichlayer/el-linear/issues/36)) ([a52f005](https://github.com/enrichlayer/el-linear/commit/a52f005ea049038ea16fecd600d57dda9dd9b162))
* **format:** add --format summary for human-readable output ([#28](https://github.com/enrichlayer/el-linear/issues/28)) ([2bdf3d2](https://github.com/enrichlayer/el-linear/commit/2bdf3d24107b5d996738b54fbac07930c8fff5ae))
* **init:** interactive setup wizard (linctl init) ([#7](https://github.com/enrichlayer/el-linear/issues/7)) ([23c62f8](https://github.com/enrichlayer/el-linear/commit/23c62f8b7e7a72b57ea5c99e3d6711dfba3cc469))
* **issues:** accept relation flags on issues update (DEV-4201) ([#111](https://github.com/enrichlayer/el-linear/issues/111)) ([afa05c5](https://github.com/enrichlayer/el-linear/commit/afa05c501034913ed6c6235f60f8d229eb7dca1b))
* **issues:** add --field flag to issues read for markdown section extraction (ALL-940) ([#71](https://github.com/enrichlayer/el-linear/issues/71)) ([404002f](https://github.com/enrichlayer/el-linear/commit/404002fbf992fc789cb79ba2d02e30d3ad8ec44c))
* **profiles:** legacy config detection + migrate-legacy command [ALL-922,ALL-923] ([#17](https://github.com/enrichlayer/el-linear/issues/17)) ([4536396](https://github.com/enrichlayer/el-linear/commit/45363962c905f35a0a3f7928561a93518e540c86))
* **profiles:** switch between multiple Linear workspaces ([#15](https://github.com/enrichlayer/el-linear/issues/15)) ([0bd6c37](https://github.com/enrichlayer/el-linear/commit/0bd6c3742e2e74b4a72197818d594d47a9f725a7))
* **projects:** add --team filter to projects list (DEV-4165) ([#104](https://github.com/enrichlayer/el-linear/issues/104)) ([e7c5e0e](https://github.com/enrichlayer/el-linear/commit/e7c5e0e677002fc1d0d08c82eb1312d4dc85d175))
* **refs wrap:** auto-detect positional file argument (DEV-4077) ([#94](https://github.com/enrichlayer/el-linear/issues/94)) ([1dc2155](https://github.com/enrichlayer/el-linear/commit/1dc2155bfa87efe7d96328f46709e85c4a9dd6ec))
* **refs:** add wrap subcommand with markdown + slack emitters [ALL-917] ([#10](https://github.com/enrichlayer/el-linear/issues/10)) ([16ceea9](https://github.com/enrichlayer/el-linear/commit/16ceea954fbaef14ee2562234a3f9c215f44553c))
* **workspace:** --workspace-url-key flag + EL_LINEAR_WORKSPACE_URL_KEY env (ALL-920) ([#67](https://github.com/enrichlayer/el-linear/issues/67)) ([9ced5d4](https://github.com/enrichlayer/el-linear/commit/9ced5d40a528d7cc19bd6104035cb8c984d258b4))


### Bug Fixes

* append/insert '--' separator on git checkout/branch invocations (DEV-4064) ([#83](https://github.com/enrichlayer/el-linear/issues/83)) ([3b74370](https://github.com/enrichlayer/el-linear/commit/3b74370778548bb384156af2a386393f32f1a99a))
* **auth:** serialize OAuth refresh against concurrent CLIs (ALL-931) ([#32](https://github.com/enrichlayer/el-linear/issues/32)) ([f569221](https://github.com/enrichlayer/el-linear/commit/f569221e7f490d549876800cf91cec2ed388b832))
* bump CLI version string to 1.4.0 (matching package.json + tag) ([#16](https://github.com/enrichlayer/el-linear/issues/16)) ([77e7c16](https://github.com/enrichlayer/el-linear/commit/77e7c169e67f2ff698539f0a6355ab3288843217))
* **introspect:** add --check-flag option + explicit return after process.exit ([#79](https://github.com/enrichlayer/el-linear/issues/79)) ([ebba3f8](https://github.com/enrichlayer/el-linear/commit/ebba3f88702bd41e052aeeb84c4dd3d2eebf0124))
* **issues:** batch-resolve null-filter no-op breaks --project & label resolution ([#106](https://github.com/enrichlayer/el-linear/issues/106)) ([d9cbe5c](https://github.com/enrichlayer/el-linear/commit/d9cbe5cb57f6f81c642e3b6abcbc490dbfc00b69))
* **issues:** reject a nonexistent UUID --project with a clear error ([#107](https://github.com/enrichlayer/el-linear/issues/107)) ([dddcdcf](https://github.com/enrichlayer/el-linear/commit/dddcdcf02cf2fa156549bb702993de43ee486f67))
* **profile:** atomic writes for migrate-legacy (ALL-932) ([#30](https://github.com/enrichlayer/el-linear/issues/30)) ([01131d1](https://github.com/enrichlayer/el-linear/commit/01131d10fc98822a1c6fb7a9fb783be6d0199ccb))
* **refs:** share protected-range scanner between wrap + extract (ALL-933) ([#33](https://github.com/enrichlayer/el-linear/issues/33)) ([9405eca](https://github.com/enrichlayer/el-linear/commit/9405eca427d2d7bd5c15d92cf20e49f187572832))
* sanitize OAuth refresh error body at source (DEV-4065) ([#87](https://github.com/enrichlayer/el-linear/issues/87)) ([1e11ac0](https://github.com/enrichlayer/el-linear/commit/1e11ac0417175cc3656cd3d244bd66aa607efe34))
* **security:** close 4 adversarial findings + read --version from package.json ([#75](https://github.com/enrichlayer/el-linear/issues/75)) ([2c429f1](https://github.com/enrichlayer/el-linear/commit/2c429f16fa6ebe449346e2a963fbd3b78fb6c384))
* **security:** OAuth callback + headless paste + data-file allowlist + rate limit (ALL-935 batch 2) ([#37](https://github.com/enrichlayer/el-linear/issues/37)) ([403a38a](https://github.com/enrichlayer/el-linear/commit/403a38abec6d3e792939b72cd0f041430c29c92f))
* **security:** redaction + scheme allowlist + unicode mentions (ALL-935) ([#35](https://github.com/enrichlayer/el-linear/issues/35)) ([5c344e9](https://github.com/enrichlayer/el-linear/commit/5c344e9e3ab8805cbdbf0d9aba8ad1741887aeff))
* **security:** snapshot oauthStatePath + profile-keyed loadConfig cache (ALL-935 deferred) ([#46](https://github.com/enrichlayer/el-linear/issues/46)) ([e614bff](https://github.com/enrichlayer/el-linear/commit/e614bffc852402813c75e51ecaf0b411f57431da))
* serialize init wizard config writes with file lock (DEV-4066) ([#88](https://github.com/enrichlayer/el-linear/issues/88)) ([b32ebe1](https://github.com/enrichlayer/el-linear/commit/b32ebe1f7b10d81365fb62ae32512b27fe285cc8))
* **summary:** capture kind before --fields/--raw strip signature fields (ALL-933) ([#66](https://github.com/enrichlayer/el-linear/issues/66)) ([d7a404f](https://github.com/enrichlayer/el-linear/commit/d7a404f84b4606f3e4da7d28a7c4c5a7341ac71d))
* **summary:** sanitize terminal output + harden numeric edges (ALL-934) ([#31](https://github.com/enrichlayer/el-linear/issues/31)) ([3d1535a](https://github.com/enrichlayer/el-linear/commit/3d1535a5af7fd95ef7666e0c1ff97131a767ed8f))
* validate EL_LINEAR_WORKSPACE_URL_KEY env + config urlKey shape (DEV-4067) ([#85](https://github.com/enrichlayer/el-linear/issues/85)) ([52307c7](https://github.com/enrichlayer/el-linear/commit/52307c74c7795ca7de5ca992a0bed011e3307a09))

## [1.12.0](https://github.com/enrichlayer/el-linear/compare/v1.11.0...v1.12.0) (2026-05-19)


### Features

* accept --parent as alias for --parent-ticket ([#97](https://github.com/enrichlayer/el-linear/issues/97)) ([d26233c](https://github.com/enrichlayer/el-linear/commit/d26233c8fada859c1f80526d10cb547642aaf577))
* **auth:** add OAuth 2.0 (PKCE) authentication ([#18](https://github.com/enrichlayer/el-linear/issues/18)) ([4e3b59f](https://github.com/enrichlayer/el-linear/commit/4e3b59f501e975b7b291d6926dba16a7d5a4bd0d))
* **auth:** migrate command call sites to OAuth-aware getActiveAuth ([#19](https://github.com/enrichlayer/el-linear/issues/19)) ([76c7e8d](https://github.com/enrichlayer/el-linear/commit/76c7e8d70527644c4661f7805a02b7792a2922e1))
* **auth:** wire OAuth into FileService (last unmigrated auth path) ([#20](https://github.com/enrichlayer/el-linear/issues/20)) ([57a3d59](https://github.com/enrichlayer/el-linear/commit/57a3d59f2fa623de95a066eaad1f9cb1301d6eba))
* **cli:** add cli-introspect + validate-flag for SKILL.md flag-name linting ([#76](https://github.com/enrichlayer/el-linear/issues/76)) ([5e97d5d](https://github.com/enrichlayer/el-linear/commit/5e97d5d4b1427762812ea461781ead8972f7524f))
* **comments:** rename --file to --body-file on create and update ([#110](https://github.com/enrichlayer/el-linear/issues/110)) ([61caf88](https://github.com/enrichlayer/el-linear/commit/61caf88550c55d114cb7cb85f16e124e50bcaa2d))
* **config:** add team/local config split with local.json (DEV-4172) ([#108](https://github.com/enrichlayer/el-linear/issues/108)) ([95bebab](https://github.com/enrichlayer/el-linear/commit/95bebabd17ff6aae0c557b74ea7d5669fccf173b))
* **config:** support shared team config file layer ([ea3f282](https://github.com/enrichlayer/el-linear/commit/ea3f28215b2850288254359d654348f907c422c3))
* defaults (assignee, priority), disk cache, wizard prompts, team OAuth config ([#22](https://github.com/enrichlayer/el-linear/issues/22)) ([0525c2f](https://github.com/enrichlayer/el-linear/commit/0525c2f8a96c584f09ef900b6b307201888addea))
* **discovery:** URL/slug project resolution + truncation warning + CLI-first rule ([#100](https://github.com/enrichlayer/el-linear/issues/100)) ([29ea130](https://github.com/enrichlayer/el-linear/commit/29ea1304357e3f123f2ddec54913edc764f30412))
* enrich issues create validation errors with team-scoped suggestions ([#98](https://github.com/enrichlayer/el-linear/issues/98)) ([763a495](https://github.com/enrichlayer/el-linear/commit/763a495afbaecbdc1ab9b1ead9d5656b3d800712))
* **enrich:** route project resolver failures through team-scoped enrichment (DEV-4135) ([#101](https://github.com/enrichlayer/el-linear/issues/101)) ([db6c81d](https://github.com/enrichlayer/el-linear/commit/db6c81d2c9069c50dbb8d15d8afe15fd6ec8af35))
* **filters:** add --name to users/labels/projects list, --state/--exclude-state/--active to projects list ([#36](https://github.com/enrichlayer/el-linear/issues/36)) ([a52f005](https://github.com/enrichlayer/el-linear/commit/a52f005ea049038ea16fecd600d57dda9dd9b162))
* **format:** add --format summary for human-readable output ([#28](https://github.com/enrichlayer/el-linear/issues/28)) ([2bdf3d2](https://github.com/enrichlayer/el-linear/commit/2bdf3d24107b5d996738b54fbac07930c8fff5ae))
* **init:** interactive setup wizard (linctl init) ([#7](https://github.com/enrichlayer/el-linear/issues/7)) ([23c62f8](https://github.com/enrichlayer/el-linear/commit/23c62f8b7e7a72b57ea5c99e3d6711dfba3cc469))
* **issues:** accept relation flags on issues update (DEV-4201) ([#111](https://github.com/enrichlayer/el-linear/issues/111)) ([afa05c5](https://github.com/enrichlayer/el-linear/commit/afa05c501034913ed6c6235f60f8d229eb7dca1b))
* **issues:** add --field flag to issues read for markdown section extraction (ALL-940) ([#71](https://github.com/enrichlayer/el-linear/issues/71)) ([404002f](https://github.com/enrichlayer/el-linear/commit/404002fbf992fc789cb79ba2d02e30d3ad8ec44c))
* **profiles:** legacy config detection + migrate-legacy command [ALL-922,ALL-923] ([#17](https://github.com/enrichlayer/el-linear/issues/17)) ([4536396](https://github.com/enrichlayer/el-linear/commit/45363962c905f35a0a3f7928561a93518e540c86))
* **profiles:** switch between multiple Linear workspaces ([#15](https://github.com/enrichlayer/el-linear/issues/15)) ([0bd6c37](https://github.com/enrichlayer/el-linear/commit/0bd6c3742e2e74b4a72197818d594d47a9f725a7))
* **projects:** add --team filter to projects list (DEV-4165) ([#104](https://github.com/enrichlayer/el-linear/issues/104)) ([e7c5e0e](https://github.com/enrichlayer/el-linear/commit/e7c5e0e677002fc1d0d08c82eb1312d4dc85d175))
* **refs wrap:** auto-detect positional file argument (DEV-4077) ([#94](https://github.com/enrichlayer/el-linear/issues/94)) ([1dc2155](https://github.com/enrichlayer/el-linear/commit/1dc2155bfa87efe7d96328f46709e85c4a9dd6ec))
* **refs:** add wrap subcommand with markdown + slack emitters [ALL-917] ([#10](https://github.com/enrichlayer/el-linear/issues/10)) ([16ceea9](https://github.com/enrichlayer/el-linear/commit/16ceea954fbaef14ee2562234a3f9c215f44553c))
* **workspace:** --workspace-url-key flag + EL_LINEAR_WORKSPACE_URL_KEY env (ALL-920) ([#67](https://github.com/enrichlayer/el-linear/issues/67)) ([9ced5d4](https://github.com/enrichlayer/el-linear/commit/9ced5d40a528d7cc19bd6104035cb8c984d258b4))


### Bug Fixes

* append/insert '--' separator on git checkout/branch invocations (DEV-4064) ([#83](https://github.com/enrichlayer/el-linear/issues/83)) ([3b74370](https://github.com/enrichlayer/el-linear/commit/3b74370778548bb384156af2a386393f32f1a99a))
* **auth:** serialize OAuth refresh against concurrent CLIs (ALL-931) ([#32](https://github.com/enrichlayer/el-linear/issues/32)) ([f569221](https://github.com/enrichlayer/el-linear/commit/f569221e7f490d549876800cf91cec2ed388b832))
* bump CLI version string to 1.4.0 (matching package.json + tag) ([#16](https://github.com/enrichlayer/el-linear/issues/16)) ([77e7c16](https://github.com/enrichlayer/el-linear/commit/77e7c169e67f2ff698539f0a6355ab3288843217))
* **introspect:** add --check-flag option + explicit return after process.exit ([#79](https://github.com/enrichlayer/el-linear/issues/79)) ([ebba3f8](https://github.com/enrichlayer/el-linear/commit/ebba3f88702bd41e052aeeb84c4dd3d2eebf0124))
* **issues:** batch-resolve null-filter no-op breaks --project & label resolution ([#106](https://github.com/enrichlayer/el-linear/issues/106)) ([d9cbe5c](https://github.com/enrichlayer/el-linear/commit/d9cbe5cb57f6f81c642e3b6abcbc490dbfc00b69))
* **issues:** reject a nonexistent UUID --project with a clear error ([#107](https://github.com/enrichlayer/el-linear/issues/107)) ([dddcdcf](https://github.com/enrichlayer/el-linear/commit/dddcdcf02cf2fa156549bb702993de43ee486f67))
* **profile:** atomic writes for migrate-legacy (ALL-932) ([#30](https://github.com/enrichlayer/el-linear/issues/30)) ([01131d1](https://github.com/enrichlayer/el-linear/commit/01131d10fc98822a1c6fb7a9fb783be6d0199ccb))
* **refs:** share protected-range scanner between wrap + extract (ALL-933) ([#33](https://github.com/enrichlayer/el-linear/issues/33)) ([9405eca](https://github.com/enrichlayer/el-linear/commit/9405eca427d2d7bd5c15d92cf20e49f187572832))
* sanitize OAuth refresh error body at source (DEV-4065) ([#87](https://github.com/enrichlayer/el-linear/issues/87)) ([1e11ac0](https://github.com/enrichlayer/el-linear/commit/1e11ac0417175cc3656cd3d244bd66aa607efe34))
* **security:** close 4 adversarial findings + read --version from package.json ([#75](https://github.com/enrichlayer/el-linear/issues/75)) ([2c429f1](https://github.com/enrichlayer/el-linear/commit/2c429f16fa6ebe449346e2a963fbd3b78fb6c384))
* **security:** OAuth callback + headless paste + data-file allowlist + rate limit (ALL-935 batch 2) ([#37](https://github.com/enrichlayer/el-linear/issues/37)) ([403a38a](https://github.com/enrichlayer/el-linear/commit/403a38abec6d3e792939b72cd0f041430c29c92f))
* **security:** redaction + scheme allowlist + unicode mentions (ALL-935) ([#35](https://github.com/enrichlayer/el-linear/issues/35)) ([5c344e9](https://github.com/enrichlayer/el-linear/commit/5c344e9e3ab8805cbdbf0d9aba8ad1741887aeff))
* **security:** snapshot oauthStatePath + profile-keyed loadConfig cache (ALL-935 deferred) ([#46](https://github.com/enrichlayer/el-linear/issues/46)) ([e614bff](https://github.com/enrichlayer/el-linear/commit/e614bffc852402813c75e51ecaf0b411f57431da))
* serialize init wizard config writes with file lock (DEV-4066) ([#88](https://github.com/enrichlayer/el-linear/issues/88)) ([b32ebe1](https://github.com/enrichlayer/el-linear/commit/b32ebe1f7b10d81365fb62ae32512b27fe285cc8))
* **summary:** capture kind before --fields/--raw strip signature fields (ALL-933) ([#66](https://github.com/enrichlayer/el-linear/issues/66)) ([d7a404f](https://github.com/enrichlayer/el-linear/commit/d7a404f84b4606f3e4da7d28a7c4c5a7341ac71d))
* **summary:** sanitize terminal output + harden numeric edges (ALL-934) ([#31](https://github.com/enrichlayer/el-linear/issues/31)) ([3d1535a](https://github.com/enrichlayer/el-linear/commit/3d1535a5af7fd95ef7666e0c1ff97131a767ed8f))
* validate EL_LINEAR_WORKSPACE_URL_KEY env + config urlKey shape (DEV-4067) ([#85](https://github.com/enrichlayer/el-linear/issues/85)) ([52307c7](https://github.com/enrichlayer/el-linear/commit/52307c74c7795ca7de5ca992a0bed011e3307a09))

## [1.11.0](https://github.com/enrichlayer/el-linear/compare/v1.10.0...v1.11.0) (2026-05-13)


### Features

* accept --parent as alias for --parent-ticket ([#97](https://github.com/enrichlayer/el-linear/issues/97)) ([d26233c](https://github.com/enrichlayer/el-linear/commit/d26233c8fada859c1f80526d10cb547642aaf577))
* **cli:** add cli-introspect + validate-flag for SKILL.md flag-name linting ([#76](https://github.com/enrichlayer/el-linear/issues/76)) ([5e97d5d](https://github.com/enrichlayer/el-linear/commit/5e97d5d4b1427762812ea461781ead8972f7524f))
* **discovery:** URL/slug project resolution + truncation warning + CLI-first rule ([#100](https://github.com/enrichlayer/el-linear/issues/100)) ([29ea130](https://github.com/enrichlayer/el-linear/commit/29ea1304357e3f123f2ddec54913edc764f30412))
* enrich issues create validation errors with team-scoped suggestions ([#98](https://github.com/enrichlayer/el-linear/issues/98)) ([763a495](https://github.com/enrichlayer/el-linear/commit/763a495afbaecbdc1ab9b1ead9d5656b3d800712))
* **issues:** add --field flag to issues read for markdown section extraction (ALL-940) ([#71](https://github.com/enrichlayer/el-linear/issues/71)) ([404002f](https://github.com/enrichlayer/el-linear/commit/404002fbf992fc789cb79ba2d02e30d3ad8ec44c))
* **refs wrap:** auto-detect positional file argument (DEV-4077) ([#94](https://github.com/enrichlayer/el-linear/issues/94)) ([1dc2155](https://github.com/enrichlayer/el-linear/commit/1dc2155bfa87efe7d96328f46709e85c4a9dd6ec))


### Bug Fixes

* append/insert '--' separator on git checkout/branch invocations (DEV-4064) ([#83](https://github.com/enrichlayer/el-linear/issues/83)) ([3b74370](https://github.com/enrichlayer/el-linear/commit/3b74370778548bb384156af2a386393f32f1a99a))
* **introspect:** add --check-flag option + explicit return after process.exit ([#79](https://github.com/enrichlayer/el-linear/issues/79)) ([ebba3f8](https://github.com/enrichlayer/el-linear/commit/ebba3f88702bd41e052aeeb84c4dd3d2eebf0124))
* sanitize OAuth refresh error body at source (DEV-4065) ([#87](https://github.com/enrichlayer/el-linear/issues/87)) ([1e11ac0](https://github.com/enrichlayer/el-linear/commit/1e11ac0417175cc3656cd3d244bd66aa607efe34))
* **security:** close 4 adversarial findings + read --version from package.json ([#75](https://github.com/enrichlayer/el-linear/issues/75)) ([2c429f1](https://github.com/enrichlayer/el-linear/commit/2c429f16fa6ebe449346e2a963fbd3b78fb6c384))
* serialize init wizard config writes with file lock (DEV-4066) ([#88](https://github.com/enrichlayer/el-linear/issues/88)) ([b32ebe1](https://github.com/enrichlayer/el-linear/commit/b32ebe1f7b10d81365fb62ae32512b27fe285cc8))
* validate EL_LINEAR_WORKSPACE_URL_KEY env + config urlKey shape (DEV-4067) ([#85](https://github.com/enrichlayer/el-linear/issues/85)) ([52307c7](https://github.com/enrichlayer/el-linear/commit/52307c74c7795ca7de5ca992a0bed011e3307a09))

## [1.10.0](https://github.com/enrichlayer/el-linear/compare/v1.9.0...v1.10.0) (2026-05-11)


### Features

* **workspace:** --workspace-url-key flag + EL_LINEAR_WORKSPACE_URL_KEY env (ALL-920) ([#67](https://github.com/enrichlayer/el-linear/issues/67)) ([9ced5d4](https://github.com/enrichlayer/el-linear/commit/9ced5d40a528d7cc19bd6104035cb8c984d258b4))


### Bug Fixes

* **summary:** capture kind before --fields/--raw strip signature fields (ALL-933) ([#66](https://github.com/enrichlayer/el-linear/issues/66)) ([d7a404f](https://github.com/enrichlayer/el-linear/commit/d7a404f84b4606f3e4da7d28a7c4c5a7341ac71d))

## [1.9.0](https://github.com/enrichlayer/el-linear/compare/v1.8.1...v1.9.0) (2026-05-09)


### Features

* **auth:** add OAuth 2.0 (PKCE) authentication ([#18](https://github.com/enrichlayer/el-linear/issues/18)) ([4e3b59f](https://github.com/enrichlayer/el-linear/commit/4e3b59f501e975b7b291d6926dba16a7d5a4bd0d))
* **auth:** migrate command call sites to OAuth-aware getActiveAuth ([#19](https://github.com/enrichlayer/el-linear/issues/19)) ([76c7e8d](https://github.com/enrichlayer/el-linear/commit/76c7e8d70527644c4661f7805a02b7792a2922e1))
* **auth:** wire OAuth into FileService (last unmigrated auth path) ([#20](https://github.com/enrichlayer/el-linear/issues/20)) ([57a3d59](https://github.com/enrichlayer/el-linear/commit/57a3d59f2fa623de95a066eaad1f9cb1301d6eba))
* defaults (assignee, priority), disk cache, wizard prompts, team OAuth config ([#22](https://github.com/enrichlayer/el-linear/issues/22)) ([0525c2f](https://github.com/enrichlayer/el-linear/commit/0525c2f8a96c584f09ef900b6b307201888addea))
* **filters:** add --name to users/labels/projects list, --state/--exclude-state/--active to projects list ([#36](https://github.com/enrichlayer/el-linear/issues/36)) ([a52f005](https://github.com/enrichlayer/el-linear/commit/a52f005ea049038ea16fecd600d57dda9dd9b162))
* **format:** add --format summary for human-readable output ([#28](https://github.com/enrichlayer/el-linear/issues/28)) ([2bdf3d2](https://github.com/enrichlayer/el-linear/commit/2bdf3d24107b5d996738b54fbac07930c8fff5ae))
* **init:** interactive setup wizard (linctl init) ([#7](https://github.com/enrichlayer/el-linear/issues/7)) ([23c62f8](https://github.com/enrichlayer/el-linear/commit/23c62f8b7e7a72b57ea5c99e3d6711dfba3cc469))
* **profiles:** legacy config detection + migrate-legacy command [ALL-922,ALL-923] ([#17](https://github.com/enrichlayer/el-linear/issues/17)) ([4536396](https://github.com/enrichlayer/el-linear/commit/45363962c905f35a0a3f7928561a93518e540c86))
* **profiles:** switch between multiple Linear workspaces ([#15](https://github.com/enrichlayer/el-linear/issues/15)) ([0bd6c37](https://github.com/enrichlayer/el-linear/commit/0bd6c3742e2e74b4a72197818d594d47a9f725a7))
* **refs:** add wrap subcommand with markdown + slack emitters [ALL-917] ([#10](https://github.com/enrichlayer/el-linear/issues/10)) ([16ceea9](https://github.com/enrichlayer/el-linear/commit/16ceea954fbaef14ee2562234a3f9c215f44553c))


### Bug Fixes

* **auth:** serialize OAuth refresh against concurrent CLIs (ALL-931) ([#32](https://github.com/enrichlayer/el-linear/issues/32)) ([f569221](https://github.com/enrichlayer/el-linear/commit/f569221e7f490d549876800cf91cec2ed388b832))
* bump CLI version string to 1.4.0 (matching package.json + tag) ([#16](https://github.com/enrichlayer/el-linear/issues/16)) ([77e7c16](https://github.com/enrichlayer/el-linear/commit/77e7c169e67f2ff698539f0a6355ab3288843217))
* **profile:** atomic writes for migrate-legacy (ALL-932) ([#30](https://github.com/enrichlayer/el-linear/issues/30)) ([01131d1](https://github.com/enrichlayer/el-linear/commit/01131d10fc98822a1c6fb7a9fb783be6d0199ccb))
* **refs:** share protected-range scanner between wrap + extract (ALL-933) ([#33](https://github.com/enrichlayer/el-linear/issues/33)) ([9405eca](https://github.com/enrichlayer/el-linear/commit/9405eca427d2d7bd5c15d92cf20e49f187572832))
* **security:** OAuth callback + headless paste + data-file allowlist + rate limit (ALL-935 batch 2) ([#37](https://github.com/enrichlayer/el-linear/issues/37)) ([403a38a](https://github.com/enrichlayer/el-linear/commit/403a38abec6d3e792939b72cd0f041430c29c92f))
* **security:** redaction + scheme allowlist + unicode mentions (ALL-935) ([#35](https://github.com/enrichlayer/el-linear/issues/35)) ([5c344e9](https://github.com/enrichlayer/el-linear/commit/5c344e9e3ab8805cbdbf0d9aba8ad1741887aeff))
* **security:** snapshot oauthStatePath + profile-keyed loadConfig cache (ALL-935 deferred) ([#46](https://github.com/enrichlayer/el-linear/issues/46)) ([e614bff](https://github.com/enrichlayer/el-linear/commit/e614bffc852402813c75e51ecaf0b411f57431da))
* **summary:** sanitize terminal output + harden numeric edges (ALL-934) ([#31](https://github.com/enrichlayer/el-linear/issues/31)) ([3d1535a](https://github.com/enrichlayer/el-linear/commit/3d1535a5af7fd95ef7666e0c1ff97131a767ed8f))

## [Unreleased]

### Added

- **Native Linear agent delegation.** Issues now surface Linear's
  `delegate` field in JSON output, and `issues create`, `issues update`,
  `issues list`, and `issues search` accept `--delegate` for agent app
  users. `issues update --clear-delegate` removes the delegate.
- **Agent start helper.** `issues start <issueId>` moves an issue to the
  first workflow state of type `started` for the issue's team, leaving
  already-started or terminal issues unchanged.
- **OAuth app actor mode.** `init oauth --actor app` authorizes as the
  Linear app user for agent/service-account workflows, stores the
  resulting `viewerId` in `oauth.json`, and validates app-only scope rules.

### Changed

- **Split `commands/issues.ts` into focused modules.** The 1865-line
  file mixed branch helpers, description prep, the wrap-and-resolve
  pipeline, the auto-link hook, and ten command handlers into a
  single module. Two helper modules carved out:
  - `commands/issues/branch.ts` — `toBranchName`, `gitCheckoutBranch`,
    + the Linear-branchName regex.
  - `commands/issues/description.ts` — `readDescriptionFile`,
    `resolveDescription`, the shared `wrapAndResolveRefs` core,
    `prepareAutoLinkedDescription`, `prepareDescriptionRewrite`,
    `pushDescriptionUpdate`, and `maybeAutoLink`.

  `commands/issues.ts` is now 1588 lines (was 1865) and focused on
  commander wiring + handlers + the remaining helpers
  (`createRelations`, attachment glue, retrolink, link-references).
  No behavior change; 1201/1201 tests still pass. Refs ALL-938.

### Security

- **OAuth read-modify-write now snapshots the target path.** Pre-fix,
  `readOAuthState` and `writeOAuthState` each called `oauthStatePath()`
  independently — if `setActiveProfileForSession()` ran between them
  (no current code path triggers this; defense in depth), the read
  and write would target different profiles. Post-fix, both helpers
  accept an explicit `targetPath` and `ensureFreshAccessToken` resolves
  the path once at the top of the lock-protected critical section.
  ALL-935 deferred fix.
- **`loadConfig` cache is now profile-keyed.** Pre-fix, switching the
  active profile mid-process and calling `loadConfig` again returned
  the OLD profile's config until `_resetConfigCacheForTests` ran.
  Post-fix, each profile (and the legacy single-file layout, keyed
  as `null`) gets its own cache slot. Today's CLI always sets the
  profile in `preAction` before any command body runs, so this is
  latent — but the keyed cache makes the behavior future-proof and
  removes a test-isolation footgun. ALL-935 deferred fix.

### Changed

- **Generic `table-formatter.ts` shared between issues and projects.**
  `commands/projects.ts` carried an 80-line `formatProjectsOutput`
  that reinvented column-width math, table padding, CSV quoting, and
  markdown pipe syntax — duplicating the renderers in
  `utils/table-formatter.ts` (which were hardcoded to `LinearIssue`).
  The renderers now take generic `ColumnDef<T>` /
  `MarkdownColumnDef<T>` and `commands/projects.ts` declares its
  own column definitions and calls the same
  `renderFixedWidthTable` / `renderCsv` / `renderMarkdownTable`
  helpers. Output is byte-equivalent. Refs ALL-938.
- **Typed `SearchIssueArgs` for `GraphQLIssuesService.searchIssues`.**
  Same treatment as `CreateIssueArgs` and `UpdateIssueArgs` — typed
  shape covers the two search modes (full-text query + structured
  filter) with appropriate fields for each. Caller sites in
  `commands/issues.ts` (`handleListIssues` and `handleSearchIssues`)
  now construct the typed args directly. Refs ALL-937.
- **Typed `UpdateIssueArgs` for `GraphQLIssuesService.updateIssue`.**
  Same treatment as `CreateIssueArgs` — `id` is required, the helper
  pipeline (`resolveUpdateContext`, `extractMilestoneNodes`,
  `resolveCycleIdForUpdate`, `resolveStatusIdForUpdate`,
  `buildUpdateInput`) all take the typed shape, the internal
  `as string`/`as string[]` casts are gone, and `buildUpdateArgs` in
  `commands/issues.ts` returns the typed args directly. Refs ALL-937.
- **Typed `CreateIssueArgs` for `GraphQLIssuesService.createIssue`.**
  The method (and its private helpers `resolveCreateFields`,
  `buildCreateInput`, `buildCreateResolveVariables`) used to accept
  `Record<string, unknown>` and re-cast every property internally
  (`args.assigneeId as string`, `args.labelIds as string[]`, etc.).
  A typo in a caller — `assigeeId` vs `assigneeId` — compiled
  cleanly and silently dropped the field. Now the args take a
  typed interface, the casts inside are gone, and the typo
  becomes a `tsc` error. First slice of the ALL-937 type-design
  refactor. Refs ALL-937.

### Changed

- **`splitList` accepts `string | undefined | null | false`** and
  returns `[]` for any falsy value, including commander's `false`
  (which is what `--no-foo` produces). Removes the per-callsite
  truthy-guard footgun. Refs ALL-938.
- **`outputWarning` no longer takes an unused `_type` parameter.** The
  three callers (`term-enforcer`, `issue-validation`, `issues create`)
  passed category strings (`"term_enforcement"`, `"validation"`,
  `"missing_fields"`) that the function never read. Drop the param;
  category info that mattered was already in the warning text.
  Refs ALL-938.
- **Funnel direct `process.stderr.write` calls through `logger.error`**
  in `graphql-issues-service.ts`, `disk-cache.ts`, and `commands/refs.ts`.
  Three of the four sites now go through the same exit point as the
  rest of the code's stderr output. Remaining `process.stdout.write`
  calls (jq result, `refs wrap` payload, `gdoc` markdown,
  `main.ts:110` JSON-error envelope) are intentional raw-stream emits
  and stay direct. Refs ALL-938.

### Changed

- **Extract shared `wrapAndResolveRefs` core for description
  rewriting.** `prepareAutoLinkedDescription` (issues create/update)
  and `prepareDescriptionRewrite` (`issues link-references
  --rewrite-description`) used to carry near-duplicate 25-line
  bodies that differed only in their return shape and opt-out
  semantics. Both now call one shared validate-refs-then-wrap
  helper; the wrappers handle the per-caller policy (the
  `--no-auto-link` opt-out, `preResolved: undefined` vs empty Map
  signaling). One place to fix bugs in the pipeline. Refs ALL-938.

### Changed

- **Centralized list-table renderer in the summary formatter.** The
  13 `formatXList` functions in `src/utils/formatters/summary.ts`
  used to inline their own column-width math, header/separator
  wiring, and footer pluralization. They now declare a `ColumnDef[]`
  and delegate to one shared `renderTable<T>` helper. Output is
  byte-identical (1200 tests still pass), but adding a new
  resource's table or adjusting an existing one is now a column
  declaration instead of 25 lines of width-math boilerplate. Refs
  ALL-938.

### Removed

- **Dead `outputSuccessAs` export** and the companion `meta.kind`
  inference path (`mapHint` table + `inferListKind` envelope hint
  lookup). `outputSuccessAs` had zero callers outside its own
  definition; no `outputSuccess({...})` site set `meta.kind`. Net
  ~50 lines deleted across `src/utils/output.ts` and
  `src/utils/formatters/summary.ts`. If a future caller needs
  shape-pinning, the right move is to wire the explicit kind into
  the existing dispatch instead of resurrecting the dead path.
  Refs ALL-938.
- **Double `--raw` unwrap in `emitSummary`.** `outputSuccess` already
  unwraps `{ data: [...] }` envelopes on the rawMode path; the second
  unwrap inside `emitSummary` was dead defensive code that obscured
  data flow. Refs ALL-938.

### Changed

- **`handleReadIssue` and `readIssues` consolidated.** Both functions
  were byte-equivalent; `commands/issues.ts` now imports `readIssues`
  from `commands/read-shortcut.ts` so the `issues read` subcommand
  and the top-level `read` shortcut go through one implementation.
  Refs ALL-938.

### Security

- **OAuth callback page no longer reflects attacker-controlled prose.**
  Previously the `error_description` from the redirect URL was
  embedded into the local listener's HTML response (with `<>&`
  stripped). An attacker who knew the local listener port could fire
  `http://localhost:<port>/oauth/callback?error=phish&error_description=Your+account+is+compromised…`
  and have arbitrary phishing prose render in the user's browser
  before the legitimate redirect arrived. Now the page renders a
  fixed string ("Authorization failed. Return to your terminal —
  the CLI has the details."); the upstream detail is logged to the
  CLI where it belongs. Refs ALL-935.
- **`init oauth` headless flow rejects bare-code pastes by default.**
  Pre-fix, pasting just the authorization code (no surrounding URL)
  silently fabricated `state = expectedState`, defeating the OAuth
  CSRF check entirely. Post-fix, the prompt requires the FULL
  callback URL — paste it as-is and the resolver verifies `state`
  matches. Bare-code paste is still available behind
  `--unsafe-bare-code` for SSH / restricted-container scenarios where
  the user genuinely can't copy the URL, but the flag's name + help
  text now tell them what they're trading away. Refs ALL-935.
- **`templates --data-file` rejects absolute / `..`-traversing paths
  by default.** Pre-fix, a CI invocation or scripted caller passing
  an attacker-controlled `--data-file` could read any file (e.g.
  `~/.aws/credentials.json`, `/etc/passwd`) and ship its contents
  into Linear's API via the `templateData` field. Post-fix, the
  resolver rejects paths starting with `/`, `../`, or `..\`; opt in
  with `--allow-absolute` if you really need it. Refs ALL-935.
- **Auto-link reference resolution caps candidates at 50 per call.**
  A description containing hundreds of fake identifiers (`AAA-1, …,
  AAA-999`) used to trigger one GraphQL roundtrip per identifier
  before deciding none resolved — a foot-gun DoS-for-self vector.
  Now the resolver processes the first 50 candidates and reports
  the overflow as a single synthetic `failed` entry. Refs ALL-935.
- **`sanitizeForLog` now also redacts OAuth tokens.** Previously the
  redaction regex only matched the `lin_api_…` prefix; OAuth access
  and refresh tokens (`lin_oauth_…`) were left visible. A
  high-entropy fallback also redacts 40+ char Bearer-style payloads
  adjacent to `Authorization` / `Bearer` keywords, catching future
  token shapes we haven't anticipated.

### Fixed

- **ProseMirror link marks now reject unsafe URL schemes.** Comments
  / issue descriptions containing `[label](javascript:…)`,
  `[label](data:…)`, `[label](vbscript:…)`, or `[label](file://…)`
  used to flow into Linear's API with the dangerous href intact;
  now the link mark is silently dropped (label survives as plain
  text). `http`, `https`, `mailto`, `linear`, and schemeless /
  relative hrefs still pass through. Defense in depth — Linear's
  web UI almost certainly has its own sanitizer, but we don't want
  to depend on that.
- **Mention regex is now Unicode-aware.** `@(\w+)` was ASCII-only,
  so `@Юрий`, `@Niño`, or any non-Latin name silently failed to
  resolve. Bare-name auto-mention had the same limitation via
  `\b…\b`. Both now use `\p{L}\p{N}_` lookarounds and the `/u`
  flag, so Cyrillic / accented Latin / CJK names match correctly.
- **`extractIssueReferences` honors the wrapper's protected ranges.**
  Previously the extractor only stripped fenced code blocks; identifiers
  inside markdown links (`[label](https://x/DEV-100)`), bare URLs
  (`https://github.com/org/repo/DEV-100.md`), inline backticks, Slack
  links, and angle-bracket autolinks were extracted as phantom
  relations. Now the extractor uses the same protection scanner as
  `wrapIssueReferencesAsLinks`, so the wrap→extract composition is
  symmetric and the DEV-3606 bug class (transform/consumer disagreement)
  is closed at the source. Shared scanner lives at
  `src/utils/protected-ranges.ts`. Closes ALL-933.
- **`--format summary` strips terminal control sequences** before
  rendering issue / comment / project text. ANSI/OSC/CSI byte
  injection in titles or descriptions no longer hijacks the user's
  terminal — anyone with workspace write access used to be able to
  emit `\x1b]8;;https://evil/\x07Click\x1b]8;;\x07` in an issue title
  and have it render as a misleading clickable hyperlink. Newlines and
  tabs are preserved; everything else in C0/C1 + DEL is dropped.
- **`clipDescription` now enforces a 4096-char cap** in addition to
  the existing 10-line cap. A single-line 5MB description previously
  passed the line check and was dumped verbatim to stdout.
- **`truncate(s, 0)` returns the empty string** instead of `s.slice(0,
  -1) + "…"` (which silently produced a 5-char output for a request of
  0). `truncate(s, 1)` returns `"…"` explicitly. No production caller
  hits these boundaries today; the helper is now contract-correct
  for future reuse. Closes ALL-934.

### Security

- **OAuth refresh is now serialized across concurrent processes.** When
  the access token is near expiry, the refresh path acquires an
  exclusive file lock on the `oauth.json` sidecar before reading,
  refreshing, and writing. Without this, two parallel `el-linear`
  invocations (parallel CI matrix, two terminal tabs, watchdog scripts)
  would both observe an expired state, both call `refreshTokens` with
  the same refresh token, and both write — Linear's OAuth server
  invalidates the loser's token, and the loser's next refresh
  permanently fails. The lock makes the loser re-read the freshly-
  written state inside the critical section and use the winner's tokens
  instead of issuing a duplicate refresh. Stale locks (process crashed
  mid-refresh) are detected via mtime and stolen after 30s. Closes
  ALL-931.
- **Atomic writes for `profile migrate-legacy`.** The migrate-legacy
  command's config / token / active-profile writes now go through the
  existing `atomicWrite` helper (write-tmp + rename) instead of raw
  `fs.writeFile`. Closes two failure modes: (a) partial writes on SIGINT
  / OOM / power loss, which previously left a corrupt config or token
  file; (b) a TOCTOU window when overwriting a pre-existing token file
  at mode `0o644` — the freshly-written token sat at the looser mode
  until a follow-up `chmod` ran, and a concurrent reader could grab it
  during that window. atomicWrite creates the tmp file at the requested
  mode and renames into place, so the destination atomically transitions
  from old-content-old-mode to new-content-new-mode. Closes ALL-932.

The audit-related fixes above close the highest-impact P2 hardening
findings from the 2026-05-09 product-finalizer audit. Tracked under
ALL-935; remaining items continue to be tracked there.

### Added

- **`--format summary` coverage** for `documents list/read`, `templates
  list/read`, `attachments list`, and `releases list/read`. These were
  previously falling back to the generic key/value renderer because no
  dedicated formatter existed; with this release they each get a stable
  table layout matching the rest of the resource types. Closes ALL-936.
- **README and SKILL.md guidance** explicitly steers callers (and LLM
  agents) toward `--format summary` instead of `python -c "json.load..."`
  / `jq` pipelines for human-readable output. The skill lists concrete
  anti-patterns to avoid.

### Fixed

- **`--from-template` no longer requires a local title.** When
  `el-linear issues create --from-template <id>` is invoked without a
  positional/`--title` value, the create mutation now omits the title
  field so Linear copies the template's title server-side, matching the
  documented behavior.
- **`--version` reports the package version.** The `commander` version
  literal had drifted past the published `package.json` version.

### Security

- **Profile name validation tightened.** Path traversal via `--profile`,
  `EL_LINEAR_PROFILE`, and the `~/.config/el-linear/active-profile`
  marker file is now rejected at every entry point. Previously only the
  `profile add/use/remove/migrate-legacy` subcommands validated; the
  three other entry points let `../../../tmp/x` style names through to
  `path.join()`. The shared `isSafeProfileName` helper now lives in
  `src/config/paths.ts`.
- **Cross-profile token-leak guard.** When a profile is explicitly
  selected (`--profile`, `EL_LINEAR_PROFILE`, or active-profile marker)
  and its token file is missing, the CLI now throws instead of silently
  falling back to the legacy single-file token. Falling back posted
  writes to the wrong workspace.
- **Prototype pollution guard in config merge.** A hand-edited
  `~/.config/el-linear/config.json` containing `__proto__`,
  `constructor`, or `prototype` keys is now ignored during `deepMerge`.

## [1.8.1] — 2026-05-09

Adds a global `--format summary` output mode for human-readable rendering
of single-resource and list payloads. Designed to replace the
`el-linear ... | python -c "json.load(...)"` and `jq` pipelines that
every consumer (humans and LLMs) ends up writing to extract a brief
summary from the default JSON envelope.

### Added

- **`--format <kind>` root flag.** Accepts `json` (default, unchanged
  behavior) or `summary`. The `summary` mode emits a fixed
  human-readable rendering with stable field ordering per resource
  type. Format value is also accepted on the per-command `--format`
  options of `issues list`, `issues search`, and `projects list`
  alongside the existing `table` / `md` / `csv` options.
- **Summary formatters** for issues (single + list), projects
  (single + list), comments (single + list), cycles (single + list),
  project milestones (single + list), teams (list), labels (list),
  users (single + list), search results (cross-resource list), plus
  a generic key/value fallback for resource shapes the dispatcher
  doesn't recognize. Single-issue summary shows identifier, title,
  state, assignee, project, labels, URL, and the first ten lines of
  the description with a truncation footer.
- **Bundled SKILL.md guidance.** `claude-skills/linear-operations/SKILL.md`
  now opens with an explicit instruction to prefer `--format summary`
  over piping through `jq` or `python -c` for terminal / agent output.
  Ships in the npm tarball.

### Behavior

- Existing JSON output is unchanged when `--format` is not set or set
  to `json`. `--raw`, `--jq`, and `--fields` continue to work in
  json mode.
- `--raw` composes with `--format summary` (an envelope `{data:[...]}`
  is unwrapped before formatting). `--jq` and `--fields` do not
  compose with summary mode — they're JSON-shape filters.


## [1.7.0] — 2026-05-08

This release rounds out the issue-creation defaults and adds disk caching
for the workspace list commands. Drops the need for a personal-skill
"always set this" rule for assignee + priority on every `issues create`.

### Added

- **`config.defaultAssignee` + `--no-assignee` flag.** Optional default
  assignee for `el-linear issues create`, applied when `--assignee` is not
  passed. Accepts the same shapes as the `--assignee` flag (alias, display
  name, email, or UUID). Pass `--no-assignee` to skip both flag and config
  for one invocation. Surfaced in the `init defaults` wizard with a
  prompt that accepts `none` as an explicit clear.
- **`config.defaultPriority`.** Optional default priority for both
  `el-linear issues create` and `el-linear issues update`. Accepts the
  same keywords/numbers as `--priority`
  (`none|urgent|high|medium|normal|low` / `0`–`4`). Surfaced in the
  `init defaults` wizard via a select prompt. The runtime path runs the
  stored value through `validatePriority` so a bad config value fails fast.
- **`config.cacheTTLSeconds` + `--no-cache` flag.** Configures the TTL
  (in seconds) of the new on-disk cache for `teams list`, `labels list`,
  and `projects list`. Defaults to `3600` (1 hour) when omitted. A value
  of `0` disables the cache. The `--no-cache` root flag bypasses the
  cache for one invocation. Surfaced in the `init defaults` wizard with
  numeric validation.
- **Disk cache for `teams list` / `labels list` / `projects list`.** Lives
  at `<profile-dir>/cache/<key>.json`, profile-aware so caches don't bleed
  between profiles. Keys include filter parameters (e.g.
  `labels-list-team:ENG-limit:100`) so different filter combos don't
  collide. Atomic writes (tmp + rename, mode 0644). Corrupt or
  unknown-version envelopes are silently treated as a miss and refetched.
  Write errors log to stderr but never fail the user's command.

### Changed

- **`init defaults` wizard now covers the new fields.** Three new
  sub-prompts (default assignee, default priority, cache TTL) sit between
  the existing prompts. Each defaults to "skip" so re-running the wizard
  with no input still produces a byte-identical config.

## [1.6.0] — 2026-05-08

This release completes OAuth 2.0 coverage across every CLI command and adds
two issue-authoring conveniences.

### OAuth completion

In 1.5.0 OAuth was wired into `init oauth` + storage + the `GraphQLService` /
`LinearService` constructors, but command call sites still resolved through
the personal-token-only `getApiToken()`. Two follow-ups landed:

- **Every command now uses the OAuth-aware resolver.** `createGraphQLService`
  and `createLinearService` are now async and dispatch through
  `getActiveAuth()`, which auto-refreshes near-expiry OAuth tokens. ~85 call
  sites migrated; the `--api-token` / `LINEAR_API_TOKEN` overrides keep
  working at the same precedence as before.
- **`FileService` now supports OAuth too.** `attachments create`,
  `embeds upload/download`, `issues create --attachment`, and the image-inlining
  in `issues read` / `read-shortcut` all worked under personal tokens but
  silently 401'd for OAuth users because `FileService` sent
  `Authorization: <token>` (no Bearer prefix). Now it accepts the same
  discriminated-union as the other services and sends the right header
  shape per credential kind.

### Added

- **`config.messageFooter` + `--footer` / `--no-footer` flags.** Text appended
  to issue descriptions on `el-linear issues create` and to comment bodies on
  `el-linear comments create`. Treat the value as a literal string — include
  any `\n\n---\n` separator yourself if you want a horizontal rule. The
  `--footer "..."` flag overrides the configured value for one invocation;
  `--no-footer` skips both flag and config.
- **`config.descriptionTemplates` + `--template <name>` flag.** Named
  description boilerplates for `el-linear issues create`. When `--template
  bug` is passed and neither `--description` nor `--description-file` is
  set, the template body is used as the description. Combining `--template`
  with an explicit description is a usage error (we throw rather than
  silently dropping one).

### Changed

- **`--priority none` now works** on `issues create` / `issues update`.
  Previously the keyword was rejected for create/update even though `0`
  ("No priority") is a real Linear state. `validatePriority` now accepts
  the full keyword set the filter parser already supported:
  `none`/`urgent`/`high`/`medium`/`normal`/`low` and numbers `0`–`4`. The
  `--priority` help text on every subcommand was updated to match.

## [1.5.0] — 2026-05-07

Two unrelated additions this release: OAuth 2.0 authentication, and a
migration path off the legacy single-file config layout.

### OAuth 2.0 (PKCE) authentication

A parallel to personal API tokens. Run `el-linear init oauth` to register
a Linear OAuth app, walk through the PKCE consent flow in your browser,
and persist tokens to `~/.config/el-linear/<profile>/oauth.json` (mode
0600). Access tokens auto-refresh in the background; refresh-token
failure surfaces as a clear "re-run `el-linear init oauth`" error.
Personal-token auth is unchanged and remains the default.

- `el-linear init oauth --revoke` — revoke stored OAuth tokens and remove
  `oauth.json`.
- `el-linear init oauth --no-browser` — force the headless paste-the-code
  fallback (for SSH sessions, sandboxed containers, etc.).
- `el-linear init oauth --port <n>` — override the localhost callback port
  (default 8765).
- Multi-select scope picker for the eight Linear OAuth scopes; defaults to
  `read`, `write`, `issues:create`, `comments:create`.
- `GraphQLService` now accepts either a personal API token or
  `{ oauthToken }`, sending the right `Authorization` header shape per
  Linear's docs (no `Bearer` prefix for personal tokens; `Bearer ` for
  OAuth).

### Legacy config migration

This release closes the gap between the legacy single-file config layout
(v1.0–1.3) and the named-profiles layout introduced in 1.4. Users who
upgraded with a legacy `config.json` still on disk but no usable token
were hitting a dead-end "Authentication required" error with no
documented recovery path. 1.5 detects that state automatically and ships
a one-shot migration command.

- **`el-linear profile migrate-legacy`** — copy the legacy
  `~/.config/el-linear/{config.json,token}` into a named profile in one
  step. Validates the token via `viewer { ... }` before writing anything
  to disk. Each step (profile dir, config copy, token write,
  active-profile marker) is independently idempotent. Token sources, in
  priority: `--token-from <path>`, `EL_LINEAR_TOKEN` env, hidden
  interactive prompt. Refuses to clobber a differing existing config or
  token unless `--force` is passed (and confirms interactively unless
  `--yes` is also passed). Never deletes the legacy files — rollback is
  always available.
- **Legacy-config drift detection** — when an auth call would otherwise
  fail with "No API token found", el-linear now checks for the
  post-upgrade drift state (legacy `config.json` present, no token, no
  profiles) and emits a one-shot stderr hint pointing the user at
  `migrate-legacy`. The hint also catches the related "broken
  active-profile pointer" case (`active-profile` names a profile whose
  dir doesn't exist) and points at `el-linear profile use`.
- `EL_LINEAR_SKIP_MIGRATION_HINT=1` — silences the hint for users who've
  decided to stay on the legacy single-file layout intentionally. Read at
  emission time so toggling it between commands works.

### Notes
- The migration hint is rate-limited to once per process and writes to
  stderr only, so machine callers parsing JSON on stdout are not affected.
- The underlying auth error still fires after the hint, so scripts continue
  to see the same non-zero exit code and parseable error payload.

## [1.4.0] — 2026-05-07

This release adds named **profiles** so you can switch between multiple Linear
workspaces without juggling tokens or config files. It also introduces an
`AGENTS.md` for OpenAI Codex compatibility (parallel to the existing
`CLAUDE.md`).

### Added
- **Profiles** — store multiple `(token, default team, workspaceUrlKey)`
  triples under `~/.config/el-linear/profiles/<name>/` and switch via
  `--profile <name>` or the `EL_LINEAR_PROFILE` env var. Useful for clients
  / contractor work / personal vs corporate accounts.
- `AGENTS.md` — Codex-format guidance (mirrors `CLAUDE.md`).

## [1.3.0] — 2026-05-06

This release adds `el-linear refs wrap`, a stdin/stdout filter that turns bare
Linear issue identifiers in arbitrary text (release notes, Slack drafts,
meeting notes, etc.) into real links.

### Added
- `el-linear refs wrap` — read text from stdin (or `--file <path>`) and rewrite
  every recognized Linear issue identifier as a link, validated against the
  workspace. Unresolvable IDs (e.g. ISO codes) are left as plain text.
- `--target markdown` (default) emits `[DEV-123](https://linear.app/...)`.
- `--target slack` emits Slack mrkdwn `<https://linear.app/...|DEV-123>`.
- `--no-validate` skips workspace validation and wraps every regex match;
  prints a stderr advisory so the warning can be redirected separately from
  the rewritten stdout stream.

### Changed
- `wrapIssueReferencesAsLinks` now accepts an optional fourth `target`
  argument (defaulting to `"markdown"`) and protects existing Slack-style
  `<url|label>` links from re-wrapping. Existing callers (`issues
  create/update`, `comments create/update`) keep their previous behavior.

## [1.2.0] — 2026-05-06

This release adds the interactive setup wizard, `el-linear init`, plus a
documented configuration schema so any LLM or script can produce an
equivalent config without running the prompts. It also reverts the
in-progress rename to `@enrichlayer/linctl` (never published) — the
package stays at `@enrichlayer/el-linear` because of an npm name
collision with [dorkitude/linctl](https://github.com/dorkitude/linctl).

### Reverted rename

The `1.1.0` migration recipe (renaming to `@enrichlayer/linctl`) is
withdrawn. The shipped name and binary remain `el-linear`. For users who
followed the migration locally during the brief window where the rename
was on `main`:

- `~/.config/linctl/` is read as a legacy fallback if `~/.config/el-linear/`
  is empty. Move it back at your leisure.
- `LINCTL_DEBUG` is honored as a legacy alias for `EL_LINEAR_DEBUG`.

### Added
- `el-linear init` — full setup wizard. Skip is the default at every prompt;
  only the API token is required.
- `el-linear init token` — set or replace the Linear API token (validates
  by calling `viewer { ... }` before saving).
- `el-linear init workspace` — pick a default team, refresh the team UUID
  cache, fetch `workspaceUrlKey` from `viewer.organization.urlKey`.
- `el-linear init aliases` — walk Linear users one-by-one, with a 4-way
  per-user menu (keep / edit / append / clear) plus quit-and-resume.
  Progress is persisted to `~/.config/el-linear/.init-aliases-progress`.
- `el-linear init aliases --import users.csv` — batch import aliases and
  GitHub / GitLab handles from a CSV.
- `el-linear init defaults` — default labels, status defaults, term
  enforcement rules.
- `docs/configuration.md` — full config reference. Documents what each
  wizard step writes so the config can be authored programmatically.

### Idempotency
Every wizard step reads existing config first, shows the current value,
and defaults the prompt to "keep as-is". Running the wizard twice with no
input changes produces a byte-identical `config.json` (keys are sorted on
write).

## [1.1.0] — 2026-04-30

This release renames the package from `@enrichlayer/el-linear` to
`@enrichlayer/linctl` ahead of an open-source release. It generalizes the
internal feature set, removes brand-specific defaults, and ships a Claude
Code skill with the package.

### Added
- Bundled Claude Code skill at `claude-skills/linear-operations/` — included
  in the published tarball so consumers can symlink it into their projects.
- `terms: TermRule[]` config key — multi-rule term enforcement (replaces the
  single-rule `brand: { name, reject }`). The legacy shape auto-migrates with
  a deprecation warning.
- Optional `workspaceUrlKey` config key to override the workspace slug used
  when wrapping issue references as markdown links. When omitted, linctl
  fetches it from `viewer.organization.urlKey` once per session.
- `LINCTL_DEBUG=1` env var enables debug stack traces (the legacy
  `EL_LINEAR_DEBUG` is honored as a fallback for one release).

### Changed
- **Renamed binary**: `el-linear` → `linctl`. Update your shell scripts and
  any CI invocations.
- **Renamed package**: `@enrichlayer/el-linear` → `@enrichlayer/linctl`.
- **Renamed config dir**: `~/.config/el-linear/` → `~/.config/linctl/`. If
  you have an existing config there, copy it (or symlink the new path to
  the old file).
- The `brand-validator` module is now `term-enforcer` with a more general
  multi-rule shape. Existing `brand: { name, reject }` configs are auto-
  migrated on load.

### Removed
- Hardcoded `verticalint` workspace URL key. Use `config.workspaceUrlKey`
  to override, or rely on the runtime API lookup.

### Migration

```bash
# 1. Move config (or set up a symlink — both work)
mv ~/.config/el-linear ~/.config/linctl

# 2. Re-link your CLI (if you used npm link locally)
cd path/to/linctl && npm link

# 3. Update aliases / scripts
sed -i.bak 's/\bel-linear\b/linctl/g' your-scripts.sh
```

The legacy `brand` config block is auto-migrated to `terms[]` on first run.


[Unreleased]: https://github.com/enrichlayer/el-linear/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.7.0
[1.6.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.6.0
[1.5.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.5.0
[1.4.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.4.0
[1.3.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.3.0
[1.2.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.2.0
[1.1.0]: https://github.com/enrichlayer/el-linear/releases/tag/v1.1.0
