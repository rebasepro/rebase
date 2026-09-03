# Unit 15 — backup and restore

Read-only audit, 2026-08-09. Nothing was executed: no `pg_dump`, no `pg_restore`,
no `psql`, no test suite, no cluster. Every claim is grounded in a file in this
repository and cited `path:line`. Claims that would need a running Postgres to
settle are marked **UNCONFIRMED-BY-EXECUTION**.

Scope: `packages/server/src/backup/`, `packages/server-postgres/src/backup/`,
`packages/client/src/backups.ts`, the Studio panel that consumes them, and the
barman/PITR code in `saas/backend` (read only). The disaster-recovery *runbook*
is unit 76 (moved to the private control-plane repo); its finding that production
tenants have no barman archives because `BACKUP_S3_*` is unset is not
re-reported here. This audit is about the backup **code**.

Lens: `docs/bug-classes.md` §5 (*remediation text nobody tested*) and §4 (*safety
nets that swallow their own failures*).

---

## Verdict

The pure logic of this subsystem is some of the best-reasoned code in the
repository. `--exit-on-error` is on by default with the security argument
attached; `--enable-row-security` is unreachable without the identity that makes
it safe; `validateDump` fails closed when it cannot verify; retention refuses to
touch a file whose name it does not recognise; the local download path blocks
traversal and its test was deliberately written to defeat its own vacuity. Those
are not accidents — each one has a paragraph above it explaining the failure it
exists to prevent.

None of it is exercised. **No test in this repository restores anything into any
database, and no test calls `createDump`, `restoreDump`, `validateDump`,
`uploadBackup`, `pruneBackups` or `createBackupCron` at all** — mocked or
otherwise. A grep for callers of those six functions across `packages/` returns
three files, all of them inside `src/backup/` itself. Everything green is a
parser, an argv builder or a retention predicate. The saas side at least has
mocked restores (`pitr-restore.test.ts`, `pitr-cutover.test.ts`), and unit 76
already says plainly what a mocked restore proves: nothing. The OSS restore does
not have even that.

Into that gap fall three defects that make a backup not mean what it says.

The scheduled backup — the one that runs unattended, the only one most
deployments will ever take — excludes the `rebase` schema by default, on the
strength of a comment calling it "the Atlas revision schema". It is the Atlas
revision schema *and* the home of API keys, record history, cron logs, channel
history, branches, idempotency keys, and the CDC trigger function every collection
table's trigger calls. The manual CLI backup excludes none of it, so the two
commands capture different databases. And because the triggers are dumped while
the function they call is not, that nightly dump most likely cannot be restored at
all on a default-configured deployment.

The Studio panel — the only in-product recovery path — can list and download the
`.dump` and is structurally incapable of listing or downloading the
`.globals.sql` sidecar beside it, because both the lister and the reader filter
on `.dump`. `docs/backups.md` spends nine lines explaining that without that
sidecar "row-level security would be silently lost". The CLI pairs the two files
everywhere. The HTTP surface pairs them nowhere.

And nothing anywhere backs up storage objects. A restored database is rows
pointing at files no part of this subsystem has ever copied, and the document
whose job is to say what a backup means never mentions it.

On the saas side the code quality is again high — `/backup-status` in particular
is a model of refusing to claim protection it cannot verify — but the entire
surface is wrong for the shared tier. Hobby and starter tenants have no CNPG
cluster in their namespace, so `/backup-status` tells them their database does
not exist and to "deploy the project to provision it" (which cannot change the
answer), `/pitr-status` 500s, and `/create` throws — while the nightly
per-project dumps they genuinely have are invisible to every route and restorable
by no code path in the repository.

Authorization: the OSS routes are correctly admin-gated and there is **no HTTP
restore route in OSS at all**. On saas, destructive operations are admin-gated —
but `/download`, which hands over the whole database, and `/pitr-restore`, which
provisions a billed recovery cluster, are gated on plain org membership.

---

## What a backup captures, and what it does not

Captured by `pg_dump -Fc` over one database (`buildPgDumpArgs`,
`packages/server-postgres/src/backup/pg-tools.ts:232-243` — no `--schema-only`,
no `--data-only`, no `--no-acl`): tables and data, sequences and their values,
indexes, constraints, views, functions, triggers, **RLS policies and `ENABLE ROW
LEVEL SECURITY`**, comments, `CREATE EXTENSION` statements, large objects, and
per-object `GRANT`s.

Captured by the sidecar (`buildPgDumpallGlobalsArgs`, `pg-tools.ts:342-353`):
cluster roles, role memberships, role-level grants, tablespaces.

Excluded:

| Excluded | Fail-closed? | Where |
|---|---|---|
| The whole `rebase` schema, on every **scheduled** backup | **No — silent** | `backup-cron.ts:118` (H1) |
| **Storage objects / uploaded files** | **No — silent, and undocumented** | nothing in `packages/` (H4) |
| Role passwords (`--no-role-passwords`) | Documented, not enforced | `pg-tools.ts:348`, `docs/backups.md:56-59` |
| Extensions not installed on the restore target | Fails loud (`--exit-on-error`) | `pg-tools.ts:315` |
| Rows RLS hides, under `--enable-row-security` | **Loudly warned**, flag unreachable without an identity | `pg-tools.ts:179-196`, `backup-cli.ts:141-149` |
| Other databases in the cluster | Inherent to a per-database dump | — |
| Server config, env vars, secrets held outside the database | Undocumented | — |

Two of those are silent, and both are findings below. The rest are either
enforced or written down, which is the standard this codebase sets elsewhere.

---

## Findings by severity

### HIGH

#### H1 — every scheduled backup silently omits API keys, record history, cron logs, channel history, branches, idempotency keys and the CDC trigger function

`packages/server-postgres/src/backup/backup-cron.ts:118`

```ts
const excludeSchemas = config.excludeSchemas ?? ["rebase"];
```

The option's docblock five lines up reads *"Schemas to exclude from the dump
(defaults to Atlas revision schema)"* (`backup-cron.ts:39`). Atlas revisions do
live there — `packages/server-postgres/src/cli.ts:828` passes
`--revisions-schema rebase`. But so does everything else the framework keeps out
of the user's collections:

| Object | Created at |
|---|---|
| `rebase.api_keys` — key hashes, permission lists, admin flag | `packages/server/src/auth/api-keys/api-key-store.ts:26,160-170` |
| `rebase.entity_history` — record history | `packages/server-postgres/src/history/ensure-history-table.ts:16-40` |
| `rebase.cron_logs`, `rebase.cron_claims` | `packages/server/src/cron/cron-store.ts:110-125` |
| `rebase.channel_messages`, `rebase.channel_presence`, `rebase.channel_cursors` | `packages/server-postgres/src/services/channel-history.ts:170`, `channel-presence.ts:52` |
| `rebase.branches` | `packages/server-postgres/src/services/BranchService.ts:117` |
| `rebase.idempotency_keys` | `packages/server/src/api/rest/idempotency.ts:197-212` |
| `rebase.rebase_cdc_notify()` — the CDC trigger function | `packages/server-postgres/src/services/cdc/trigger-cdc.ts:29,55-95` |

The manual path does **not** exclude it: `backupCommand` forwards only what the
user passed (`backup-cli.ts:161,177`). So `rebase db backup` and the nightly cron
capture different databases from the same server — bug class 2, one predicate
with two implementations, where the divergent one is the unattended one.

**Failure scenario, data loss:** an operator restores last night's backup after a
bad migration. Every API key in the system is gone, so every integration,
CI pipeline and server-to-server caller starts 401-ing. Record history is gone.
Nothing says so — the restore reports success and the tables the user declared
are all there.

**Failure scenario, restore refusal (UNCONFIRMED-BY-EXECUTION):** `REALTIME_CDC`
defaults to `auto` (`packages/server-postgres/src/PostgresBootstrapper.ts:487`),
so trigger CDC attaches `rebase_cdc_trigger … EXECUTE FUNCTION
rebase.rebase_cdc_notify()` to collection tables in `public`
(`trigger-cdc.ts:99-106`). `pg_dump` emits a table's triggers as part of the
table; `--exclude-schema=rebase` omits the function they call. On restore the
`CREATE TRIGGER` references a function that does not exist, and `restoreDump`
runs `--exit-on-error` by default (`pg-tools.ts:314-317`) — so the restore aborts
outright. I could not run `pg_dump` to confirm the trigger is emitted, but
nothing in `pg_dump`'s schema-exclusion logic consults a trigger function's
schema, and the two halves are provably on opposite sides of the filter.

There is a small, exact irony worth stating: `rebase.cron_logs` is where the
record of a failed backup is written (`cron-store.ts:228-236`), and it is in the
schema the backup excludes.

**Fix direction:** do not exclude a shared schema to exclude one table in it.
Exclude the Atlas revisions **table** (`--exclude-table=rebase.atlas_schema_revisions`),
or nothing at all — a revisions table in a backup is harmless. If the default
stays, it needs a boot-time or run-time warning naming what is being dropped, and
a test that dumps a database with a CDC trigger and restores it.

#### H2 — the Studio can download the dump but not the sidecar that makes it restorable

`packages/server/src/backup/backup-common.ts:60, 83, 114, 122`

`listBackupObjects` filters `.dump` in both the local and the object branch
(`:60`, `:83`); `readBackupBytes` refuses anything not ending in `.dump` in both
branches (`:114`, `:122`). The `.globals.sql` sidecar is therefore neither listed
by `GET /admin/backups` nor fetchable through `GET /admin/backups/download`.

Every other consumer treats the pair as a pair. The CLI uploads both
(`backup-cli.ts:189-192`), resolves both on restore (`:265-266`, `:273-274`), and
prunes both (`backup-logic.ts:50-62`). The cron uploads both
(`backup-cron.ts:170-173`). `docs/backups.md:50-59` explains at length that
without the sidecar "the `rebase_user` role (and the RLS `GRANT`s that reference
it) would be missing on restore and **row-level security would be silently
lost**", and `:118` says the restore fails without it. `backup-cli.ts:320-322`
prints that warning at the point of use.

**Failure scenario:** the operator's recovery path is the product's own Backups
panel (`packages/studio/src/components/Backups/BackupsView.tsx:167-177`). They
download the `.dump`, run `rebase db restore` on it, and hit the "No roles
sidecar" warning followed by an abort at the first `GRANT … TO rebase_user`. If
they reach for `--continue-on-error` to get past it — which is what the message
does not tell them not to do — the restore "succeeds" with RLS un-enforced.

This is bug class 17 along its second axis: the feature (pair the two artifacts)
was applied at three of the four call sites.

**Fix direction:** allow `.globals.sql` through both the lister and the reader,
and surface it in the panel as part of the row rather than as a separate entry —
one "Download backup" that yields both files, or a zip. The containment check in
`readBackupBytes` should key on a known-suffix set, not one literal.

#### H3 — the saas backup surface is broken and actively misleading for shared-tier tenants

Shared-tier projects (hobby, starter) carry `databaseType: "managed"` and have
**no CNPG cluster in their own namespace** — their database is a database on a
pool in `rebase-shared` (`saas/backend/src/k8s/orchestrator.ts:970-991`, and the
docblock at `:3181-3183` states it outright: "Shared-tier tenants (hobby,
starter) … have no CNPG cluster of their own").

Every route in `saas/backend/functions/backup.ts` addresses
`clusters/<liveCluster>` in `namespaceForProject(projectId)`:

* **`/backup-status/:projectId`** — the cluster read 404s, `clusterExists` goes
  false (`backup.ts:900-903`), and because `liveCluster === "postgres"` the
  reason is *"No managed database exists for this project yet. **Deploy the
  project to provision it.**"* (`:929-931`). Deploying provisions a database on
  a pool, not a cluster in that namespace, so the instruction cannot change the
  answer. That is bug class 5 in its purest form. The same payload also says
  *"Manual backups are still available"* (`:934`, `:941`), which is false — see
  below.
* **`/pitr-status/:projectId`** — has no `isNotFound` branch at all
  (`:1018-1020`). The 404 falls to the outer catch and returns **500 `Failed to
  read CNPG cluster status`** (`:1046`). Two routes, the same probe, two
  behaviours; the careful one is 200 lines above the careless one.
* **`/create` and `/restore`** — both call `resolveDbUrl`, which reads the CNPG
  `postgres-app` Secret in the tenant namespace and throws
  `Failed to resolve CNPG database credentials for cluster postgres in tenant
  namespace …` when it is absent (`:294-330`). Manual backup and manual restore
  are 500s for the whole tier.

**Failure scenario:** a hobby customer opens the Backups tab. They are told their
database does not exist and to deploy. They deploy. Nothing changes. They click
"Create backup" and get a 500 naming a Kubernetes Secret. Their actual backups —
nightly per-project dumps under `s3://<bucket>/shared/<poolId>/<db>/` plus the
pool's barman archive — exist and are mentioned nowhere.

**Fix direction:** the tier is knowable from `topologyOf(...)`
(`orchestrator.ts:968`), which these routes never consult. `databaseTypeOf`
(`backup.ts:711-714`) collapses everything non-BYODB to `"managed"`; it needs a
third arm. Each route needs a shared branch: `/backup-status` should report the
pool's ScheduledBackup and the nightly dump CronJob, `/pitr-status` should say
PITR is pool-wide, `/create` should dump through the pool's connection.

#### H4 — nothing backs up storage objects, and no document says so

There is no code anywhere in `packages/` that copies uploaded files as part of a
backup. `docs/backups.md` mentions storage nine times and every one of them is
about where the *dump* is written (`:5, 19, 66, 164, 169, 177, 205, 219, 220`);
the word "uploads" does not appear, and neither does any statement of scope.

**Failure scenario:** an operator restores after losing the database volume, and
gets a complete, correct, RLS-intact database whose every file reference points
at objects that were never copied. Locally the exposure is sharpest: the scaffold
gitignores `uploads/` (`packages/cli/templates/template/gitignore`), so on a
self-hosted single-box deployment the upload directory is excluded from version
control *and* from backups, which is every copy the operator has.

**Fix direction:** the honest minimum is a scope statement at the top of
`docs/backups.md` — "this backs up the database, not your storage bucket; back
that up separately, here is how" — and the same sentence in the `rebase db
backup` success output. The generous version is a `--include-storage` that walks
the configured `StorageController`, which is already the abstraction both the CLI
and the cron hold.

### MEDIUM

#### M1 — `rebase db backup` with no `--out` writes the whole database into a directory the scaffold does not gitignore

`packages/server-postgres/src/backup/backup-cli.ts:117` defaults `--out` to
`path.join(process.cwd(), "backups")`, and `docs/backups.md:17` makes
`--out ./backups` the very first example.

`packages/cli/templates/template/gitignore` ignores `.env`, `uploads/`, `dist/`,
`dist-bundle/`, `.rebase/` — and **not** `backups/`. The dump contains the users
table with `passwordHash`, `rebase.api_keys` hashes, refresh tokens, sessions and
every secret column. `.env`, which holds strictly less, is ignored.

**Failure scenario:** a developer follows the quick start, then `git add -A &&
git push`. The full production-shaped database is now in the repository history,
and on a public repo it is on the internet.

**Fix direction:** add `backups/` and `*.dump` / `*.globals.sql` to the template
gitignore. Cheap, and it closes the whole class.

#### M2 — on saas, any org **member** can download the entire tenant database

`saas/backend/functions/backup.ts:139` (`/list`) and `:196` (`/download`) gate on
`verifyProjectOwner`, which despite the name means *any member of the
organization* (`saas/backend/src/utils/auth.ts:169-179`). The default role for a
new member is `member` (`saas/config/collections/organization-members.ts:33-38`),
and only `owner`/`admin` satisfy `verifyProjectAdmin`
(`auth.ts:77,121-135`).

The file's own posture is that destructive operations need admin — `/restore`
(`:573`), `/pitr-restore-cutover` (`:1901`) and `/pitr-restore-discard`
(`:2042`) all use `verifyProjectAdmin`. But `/download` returns a signed URL to a
plain-SQL dump of everything a restore would write: the users table, password
hashes, API-key hashes, every ciphertext column. A member who is trusted with
none of the destructive verbs can walk off with the entire database.

The OSS equivalent is admin-only (`packages/server/src/init.ts:1803` applies the
shared admin gate), so the two products answer the same question differently.

**Fix direction:** `verifyProjectAdmin` on `/download`, and probably on `/list`
too. If members genuinely need to see that backups exist, `/list` can stay at
member and `/download` move to admin — that is the split the rest of the file
already draws.

#### M3 — `/pitr-restore` provisions a billed recovery cluster at member level; discarding it needs admin

`saas/backend/functions/backup.ts:1677` gates `/pitr-restore` on
`verifyProjectOwner`; `/pitr-restore-discard` at `:2042` gates on
`verifyProjectAdmin`. The route creates a full CNPG `Cluster` bootstrapped from
the barman archive, with its own PVC — the file itself notes at `:1252-1256`
that "a staged restore bills 10Gi forever" without the reap step.

So the least-privileged member can create a resource they are not permitted to
delete. The fixed `postgres-restored` name bounds it to one per tenant
(`:1240-1256`, and that reasoning is good), so this is a cost and
operational-deadlock finding rather than a runaway one — but the split is
backwards: create at member, delete at admin.

**Fix direction:** `verifyProjectAdmin` on `/pitr-restore`. Staging a recovery is
not a read.

#### M4 — the object-storage read path has no prefix containment; the local one does

`packages/server/src/backup/backup-common.ts:108-119` resolves the requested key
and refuses anything outside the backup directory. The object branch at
`:121-125` checks only `key.endsWith(".dump")` and then calls
`storage.getObject(key, dest.bucket)` — `dest.prefix` is never consulted.

So `GET /admin/backups/download?key=anything/at/all.dump` reads any `.dump`
object anywhere in the configured bucket, including prefixes holding user
uploads. Admin-gated, so not a privilege escalation; the finding is that one
branch implements a containment rule the other does not, and
`backup-common.test.ts:66-79` — a carefully written test — covers only the branch
that has it. That is the shape a real bypass hides in.

**Fix direction:** require the key to start with `dest.prefix ? dest.prefix + "/"
: ""` before the `getObject`, and add the negative test to the object branch.

#### M5 — a corrupt local dump is left on disk and counts as a backup

`packages/server-postgres/src/backup/backup-cron.ts:151-160`. On a validation
failure the temp files are deleted **only** when
`destination.kind !== "local"` (`:153`, `:156`). For a local destination the dump
was written straight into `destination.path` (`:139`) with a well-formed
`rebase-<db>-<ts>.dump` name, and it stays there.

The next run's `listBackups` (`backup-service.ts:396-404`) sees it as the newest
backup; `keepMinimum` protects it (`retention.ts:69`); the Studio panel renders
it identically to a good one. The comment two lines above — "a corrupt-but-exit-0
dump must never be the reason the last good backup gets deleted" — is honoured
for pruning and not for the artifact, so the corrupt file goes on to *become* one
of the protected minimum.

**Fix direction:** unlink the failed dump and its sidecar unconditionally, or
rename it to a suffix the lister and the pruner both ignore
(`.dump.invalid`) so the evidence survives without being counted.

#### M6 — the shared-pool prune runs on a failed night, and has no keep-minimum

`saas/backend/src/db/shared-pool-backup.ts:64-98`. The per-database loop records
`FAILED=1` and continues (`:84-87`); the prune block runs unconditionally
(`:92-95`); `exit 1` comes afterwards (`:97`).

The comment at `:90-91` states the invariant precisely — *"Prune after dumping,
never before: a prune that runs first and a dump that then fails leaves a tenant
with less coverage than they started"* — and implements only the ordering half.
A tenant whose dump has failed for 30 consecutive nights has its last good dump
deleted on night 31, by a job that then dutifully exits 1 as it has every night.
There is no `keepMinimum` equivalent; the OSS retention has one for exactly this
reason (`packages/server-postgres/src/backup/retention.ts:21-25, 69`).

Secondarily, the prune selects by `aws s3 ls --recursive` date column and deletes
`$4` with no filename-pattern check (`:93-95`), so any object under
`shared/<poolId>/` is fair game. `selectBackupsToPrune` explicitly refuses to
touch what it cannot recognise (`retention.ts:56-61`).

**Fix direction:** skip the prune for any database whose dump failed this run
(track per-DB, not one global flag), and keep the N newest per database
regardless of age.

#### M7 — a backup failure is recorded and never announced

The cron handler throws on validation failure (`backup-cron.ts:159`) and on any
`pg_dump` error. The scheduler catches it, sets `job.lastError` and
`totalFailures` (`packages/server/src/cron/cron-scheduler.ts:763-766`), and the
store writes a `success = false` row with the message
(`packages/server/src/cron/cron-store.ts:228-236`). That is genuinely more than
"logged and forgotten" — the failure is durable and queryable.

But nothing announces it. There is no email, no webhook, no boot-time staleness
check, no alert anywhere in the backup code. And the surface the docs point
operators at — the Studio Backups panel — shows only a file list
(`BackupsView.tsx:154-180`): no last-run status, no age warning, no failure
indicator. Sixty nights of failures render as a healthy list of sixty-day-old
files.

**Fix direction:** the panel already fetches from an admin route; have
`GET /admin/backups` also return the last run's outcome and timestamp from the
cron store, and render a banner when the newest backup is older than roughly two
schedule intervals. That is the one place the operator is already looking.

#### M8 — the whole dump is buffered in memory on every path

`readBackupBytes` reads the file whole (`backup-common.ts:118`) or materialises
the object's `arrayBuffer()` (`:125`), and the route returns it as one body
(`backup-routes.ts:53`). `uploadBackup` reads the file whole into a `File`
(`backup-service.ts:373-374`). The client calls `res.blob()`
(`packages/client/src/backups.ts:36`). No streaming, no size cap.

The saas side reasoned this exact problem through and capped at 64 MB, with the
reasoning written out — *"the kernel OOM-kills the replica before it can ever
fire, turning one customer's oversized backup into a console outage for
everyone"* (`saas/backend/functions/backup.ts:426-446`). The OSS side has neither
the cap nor the note.

**Failure scenario:** an admin clicks Download on a 2 GB backup. The API process
allocates 2 GB (peaking higher across the copy into the response body) and is
OOM-killed, taking every other request with it.

**Fix direction:** stream. `c.body()` accepts a `ReadableStream`, and
`fs.createReadStream` covers the local case. Failing that, port the saas cap and
its error message.

### LOW

#### L1 — `pg_dumpall` is required but not pre-flighted, and its override is undocumented

`preflight()` covers `pg_dump` and `pg_restore` only (`backup-service.ts:92-111`).
`createDump` throws for a missing `pg_dumpall` at `:207-215` — **after** the dump
has already been written and sized at `:203`. On a local destination the finished,
valid `.dump` is left on disk while the command reports failure and exits 1
(`backup-cli.ts:200-203`): a good backup presented as a failed one, and an
unpaired artifact the next retention run will count.

`PG_DUMPALL_PATH` is absent from `packages/cli/templates/template/.env.example`,
which lists `PG_DUMP_PATH` and `PG_RESTORE_PATH` at `:161-162`. It appears only
in the thrown hint and in `docs/backups.md:57`.

#### L2 — `--create-db` creates the database before the confirmation prompt

`backup-cli.ts:287-294` runs `ensureDatabaseExists` before the `--yes` gate at
`:298-307`. Answering "no" leaves an empty database behind, after the help text
promised the command "never runs automatically" and "requires an interactive
'yes'" (`:463-464`).

#### L3 — `Content-Disposition` is interpolated from a query-supplied name

`backup-routes.ts:52` builds `attachment; filename="${result.name}"`. For the
object branch `result.name` is `key.split("/").pop()` with no character
allow-list (`backup-common.ts:125`), so a `"` in the key escapes the quoted
filename. Node rejects CR/LF, so the ceiling is filename spoofing, and the route
is admin-only. Worth noting mostly because the saas side has exactly the
allow-list this lacks (`invalidBackupFilenameReason`, `backup.ts:46-68`).

#### L4 — the PITR lifecycle comment says cutover is not implemented; it is

`saas/backend/functions/backup.ts:1064-1067`:

> 3. CUTOVER — repoint the tenant's Deployment at the recovered cluster.
>    NOT IMPLEMENTED: it requires an orchestrator change

`/pitr-restore-cutover` is 830 lines below in the same file (`:1895`) and does
exactly that: it gates on CNPG reporting `ready`, persists `liveClusterName`
first, then calls `repointDeploymentDatabase` (`:1971`) and reports a partial
state rather than success if the patch does not land. An operator reading the
lifecycle header during an incident concludes the recovery cannot be completed
and improvises. Class 5 with the failure inside a comment rather than an error.

#### L5 — object-storage backups always render with an unknown size

`listBackupObjects` sets `sizeBytes` for local entries (`backup-common.ts:67`)
and not for object entries (`:86-91`), so every s3/gcs backup shows `—` in the
panel (`BackupsView.tsx:20, 164`). The saas side pays one metadata call per
object precisely so an unknown size is never rendered as a plausible number, and
records the incident that taught them (`backup.ts:90-101`).

#### L6 — `splitGlobalsStatements` splits on a bare `;`

`pg-tools.ts:373-382` drops `--` lines and splits on `;` with no string- or
dollar-quote awareness. `--no-role-passwords` removes the likeliest offender, but
an `ALTER ROLE x SET search_path = 'a;b'` is split mid-literal; `applyGlobalsWith`
then swallows both halves as "skipped" (`backup-logic.ts:33-37`) and the restore
proceeds with that role misconfigured. It only becomes loud if the dump happens
to `GRANT` to it.

#### L7 — `type: "automated"` is a saas backup classification nothing writes

`backupInfo` derives the type from the filename
(`saas/backend/functions/backup.ts:111`) and `/create` accepts
`type: "automated"` (`:512`), but no cron in `saas/backend/crons/`
(rollout-controller, shared-pool-guard, telemetry-retention,
tenant-isolation-guard, usage-rollup) ever calls it, and nothing else does
either. Automated tenant backups are CNPG barman, a different mechanism
entirely. A field with no writer, displayed to customers — class 14.

---

## Checked and clean

* **`--exit-on-error` is the restore default**, with the security argument in the
  docblock (`pg-tools.ts:296-317`), and it is pinned by a test that also pins the
  opt-out (`packages/server-postgres/test/backup.test.ts:170-183`).
* **`--enable-row-security` cannot travel without an identity.** The flag and the
  `PGOPTIONS` that satisfy `admin_full_access` come from the same optional object
  (`backup-service.ts:181-185`, `pg-tools.ts:236-238`), so the dangerous bare
  form is unreachable by construction rather than by a check someone remembers.
  The RLS refusal is diagnosed rather than passed through
  (`diagnoseRowSecurityDumpFailure`, `:257-288`), and the diagnosis names both
  ways out and says which one is safer. Covered by
  `backup-row-security.test.ts`.
* **`validateDump` fails closed when it cannot verify.** A missing `pg_restore`
  returns `{ok: false}` with an explicit "treat as inconclusive-but-fail" comment
  (`backup-service.ts:245-250`) rather than the class-4 shape of skipping the
  check and reporting success.
* **Validation runs before pruning**, in both the cron (`backup-cron.ts:148-160`)
  and the CLI (`backup-cli.ts:166, 183, 389-397`), so a corrupt dump cannot be
  the reason a good one is deleted. (What happens to the corrupt file afterwards
  is M5.)
* **Retention refuses what it does not recognise.** An object with no parseable
  timestamp and no `createdAt` is never selected (`retention.ts:56-61`), and
  `keepMinimum` is applied before the age filter (`:68-70`). Five tests including
  the two that matter — "never prunes objects without a recoverable timestamp"
  and "keeps at least keepMinimum recent backups regardless of age"
  (`backup.test.ts:268-296`).
* **Local path traversal on `/download` is blocked, by a test written to defeat
  its own vacuity.** `backup-common.test.ts:31-44` nests the backup directory one
  level down so the escape target is a real file, and asserts `existsSync` on it
  before asserting the refusal (`:76-78`) — the comment records that the earlier
  version passed with the guard deleted.
* **The destructive CLI path fails closed in CI.** `promptConfirm` returns
  `false` on a non-TTY (`backup-cli.ts:84`), so a piped or scripted `rebase db
  restore` without `--yes` aborts.
* **The admin gate on `/admin/backups` is the shared one and is deliberately not
  tied to `requireAuth`**, with a long comment explaining that reusing the
  data-plane flag "meant taking that advice silently unmounted the gate on … the
  backup routes" (`packages/server/src/init.ts:1107-1128`). With no auth
  configured the routes stay mounted and answer 501 with an explanation rather
  than 404 or open (`:1146-1153`). Covered by
  `packages/server/test/admin-surfaces-gate.test.ts`.
* **There is no HTTP restore route in OSS.** Restore is CLI-only; the client
  surface exposes `list` and `download` and nothing else
  (`packages/client/src/backups.ts:39`). The single worst thing this audit was
  asked to look for is absent by construction.
* **saas filename validation is an allow-list, with the object-key reasoning
  spelled out** — "an object key is just a string … no storage backend will stop
  us" (`backup.ts:46-68`).
* **saas restore is correctly hardened.** `-v ON_ERROR_STOP=1
  --single-transaction` (`backup.ts:382-410`), the verdict is exit code **plus**
  an `ERROR|FATAL|PANIC` stderr scan (`:414-421`, `:669-675`), a spawn error is
  distinguished from a non-zero exit (`:666-668`), and EPIPE on stdin is handled
  because `ON_ERROR_STOP` makes psql exit while we are still writing (`:657-659`).
* **saas `/create` refuses an empty dump and an oversized one** rather than
  storing either, with "an empty dump is never legitimate — pg_dump always emits
  a header" written out (`backup.ts:531-547`).
* **`backupInfo` reports an unsized backup as `"unknown"`**, never `0.00 MB`,
  with the signing-permission incident that motivated it recorded (`:90-113`).
* **`/backup-status` is the best code in this unit.** Every precondition must
  hold for `enabled`; `scheduleTargetsLiveCluster === null` (could not tell) never
  reads as protected; `=== true` is used rather than truthiness on purpose; a
  post-cutover schedule pointed at the abandoned cluster forces `enabled` false;
  and a non-404 Kubernetes error surfaces as an error rather than as "backups
  off" (`backup.ts:864-902, 911-955`). For dedicated-tier tenants it is accurate.
* **`buildSharedPoolBackupCronJob` fails closed and loud** — `null` when the
  cluster has no backup store, with the reasoning that "a tenant who believes
  they have backups is worse off than one who knows they have none"
  (`shared-pool-backup.ts:101-111`) and a warning at the call site
  (`orchestrator.ts:2900-2905`). `set -euo pipefail` is present with the pipefail
  argument written out (`:56-67`).
* **The dump job's CronJob shape is sound**: `concurrencyPolicy: Forbid`,
  `failedJobsHistoryLimit` kept higher than the success limit on purpose,
  `startingDeadlineSeconds` bounded, `automountServiceAccountToken: false`, and
  an operand image pinned to the pool's major version
  (`shared-pool-backup.ts:120-149`).

---

## On testing, stated plainly

**No test restores into a fresh database.** No test restores into any database.

`grep -rln "createDump\|restoreDump\|validateDump\|uploadBackup\|pruneBackups\|createBackupCron" packages`
returns three files: `backup-service.ts`, `backup-cron.ts`, `backup-cli.ts`. All
three are the implementation. The impure edge — every `execa` spawn, every `pg`
connection, the whole of `backup-service.ts` — has **zero** coverage, mocked or
real. `validateDump`, the function the docs sell as the thing that stops a
corrupt dump from being trusted, has no test at all.

What is tested:

| File | Lines | What it covers |
|---|---|---|
| `packages/server-postgres/test/backup.test.ts` | 339 | argv builders, version parsing, filename round-trip, destination parsing, retention selection, env parsing |
| `packages/server-postgres/test/backup-logic.test.ts` | 87 | `applyGlobalsWith` / `pruneWith` against injected fakes |
| `packages/server-postgres/test/backup-row-security.test.ts` | 85 | the RLS flag/identity pairing and the diagnosis text |
| `packages/server/src/backup/backup-common.test.ts` | 85 | parsers, local listing, local read, local traversal refusal |

These are good tests of what they test. They cannot catch H1, H2, H4, M4, M5 or
M8, because every one of those lives past the last line any of them reaches.

On the saas side, unit 76 already established that `pitr-restore.test.ts`,
`pitr-cutover.test.ts` and `backup.test.ts` stub the Kubernetes API and
`child_process.spawn`, and that `barman-store.test.ts` is a pure path-builder
test. **A mocked restore proves nothing about a restore.** I confirm that, and
add that the OSS side does not have even the mocks.

The cheapest real gate: a vitest e2e (the runner that already owns
`server-postgres/test/e2e/**`) that boots a database with a CDC-triggered
collection, runs `createDump` with the cron's default `excludeSchemas`, then
`restoreDump` into a fresh database and asserts the row counts, the policy
catalogue and one write. H1 would have failed it on the first run.

---

## Artifacts: where they live, encryption, contents

**OSS.** Wherever `BACKUP_DESTINATION` points; default `./backups` in the working
directory (`backup-cli.ts:117`). **No code in this subsystem encrypts anything.**
`uploadBackup` sets `application/octet-stream` and a `rebase-backup: 1` metadata
tag (`backup-service.ts:374-380`) — no SSE header, no KMS key, no client-side
encryption. `docs/backups.md:212-221` correctly tells the operator to enable
encryption-at-rest on the destination and keep the bucket private, and that
advice is the entirety of the protection.

Contents: the users table including `passwordHash`, refresh tokens, sessions,
every user-declared secret column, and `rebase.api_keys` key hashes and
permission lists — the last only when the schema is not excluded, which on the
scheduled path it is (H1).

**saas.** `backups/<projectId>/<name>.sql` inside `<project>-rebase-storage`
(`backup.ts:35-44`) — the **same bucket** as Kaniko build contexts and
control-plane uploads (`saas/infra/saas-gcp/saas-storage.tf:11-30`).
`uniform_bucket_level_access` and `public_access_prevention = "enforced"` are set,
which is right. Encryption is Google-managed default only: no CMEK, no bucket
versioning, no retention lock. Tenant barman archives are elsewhere
(`s3://<bucket>/tenants/<ns>/`, `orchestrator.ts:2400`), shared-pool dumps at
`shared/<poolId>/<db>/` (`shared-pool-backup.ts:82`).

## Retention and growth

**OSS.** Opt-in and off by default: `retentionDays` unset means the prune block
never runs (`backup-cron.ts:187`). `BACKUP_KEEP_MINIMUM` is the floor against
wiping everything after an outage. The selection logic is correct and tested.
Growth is unbounded when unset, which is the documented default
(`docs/backups.md:192`).

**saas manual backups grow forever.** There is no delete route, no prune, no
retention setting, and the bucket's only lifecycle rule is scoped to
`build-contexts/` (`saas-storage.tf:21-28`). Every `.sql` a customer ever creates
stays, at up to 64 MB each (`backup.ts:446`). Whether that is reachable as abuse
depends on the global rate limiter (`saas/backend/src/index.ts:22,124`), which I
did not trace — see open questions.

**saas shared-pool dumps** prune at 30 days (`shared-pool-backup.ts:42, 92-95`),
subject to M6.

---

## Open questions

These cannot be settled by reading files, and none was executed.

1. **Does `pg_dump --exclude-schema=rebase` emit the CDC trigger?** H1's
   restore-abort scenario turns on it. Nothing in the exclusion logic consults a
   trigger function's schema, and the trigger belongs to a `public` table — but
   the only way to know is to dump a CDC-enabled database and read the TOC.
   `pg_restore --list` on such a dump answers it in one command.
2. **Has any scheduled backup in any deployment ever been restored?** No test
   does it, no doc records it, and `createBackupCron` has no caller anywhere in
   the repository — the scaffold ships no `crons/` directory, so every user of
   the feature hand-writes the file from `docs/backups.md:166-183`. It is
   possible nobody has ever run it.
3. **Is the global rate limiter applied to `/api/functions/backup/create`?**
   Determines whether M-tier "no retention" is a storage-growth annoyance or an
   abuse vector. Answerable by reading the middleware ordering in
   `saas/backend/src/index.ts` against `hono-middleware-ordering`.
4. **Do shared-tier tenants appear in the console's Backups tab at all**, or does
   the frontend hide it for them? H3's severity depends on whether a hobby
   customer actually sees "No managed database exists for this project yet".
   `saas/frontend/src/views/ProjectDetails.tsx` would say.
5. **Does the platform storage bucket hold tenant application uploads**, or only
   control-plane uploads and build contexts? If tenant apps write there, the
   blast radius of any key-confusion bug includes other tenants' database dumps.
   `saas-storage.tf:1-9` implies control-plane-only; not verified.
6. **What does `pg_restore` do with a dump whose extensions are absent on the
   target?** `--exit-on-error` should make it loud, which is the right behaviour,
   but Rebase's search path installs `pg_trgm` and `unaccent` and the vector
   features install `vector` — so a restore onto a stock Postgres image fails at
   `CREATE EXTENSION`, and nothing in `docs/backups.md` prepares the operator for
   that message.
