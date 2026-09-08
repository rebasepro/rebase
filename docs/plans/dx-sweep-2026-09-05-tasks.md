# DX sweep 2026-09-05: tasks

Status: **not started**. Source: the DX sweep of 2026-09-05 (183 findings, 31 P0,
against `main@9d59bfbc9` with the built 0.17.3 CLI). 195 tasks from 183
findings: the first-admin story is split by path, the docs report's coverage
gaps became tasks, and the two first-admin P0s (docs and production) are one
task. Nothing here has been applied.

How to use this file:

- One workstream = one branch. Tasks inside a workstream are ordered; a task
  that depends on another says so. Workstreams are independent of each other
  except where the header says otherwise.
- Every task is written to be handed to an agent on its own: files, the change,
  and the check that proves it. `Check` is the acceptance test, not a suggestion.
- Sizes: **S** under an hour, **M** an afternoon, **L** a day or more.
- Repo rules that apply to all of them: no back-compat shims (delete the old
  name), prefer a guard over a doc (put the check where it ships), run
  `pnpm verify:docs` and `pnpm -C website generate-all` after touching docs,
  never release or publish without being asked, `git -c core.fsmonitor=false`
  for anything git.

| Workstream | Tasks | P0 | Suggested branch |
| --- | --- | --- | --- |
| W1 First run and scaffold | 14 | 1 | `fix/first-run-revert-and-seams` |
| W2 Hook and function contracts | 15 | 3 | `fix/hook-contracts` |
| W3 Schema and collection typing | 15 | 2 | `fix/relation-required-and-typing` |
| W4 Client SDK and REST | 15 | 3 | `fix/logical-filter-codec-and-sdk-docs` |
| W5 Boot, runtime errors, logging | 15 | 1 | `fix/boot-errors-name-the-database` |
| W6 First admin and production docs | 9 | 5 | `fix/first-admin-everywhere` |
| W7 Cloud CLI and cloud docs | 16 | 4 | `fix/cloud-cli-help-and-docs` |
| W8 CLI core | 9 | 1 | `fix/cli-help-before-dispatch` |
| W9 Docs IA and the snippet verifier | 19 | 0 | `docs/ia-and-verifier` |
| W10 Admin panel and Studio | 15 | 4 | `fix/admin-docs-and-studio-states` |
| W11 MCP and agent skills | 15 | 4 | `fix/mcp-and-skills` |
| W12 rls-check | 8 | 0 | `fix/rls-check-role-and-docs` |
| W13 Packaging and install | 15 | 0 | `fix/packaging-contract` |
| W14 Contributor experience | 15 | 2 | `docs/contributing-to-green` |

Order of attack, if only one thing at a time: W1-01, then W2-01..03, W3-01..02,
W4-01, W5-01, W6 as a unit, then the rest by P0 count.

---

## W1 First run and scaffold

Branch `fix/first-run-revert-and-seams`. Do W1-01 first; several later tasks
disappear with it.

- **W1-01 · P0 · S · Revert `d55d17ad9` and re-apply the two later commits.**
  Files: git history.
  Do: `git revert d55d17ad9` (its own message asks for this), then re-apply
  `74e93bfbb` and `e28762b39` on top, resolving conflicts in favour of the
  later commits. Confirm `packages/cli/test/e2e/first-run.test.ts`,
  `packages/server-postgres/test/build-script-remedy.test.ts`,
  `detectProjectPackageManager`, and `"allowScripts": {"@ariga/atlas": true}`
  in both template `package.json`s are back, and `templates/template/npmrc`
  no longer carries `verify-deps-before-run` / `confirm-modules-purge`.
  Check: `pnpm --filter @rebasepro/cli test` runs `first-run.test.ts` green;
  `grep -rn "container" packages/cli/src/commands/init.ts` shows no "database
  container" wording; quickstart.md:24 in all six locales no longer lists Docker.

- **W1-02 · P1 · S · Remove `--no-install` from the docs or add it.**
  Files: `README.md:96`, `website/src/content/docs/docs/getting-started/quickstart.md:66`, `packages/cli/src/commands/init.ts:290-304`.
  Do: either add `--no-install` to `INIT_FLAGS` as an explicit alias of the
  default, or delete it from both docs. Prefer adding it: the flag reads
  naturally in CI.
  Check: `rebase init x --yes --no-install` exits 0 in the scratchpad.

- **W1-03 · P1 · M · Make `rebase dev --docker` work on a fresh scaffold.**
  Files: `packages/cli/src/dev-db/resolve.ts:126-130`, `dev-db/prepare.ts:123-127`, `packages/cli/src/utils/dev-preflight.ts:182-201`.
  Do: on `kind === "docker"`, derive the compose URL from `docker-compose.yml`
  and `DATABASE_PASSWORD` in `.env`, run the existing `ensureDevDatabase`
  path with it, and inject `DATABASE_URL` into the backend env. If that is not
  wanted, change every remedy that prints `--docker` (`dev-db/constraints.ts:130`,
  `db.ts:235,819`, `daemon-entry.ts:101`, `README.md:97`, quickstart:67) to
  "uncomment DATABASE_URL in .env, then rebase dev".
  Check: scaffold, `rebase dev --docker` with Docker running reaches "Server
  running at"; `prepare.test.ts:78` updated.

- **W1-04 · P1 · S · `--no-db` must not start PGlite.**
  Files: `packages/cli/src/commands/dev.ts:408-411,592,931`; `README.md:98`; quickstart.md:68.
  Do: gate `prepareDatabaseEnv` on `--no-db`; reword the two docs so "bring
  your own" means "set DATABASE_URL", and `--no-db` means "start nothing".
  Check: `rebase dev --no-db` creates no `.rebase/pglite*` and the backend
  fails with the DATABASE_URL message, not a managed DB.

- **W1-05 · P1 · M · One instruction for the first edit, and the one on screen works.**
  Files: `packages/cli/src/commands/dev.ts:783-806` (drift box), `dev.ts:747,771` (tsx watch), `packages/cli/templates/template/ai-instructions.md:14-16`, quickstart.md:174-178, `packages/server-postgres/src/services/collection-helpers.ts:106-130`.
  Do: regenerate `schema.generated.ts` from the collections watcher (call
  `ensureGeneratedSchema` when `../config/**` changes) so a saved property
  is writable without a restart; drop `rebase db push` from the drift box when
  `prepared.database.kind === "managed"`; make ai-instructions and the
  quickstart say the same single thing.
  Check: with `rebase dev` running, add a property to `posts.ts`, save a row
  with it from the admin: 200, not `VALIDATION_UNKNOWN_FIELDS`.

- **W1-06 · P1 · S · Generated README self-hosting section.**
  Files: `packages/cli/templates/template/README.md:150-160` vs `:19-20`, `docker-compose.yml:102-110`.
  Do: delete the "but not your collection tables" paragraph; add step 0
  "uncomment DATABASE_URL (the compose line) in .env"; make the section agree
  with the Quick Start above it.
  Check: follow the section on a stock scaffold with Docker; `db:push` runs
  against the compose DB, not PGlite.

- **W1-07 · P1 · S · The example script runs in the default scaffold.**
  Files: `packages/cli/templates/template/scripts/example.ts:24-26`, base root `package.json`, `overlays/baas/package.json:19,25,28-31`, `packages/cli/src/commands/generate_sdk.ts:441`.
  Do: copy the overlay's `dotenv`, `@rebasepro/client`, `tsx` deps and the
  `example` script into the base template; point the types import at
  `./generated/sdk/database.types`.
  Check: scaffold with install, `pnpm example` runs.

- **W1-08 · P1 · M · Headless first run: banner, URLs, stale references.**
  Files: `packages/cli/src/commands/dev.ts:130-137,431,437-447,896`, `overlays/baas/README.md:26,35-37,46,52-55`, `dev-db/daemon.ts:79`.
  Do: print a headless summary box with the API URL, `/api/swagger`, and the
  managed connection string (or add `rebase db url`); suppress "No frontend/
  directory found" when `rebase.json` declares no static app; rewrite the
  README's `localhost:3001`, `backend/src/index.ts` and "switch mode to cms"
  references.
  Check: `rebase init x --headless --yes && rebase dev` prints a box with a
  reachable swagger URL and no frontend warning.

- **W1-09 · P1 · S · `rebase dev --help` describes the managed path and lists its flags.**
  Files: `packages/cli/src/commands/dev.ts:918-950`, `dev-db/resolve.ts:10-18`.
  Do: list `--database-url` and `--docker`; rewrite the description from the
  resolution order in resolve.ts.
  Check: `rebase dev --help | grep -c "docker\|database-url"` is 2 or more; no
  mention of "docker-compose db service is started first".

- **W1-10 · P1 · S · Generated schema stub header names the right script.**
  Files: `packages/cli/templates/template/backend/src/schema.generated.ts:1-4`.
  Do: covered by W1-01; otherwise restore the header from `a3ad71d58`
  (`schema:generate`, not `db:generate`).
  Check: header says `pnpm schema:generate`.

- **W1-11 · P2 · S · Stop warning about the template's own PORT.**
  Files: `packages/cli/src/commands/dev.ts:628-648`, `templates/template/.env.example:40`.
  Do: skip the warning when `.env` PORT equals the template default, or stop
  writing PORT into the generated `.env`.
  Check: first `rebase dev` on a fresh scaffold prints no PORT warning.

- **W1-12 · P2 · S · Rewrite the DATABASE_URL header in `.env.example` for managed-by-default.**
  Files: `templates/template/.env.example:7-14`, `getting-started/configuration.md:26`, `init.ts:204`.
  Do: one header that says "unset = managed PGlite; set = your Postgres";
  configuration.md row becomes "Optional (managed database when unset)"; the
  interactive prompt names the managed database.
  Check: read the generated `.env` top to bottom; no "required" next to a
  commented-out line.

- **W1-13 · P2 · S · project-structure.md matches the template.**
  Files: `getting-started/project-structure.md:61-67,74,113,132`, `templates/template/frontend/src/App.tsx:15`, `templates/template/config/storage.ts:63`, `templates/template/README.md:139`.
  Do: show the template's real `App.tsx` (default export, `VITE_API_URL`
  with the DEV fallback or remove the fallback in both); remove controllers
  not in the scaffold; "restart" not "propagate automatically"; fix the two
  `backend/src/index.ts` references in the template.
  Check: `diff` between the doc's App.tsx block and the template is empty.

- **W1-14 · P2 · S · Init polish, six one-liners.**
  Files: `init.ts:186-199,335-336` (`--yes` defaults), `init.ts:896-975` (offline message), `templates/template/frontend/index.html:5` (favicon), `.gitignore` template (`generated/`), `dev.ts:437-441` (two URLs), template `rebase.json` (`npm run build --workspace`).
  Do: make `--yes` accept the interactive defaults or document that it does
  not; make the offline error say "could not reach the npm registry"; ship a
  favicon or drop the link; ignore `generated/`; print both URLs; use the
  project's package manager in `rebase.json` build.
  Check: each line verified in a fresh scaffold.

---

## W2 Hook and function contracts

Branch `fix/hook-contracts`. W2-01 is a decision before it is a change.

- **W2-01 · P0 · L · Decide and enforce the after-hook transaction contract.**
  Files: `packages/server-postgres/src/PostgresBackendDriver.ts:820-856,1221-1250,1733-1791,1842`; `website/src/content/docs/docs/backend/hooks.md:103-107,121`; `collections/callbacks.md:416-423`; `packages/types/src/call_context.ts`.
  Do: pick one. (a) Keep after-hooks inside the transaction and awaited: fix
  hooks.md, the pipeline diagram, callbacks.md and the JSDoc to say so, and
  add "use `waitUntil`, jobs or topics for side effects". (b) Run
  `afterSave`/`afterDelete` after commit, non-fatal, as documented: move the
  calls out of `withTransaction`, catch and log, keep `afterSaveError` for the
  failure path. Either way add a driver test "afterSave throws" asserting the
  row state and the HTTP status.
  Check: the test exists and the three docs say the same thing the test asserts.

- **W2-02 · P0 · S · Document and surface the read-only `afterRead`.**
  Files: `PostgresBackendDriver.ts:1723,1728,1808,1834`, `hooks.md:15-17`, `callbacks.md`, `packages/server/src/api/errors.ts`.
  Do: state on both pages that request-scoped `afterRead` runs in a READ ONLY
  transaction and writes must go through a job or `dataAsAdmin` outside it;
  map SQLSTATE 25006 to an `ApiError` whose message names the callback.
  Check: an `afterRead` that inserts returns a 4xx with the callback name, not
  a bare 500; the docs' audit-logging example is rewritten to work.

- **W2-03 · P0 · S · Callback docs: props that exist, samples that parse.**
  Files: `collections/callbacks.md:88-133,218-221,302,362,430,463-494`; `packages/types/src/types/entity_callbacks.ts:113-118`; `PostgresBackendDriver.ts:890-921`; `tooling/scripts/docs-verify/typecheck-snippets.mjs:96-97`.
  Do: add `error` to `AfterSaveErrorProps` and pass it from the driver (and
  the real `id` and `previousValues` where known); rename `entityId` to `id`
  in the three samples; repair the two literals (`= {` / `});`, duplicate
  `properties:`); remove 1005/1109/1128 from `IGNORED_CODES` for fences that
  are whole declarations.
  Check: `pnpm verify:docs` fails on the old samples and passes on the new.

- **W2-04 · P1 · S · Watch `backend/functions/**` and `backend/crons/**` in dev.**
  Files: `packages/cli/src/commands/dev.ts:771`.
  Do: add `--include` entries for both directories to the tsx watch (or an
  `fs.watch` that restarts); add one sentence to custom-functions.md and
  cron-jobs.md until then.
  Check: create `backend/functions/new.ts` while dev runs; `GET
  /api/functions/new` answers without a restart.

- **W2-05 · P1 · S · The first function is reachable from the SDK.**
  Files: `custom-functions.md:27`, `packages/client/src/functions.ts:77`, `templates/template/backend/functions/hello.ts:18`, `packages/types/src/controllers/client.ts:391`.
  Do: make the doc's first example `app.post("/")` or show `{ method: "GET" }`;
  add an "Invoke from the client" section; change the scaffold comment to
  `client.functions.invoke("hello", { name })`.
  Check: the quickstart's function is invocable with the documented call.

- **W2-06 · P1 · S · `beforeDelete` returning `false` is a refusal, not a 204.**
  Files: `PostgresBackendDriver.ts:1207-1209`, `packages/server/src/api/rest/api-generator.ts:903`, `hooks.md:57`, `packages/common/src/util/callback-errors.ts`.
  Do: map `false` to the same `CALLBACK_REJECTED` path a throw takes (403 or
  409), or remove the boolean from the type and say "throw to block".
  Check: driver test: `beforeDelete` returns false, HTTP is not 2xx, row remains.

- **W2-07 · P1 · M · "Where this goes" on every backend options page.**
  Files: `packages/server/src/boot/bundle.ts:377-394,429-458`, `boot/boot.ts:326-378`; docs `storage.md:411,501`, `jobs.md:29,102`, `hooks.md:31`, and the other pages showing `initializeRebaseBackend`.
  Do: warn at boot on unrecognised `config/index.ts` exports; add a two-line
  block to each page: "Managed runtime: `<env var or config export>`. Ejected:
  `initializeRebaseBackend({...})`." For options with no managed route (jobs,
  storagePolicies, storageTriggers, rateLimit, auth.hooks, webhooks) say so and
  point at topics or eject.
  Check: `export const storagePolicies` in a scaffold's config/index.ts logs
  a warning at boot; every page with `initializeRebaseBackend` has the block.

- **W2-08 · P1 · S · `rebase.email` never `undefined`.**
  Files: `packages/types/src/controllers/client.ts:431-434`, `packages/server/src/boot/options.ts:44-47`, `init.ts:2506-2514`, `smtp-email-service.ts:151`.
  Do: always attach a service whose `send()` throws "Email service not
  configured…" when SMTP is absent; drop the "no-op sender" sentence from the
  JSDoc.
  Check: a function calling `rebase.email.send` in production without SMTP
  gets the configured message, not a TypeError.

- **W2-09 · P1 · S · Guard against a second zod copy in `loadEnv({ extend })`.**
  Files: `packages/server/src/env.ts:245-246`, `custom-server.md:31`; release status of `7d77a2e9e`.
  Do: at boot, detect that `options.extend` was built by a different zod
  instance (a `_def` shape probe or an `instanceof` against the runtime's
  ZodType) and fail with a message naming the fix; note in custom-server.md
  that `z` must be the runtime's. The release itself is the user's call.
  Check: a bundle with its own zod fails loudly at boot instead of skipping
  every cron.

- **W2-10 · P1 · M · Cron failures visible from Studio.**
  Files: `packages/server/src/cron/cron-scheduler.ts:293,544`, `init.ts:2747`.
  Do: count scheduler rejections into `skipped` on `GET /api/admin/cron`;
  write a `cron_logs` row for an overlap skip; add `ctx.signal` and abort it
  on timeout.
  Check: a job with a 6-field schedule appears as skipped in Studio with the
  reason; an overlapped run has a log entry.

- **W2-11 · P2 · S · `defineFunction` JSDoc example matches the guards' guidance.**
  Files: `packages/server/src/functions/define-function.ts:58,61`, `guards.ts:63-66`.
  Do: import from `@rebasepro/server/functions`; use a per-route guard, not
  `app.use("/*", requireAuth)`.
  Check: hover text in an editor shows the corrected example.

- **W2-12 · P2 · S · Stale API names in prose.**
  Files: `hooks.md:12`, `cron-jobs.md:424,435`, `tooling/rebase-agent-skills/skills/rebase-basics/SKILL.md:795`, `callbacks.md:509`, `packages/server/src/singleton.ts:150-154`.
  Do: replace `rebase.data` with `rebase.dataAsAdmin` (or a request-scoped
  driver); delete `rebase.data.findMany`; add `client` and `storageSource`
  to the context reference; delete the hidden `data` alias in singleton.ts
  (no shim).
  Check: `grep -rn "rebase\.data\b" website/src/content/docs tooling/rebase-agent-skills` is empty.

- **W2-13 · P2 · S · Global `afterRead` tolerates a void return like collection-level does.**
  Files: `PostgresBackendDriver.ts:468,779` vs `:477-483,788`.
  Do: `?? fetched` on the global path too.
  Check: test with a global afterRead that returns nothing; rows still come back.

- **W2-14 · P2 · S · `RebaseBackendConfig` keys: document five, mark seven internal.**
  Files: `packages/server/src/init.ts` (config type), `cron-jobs.md`, `packages/types/src/controllers/email.ts`, `function-loader.ts:185`.
  Do: document `compression`, `maxBodySize`, `csrf`, `cronPersistence`,
  `schemaEditor`; tag `bootstrappers`, `provisioningDriverResult`,
  `corsHandled`, `functionsSelection`, `functionsUpstream`, `runtimeVersion`,
  `provisionSchema` as `@internal`; change cron docs to `/api/admin/cron`;
  make the loader's advice conditional on the failure reason.
  Check: `check:api-surface` shows the `@internal` tags; docs pages updated.

- **W2-15 · P2 · S · Disclose the AI plugin's default endpoint.**
  Files: `packages/plugin-ai/src/api.ts:17`, `docs/plugins/index.md`.
  Do: document that field content is POSTed to `app.rebase.pro` by default and
  show the `endpoint` option; state that plugins are admin-panel-only.
  Check: the plugins page names the endpoint.

---

## W3 Schema and collection typing

Branch `fix/relation-required-and-typing`. W3-01 and W3-02 change generated
DDL and generated types; run `pnpm check:schema-fresh` and regenerate `app/`.

- **W3-01 · P0 · M · A required `belongsTo` must not default to CASCADE.**
  Files: `packages/server-postgres/src/schema/generate-postgres-ddl-logic.ts:728-729`, `packages/types/src/types/relations.ts:44`, `collections/relations.md:287-311`.
  Do: default `onDelete` to `RESTRICT` when required and unset (or make
  `onDelete` mandatory when `required: true`); add JSDoc to
  `RelationBase.onDelete`/`onUpdate`; add the rule to Cascade Rules. This is a
  DDL change for existing projects: `db push` will plan a constraint
  rewrite, so add a CHANGELOG entry under Breaking.
  Check: DDL test: required belongsTo without onDelete emits `ON DELETE RESTRICT`.

- **W3-02 · P0 · M · One `required` per relation.**
  Files: `packages/types/src/types/relations.ts:48`, `packages/codegen/src/generate-types.ts:387,508` (vs `:355,428`), `resolve-relation.ts:61`, `RelationFieldBinding.tsx:85`.
  Do: delete `RelationBase.validation` (no shim); make codegen read the
  property's `validation.required`; boot validator rejects the old key with
  "moved to the property's validation".
  Check: `pnpm check:api-surface` shows the removal; codegen test: a required
  relation property yields a non-null `Insert` field.

- **W3-03 · P1 · M · `defineCollection` enforces the closed relation union.**
  Files: `packages/types/src/types/properties.ts:168-170`.
  Do: extend `ExactProperty`/`StrictProperties` one level into `relation`,
  mapping each `kind` to its interface (a `StrictRelation<R>` conditional on
  `R["kind"]`).
  Check: type test: `belongsTo` + `foreignKeyOnTarget` and `hasMany` +
  `localKey` fail under `defineCollection` with a one-line TS2353.

- **W3-04 · P1 · L · Admin-block checks survive a property error.**
  Files: `packages/cms-types/src/admin_collection.ts:677-683`.
  Do: derive the admin key set without depending on property inference
  succeeding (`NoInfer` on a second parameter, or validate `admin` through a
  separate satisfies-style helper).
  Check: type test: one bad `defaultValue` plus `display.title: "titel"`
  reports both in one pass.

- **W3-05 · P1 · L · Errors land on the field, not on `defineCollection(`.**
  Files: `admin_collection.ts:677-704`.
  Do: replace the three overloads with one signature discriminated on
  `engine` (Postgres when absent); rename the `__rebaseUnknownPropertyKey`
  brand to something readable that carries a "did you mean" property.
  Check: type test: a flat `validaton` reports at the key's column with the
  suggestion; no error mentions `MongoDBCollectionConfig` for a Postgres
  collection.

- **W3-06 · P1 · S · Duplicate enum ids are a config error.**
  Files: `packages/server/src/collections/validate-config.ts` (`checkProperty`), `packages/server/src/boot/ddl-bootstrap.ts:115`.
  Do: reject duplicate or blank enum `id`/`label` at validation; exclude
  `pg_enum_typid_label_index` from the duplicate-object race allowlist.
  Check: a collection with two `draft` ids fails boot naming the property.

- **W3-07 · P1 · S · Boot validator warns on unknown `admin` keys with suggestions.**
  Files: `validate-config.ts:179,712-716`, `manifest.ts:189-200` (`isNearMiss`), `admin_block.ts` key lists.
  Do: check both admin blocks against `ADMIN_PROPERTY_KEYS` /
  `ADMIN_COLLECTION_KEYS`; reuse the near-miss suggester; add "did you mean"
  to the top-level unknown-key path.
  Check: `admin: { multilne: true }` logs a warning with "multiline".

- **W3-08 · P1 · S · `.env.example` storage block points at resources.ts.**
  Files: `templates/template/.env.example:152`, `manifest.ts:441-450`.
  Do: replace the `"storage": {...}` rebase.json example with the
  `bucket("media", { engine: "s3" })` form and `rebase resources --write`.
  Check: no `"storage"` key in the template's `.env.example`.

- **W3-09 · P1 · S · Shipped messages don't name a monorepo codemod.**
  Files: `validate-config.ts:324,364`.
  Do: drop the `tooling/scripts/codemod/...` sentence, or publish the codemods
  under `rebase codemod <name>` and reference that.
  Check: `grep -rn "tooling/scripts" packages/server/src` is empty.

- **W3-10 · P1 · S · Duplicate slug or table fails boot.**
  Files: `packages/common/src/collections/CollectionRegistry.ts:182-184,189`, `validate-config.ts:768`.
  Do: a cross-collection pass in `findCollectionConfigProblems` reporting
  duplicate `slug` and duplicate resolved table with both file paths.
  Check: two collections with `slug: "posts"` fail boot naming both files.

- **W3-11 · P1 · S · Fix five documented collection keys.**
  Files: `collections/index.md:252,253,272`, `collections/properties.mdx:41,255`.
  Do: `table` optional (defaults to snake(slug)); `name` optional; `admin.icon`
  is a Lucide name; `defaultViewMode` defaults to `"list"`; remove `smallint`.
  Longer term generate these tables from the types.
  Check: each row matches the type in `packages/types` / `cms-types`.

- **W3-12 · P1 · M · JSDoc on the 62 bare option fields.**
  Files: `packages/cms-types/src/types/property_options.ts:18-21,31-33,83,130,143,153`, `packages/types/src/types/properties.ts:888-918`, `relations.ts`.
  Do: one line each, starting with `readOnly` vs `disabled`, `clearable`,
  `hideFromCollection`, `columnWidth`, `Field`, `Preview`, `customProps`,
  every validation rule, `onUpdate`/`onDelete`, `kind`.
  Check: a JSDoc-coverage script over the same 259 fields reports under 5%
  bare.

- **W3-13 · P2 · S · `type: "relation"` without a `relation` block is an error.**
  Files: `CollectionRegistry.ts:300-303`, `properties.ts:687`, `validate-config.ts`.
  Do: report it from validate-config; route the existing `console.warn`
  through the logger.
  Check: boot fails naming the property.

- **W3-14 · P2 · M · The example app uses `defineCollection`.**
  Files: `app/config/collections/*.ts` (11 files), `templates/template/config/cms.d.ts` comment, `callbacks.md`, `security-rules.md`.
  Do: convert the annotations; say in `cms.d.ts` that it is only needed when
  annotating with `PostgresCollectionConfig`.
  Check: `pnpm typecheck` green; `grep -c ": PostgresCollectionConfig" app/config/collections/*.ts` is 0.

- **W3-15 · P2 · S · Env keys: two missing rows.**
  Files: `templates/template/.env.example`, `getting-started/configuration.md`, `templates/template/config/collections/index.ts:17`.
  Do: add `AUTH_REQUIRE` and `REBASE_STRICT_COLLECTION_CONFIG` to both.
  Check: `grep AUTH_REQUIRE templates/template/.env.example` hits.

---

## W4 Client SDK and REST

Branch `fix/logical-filter-codec-and-sdk-docs`.

- **W4-01 · P0 · M · Logical filters use the fixed codec.**
  Files: `packages/common/src/data/filter-dialect.ts:647,710-736` (vs `serializeTuple` `:386-442`), `packages/common/test/filter-dialect.test.ts`, `sdk/querying.md`.
  Do: `serializeLogicalCondition` delegates leaf encoding to `serializeTuple`
  (null → `isnull`, empty list token, throw on unknown operator);
  `deserializeLogicalCondition` splits on the last two dots (or escapes `.`
  in the column) so `author.name.eq.bob` and `metadata->>x` survive; add the
  four cases as tests; write a "Logical conditions" section.
  Check: round-trip test for `cond("deleted_at","==",null)`,
  `cond("author.name","==","bob")`, `cond("age","gte",18)`, `cond("id","in",[])`.

- **W4-02 · P0 · S · Document the real error envelope.**
  Files: `backend/index.md:98-107,205-217`, `backend/api.md`, `docs/api-conventions.md §2`.
  Do: replace both samples with `{ error: { message, code, details?,
  requestId? } }`, SCREAMING_SNAKE_CASE codes, no `status`; add an Errors
  section to api.md linking the code reference (W5-04).
  Check: `grep -rn '"not-found"\|"service-unavailable"' website/src/content/docs` is empty.

- **W4-03 · P0 · S · `listen`, `listenById`, `count` are not optional.**
  Files: `packages/types/src/controllers/data.ts:880`, `sdk_query_builder.ts:194-201`, `sdk/realtime.md:93`, `tooling/scripts/docs-verify/typecheck-snippets.mjs:450-451`.
  Do: make the three non-optional on `SDKCollectionClient`, throwing the
  builder's `realtime: false` message when there is no socket; remove the `!`
  workaround; turn `strictNullChecks` on in the snippet verifier.
  Check: the SDK landing page's Quick Example typechecks under `--strict`.

- **W4-04 · P1 · S · Delete "Two-Phase Meta"; document the real emission rule.**
  Files: `sdk/realtime.md:52,58-84,110-116`, `packages/client/src/collection.ts:491-513`.
  Do: one emission per push after `count()`; lower bound only if no count has
  ever succeeded; fix `FindResponse`/`Entity` to `FindResult`/flat row.
  Check: `grep -n estimated sdk/realtime.md` is empty.

- **W4-05 · P1 · M · The fluent builder accepts what `find(params)` accepts.**
  Files: `packages/types/src/controllers/data.ts:143,546-572`, `types/filter-operators.ts:300-302`, `packages/client/src/query-contract.types.ts`, `sdk/querying.md:414-435,695-702`.
  Do: type builder `where`/`orderBy` keys as `FieldPath<M> | ComputedSortField |
  RelationAggregateSort`; widen `FieldPath` to include `` `${string}->>${string}` ``;
  add `iterate`, `findAll`, `observe` to the builder; add the typed-client
  assertions; give `iterate()` a docs section; remove `no-verify` from the
  JSON-path fence.
  Check: `query-contract.types.ts` compiles the four previously failing calls.

- **W4-06 · P1 · S · The generated SDK README teaches the 0.14 wire names.**
  Files: `packages/codegen/src/index.ts:72-74,85`.
  Do: rewrite the two paragraphs (wire key = property key; derived FK columns
  camelCase, e.g. `authorId`); add a codegen test asserting the README never
  contains `created_at` or `author_id`.
  Check: the test exists and passes.

- **W4-07 · P1 · S · Remove `GET /api/collections` from the docs.**
  Files: `backend/api.md:479-485`, `api/contract-routes.ts:87`.
  Do: delete the section or point at `/api/meta/contract` (admin) and `/api/docs`.
  Check: no documented route answers a text/plain 404.

- **W4-08 · P1 · S · Every client failure is a `RebaseApiError` or `RebaseClientError`.**
  Files: `packages/client/src/transport.ts:374`, `auth.ts:563`, `functions.ts:71`, `offline.ts:156`, `offline-connectivity.ts:22-25`, `packages/types/src/errors.ts:61-64`.
  Do: wrap `fetchFn` and throw `RebaseApiError` with `status: 0`, `code:
  "NETWORK_ERROR"`, `cause`; make the two bare throws client errors; rename
  `"offline"` to `"OFFLINE"`; simplify `isNetworkError`.
  Check: test: server down → `instanceof RebaseApiError` with `NETWORK_ERROR`.

- **W4-09 · P1 · S · Document session restore in cookie mode.**
  Files: `sdk/authentication.md:141-151`, `packages/client/src/auth.ts:601,843-869,916`, `examples/sdk-demo/src/hooks.ts:11-15`, `templates/template/frontend/src/App.tsx:23`.
  Do: document `authFlowMode`, `await client.auth.isInitialized()`, and the
  event that signals restore (or emit `INITIAL_SESSION` after init); fix the
  demo hook to await initialisation.
  Check: the demo shows no logged-out flash on reload with a valid cookie.

- **W4-10 · P1 · M · Channel refusals reject the send.**
  Files: `packages/client/src/websocket.ts:876-894,1037-1042,1067-1070`, `backend/realtime.md:413,490`.
  Do: correlate channel frames by `requestId` (the server echoes it) so
  `send()`/`broadcast()` reject on `ERROR`; or add `channel.onError()` and
  change the two doc sentences.
  Check: test: server answers `CHANNEL_FORBIDDEN`; `await channel.broadcast()` rejects.

- **W4-11 · P1 · S · `CORS_ORIGINS` applies in development too.**
  Files: `packages/server/src/boot/env.ts:268-275,313-317`, `configuration.md:71-72`.
  Do: in non-production, union the localhost rule with `CORS_ORIGINS` /
  `FRONTEND_URL` when set; log the denied origin once with the variable to
  set; document the behaviour.
  Check: a request from `http://192.168.1.5:5173` with `CORS_ORIGINS` set to
  it succeeds in dev.

- **W4-12 · P1 · S · `count()` de-dup is per client.**
  Files: `packages/client/src/collection.ts:23,292-306`.
  Do: key the in-flight map on the transport instance (create it in
  `createRebaseClient`).
  Check: test: two clients, same count, different tokens → two requests.

- **W4-13 · P1 · M · Anonymous sessions and MFA in the SDK; document the other six.**
  Files: `packages/client/src/auth.ts:691-790,872-916`, `packages/server/src/auth/session-routes.ts:339,401`, `mfa-routes.ts:229-539`, `sdk/authentication.md`.
  Do: add `signInAnonymously()`, `linkAnonymous()`, an `mfa` namespace;
  document `sendMagicLink`, `verifyMagicLink`, `sendEmailOtp`,
  `verifyEmailOtp`, `linkProvider`, `findUserByEmail`.
  Check: `check:api-surface` shows the additions; each has a docs subsection.

- **W4-14 · P2 · S · Validate `page` and `offset`.**
  Files: `packages/server/src/api/rest/query-parser.ts:375-388`, `FetchService.ts:1175`.
  Do: 400 `INVALID_PAGE` (page ≥ 1) and `INVALID_OFFSET` (non-negative integer),
  named like `INVALID_LIMIT`.
  Check: `?page=0` and `?offset=abc` answer 400 with the code.

- **W4-15 · P2 · M · Envelope and unwrapping polish (nine items).**
  Files: `packages/types/src/errors.ts:77-95`, `transport.ts:374-390`, `auth/middleware.ts:100,111`, `functions.ts:99` vs `index.ts:631`, `sdk_query_builder.ts:46`, `data.ts:750,817`, `websocket.ts:723`, `backend/api.md`, `sdk/querying.md:237,763-786`.
  Do: carry `requestId` and `Retry-After` on `RebaseApiError`; route
  auth-middleware 401s through the handler; make `invoke()` and `call()`
  unwrap the same way and say so; one wrapping rule for list results;
  document `?where={json}` and the `?and=`/`?or=` precedence; make a second
  `.where(or())` AND with the first; add `WriteOptions` to `update`; delete
  the dead `collection_patch` handler; fix `FindResponse` → `FindResult`.
  Check: each item has a test or a docs line; `check:api-surface` reviewed.

---

## W5 Boot, runtime errors, logging, doctor

Branch `fix/boot-errors-name-the-database`.

- **W5-01 · P0 · M · Boot failures name the database.**
  Files: `packages/server/src/utils/logger.ts:164-170` (`serialiseError`), `packages/server/src/init.ts:1117,1130`, `packages/server-postgres/src/schema/ensure-collection-tables.ts:1299`, `packages/server/src/boot/boot.ts:775-800`, `PostgresBootstrapper.ts:461-525`.
  Do: `serialiseError` walks `.cause` and `AggregateError.errors` and includes
  `{ cause: { name, code, message, address, port } }`; probe the connection
  (`SELECT 1` through the existing `classifyConnectFailure`) before
  `provisionCollectionTables` so the boxed diagnosis runs for every project;
  `runFromBundle` prints `err.cause` on its own line.
  Check: boot a scaffold against a closed port; the output contains
  ECONNREFUSED, the host and port, and the `docker compose up -d db` hint.

- **W5-02 · P1 · S · `rebase dev` notices the backend died.**
  Files: `packages/cli/src/commands/dev.ts:811-887,908-916`.
  Do: `backendChild.on("exit", code => …)` printing "✗ Backend exited with
  code N — fix the error above; tsx restarts on the next change"; in
  `--backend-only`, exit non-zero.
  Check: break `config/collections/index.ts`; `rebase dev` prints the verdict
  instead of "Press Ctrl+C to stop all servers".

- **W5-03 · P1 · S · Remove the fictional "degraded mode".**
  Files: `backend/index.md:91-108`, `init.ts:963-966`.
  Do: state that boot failure exits 1 and how `/livez` vs `/health` behave.
  Check: no "does not crash" sentence remains.

- **W5-04 · P1 · M · Error-code reference and troubleshooting page.**
  Files: new `website/src/content/docs/docs/backend/errors.md`, new `docs/troubleshooting.md`, `packages/server/src/api/errors.ts`.
  Do: a table of every `code` (status, meaning, fix); `X-Request-ID` and
  `details` rules; a troubleshooting page from the boot failure matrix
  (unreachable DB, wrong password, missing extension, RLS refusal, schema
  drift, port in use, function file broken). Add a gate that the code table
  matches the codes in source.
  Check: `pnpm verify:docs` has a stage that fails when a code is missing.

- **W5-05 · P1 · M · Studio Logs Explorer shows errors and function output.**
  Files: `packages/server/src/api/logs-routes.ts:156-172`, `packages/server/src/utils/logger.ts`, `studio/index.md:60`.
  Do: tee `logger` at warn and above into the ring with `source` from the
  `[prefix]`; attach the error handler's code, message and requestId to the
  request entry.
  Check: a function that throws shows its message in Logs Explorer.

- **W5-06 · P1 · S · Write-path PG errors keep their SQLSTATE.**
  Files: `packages/server-postgres/src/services/PersistService.ts:541`.
  Do: `new Error(message, { cause: error })`.
  Check: POST against a missing table answers `SCHEMA_DRIFT`, not `INTERNAL_ERROR`.

- **W5-07 · P1 · S · `rebase doctor` renders a report when the database is unreachable.**
  Files: `packages/server-postgres/src/schema/doctor.ts:803`, `doctor-cli.ts:64`, `cli-errors.ts` (`diagnoseDbError`).
  Do: wrap the DB phase as skipped with the diagnosis hint; still print the
  other phases and the verdict.
  Check: `rebase doctor` with a closed port prints the banner and exits 1
  without a stack.

- **W5-08 · P1 · S · Only warn about ephemeral secrets when they are.**
  Files: `packages/server/src/env.ts:224-238,289-293`.
  Do: warn only when `reused.length !== autoGeneratedSecrets.length` or the
  store is unusable.
  Check: second `rebase dev` prints no ephemeral-secrets warning.

- **W5-09 · P2 · S · Root app `onError`.**
  Files: `packages/server/src/boot/boot.ts:269`, `init.ts`, `auth/api-keys/api-key-middleware.ts:78`.
  Do: `app.onError(errorHandler)` in `bootFromBundle` and in
  `initializeRebaseBackend` when `config.app` has none.
  Check: a throw in an app-level middleware answers the JSON envelope.

- **W5-10 · P2 · S · One log-level system.**
  Files: `packages/server/src/utils/logging.ts`, `utils/logger.ts:44-49`, `init.ts:972-974`, `server-postgres/src/cli-output.ts:10-12`.
  Do: delete `logging.ts` and its `configureLogLevel` call; the structured
  logger already honours `LOG_LEVEL`.
  Check: `LOG_LEVEL=warn` no longer silences third-party `console.log`.

- **W5-11 · P2 · S · Log fields and duplicates.**
  Files: `packages/server/src/utils/request-logger.ts:38-70`, `api/errors.ts:198-201`.
  Do: add `uid` and `collection` to the handler's error line, or drop the
  duplicate and enrich the request line.
  Check: one log line per failed request, carrying uid and collection.

- **W5-12 · P2 · S · Say which port dev bound and why.**
  Files: `packages/server/src/utils/dev-port.ts:181-185`.
  Do: print "Port 3001 in use — trying 3002".
  Check: start two backends; the second prints the line.

- **W5-13 · P2 · S · "Entity not found" names the collection and id.**
  Files: `packages/server/src/api/rest/api-generator.ts:393,809,886,1006,1181`.
  Do: `details: { collection, id }` outside production plus a "may be hidden
  by row-level security" hint.
  Check: a GET on a missing id returns the details.

- **W5-14 · P2 · M · `rebase doctor` checks the things that break first runs.**
  Files: `packages/cli/src/commands/doctor.ts`, `server-postgres/src/schema/doctor.ts`, `cli/index.md:341-347`.
  Do: add Node/pnpm version, DB reachability as a check, required extensions
  (`vector`), schema-stamp mismatch, duplicate slugs, `@rebasepro/*` version
  skew against the runtime (reuse `warnOnDriverSkew`), `.env` sanity
  (JWT_SECRET length, CORS in prod); write a real docs section.
  Check: each new check has a fixture that fails it.

- **W5-15 · P2 · S · Messages that name nothing.**
  Files: `init.ts:1216`, `RelationService.ts:366,542,620,838`, `drizzle-conditions.ts:1230,1516,2058`, `cli/src/commands/init.ts:902,909`.
  Do: include the table, relation, collection or package name and a next step
  in each.
  Check: `grep -rn '"Not found"\|"Parent table not found"' packages` is empty.

---

## W6 First admin and production docs

Branch `fix/first-admin-everywhere`. **Land this in the same release that
closes the production bootstrap window** (`12a73ceec`, unreleased). Before that
release, the docs must describe 0.17.3; after it, the closed window. Do not
split the two across releases.

- **W6-01 · P0 · S · The scaffold's compose carries the first admin.**
  Files: `packages/cli/templates/template/docker-compose.yml:93`, `templates/template/.env.example`, `packages/cli/src/commands/init.ts` (env generation), `tooling/scripts/verify-selfhost-docker.mts:206-207`.
  Do: add `REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:?…}` and
  `REBASE_ADMIN_PASSWORD` (`:?`), `DISABLE_SELF_REGISTRATION: "true"`; have
  `init` write both to `.env` (generated password, 0600, with the "change it
  after first sign-in" comment); extend the self-host verifier to exercise
  the scaffold's compose too.
  Check: `rebase init x --yes && cd x && rebase build && docker compose up -d`
  then log in with the generated credentials.

- **W6-02 · P0 · S · Self-hosting page says six values.**
  Files: `deployment/self-hosting.md:41-52`, `deployment/hetzner.md:70-75`, `infra/docker/quickstart.sh:5`.
  Do: add `REBASE_ADMIN_EMAIL` and `REBASE_ADMIN_PASSWORD` to the `cat > .env`
  block with the compose comment's two-sentence why; fix the script header.
  Check: follow the block verbatim; `docker compose up -d` starts.

- **W6-03 · P0 · S · Kubernetes headline install is accepted by the chart.**
  Files: `deployment/kubernetes.md:19-25,128-137`, `infra/charts/rebase/templates/_validate.tpl:41-42`.
  Do: add `--set config.adminEmail=… --set config.adminPassword=…` to the
  block; add the refusal to the "what the chart refuses to render" list; fix
  `:34` ("not yet exercised against a live cluster").
  Check: `helm template` with the documented command renders.

- **W6-04 · P0 · S · Production checklist for the closed window.**
  Files: `getting-started/deployment.md:22-24,92,103-117`, the six platform guides' checklists.
  Do: replace "ALLOW_REGISTRATION=false after creating your admin" with
  "`REBASE_ADMIN_EMAIL`/`_PASSWORD` before first boot"; "CORS_ORIGINS always";
  add `NODE_ENV=production`; one version-stamped "Your first admin" block on
  deployment.md linked from every guide.
  Check: `grep -rn "after creating your admin" website/src/content/docs` is empty.

- **W6-05 · P0 · M · Six platform guides build with `rebase build`, not a Dockerfile.**
  Files: `deployment/aws.md:28-30`, `azure.md:30-32`, `gcp.md:37-40`, `scaleway.md:29-32`, `railway.md:24-27`, `flyio.md:49-53`.
  Do: rewrite each around `rebase build` + `FROM rebasepro/server:<ver>` /
  `COPY dist-bundle /bundle` (the shape self-hosting.md, hetzner.md and
  kubernetes.md use); delete the "auth tables only" paragraph; link back to
  deployment.md and configuration.md.
  Check: `grep -rln "backend/Dockerfile" website/src/content/docs/docs/deployment` is empty.

- **W6-06 · P1 · S · The VPS recipe runs in production mode.**
  Files: `deployment/self-hosting.md:183-190`, `packages/server/bin/rebase-server.js:26-37`.
  Do: add `NODE_ENV=production` and the two admin variables to the systemd
  block; make `rebase-server --help` list `REBASE_SERVICE_KEY`,
  `REBASE_ADMIN_*` and the correct migrate line.
  Check: `rebase-server --help` output matches self-hosting.md:100.

- **W6-07 · P1 · S · One canonical compose file.**
  Files: `getting-started/deployment.md`, `deployment/self-hosting.md`, `packages/cli/templates/template/docker-compose.yml`, `infra/docker/docker-compose.selfhost.yml`.
  Do: decide which compose is the recommended one for a scaffolded project
  and make both pages say the same; align the env contracts.
  Check: both pages name the same file.

- **W6-08 · P1 · S · Storage access control in the prod checklist.**
  Files: `getting-started/deployment.md`, `deployment/self-hosting.md`, `packages/server/src/init/storage.ts:35-46,105-131`.
  Do: add the rule: S3/GCS needs `storageAuthorize` or policies or
  `STORAGE_PUBLIC_READ` / `STORAGE_ALLOW_ANY_AUTHENTICATED`, else boot throws;
  local storage is refused in prod without `FORCE_LOCAL_STORAGE`; mention
  `MFA_ENCRYPTION_KEY`.
  Check: every hard boot failure in `init/storage.ts` has a checklist row.

- **W6-09 · P2 · S · The "is required" rewrite matches zod 4.**
  Files: `packages/server/src/boot/env.ts:249`.
  Do: match `issue.code === "invalid_type" && issue.received === "undefined"`
  (or the zod-4 message) so the output reads `DATABASE_URL: is required`.
  Check: unit test with a missing variable.

---

## W7 Cloud CLI and cloud docs

Branch `fix/cloud-cli-help-and-docs`. Control-plane items (W7-02) touch the
saas repo.

- **W7-01 · P0 · S · `projects create` in the docs matches the CLI.**
  Files: `deployment/cloud.md:40-62`, `packages/cli/src/commands/cloud/projects.ts:245-250`.
  Do: `rebase cloud projects create --name "My app" --subdomain my-app --link`;
  say the subdomain is not editable; drop the separate `link` step; add
  `rebase cloud billing setup` to the sequence (W7-04).
  Check: run the doc's commands with `--help` appended; none exits 2.

- **W7-02 · P0 · L · Managed projects can roll back, or the docs stop promising it.**
  Files: `saas/backend/functions/deploy.ts:1576-1580,2884-2888,3482-3500`, `saas/backend/src/managed/bundle-gc.ts:25-28`, `packages/cli/src/commands/cloud/deployments.ts:371-372`, `saas/frontend/src/utils/deployments.ts:179`, `deployment/cloud.md:80-89`, `website/src/i18n/*` (`pricing.cloud.feat2`).
  Do: implement rollback for managed rows (re-point `activeBundleId` at the
  previous successful row's bundle and roll the pod), and make `rollbackImageOf`
  accept bundle rows; or remove the rollback section and the pricing claim
  until it exists.
  Check: two managed deploys, then `rebase cloud rollback` succeeds and the
  console shows the previous bundle live.

- **W7-03 · P1 · S · The deploy recipe for a managed scaffold.**
  Files: `deployment/cloud.md:59-66`, `packages/cli/src/commands/cloud/deploy.ts:224-226,877-878`.
  Do: one command, `rebase cloud deploy`; mention `--bundle-dir dist-bundle`
  for a prebuilt artefact; delete the "bare deploy builds from source" sentence.
  Check: the doc's sequence matches what `deploy` prints on a managed project.

- **W7-04 · P1 · S · Say the first deploy needs a card.**
  Files: `deployment/cloud.md`, pricing page copy, `saas/backend/src/utils/billing.ts:159,408-412`.
  Do: add `rebase cloud billing setup` to the sequence and one sentence on the
  pricing page; consider checking billing before the build step in `deploy`.
  Check: the 402 never lands after a completed upload.

- **W7-05 · P1 · S · Action-help pages for `resources`, `resources set`, `link`, `login`, `rollback`.**
  Files: `packages/cli/src/commands/cloud/action-help.ts`, `cloud/index.ts:415-420`, `deployment/cloud.md:93-108`.
  Do: entries with units, ranges, `--db-mode` values and "run `resources` to
  see the €/month"; a "Resources and what they cost" section; fix the "every
  group answers --help" sentence or make it true (cancel, start/stop/restart,
  metrics, debug, orgs, settings, extensions too).
  Check: every word in `CLOUD_GROUPS` answers `--help` with something other
  than the index.

- **W7-06 · P1 · S · Region flags vs "no region choice".**
  Files: `deployment/cloud.md:114-115`, `cloud/projects.ts:201-202`.
  Do: hide `--provider`/`--region` until placement is offered, or document
  what they do today.
  Check: the doc and `projects create --help` agree.

- **W7-07 · P0 · S · Webhook `--url` no longer collides with the global `--url`.**
  Files: `cloud/resources.ts:528-549`, `context.ts:162-166`, `action-help.ts:402-416`, `action-help.test.ts`.
  Do: rename to `--endpoint`; test that no per-command flag collides with
  `GLOBAL_SPEC_KEYS`.
  Check: the documented example creates a webhook.

- **W7-08 · P1 · S · `cloud billing --help` matches the dispatch.**
  Files: `action-help.ts:447-460`, `resources.ts:1110,1139`, `action-help.test.ts`.
  Do: `cloud billing [setup|checkout]`; test action words against the dispatch.
  Check: `rebase cloud billing usage` exits non-zero with `unknown_command`.

- **W7-09 · P1 · S · Unknown actions fail in all cloud groups.**
  Files: `resources.ts:583,636-639,890-891,1110,1139,1344`.
  Do: explicit list/show cases and `default: fail(..., "unknown_command")`,
  matching `env.ts:97`.
  Check: `rebase cloud storage creat` exits 1 with `unknown_command`.

- **W7-10 · P1 · S · Piped `--help` carries the same content as the pty page.**
  Files: `cloud/context.ts:588-595`, `cloud/index.ts:347-360`, `emitHelp` callers.
  Do: `emitHelp` emits `[{action, description, flags}]`; add `resources` to
  `CLOUD_GROUPS` with a real test; honour `REBASE_JSON=0`.
  Check: `rebase cloud env --help | cat` lists flags and descriptions.

- **W7-11 · P1 · S · `clusters` listed once; six groups get a page.**
  Files: `cloud/index.ts:411,421`, `action-help.ts`.
  Do: delete the duplicate; covered otherwise by W7-05.
  Check: `rebase cloud --help | grep -c clusters` is 1.

- **W7-12 · P0 · S · `rebase link` hints point at the real command.**
  Files: `commands/apps.ts:218`, `commands/generate_sdk.ts:307,314`, `cloud/index.ts` (index line for `link`), `cloud/link.ts:122`.
  Do: `rebase cloud link <url>`; document the positional URL in the index line
  and the action-help page.
  Check: `rebase apps config backend` outside a linked project prints a
  command that exists.

- **W7-13 · P2 · S · `deploy` prints the project URL on success.**
  Files: `cloud/deploy.ts`.
  Check: "✓ Deployment succeeded" is followed by the URL `status` would print.

- **W7-14 · P2 · S · `login --password` warns about shell history.**
  Files: `cloud/auth.ts:27-28`.
  Do: mirror rls-check's stance: prefer the prompt or an env var; warn once.
  Check: the flag's help text carries the warning.

- **W7-15 · P2 · S · Unknown-subcommand code is `unknown_command` everywhere.**
  Files: `cloud/env.ts:97`, `domains.ts:99`, `extensions.ts:101`, `settings.ts:40`.
  Check: `grep -n '"error")' packages/cli/src/commands/cloud/*.ts` finds none for unknown actions.

- **W7-16 · P2 · S · The rollback-failed sentence reports observed state.**
  Files: `saas/backend/src/k8s/orchestrator.ts:3011-3018`.
  Do: emit "this project may be down" only when the previous pod is not serving.
  Check: a failed deploy with a healthy old pod does not print it.

---

## W8 CLI core

Branch `fix/cli-help-before-dispatch`.

- **W8-01 · P0 · S · `schema generate --help` and `schema introspect --help` print help.**
  Files: `packages/cli/src/commands/schema.ts:17`, `packages/server-postgres/src/cli.ts:1311-1325,1370-1384`, `help-flag.test.ts`.
  Do: answer `wantsHelp(rawArgs)` before `requireProjectRoot` as `db.ts:405`
  does; add schema cases to the test.
  Check: `rebase schema introspect --help` in an empty dir prints usage, exit 0.

- **W8-02 · P1 · S · Unknown flags are rejected on `db`, `schema`, `generate-sdk`.**
  Files: `cli.ts:139-152`, `server-postgres/src/cli.ts:212-220,1312-1322`.
  Do: route `generate-sdk` through `parseCommandArgs`; validate `db`/`schema`
  flags against the driver's spec before spawning (or drop `permissive`).
  Check: `rebase db push --alow-destructive` exits with "unknown or unexpected option".

- **W8-03 · P1 · S · One "dependencies not installed" message.**
  Files: `utils/project.ts` (new helper), `schema.ts:39,55`, `doctor.ts:178,204`, `db.ts:266,288,328,381`, `auth.ts:286`, `dev.ts:564`.
  Do: "Dependencies are not installed — run `<pm> install` in <root>", used by
  all six.
  Check: `rebase doctor` in a scaffold without node_modules prints the install command.

- **W8-04 · P1 · S · `schema.ts` and `doctor.ts` print the spawn error.**
  Files: `schema.ts:70-72`, `doctor.ts:219`, `db.ts:447-455` (reference).
  Check: an ENOENT on tsx prints its message.

- **W8-05 · P2 · S · `bin/rebase.js` respects non-TTY and marks usage errors.**
  Files: `packages/cli/bin/rebase.js:110-114`, `utils/args.ts`.
  Do: chalk or an `isTTY`/`NO_COLOR` check; a `UsageError` class so the
  `--debug` hint is skipped.
  Check: `rebase status extra 2>err.txt` writes no escape codes.

- **W8-06 · P2 · S · One `unknownCommand` helper.**
  Files: `auth.ts:97-100`, `apps.ts:79-82`, `skills.ts`, `debug.ts:1014-1019`, `telemetry.ts:55-57`, `cli.ts:229-234`.
  Do: one stderr line, "Run rebase <family> --help", exit 1, did-you-mean.
  Check: `rebase statsu` prints one line with the suggestion.

- **W8-07 · P2 · S · Top-level help order and descriptions.**
  Files: `cli.ts:243-300`, `server-postgres/src/cli.ts:1306`.
  Do: fix the `build` line; move `eject` under "Take ownership"; Diagnostics
  as status, doctor, resources; list `db pull|stop|reset|branch`; list or
  delete `schema stale`, `cloud billing checkout`, `cloud releases`,
  `domains status|set`, `env rm|delete`.
  Check: every command reachable by dispatch appears in some `--help`.

- **W8-08 · P2 · S · Flag and name drift.**
  Files: `db.ts` help, `build.ts:68-73`, `env.ts:394-395`, `dev.ts:238-243`, `requireProjectRoot`.
  Do: accept `--out` and `--output` everywhere; `db backup list` locally;
  JSON envelope from `requireProjectRoot` when `--json` is on the line.
  Check: `rebase status --json` outside a project emits JSON on stdout.

- **W8-09 · P2 · S · `db branch switch` survives `--debug`.**
  Files: `db.ts:437`.
  Do: locate `switch` by position after the command words, not by
  `rawArgs.slice(2)[2]`.
  Check: `rebase --debug db branch switch x` takes the CLI-side path.

---

## W9 Docs IA and the snippet verifier

Branch `docs/ia-and-verifier`. Do W9-01 first: it makes W2-03, W4-03 and
W10-01..03 regressions impossible.

- **W9-01 · P1 · S · The snippet verifier sees what the scaffold sees.**
  Files: `tooling/scripts/docs-verify/sdk-exports.mjs:20-43`, `typecheck-snippets.mjs:96-97,450-451`.
  Do: add `@rebasepro/cms-types` (and any other package the docs import) to
  the export map; `strictNullChecks: true`; stop ignoring TS1005/1109/1128
  for fences that are whole declarations; count `no-verify` fences and fail
  above the current 96 so the number only goes down.
  Check: `pnpm verify:docs` fails on `frontend/index.md:172-192` and
  `callbacks.md:88-133` before their fixes, passes after.

- **W9-02 · P1 · M · A BaaS path exists.**
  Files: new `getting-started/headless.md`, `index.mdx`, `astro.config.mjs` sidebar, `quickstart.md:64`.
  Do: `init --headless` → `--database-url`/`--introspect` → SDK/REST →
  `404 NO_COLLECTIONS`; a "Choose your path" row on the landing page; a
  "Backend only" sidebar group; fix the dead `#just-the-api-headless` anchor.
  Check: a reader can reach the SDK page from the landing page without
  passing a Frontend page.

- **W9-03 · P1 · L · Backend pages carry a Managed/Ejected block.**
  Files: `backend/index.md:19-37`, `hooks.md:27`, `history.md:14-21`, `cron-jobs.md`, `jobs.md` and the other pages with `initializeRebaseBackend`; `boot.ts:359`.
  Do: covered mechanically by W2-07; here: name `export const callbacks` from
  `config/index.ts`, `REBASE_HISTORY`, and rebase.json/.env where each option
  lives; a single reference table mapping `RebaseBackendConfig` keys to env
  vars and config exports.
  Check: `grep -L "managed\|config/index.ts\|\.env" website/src/content/docs/docs/backend/*.md` lists only pages with no options.

- **W9-04 · P1 · M · Unreleased features are marked.**
  Files: `cli/index.md:206-246,256-289`, `backend/branching.md`, `security-rules.md`, `rls-check.md`, `configuration.md`; the website publish job.
  Do: a `Since 0.18` badge component and convention, applied to `rebase
  status`, `db branch switch/prune`, `policy.registered()`,
  `policy-authenticated-tautology`, `REBASE_ADMIN_*`,
  `DISABLE_SELF_REGISTRATION`; or publish the docs from the release tag.
  Check: every feature under `## [Unreleased]` that has a docs page carries
  the badge (write a gate that diffs the two).

- **W9-05 · P1 · S · Quickstart contradictions.**
  Files: `quickstart.md:23-25,29,118-172`, `project-structure.md:101-111`, `configuration.md:26`, `collections/index.md:252`.
  Do: drop Docker from prerequisites; both examples default exports; DATABASE_URL
  optional; `table` optional.
  Check: covered by W1-01, W1-12, W3-11; verify after they land.

- **W9-06 · P1 · S · SDK examples use the printed URL.**
  Files: `sdk/index.md:31,39-40,48,73`, `sdk/authentication.md:244`, `cron-jobs.md:286`, `cli/schema.md:216`.
  Do: one sentence under "Creating a Client"; `import.meta.env.VITE_API_URL`
  in the examples.
  Check: `grep -rn "localhost:3001" website/src/content/docs/docs/sdk` is empty.

- **W9-07 · P1 · S · OpenAPI paths.**
  Files: `backend/index.md:49-50`, `configuration.md:289`.
  Do: `/api/docs` and `/api/swagger`.
  Check: both paths answer on a running scaffold.

- **W9-08 · P1 · S · Two dead links.**
  Files: `backend/mongodb.md:19`, `quickstart.md:64`.
  Check: the site's link checker passes.

- **W9-09 · P1 · M · Translations refresh when the source changes.**
  Files: `website/scripts/translate_docs.mjs:207-209`; translated frontmatter.
  Do: store a source hash in each translated file's frontmatter; re-translate
  on mismatch; add `backend/branching.md` to the five locales; add
  `check:untranslated`-style reporting for stale-by-hash.
  Check: after editing quickstart.md, the script re-translates it.

- **W9-10 · P2 · S · Studio has a home in the sidebar.**
  Files: `astro.config.mjs`, `studio/index.md:7-16`.
  Do: own group or promote into Frontend; open with what Studio is and a
  screenshot, not the mode enum.
  Check: Studio is visible without expanding CLI & Tooling.

- **W9-11 · P2 · S · Cross-links on the 18 orphan pages.**
  Files: the six platform guides, `split-processes.md`, `branching.md`, `custom-server.md`, `live-schema-editing.md`, `multiple-sources.md`, `search.md`, `compatibility.md`, `component-overrides.md`, `form-layout.md`, `slots.md`, `recipes/blog-cms.md`, `upgrading.mdx`.
  Do: each links to at least two related pages; platform guides link back to
  deployment.md and configuration.md.
  Check: a script counting outbound docs links reports zero pages at 0.

- **W9-12 · P2 · S · "a entity" search-and-replace artefact.**
  Files: 16 occurrences on 10 pages (`history.md:9`, `api.md:26-28`, `backend/index.md:182`, `entity-views.md:43`, `extending.md:27`, `callbacks.md:140,247,323`, `architecture/index.md:100,106`, `hooks/index.md:255`, `realtime.md:356`).
  Do: restore "a record" / "a snapshot" / "an entity" by hand.
  Check: `grep -rn "a entity" website/src/content/docs` is empty.

- **W9-13 · P2 · M · Split the three longest pages.**
  Files: `backend/authentication.md` (1045), `upgrading.mdx` (826), `sdk/querying.md` (794).
  Do: authentication into config / endpoints / custom adapters; querying into
  reference vs guide; upgrading by version with the current release on top.
  Check: no page over 600 lines.

- **W9-14 · P2 · S · Glossary on the first-15-minutes path.**
  Files: `project-structure.md`, `quickstart.md:46,79,86,120`, `index.mdx`.
  Do: a five-term box (collection, Studio, managed runtime, bundle, resource);
  link Atlas and RLS on first use; label ejected-only code blocks.
  Check: every term in the box is used after it is defined.

- **W9-15 · P1 · S · Env vars read by code appear in configuration.md.**
  Files: `configuration.md`; sources listed in the sweep (telemetry, dev, auth, boot/sources, fetch-bundle, process-safety, mfa-crypto, cloud/errors).
  Do: add `MFA_ENCRYPTION_KEY_PREVIOUS`, `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`,
  `REBASE_TELEMETRY_DISABLED`, `DO_NOT_TRACK`, `REBASE_TELEMETRY_ENDPOINT`,
  `REBASE_FRONTEND_PORT`, `REBASE_DEV_NO_DB`, `REBASE_ENV_FILE_PATH`,
  `REBASE_EXIT_ON_UNHANDLED_REJECTION`, `REBASE_DRIVER[__SUFFIX]`,
  `REBASE_RUNTIME_MODULES`, `REBASE_BUNDLE_TOKEN`, `REBASE_BUNDLE_FETCH_DIR`,
  `REBASE_DEBUG`; move the four off-table ones onto the table; add a gate
  that greps `process.env.` reads against the table.
  Check: the gate passes.

- **W9-16 · P1 · S · Property-level `admin.*` keys are documented.**
  Files: `collections/properties.mdx`.
  Do: add `filterOperators`, `Filter`, `customProps`, `format`, `urlPreview`,
  `renderInForm`.
  Check: every key in `AdminPropertyOptions` has a row.

- **W9-17 · P1 · M · A REST endpoint index, including `/api/admin/*`.**
  Files: new `backend/endpoints.md` (or a section of `backend/api.md`).
  Do: one table of every mounted route (method, path, gate, docs link),
  generated from the route inventory; add `aggregate` to api.md's table.
  Check: a gate compares the table to the mounted routes.

- **W9-18 · P2 · S · The changelog is in the sidebar.**
  Files: `astro.config.mjs`.
  Check: `docs/changelog` has a sidebar entry.

- **W9-19 · P2 · S · `rebase cloud` gets per-command docs.**
  Files: `cli/index.md:307-329`.
  Do: one subsection per group, generated from `ACTION_HELP` (W7-05).
  Check: `cloud resources` appears.

---

## W10 Admin panel and Studio

Branch `fix/admin-docs-and-studio-states`. W9-01 first.

- **W10-01 · P0 · S · Frontend overview leads with the composition the scaffold generates.**
  Files: `frontend/index.md:15-28,51`, `cms/src/components/app/Scaffold.tsx:117`.
  Do: `<RebaseAuth/><RebaseCMS/><RebaseStudio/><RebaseShell/>` first; the
  render-prop `Scaffold` form under "advanced: manual layout" with the
  provider order `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
  RebaseLayout`.
  Check: the first code block on the page runs in a scaffold.

- **W10-02 · P0 · S · The Custom Views sample compiles and says where `views` goes.**
  Files: `frontend/index.md:172-192`, `cms-types/src/controllers/navigation.ts:128-208`.
  Do: comma outside the comment; `icon`, `group`, `hideFromNavigation` at the
  top level; `<RebaseCMS collections={collections} views={views}/>`.
  Check: `pnpm verify:docs` (after W9-01) passes on the fence.

- **W10-03 · P0 · S · Plugins register through `<Rebase plugins>`.**
  Files: `plugins/index.md:49-67`, `RebaseNavigation.tsx:242-243`.
  Do: replace the `useBuildNavigationStateController` block; keep the hook
  form under manual composition.
  Check: the documented snippet works in a scaffold's App.tsx.

- **W10-04 · P0 · S · Sub-path recipe uses the data router and rebase.json.**
  Files: `getting-started/deployment.md:188-193,234`, template `main.tsx:17-24`.
  Do: point at `rebase.json apps.admin.path` and `createBrowserRouter([...],
  { basename })`; delete the `BrowserRouter` snippet.
  Check: no `<BrowserRouter` in the docs.

- **W10-05 · P1 · S · Delete the dead `basePath` and `baseCollectionPath` props.**
  Files: `packages/app/src/core/RebaseProps.tsx:120,126`, `Rebase.tsx:55-77`, `RebaseNavigation.tsx:131-140`, `frontend/index.md:46`.
  Do: remove from `RebaseProps` (no shim); document `basePath` on
  `<RebaseCMS>`; either wire `baseCollectionPath` through `RebaseCMSConfig`
  or drop it.
  Check: `check:api-surface` shows the removal; docs updated.

- **W10-06 · P1 · M · `devViews` works or goes.**
  Files: `packages/studio/src/components/RebaseStudio.tsx:35`, `cms-types/src/controllers/registry.ts:83`, `DefaultDrawer.tsx:167-179`.
  Do: read `devViews` in `RebaseStudio` and document "add a Studio tool", or
  remove it from the config type; consider `mode: "cms" | "studio"` on `AppView`.
  Check: a custom view can appear under Studio, and the docs show how.

- **W10-07 · P1 · S · Four Studio views keep an error state.**
  Files: `BackupsView.tsx:61-68,146-152`, `CronJobsView.tsx:157-166,222-230`, `ApiKeysView.tsx:88-96,149`, `BranchesView.tsx:79-86,186`; reference `LogsExplorer.tsx:240-256`, `storage-failure.ts`.
  Do: render the error inline in place of the empty state.
  Check: a 403 on list shows "refused" text, not "No backups found yet".

- **W10-08 · P1 · S · Schema Visualizer distinguishes loading from empty.**
  Files: `SchemaVisualizer.tsx:638-651`, `useSchemaGraph.ts:392`.
  Do: `undefined` = loading, `[]` = "No collections declared — run `rebase db
  pull` or open Edit collections".
  Check: a headless project shows the empty state, not a spinner.

- **W10-09 · P1 · S · Core hooks throw a useful error outside `<Rebase>`.**
  Files: `RebaseDataContext.tsx:4`, `AuthControllerContext.tsx:4`, `DialogsProvider.tsx:5`, `CustomizationControllerContext.tsx:4`, `StorageSourceContext.tsx:4`, `useRebaseRegistry.tsx:74`.
  Do: default to `null`; throw "useX must be used inside <Rebase>".
  Check: `useData()` outside the tree throws that message.

- **W10-10 · P1 · M · Studio strings go through i18n; the i18n system is documented.**
  Files: `RebaseStudio.tsx:61-146` and the 21 component files; new `frontend/i18n.md`; `frontend/index.md:35-47`.
  Do: `studio_*` keys for tool names, groups, descriptions and the empty
  states; a page on `translations`, `locale`, `useTranslation`; regenerate the
  `<Rebase>` props table from `RebaseProps` (all 24).
  Check: `check:untranslated` covers Studio and passes.

- **W10-11 · P1 · S · Remove the deep-import recommendations.**
  Files: `packages/studio/src/index.ts:29-30`, `packages/cms/src/index.ts:120`, `packages/studio/README.md:58`.
  Do: delete the sentences, or add real subpath exports with `types`.
  Check: no recommended import fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- **W10-12 · P1 · M · The RLS editor goes through plan/apply.**
  Files: `RLSEditor.tsx:728,809-852,990-996,1065`, `saveSecurityRules.ts:26-34`, `schema-editor-routes.ts:87-90`.
  Do: route mapped-table writes through `useLiveSchemaEditing.reviewChange`;
  put the remedy in the UNAPPLIED chip; replace `confirm()` with
  `ConfirmationDialog`.
  Check: "Create policy" opens the same plan dialog the collection editor does.

- **W10-13 · P2 · S · Stale mode and group names.**
  Files: `frontend/index.md:148,152`, `hooks/index.md:506`, `cron-jobs.md:307`.
  Do: `"cms" | "studio" | "settings"`; Cron under Compute; generate the tools
  table's group column from `RebaseStudio.tsx`.
  Check: `grep -rn '"content"' website/src/content/docs/docs/frontend website/src/content/docs/docs/hooks` is empty.

- **W10-14 · P2 · S · Empty-state remedies name real things.**
  Files: `BranchesView.tsx:145-146`, `BackupsView.tsx:143`, `CronJobsView.tsx:226-228`.
  Do: `ADMIN_CONNECTION_STRING`; a `rebase.pro/docs/...` link; `backend/crons/`.
  Check: no repo-relative path in a published UI string.

- **W10-15 · P2 · M · Public surface without dogfood internals.**
  Files: `packages/app/src/components/index.tsx:13-15`, template `vite.config.ts:36-95`, template App.tsx `<RebaseAuth/>`, template `package.json` (`@rebasepro/plugin-ai`), `RebaseLayout.tsx:44`, `SlotContribution`, `extending.md`, `docs/ui/components/*.mdx` generator.
  Do: move `UIReferenceView`, `UIStyleGuide`, `CrmDashboardDemo` to a
  `@rebasepro/app/debug` subpath or into `app/`; a `rebaseVitePreset()` in
  place of the copied `manualChunks`; drop or comment the no-op
  `<RebaseAuth/>`; remove the unused plugin dep; fix the `RebaseLayout`
  JSDoc; type `SlotContribution.Component`; add a `home.card.widget` row to
  the decision table; let the UI doc generator pull JSDoc into the 488 empty
  description cells.
  Check: `check:api-surface` reviewed; the template builds with the preset.

---

## W11 MCP and agent skills

Branch `fix/mcp-and-skills`.

- **W11-01 · P0 · S · Env vars win over the persisted registry.**
  Files: `packages/mcp/src/index.ts:329-352`, `docs/ai/mcp.md:265-272`.
  Do: build the `default` project from `REBASE_PROJECT_DIR`/`REBASE_BASE_URL`/
  `REBASE_API_TOKEN` on every start when any is set, falling back to the
  persisted default only when none is; warn on stderr when env is ignored
  (should then never happen); delete the doc's admission.
  Check: test: registry with a default, env set → `rebase_project_current`
  reports the env values.

- **W11-02 · P0 · S · The npm README's command works and its tables are generated.**
  Files: `packages/mcp/README.md:14,79,117-118,157`, `tooling/scripts/docs-verify/check-doc-commands.mjs` (`DOC_GLOBS`).
  Do: `npx -y @rebasepro/mcp`; add `packages/*/README.md` to the glob;
  generate the tool tables from `ALL_TOOLS` (a script plus a gate that diffs).
  Check: `pnpm verify:docs` fails on `npx rebase-mcp`.

- **W11-03 · P0 · S · Delete the cloud-login prerequisite from rebase-basics.**
  Files: `tooling/rebase-agent-skills/skills/rebase-basics/SKILL.md:15-23`, `kiro/POWER.md:29-31`.
  Do: replace with "the MCP server needs a running `rebase dev` or
  `REBASE_SERVICE_KEY` in `.env`; nothing else"; remove `tokens.json`,
  Google OAuth and `list_projects`.
  Check: `grep -rn "list_projects\|tokens.json\|Google OAuth" tooling/rebase-agent-skills` is empty.

- **W11-04 · P0 · S · `uid` everywhere.**
  Files: `packages/mcp/src/index.ts:960-965,975-981`, `rebase-basics/SKILL.md:848-849`, `packages/mcp/README.md:117-118`.
  Do: covered by W11-02's generated tables; fix the skill by hand.
  Check: `grep -rn "userId" tooling/rebase-agent-skills/skills/rebase-basics packages/mcp/README.md` is empty.

- **W11-05 · P1 · S · The scaffold's always-on rule names a real accessor.**
  Files: `templates/template/ai-instructions.md:17`, `docs/ai/instruction-files.md:59,68-73`.
  Do: `rebase.dataAsAdmin.<slug>` (or `getDriver(c)` for request-scoped
  reads); fix the guard import sentence and the rule count; generate the docs
  page from the template.
  Check: every accessor named in ai-instructions exists on `RebaseServerClient`.

- **W11-06 · P1 · M · A scaffolded agent file with commands, a never-list, and `.mcp.json`.**
  Files: `templates/template/CLAUDE.md`, `ai-instructions.md`, `packages/cli/src/commands/init.ts`, `skills.ts:310-316`, repo `AGENT.md:88-105` as the source.
  Do: ~40 lines: `rebase dev`, `rebase schema generate && rebase db push`,
  `rebase build`, `rebase doctor`; never deploy, never edit `.env` or
  `schema.generated.ts`, never `--allow-destructive` on anything but local;
  `rebase skills install --agent <name>`; `defineCollection` import; init
  writes `.mcp.json` (`npx -y @rebasepro/mcp`, no `REBASE_PROJECT_DIR`).
  Check: a fresh scaffold has `.mcp.json` and an agent file naming every
  script in `package.json`.

- **W11-07 · P1 · M · Recipes at the top of rebase-basics; reference tables out of the way.**
  Files: `skills/rebase-basics/SKILL.md`, `skills/rebase-collections/SKILL.md:55,58-129,1865,1943-1959`, `skills/rebase-auth/SKILL.md:910-965`, `skills/rebase-security/SKILL.md:544`, `generate_sdk.ts:69`.
  Do: a 30-line Recipes block (collection + barrel registration +
  generate/push; function; RLS rule including `StructuredSecurityRule`;
  deploy); fix `->` to `->>`; move long tables to `references/`.
  Check: rebase-basics under 300 lines; "add a collection" mentions the
  `collections` array.

- **W11-08 · P1 · S · The deployment skill's self-hosting half matches the template.**
  Files: `skills/rebase-deployment/SKILL.md:225-300,568-780`.
  Do: `rebase build && docker compose up` with the `REBASE_VERSION` pin;
  delete the Dockerfile recipes or move them to contributor docs.
  Check: `grep -n "Dockerfile" skills/rebase-deployment/SKILL.md` finds only the eject note.

- **W11-09 · P1 · M · `rebase_schema_plan`, and a way through the destructive gate.**
  Files: `packages/mcp/src/index.ts:733-745`, `live-schema-routes.ts:380-392`, `server-postgres/src/cli.ts:365-399`.
  Do: a plan tool wrapping `POST /api/admin/schema/plan` (or `db push
  --dry-run`); either an `allowDestructive` input on push (still
  loopback-gated) or a refusal that names `rebase db push --allow-destructive`
  for the human; `isError: true` on the refusal.
  Check: an agent can show the SQL before asking the human to confirm.

- **W11-10 · P1 · S · Ship or delete the launcher manifests.**
  Files: `tooling/rebase-agent-skills/{gemini-extension.json, kiro/, .claude-plugin/, .cursor-plugin/}`, `package.json:13-15`, `server.json:5,14`.
  Do: decide; if shipping, put them where the installers look and fix
  POWER.md's invented tools and the versions; if not, delete them and their
  gate.
  Check: no manifest describes a tool that is not in `ALL_TOOLS`.

- **W11-11 · P1 · S · MCP setup for five agents; installer covers seven.**
  Files: `docs/ai/mcp.md:22-40`, `packages/cli/src/commands/skills.ts:20-65`.
  Do: copy-paste blocks for Claude Code, Cursor, Gemini CLI, Codex (TOML),
  Kiro; add `codex` and `kiro` targets to `AGENTS`.
  Check: every agent `rebase init` writes a pointer file for has an install target.

- **W11-12 · P1 · M · A claims check for skills.**
  Files: `tooling/scripts/docs-verify/` (new stage), the drift list: `rebase-api:38,74,78,146`, `rebase-sdk:469`, `rebase-cron-jobs:387`, `rebase-basics:11,369`, `rebase-email:82`, `rebase-admin:12`, `rebase-studio:8`, `rebase-design-language:710`, `rebase-local-env-setup:41,93`, `docs/ai/mcp.md:397-402`, `docs/ai/index.md:13`.
  Do: fix each by hand now (limits 50/1000, `like` exists, PUT deprecated,
  `/api/admin/cron`, `defineCron`, remove `NewPassword123!`, Node ≥22.22,
  `pgvector/pgvector:pg18`, `EmailSendResult`, `SidePanelProvider`, 11 tools,
  `findBackendDir`, 21 skills); then a check that reads these numbers, paths
  and names from source and greps the skills for contradictions.
  Check: the stage runs in `verify:docs` and is green.

- **W11-13 · P2 · S · MCP error ergonomics.**
  Files: `packages/mcp/src/index.ts:1256-1275,1375,1439-1442,1585,1665,1699-1707,1846`.
  Do: `isError` on non-zero CLI exit; fetch failures include `baseUrl` and
  "is `rebase dev` running? (`rebase_dev_start`)"; `project_add` message
  without `--baseUrl`; `--help`/`--version` before connecting; rename
  `storage_get_metadata` or make it return metadata; move
  `rebase_schema_introspect` out of `READ_ONLY_TOOLS`; `dev_logs` counts lines.
  Check: each has a test in `packages/mcp/src/*.test.ts`.

- **W11-14 · P2 · S · Flat-layout installs are short.**
  Files: `packages/cli/src/commands/skills.ts:21-53`.
  Do: for Cursor and Windsurf install a short index rule with `alwaysApply`/
  `globs` pointing at the skill directories, not 84K files.
  Check: no installed file over 8K characters.

- **W11-15 · P2 · S · README "Built-in MCP Server" links to setup.**
  Files: `README.md:337-339`.
  Check: the paragraph links `/docs/ai/mcp` and shows the `.mcp.json` block.

---

## W12 rls-check

Branch `fix/rls-check-role-and-docs`.

- **W12-01 · P1 · S · Keyword strings parse or are refused.**
  Files: `packages/rls-check/src/cli.ts:859`, `redact.ts:18-19`, `introspect.ts:230`.
  Do: translate a parsed keyword string into `Client` options, or refuse with
  "use a URL"; fix the hint and docblock.
  Check: `rls-check "host=127.0.0.1 port=1 dbname=x user=u password=p"` names
  127.0.0.1:1 in both headline and detail.

- **W12-02 · P1 · S · The website's command is the safe form.**
  Files: `website/src/i18n/en.ts:956,1074` (and other locales' keys).
  Do: `npx @rebasepro/rls-check`.
  Check: `grep -rn 'rls-check \$DATABASE_URL' website/src/i18n` is empty.

- **W12-03 · P1 · S · An unknown `--role` is an error.**
  Files: `introspect.ts:882-890`, `cli.ts:826-841`.
  Do: exit 2 when a `--role` is not in `pg_roles` (same reasoning as `--skip`).
  Check: `--role app_usr` fails with the role name.

- **W12-04 · P1 · M · The connecting role and SELECT-only roles are considered.**
  Files: `introspect.ts:927,935`.
  Do: treat the connecting role as a candidate when it is not privileged (say
  so in a Note); include SELECT-only unrecognised grantees in the caveat.
  Check: scanning as a SELECT-only app role on an RLS-disabled table reports it.

- **W12-05 · P1 · S · Docs list all 11 flags; the report names the exposed roles.**
  Files: `website/src/content/docs/docs/rls-check.md:51-61`, `packages/rls-check/README.md:195-210`, `report.ts`.
  Do: add `--role` and `--html`; one header line `Exposed  PUBLIC, anon,
  authenticated (add yours with --role)`.
  Check: `--help` flag count equals the docs table.

- **W12-06 · P2 · S · The README's JSON sample is real and the gate sees it.**
  Files: `README.md:278`, `check-rls-check-count.mjs:102`.
  Do: paste a real `--json` run (with `diagnostics`); extend the regex to
  `checksRun"?:\s*\d+`.
  Check: the gate fails when the sample states fourteen.

- **W12-07 · P2 · S · Real output in both samples.**
  Files: `website/src/components/RlsCheckReport.astro:22-58`, `README.md:54`.
  Do: paste real `--no-color` output; drop "Platform Supabase" for a non-Supabase host.
  Check: severities and summary-line format match `report.ts`.

- **W12-08 · P2 · S · Drop the `@` refusal claim.**
  Files: `README.md:222`, `cli.ts:854-866`.
  Check: the README describes what the code does.

---

## W13 Packaging and install

Branch `fix/packaging-contract`.

- **W13-01 · P1 · S · `z` from `@rebasepro/server`.**
  Files: `packages/server/README.md:27`, `packages/server/src/index.ts`, `contracts/server.api.txt`.
  Do: export the runtime's `z` (and baseline it), since that is the fix for
  the duplicate-zod class; or delete the row and document the caveat.
  Check: `import { z } from "@rebasepro/server"` resolves; `custom-server.md` uses it.

- **W13-02 · P1 · S · CLI README Quick Start.**
  Files: `packages/cli/README.md:63-69`.
  Do: the quickstart's sequence (`pnpm dlx @rebasepro/cli init`, `pnpm
  install`, `pnpm run dev`); mention `rebase status` and `rebase skills install`.
  Check: identical to `quickstart.md:34-45`.

- **W13-03 · P1 · S · Studio deep imports: covered by W10-11.**

- **W13-04 · P1 · M · A version handshake.**
  Files: `packages/client/src/transport.ts`, `packages/cli/src/commands/cloud/context.ts:195`, `saas/backend/src/managed/intake.ts:167`, `contract-routes.ts:110,124`, `compatibility.md:120,181`.
  Do: the SDK sends `x-rebase-schema` as documented; the CLI sends
  `User-Agent: rebase-cli/<v>`; the control plane answers `CLI_TOO_OLD` with
  the minimum version; expose `runtime.version` on an unauthenticated route.
  Check: an old CLI against the control plane gets a message naming the version.

- **W13-05 · P1 · S · One Node floor.**
  Files: every `packages/*/package.json` `engines`, `quickstart.md:23`, `.nvmrc`.
  Do: `>=22.22.0` everywhere (matches app, cms, studio and `.nvmrc`); state
  it once in the docs.
  Check: `pnpm check:version-pins` (or a new gate) asserts one value.

- **W13-06 · P1 · S · `init` resolves versions without 11 round-trips.**
  Files: `packages/cli/src/commands/init.ts:889-931`.
  Do: pin `cliVersion` directly (lockstep is gated); one `npm view` as the
  release-gap probe.
  Check: `rebase init --yes` offline succeeds with a clear note.

- **W13-07 · P1 · S · LICENSE in every tarball; `license` on agent-skills.**
  Files: `packages/{client,cms,codegen,mcp,plugin-insights,rls-check,utils}/`, `tooling/rebase-agent-skills/package.json`.
  Do: copy the root LICENSE; add `"license": "MIT"` and keywords; extend
  `check:package-contents` to require LICENSE and to include agent-skills.
  Check: the gate fails on a package without LICENSE.

- **W13-08 · P2 · S · React peers `^19.2.7` everywhere.**
  Files: `packages/{app,ui,forms,firebase,plugin-insights,cms-types}/package.json`; `typescript >=5` on app.
  Check: `grep -rn '"react": ">=' packages/*/package.json` is empty.

- **W13-09 · P2 · S · Duplicate Radix dialog, chalk, dotenv.**
  Files: `packages/ui/package.json`, `cmdk`, `packages/server-postgres` (chalk 4), template `dotenv`.
  Do: align `cmdk` or add a resolution; chalk 5; dotenv 17.
  Check: `pnpm why @radix-ui/react-dialog` shows one version.

- **W13-10 · P2 · S · Delete the dead `pnpm.onlyBuiltDependencies`.**
  Files: `packages/cli/package.json:83-88`.

- **W13-11 · P2 · S · Scaffold types match its Node floor.**
  Files: template `backend/package.json:26`, `frontend/package.json:43`, `backend/tsconfig.json:5`.
  Do: `@types/node ^22`; `moduleResolution: "bundler"` for the backend.
  Check: the scaffold typechecks on TS 6.

- **W13-12 · P2 · M · A public entry for the CLI; curated barrels elsewhere.**
  Files: `packages/cli/package.json` exports, `packages/cli/src/index.ts`, `packages/server/src/index.ts`, `packages/types/src/index.ts`.
  Do: CLI exports a tiny public entry (or no library entry); `@internal` tags
  on runtime plumbing in server/types.
  Check: `check:api-surface` reviewed; export counts drop.

- **W13-13 · P2 · L · A slim init entry.**
  Files: new `packages/create-rebase-app` (or a lean `init` bin).
  Do: an init that does not pull server, server-postgres or pglite; the heavy
  CLI stays a project devDependency.
  Check: `pnpm dlx` cold start under 10 MB.

- **W13-14 · P2 · S · Stop shipping `src/` alongside `sourcesContent`.**
  Files: `packages/client/package.json:71-80` and siblings with `src` in `files`.
  Check: cms tarball under 5 MB.

- **W13-15 · P2 · S · Misc.**
  Files: `packages/mcp` and `packages/rls-check` `exports`; `sideEffects` per package; `packages/cli/src/utils/package-manager.ts:12,134-147`; README (ESM-only); `packages/client-postgres/` debris; git tags.
  Do: exports maps; `sideEffects: false` (ui lists its CSS); yarn/bun get a
  matching scaffold or a clear note; state ESM-only; delete the debris; note
  the FireCMS-era tags.
  Check: each line verified.

---

## W14 Contributor experience

Branch `docs/contributing-to-green`.

- **W14-01 · P0 · S · CONTRIBUTING step 4 succeeds.**
  Files: `CONTRIBUTING.md:41-46`, `app/.env.example:6`, `app/backend/docker-compose.yml:22-24`.
  Do: add `cp app/.env.example app/.env`; make the example URL match the
  compose credentials with `?sslmode=disable`; or document the PGlite default
  and make Docker + `db:push` the "schema changes" path.
  Check: a fresh clone following the steps reaches a running app.

- **W14-02 · P0 · S · `verify-quality.sh` runs on a fresh clone and means something.**
  Files: `tooling/scripts/verify-quality.sh:36,45,63`, `CONTRIBUTING.md:79-82`, `.github/PULL_REQUEST_TEMPLATE.md:18`.
  Do: `pnpm exec playwright install chromium` in CONTRIBUTING; drop or declare
  `fallow`; call `pnpm typecheck` and the static gate list (W14-03).
  Check: the script exits 0 on a fresh clone after the documented steps.

- **W14-03 · P1 · S · `pnpm ci:static` mirrors CI.**
  Files: `package.json`, `.github/workflows/verify.yml:99-317`.
  Do: a script running exactly the `static` job's list; verify.yml calls it.
  Check: the workflow step is a single `pnpm ci:static`.

- **W14-04 · P1 · S · Protect `main`; fix the red gate.**
  Files: GitHub ruleset; the `check:unused` failure on run 33878581195.
  Do: require the `verify` check; bank or fix the discarded value. (Ruleset
  change is the user's call.)
  Check: `gh api repos/rebasepro/rebase/branches/main/protection` is not 404.

- **W14-05 · P1 · S · Commit and changelog conventions in CONTRIBUTING.**
  Files: `CONTRIBUTING.md`, `.github/internal/PUBLISHING.md:35-47`.
  Check: `feat(scope): lowercase` and "only edit `## [Unreleased]`" appear in CONTRIBUTING.

- **W14-06 · P1 · S · "Run `pnpm -C website generate-all` after editing the changelog or docs/*.md".**
  Files: `CONTRIBUTING.md`.
  Check: the sentence exists next to the changelog instruction.

- **W14-07 · P1 · M · A Testing section.**
  Files: `CONTRIBUTING.md`, every `packages/*/package.json` (`test:watch`).
  Do: runner per package, one-file invocation, watch mode, Docker and
  build-before-e2e, `--experimental-vm-modules` for server; add `test:watch`.
  Check: every package has `test:watch`.

- **W14-08 · P1 · M · `docs/gates.md` and a naming rule.**
  Files: new `docs/gates.md`, `package.json:56-110`.
  Do: a table (name, what it protects, CI job, how to bank the baseline)
  checked against package.json so it cannot rot; state `check:` / `verify:` /
  `test:`; rename `rls:check` to `check:rls` or say why not.
  Check: a gate fails when a script is missing from the table.

- **W14-09 · P1 · S · Wire `check:browser-deps` into the static job.**
  Files: `.github/workflows/verify.yml`, `package.json:58`.
  Check: it runs on every PR.

- **W14-10 · P1 · S · Comment the private workspace entries; delete the stale `workspaces` field.**
  Files: `pnpm-workspace.yaml:10-13`, `package.json:11-39,36-38,44-45`.
  Check: a public clone's `pnpm install` prints no warning about missing saas dirs.

- **W14-11 · P1 · S · Clone size.**
  Files: `CONTRIBUTING.md`, `.gitattributes`, `website/public/img`.
  Do: document `git clone --filter=blob:none`; consider LFS for webm/mp4.
  Check: the hint is in CONTRIBUTING.

- **W14-12 · P2 · S · README links Contributing; coding-standards is linked; `.agents/AGENTS.md` merged.**
  Files: `README.md`, `CONTRIBUTING.md`, `.agent/workflows/coding-standards.md`, `.agents/AGENTS.md`.

- **W14-13 · P2 · S · `app/README.md` matches `rebase dev`.**
  Files: `app/README.md:17,30,43,47-51`.
  Do: Node 22, real scripts, free port; or delete in favour of CONTRIBUTING.

- **W14-14 · P2 · S · `pnpm exec`, not `npx`.**
  Files: `verify-quality.sh`, `verify.yml:225,567,678,712`.
  Check: no "npm warn Unknown project config" in a local run.

- **W14-15 · P2 · S · Local debris and stale hook paths.**
  Files: `AGENT.md:110,126,132,140`, `.claude/settings.json`, `website/test_out.html`, `packages/client-postgres/`.
  Do: `tooling/scripts/harness/…` paths; delete the tracked 1-byte stray and
  the dist husk.
  Check: the PreToolUse deploy gate loads.
