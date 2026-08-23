# The night of 2026-08-22

Status: **work log + decisions waiting**. Branches `feat/shared-pod-spec` and
`feat/unify-bundle-delivery` (main repo), `feat/unify-bundle-delivery` (saas).
Nothing pushed, nothing merged.

Started from one question — can the Helm chart be used for the cloud too — and
ended up somewhere more useful: the *class* of defect that question exposed, and
a hunt for the rest of it.

---

## 0. Read this first

**A release blocker was found in my own work, and fixed.** Deleting the bundle
init container (saas `7ef00fd`) would have taken down every managed tenant on
merge, because the runtime image could not fetch a bundle at all. Three
independent things blocked it and each was invisible to every gate this repo
has. Details in §2.1. It is fixed and now gated by a job that boots the image.

**One finding is a security decision and is deliberately not patched:**
`setup_keys.key`. See §4.

---

## 1. The class

Every defect below is one shape: **a contract between two sides, where no test
spans both.** Side A reads or builds an identifier, side B was supposed to
produce it, and nothing checks the two spellings agree. It always fails silently,
and the tests are always green, because each side is tested against its own idea
of the contract.

Instances found and fixed tonight:

| Identifier | What it broke |
|---|---|
| `rebase-bundle.json` | The marker `fetchBundle` looked for. Nothing has ever written it — the CLI writes `manifest.json`. URL bundle delivery was dead from its first commit. |
| `REBASE_BUNDLE=/bundle` (image ENV) | Made `shouldFetchBundle()` false, so even a fixed marker would not have helped. |
| the entrypoint's existence check | Exited 1 before `@rebasepro/server` was imported. Three blockers, so removing any one changed nothing. |
| `TRUSTED_PROXY_HOPS` | Set on the functions unit with a comment saying "same as the api"; never on the api. Every caller shared one rate-limit bucket. |
| `migrationJob.mode: push` | Validated and recommended by the chart, refused by the image. Crash-looped the API when the Job was disabled. |
| seven presentation keys | Accepted at the top level of a property by an allowlist, so the migration hint that would have moved them was unreachable and the values were dropped. |
| `chokidar` | A file watcher statically imported by the database driver, pruned from the image — so the image could not load its own driver. |
| `projects.storage_sources` | Written on every managed deploy, declared nowhere, rejected as an unknown field, and swallowed by a log-only catch. |
| `rollouts.moved_from` | Same, on the column a rollout revert reads to put each project back. |
| `<projectDir>/app/backend` | The MCP server's schema resource and dev-start assumed this monorepo's layout. Dev-start killed the whole MCP server. |

---

## 2. What was fixed

Commits are on the branches; each message carries its own reasoning. Grouped
here by what a reader would care about.

### 2.1 The runtime image could never fetch its own bundle

`bundle.mode=url` in the chart, and the Cloud Run substrate, both set
`REBASE_BUNDLE_URL`. Both got `No bundle found at /bundle.` and exited, since
before either shipped. That is *why* Kubernetes grew an init container: the
supported path did not work, so a second implementation was written in shell to
do its job — 146 lines of embedded script, and the worst failure in the managed
path (an `npm install` that ran out of disk, hung in `epoll_wait`, and produced
no log line, no event and no exit code).

Fixed end to end: the marker comes from the loader now, the entrypoint stands
aside in fetch mode, the Dockerfile no longer bakes the variable, and the runtime
streams, retries, installs dependencies and dedupes the framework copy itself.
The init container is deleted.

**The gate that was missing.** Every gate in this repo asserts on something
*rendered* — helm output, a container object, an image tag. Nothing had ever
executed `docker/entrypoint.mjs` or started the image. That is precisely why an
image ENV could defeat two producers whose gates both assert the variable's
absence from the spec. `scripts/check-runtime-image-boots.mjs` builds the image
and boots it against a real Postgres, both ways a bundle can arrive, and checks
it still refuses when given neither. Mutation-tested against all three original
blockers.

### 2.2 Probes, drains and rate limits

- Chart liveness was on `/health`, which opens every configured driver and
  answers 503. Liveness *restarts*, so a database blip restart-looped every
  self-hosted pod. The runtime says so at its own `/livez` registration and the
  published guide says so in a table; the chart did the opposite.
- The cloud had no startup probe, so liveness measured the first boot: 80
  seconds, then a restart that started over.
- The chart had no preStop drain; the static-app Deployment had none either, and
  its shutdown handler was a no-op that never closed the server.
- `TRUSTED_PROXY_HOPS` was never set on the api.

All four now come from one place — `packages/server/src/deploy/pod-contract.ts`
— which the control plane imports and the chart is gated against.

### 2.3 Measured, not assumed

The concern that the deleted init container was protecting the install's memory:
**closed, with ~10x margin.** npm's peak scales with what it is given (V8 sizes
its heap from the cgroup limit), so measuring at the limit measures generosity.
The real requirement is ~200 MiB against a floor of 2Gi that no tier can dial
below. Numbers in `docs/pod-spec-parity-2026-08-22.md` §5.4.

The measurement found something the question did not ask: an OOMKilled install
leaves `node_modules` holding 124 of 156 packages, which a directory check cannot
tell from a finished one — so the restart skipped the install and booted on a
tree missing a third of its dependencies. A failed install deletes what it wrote
now.

---

## 3. New gates

| Gate | What it catches that nothing else could |
|---|---|
| `check:runtime-image:boots` | Anything inside the image — an ENV, an entrypoint guard — that defeats a correct manifest. |
| `check:schema-drift` (saas) | A column the database has and the collections refuse to write, so writes are rejected and log-only callers lose them. |
| chart contract parity | Probe paths on every unit, the drain on every rendered workload, and both directions of the topology-variable list. |
| `admin-keys-are-not-top-level` | A presentation key added to the property allowlist, where nothing would read it. |

Every one is mutation-tested. Three of them were red when written and are green
now; that is the only evidence worth having.

---

## 4. Decisions waiting for you

I did not touch these. Each needs a judgement I should not make alone.

### 4.1 `setup_keys.key` — a security fix that left the old column behind

The collection moved from `key` to `key_hash` (SHA-256) as a deliberate security
fix; its comment says the old column held setup keys verbatim and that "a leaked
backup carried every key". `provisionCollectionTables` is additive by design — it
may create the new column and **may never drop the old one**. So every database
provisioned before that fix still has `key`, with its plaintext values, in the
table and in every backup.

Not declaring it is correct. Leaving it there is not. Dropping it is a
destructive migration against credentials and belongs to you. It is recorded as a
named exception in `check:schema-drift`, with its reason, so the gate is green
and the exception is a line of code someone has to delete.

### 4.2 The chart's migration Job refuses to run

`helm install` with default values renders a pre-install Job that sets
`REBASE_ROLE=worker` alongside a non-`none` `REBASE_MIGRATE_ON_BOOT`, which the
runtime refuses — so the documented Kubernetes install path has never created a
schema. Either `resolveRole` learns that `REBASE_PROVISION_ONLY=true` makes a
one-shot process a legitimate schema owner, or the Job drops `REBASE_ROLE`. The
code is small either way; which side moves is the decision.

### 4.3 Controls that write columns nothing provisions from

Found by the first hunt, verified, untouched:

- **`enableVpc` / `vpcCidr`** — the console sells "Enable Isolated Private VPC —
  provision a private virtual switch subnet for maximum machine isolation",
  regex-validated and gating the wizard's Continue button. Tenants get the
  unconditional `tenant-isolation` NetworkPolicy; the dedicated subnet the copy
  describes does not exist. **This is a customer-facing security claim.** Removing
  the control is small; building per-tenant subnets is a project.
- **`backupRetention` / `backupWindow`** — six selectable values, including "30
  Days (Compliance SLA)", against five sites that hardcode `30d` and
  `0 0 0 * * *`. The error direction is over-retention, not lost backups.
- **`storageMode`** — a live console Choice and a published CLI flag whose value
  is read by exactly one line in the repo: a test assertion.
- **`RolloutProject.cohort`** — the console offers "A named cohort" as a wave
  kind; no column exists, so a cohort wave selects zero projects and the
  controller treats an empty wave as progress. The canary soak before a
  fleet-wide runtime upgrade is skipped, silently.
- **`CORS_ORIGINS`** — a managed customer can set it, the write is accepted,
  stored, and reported as pending redeploy, and then shadowed name-for-name by
  the platform on every deploy. Either merge it or refuse the write.

### 4.4 The bundle GC has no caller

`planBundleRetention` is written, tested and unreachable: no cron imports it, and
the only lifecycle rule is scoped to `build-contexts/`. Every bundle upload is
permanent storage that any org member can create without deploying.

---

## 4b. Another session was working on the same files

`main` moved overnight and a trial merge conflicts in four files. This is not a
problem to resolve blind — it is information.

**The same bug was found twice, independently.** `27238a597 fix(selfhost): the
published image could not load its own driver` is the chokidar fix, same
diagnosis and same remedy (lazy import), reached from the other direction: they
built `verify:selfhost:docker`, which runs the compose recipe the way a stranger
runs it, and it found the same thing on its first run. It also found a database
restart-loop the compose file has had since the postgres 17 → 18 bump. So my
`757019e9d` is redundant — take theirs.

**Their gate and mine are complements, not duplicates.**
`verify:selfhost:docker` exercises the documented compose recipe end to end from
outside the container. `check:runtime-image:boots` exercises the image's two
bundle-delivery modes against a real Postgres, including `bundle.mode=url`, which
the compose recipe does not use. Both are worth having; neither subsumes the
other.

**The collision found a real gap in my work.** `b0a97a1f3` changed the
entrypoint's dedupe so it LINKS the framework in when the bundle has none, rather
than only repairing a duplicate — because absent is the common case, and without
it every custom function fails to load while the pod reports healthy. I had
lifted that step into the runtime *with the flaw*, and the fetch path would have
reproduced it. Fixed in `9d8eb54f5`, mutation-tested.

Conflicting files, for whoever integrates: `docker/entrypoint.mjs`,
`packages/server-postgres/src/schema/generate-{drizzle-schema,postgres-ddl}.ts`,
`packages/server/src/collections/validate-config.ts`. The last is an ordinary
context conflict with the vector-index work.

---

## 4c. The second hunt: 22 verified, 21 distinct

Six lanes — HTTP routes, realtime wire names, generated identifiers, schema
drift, permission strings, i18n and product claims. Two lanes converged on the
same verb independently, which is a signal about the socket's authorization
surface rather than a duplicate.

**Fixed tonight, both security:**

- **`FETCH_APPLICATION_ROLES` was not gated.** Ten privileged socket verbs, nine
  in `ADMIN_ONLY_TYPES`. The tenth enumerated every role in the users table
  through the owner connection, where RLS does not apply — reachable by any
  authenticated non-admin, and by an anonymous socket under `requireAuth:
  false`. The test that exists to prevent this held a hand-typed copy of the
  same nine strings.
- **A revoked access token still authenticated a socket.** `verifyRequest` reads
  the revocation watermark; `verifyToken` — what the AUTHENTICATE handler calls
  — did not. Signing out closed a stolen session's HTTP requests and left its
  realtime connection working.

Both now have tests that read the source instead of a copy of it. The
**already-open** socket is a separate question and is *not* fixed: nothing
re-checks a connection after AUTHENTICATE, so a session revoked mid-connection
survives until it reconnects (docs/audits/32, H3). That is a decision about
socket lifetime.

**Also fixed:** the cloud CLI never printed a price (`invoke("pricing/quote")`
— the SDK encodes the name, so the slash 404'd, and a bare `catch {}` blamed
"a control plane without the quote endpoint"), and the schema-drift gate I added
last night was declared and run by nothing.

**Claims that need your words, not a patch** — four are security or residency
representations:

- **SSH tunnelling.** The wizard sells "Proxy database connections through an
  encrypted SSH bastion behind your firewall", collects host/port/user,
  generates and stores an encrypted keypair, and asks the customer to install
  the public key. The only code that opens a tunnel is the "Test connection"
  button; deploy, backup, restore and the connection-string reveal all use the
  raw connection string, and the tenant image has no SSH client. Build it or
  delete the toggle.
- **The public security page.** "Each project gets its own CloudNativePG cluster
  in its own namespace" is false for the shipped default (`databaseMode:
  "shared"`). The neighbouring isolation claim is *true but attributed to the
  wrong mechanism* — pg_hba `sameuser` plus per-database roles, while the
  NetworkPolicy opens 5432 to the whole shared namespace.
- **"Located in Frankfurt/EU"** — production provisions into `europe-west1`,
  which is Belgium. Two strings, one wizard step after a field that prints the
  true region.
- **Backup retention and window** — the same dials from §4.3, now with the
  detail that `backup_30_days: "30 Days (Compliance SLA)"` is an orphaned locale
  string for a picker that renders nowhere.

**Left for you, ordered by consequence** (full detail in the run's report):
storage object keys interpolated unencoded and decoded twice, so `Invoice
#12.pdf` resolves the wrong object and `100% done.png` 500s; BaaS introspection
publishing camelCase keys over snake_case tables, so an introspected project
contradicts the SDK it generated in the same boot; the schema generator writing
`const 2024_archiveCollection` with no identifier guard, which bricks a whole
collections directory from a documented flow; `include` accepted by `.listen()`
and discarded; `vectorSearch` on `.listen()` where the guard exists and cannot
fire; and four MCP branch tools that fail authorization on every call.

---

## 4d. Also fixed after the second hunt landed

A cluster of one shape: **a derived name reaching an `export const` with nothing
checking it can be declared.** Three places, none of which guarded it, in files
where the neighbouring code guards property keys and member accesses and
explains why in a docblock.

| Where | Input | What it wrote |
|---|---|---|
| `getTableVarName` (common) | table `2024_archive` | `export const 2024Archive = pgTable(…)` |
| same | table `reporting.events` | `export const reporting.events = …` |
| the drizzle generator | `search: { column: "search-vector" }` | `,' expected` |
| `AstSchemaEditor` | slug `my-notes` | `const my-notesCollection: …` |

Each fails the build for the WHOLE collections directory, because
`schema.generated.ts` and every collection file are imported together. The last
is reachable from the admin panel, which reports success and then cannot parse
the file it wrote, so it cannot fix itself. The first is reachable from
`rebase init` against a database holding a table called `2024_archive`.

Every fix is a no-op for names that already worked — asserted, not claimed — so
touching a derived name is safe here: the only outputs that move are the ones
that were a syntax error, and nothing can be running against those.

**One reported finding did not reproduce, and the report was wrong about it.**
The injection route through `relationName` — a `"` closing the string literal in
a file the server imports — cannot happen: the value is derived before it reaches
the template, so `ev"il` emits `posts_evIlId`. Verified by generating it and then
by mutating all five escaped sites back and watching the output still parse. The
escaping stays for consistency with the file's own convention; it is one fix,
not five.

Also fixed: the cloud CLI never printed a price, and the schema-drift gate added
earlier in the night was declared and run by nothing until it was wired into
saas CI.

---

## 5. What this did not cover

Two hunts ran. The first covered env vars, filenames, manifest keys, fields
plumbed but never assigned, vacuous tests, and duplicate implementations, then
reported honestly that whole shapes went unexamined. The second is running
against those: HTTP route and wire names, realtime and CDC identifiers,
generated-name escaping, schema drift, permission strings, and i18n keys plus
product claims.

Near-zero yield from an area is far more likely a search gap than a clean bill of
health. Areas neither hunt has opened: the admin UI's own data path, the offline
sync layer, the website's build, and anything only reachable through a real
browser.
