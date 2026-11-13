# Postgres-first refactor — handoff

> Working document for whoever coordinates next (a new Claude session, or this one after a
> usage reset). Kept current by the coordinator. **Delete this file before the branch is
> merged to `main`.** Last updated: 2026-11-13 01:30 CET.

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

- **Memory is the hard limit.** The Mac (32 GB) restarted twice (20:18 and ~22:45 on 2026-11-12)
  from memory exhaustion: too many agents ran full test suites, the repo type check and Docker
  suites at the same time (jest defaults to one worker per core). Rules now in `AGENT-RULES.md`
  ("Memory is the hard limit"): at most six agents live, at most three in
  `packages/server-postgres`; every heavy command (full package suite, repo type check, build,
  Docker e2e) goes through `locked.sh heavy …`, which is a single lock; agents run only the
  test files they touched with `--maxWorkers=2`; the coordinator publishes shared baselines in
  `~/.rebase-audits/pgfirst/baselines/` instead of each agent taking its own. Never write
  "baseline the failing set" in a brief again.

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

## 6. What is running right now, and what is next

**The live list is the "CURRENT STATE" block at the top of `~/.rebase-audits/pgfirst/PLAN.md`**
(agent ids, what each is doing, results of every slice, the queue). It is appended to at every
checkpoint; the newest lines are just above the text "(superseded line follows)". As of
2026-11-13 06:40 CET (real clock):

- Done and committed: all of Stage A; all of Stage B (driver, server, planner, boot, live
  schema editor on compiled tables; lowering bridge deleted; legacy model only in
  `@rebasepro/common/migrate`); ONE read shape and ONE write shape (the backend serves and
  accepts wire rows only; the admin builds and unbuilds its view model in the browser; client
  reviver deleted; offline queue migrated; history normalised); the CMS view-model types and
  value classes moved to `@rebasepro/cms-types`; Drizzle-style columns everywhere; every
  static gate green except `check:test-types`; the final security review (1 high, 1 medium,
  3 low — ALL fixed with tests; three of them also exist in released 0.30.x); the migration
  codemod proven on copies of every real project (no live project blocked; SQL byte-identical;
  no rule changes meaning); English docs, CHANGELOG, upgrade guide, skills, Part II D + G
  current up to here.
- Running: **SDK-ROWS** (the SDK built directly on rows; `Entity` and its accessor leave the
  kernel for the CMS packages; ends with the admin lane), **TEST-TYPES** (brings
  `check:test-types` to or below its baseline by fixing tests; three red/flaky tests), and the
  **translations** (a background shell running `website/scripts/translate_docs.mjs` over 645
  stale or missing locale pages; log `~/.rebase-audits/pgfirst/tmp/coord/translate-run.log`;
  re-running the same command is safe and incremental).
- Notes each slice left for docs and the CHANGELOG: `~/.rebase-audits/pgfirst/stage-b-docs-notes.md`.
  Reviews: `~/.rebase-audits/pgfirst/reviews/` (`security-final.md` is the latest). Migration
  trial: `~/.rebase-audits/pgfirst/migrate-real.md`, copies under `~/.rebase-audits/pgfirst/real/`.
  Gate leftovers: `~/.rebase-audits/pgfirst/final-pass-checklist.md`. Part II F draft (to be
  filled by the parity review): `~/.rebase-audits/pgfirst/part2-F-draft.md`.

The Mac restarted twice on 2026-11-12 (memory). Since then: at most four builders, heavy
commands only through `locked.sh heavy`. Budget rule: about 1% of the weekly limit per
agent-hour; code first, verification last (never verify before the last code slice lands).

## 7. What is left, in order

1. **SDK-ROWS** and **TEST-TYPES** finish. Then regenerate the codemod's import table
   (`node tooling/scripts/codemod/moved-symbols-table.mjs`) if `moved-imports.test.ts` is red.
2. **Docs, last touch**: resume the docs builder (or a fresh one with
   `~/.rebase-audits/pgfirst/tmp/docs-4/running-list.md`) for SDK-ROWS: `packages/common/README.md`,
   Part II G's "Entity pending" line, CHANGELOG / guide wording, the moved-imports page.
3. **Translations**: when the background run has exited, read its log for failures, re-run it
   once English is final, run the locale gates, commit the locale files.
4. **Final banking** (`final-pass-checklist.md`): rebuild every `dist`; `pnpm write:api-surface`
   then `removed-names --write`; `--update` the casts / hooks / unused / untranslated /
   test-types baselines (they only went down); bundle budgets (look at why before banking);
   `check:runtime-image:boots`.
5. **Full verification** on a clean snapshot worktree (detached HEAD, `node_modules` cloned
   with `cp -Rc`, dist built there): `./tooling/scripts/verify-quality.sh`, all four
   `pnpm ci:e2e` lanes, `saas` backend + console suites and tsc, `pnpm verify:docs:strict`,
   the built-dist `provision-off-e2e`.
6. **Independent reviews** (fresh agents, given code not conclusions): parity — fills
   `part2-F-draft.md` line by line and confirms every retired legacy test has a native
   equivalent; a short security DELTA on the write direction, the security fixes and SDK-ROWS.
   Fix what they find.
7. Fill **Part II section F**; finalise `CHANGELOG.md`; delete this handoff file; final report.
8. **Migration phase 2** (fresh agent; copies only until the release): per real project finish
   the manual steps in its copy, typecheck and build against the packed 0.31 packages, boot on
   a throwaway Postgres. The diff becomes that project's migration commit at rollout.
9. **Release and rollout** — only under section 9.
10. Optional, else tell Francesco: names that still say "collection" on the wire (driver
    method names, socket frames, upload fields, offline queue, some JSON keys).

## 8. Known red or open right now

- `check:test-types` red until TEST-TYPES lands. `moved-imports.test.ts` (cli) red while
  SDK-ROWS has uncommitted guard-JSON edits. CLI `bin-output` red until `dist` is rebuilt.
- Locale docs are stale until the translation run is committed (`verify:docs` ≈ 709 findings,
  all locale but two that clear with the docs touch and final banking).
- `pnpm check:bundle` over budget on two chunks (look at why before banking);
  `check:templates` is red on unreleased imports until the tag exists — verify with
  `--released-as 0.31.0`. The version is **not** bumped (the release script bumps).
- `DRIVER_SKEW` is empty until 0.31.0 exists: add 0.31.0 right after the npm release.
- Not yet proven: a server started from built packages with provisioning off; the hosted
  connector against a tenant; `db push` / restore on a database with drifted policies.

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
- The history endpoint served unmasked rows — also in the released 0.30.x (fixed on this
  branch): live projects with history plus masking hooks are exposed until upgraded.
- `.references()` on a column is refused (use `rel.belongsTo`) — the one Drizzle spelling he
  may want flipped. A restore re-stamps policies. `policy-table-agreement` test deleted
  (plan-golden pins the policy SQL).
- Security: the nested-include masking leak, declared tables served with RLS off when
  provisioning is off, relation-key writes bypassing a child key's write rules and the public
  API docs page ALSO exist in released 0.30.x (all fixed on this branch).
- Breaking defaults he may want flipped: a to-one relation written as `{ id }` is now a 400
  (send the key); `/api/docs` follows the schema endpoint's audience (`enableSwagger: true`
  publishes it).
- The fleet's source is pinned at 0.21–0.29 except one project: rollout is per-project
  migration work. One dormant project (pre-0.30 config) needs hand fixes first.
- Translations were regenerated with the repo's script and the Gemini key from the primary
  checkout's `website/.env`, passed in the process environment only.
- Usage: weekly limit at 79% on Fri 06:30 CET; about 1% per agent-hour; it resets
  Sun 2026-11-15 08:00 CET. At 88%: launch nothing new, let agents commit, update this file
  and `PLAN.md`. Verification, reviews, phase 2 and the release fall after the reset.
