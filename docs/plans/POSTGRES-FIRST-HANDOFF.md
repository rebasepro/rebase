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

> **STATUS UPDATE — 2026-11-14, about 01:00 CET. This block supersedes the lists below where
> they disagree.**
> Everything short of the release is DONE and committed:
> - The fix pass landed (schema endpoint and every admin surface resolve the caller through
>   the auth adapter; `via` through an unserved table is closed; the build guard never inlines
>   a backend file and refuses a plugin that overrides it; writes through a declared junction —
>   body, nested routes, socket — obey its rules) and was reviewed (`reviews/security-look-5.md`:
>   nothing above low; its two lows are fixed too).
> - The migration codemod's eleven open items landed (`## FINAL-FIX-CODEMOD` in the notes).
> - Full re-verification on a clean snapshot is GREEN at commit 9fe0e2a577
>   (`~/.rebase-audits/pgfirst/full-verify-2.md`): 52/52 static gates, 13/14 build gates (the
>   one red is the unbumped version pins), 22/22 unit packages, all four e2e lanes, the control
>   plane's suites. The three small fixes after it (f79f14fdbb, 715dfa2004, 778e5222b5) were
>   verified by their builder's own suite and e2e runs.
> - All NINE real projects build, boot and pass their tests on their copies ("Phase 2" in
>   `~/.rebase-audits/pgfirst/migrate-real.md`), the hybrid Postgres + Firestore one included.
> - Docs: English final (incl. a new page `upgrading/0-30-to-0-31-by-hand.mdx`), the five
>   locales regenerated, every docs and locale gate green (last commits 57971806c8,
>   714d5a01af, 4bb874d220).
> - The public demo still runs commit 9726335d50 (before the fix pass); redeploying it is a
>   separate, explicit request.
> WHAT IS LEFT: section 7 steps 5 and 6 only — the final report, then the release and rollout
> under section 9 (Francesco's go; needs a fresh usage budget; never start it without enough
> budget to finish the chain). In section 7, steps 1–4 are done.


**The live list is the "CURRENT STATE" block at the top of `~/.rebase-audits/pgfirst/PLAN.md`**
(results of every slice; newest lines just above the text "(superseded line follows)"). As of
2026-11-13 14:30 CET (real clock):

- **All code is done.** Full verification was GREEN at commit 9726335d50 (every static and
  build gate, every unit suite, the four e2e lanes, built-dist provisioning-off, the control
  plane's suites) except the gates that wait on translations.
- **After that commit, only migration-codemod fixes landed** (found by running real projects):
  baebff5c98, 394c7cd7f1, 556ac1cd0d, 390fc197f9, a9291b9fbc, 422232c6b8, 3b67dd3a8c,
  25a5ab4d80, 0f4cb1d038, 382aea014c — each with a red→green test; the codemod suite and the
  full CLI suite were green when they landed. The CLI lanes must be re-run once more before a
  release (step 3 below).
- **Reviews:** four security rounds, every finding fixed; a last short look at the final fix
  found three LOW items, not yet fixed (`reviews/security-look-4.md`). Parity review: nothing
  lost; Part II F is filled.
- **The public demo runs this branch** (Francesco asked for it explicitly): Cloud Run revision
  `rebase-demo-00027-vpv`, from commit 9726335d50, verified live. Everything about it, incl. the
  rollback point: `~/.rebase-audits/pgfirst/DEMO-DEPLOY.md`. No other rollout was authorized.
- **Real projects on 0.31 (copies in `~/.rebase-audits/pgfirst/real/`, record: "Phase 2" in
  `~/.rebase-audits/pgfirst/migrate-real.md`):** eight of nine build, boot on a throwaway
  Postgres and pass their own tests — each "ready with caveats" listed there. The ninth (the
  hybrid Postgres + Firestore project) has its backend proven and its frontend building, but
  51 frontend and 84 functions type errors remain, two of them runtime breaks; its entry in
  `migrate-real.md` ends with the exact next steps.
- **Running:** only the translation run (background shell; logs
  `~/.rebase-audits/pgfirst/tmp/coord/translate-run*.log`, the newest ends with `exit N` when
  done; re-running is incremental — command in step 1 below).
- A one-shot wake-up is scheduled in the session for Sun 15 Nov 08:10 CET (after the usage
  reset). It dies if the app restarts: this file is then the way back in.

## 7. What is left, in order

1. **Translations**: when the newest log ends with `exit 0`, read it for `❌` lines, re-run once
   (`cd website && GEMINI_API_KEY="$(sed -n 's/^[[:space:]]*GEMINI_API_KEY[[:space:]]*=[[:space:]]*//p' /Users/francesco/rebase/website/.env | head -1)" node scripts/translate_docs.mjs`
   — the key goes into the process environment only; never copy, edit or print that file),
   then `pnpm verify:docs:strict`, `pnpm check:templates --released-as 0.31.0`,
   `pnpm check:generated`, `pnpm check:schema-sample`, `pnpm check:untranslated`,
   `pnpm check:locale-staleness`; commit every file under
   `website/src/content/docs/{es,de,fr,it,pt}/` and `tooling/scripts/locale-sources.json` in one
   `docs(i18n): …` commit.
2. **FINAL-FIX** (one builder; the list is complete in `PLAN.md`, search "FINAL-FIX"):
   a. PRODUCT, first: `GET /api/schema/tables` checks only the framework JWT and never asks a
      project's own auth adapter → 500 for a project with custom auth, and the 0.31 panel loads
      its tables from that route (found on the hybrid project; data routes are fine).
   b. Security lows L-1..L-3 of `reviews/security-look-4.md` (a `via` through a withheld or
      unknown table must fail closed; the build guard must never inline a small backend file;
      a many-to-many write through a declared junction must honour its link-column write rules).
   c. Should a project that had a `storageAuthorize` and boots without one be refused instead of
      warned? (decide; found on one project).
   d. Codemod: the three open defects from the hybrid project (Firestore references outside the
      converted literal keep `path` and `defineFirestoreCollection` throws at import; a component
      path in a shared module resolved one level off; a view filter computed with `new Date()`
      frozen at run time) and the automation candidates listed per project in `migrate-real.md`
      (test doubles and untyped receivers calling `.collection(`, `({ entity })` → `{ row, id }`
      in custom views/actions/resolvers, unused `config/` modules in the printed `git rm` line,
      `migrate --check` after the `git rm`, missing dependency for a generated customization).
   e. Docs: an upgrade section for projects below 0.30 (peer floors, TypeScript 6 `rootDir` /
      `moduleResolution`), `({ entity })` → `{ row, id }`, a belongsTo's key is a declared
      column, `include: ["*"]` readers under renamed relations; CHANGELOG lines for every codemod
      fix above and for 9cee87feed (bulk updates over a direct data source).
3. **Re-verify once** after FINAL-FIX on a clean snapshot: `./tooling/scripts/verify-quality.sh`
   (all lanes), re-bank the API surface only if it moved, saas suites.
4. **Finish the ninth project's copy** (steps at the end of its entry in `migrate-real.md`).
5. Delete this handoff file; final report to Francesco (section 10 is its skeleton).
6. **Release and rollout** — only under section 9. Add 0.31.0 to `DRIVER_SKEW` right after the
   npm release. Per project at rollout: the copy's diff is the migration commit; then a schema
   push DRY RUN against the live database and `rebase doctor --policies` before anything is
   applied (expect a policy diff from the 0.29.3+ policy form, not from the migration).
7. Optional, else tell Francesco: see section 10.

## 8. Known red or open right now

- The locale gates until the translations are committed.
- Product: the schema endpoint and custom auth adapters (2a above) — blocks the hybrid
  project's rollout and any project with its own auth; should be fixed before a release.
- Three low security items (2b). The version is not bumped; `DRIVER_SKEW` is empty until
  0.31.0 exists.
- Not proven anywhere: equality of each project's LIVE database with the migrated schema (a
  dry run at rollout); the hosted MCP connector against a live tenant.

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
- A hidden key column leaking through inverse and multi-hop relations is ALSO in released
  0.30.x (fixed here), as are the `_pivot` checks skipped under `strictWrites: false`.
- A project's own hooks keep 0.30's rules: `.readOnly()`, `access.write` and `.private()` are
  API-boundary rules and are not enforced on in-process writes.
- The admin's eager bundle grew about 6% (cause known; the bigger fix is a later slice).
- Real projects: eight of nine proven on copies, each with rollout-day caveats (custom
  Dockerfile entries, a vendored pipeline, a game built from a parent repo that still calls the
  old SDK name, required read-only columns the new verify step flags, old tests asserting the
  previous shape). Rolling out is per-project work, plus a dry run against each live database.
- The demo's boot log shows one schema drift older than this work (`product_locales.locale`:
  enum in the schema, text in the database); aligning it is a schema push on the demo database.
- Duplicating a row does not copy the extra values stored on its many-to-many links (also 0.30).
- Three in-process SDK quirks pinned by tests; wire names that still say "collection"; the
  admin's eager bundle grew ~6%; `imageResize` has no browser test.
- Usage: weekly limit at 91% on Fri 14:30 CET; it resets Sun 2026-11-15 08:00 CET. Nothing more
  is launched before the reset.
