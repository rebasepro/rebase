# DX sweep 2026-09-06: tasks

Status: **in progress** (fix agents launched from 06:08 CEST). 168 tasks, 28 P0, 16 workstreams. Source: the second DX sweep, run 2026-09-06 05:12–06:40 CEST
against `main@c3456d4d2` (package version 0.17.3, every dist built from that
commit) by sixteen read-only audit agents, one per surface. Reports:
the sixteen audit reports (one per surface) in the session scratchpad and the published HTML report. The sweep re-verified
yesterday's 183 findings (2026-09-05) and re-ran the 195 acceptance checks of
`docs/plans/dx-sweep-2026-09-05-tasks.md`; the tasks below are what is still
wrong, what yesterday's fixes broke, and what nobody had looked at.

How to use this file:

- One workstream = one branch. Tasks inside a workstream are ordered; a task
  that depends on another says so. Workstreams are independent of each other
  except where the header says otherwise.
- Every task is written to be handed to an agent on its own: files, the change,
  and the check that proves it. `Check` is the acceptance test, not a suggestion.
- Sizes: **S** under an hour, **M** an afternoon, **L** a day or more.
- Repo rules that apply to all of them: no back-compat shims (delete the old
  name), prefer a guard over a doc (put the check where it ships), a shipped
  identifier is frozen, run `pnpm verify:docs` and `pnpm -C website
  generate-all` after touching docs and translate every changed English
  sentence into the five other locales, never release or publish without
  being asked, `git -c core.fsmonitor=false` for anything git.
- "Sweep NN" in a task points at the audit report with the repro and evidence.

| Workstream | Tasks | P0 | Suggested branch |
| --- | --- | --- | --- |
| W1 `rebase dev` database plumbing, status, doctor | 12 | 2 | `fix/dev-database-plumbing` |
| W2 Template, scaffold, first login | 10 | 2 | `fix/template-pins-and-first-login` |
| W3 Boot: multi-source provisioning, loader, log noise | 11 | 3 | `fix/boot-multi-source-and-loader` |
| W4 SDK, REST, storage API | 12 | 2 | `fix/sdk-rest-storage-contracts` |
| W5 Docs content and the verifier's blind spots | 14 | 2 | `docs/backend-overview-and-gates` |
| W6 Studio and admin | 11 | 3 | `fix/studio-editors-and-locales` |
| W7 MCP and skills | 14 | 2 | `fix/mcp-project-resolution-and-skills` |
| W8 Cloud CLI, saas control plane, cross-repo CI | 13 | 2 | `fix/cloud-link-and-saas-tests` + saas `fix/studio-tab-mock` |
| W9 Packaging, install, release plumbing | 11 | 1 | `fix/packaging-declared-deps-and-release-plumbing` |
| W10 Contributor experience and CI parity | 10 | 1 | `fix/ci-parity-and-contributor-setup` |
| W11 Website and marketing | 11 | 4 | `fix/website-dead-routes-and-claims` |
| W12 Auth, cookies, OAuth env, rls-check guidance | 5 | 0 | `fix/auth-env-and-rls-check-guidance` |
| W13 Database operations: push, migrate, pull, branches | 12 | 3 | `fix/db-push-migrate-and-remedies` |
| W14 Upgrade path: badges, upgrade guide, skew errors | 6 | 1 | `fix/upgrade-path-badges-and-skew-errors` |
| W15 Errors and logging: causes, ports, the boot banner | 7 | 0 | `fix/request-errors-and-boot-banner` |
| W16 Cross-cutting: OpenAPI parity, flag vocabulary, `--json` | 9 | 0 | `fix/openapi-parity-and-flag-vocabulary` |

---

## W1 `rebase dev` database plumbing, status, doctor

Branch `fix/dev-database-plumbing`. Sweep 01, 02. Files cluster in
`packages/cli/src/dev-db/*`, `packages/cli/src/commands/{dev,db,status}.ts`,
`packages/server-postgres/src/schema/doctor*.ts`. W3 touches
`packages/server/src/boot/sources.ts` too; keep your edit there minimal.

- **W1-01 · P0 · S · `rebase dev --database-url <url>` must reach the backend.**
  Files: `packages/cli/src/dev-db/prepare.ts:174-177`, `packages/cli/src/dev-db/prepare.test.ts`.
  Do: when `database.source === "flag"`, return `env: { DATABASE_URL: database.url }`
  (the `branch` case one block above is the model). The comment "the child's
  environment is already correct" is false for a flag.
  Check: `prepare.test.ts` case asserting `env.DATABASE_URL` for `source:"flag"`;
  `rebase dev --backend-only --database-url postgresql://…` against a Docker
  Postgres reaches `Server running at` (sweep 01 repro).

- **W1-02 · P0 · M · `rebase dev --docker` must not kill itself in the first schema push.**
  Files: `packages/cli/src/commands/dev.ts:465-472`, `packages/cli/src/utils/dev-preflight.ts:330-344`, `packages/cli/src/commands/db.ts:190,375`.
  Do: pass the resolved compose URL into the push
  (`["node","rebase","db","push","--database-url", prepared.url]`), and make
  `refuseAtlasOnManagedDatabase` throw a typed error instead of `process.exit(1)`
  so `dev-preflight`'s catch is reachable (db.ts's own CLI entry converts the
  throw into exit 1). This is yesterday's W1-03; its Check never held.
  Check: fresh scaffold, Docker up, FIRST `rebase dev --backend-only --docker`
  reaches `Server running at`; a unit test asserts the preflight's push argv
  carries the resolved URL; `dev-preflight` test that a push refusal leaves the
  process alive.

- **W1-03 · P1 · M · `rebase dev` notices when the backend dies after the first boot.**
  Files: `packages/cli/src/commands/dev.ts:65,1137,1167`.
  Do: delete `WATCHER_CRASH_MARKER` (matches nothing in tsx ≥4.20); re-arm the
  ready deadline on every `[tsx] … Restarting/Rerunning` line, and set
  `process.exitCode` under `--backend-only` when the backend is gone.
  Check: `rebase dev --backend-only`, then break `config/resources.ts` → dev
  prints a verdict naming the failure within the deadline; `kill -9` of the
  server grandchild is reported.

- **W1-04 · P1 · M · `rebase status` and `rebase doctor` resolve the managed database.**
  Files: `packages/cli/src/commands/status.ts`, `packages/cli/src/commands/doctor.ts`, `packages/server-postgres/src/schema/doctor.ts:934-940`, `packages/server-postgres/src/schema/doctor-policy-checks.ts:47-50`, `packages/server/src/boot/sources.ts:206` (read only).
  Do: route both through `resolveDevDatabase`/`prepareDatabaseEnv` the way
  `db url` does; `status` renders the default source as bound ("managed, this
  project only"); `doctor` runs all three phases (starting the daemon like `db
  url` does, or saying "start it with `rebase dev`"). Reserve the "set
  DATABASE_URL" remedy for a project with neither.
  Check: stock scaffold, no `DATABASE_URL`: `rebase status` does not say
  `DATABASE_URL not set`; `rebase doctor` shows `Collections → Database` not
  skipped and the RLS phase ran (3/3).

- **W1-05 · P1 · S · `doctor` never prints a green tick for a check it did not run.**
  Files: `packages/server-postgres/src/schema/doctor-policy-checks.ts:73-79`.
  Do: make the `Policy roles are usable` tick conditional on a successful probe
  query; on connection failure print `⏭ not checked` and the cause once.
  Check: `DATABASE_URL=postgresql://u:x@127.0.0.1:5499/db rebase doctor` → no
  `✓` line before the ECONNREFUSED; a unit test of `runPolicyChecks` against a
  closed port asserts no `✓`.

- **W1-06 · P1 · S · Help text and the generator's closing line branch on the managed database.**
  Files: `packages/cli/src/commands/db.ts` (help block "Quick development workflow"), `packages/server-postgres/src/schema/generate-drizzle-schema.ts:84-88`.
  Do: when `resolveDevDatabase(...).kind === "managed"`, the `db --help` example
  and `schema generate`'s "You can now run `rebase db generate`" say what works
  there (boot applies the schema; `rebase db push` is for an external DB).
  Check: on a stock scaffold `rebase schema generate` does not recommend
  `rebase db generate`; `rebase db --help` first example is runnable there.

- **W1-07 · P1 · S · `db branch switch` reads `DATABASE_URL` from the shell like its siblings.**
  Files: `packages/cli/src/commands/db.ts:837`.
  Do: `resolveDevDatabase({ env: process.env, envFile: readEnvFile(projectRoot), … })`.
  Check: `export DATABASE_URL=…; rebase db branch switch x` no longer says "no
  DATABASE_URL"; test that `switchBranch` accepts a shell-only URL.

- **W1-08 · P1 · S · `rebase dev` refuses a port another process serves on loopback.**
  Files: `packages/server/src/utils/dev-port.ts:56`.
  Do: probe `127.0.0.1:<port>` (connect) before binding `0.0.0.0`; treat a
  successful connect as in-use and retry as for EADDRINUSE.
  Check: loopback squatter on 3013 → `Port 3013 is in use — trying 3014`; a
  dev-port test with a loopback-only listener.

- **W1-09 · P2 · S · `db url` rejects unknown flags; the driver's unknown-subcommand messages match the CLI's.**
  Files: `packages/cli/src/commands/db.ts:441-445`, `packages/server-postgres/src/cli.ts:191,1503`, `packages/cli/src/utils/unknown-command.ts`.
  Do: `parseCommandArgs` in `printDatabaseUrl`; validate the `db`/`schema`
  subcommand CLI-side through `unknown-command.ts` BEFORE `prepareDatabaseEnv`
  (no PGlite boot on a typo), listing every subcommand `--help` lists; the
  pointer names `rebase <family> --help`.
  Check: `rebase db url --bogus` exits 1 with a pointer; `rebase db psh` does
  not start the daemon and lists `url pull stop reset`; `rebase schema genrate`
  lists the schema subcommands; add `db url` to `help-flag.test.ts`.

- **W1-10 · P2 · S · `rebase schema stale` says something on the clean path.**
  Files: `packages/server-postgres/src/cli.ts` (stale handler).
  Do: print "Nothing stale — N generated file(s) match."
  Check: test asserting non-empty stdout on a clean project.

- **W1-11 · P2 · S · The dev summary box shows the port the server actually took.**
  Files: `packages/cli/src/commands/dev.ts` (summary box, port-moved warning).
  Do: when the backend prints `Port N is in use — trying M`, re-print the URL
  line with M (or delay the box until the ready line names the port).
  Check: squat the port, `rebase dev` → the box's URL matches `Server running at`.

- **W1-12 · P2 · S · `status` and `resources` project the same resource set.**
  Files: `packages/cli/src/commands/status.ts`, `packages/cli/src/commands/resources.ts`, `packages/cli/src/resources/*`.
  Do: one projection of the graph for both (buckets included in `resources
  --json` when declared or implicit, or excluded from `status` — pick the graph's
  answer; `rebase.resources.json` is what a host reads).
  Check: a test asserting the resource keys in `status --json` equal those in
  `resources --json` on the stock scaffold.

## W2 Template, scaffold, first login

Branch `fix/template-pins-and-first-login`. Sweep 02, 01, 03, 07. Files:
`packages/cli/templates/**`, `packages/cli/src/commands/init.ts`,
`packages/cli/src/bundle.ts`, quickstart docs. W5 owns the rest of the docs;
you own `getting-started/quickstart.md` (6 locales) and the template README.

- **W2-01 · P0 · M · A scaffold must boot against the versions `init` pins.**
  Files: `packages/cli/templates/template/config/resources.ts:14,84-85`, `packages/cli/templates/template/frontend/vite.config.ts:6`, `tooling/scripts/check-templates.mjs`, `tooling/scripts/check-release-bump.mjs` (read), `contracts/*.api.txt`.
  Do: (a) delete the value imports of `queue` and `topic` and the `void` lines
  from the template (the doc comment can name them without importing); check
  `rebaseManualChunks` in `vite.config.ts` the same way — if published
  `@rebasepro/app@0.17.3` lacks it, the template must not use it until the
  version bumps. (b) Add an offline gate: for every `@rebasepro/<pkg>` import
  in `packages/cli/templates/**`, if `packages/<pkg>/package.json` version
  equals the version at git tag `v<version>` (i.e. unreleased changes at a
  published version), every imported symbol must exist in
  `git show v<version>:contracts/<pkg>.api.txt` (or the tag's `dist` d.ts).
  Wire it into `check:templates`.
  Also cover the compose contract: every `${VAR:?…}` the template's
  `docker-compose.yml` requires must be read by the server source at that tag
  (`git show v<version>:packages/server/src/boot/env.ts` and the auth files);
  today `REBASE_ADMIN_EMAIL`/`_PASSWORD` are required by the compose file and
  unknown to the 0.17.3 image, and `DISABLE_SELF_REGISTRATION=true` there
  means a self-host on the pinned image boots with no admin and registration
  off (sweep 08). The gate is the release blocker for that skew: it must fail
  `check:release-bump` and the publish workflow's preflight; whether it also
  fails `ci:static` follows whatever `check:release-bump` does today (read it).
  Record in the report that main at 0.17.3 carries unreleased template changes
  and is unshippable until the version bumps — do NOT bump it.
  Check: `rebase init t --yes && cd t && pnpm install && rebase dev` reaches
  `Server running at` and `rebase resources` exits 0 (install from the registry
  — do NOT `link:` the workspace); `pnpm check:templates` fails when a template
  imports a symbol absent from the tag; the compose half reports the
  `REBASE_ADMIN_*` skew against `v0.17.3`.

- **W2-02 · P0 · M · In development the first registered user is the admin, as documented; the seed is the production contract.**
  Files: `packages/server/src/auth/seed-admin.ts:53`, `packages/server/src/init.ts:1811`, `packages/server/src/auth/registration-policy.ts` (`isBootstrapWindowOpen`), `packages/cli/src/commands/init.ts:1288-1298` (next steps), `packages/cli/src/commands/dev.ts` (banner), `packages/cli/templates/template/README.md:40-41`, `website/src/content/docs/docs/getting-started/quickstart.md:123-127` and `getting-started/deployment.md` (+5 locales each), `packages/cli/test/e2e/first-run.test.ts`.
  Do: `seedInitialAdmin` runs only when the bootstrap window is closed (production); when the window is open and `REBASE_ADMIN_*` is set, log one info line ("ignored in development — the first registered user becomes admin; used by the compose/production run") and do not create the account. `init`'s next-steps and the dev banner say both halves in one line each. The quickstart's "First Login" stays true; the deployment page says the seeded admin is what a production boot creates. The five non-English quickstarts and deployment pages get the same sentences (translate).
  Check: `first-run.test.ts` (or a server test) boots `rebase dev` with `REBASE_ADMIN_*` set, registers, and asserts `roles: ["admin"]` and `needsSetup` was `true` before; a server test with `NODE_ENV=production` asserts the seed runs and registration is refused; `grep -rn "ALLOW_REGISTRATION=false" website/src/content/docs/{de,es,fr,it,pt}/docs/getting-started/deployment.md` → 0.

- **W2-03 · P1 · S · `rebase build` ignores imports inside comments.**
  Files: `packages/cli/src/bundle.ts:811,851`, `packages/cli/templates/template/config/resources.ts:48`.
  Do: strip comments before the unresolved-import scan.
  Check: `rebase build` on the stock template prints no `import(s) could not be resolved`; a bundle test asserts `unresolved: []` for the template.

- **W2-04 · P2 · S · `.env.example` lists every key `init` writes and compose reads.**
  Files: `packages/cli/templates/template/.env.example`, `packages/cli/templates/template/docker-compose.yml:59,92`, `tooling/scripts/check-templates.mjs`.
  Do: add `DATABASE_PASSWORD` and `REBASE_VERSION` with a comment; gate: every
  key `init` writes to `.env` and every `${VAR}` in the template compose appears
  in `.env.example`.
  Check: the `comm` in sweep 02 is empty; `pnpm check:templates` fails on a removed key.

- **W2-05 · P2 · S · `.gitignore` covers `dist-bundle-admin/`.**
  Files: `packages/cli/templates/template/.gitignore:34-35`.
  Do: `dist-bundle*/`.
  Check: scaffold, `rebase build`, `git status --porcelain | grep dist-bundle` → empty.

- **W2-06 · P2 · S · The headless README and the unmounted `/api/swagger` say why there are no docs yet.**
  Files: `packages/cli/templates/overlays/baas/README.md:44-46`, `packages/server/src/init/docs.ts:28-30`.
  Do: qualify the README line; mount `/api/swagger` with a JSON 404 body naming
  `NO_COLLECTIONS` and the next step when zero collections are served.
  Check: headless scaffold → `curl /api/swagger` returns JSON with a code and a next step.

- **W2-07 · P2 · S · The quickstart's `--yes` row and README:95 match `--help`.**
  Files: `website/src/content/docs/docs/getting-started/quickstart.md:68` (+5 locales), `README.md:95`.
  Do: use the `--help` wording ("skips git init and dependency install…").
  Check: `grep -n "accept every default" README.md website/src/content/docs/*/docs/getting-started/quickstart.md` → 0.

- **W2-08 · P3 · S · Five locales drop the trimmed collection snippet.**
  Files: `website/src/content/docs/{de,es,fr,it,pt}/docs/getting-started/quickstart.md`.
  Do: replay the English edit (no `singularName`, no `table:`; explain the slug default in that language).
  Check: `grep -l 'table: "products"' website/src/content/docs/*/docs/getting-started/quickstart.md` → 0.

- **W2-09 · P3 · S · Install-script allowlists agree.**
  Files: `packages/cli/templates/template/package.json:41-48`.
  Do: mirror `pnpm.onlyBuiltDependencies` into npm 12's `allowScripts`.
  Check: a template test asserting the two lists have the same keys.

- **W2-10 · P3 · S · The PGlite peer set is consistent.**
  Files: `packages/cli/package.json` optional deps.
  Do: align `@electric-sql/pglite`, `pglite-pgvector`, `pglite-socket` so `pnpm peers check` is clean in a scaffold. If the published versions cannot satisfy each other, record that and skip.
  Check: fresh scaffold `pnpm install` prints no unmet-peer warning for the three.

## W3 Boot: multi-source provisioning, loader, log noise

Branch `fix/boot-multi-source-and-loader`. Sweep 03, 01, 02. Files cluster in
`packages/server-postgres/src/PostgresBootstrapper.ts`,
`packages/server/src/collections/loader.ts`, `packages/server/src/boot/*`,
`packages/server-postgres/src/services/{dataService,realtimeService}.ts`,
`packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts`,
`packages/common/src/util/builders.ts`.

- **W3-01 · P0 · M · Each data source provisions only the collections routed to it.**
  Files: `packages/server-postgres/src/PostgresBootstrapper.ts:686-698,799,867,901` (apply the `:505-508` filter).
  Do: filter `registry.getCollections()` by `c.dataSource === sourceKey || (!c.dataSource && sourceKey === "(default)")` in the drift check, the CDC attach and the RLS/grants pass.
  Check: driver test booting two sources with one routed collection asserts zero `SCHEMA DRIFT` and zero `[CDC] Could not attach` warnings; the sweep 03 scaffold (`database("analytics")`) boots clean.

- **W3-02 · P0 · M · The `rebase` schema and helpers exist on every source before its first `CREATE POLICY`.**
  Files: `packages/server-postgres/src/PostgresBootstrapper.ts:1220` and the boot order around the RLS pass.
  Do: provision `CREATE SCHEMA IF NOT EXISTS rebase` + `rebase.roles()` etc. per source before the policy pass.
  Check: boot-order test asserting `rebase.roles()` exists before the first `CREATE POLICY` on a second source; with `tags` routed to `analytics`, boot logs no `Could not fully apply policies` and `pg_policies` for `tags` has the same count as on the default source.

- **W3-03 · P0 · S · An unreadable `config/collections/index.ts` fails the boot.**
  Files: `packages/server/src/collections/loader.ts:53-64`, `packages/server/src/boot/bundle.ts:420-427`.
  Do: rethrow when the index exists and fails to import (absent index stays tolerated); the message names the file and the parse error.
  Check: loader test: unparseable index rejects; boot test asserting the applied-policy count is stable across two boots of the stock scaffold; sweep 01 repro (`export const broken = {{{`) → boot exits 1 with the file named.

- **W3-04 · P1 · S · `reference` properties follow the same `ON DELETE` rule as `belongsTo`.**
  Files: `packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:775,1134` (route through `defaultBelongsToOnDelete` at `:110`), `website/src/content/docs/docs/collections/properties.mdx:29` (say the rule applies).
  Do: one rule; if `reference` is not meant for Postgres, refuse it in `validate-config.ts` and delete it from the Postgres table instead — pick the former unless the type is Firestore-only in `packages/types`.
  Check: a DDL test per property type asserting the emitted `ON DELETE`; `grep -n 'required ? "CASCADE"' generate-postgres-ddl-logic.ts` → 0.

- **W3-05 · P1 · S · `@rebasepro/common`'s `defineCollection` has one signature.**
  Files: `packages/common/src/util/builders.ts:50,62,74` (model: `packages/cms-types/src/admin_collection.ts:744`).
  Check: a type test that a misspelled key yields one `TS2322` at the key, and no error text contains `MongoDBCollectionConfig`.

- **W3-06 · P1 · M · `defineCollection` from `@rebasepro/cms-types` is importable without React.**
  Files: `packages/cms-types/src/collections.ts:15`, `packages/cms-types/src/admin_collection.ts`, `tooling/scripts/headless-guard/check-browser-deps.mjs`, `app/config/collections/*.ts` (reapply yesterday's W3-14 after the guard passes).
  Do: move `defineCollection` and the key machinery to a React-free module and re-export from the barrel so the collections graph never reaches `collections.ts`; extend `check:headless` to `packages/cli/templates/template/config/collections`.
  Check: `pnpm check:headless` and `check:browser-deps` pass with `app/config/collections/*.ts` using `defineCollection` from `@rebasepro/cms-types` (`grep -c "^const .*: PostgresCollectionConfig" app/config/collections/*.ts` → 0 everywhere).

- **W3-07 · P1 · S · A fatal config error prints its message once, not escaped JSON twice.**
  Files: `packages/cli/runtime/dev-server.mjs:42` and the runtime's fatal path.
  Do: for a config/`BundleError`, print `err.message` as-is; stack behind `--debug`; no duplicate.
  Check: duplicate slug in a scaffold → the first error line contains no `{"error":` and the message appears once.

- **W3-08 · P1 · S · The redacted marker names the switch that un-redacts it.**
  Files: `packages/server/src/utils/logger.ts:143-145`, `website/src/content/docs/docs/getting-started/configuration.md` (env table), `tooling/scripts/check-env-reference.mjs`.
  Do: `Failed query: [redacted — set REBASE_LOG_RAW_QUERIES=true in development to see it]`; add the variable to the reference; make `check-env-reference` fail on a read the reference omits.
  Check: `grep -rn REBASE_LOG_RAW_QUERIES website/src/content/docs/docs/getting-started/configuration.md` → 1; the gate fails when the row is removed.

- **W3-09 · P2 · S · Raw SQL and realtime debug go through the logger at `debug`.**
  Files: `packages/server-postgres/src/services/dataService.ts:194-196,225`, `packages/server-postgres/src/services/realtimeService.ts:302-305`.
  Do: replace `console.debug` gated on `NODE_ENV` with `logger.debug` under the existing `REBASE_LOG_RAW_QUERIES` gate (redaction lives in the logger).
  Check: `LOG_LEVEL=info rebase dev` boot transcript contains no `Executing raw SQL`; a test asserts it.

- **W3-10 · P2 · S · The human diagnosis box is not followed by the 3 KB JSON of the same error.**
  Files: `packages/server/src/utils/logger.ts` (serialiseError caller at boot), `packages/server/src/boot/boot.ts` fatal path.
  Do: in development log the structured object at `debug`; keep the box and the `caused by:` lines.
  Check: unreachable-DB boot transcript's longest line is under 500 chars; the `caused by:` lines remain.

- **W3-11 · P2 · S · Configuration table, cron remedy, bucket default, `amendResourceKind` doc.**
  Files: `website/src/content/docs/docs/getting-started/configuration.md:204-219`, `packages/cli/src/commands/resources.ts` (cron load error), `packages/server/src/storage/storage-registry.ts:153`, `website/src/content/docs/docs/backend/storage.md` or `deployment/*` (a short `amendResourceKind` section for driver authors).
  Do: move the `:::note` out of the table and delete the duplicate `REBASE_STRICT_COLLECTION_CONFIG` row; print the cron module-scope remedy INSTEAD of the Zod dump; make the "using media as default" a decision the author makes (`default: true` on the bucket, or a hard error naming both options) — no silent promotion; document `amendResourceKind` in one paragraph.
  Check: the table renders (no literal pipes) in all six locales; bad cron → one sentence, no JSON; a single named bucket without `default` → boot error naming the fix; `grep -rn amendResourceKind website/src/content/docs/docs | wc -l` ≥ 1.

## W4 SDK, REST, storage API

Branch `fix/sdk-rest-storage-contracts`. Sweep 04. Files: `packages/client`,
`packages/server/src/{api,storage,auth,init}`, `packages/codegen`,
`packages/server-postgres/src/{schema,utils}`, `packages/common/src/data`,
`packages/types/src/errors.ts`, `tooling/scripts/docs-verify/check-error-codes.mjs`,
`website/.../backend/storage.md` (6 locales) and `sdk/storage.md`.

- **W4-01 · P0 · M · A `number` property reads back as a number.**
  Files: `packages/server-postgres/src/schema/generate-drizzle-schema-logic.ts:159`, the driver's row mapper (register a parser for `numeric`, OID 1700, or cast per column), `packages/codegen/src/generate-types.ts:80`.
  Do: cast `numeric` columns to JS number in the driver's row mapping (declared scale makes it safe); keep the generated `Row` type `number`. If a column can exceed double precision, document `columnType: "decimal"` → `string` explicitly.
  Check: codegen/driver test: for each property kind, the generated `Row` type matches `typeof` of a value read back from a live table; `POST {"order":2.5}` → `GET` returns `2.5` as a number.

- **W4-02 · P0 · S · Storage REST docs name routes that exist, and how a file read is authorized.**
  Files: `website/src/content/docs/docs/backend/storage.md:101-116` (+5 locales), `tooling/scripts/docs-verify/check-endpoint-index.mjs`.
  Do: `/api/storage/files/:path` → `/api/storage/file/*` (GET, DELETE); add the line that file routes take the signed `?token=`, not the access JWT; add `/api/storage/list`, `/storage/sources`, `/storage/metadata` rows; extend the gate to resolve every `| METHOD | /api/... |` row of every docs table against the mounted router.
  Check: `curl` the documented rows on a scaffold → none is `404 text/plain`; the gate fails on a made-up row.

- **W4-03 · P1 · S · A filter value that cannot be parsed for the column is a 400.**
  Files: `packages/server/src/api/errors.ts:437-465`.
  Do: map SQLSTATE class `22` to `400 INVALID_FILTER_VALUE` naming the column; document the code (W4-05's gate must see it).
  Check: `?id=eq.abc`, `?status=eq.nope` → 400 with the code; tests for `22P02`, `22007`, `22003`.

- **W4-04 · P1 · S · `listObjects` keys are normalized.**
  Files: `packages/server/src/storage/LocalStorageController.ts:349,377` and the `prefixes` branch.
  Check: controller test asserting `listObjects(p)` keys are identical for `p`, `p + "/"`, `"/" + p`; matches `S3StorageController` for the same objects.

- **W4-05 · P1 · M · The error-code gate sees every shape; the 11 live codes are documented.**
  Files: `tooling/scripts/docs-verify/check-error-codes.mjs:110-125`, `website/src/content/docs/docs/sdk/errors.md` (+5 locales), `packages/server/src/api/rest/query-parser.ts:26`, `packages/server-postgres/src/utils/drizzle-conditions.ts:695`.
  Do: match `new ApiError(<status-or-ident>, <code>` and resolve a local wrapper's code argument; balanced-paren factory scan (sweep 14 shows the non-greedy regex stops at the first `)` inside a message); add `packages/common/src` to `SOURCE_DIRS` (it owns `CALLBACK_REJECTED`); teach the gate template-literal codes (`PG_${code}` in `PersistService.ts:517`) and require the page to declare that family with rows for 23505, 23503, 23502, 22P02. The gate's own test asserts it finds a code through a one-line wrapper and through `ApiError.badRequest(\`a ${x.join(", ")} b\`, "X_CODE")`. Then document every code the fixed gate reports missing — sweep 04 lists 11 and sweep 14 lists 17 (CALLBACK_REJECTED, MISSING_AGGREGATE_SELECT, RELATION_MISCONFIGURED, SCHEMA_CHANGE_FAILED, SCHEMA_EDIT_REFUSED, SCORE_CURSOR_UNSUPPORTED, UNKNOWN_AGGREGATE_FIELD, UNKNOWN_FILTER_FIELD, UNKNOWN_FILTER_OPERATOR, UNKNOWN_ORDER_BY_FIELD, UNKNOWN_RESPONSE_FIELD, UNKNOWN_VECTOR_PROPERTY, UNSUPPORTED_RELATION_FILTER, UNSUPPORTED_RELATION_FILTER_OPERATOR, VALIDATION_CONSTRAINT, VALIDATION_EXCLUDED_FIELDS, VALIDATION_UNKNOWN_FIELDS) (+ W4-03's).
  Check: the sweep 04 `node -e` probe prints `SEEN` for all five; `pnpm verify:docs` error-code stage reports 0 findings only after the rows exist (remove one → it fails).

- **W4-06 · P1 · S · Every auth error body carries `requestId`.**
  Files: `packages/server/src/auth/adapter-middleware.ts:80,103,124,134,144`, `packages/server/src/functions/request-timeout.ts:86`, `packages/server/src/init/middlewares.ts:57`, `packages/server/src/init.ts:2309`.
  Do: replace every hand-built envelope with `refuse(c, ApiError.…)`/`errorHandler(…)` (model: `middleware.ts:100-102`) so `handOffToRequestLog` runs too (the 504's Studio Logs entry then carries `errorCode`).
  Check: test fetching each path (401, 413, 504) asserting `body.error.requestId === headers["x-request-id"]`; `curl /api/data/posts` unauthenticated → body has `requestId`.

- **W4-07 · P1 · S · Every unmatched `/api/*` route answers the JSON envelope; functions name the missing file.**
  Files: `packages/server/src/api/root-error-handler.ts:29` (`installRootErrorHandler`), `packages/server/src/init/surfaces.ts:60`, the functions router, `packages/server/test/root-error-handler.test.ts`.
  Do: `app.notFound(c => errorHandler(ApiError.notFound(…), c))` with `code: "NOT_FOUND"` and `requestId`; under `/api/functions/*` → `FUNCTION_NOT_FOUND` naming the function, the mounted ones, and — when a function file failed to load — that file.
  Check: `curl -D- /api/nope`, `/api/data`, `/api/auth/nope`, `/api/functions/hello/nope` → all `application/json` with a `code`; `client.functions.invoke("nope")` rejects with `code === "FUNCTION_NOT_FOUND"`; the test asserts content-type and code on an unmatched path.

- **W4-08 · P1 · S · An unknown bucket is not "file not found".**
  Files: `packages/server/src/storage/routes.ts:969-1002` and the signed-url handler.
  Do: `404 UNKNOWN_STORAGE_SOURCE` naming the configured keys.
  Check: `getSignedUrl("x.txt", "no-such-bucket")` → error with that code; route test.

- **W4-09 · P1 · S · An offline id has the id property's type.**
  Files: `packages/client/src/offline.ts:166-173`, `website/src/content/docs/docs/sdk/offline.md:70` (+5 locales).
  Do: mint a negative integer for integral ids (UUID string only when the id type is string); document the temporary id's shape.
  Check: client test: offline `create` on a numeric-id collection yields `typeof id === "number"` and `< 0`.

- **W4-10 · P2 · S · `orderBy` rejections and client errors carry codes.**
  Files: `packages/common/src/data/sort-dialect.ts:44` (route `normalizeOrderBy` through `toStrictTuple`), `packages/types/src/errors.ts:149-154` (`RebaseClientError(message, init?)`), the client throw sites (`INVALID_FILTER`, `UNKNOWN_COLLECTION`, `REALTIME_DISABLED`, `NOT_SIGNED_IN`, `INVALID_FUNCTION_NAME`).
  Check: `sort-dialect` test: every rejection is `OrderBySpecError`; client test: every thrown `RebaseClientError` has a non-empty `code`; `pnpm check:api-surface` regenerated and committed.

- **W4-11 · P2 · S · One documented envelope for storage REST; `CHANNEL_FORBIDDEN` row is honest.**
  Files: `packages/server/src/storage/routes.ts:998-1001` and siblings (`{ data }` like `/api/data` lists), `website/src/content/docs/docs/backend/storage.md:99-108` (response bodies), `backend/realtime.md:598` (+5 locales each).
  Check: `curl /api/storage/list` → `{"data":…}`; the realtime row says "you are not a member of the channel"; SDK tests updated.

- **W4-12 · P3 · S · Stale comments and the `putObject` result.**
  Files: `website/src/content/docs/docs/sdk/storage.md:30` (+5 locales), `packages/server/src/boot/env.ts:307`, `packages/common/src/data/sort-dialect.ts:181-183`, `packages/common/src/data/filter-dialect.ts:727`.
  Check: the snippet comment matches `{ key, bucket, storageUrl }`; the three comments describe current behaviour.

## W5 Docs content and the verifier's blind spots

Branch `docs/backend-overview-and-gates`. Sweep 05, 03, 01. Files:
`website/src/content/docs/**`, `tooling/scripts/docs-verify/**`,
`website/scripts/generate_{llms_txt,sitemap_md}.js`, `packages/server/src/boot/bundle.ts:455-519`.
W2 owns quickstart.md; W4 owns storage.md's endpoint table; W8 owns deployment/cloud.md.

- **W5-01 · P0 · S · The managed-runtime option map names exports that boot.**
  Files: `website/src/content/docs/docs/backend/index.md:25,29,70,72` (+5 locales), `backend/storage.md:18` (+5), `packages/server/src/boot/bundle.ts:455,466,519`.
  Do: cells read `bucket()`/`database()` in `config/resources.ts`; delete `dataSources`/`storageSources` from `READ_CONFIG_EXPORTS` and from the warning text at `:519`; gate: every "`export const X` from `config/index.ts`" cell in that table has `X ∈ READ_CONFIG_EXPORTS \ replacedResourceConfigKeys()`.
  Check: `grep -n "storageSources\|dataSources" website/src/content/docs/docs/backend/index.md website/src/content/docs/docs/backend/storage.md` → 0 outside the upgrading note; the gate fails on a re-added cell.

- **W5-02 · P0 · S · The REST section of the Backend overview stops teaching parameters that do not exist.**
  Files: `website/src/content/docs/docs/backend/index.md:279-295` (+5 locales), `tooling/scripts/docs-verify/check-endpoint-index.mjs`.
  Do: delete the parameter table; the endpoint table gains `PATCH/PUT`, `count`, `aggregate`, `bulk` or is replaced by a link to `backend/api.md` + `backend/endpoints.md`; gate: every `?param` in a docs table is in `reservedQueryKeys`.
  Check: `grep -n "startAfter\|?filter=" website/src/content/docs/*/docs/backend/index.md` → 0; the gate fails on `?bogus=`.

- **W5-03 · P1 · S · Backend overview: one failure mode; the page is split.**
  Files: `website/src/content/docs/docs/backend/index.md:152-156,349,351-359` (+5 locales).
  Do: delete :349; add Deployment to the "next" list; split the page along the same seams W9-13 used for authentication if it stays over 600 lines after the deletions.
  Check: `grep -n "503 for all" backend/index.md` → 0; `wc -l` ≤ 600.

- **W5-04 · P1 · M · The unreleased-badge gate sees every Unreleased bullet.**
  Files: `tooling/scripts/docs-verify/check-unreleased-badges.mjs:55-60`, `website/src/content/docs/docs/collections/relations.md:317-321`, `backend/cron-jobs.md:114-125`, `getting-started/deployment.md:78-91` (+5 locales each).
  Do: widen the token grammar to any backticked identifier in a lead-in (false positives to `NOT_NEW`); badge the three pages (RESTRICT default, `timezone`, `REBASE_ADMIN_*`) as Unreleased.
  Check: the gate's own probe over the Unreleased region yields ≥ 70/80 tokens; `pnpm verify:docs:strict` fails when a badge is removed from relations.md.

- **W5-05 · P1 · S · The LLM mirrors include autogenerated sidebar directories.**
  Files: `website/scripts/generate_llms_txt.js:178,188`, `website/scripts/generate_sitemap_md.js:21-26`, `tooling/scripts/*` (a new assertion in `check:generated` or a sibling).
  Do: expand `autogenerate: { directory }` entries; assert every non-excluded English page appears in `llms-full.txt`.
  Check: `grep -c "docs/ui/" website/public/sitemap.md` > 0; `pnpm check:generated` green; the assertion fails when a page is dropped.

- **W5-06 · P1 · S · The endpoint index gate sees every router.**
  Files: `tooling/scripts/docs-verify/check-endpoint-index.mjs:101`, `website/src/content/docs/docs/backend/endpoints.md` (+5 locales).
  Do: glob `packages/server/src/**/*.ts` and detect `new Hono()` receivers and `.get/.post…` on them; add `GET /livez` and `GET /metrics/history`.
  Check: the gate reports the two routes missing before the doc edit and 0 after; removing the `/livez` row fails it.

- **W5-07 · P1 · M · The translation-freshness gate has input, and stale locales for removed content are mechanically replayed.**
  Files: `tooling/scripts/docs-verify/check-translation-freshness.mjs:74-83`, `website/scripts/translate_docs.mjs:85-88`, the 390 locale pages, `de|es|fr|it|pt/docs/getting-started/deployment.md`, `*/docs/deployment/*.md`, `*/docs/sdk/index.md`.
  Do: (a) backfill `sourceHash` into every existing locale page from the current English hash (a one-off script, committed under `website/scripts/`); (b) under `--strict`, "unstamped" is a finding with a budget that only ratchets down; (c) mechanical replays: delete every `backend/Dockerfile` recipe line/paragraph and every `localhost:3001` the English removed, in all five locales (translate the replacement sentence). The 588-line authentication split is NOT in scope — list it for the user (needs the translation pipeline + GEMINI_API_KEY).
  Also widen `tooling/scripts/docs-verify/check-deploy-build-context.mjs` and yesterday's W6-04 grep-check to all six locales (they are EN-scoped, which is why the five stale checklists passed).
  Check: `grep -rn "backend/Dockerfile\|localhost:3001" website/src/content/docs/{de,es,fr,it,pt}` → 0; `check-deploy-build-context` fails on a planted `backend/Dockerfile` in `de/`; `grep -rL sourceHash website/src/content/docs/{de,es,fr,it,pt}/docs` → 0; the gate reports a finding when an English page changes without its locale.

- **W5-08 · P1 · S · Prerequisites and the headless snippets are true.**
  Files: `website/src/content/docs/docs/getting-started/quickstart.md:27` (coordinate: W2 owns that file — make this one-line edit and list it), `getting-started/headless.md:31,115,125,135` (+5 locales), `tooling/scripts/check-templates.mjs`, `tooling/scripts/docs-verify/check-doc-commands.mjs`.
  Do: drop the `.nvmrc` clause and the Node 20 claim (or ship both artifacts — pick drop); `REBASE_URL` in both snippets; say the OpenAPI routes appear after the first collection; gate: every file path a getting-started page names exists in `templates/template`; `check-doc-commands` flags a `$VAR` no shipped `.env*`/scaffold defines.
  Check: `grep -n "API_URL\|Node 20\|nvmrc" getting-started/headless.md getting-started/quickstart.md` → 0; both gates fail on a planted counterexample.

- **W5-09 · P2 · S · `AdminPropertyOptions` is fully documented and gated.**
  Files: `website/src/content/docs/docs/collections/properties.mdx` (+5 locales), `tooling/scripts/check-rebase-props-table.mjs` (sibling for `AdminPropertyOptions`), `packages/cms-types/src/types/property_options.ts:17`.
  Check: six rows exist; the sibling gate fails when one is removed.

- **W5-10 · P2 · S · `## [Unreleased]` has one section per heading, in canonical order; a gate keeps it so.**
  Files: `website/src/content/docs/docs/CHANGELOG.md:3-871`, `tooling/scripts/docs-verify/*` (new check), the five locale CHANGELOG copies (regenerated).
  Check: `awk` over the Unreleased block shows each `### ` heading once; the gate fails on a duplicated heading.

- **W5-11 · P2 · S · The snippet verifier's package map is derived from `exports`.**
  Files: `tooling/scripts/docs-verify/sdk-exports.mjs:19-51`.
  Do: build `PACKAGE_ENTRIES` from each workspace `package.json` `exports`; assert every subpath has an entry.
  Check: `@rebasepro/cms/editor` fences in the skills are typechecked (plant a bad import → `verify:docs` fails).

- **W5-12 · P2 · S · The verifier README says where it runs.**
  Files: `tooling/scripts/docs-verify/README.md:18,191,195-198`, `tooling/scripts/check-gates-doc.mjs`.
  Do: three sentences (`ci:static`, strict everywhere); extend `check:gates-doc` to that README's "Where it blocks" section.
  Check: `grep -n verify-quality tooling/scripts/docs-verify/README.md` → 0; the gate fails on a stale sentence.

- **W5-13 · P2 · M · No English page over 600 lines.**
  Files: `website/src/content/docs/docs/sdk/querying.md` (957), `collections/properties.mdx` (630), `backend/realtime.md` (612), `backend/api.md` (612), plus their locales for the moved sections.
  Do: split along existing `##` seams into sibling pages, update sidebar and links; move the locales' matching sections the same way (translate nothing new — move).
  Check: `find website/src/content/docs/docs -name '*.md*' -exec wc -l {} + | awk '$1>600'` → none; `check-docs-links` passes.

- **W5-14 · P2 · S · Read-only bundle mount: the compose comment matches `rebase build`'s default.**
  Files: `packages/cli/templates/template/docker-compose.yml:152-156`, `website/src/content/docs/docs/getting-started/deployment.md:83-85` (+5 locales).
  Do: the comment says vendoring is the default (`--no-vendor` opts out) and the mount may be read-only; align the deployment page's volume.
  Check: `grep -n "emits a package.json but not a node_modules" packages/cli/templates/template/docker-compose.yml` → 0.

## W6 Studio and admin

Branch `fix/studio-editors-and-locales`. Sweep 06. Files: `packages/studio`,
`packages/cms`, `packages/app/src/locales`, `packages/ui/src/components/Select.tsx`,
`packages/server/src/boot/boot.ts:392`, `packages/server/src/init.ts:2858,2109,1906`,
`packages/server/src/api/live-schema-routes.ts:291-297`,
`packages/server-postgres/src/services/BranchService.ts`.

- **W6-01 · P0 · S · Branching is refused on the managed database wherever it is asked.**
  Files: `packages/server-postgres/src/services/BranchService.ts:144-190`, `packages/cli/src/commands/db.ts:211-241` (keep as a nicety), `packages/studio/src/components/Branches/BranchesView.tsx:78-95` (render the refusal).
  Do: the driver knows the connection kind; `createBranch`/`switch` throw a typed refusal on PGlite; Studio shows it instead of the success toast.
  Check: `BranchService` unit test: PGlite-backed driver rejects `createBranch`; Studio → Branches → Create on a scaffold shows the refusal and no `rb_*` database appears in `pg_database`.

- **W6-02 · P0 · S · The collection editor works in `rebase dev`; the disabled state names its reason.**
  Files: `packages/server/src/boot/boot.ts:392`, `packages/server/src/api/live-schema-routes.ts:291-297`, `packages/server/src/init.ts:2109,1906-1909`, the editor header in `packages/studio` (or `packages/cms`) that renders "Update (Read-only)".
  Do: `schemaEditor: bundle.isSource ? undefined : false`; carry `schemaEditorOff.code` into the live-schema status (no more `MISSING_DEPENDENCY` when ts-morph is installed); render `status.reason` beside the disabled button.
  Check: e2e: scaffold, boot, `GET /api/schema-editor/status` → `{enabled:true}` and `/api/admin/schema/status` agrees; boot with `schemaEditor:false` → both aliases report `SCHEMA_EDITOR_DISABLED`; the button is enabled on a scaffold.

- **W6-03 · P0 · S · The cron surface is mounted whether or not `backend/crons/` exists.**
  Files: `packages/server/src/init.ts:2858,2887-2904`, `packages/server/src/boot/bundle.ts:233,363`, `packages/studio/src/components/CronJobs/CronJobsView.tsx:95,228` (empty state copy).
  Do: `cronsDir` optional; `/api/cron` and `/api/admin/cron` answer `200 []`; Studio's empty state says how to add one.
  Check: boot test: `/api/cron` → 200 `[]` with no crons directory; Studio → Cron Jobs on a scaffold shows the empty state, not "Not Found".

- **W6-04 · P1 · S · The RLS editor's plan/apply runs where the source is.**
  Files: `packages/studio/src/components/RLSEditor/RLSEditor.tsx:864`, `packages/cms/src/components/RebaseNavigation.tsx:366`, `packages/studio/test/rls-editor-plan-apply.test.tsx:35`.
  Do: depends on W6-02 (`hasCodebase` becomes true on a scaffold); the render-level test asserts the branch (a mapped table with `codebase:false` refuses the direct write; with `codebase:true` the plan dialog opens), not the helper.
  Check: Studio → RLS → `public.authors` → Create Policy → the plan dialog appears; `config/collections/authors.ts` changes after apply; the new test fails if `RLSEditor.tsx:864` is reverted.

- **W6-05 · P1 · M · Studio locale parity: every `en` key exists everywhere, and no multi-word value is English in another bundle.**
  Files: `packages/app/src/locales/{de,es,fr,it,pt,hi}.ts`, `tooling/scripts/check-untranslated.mjs` or a new `check:locale-parity`.
  Do: add the 41 missing keys with translations; translate the 184 byte-identical English values in `es.ts` and the 120 shared across all locales (translate by hand, one language at a time; `hi` may keep English where a term has no idiomatic form — record which); gate: key parity + no byte-identical multi-word English values (allowlist for proper nouns).
  Check: the gate passes and fails on a planted English string; `/api-keys` in Español shows no English.

- **W6-06 · P2 · S · Every select has an accessible name.**
  Files: `packages/ui/src/components/Select.tsx:171`, `packages/cms/src/form/field_bindings/SelectFieldBinding.tsx:62`, `packages/cms/src/form/components/LabelWithIcon.tsx:15-38`.
  Do: pass `aria-label={property.name}` (or `aria-labelledby` to an `id` on the label).
  Check: jsdom test: each field binding's control has an accessible name equal to the property name.

- **W6-07 · P2 · S · A single-value storage field accepts one file.**
  Files: `packages/cms/src/form/field_bindings/StorageUploadFieldBinding.tsx:278-287`.
  Do: `multiple: multipleFilesSupported`.
  Check: test `input.multiple === false` for a non-array storage property.

- **W6-08 · P2 · S · Navigation groups have one label per group.**
  Files: `packages/cms/src/components/HomePage/NavigationGroup.tsx:27`, `packages/app/src/hooks/useNavigationGroupLabel.tsx:20-28`, locales (`studio_group_views`, `studio_group_settings`), `tooling/scripts/check-studio-tools-table.mjs`.
  Check: home and drawer render the same three labels in Español; the gate fails on a group without a `studio_group_*` key.

- **W6-09 · P2 · S · Creating a row logs no error; the not-found view has a way back.**
  Files: `packages/cms/src/components/EditViewBinding.tsx:221-226`.
  Do: treat `status==="existing" && !entityId` as transitioning; the not-found view gets a translated message and a "Back to <collection>" link.
  Check: test: a create emits no `console.error`; `/c/authors/new` with an unknown id renders the link.

- **W6-10 · P2 · S · No `<button>` inside `<button>` in the SQL console; test run fails on React DOM validation errors.**
  Files: `packages/studio/src/components/SQLEditor/SQLEditor.tsx:1300-1311`, the studio vitest setup.
  Check: opening two SQL tabs logs no DOM validation error; the setup fails a test on `console.error` matching `cannot be a descendant`.

- **W6-11 · P3 · S · Small copy and a11y items.**
  Files: `packages/cms/src/components/HomePage/HomePageDnD.tsx:96,162` (drag attributes on a handle), `packages/cms/src/components/DefaultDrawer.tsx`, `packages/cms/src/components/common/default_entity_actions.tsx`, `packages/studio/src/components/StorageView/StorageView.tsx` (`t(key, { defaultValue })`), `packages/studio/src/components/Branches/BranchesView.tsx` (show the command and URL), `website/src/content/docs/docs/studio/index.md:47` (+5 locales).
  Check: home page focusables = destinations; `grep -rn 't("[a-z_]*") ||' packages/cms packages/studio` → 0.

## W7 MCP and skills

Branch `fix/mcp-project-resolution-and-skills`. Sweep 07. Files:
`packages/mcp/**`, `packages/cli/src/commands/skills.ts`,
`packages/cli/templates/template/.mcp.json`, `tooling/rebase-agent-skills/**`,
`tooling/scripts/docs-verify/check-skill-claims.mjs`, `website/.../docs/ai/*`.

- **W7-01 · P0 · S · Local discovery fills gaps only.**
  Files: `packages/mcp/src/index.ts:246-263`, `packages/mcp/src/index.test.ts`.
  Do: `baseUrl: project.baseUrl || devState.baseUrl`; warn to stderr when they disagree.
  Check: unit test `autoDiscoverLocal({baseUrl:"https://x"}, devState)` keeps `https://x`; the sweep 07 stdio repro no longer switches to localhost.

- **W7-02 · P0 · M · One project's registry `default` never resolves for another project.**
  Files: `packages/mcp/src/index.ts:340-390,1517,1572,1597`, `packages/cli/templates/template/.mcp.json`, `website/src/content/docs/docs/ai/mcp.md:90-92,305-315` (+5 locales), `packages/mcp/README.md:27,37-39`.
  Do: with no env, the project is the server's cwd when cwd holds a `rebase.json`; the persisted `default` applies only when cwd has none; `init` writes `REBASE_PROJECT_DIR: "."` into `.mcp.json`; the docs and README describe the one precedence (env → cwd `rebase.json` → registry default).
  Check: test: cwd=B with a registry `default` naming A → B wins; `grep -n "fallback if no registry" packages/mcp/README.md` → 0.

- **W7-03 · P1 · S · `rebase skills install` detects agents from evidence the user created.**
  Files: `packages/cli/src/commands/skills.ts:105,262-266,469`, `website/src/content/docs/docs/ai/skills.md:57-66` (+5 locales).
  Do: remove `.github` as Copilot's detect dir (require `--agent copilot`, or detect `.github/copilot-instructions.md` only when it differs from the template's); render the "Supports:" line from `AGENTS`; the docs describe the real behaviour.
  Check: on a stock scaffold `rebase skills install` prompts (TTY) / errors (CI) instead of installing Copilot; test running detection against the scaffold's file list finds none; help lists `codex kiro copilot`.

- **W7-04 · P1 · M · The skills describe the database `rebase dev` starts.**
  Files: `tooling/rebase-agent-skills/skills/rebase-basics/SKILL.md:14,47,72`, `skills/rebase-local-env-setup/SKILL.md`, `skills/rebase-basics/references/cli-commands.md:212`, `skills/rebase-cron-jobs/SKILL.md:57,318`, `tooling/scripts/docs-verify/check-skill-claims.mjs:200`.
  Do: `rebase-basics` teaches the managed database and the boot-applies loop (no `rebase db push` on it); rewrite `rebase-local-env-setup` for a scaffolded project (Node + pnpm; the monorepo paths go); delete the `NewPassword123!` default; fix the two `/api/cron` bodies; the claims gate globs `skills/**/*.md` and asserts every path a skill tells the agent to `cp`/`cd` exists in the template.
  Check: `grep -rin "pglite\|managed development database" tooling/rebase-agent-skills | wc -l` ≥ 3; `grep -rn "NewPassword123\|app/.env.example" tooling/rebase-agent-skills` → 0; the gate fails on a planted bad path.

- **W7-05 · P1 · S · `rebase_schema_plan` changes nothing and works on the managed database.**
  Files: `packages/mcp/src/index.ts:540-547,578-583,846-852,1360`.
  Do: back it with `POST /api/admin/schema/plan` (exists) instead of `db push --dry-run`; if the driver path stays, move it to `LOCAL_ONLY_TOOLS` and run generate into a temp dir.
  Check: test: the tool leaves the project directory byte-identical; on a scaffold it returns a plan, not exit 1.

- **W7-06 · P1 · S · Cron tools explain an unmounted surface.**
  Files: `packages/mcp/src/index.ts:1787-1806`.
  Do: map a 404 on a surface route to "this project declares no cron jobs — add `backend/crons/<name>.ts`" (after W6-03 lands the route answers `[]`; keep the mapping for older servers this session only if trivially cheap — otherwise just the empty-list rendering).
  Check: `cron_list_jobs` on a scaffold → a sentence naming `backend/crons/`, not `Error: Not Found`.

- **W7-07 · P2 · S · `rebase_dev_logs`/`rebase_dev_stop` know about a dev server they did not spawn.**
  Files: `packages/mcp/src/index.ts:215-240,1868,1875`.
  Check: test with a fake `.rebase/state.json` whose pid is `process.pid` → the tools name the running server.

- **W7-08 · P2 · S · Skill index descriptions handle YAML block scalars.**
  Files: `packages/cli/src/commands/skills.ts:247-250`.
  Check: `rebase skills install --agent cursor` → the `rebase-design-language` row has a sentence, not `|`.

- **W7-09 · P2 · S · `packages/mcp/server.json` is versioned with the package or deleted.**
  Files: `packages/mcp/server.json:5,14`, `tooling/scripts/docs-verify/check-version-pins.mjs`.
  Do: add it to the version-pins check (read from `package.json` at publish). If nothing publishes it, delete it and say so.
  Check: `pnpm check:version-pins` fails when `server.json` lags `package.json`.

- **W7-10 · P3 · S · `instruction-files.md` quotes the template.**
  Files: `website/src/content/docs/docs/ai/instruction-files.md:27-31` (+5 locales), `tooling/scripts/docs-verify/check-ai-instructions.mjs`.
  Check: the fenced block equals `packages/cli/templates/template/CLAUDE.md`; the gate diffs them.

- **W7-11 · P2 · S · Option defaults in skill tables match `--help`.**
  Files: `tooling/scripts/docs-verify/check-doc-commands.mjs`.
  Do: compare a documented default against the `--help` default text.
  Check: plant a wrong default → `verify:docs` fails.

- **W7-13 · P1 · S · `rebase skills` rejects unknown flags before writing anything.**
  Files: `packages/cli/src/commands/skills.ts:319-346`, `packages/cli/src/utils/args.ts` (`parseCommandArgs`).
  Check: `rebase skills install --frobnicate --agent claude` exits 1 with `unknown or unexpected option` and writes no file; added to `help-flag.test.ts`.

- **W7-14 · P2 · S · `rebase_db_branch_switch` exists.**
  Files: `packages/mcp/src/index.ts` (next to `rebase_db_branch_create/delete/info/list`), `website/src/content/docs/docs/ai/mcp.md` tool table (regenerated by `check-mcp-tool-tables.mjs`).
  Check: the tool is listed and runs `db branch switch <name>`; the table is regenerated.

- **W7-12 · P1 · S · The template imports only what the pinned types export (coordination).**
  Do NOT do this — W2-01 owns it. Listed so the report can point at it.

## W8 Cloud CLI, saas control plane, cross-repo CI

Branch `fix/cloud-link-and-saas-tests` (rebase) + `fix/studio-tab-mock` (saas,
worktree pre-created at `/Users/francesco/rebase/.claude/worktrees/saas-W8`
from saas main `4107839`; symlink its `node_modules` for `.`, `backend`,
`frontend`, `config` from `/Users/francesco/rebase/saas/<dir>/node_modules`).
Sweep 11. W10 (contributor) also touches `.github/workflows/verify.yml`; keep
your step addition self-contained.

- **W8-01 · P0 · S · saas CI green: the studio-tab mock has the hook's shape, and the test asserts something.**
  Files (saas): `frontend/src/test/studio-tab.test.tsx:32,110-133`, `frontend/src/test/runtime-logs-explorer.test.tsx:19-26`, a new `frontend/src/test/helpers/mock-app-i18n.ts`, `frontend/vitest.config.ts:14,20`.
  Do: one shared mock returning the real hook's shape (`{ t, i18n: { language: "en" } }`); both tests use it; the studio-tab cases assert a rendered tool-strip label from `en`, not absences; delete the duplicate alias at `vitest.config.ts:20`.
  Check: `pnpm --filter rebase-saas-frontend test` green, 0 unhandled errors; revert `RebaseStudio.tsx:157`'s `i18n.language` read locally and the studio-tab test FAILS (then restore).

- **W8-02 · P0 · S · A direct link never becomes the control plane.**
  Files: `packages/cli/src/commands/cloud/context.ts:169-170,237-247`, `packages/cli/src/commands/cloud/auth.ts:69,162`, `packages/cli/src/commands/cloud/link.ts`, `action-help.ts` (link page).
  Do: `resolveCloudUrl` ignores `link.url` when `link.mode === "direct"`; commands that need the control plane in a direct-linked directory refuse: "this directory is linked directly to <url> — `rebase cloud unlink` first, or pass `--project`"; `login` in that directory refuses the same way.
  Check: test driving `resolveCloudUrl` with `mode:"direct"` → default control plane; `rebase cloud whoami` after `cloud link https://example.com` does not say "Not logged in to https://example.com"; `cloud login` there refuses.

- **W8-03 · P1 · S · `deployment/cloud.md`'s surface table is complete and gated.**
  Files: `website/src/content/docs/docs/deployment/cloud.md:137-140,183,186` (+5 locales), `tooling/scripts/docs-verify/*` (extend the CLI-copy stage).
  Do: `resources` row = the graph; add a `compute` row; gate: every `CLOUD_GROUPS` word appears in that table exactly once.
  Check: gate fails when a row is removed; `cloud --help` groups == table rows.

- **W8-04 · P1 · S · Every cloud dispatcher refuses an unknown action.**
  Files: `packages/cli/src/commands/cloud/databases.ts:489,590`, `packages/cli/src/commands/cloud/action-help.test.ts:227-268`.
  Do: `default: fail("Unknown db backup command…", "unknown_command")`; the test asserts, for every `ACTION_HELP` usage line with an `<a|b|c>` group, that the dispatcher source contains a matching refusal.
  Check: `rebase cloud db backup lst` → `unknown_command`, exit 1; the sweep fails when a dispatcher's default is removed.

- **W8-05 · P1 · S · The bundle-manifest contract fixture is derived from the kind registry.**
  Files: `packages/cli/src/bundle-manifest-contract.test.ts:47-58`; saas `backend/src/managed/bundle-manifest-contract.test.ts:66-72`.
  Do: assert `Set(fixture kinds) == Set(resourceKinds().map(k => k.kind))` on the CLI side; on the saas side assert the accepted-kind list equals the kinds in the shared contract fixture (both repos already check out each other in CI).
  Check: add a seventh kind locally → both tests fail (then revert).

- **W8-06 · P1 · M · The console keeps the intake code and hint.**
  Files (saas): `frontend/src/views/ProjectDetails.tsx:1163-1167`, a frontend test.
  Do: render `details.intakeCode` + `details.hint` in a persistent panel on the deployment row (not a snackbar).
  Check: frontend test rejecting `triggerDeploy` with `400 {intakeCode, hint}` asserts both render and persist.

- **W8-07 · P1 · S · `saas/DEPLOYMENT.md` describes both managed-storage providers.**
  Files (saas): `DEPLOYMENT.md:192-232`, `backend/src/utils/managed-storage-target.ts:60-105` (read), a backend test asserting the runbook quotes the three `unavailable` reasons.
  Check: `grep -n "Garage" saas/DEPLOYMENT.md` ≥ 1; the test fails when a reason string changes without the runbook.

- **W8-08 · P1 · M · The rebase repo's CI runs the saas frontend suite.**
  Files: `.github/workflows/verify.yml` (or `ci.yml`) where the saas checkout for the contract test already lives; `docs/gates.md`.
  Do: add a step `pnpm --filter rebase-saas-frontend test` after the saas checkout; document the gate.
  Check: the step appears in the workflow and `pnpm check:gates-doc` passes; locally the command is green after W8-01.

- **W8-09 · P3 · S · Help pages declare `--yes` once; rollback refusal fields are real or gone; `cli/index.md` link form.**
  Files: `packages/cli/src/commands/cloud/action-help.ts:262,287,310`, `action-help.test.ts` (sweep `ACTION_HELP[*].flags` against `GLOBAL_SPEC_KEYS`); saas `backend/functions/deploy.ts:3927-3928`; `website/src/content/docs/docs/cli/index.md:357` (+5 locales; add `[url]` and `billing checkout`).
  Check: `rebase cloud resources prune --help` shows one `--yes`; `grep -n hasImage saas/backend/functions/deploy.ts` → 0 or computed.

- **W8-10 · P2 · S · Cloud docs fences are compared to `CLOUD_GROUPS` + `ACTION_HELP` usage lines.**
  Files: `tooling/scripts/docs-verify/*` (extend the stage that reads CLI copy).
  Check: plant `rebase cloud bogus` in `cli/index.md` → `verify:docs` fails.

- **W8-12 · P1 · S · Every cloud action parses its flags.**
  Files: `packages/cli/src/commands/cloud/*.ts` (actions that never call `parseCloudArgs`: `whoami`, `orgs`, `clusters`, `logout`, `projects list`, …), `packages/cli/src/commands/help-coverage.test.ts`.
  Do: route every dispatched action through `parseCloudArgs` with its spec (empty spec = only globals); extend the coverage test to fail a dispatched action with no spec.
  Check: `rebase cloud whoami --frobnicate` exits 1 with the unknown-option line; the test fails when an action is added without a spec.

- **W8-13 · P2 · S · `cloud deploy --force` is `--eject`.**
  Files: `packages/cli/src/commands/cloud/deploy.ts:912-916`, `action-help.ts`, `website/src/content/docs/docs/deployment/cloud.md` (+5 locales), CHANGELOG `### Changed`.
  Do: rename (no alias — `--force` on `cloud deploy` becomes an unknown option); keep `deployWarnings`.
  Check: `rebase cloud deploy --force` → unknown option; `--eject` carries the old description.

- **W8-11 · P2 · S · (saas) push and PR.**
  Do: nothing here — the integrator pushes `fix/studio-tab-mock` and opens the saas PR. Listed so the report says where the saas commits are.

## W9 Packaging, install, release plumbing

Branch `fix/packaging-declared-deps-and-release-plumbing`. Sweep 09. Files:
`packages/cli/src/bundle.ts`, `packages/cli/bin/rebase.js`, `.npmrc`,
`pnpm-workspace.yaml`, `.github/workflows/publish.yml`,
`tooling/scripts/check-*.mjs`, `packages/server/src/api/contract-routes.ts`,
`packages/server-postgres/package.json`, template `package.json`s. W2 owns
`templates/template/config/resources.ts`; W10 owns `verify.yml`.

- **W9-01 · P0 · S · `deps.declared` prefers the app's manifest and refuses conflicting ranges.**
  Files: `packages/cli/src/bundle.ts:626,641`, `packages/cli/src/bundle.test.ts`, `tooling/scripts/check-templates.mjs`, `packages/cli/templates/template/package.json:34` (`dotenv ^17.4.2` at the root, matching `backend/`).
  Do: iterate root → config → backend so the app wins; when two manifests declare disjoint ranges for one name, fail the build naming both files (extend `detectFrameworkDepDrift` to third-party names); gate: no name declared twice at different ranges in the scaffold.
  Check: `bundle.test.ts` case with conflicting manifests → build refuses; `rebase build` on the stock scaffold → `deps.declared.dotenv` is `^17.4.2`; `pnpm check:templates` fails on a planted mismatch.

- **W9-02 · P1 · S · Non-registry specifiers are refused at build.**
  Files: `packages/cli/src/bundle.ts:636-640`.
  Do: reject `file:`, `link:`, `portal:`, `git+`, bare paths with the name and declaring file.
  Check: unit test on `collectDeclaredDependencies`.

- **W9-03 · P1 · S · The repo's pnpm settings live where pnpm 11 reads them.**
  Files: `.npmrc`, `pnpm-workspace.yaml:48`, a new gate in `ci:static`.
  Do: move all eight keys to `pnpm-workspace.yaml` in camelCase (`minimumReleaseAge: 4320`, `nodeLinker`, `hoist`, `publicHoistPattern`, `autoInstallPeers`, `linkWorkspacePackages`, `preferWorkspacePackages`, `saveExact`); delete `.npmrc` if nothing else needs it (keep only npm-specific keys otherwise); gate asserts `pnpm config get minimumReleaseAge` is `4320` and that `.npmrc` holds no key pnpm answers `undefined` for. Do NOT run `pnpm install` in your worktree — the layout change (`hoisted`) is the user's to apply in the primary; say so in the report.
  Check: `pnpm config get minimumReleaseAge` → `4320` in the worktree; the gate exists and passes.

- **W9-04 · P1 · S · The release workflow derives the base version the way `release.sh` does.**
  Files: `.github/workflows/publish.yml:162,418`, `tooling/scripts/release.sh:139-149` (read), `tooling/scripts/check-publishable-set.mjs`.
  Do: `git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*'` in both steps; port the tag-vs-`packages/server/package.json` agreement check; the gate asserts both release files use the same expression.
  Check: `grep -n "sort=-v:refname" .github/workflows/publish.yml` → 0; the gate fails when one expression is changed.

- **W9-05 · P1 · M · The server reads `x-rebase-schema` and names drift.**
  Files: `packages/server/src/api/contract-routes.ts:110,133`, the data-API middleware, `website/src/content/docs/docs/compatibility.md:178-183` (+5 locales) (keep the promise, make it true).
  Do: on a request whose header names a schema stamp older than the server's, attach the drift as the error cause on a 400/404 for a renamed/missing field (do not refuse valid requests).
  Check: server test: a stale header + unknown field → response carries a `SCHEMA_DRIFT` cause naming both stamps; a fresh header behaves as today.

- **W9-06 · P1 · S · The CLI checks the Node floor before importing its bundle; the scaffold is `engineStrict`.**
  Files: `packages/cli/bin/rebase.js`, `packages/cli/templates/template/pnpm-workspace.yaml` (or `.npmrc` for npm), `packages/cli/src/commands/doctor.ts:169` (reuse `checkNodeVersion`'s floor).
  Check: CLI test: below-floor Node exits 1 naming the floor; `pnpm install` in a scaffold with `engines.node >=99` fails.

- **W9-07 · P1 · S · The quickstart's Node line names one number; `check:floors` rejects a second.**
  Files: `website/src/content/docs/docs/getting-started/quickstart.md:27` (coordinate: W2 and W5-08 also touch this line — W5-08 owns the edit; you own the gate), `tooling/scripts/check-declared-floors.mjs`.
  Check: the gate fails when a second Node version appears on that line.

- **W9-08 · P2 · S · One chalk, one dotenv, in every user install.**
  Files: `packages/server-postgres/package.json:64` (chalk 5), `tooling/scripts/check-undeclared-deps.mjs` (rule: no two publishable packages declare disjoint major ranges for one dependency).
  Check: pack all publishable packages into a scratch project → `ls node_modules/.pnpm | grep -E '^(chalk|dotenv)@'` → one each; the rule fails on a planted disjoint range. Record that the primary needs a lockfile update (do not run `pnpm install`).

- **W9-09 · P2 · S · A missing atlas binary is diagnosed where it bites.**
  Files: `packages/server-postgres/src/cli-helpers.ts:18-33` (`diagnoseMissingBin` resolves the package dir before concluding "blocked"), `packages/server-postgres/README.md` (the `allowBuilds` entry), `packages/cli/src/commands/doctor.ts` (atlas binary check).
  Check: unit case "binary on disk, `.bin` link absent" → no "blocked" verdict; `rebase doctor` reports the atlas binary state.

- **W9-10 · P3 · S · Floors and subpath scans cover every publishable root.**
  Files: `tooling/scripts/check-declared-floors.mjs:118` (derive from `publishablePackages()`), `tooling/scripts/check-subpath-imports.mjs:88` (add `tooling/rebase-agent-skills`, `app/`, `examples/`, `website/public/llms*.txt`), `tooling/rebase-agent-skills/package.json` (`engines`).
  Check: both gates pass; each fails on a planted counterexample in a newly covered root.

- **W9-11 · P3 · S · `check:release-bump`'s message matches what `init` writes; READMEs say ESM-only.**
  Files: `tooling/scripts/check-release-bump.mjs:7` + runtime message, `packages/*/README.md` (one sentence each).
  Do: fix the text (exact pins); do NOT change the pin style — list the `~` question for the user.
  Check: `grep -n '\^0.17.0' tooling/scripts/check-release-bump.mjs` → 0; `grep -Li 'ESM' packages/*/README.md` → none.

## W10 Contributor experience and CI parity

Branch `fix/ci-parity-and-contributor-setup`. Sweep 10. Files: `CONTRIBUTING.md`,
`app/backend/docker-compose.yml`, `app/.env.example`, `tooling/scripts/{verify-quality.sh,ci-static.mjs,check-contributor-setup.mjs,check-gates-doc.mjs}`,
a new `tooling/scripts/ci-build-gates.mjs`, `.github/workflows/verify.yml`
(`build-gates` job only — W8-08 adds one step elsewhere in the file), `tsconfig.tests.json`,
`docs/**` (root docs), `eslint.config.mjs`. Decision pre-made: W14-04 (branch
protection) stays the user's call — do not touch repository settings.

- **W10-01 · P0 · S · The contributor compose database cannot be shadowed silently.**
  Files: `app/backend/docker-compose.yml:27`, `app/.env.example:14`, `CONTRIBUTING.md:46`, `tooling/scripts/check-contributor-setup.mjs:50-56`.
  Do: publish `${REBASE_DB_PORT:-5432}:5432` and read the same variable in `.env.example`/the URL; `check:contributor-setup` gains a `--live` mode (used by the e2e job) that starts compose, connects on the documented URL and asserts it reached the container (a marker written at container init); CONTRIBUTING step 3 says what to do when 5432 is taken.
  Check: with a squatter on `127.0.0.1:5432`, `REBASE_DB_PORT=5499 docker compose up -d db` + the documented URL reaches the container; the live check fails when the marker is absent.

- **W10-02 · P1 · M · `ci:build-gates` mirrors `ci:static`; the pre-PR command runs what CI runs.**
  Files: new `tooling/scripts/ci-build-gates.mjs` (a `GATES` array with the `why` text moved out of the YAML), `.github/workflows/verify.yml` `build-gates` job → one step, `tooling/scripts/verify-quality.sh:41-98` step 3, `.github/PULL_REQUEST_TEMPLATE.md:16-18`, `CONTRIBUTING.md:147-170`, `tooling/scripts/check-gates-doc.mjs` (every gate in the "static"/"after the build" tables appears in the matching runner).
  Check: the `comm` in sweep 10 is empty; `pnpm ci:build-gates --list` equals the former YAML step list; `check:gates-doc` fails when a gate is in a table and in no runner.

- **W10-03 · P1 · S · The `.d.ts` half of `check:types-headless` runs after a build and refuses a vacuous run.**
  Files: `tooling/scripts/headless-guard/check-types.mjs:129-131`, `tooling/scripts/ci-static.mjs:63-77`, `ci-build-gates.mjs` (W10-02).
  Do: split: source half stays static; declaration half runs in build-gates and exits 1 when no `packages/*/dist` exists.
  Check: `rm -rf packages/types/dist && pnpm check:types-headless:dts` exits 1 with "no dist"; the planted `import React` in a built `.d.ts` fails.

- **W10-04 · P1 · S · Every `@ts-expect-error` is in a tsc program.**
  Files: `tsconfig.tests.json` (add `packages/server/test/auth-config-types.test.ts` and the other type-only files individually), the 8 files with inert annotations (sweep 10 lists them: server 4, cli 5, client 1 — locate with the gate), a new gate `check:ts-expect-error-coverage` in `ci:static`.
  Check: `tsc --noEmit -p tsconfig.tests.json --listFiles | grep auth-config-types` → 1; the gate fails when a file with `@ts-expect-error` is in no program.

- **W10-05 · P2 · S · `docs/verification.md` and CONTRIBUTING name the suites that actually run, and the gates register covers e2e `run:` lines.**
  Files: `docs/verification.md:312-321`, `CONTRIBUTING.md:205-223`, `tooling/scripts/check-gates-doc.mjs` (read the e2e jobs' `run:` lines).
  Check: every `tests/e2e/tests/*.ts` and `test:e2e` invocation in `verify.yml` is named in CONTRIBUTING or `docs/gates.md`; the gate fails on an unlisted one.

- **W10-06 · P2 · S · Relative links in the root docs resolve; a gate keeps them so.**
  Files: the 62 links in `docs/plans/*.md` and `docs/audits/*.md` (sweep 10 lists the files), a new `check:doc-links` in `ci:static` (shape of `check-ui-string-paths.mjs`) covering `docs/**`, `.agent/**`, `.github/**`, `README.md`, `CONTRIBUTING.md`.
  Check: the gate reports 0; it fails on a planted bad link.

- **W10-07 · P2 · S · `docs/bug-classes.md` points at the runners and records yesterday's classes; numbering is unique.**
  Files: `docs/bug-classes.md:3-4,2879,2958`, `docs/gates.md`.
  Do: point at `ci-static.mjs`/`docs/gates.md`; add one entry per root-cause class from `docs/plans/dx-sweep-2026-09-05-tasks.md`'s preamble (seven) and one for today's (the tasks doc lists them); renumber the duplicate `## 50.`; a one-line check that class numbers are unique and contiguous.
  Check: `grep -c '^## ' docs/bug-classes.md` equals the highest number; the check fails on a duplicate.

- **W10-08 · P3 · S · CONTRIBUTING gains a worktree section and the two missing structure rows.**
  Files: `CONTRIBUTING.md:76-85`, `tooling/scripts/link-worktree-modules.sh:5-6` (point the comment at the new section).
  Check: `grep -n "link-worktree-modules" CONTRIBUTING.md` → 1; `contracts/` and `infra/` rows exist.

- **W10-09 · P3 · S · `eslint.config.mjs` states why three roots are ignored, or lints them.**
  Files: `eslint.config.mjs:40-42`, `docs/gates.md:71`.
  Check: each ignore has a reason line; `pnpm check:lint` passes.

- **W10-10 · P2 · S · The user's call (do not do): branch protection on `main`.**
  Do: nothing. List it in the report with the `gh api` evidence so the user can decide.

## W11 Website and marketing

Branch `fix/website-dead-routes-and-claims`. Sweep 12. Files: `website/**`
(components, scripts, i18n, pages, public), `tooling/scripts/docs-verify/check-rls-check-count.mjs`,
`check-docs-links.mjs`, `check-marketing-snippets.mjs`, `docs/bug-classes.md` (W10-07
renumbers it — do NOT touch that file here). W5 owns the docs content; you own
`website/src/content/docs/docs/deployment/index.md` (new) and the six
`frontend/styling.md` + five `backend/mongodb.md` link edits.

- **W11-01 · P0 · S · `/docs/deployment` exists in all six docs locales.**
  Files: new `website/src/content/docs/docs/deployment/index.md` (+5 locales), `website/astro.config.mjs` sidebar if needed.
  Do: an index page that introduces the section and links every sub-page (the sidebar group already implies it). Do not re-point the CTA.
  Check: `pnpm -C website build` emits `dist/docs/deployment/index.html` and the five locale equivalents.

- **W11-02 · P0 · S · `check:site` resolves links to real files, case-sensitively, over the whole of `dist`.**
  Files: `website/scripts/check_site.mjs:41-46`.
  Do: build a `Set` of actual relative file paths from the `dist` walk; `routeExists` is membership in that set (case-sensitive) or `statSync(p).isFile()`; run the link check over docs pages too (site chrome). Add a self-test fixture: a link to an empty directory must fail.
  Check: with W11-01/04/06/08 unapplied, the gate reports `/docs/deployment`, `/it`, `/pt`, `/docs/ui/components/Card`; after them, 0.

- **W11-03 · P0 · S · The check count is derived everywhere it is printed.**
  Files: `website/scripts/generate_llms_txt.js:359`, `website/scripts/generate_og_images.mjs:63`, `website/public/llms.txt`, `website/public/img/og/rls-check.png` (regenerate), `tooling/scripts/docs-verify/check-rls-check-count.mjs:60-81`.
  Do: read the number from `packages/rls-check/src/checks/` (count of modules) in both generators; the OG card uses the safe command form (no `$DATABASE_URL`); the count gate globs `website/scripts/**`, `website/public/llms*.txt`, `website/src/pages/**`, `website/src/utils/**`, `**/*.mdx`.
  Check: `grep -rn -i "f0urteen" (spelled out; the old count word) website/public/llms.txt website/scripts` → 0; the gate fails on a planted old-count-word + " checks" in `website/src/pages/x.astro`.

- **W11-04 · P0 · S · The docs logo links to a page that exists for every locale.**
  Files: `website/src/components/starlight/SiteTitle.astro:6`, `website/src/i18n/ui.ts` (`languages` map).
  Do: locales without a marketing home (`it`, `pt`) link `/{locale}/docs/`.
  Check: `grep -rl 'href="/it"' website/dist --include=index.html | wc -l` → 0 after a build.

- **W11-05 · P1 · S · No hard-coded dev ports on marketing pages.**
  Files: `website/src/components/pages/CliContent.astro:22`, `website/src/components/demos/InteractiveDemo.tsx:74,273`, `website/src/components/demos/RebaseMosaicDemo.tsx:654`, `tooling/scripts/docs-verify/check-marketing-snippets.mjs`.
  Do: derived-port wording; a denylist entry for `:3001`/`:5173`/`localhost:3001` outside a sentence containing "derived".
  Check: `grep -rn "localhost:3001\|:3001\b" website/src/components` → only lines containing "derived"; the gate fails on a planted `:3001`.

- **W11-06 · P1 · S · Every marketing route has a `.md` mirror and a sitemap row.**
  Files: `website/src/pages/[...lang]/[page].md.ts:5-21`, `website/scripts/generate_sitemap_md.js`, a check in `check_site.mjs` (`set(src/pages/[...lang]/*.astro) == set(PAGES) ∪ {index}`).
  Check: `grep -ci pricing website/dist/sitemap.md` ≥ 1; `ls website/dist/*.md | wc -l` equals the number of English marketing routes.

- **W11-07 · P1 · S · Dead links and missing images are caught in every locale.**
  Files: `tooling/scripts/docs-verify/check-docs-links.mjs:21-22,52-56`, `website/src/content/docs/{de,es,fr,it,pt}/docs/backend/mongodb.md:23`, `website/src/content/docs/*/docs/frontend/view-modes.md:50,56,82,192`, `*/docs/collections/relations.md:196,200`, `*/docs/frontend/styling.md:42`.
  Do: run the resolver over every locale against that locale's route set; resolve `![](/…)` targets against `website/public`; compare href case to the emitted path; fix the five `mongodb.md` links; delete the six placeholder `<img>` tags (36 across locales) — do not capture screenshots; write `/docs/ui/components/card/` in the six styling pages.
  Check: the gate reports 0 in all six locales; it fails on a planted `/docs/nope` in `de/`.

- **W11-08 · P1 · S · The scheduled 15 Sep post makes no count claims that can rot.**
  Files: `website/src/content/blog/2026-09-15-every-check-in-our-ci-is-a-post-mortem.md:8,12`.
  Do: state the claims without the two numbers (or compute them at build time — pick the former).
  Check: `grep -n "F0urteen gates\|fifty entries" (the old count words) website/src/content/blog/2026-09-15-*.md` → 0.

- **W11-09 · P2 · S · `/compare` meta description is translated; `check:site` checks descriptions.**
  Files: `website/src/pages/[...lang]/compare.astro:18`, `website/src/i18n/{en,de,es,fr}.ts` (`comparepage.meta.description`), `website/scripts/check_site.mjs` (`untranslated-description`).
  Check: `grep -h 'name="description"' website/dist/{de,es,fr}/compare/index.html` → three different sentences; the gate fails on a planted English description in `de`.

- **W11-10 · P2 · S · Marketing pages emit `hreflang` alternates; noindex pages leave the sitemap.**
  Files: `website/src/layouts/Layout.astro`, `website/astro.config.mjs` (sitemap `filter`), `website/scripts/check_site.mjs` (one alternate per marketing locale + `x-default`; noindex ⇒ not in sitemap).
  Check: `grep -c 'rel="alternate"' website/dist/index.html` ≥ 5; `grep -c pitch website/dist/sitemap-0.xml` → 0.

- **W11-11 · P3 · S · `europe.13` names both accepted variables; the security page vocabulary is a written decision.**
  Files: `website/src/i18n/en.ts:694` (+3 locales), `website/SITE-STORY.md` (record the carve-out for the security page — do not rewrite the page).
  Check: `grep -n "CORS_ORIGINS" website/src/i18n/en.ts` shows the "or `FRONTEND_URL`" wording; `SITE-STORY.md` names the carve-out.

## W12 Auth, cookies, OAuth env, rls-check guidance

Branch `fix/auth-env-and-rls-check-guidance`. Sweep 08. Files: `packages/server/src/auth/*`,
`packages/server/src/boot/{env,options}.ts`, `packages/rls-check/**`,
`website/.../backend/authentication.md`, `getting-started/configuration.md:109`,
`docs/rls-check.md`. W2 owns `seed-admin.ts`/`init.ts`; W3 owns `logger.ts`; W5 owns
the rest of `configuration.md` — make one-line edits there and list them.

- **W12-01 · P1 · M · rls-check prescribes the collection rule for Rebase-managed policies.**
  Files: `packages/rls-check/src/checks/policy-always-true.ts` (and siblings that emit `ALTER POLICY`), `packages/server-postgres/src/schema/ensure-collection-policies.ts:117` (read), `website/src/content/docs/docs/rls-check.md` (+5 locales), `docs/rls-check.md`.
  Do: when a finding's policy is Rebase-shaped (hash-suffixed name, `rebase.uid()`/`rebase.roles()` in its body), the fix text says "this policy is derived from the collection's `securityRules` and re-applied at boot — change the rule" and links `/docs/collections/security-rules`; the docs say the same and acknowledge that the stock scaffold's open read rules produce findings by design (the CI snippet mentions `--skip` or a real rule).
  Check: a test scanning a freshly provisioned scaffold DB asserts the expected finding set and that each Rebase-managed finding's fix names the rule, not `ALTER POLICY`.

- **W12-02 · P1 · S · The refresh cookie's `secure` behaviour is documented as it is, with an escape hatch.**
  Files: `packages/server/src/auth/cookie-utils.ts:47`, `packages/server/src/boot/env.ts` (`AUTH_COOKIE_SECURE`), `packages/server/src/boot/options.ts:140`, `website/src/content/docs/docs/backend/authentication.md:124` (+5 locales), `getting-started/configuration.md` (one row).
  Do: keep `Secure` the default; `AUTH_COOKIE_SECURE=false` opts out for plain-http deployments with a boot warning; the doc row says "secure by default; `AUTH_COOKIE_SECURE=false` for plain http".
  Check: test: default → `Secure`; `AUTH_COOKIE_SECURE=false` → no `Secure` flag and a warning; the doc table row is asserted against `getCookieSettings` in a test.

- **W12-03 · P1 · S · The MFA key sentence in the env reference matches the code.**
  Files: `website/src/content/docs/docs/getting-started/configuration.md:109` (+5 locales).
  Check: the sentence describes the `JWT_SECRET` fallback and its warning, as `deployment.md:195` does.

- **W12-04 · P1 · M · Every OAuth provider has its env pair on the managed runtime.**
  Files: `packages/server/src/boot/env.ts:118-123`, `packages/server/src/boot/options.ts:147-163`, `packages/server/src/auth/*-oauth.ts` (12), `website/src/content/docs/docs/backend/authentication.md:27,311-325` (+5 locales), a gate enumerating `*-oauth.ts` factories against the env schema.
  Do: add the nine missing `<PROVIDER>_CLIENT_ID`/`_CLIENT_SECRET` pairs to the zod schema and `resolveAuthOptions`; the gate fails when a provider file exists with no env pair.
  Check: `DISCORD_CLIENT_ID/SECRET` set → `GET /api/auth/config` lists `discord`; the gate fails on a planted `foo-oauth.ts`.

- **W12-05 · P2 · S · The rls-check docs page and its PT translation stop telling users to percent-encode.**
  Files: `website/src/content/docs/docs/rls-check.md:45`, `website/src/content/docs/pt/docs/rls-check.md:44` (+ the other four if they carry it), `tooling/scripts/docs-verify/check-rls-check-flags.mjs`.
  Do: match the README wording; extend the stage to the connection-string paragraph.
  Check: `grep -rn "percent" website/src/content/docs/*/docs/rls-check.md` → 0; the stage fails on a planted "encode the @".

## W13 Database operations: push, migrate, pull, branches

Branch `fix/db-push-migrate-and-remedies`. Sweep 13. Files:
`packages/server-postgres/src/{cli.ts,cli-flags.ts,cli-helpers.ts}`,
`packages/server-postgres/src/schema/generate-postgres-ddl.ts`,
`packages/server-postgres/src/services/BranchService.ts`,
`packages/server/src/api/errors.ts:300,351,407`, `packages/cli/src/commands/db.ts:641`
and the branch delete/list paths, template `.gitignore`. W1 owns `dev.ts`, the
`--docker` push (W1-02), doctor (W1-05), `db branch switch` (W1-07), `schema stale`
(W1-10) and `db url` flags (W1-09) — do not redo those; both of you edit `db.ts`
in different regions, keep your hunks small.

- **W13-01 · P0 · S · `db push --dry-run` is accepted, and the flag spec cannot drift from the help.**
  Files: `packages/server-postgres/src/cli-flags.ts:45-51`, `packages/server-postgres/test/cli-flags.test.ts:41`, `DB_ACTION_HELP` usage strings.
  Do: add `"--dry-run": Boolean`; derive the test fixture (or the spec) from the usage strings so every documented flag is accepted and every accepted flag is documented.
  Check: `rebase db push --dry-run` prints the plan and applies nothing (verify with a Docker Postgres: no tables after); the test fails when a flag is added to help but not the spec.

- **W13-02 · P0 · S · A failed DDL generation aborts `db push`.**
  Files: `packages/server-postgres/src/schema/generate-postgres-ddl.ts:127-129,173`, `packages/server-postgres/src/cli.ts:363`.
  Do: rethrow / `process.exitCode = 1`; the generation error is the last thing printed; nothing stale is applied.
  Check: unit test: a throwing resources load makes the generator exit non-zero; `rebase db push` with an unresolvable `resources.ts` exits 1 without `completed successfully`.

- **W13-03 · P0 · M · `db migrate` can baseline a database boot has already provisioned.**
  Files: `packages/server-postgres/src/cli-flags.ts:59`, `packages/server-postgres/src/cli.ts` (migrate handler), `website/src/content/docs/docs/cli/schema.md:261` (+5 locales), `DB_ACTION_HELP`.
  Do: accept `--baseline <version>` (Atlas `migrate set`/`--baseline`); on `42710`/`42P07` from `migrate apply` print "this database already has the schema — record it with `rebase db migrate --baseline <version>`"; the doc's step 6 says when a baseline is needed.
  Check: e2e: boot a scaffold against Docker Postgres, `db generate init && db migrate` → the named remedy; `db migrate --baseline <v>` then `db migrate` → exit 0.

- **W13-04 · P1 · S · `db pull` targets the database `db url` prints.**
  Files: `packages/cli/src/commands/db.ts:641`.
  Do: `const target = prepared.database.url`.
  Check: cli test with `DATABASE_URL` only in `.env`: `db pull --from … --yes` reaches the driver.

- **W13-05 · P1 · S · The Atlas scratch-database failure names its cause and remedy.**
  Files: `packages/server-postgres/src/cli-helpers.ts:296-317`.
  Do: report the caught error; on `42501` say "grant CREATEDB, or create `<db>_dev_diff` by hand"; also drop the scratch database after a successful push (the P3).
  Check: unit test on `ensureDevDatabaseExists` with a client that throws `42501` → the remedy; after `db push`, `<db>_dev_diff` does not exist.

- **W13-06 · P1 · S · The `SCHEMA_DRIFT` remedy matches the data source's kind.**
  Files: `packages/server/src/api/errors.ts:300,351,407` (model: `packages/cli/src/commands/dev.ts:1082-1091`).
  Check: test: drift message for a PGlite-backed source does not contain `db:push` and says restart `rebase dev`; for an external source it names `rebase db push`.

- **W13-07 · P1 · S · A missing `--collections` path is fatal before anything is written; printed once.**
  Files: `packages/server-postgres/src/cli-helpers.ts:253`, the generator re-entry points.
  Check: `rebase db push --collections ./nope` exits 1, prints the warning once, and `drizzle/schema.sql` + `schema.generated.ts` are byte-identical to before.

- **W13-08 · P1 · S · Backups are gitignored in the scaffold.**
  Files: `packages/cli/templates/template/gitignore` (`backups/`, `*.dump`).
  Check: scaffold test: `rebase db backup` output is ignored by `git check-ignore`.

- **W13-09 · P2 · S · Branch delete/list know which branch you are on.**
  Files: `packages/cli/src/commands/db.ts` (branch delete/list), `packages/server-postgres/src/services/BranchService.ts:227,249`.
  Do: deleting the active branch says "you are on branch X — `rebase db branch switch --off` first"; `list` reads `rebase.branches` from the parent when a pointer is active.
  Check: `switch feature_x && branch delete feature_x` → the sentence; `branch list` on a branch lists it.

- **W13-10 · P2 · S · Two Atlas failures get remedies: NOT NULL on a populated table, enum label removal.**
  Files: `packages/server-postgres/src/cli.ts` (push error mapping), `packages/server-postgres/src/cli-helpers.ts`.
  Do: on `23502` name the table, the column, the row count and the three ways out (default, backfill, optional); on the enum-drop error say boot-ensure adds labels and never removes them, and how to retire one.
  Check: tests mapping both raw errors to the remedies.

- **W13-11 · P2 · S · `--docker` on a `db` subcommand starts (or names) the container; `dev` does not start compose for a mistyped `DATABASE_URL`.**
  Files: `packages/cli/src/commands/db.ts` (`--docker` handling), `packages/cli/src/utils/dev-preflight.ts` (the "database not running — starting it" branch).
  Do: `db … --docker` runs the same ensure step `dev --docker` does, or refuses with "`rebase dev --docker` starts it"; the preflight starts compose only when the `.env` URL points at the compose port, otherwise says "DATABASE_URL points at 127.0.0.1:3139 and nothing listens there".
  Check: `rebase db branch list --docker` on a scaffold → a diagnosis or a running container, not `ECONNREFUSED` alone; a closed-port `DATABASE_URL` → no container started, the remedy names the URL.

- **W13-12 · P3 · S · `db stop`/`db reset` copy names the managed database.**
  Files: `packages/cli/src/commands/db.ts`.
  Check: on a project with an external `DATABASE_URL`, both say "the managed development database (PGlite) was not running; your DATABASE_URL is untouched".

## W14 Upgrade path: unreleased APIs in live docs, the upgrade guide, skew errors

Branch `fix/upgrade-path-badges-and-skew-errors`. Sweep 15. Files:
`website/.../backend/custom-server.md`, `backend/multiple-sources.md`, `cli/index.md`,
`website/.../upgrading/*`, `tooling/scripts/docs-verify/{check-unreleased-badges,check-upgrade-coverage}.mjs`,
`tooling/scripts/check-release-bump.mjs`, `packages/cli/src/resources/derive.ts:297`,
`packages/cli/src/commands/{build,generate_sdk,doctor}.ts`, the baas overlay
`package.json`. W5-04 widens `check-unreleased-badges.mjs`'s lead-in grammar and
W5-10 merges the `[Unreleased]` sections — you add ONE shape to the badge gate and
ONE bullet to the CHANGELOG; expect the integrator to combine. W5-08/W9-07 own the
Node-floor carve-out sentence; do not touch it.

- **W14-01 · P0 · S · Every unreleased export the live docs teach carries a `Since 0.18` badge, and the gate sees import-shaped APIs.**
  Files: `website/src/content/docs/docs/backend/custom-server.md:27` (section), `backend/multiple-sources.md:234-250` (`## Topics and queues`), `cli/index.md:322` (+5 locales each), `tooling/scripts/docs-verify/check-unreleased-badges.mjs:55-60`.
  Do: badge the three sections; add a shape that extracts identifiers from `import { … } from "@rebasepro/*"` in an Unreleased lead-in (so `z`, `queue`, `amendResourceKind`, `isRelationRequired`, `relationDeclaringProperty` are tokens).
  Check: `node tooling/scripts/docs-verify/check-unreleased-badges.mjs` lists the five identifiers as tokens and fails when the `custom-server.md` badge is removed.

- **W14-02 · P1 · M · `[Unreleased]` Breaking entries have an upgrade-guide destination.**
  Files: `tooling/scripts/docs-verify/check-upgrade-coverage.mjs:61`, new `website/src/content/docs/docs/upgrading/0-17-to-next.mdx` (+5 locales; short), `website/src/content/docs/docs/upgrading.mdx:11-15`, `website/astro.config.mjs` sidebar.
  Do: the gate treats `[Unreleased]` as a version and requires the `next` page whenever it carries `### Breaking`; the page covers every Breaking bullet in the section today (RESTRICT default, `defineCollection` single signature, relation `validation` move, first-admin window, after-hook throw → 400, `rebase.data` removal, Node floor) with one migration line each.
  Check: the gate fails when the page is deleted; `grep -c "^## " upgrading/0-17-to-next.mdx` equals the number of Breaking bullets.

- **W14-03 · P2 · S · The Node floor change is in the changelog and gated.**
  Files: `website/src/content/docs/docs/CHANGELOG.md` (`### Breaking` bullet naming `>=22.22.0` and `.nvmrc`), `tooling/scripts/check-release-bump.mjs`.
  Do: extend the gate: any diff to an `engines` field in a publishable package since the last tag with no `[Unreleased]` bullet mentioning `engines`/`Node` is a failure.
  Check: the bullet exists; the gate fails when it is removed.

- **W14-04 · P2 · S · A version skew is named as a version skew.**
  Files: `packages/cli/src/resources/derive.ts:297`, `packages/cli/src/commands/{status,resources,build}.ts` (they render the issue).
  Do: on `does not provide an export named X` / `ERR_MODULE_NOT_FOUND` from a `@rebasepro/*` specifier, read the installed package version and the CLI's own and print `@rebasepro/types 0.17.3 is installed; this CLI is <v>. Run pnpm add @rebasepro/types@<v>` (or the reverse when the CLI is older).
  Check: unit test on the issue formatter with a synthetic named-export error → the sentence names both versions.

- **W14-05 · P2 · S · Headless scaffolds ship only scripts that can succeed.**
  Files: `packages/cli/templates/overlays/baas/package.json` (`generate:sdk`), `packages/cli/src/commands/generate_sdk.ts`, `packages/cli/src/commands/doctor.ts`, `tooling/scripts/check-templates.mjs`.
  Do: in a project with no `config/collections`, both commands say "this project derives its API from the database — run `rebase schema introspect` first" and exit 0; `check:templates` asserts every scaffolded script exits 0 on the tree it is scaffolded into (scaffold each template into a temp dir in the gate).
  Check: `rebase generate-sdk` and `rebase doctor` in a headless scaffold exit 0 with the sentence; the gate fails on a planted `"nope": "exit 1"` script.

- **W14-06 · P3 · S · No dangling `schema ` in the build summary.**
  Files: `packages/cli/src/commands/build.ts:197`.
  Check: headless `rebase build` summary line has no trailing `schema `; snapshot test.

## W15 Errors and logging: causes, ports, the boot banner

Branch `fix/request-errors-and-boot-banner`. Sweep 14. Files: `packages/server/src/api/errors.ts:387`,
`packages/server-postgres/src/websocket.ts:175`, `packages/server/src/utils/dev-port.ts:183-197`,
`packages/cli/src/commands/dev.ts:865,902`, `packages/cli/bin/rebase.js`,
`docs/troubleshooting.md` + `website/.../docs/troubleshooting.md`, `tooling/scripts/docs-verify/*`.
W1 edits `dev.ts` (W1-03, W1-11) and `dev-port.ts` (W1-08); W3 edits the logger and
`dataService`/`realtimeService` (W3-09/10); W4 owns `check-error-codes.mjs` and the
`notFound` envelope. Keep your hunks in those files tiny.

- **W15-01 · P1 · S · The request-path error handler keeps the cause chain.**
  Files: `packages/server/src/api/errors.ts:387`.
  Do: `logger.error("unhandled request error", { error })` so `serialiseError` walks `.cause` and redacts.
  Check: server test throwing a two-level cause through `errorHandler` asserts the sink saw `error.cause.message`.

- **W15-02 · P1 · S · The websocket raw-SQL debug goes through the logger.**
  Files: `packages/server-postgres/src/websocket.ts:175` (W3-09 covers `dataService`/`realtimeService`; this is the third site).
  Check: `LOG_LEVEL=warn` produces no `Executing raw SQL` from the websocket path; test.

- **W15-03 · P1 · S · An explicit `--port` binds or fails; only the derived port walks.**
  Files: `packages/server/src/utils/dev-port.ts:183-197` (`findAvailablePort` gains an `explicit` flag), `packages/cli/src/commands/dev.ts:865,902` (pass it; the `↳ PORT` line is W1-11's — do not move it).
  Check: CLI test: `--port` on a busy port exits non-zero naming the port; no `--port` still walks.

- **W15-04 · P2 · S · The boot log names host, port and database on success.**
  Files: `packages/cli/src/commands/dev.ts` (the `↳ Database =` line) or `packages/server/src/boot/boot.ts` (the ready line).
  Do: print `host:port/dbname` (never the password) next to the database line on the success path.
  Check: dev-command test asserting the banner contains the parsed host and database name for an external URL, and "managed (PGlite)" plus the socket/port for the managed one.

- **W15-05 · P1 · S · "Reading a boot error" explains `[redacted]`; `defineFunction` import is consistent.**
  Files: `docs/troubleshooting.md:14-29,170`, `website/src/content/docs/docs/troubleshooting.md:174` (+5 locales), a docs stage in `tooling/scripts/docs-verify/` flagging `defineFunction` imported from the `@rebasepro/server` root in any docs page.
  Do: one paragraph naming `REBASE_LOG_RAW_QUERIES=true` (W3-08 owns the configuration-page row and the marker text — do not duplicate); the troubleshooting sentence says `@rebasepro/server/functions`.
  Check: `grep -n "REBASE_LOG_RAW_QUERIES" docs/troubleshooting.md` → 1; the stage fails on a planted root import.

- **W15-06 · P3 · S · `--debug` / `REBASE_DEBUG` appear in `rebase --help`.**
  Files: `packages/cli/bin/rebase.js:134,144`, the root help Options block, the help/flag drift test.
  Check: `rebase --help | grep -c debug` ≥ 1; the drift test covers the root.

- **W15-07 · P2 · S · The `PG_<SQLSTATE>` family and `x-request-id` promise are true (coordination).**
  Do: nothing — W4-05 documents the family and W4-06 fixes the envelopes. Listed so the report can point there.

## W16 Cross-cutting: OpenAPI parity, flag vocabulary, `--json`, unknown commands

Branch `fix/openapi-parity-and-flag-vocabulary`. Sweep 16. Files:
`packages/server/src/api/openapi-generator.ts`, `packages/server-postgres/src/cli-flags.ts:61-82`,
`packages/cli/src/commands/{db,doctor,telemetry,api-keys,status,resources}.ts` (small hunks —
W1, W13, W14 edit the same files), `packages/cli/src/utils/project.ts:370`,
`website/.../getting-started/configuration.md:68`, `cli/index.md`, `packages/cms-types/package.json`.
W7-13 owns `skills.ts`; W8-12/13 own the cloud family.

- **W16-01 · P1 · M · OpenAPI and the generated SDK describe the same collection.**
  Files: `packages/server/src/api/openapi-generator.ts:768-770,779-782,894-897`, `packages/server/test/openapi-*.test.ts` (add a numeric-id + relations fixture).
  Do: emit `belongsTo` as its wire key with the target id's type and the resolved relation as a `$ref`; many-to-many as an array of `$ref`; `excludeFromApi` is the only exclusion; one helper builds the `id` entry from the declared property for read, Input and Update.
  Check: test: for the fixture, the OpenAPI schema's property set equals the SDK `Row` key set, and `id` has one type across the three schemas; on the blog scaffold `jq '.components.schemas.Post.properties|keys'` includes `authorId`, `author`, `tags`.

- **W16-02 · P1 · S · `--out`/`--output` are one flag everywhere, and relative paths resolve where the user stands.**
  Files: `packages/server-postgres/src/cli-flags.ts:61-82` (schema specs gain `"--out": "--output"`), `packages/cli/src/commands/db.ts:46-105` (`takesPath` and `VALUE_FLAGS` include `--output`), `packages/cli/src/commands/db.test.ts` (parameterise over every alias), a unit test over all specs asserting a spec containing one of the pair contains both.
  Check: `rebase schema generate --out /tmp/x.ts` accepted; `rebase db backup --output ./backups` writes under the cwd.

- **W16-03 · P1 · S · `PORT` precedence is documented where it is read.**
  Files: `website/src/content/docs/docs/getting-started/configuration.md:68` (+5 locales), `packages/cli/src/commands/dev.ts` help text (name the rungs `--port` → shell `PORT` → affinity file → derived; `.env`'s `PORT` is not read), `resolveStartPort` prints the rung it used.
  Check: `rebase dev --help | grep -c "PORT"` ≥ 1; the doc sentence names the shell/`.env` distinction; the banner line says `(from --port)` / `(from PORT)` / `(derived)`.

- **W16-04 · P1 · S · `--json` means one JSON object on every exit of a command.**
  Files: `packages/cli/src/utils/project.ts:370` (the emitter), `packages/cli/src/commands/status.ts:137`, `packages/cli/src/commands/resources.ts:121`, a matrix test over every `--json`-bearing command's failure modes (`JSON.parse(stdout)`), `website/src/content/docs/docs/cli/index.md` (one paragraph: `--json` is the only switch outside the `cloud` family; `cloud` also switches off a TTY — state both).
  Do: route the resource-declaration failure through the emitter with `code: "resource_declaration_invalid"` and `issues[]`. Do NOT change the cloud family's off-TTY behaviour (list the unification for the user).
  Check: `rebase status --json` with a throwing collection file → exit 1 and parseable stdout with that code; the matrix test passes.

- **W16-05 · P1 · S · `rebase telemetry` rejects unknown flags; the coverage test fails a command with no spec.**
  Files: `packages/cli/src/commands/telemetry.ts:19`, `packages/cli/src/commands/help-coverage.test.ts`.
  Check: `rebase telemetry --frobnicate` → exit 1, unknown-option line; the test derives flag parsing from the dispatch and fails on a dispatched command without a spec (W7-13 and W8-12 satisfy it for their families — if they have not merged yet, mark those two families as pending in the test with a comment naming the task ids, not a permanent skip).

- **W16-06 · P2 · S · `rebase db branch --help` is derived from the driver; `doctor --help` lists its flag.**
  Files: `packages/cli/src/commands/db.ts:946-951` (`DB_ACTION_HELP.branch` — W13-01 derives the push spec from these strings; add `prune`, `--from`, `--force`, `--older-than` here or print the driver's `printBranchHelp` text), `packages/cli/src/commands/doctor.ts:290-308` (Options block with `--policies`), `help-coverage.test.ts` (third level: every `case` in the driver's `branch` switch appears in the page; every spec flag appears in its `--help`).
  Check: `rebase db branch --help | grep -c prune` ≥ 1; `rebase doctor --help | grep -c policies` ≥ 1; the test fails when a case is added without help.

- **W16-07 · P2 · S · `rebase api-keys <typo>` behaves like every other family.**
  Files: `packages/cli/src/commands/api-keys.ts:75-79`, `packages/cli/src/utils/unknown-command.ts`, a test asserting each family's unknown-subcommand output is one stderr line and empty stdout.
  Check: `rebase api-keys frobnicate 2>/dev/null | wc -c` → 0; exit 1.

- **W16-08 · P3 · S · `@rebasepro/cms-types` describes itself with the studio page's vocabulary; the dead `"settings"` mode is removed from the doc.**
  Files: `packages/cms-types/package.json` (description), `website/src/content/docs/docs/studio/index.md:24-30` (+5 locales).
  Check: `grep -n "admin-panel" packages/cms-types/package.json` → 0; the mode list names only modes something reads.

- **W16-09 · P2 · S · The user's call (do not do): MCP tool renames, short-flag collisions, `--collections-dir`, cloud off-TTY JSON.**
  Do: nothing. List in the report with the evidence file `sweep/scratch/16/flags-by-flag.txt` so the user can decide (renaming `list_documents` → rows and `rebase_schema_plan` → `rebase_db_push_dry_run` is a shipped agent-facing contract; `-f/-g/-c/-p` collisions; `--collections-dir` → `--collections`; one non-TTY rule).
