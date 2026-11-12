# Postgres-first refactor — handoff

> Working document for whoever coordinates next (a new Claude session, or this one after a
> usage reset). Kept current by the coordinator. **Delete this file before the branch is
> merged to `main`.** Last updated: 2026-11-12 21:00 CET.

## 1. What this is

Francesco asked (2026-11-12) for the spec in [POSTGRES-FIRST.md](POSTGRES-FIRST.md) Part I to
be implemented completely and production-ready across the monorepo and the cloud control
plane, by a coordinator running many Opus agents, without stopping while he is away.

His instructions, in his words (all still in force):

- "EVERY SINGLE THING MUST BE PRODUCTION READY, backend, cms, tests, rebase cloud, ABSOLUTELY
  EVERYTHING, NO STOPPING AND NO EXCUSES. In case of doubt be proactive … we can do adjustments
  later, just let me know where u are not sure. Also, you can break backwards compatibility
  everywhere."
- "keep in mind u need to update docs and skills too. Also where u are totally sure this is
  perfect and super tested, I want a release on npm, and for you to update all self hosted and
  cloud projects too."
- "I also trust your criteria to make changes on the go if necessary."
- "the goal is to make this perfect for the future, no matter what we break now, just have a
  clear migration path for existing projects, its only a few and we run them all … you can
  also spin agents to clean up space if needed."
- "yes rename to table, go for it" — the BaaS layer says *table* everywhere a user sees it
  (SDK `data.table()`, MCP `list_tables` / `query_table` / `*_row`, `policy.existsIn({ table })`);
  *collection* stays the CMS's word.
- "in case you get close to running out of tokens, write a clear handoff document for the
  next agent" — this file.

## 2. Hard rules

- Work only in the worktree `/Users/francesco/rebase/.claude/worktrees/pgfirst`, branch
  `feat/postgres-first-baas` (from `main` 7081747fad). The cloud control plane is a second git
  repo at `<worktree>/saas`, same branch name. `main` is untouched in both. Never touch the
  primary checkout `/Users/francesco/rebase` or other worktrees.
- **No push, tag, publish, deploy, `saas/scripts`, `kubectl`, `gcloud`** until every release
  gate in section 9 holds. The release authorization is conditional ("where you are totally
  sure this is perfect and super tested"). If any gate is red or anything is uncertain: do
  not release — report the exact state instead.
- Never change the user's local environment: no `.env` edits, no creating or dropping
  databases or roles on the local Postgres. Tests use the suites' own Docker containers,
  PGlite, or a throwaway Docker Postgres.
- pnpm only. No `any`, no structural casts. Scripts go in `tooling/scripts/`.
- No compatibility layers or aliases. The migration path is the codemod
  (`rebase migrate collections-to-tables`, `rebase migrate sdk-calls`) plus a per-project upgrade.
- Every deviation from the spec is written into [POSTGRES-FIRST.md](POSTGRES-FIRST.md) Part II and
  listed in the final report. Reports to Francesco: plain words, result first, readable on a
  phone, no commit hashes. Never call the CMS/admin panel "optional" in public or marketing copy.

## 3. Where everything is

| What | Where |
|---|---|
| Spec (Part I) + decisions and checklist (Part II) | `docs/plans/POSTGRES-FIRST.md` |
| Coordinator's running state (dense log, every slice with commits and leftovers) | `~/.rebase-audits/pgfirst/PLAN.md` — read the SNAPSHOT section first |
| Rules every builder agent reads first | `~/.rebase-audits/pgfirst/AGENT-RULES.md` |
| Stage B contract (model, transition rule, fixture rule, slice table, "As built") | `~/.rebase-audits/pgfirst/STAGE-B.md` |
| Agents' append-only started/done log | `~/.rebase-audits/pgfirst/LEDGER.md` |
| Every brief and follow-up message sent so far (reusable) | `~/.rebase-audits/pgfirst/briefs/` (`INDEX.txt`) |
| Nine area maps written by explorer agents (the knowledge base) | `~/.rebase-audits/pgfirst/reports/*.md` |
| Contract notes for docs/skills/cloud | `~/.rebase-audits/pgfirst/{contract-changes-1,docs-forward-list,mcp-rename-table,sdk-rewrite-rules,s6-tablepatch}.md` |
| Private-index commit script, lock script | `~/.rebase-audits/pgfirst/{commit-mine.sh,locked.sh}` |
| Scratch space per slice | `~/.rebase-audits/pgfirst/tmp/<slice>/` |
| CHANGELOG draft (20 Breaking bullets, coupled to the upgrade guide) | `~/.rebase-audits/pgfirst/tmp/d3/changelog-unreleased.md` |
| Full transcript of the coordinating session | `~/.claude/projects/-Users-francesco-rebase/63cf3b54-039d-45e5-b7eb-787c8bed33f4.jsonl` |

## 4. How the work is run

- One coordinator, up to ~8 live Opus builder agents in the **same worktree**. Each owns a
  set of files named in its brief. They commit through `commit-mine.sh oss|saas <msg-file>
  <patch>` (a private index, so nobody sweeps in someone else's hunks) and serialise heavy
  commands through `locked.sh tsc|build|e2e|install <command>`.
- Brief pattern that works (copy one from `briefs/`, e.g. `057-stage-b-model-seam-r1.md`):
  what to read first → the slice goal → numbered deliverables with exact files → boundaries
  (own / do not touch / who else is live where) → exact proof commands → report format.
  Always `model: opus`, `subagent_type: general-purpose`.
- After each report: update `PLAN.md` (slice line: done + commits + what it left), route its
  findings to an owner, launch what it unblocked, tell Francesco in plain words.
- Oracles that must never move: `pnpm --filter @rebasepro/server-postgres test -- plan-golden
  descriptor-plan-agreement sdk-equivalence plan-from-definitions custom-sql-types` and
  `pnpm check:derived-names` (414 identifiers). Goldens are never re-recorded to make a
  change pass.

Lessons learned the hard way:

- Give a new big slice to a **fresh** agent. An agent that already did two slices runs out of
  context mid-way (the planner agent did; it handed back cleanly).
- Never call `ListAgents` (it lists ~180 unrelated sessions). Use the ledger, `git log`, and
  completion notifications.
- The shell's working directory resets to the primary checkout between commands: start every
  command with `cd /Users/francesco/rebase/.claude/worktrees/pgfirst`. Read git with
  `git -c core.fsmonitor=false`.
- A repo hook runs the deploy preflight on any shell command whose *text* looks like a
  deploy or release, and blocks it (the preflight is red today, see section 8). Write notes
  with the file tools, not shell heredocs that contain such words.
- Builds wipe `dist/` of the package they build while other agents' tests may read it. Before
  any final verification, rebuild every `dist` from one consistent tree.
- Commit pairs can leave HEAD not building in between (shared tree). Judge a slice by its
  package's suite and its own files, and do a whole-tree pass at the end.

### If you are a NEW session (the agent ids below do not resolve for you)

The running agents died with the old session. Recover like this:

1. `cd` to the worktree; `git -c core.fsmonitor=false log --oneline -40` and
   `tail -40 ~/.rebase-audits/pgfirst/LEDGER.md` show what each slice committed.
2. `git -c core.fsmonitor=false status --short` (also in `saas/`) shows uncommitted work a
   dead agent left. Read the diff per file. For each slice in section 6: relaunch it with a
   fresh agent using its saved brief from `briefs/`, adding one paragraph: "a previous agent
   started this slice and stopped; its commits are X, its uncommitted edits are in files Y —
   review them, keep what is right, finish the slice".
3. Re-create the 30-minute heartbeat (`CronCreate "17,47 * * * *"`, prompt in `PLAN.md`), it
   is session-only.

### If you are the SAME session after a usage reset

Resume each agent listed in section 6 with `SendMessage(to: <agent id>)`: "limit reset —
re-check `git status`/`diff` in the worktree, finish the edit in progress, continue your slice".

## 5. What is done (Stage A — the new front door, everywhere)

All committed on the branch (≈150 commits OSS, 12 in `saas`). Details per slice in `PLAN.md`.

- **Authoring**: `defineTable` / `defineAuthTable` / `defineView`, `col.*`, `json.*`, `rel.*`,
  mandatory `rls`, hooks, inference types — `packages/types/src/schema/`. Compiler to
  `TableDescriptor` in `packages/common/src/schema/`. `col.custom(sqlType)` planned end to end.
- **Backend**: loader for `backend/schema`, boot options `tables`/`defaultRls`/`schemaDir`/`hooks`,
  bundle format 3 / runtime contract 2, `GET /api/schema/tables` with per-caller redaction,
  schema editor writing `backend/schema` (`TablePatch`), introspection producing tables,
  MCP on descriptors with renamed tools, MongoDB driver retired.
- **Golden proof**: SQL, policies, triggers, views and the generated SDK are byte-identical
  to `main` for the whole corpus (demo, templates, 100 real schemas, the control plane).
- **CMS**: collections projected from served tables, `customizeTable`, `<RebaseCMS
  tableCustomizations externalCollections>`, Firestore via `defineFirestoreCollection`,
  Studio on descriptors, collection editor on `TablePatch`, presentation saved as UI preferences.
- **SDK/vocabulary**: `data.table()`, table error codes, rule vocabulary `table`.
- **CLI**: every command on the new layout, `rebase init` templates (BaaS-only and BaaS + CMS),
  `rebase migrate collections-to-tables` and `rebase migrate sdk-calls`.
- **Projects migrated in-repo**: demo `app/`, templates, `examples/sdk-demo`, new
  `examples/hybrid`, plugins, rls-check, recipes, and the cloud control plane (`saas`, 35
  tables; its database is identical before/after; boots; nothing deployed).
- **Docs and skills**: English docs rewritten (schema pages, CMS pages, backend, SDK, CLI,
  upgrade guide `upgrading/0-30-to-0-31`), READMEs, all 24 agent skills, `AGENTS.md`,
  `.agent/workflows`.

## 6. What is running right now (2026-11-12 21:00 CET)

The Mac restarted at 20:18; every agent was resumed with its uncommitted work intact.

| Agent id | Slice | What it is doing |
|---|---|---|
| af7441a6d4e778f74 | B-R1 | Stage B foundation: `CompiledTable`, `compileSchema`, helper library `packages/common/src/table/**` (landed), then the driver's `RuntimeTable` + `PostgresTableRegistry`, keys, soft delete, auth-table shape. **Gate for B-R2…B-R7.** |
| a13b24403aa3df57d | B-PLAN-2 | Planner core, in six small committed steps (LEDGER lines "B-PLAN-2 step N done"): 1 flip `planSchema` input to `CompiledTable[]`; 2 table-level facts; 3 columns + relations; 4 remove the internal lowering; 5 fold `plan-equivalence` into `plan-golden`; 6 consumers + renames. The policy compiler part is done (3951d9d5f1). |
| adfe8ce0e7e1e57a1 | B-S4a | Server REST, write validation, OpenAPI, history on descriptors; makes the six pending validation features real. |
| a6f8ea3adac490c1f | B-S4b | Server storage (done), MCP data path (done), then auth/admin users, global hooks, crons, boot on compiled tables. Owns `mcp/mcp-tools.ts`, `mcp/mcp-routes.ts`. |
| ac54e4a50895b092b | DOCS-2 | Sidebar, redirects, generated files, marketing pages (landed), CHANGELOG paste, docs fixes, UI-preferences and verify docs. |
| a07845201a2f4f49c | CLI-2 follow-up | Codemod creates and wires `frontend/src/cms/ui-config.json` for migrated projects. |

Finished since the first version of this file: collection editor + UI preferences (contract:
`~/.rebase-audits/pgfirst/ui-preferences-contract.md`), agent skills incl. the rename to
`rebase-tables`, CLI-2 (`rebase verify` reads the CMS layer: `~/.rebase-audits/pgfirst/cli-2-verify-cms.md`),
leftover packages (plugins, rls-check, examples, recipes), the cloud control plane.

Briefs: `briefs/` (`INDEX.txt`; re-run the extraction snippet in `PLAN.md` history if newer
briefs are missing). Idle agents that can be resumed for small follow-ups in their area are
listed in `PLAN.md` ("IDLE BUT WARM").

## 7. What is left, in order

**Stage B — the internals read tables, not collections** (required: Francesco wants it
"perfect for the future"). Contract: `STAGE-B.md`. Runtime map and slice table:
`reports/pg-runtime.md` §4.

1. When B-R1 reports, launch in parallel (fresh agents, briefs modelled on `060`/`062`):
   - **B-R2 codecs**: `data-transformer.ts`, `row-pipeline.ts` (codec half), `field-op-sql.ts`,
     aggregates, pivot serialisation — keyed on `ColumnType`.
   - **B-R3 write path**: stamps, defaults, key immutability in the driver and
     `PersistService.ts`; adds nested json user/time stamps (new). Then **B-R5 hooks** in the
     same driver file (serialise R3 → R5): `TableHooks` + transforms native, one `afterRead`
     chain (realtime re-implements it twice today), `open-rebase.ts`, `cli-console.ts`
     (the console still exposes tables as `collections`).
2. After B-R2: **B-R4** field access + search; **B-R6** relations (targets by slug;
   implements `hasMany.orderBy`, the last pending feature).
3. **B-R7**: driver/boot inputs are `CompiledTable[]` (`openRebase`, `openPostgresDriver`,
   `ProvisionOptions.collections`); the `DataDriver` contract and socket frames say table/rows
   (`subscribe_collection`, `listenCollection`, `fetchCollection` …) across types, client,
   server, driver; offline queue `PendingMutation.collection` migrates with
   `QUEUE_SCHEMA_VERSION 2`. B-S4a/b leave one named seam per area for this cut.
4. **B-VM**: the server stops emitting the admin view-model envelope (`{__type:"date"}`,
   relation refs) on the socket refetch; the CMS builds it from the wire row + descriptor
   (Part II D). Read memory `rows-canonical-architecture` first.
5. **B-K7**: view-model types and helpers (`Property`, CMS `CollectionConfig`,
   `CollectionRegistry`, `util/entities` view-model half …) move from `types`/`common` to
   `@rebasepro/cms-types`/cms by a scripted import rewrite; Firestore types to
   `@rebasepro/firebase`. Fix the one `as AdminCollection` in `registeredCollection`.
6. **B-K8**: delete `lowerTables`, lowered collections, `defineCollection`, legacy types from
   `@rebasepro/types`. The lift (`collectionsToTableDefs`) survives only as migration tooling
   (the codemod's core) under a `@rebasepro/common` migration subpath with its own frozen copy
   of the pre-0.31 model. Then bank the API surface.
7. **CLOUD-2**: `saas` follows the Stage B renames (two of its tests are red on the registry
   rename already); re-run its suites and the throwaway-Postgres boot.
8. Optional, if budget allows; otherwise tell Francesco: scripted conversion of the ~550
   test files that still hold legacy collection literals (they go through the lift today and
   double as its regression suite).

**Stage A tail**

9. **T8 e2e lanes** on the new layout (`pnpm ci:e2e --lane cli|admin|selfhost|vitest`; specs
   under `tests/e2e` still write `app/config`; `cli-init-e2e`). Start when C6+C5 has reported
   and all `dist` are rebuilt.
10. **Docs final pass** after Stage B: reworded error messages (each Stage B report lists
    old → new), `openRebase`/driver inputs (docs currently show the `lowerTables` bridge with a
    caution), remaining `verify:docs:strict` findings, then translations — see the
    TRANSLATIONS note in `PLAN.md` (repo script `website/scripts/translate_docs.mjs`, dry run
    first; fallback: delete stale locale twins and say so).
11. **Gates final pass** (resume or re-brief from `briefs/` "gates"): second API-surface
    banking, bundle budgets (several chunks over budget — look at why before banking), casts
    baseline, `check:names` exemption for dated audit records, a format-3 bundle fixture for
    `verify:corpus`, audit-coverage entries, **retarget `tooling/scripts/harness/checks/config-build.mjs`**
    (it still compiles the deleted `saas/config`; it is on the deploy preflight), jsdoc coverage.

**Finish**

12. Rebuild all `dist`; fresh-install clean worktree; `./tooling/scripts/verify-quality.sh`;
    every `pnpm ci:e2e` lane; `saas` backend + console suites and tsc; `pnpm verify:docs:strict`.
13. Independent review agents with fresh eyes, given code not conclusions: (a) security —
    RLS fail-closed, redaction of `/api/schema/tables`, field access on every door; (b) parity
    against the spec's §7 capability table (zero loss of functionality); (c) the codemod on
    the real projects. Fix what they find.
14. Fill Part II section F (checklist) and add a section G with the decisions taken while
    building (list in `PLAN.md`, "DECISIONS TAKEN WHILE BUILDING"). Finalise `CHANGELOG.md`.
    Delete this handoff file. Final report to Francesco.
15. Release and rollout — only under section 9.

## 8. Known red or open right now

- The deploy preflight fails (stale `config-build` check; and it reports the lockfile as
  modified in a worktree although `git status` is clean — find out what it compares).
- `pnpm check:bundle` over budget on several chunks; `check:casts` wants reductions banked;
  `check:audit-coverage` needs entries; `check:jsdoc-coverage` 11.6% vs 5%.
- `check:templates` / `check:template-pins` are red on unreleased imports until the tag exists;
  verify with `--released-as 0.31.0`. The version is **not** bumped (the release script bumps).
- `examples/*` and the tree as a whole do not typecheck while Stage B agents are mid-edit.
- `packages/cli` `dist` is stale (the built bin does not know `migrate`): rebuild before e2e.
- Persisted formats still saying "collection" on purpose until B-R7 decides each:
  offline queue, `keyTargets.collections` (keep), log field + Prometheus label (rename only
  with dashboards/alerts), saved-apps column `collections` (kept).

## 9. Release and rollout — gates (all required, in this order)

1. The whole spec is done: every line of Part II F ticked, Stage B finished. If a part is
   consciously left out, it is not a release — report.
2. Clean worktree, fresh install: `verify-quality.sh`, every e2e lane, `saas` suites + tsc,
   docs gates all green; docs and agent skills updated.
3. The independent reviews report no open high or critical finding.
4. Before touching any project's database: codemod run on its source, and the generated
   SQL + policies diffed against what its database holds — empty, or only reviewed, intended
   changes. Back up first.
5. Land on `main` in both repos, push, CI green on that exact commit.
6. Read before acting: `.agent/workflows/deployment.md` and the memory notes
   `stable-release-gates-and-traps`, `npm-one-trusted-publisher-per-package`,
   `runtime-release-rollout-recipe`, `saas-deploy-runbook`, `fleet-upgrade-0-29`,
   `fleet-rebuild`, `agent-cannot-deploy-control-plane`, `rebase-apps-inventory`,
   `control-plane-runs-ahead-of-published-clients`, `contract-safety-gates`. Follow them
   exactly; anything they reserve for Francesco (secrets, `kubectl` patch, registry setup) →
   stop and hand over.
7. Order: npm release (`release.sh 0.31.0` after `pnpm write:api-surface`) → runtime image →
   control plane (it must accept runtime contract 2 before any new runtime ships; it refuses
   old bundles) → cloud projects one at a time, least critical first, health-checked after
   each, rollback point before each → self-hosted apps from the inventory, one at a time.
   Per tenant: codemod dry run → real run → commit → build → upload → schema push dry run
   shows no changes → roll onto the new image.
8. Never widen this: no other releases, no unrelated deploys, no destructive database change
   the plan diff did not show and a review did not accept.

## 10. Things to tell Francesco (keep current; goes into the final report)

- Everything is on a branch in both repos; nothing pushed or deployed.
- Deployed projects must be rebuilt after the codemod; the control plane must ship first.
- Names added beyond the spec are marked "(gap)" in Part II B; decisions taken on the way are
  in `PLAN.md` (test fixtures through the lift; the lift kept as migration tooling; MCP naming
  choices; bare `access: "authenticated"` now means any signed-in caller; geopoint stays
  `{latitude, longitude}`; integer-width foreign keys accepted; rls-check agent format v2).
- Translations: plan is to regenerate the five locales with the repo's own script and the
  Gemini key already configured for it (public docs text, small cost); else English fallback.
- ~550 test files still describe fixtures in the old vocabulary (not user-facing).
- Usage: weekly limit was at 41% on Thu 20:15 CET, burning ~5%/h with 7–8 agents; it resets
  Sun 2026-11-15 08:00 CET. Before ~90%: launch nothing new, let agents commit, update this
  file and `PLAN.md`.
