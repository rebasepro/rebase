# Unit 76 — the disaster-recovery runbook versus reality

Read-only audit, 2026-08-08. Nothing was executed: no `kubectl`, no `gcloud`, no
`psql`, no cluster or database was contacted. Every claim below is grounded in a
file in this repository, cited `path:line`. External state — Namecheap records,
the live GCP project, what is actually running in `rebase-saas-gke` — is by
definition unverifiable this way and is marked as such.

Lens: `docs/bug-classes.md` §5, *remediation text nobody tested*. "An error that
tells the user what to do is a code path, and it is one that no test in this repo
asserts." A runbook is the same code path with a longer feedback loop.

---

## Verdict

`saas/DISASTER-RECOVERY.md` is unusually good for its genre. It targets the right
control plane throughout — GKE `rebase-saas-gke`, namespace `rebase-saas`,
StatefulSet `saas-postgres`, in-cluster Postgres, not a single Docker-era or
Cloud-Run-era instruction survives in it. Its resource names, bucket paths,
filename format, retention, PITR route names and the three custom-domain locks
all check out against the manifests and the code. It is honest about the thing
most runbooks lie about: it says in §2 that neither restore path has ever run
against real infrastructure, and it says why that matters.

The problem is that it was written on 2026-07-22 at 16:36 and the infrastructure
kept moving. Three of its seven sections now describe a system that no longer
exists, and the document has been edited twice since (07-29, 07-30) without
either being touched. Worse, two of its steps are actively dangerous *because*
they are stale: **§7 step 3 instructs you to run `scripts/phase0-gke-config.sh`,
which whole-file-applies `saas-control-plane.yaml` — an apply that
`DEPLOYMENT.md:74-90` explicitly forbids on a live cluster, that the manifest's
own NetworkPolicy comment forbids in capital letters
(`saas-control-plane.yaml:342`), and that would re-attach `rebase-saas-cert-v2`,
a certificate `saas-managed-cert.yaml:29` records as permanently dead.** That is
the 2026-08-07 `api.rebase.pro` outage, re-run from the recovery runbook.

And the runbook's single most load-bearing assumption is false. §1 states
"Tenant databases are independent of all of this. They are CNPG clusters with
their own barman archives and survive a control-plane loss untouched." Production
resolves tenants through the ambient in-cluster rung (`resolve.ts:258-264`),
which takes its backup store from `BACKUP_S3_*` alone — and
`saas-control-plane.yaml` sets none of those variables. Every tenant provisioned
that way gets no barman block, no ScheduledBackup, and no archive. The two live
tenants have archives only because they were patched by hand in July. The code
warns about this at `orchestrator.ts:978-983`; the runbook asserts the opposite.

No RTO is stated anywhere, for either tier. The stated RPOs (one day control
plane, ~5 min tenants) are consistent with the configured nightly CronJob, but
the tenant figure rests on a CNPG default nothing in this repo pins.

---

## Step table

One row per instruction in the runbook. "Exists" = the named command, script,
route or file is present in the repo. "Matches infra" = the identifiers it uses
agree with the manifests that create them.

| # | Step (§, what it says) | Exists? | Matches current infra? | Verdict |
|---|---|---|---|---|
| 1 | §1 recovery order: DB → infra → DNS → tenants | n/a (prose) | Ordering is sound; `clusters` credentials really are the reachability root (`backup-store.ts:91-101`) | **OK** |
| 2 | §1 "Tenant databases … have their own barman archives and survive untouched" | n/a | **No.** Ambient rung ⇒ `resolveBackupStore()` with no cluster (`resolve.ts:259`); `BACKUP_S3_*` unset in `saas-control-plane.yaml` ⇒ no barman block at all | **WRONG** |
| 3 | §2 backups are a nightly dump by CronJob `saas-postgres-backup` in `infra/gcp/saas-control-plane-backup.yaml` | Yes (`saas-control-plane-backup.yaml:22`) | Yes | **OK** |
| 4 | §2 path `gs://rebase-578f2-db-backups/control-plane/rebase_saas-<UTC ts>.sql.gz` | Yes | Exact match (`…backup.yaml:105-106,117`) | **OK** |
| 5 | §2 "kept 30 days" | Yes | `db-backups-lifecycle.json:7-8` — age 30, prefix `control-plane/` | **OK** |
| 6 | §2 "RPO is one day" | n/a | Schedule `30 1 * * *` (`…backup.yaml:27`) supports it | **OK** |
| 7 | §2 "~5-minute RPO for tenants" | n/a | Nothing in the repo sets `archive_timeout`; rests on a CNPG default | **UNVERIFIABLE** |
| 8 | §2 `gcloud storage ls -l gs://rebase-578f2-db-backups/control-plane/` | Yes | Bucket + prefix correct | **OK** |
| 9 | §2 "Restore into the running StatefulSet (**destructive — it replaces the live database**)" heading | — | The command under it creates `rebase_saas_restore`; it is *not* destructive. The genuinely destructive step (§2 cut-over) carries no warning and no commands | **WRONG** |
| 10 | §2 `kubectl -n rebase-saas exec -i saas-postgres-0 -- psql …` (create scratch DB) | Yes | Pod name derives from StatefulSet `saas-postgres` (`saas-control-plane.yaml:16`), ns `rebase-saas` ✓. No `--context` guard | **OK (unguarded)** |
| 11 | §2 `gcloud storage cat … \| gunzip \| kubectl exec -i … psql -d rebase_saas_restore` | Yes | Runs without `-v ON_ERROR_STOP=1` / `--single-transaction`. `upgrade-postgres-18.sh:191` — same repo — uses `--single-transaction` | **STALE / unsafe** |
| 12 | §2 sanity `select count(*) from clusters` / `projects` | Yes | Both tables exist (`0000_orange_johnny_storm.sql:24,118`) | **OK** |
| 13 | §2 "Cut over by scaling the control plane to zero, renaming the databases, and scaling back up" | **No commands given** | The one irreversible step in the section | **UNVERIFIABLE** |
| 14 | §2 drill: restore last night's dump into `rebase_saas_restore`, run counts | Yes | Non-destructive as claimed | **OK** |
| 15 | §2 drill: `POST /pitr-restore` w/ `acknowledgeNoCutover: true`, `/pitr-restore-status`, `/pitr-restore-discard` | Yes (`functions/backup.ts:1668,1804,2036`; flag at `:1688`) | Route names exact. **No path prefix given** (real path `/api/functions/backup/…`) and no `Origin:` header — CSRF is on in prod (`index.ts:377`), so a bare curl gets `Forbidden` | **STALE (incomplete)** |
| 16 | §2 "`backend/functions/backup.ts` … is unit-tested, and it has never run against real infrastructure" | Yes | Confirmed: `pitr-restore.test.ts`, `pitr-cutover.test.ts`, `backup.test.ts` all stub the k8s API and `child_process.spawn`; `barman-store.test.ts` is pure. **A mocked restore is not an exercised restore** | **OK (honest)** |
| 17 | §3 `rebase-saas-secrets` holds 6 named keys | Yes | Manifest also consumes `gemini-api-key` (`saas-control-plane.yaml:157`) — missing from the list | **STALE (minor)** |
| 18 | §3 `encryption-key` unrecoverable; `afterRead` swallows decrypt failures | Yes | `encryption-hooks.ts:82-86` — swallowed at `logger.debug`, quieter than the doc says | **OK** |
| 19 | §3 authoritative copy in Secret Manager, injected by `phase0-gke-config.sh` | Yes (`phase0-gke-config.sh:16-18`) | Correct. "Verify that copy exists" has no command | **OK** |
| 20 | §3 `jwt-secret` rotation invalidates tenant DB creds derived by HMAC (`utils/tenant-db.ts`) | Yes | `tenant-db.ts:27-31` — `createHmac("sha256", JWT_SECRET)` | **OK** |
| 21 | §4 `terraform apply` in `infra/gcp` + `infra/saas-gcp` rebuilds VPC/subnet/router/NAT/GKE/AR/Cloud SQL/bucket/encryption-key secret | Yes | Every one present (`gcp-vpc.tf`, `gcp-gke.tf`, `gcp-registry.tf`, `tenant-db.tf`, `saas-storage.tf:11`, `saas-secrets.tf:24`) | **OK** |
| 22 | §4 registering the cluster makes `baseline.ts` install ingress-nginx, cert-manager, CNPG, ClusterIssuers | Yes | `baseline.ts:47-62,207-219,274-275` | **OK** |
| 23 | §4 hand-built inventory (IPs, pre-shared cert, backup bucket + SA `rebase-saas-backups` + HMAC, DNS, secret templates) | Yes | All absent from `.tf` as claimed. `rebase-saas-backups` appears nowhere in the repo, consistent with "created by hand" | **OK** |
| 24 | §4 "Terraform state is local only … `infra/.gitignore` excludes `*.tfstate`" | Yes | `infra/.gitignore:2-3`; `git ls-files` shows no tfstate tracked; no `backend` block in either `provider.tf`. **`STAGING-ENVIRONMENT.md:106,121` says the opposite** | **OK (companion doc wrong)** |
| 25 | §4 "templates only in `infra/gcp/saas-secrets.yaml`" | Yes | Template carries 4 of 7 keys; **`build-gcp-key` is a required `secretKeyRef` (`saas-control-plane.yaml:256-260`) with no template, no script and no Terraform anywhere** | **WRONG** |
| 26 | §4 TLS trap: two certs, `rebase-saas-cert` CRD owns the failed one, `mcrt-ab797b1c` is orphaned | Partially | There are now **three**. `rebase-saas-cert-v2` (FailedNotVisible) and `-v3` (live) both post-date the doc (`saas-managed-cert.yaml:28-29,44`) | **STALE** |
| 27 | §4 "Deleting the `rebase-saas-cert` CRD to tidy up is harmless" | — | `saas-managed-cert.yaml:24-26` deliberately keeps superseded certs and warns that deleting a certificate is what caused the outage | **STALE (contradicted)** |
| 28 | §5 DNS table incl. `*.apps.rebase.pro` "**stale — should be deleted**" | — | `infra/README.md:204-208`, edited in the *same commit* (51b6504), says the wildcard "is gone" | **STALE (self-contradictory)** |
| 29 | §5 three locks stop any customer being served on `apps.rebase.pro` | Yes | `domains.ts:33-36` (`servableCustomDomain`), `project-hooks.ts:133,151,186`, `tenant-domain.ts:123` | **OK** |
| 30 | §5 `SELECT subdomain, custom_domain FROM projects WHERE custom_domain IS NOT NULL` | Yes | Column exists (`0000_orange_johnny_storm.sql:122`) | **OK** |
| 31 | §5 step 1 `gcloud compute addresses create rebase-ingress-nginx-ip …` | Yes | Already done — `saas-control-plane.yaml:216-220` names the reservation. Re-running errors `ALREADY_EXISTS` | **STALE (reads as pending)** |
| 32 | §5 `gcloud compute addresses describe … --format='value(status)'` | Yes | Valid | **OK** |
| 33 | §5 step 2 set `INGRESS_LOAD_BALANCER_IP=34.62.144.171`; `baseline.ts` writes `spec.loadBalancerIP` | Yes | Already set (`saas-control-plane.yaml:221-222`); `pinIngressAddress` at `baseline.ts:123-135` | **STALE (reads as pending)** |
| 34 | §5 "`baseline.ts` applies create-only: an existing Service is left untouched" | Yes | `baseline.ts:152-168` — 409 ⇒ `existing++; continue` | **OK** |
| 35 | §5 `kubectl -n ingress-nginx patch svc ingress-nginx-controller … loadBalancerIP` | Yes | Correct object; **no context guard, and this is the step that can rebuild an LB** | **OK (unguarded)** |
| 36 | §6 premise: "`provisionPostgresCnpgCluster` … does not reconcile its spec … **no redeploy will add one**" | — | False since 79e4faa (2026-07-22, *after* the doc). `reconcileClusterBackupSpec` runs on the 409 path (`orchestrator.ts:2503,2536-2555`) and self-heals `.spec.backup` | **WRONG** |
| 37 | §6 procedure: create `backup-s3-creds` first, then `kubectl patch cluster postgres` with `.spec.backup` | Yes | Secret name matches `BACKUP_CREDS_SECRET` (`orchestrator.ts:275`); destination/retention match `:2400,2410`. But the manual procedure is now largely obsolete — and it does *not* work when no store is resolved, which is production's case | **STALE** |
| 38 | §6 verify `kubectl get cluster postgres -n <ns> -o jsonpath=…destinationPath` | Yes | Correct CRD, plural, name | **OK** |
| 39 | §6 `backupsConfigured` reports the store, not the cluster; trust `/backup-status` | Yes | `orchestrator.ts:2362`; route at `functions/backup.ts:796` | **OK** |
| 40 | §7.1 `terraform apply` in `infra/gcp`, then `infra/saas-gcp`; "Without state, import first" | Yes | Correct, and the warning matters: `saas-secrets.tf:13-41` would otherwise mint a **new** encryption key | **OK (under-warned)** |
| 41 | §7.2 recreate the static IPs and the pre-shared TLS cert | Yes (prose) | No commands; the pre-shared cert is by definition hand-provisioned | **UNVERIFIABLE** |
| 42 | §7.3 run `scripts/phase0-gke-config.sh` | Yes | **Fails on a fresh cluster** (line 17 patches a Secret and a namespace nothing created) and **is unsafe on the live cluster** (bulk-applies the Ingress + NetworkPolicy, re-attaches dead cert v2) | **WRONG** |
| 43 | §7.4 restore the control-plane database (§2) | Yes | See rows 9–13 | **OK** |
| 44 | §7.5 register the cluster so `baseline.ts` installs the baseline | Yes | `baseline.ts` ✓ | **OK** |
| 45 | §7.6 re-point DNS once the new ingress IP is known | n/a | Manual at Namecheap | **UNVERIFIABLE** |
| 46 | §7.7 "A redeploy reconciles the NetworkPolicy, backup credentials and env; it does **not** reconcile an existing CNPG cluster's spec" | — | It now reconciles `.spec.backup` (row 36). Instance count / resources / parameters still not reconciled | **STALE (half true)** |
| 47 | §7 — missing steps entirely | — | Nothing creates namespace `rebase-saas`, ServiceAccount `rebase-saas-control-plane`, Secret `rebase-saas-secrets`, or applies `control-plane-rbac.yaml` / `control-plane-cluster-access.yaml` | **WRONG (omission)** |

---

## Findings by severity

### HIGH

**H1 — §1's central premise is false: tenants provisioned on production have no
backups.** Production sets no `DEFAULT_CLUSTER_ID`
(`saas/infra/gcp/saas-control-plane.yaml:203-206`), so unlinked projects resolve
through the ambient rung, which sets the backup store from environment variables
only:

```ts
// saas/backend/src/k8s/resolve.ts:258-259
if (process.env.KUBERNETES_SERVICE_HOST) {
    orchestrator.backupStore = resolveBackupStore();
```

`resolveBackupStore()` with no cluster record falls through to
`BACKUP_S3_BUCKET` / `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`
(`saas/backend/src/utils/backup-store.ts:103-112`) and returns `undefined` if any
is missing. None of the three appears anywhere in `saas-control-plane.yaml`.
With no store, `provisionPostgresCnpgCluster` omits `.spec.backup` entirely
(`orchestrator.ts:2397-2412, 2469`), `provisionScheduledBackup` skips
(`orchestrator.ts:3270`), and `reconcileClusterBackupSpec` returns immediately
(`orchestrator.ts:2537`). The code says so out loud —
`orchestrator.ts:978-983` logs `⚠️ Tenant … has NO automated database backups` —
while the runbook says tenants "survive a control-plane loss untouched"
(`DISASTER-RECOVERY.md:26-28`). §6 records that both live tenants were patched by
hand on 2026-07-20/21, which is the only reason the claim is true of anyone.
Anything provisioned since, on the ambient rung, is unarchived.

**H2 — §7 step 3 tells you to run a script that reproduces the 2026-08-07
outage.** `scripts/phase0-gke-config.sh:48` does
`kubectl apply -f …/saas-control-plane.yaml` — a whole-file apply of the document
containing the Ingress and the NetworkPolicy. Three independent prohibitions:

* `saas/DEPLOYMENT.md:74-81`: "do not apply the whole file without checking the
  Ingress … a whole-file apply also rewrites the Ingress's
  `ingress.gcp.kubernetes.io/pre-shared-cert` from the three certificate ids the
  load balancer currently carries down to the one this file names".
* `saas/infra/gcp/saas-control-plane.yaml:342`: "⚠️ APPLY THIS ONE DELIBERATELY,
  NOT AS PART OF A BULK APPLY" — on the NetworkPolicy, whose stated failure mode
  is "every control-plane pod failing its liveness probe and CrashLooping — an
  outage, not a degradation" (`:348-349`).
* `saas/infra/gcp/saas-control-plane.yaml:427` still names
  `networking.gke.io/managed-certificates: "rebase-saas-cert-v2"`, which
  `saas/infra/gcp/saas-managed-cert.yaml:29` records as `FailedNotVisible` —
  permanently dead — and which the 2026-08-07 fix replaced with `-v3`
  (`saas-managed-cert.yaml:44`). The fix commit (7e5486a) touched only the
  certificate file. So the apply drops the live certificate and attaches a dead
  one by name.

The script's own header says "Everything here is idempotent; safe to re-run"
(`phase0-gke-config.sh:8`). It stopped being true on 2026-08-07.

**H3 — the rebuild path cannot produce a bootable control plane.** Two gaps, both
in §4/§7:

* `build-gcp-key` is a **required** `secretKeyRef`
  (`saas-control-plane.yaml:256-260`). It is not in the secret template
  (`infra/gcp/saas-secrets.yaml` carries only `postgres-password`,
  `database-url`, `jwt-secret`, `rebase-service-key`), not in
  `phase0-gke-config.sh`, not in Terraform, and not in §4's hand-built inventory
  table. A rebuild following the runbook yields pods stuck in
  `CreateContainerConfigError`.
* Nothing in §7 creates namespace `rebase-saas`, ServiceAccount
  `rebase-saas-control-plane` (referenced by the Deployment at `:125`, the
  CronJob at `saas-control-plane-backup.yaml:45`, the RBAC binding at
  `control-plane-rbac.yaml:71-73`, and `phase0-gke-config.sh:28`), or the
  `rebase-saas-secrets` Secret. `phase0-gke-config.sh:17` *patches* that Secret
  under `set -euo pipefail`, so on a fresh cluster the script aborts at line 17.
  The only thing in the repo that creates the namespace and ServiceAccount is
  `scripts/local-dev-setup.sh:25,32-38` — which also installs the **superseded**
  ClusterRole that `control-plane-rbac.yaml:8-13` documents as missing
  `jobs.batch`, `networkpolicies` and the CNPG CRDs, so an in-cluster deploy
  403s at the build job and the tenant NetworkPolicy is silently skipped. Reaching
  for that script during a rebuild silently downgrades tenant isolation.

**H4 — §6 diagnoses a bug that was fixed the same afternoon the doc was
written.** §6 asserts "`provisionPostgresCnpgCluster` treats an existing Cluster
as reuse on 409 and does not reconcile its spec … and no redeploy will add one",
then gives a manual `kubectl patch` procedure. Commit 79e4faa (2026-07-22, after
f4cd84f which created the doc) added `reconcileClusterBackupSpec`
(`orchestrator.ts:2503, 2519-2555`), whose own docblock says it "is what makes a
redeploy self-heal a Cluster that predates its backup configuration". The doc has
been edited twice since (2026-07-29, 2026-07-30) without §6 being touched. An
operator following §6 hand-patches a cluster the platform would have healed, and
— worse — will conclude the platform *cannot* heal it, which is the wrong mental
model to carry into H1.

### MEDIUM

**M1 — the restore pipe cannot fail.** §2's restore is
`gcloud storage cat … | gunzip | kubectl exec -i … psql -U postgres -d rebase_saas_restore`,
with no `-v ON_ERROR_STOP=1` and no `--single-transaction`. `psql` reading a
script continues past errors and exits 0, so a truncated or partially-corrupt
dump produces a half-populated database and a clean exit. The doc's own next
paragraph — "a restore that produced an empty `clusters` table is worse than no
restore, because it looks like success" — is the exact failure the command
permits. The safer form already exists two files over:
`scripts/upgrade-postgres-18.sh:191` restores with `--single-transaction`.

**M2 — the destructive warning is attached to the non-destructive step.** §2's
heading reads "Restore into the running StatefulSet (destructive — it replaces
the live database, so take a dump of the current state first if the pod is still
up)". The command beneath it drops and creates `rebase_saas_restore`, a scratch
database, and the following paragraph explains that this is *precisely so* the
operation is not destructive. Meanwhile the step that genuinely is — "Cut over by
scaling the control plane to zero, renaming the databases, and scaling back up" —
carries no warning, no commands, and no note that `ALTER DATABASE … RENAME`
refuses while any session holds the database. Also: "take a dump of the current
state first" is given no command, in the one place where omitting it is
unrecoverable.

**M3 — no step verifies which cluster it is about to act on.** Every `kubectl`
command in the runbook relies on the ambient context. `phase0-gke-config.sh` is
careful to pass `--project rebase-578f2` to every `gcloud` call
(`:22,24,27,35,45`) and passes no `--context` to any of its four `kubectl` calls.
A grep of `saas/scripts/*.sh` finds exactly one reading of
`kubectl config current-context`, in `local-dev-setup.sh:13`, and it only prints
it. The most dangerous instance is §5's
`kubectl -n ingress-nginx patch svc ingress-nginx-controller … loadBalancerIP`:
against the wrong cluster it sets an address that cluster does not hold, and the
doc itself notes at `:267-268` that this edit "can prompt the cloud to rebuild
the load balancer". `saas/scripts/dev-prod.sh:1-16` — which port-forwards a local
dev server to the **production** database — is a standing reminder that the
context is routinely pointed at prod.

**M4 — the drill instructions are not runnable as written.** §2's tenant drill
says `POST /pitr-restore`. The real path is
`/api/functions/backup/pitr-restore` (functions mount under
`/api/functions/*`, `backend/src/index.ts:128`), and CSRF is enabled in
production (`index.ts:377`), so a POST without an `Origin: https://app.rebase.pro`
header returns a bare `Forbidden`. An operator on their worst day, reading this
section for the first time, gets a 403 with no explanation and no next step —
the exact shape of bug class 5.

**M5 — the TLS section is two certificates behind, and its advice is now
contradicted.** §4 lists `rebase-saas-cert` (failed) and `mcrt-ab797b1c`
(orphaned, serving). Since then `rebase-saas-cert-v2` was created and failed
permanently, and `rebase-saas-cert-v3` was created and is live
(`saas-managed-cert.yaml:28-29,44`). §4's bullet "Deleting the `rebase-saas-cert`
CRD to tidy up is harmless" is directly contradicted by
`saas-managed-cert.yaml:24-26`: "Superseded resources are left in the cluster
rather than deleted … because deleting a certificate is the operation that caused
this."

**M6 — §5's two remediation steps have already been done.** `INGRESS_LOAD_BALANCER_IP`
is set on the Deployment (`saas-control-plane.yaml:221-222`) and the manifest
names the reservation `rebase-ingress-nginx-ip` as regional/PREMIUM in
`europe-west1` (`:216-220`) — exactly what §5 steps 1 and 2 prescribe as
outstanding work. Re-running step 1 errors with `ALREADY_EXISTS`. A runbook that
lists completed work as pending trains readers to skim it.

### LOW

**L1 — §3's secret list is missing `gemini-api-key`**, which the Deployment
consumes at `saas-control-plane.yaml:153-158` (optional, so its absence is not an
outage — but a secrets inventory that is 6/7 complete is not an inventory).

**L2 — `saas-control-plane-backup.yaml:18` points at `saas/docs/DISASTER-RECOVERY.md`.**
There is no `saas/docs/` directory; the file is `saas/DISASTER-RECOVERY.md`.

**L3 — the "verify the Secret Manager copy exists" instruction has no command**
(`DISASTER-RECOVERY.md:110-112`), in the section about the one value that cannot
be regenerated.

**L4 — §4 under-warns about Terraform and the encryption key.** §7.1's "Without
state, import first" is correct but does not say *why it matters most here*:
`infra/saas-gcp/saas-secrets.tf:13-41` generates the key from a
`random_password` held only in state. `ignore_changes` protects it only while the
state exists; a stateless apply is a new key. Given §3 says the key is
unrecoverable and there is no rotation tooling, that resource deserves a named
warning in §4's inventory rather than a clause in §7.

**L5 — companion-doc drift that a reader would hit during recovery.**
`STAGING-ENVIRONMENT.md:106` and `:121` state that Terraform state "is committed
to the repo" and that this makes a botched migration "recoverable". It is not
committed (`infra/.gitignore:2-3`; no tfstate in `git ls-files`), which is what
`DISASTER-RECOVERY.md:142-146` correctly says. `PROD-READINESS.md:52-54` still
describes backups as "S3-only (`BACKUP_S3_*`, restic `s3://`)" — restic appears
nowhere in the repository — and `:84` still calls `ENCRYPTION_KEY` "optional in
the env schema", which `saas-control-plane.yaml:234-241` records as required
(the backend refuses to boot without it).

---

## Checked and clean

* **Control plane targeted is the right one.** Every identifier in the runbook —
  `rebase-saas-gke`, namespace `rebase-saas`, StatefulSet `saas-postgres`, pod
  `saas-postgres-0`, Deployment `rebase-saas-control-plane`, Service
  `saas-postgres-service`, Secret `rebase-saas-secrets` — matches
  `infra/gcp/saas-control-plane.yaml`. No Cloud Run, no Cloud SQL, no Hetzner,
  no Docker-era instruction survives anywhere in `DISASTER-RECOVERY.md`. The
  Hetzner blueprint in `infra/hetzner/` is correctly scoped to self-hosted
  customers by `infra/README.md:150-183` and is not confused with production.
* **Backup identifiers.** Bucket, prefix, filename format, timestamp format,
  retention window and lifecycle prefix scoping all agree across
  `DISASTER-RECOVERY.md:33-45`, `saas-control-plane-backup.yaml:105-117`,
  `db-backups-lifecycle.json` and `phase0-gke-config.sh:34-45`. The lifecycle
  rule is correctly scoped to `control-plane/` so it cannot fight barman over the
  tenant archives under `tenants/`.
* **The dump job's own integrity checks are real.** A <4096-byte dump is refused
  before upload (`saas-control-plane-backup.yaml:67-72`) and the upload is read
  back (`:111-113`). This is class 4 handled correctly — it asserts the outcome,
  not the absence of an exception.
* **`--no-owner --no-privileges` is survivable.** The dump omits GRANTs and the
  `rebase_user` role, but `ensureAppRole` recreates the role, membership, grants
  and default privileges idempotently at boot
  (`packages/server-postgres/src/security/rls-enforcement.ts:199-247`), and the
  saas policies are `TO public` (`saas/backend/drizzle/0001_steady_argent.sql:45`),
  so they do not reference a role the dump did not carry.
* **PITR route surface.** `/pitr-restore`, `/pitr-restore-status`,
  `/pitr-restore-cutover`, `/pitr-restore-discard`, `/backup-status`,
  `/pitr-status` all exist with the semantics the doc describes, including the
  `acknowledgeNoCutover !== true` refusal (`functions/backup.ts:1688-1694`) and
  the fixed staged-cluster name `postgres-restored` (`:694`).
* **§5's three custom-domain locks** are all real and all still in force:
  `servableCustomDomain` requires `verified` (`k8s/domains.ts:33-36`),
  `customDomainStatus` is stripped from client writes
  (`hooks/project-hooks.ts:133`), and `platformDomains()` is consulted at save
  (`project-hooks.ts:151`).
* **§4's Terraform inventory** is accurate resource-for-resource against
  `infra/gcp/*.tf` and `infra/saas-gcp/*.tf`, and the "hand-built" list is
  genuinely absent from both states.
* **`baseline.ts` behaves exactly as §5 describes** — create-only with 409
  treated as present (`:152-168`), `spec.loadBalancerIP` written only when
  `INGRESS_LOAD_BALANCER_IP` is set (`:123-135`), so BYO clusters are unaffected.
* **§3's encryption claims** hold: the key is required at boot, ciphertext is
  AES-256-GCM under it, and decrypt failures are swallowed (`encryption-hooks.ts:82-86`)
  — the doc is if anything understating how quiet the failure is.
* **The doc says the restore is untested, and it is.** `pitr-restore.test.ts`,
  `pitr-cutover.test.ts` and `backup.test.ts` inject fakes and capture `spawn`
  argv; `barman-store.test.ts` is a pure unit test of one path-builder. They are
  good tests — `pitr-cutover.test.ts:1-33` explains what each assertion would
  catch — but none of them proves a restore works. Per the audit brief: **a test
  that mocks the restore does not count, and this document already says so.**

---

## Failure scenarios the runbook does not cover at all

1. **Region loss.** Everything is `europe-west1` in project `rebase-578f2`: the
   cluster, the Artifact Registry, the reserved ingress address (regional, by
   necessity — `DISASTER-RECOVERY.md:228-234`), and the backup bucket. §7 opens
   "assuming the GCP project survives"; there is no branch for when it does not.
   Notably, **the control-plane dumps and the tenant barman archives are in the
   same bucket in the same project** (`saas-control-plane-backup.yaml:117`;
   `orchestrator.ts:2400`), so one bucket-level event takes both tiers.
2. **Corrupted or malicious backup.** The CronJob checks size only
   (`saas-control-plane-backup.yaml:67-72`). Nothing verifies restorability,
   nothing checksums, and no bucket versioning or retention lock is declared
   anywhere in the repo — the lifecycle rule *deletes* at 30 days
   (`db-backups-lifecycle.json`), so a bad dump that overwrites nothing still
   silently ages out the good ones behind it. There is no "the restore came back
   wrong, now what" path.
3. **Leaked credential.** No rotation procedure exists for anything.
   `encryption-key` is stated to have none (`DISASTER-RECOVERY.md:113-115`).
   `jwt-secret` rotation is described as consequential but not as a procedure.
   Most acutely, `backup-store.ts:22-62` documents that the single
   `backupSecretAccessKey` "has the blast radius of the entire backup bucket" —
   every tenant's archives — and instructs the reader to "rotate it as such",
   while the DR runbook, the only place a rotation would be performed under
   pressure, does not mention it.
4. **Accidental tenant deletion.** `destroyTenant` deletes the namespace and
   Kubernetes garbage-collects the PVCs (`infra/README.md:130`). Nothing in the
   runbook covers recovering that tenant: the barman archive under
   `s3://<bucket>/tenants/<namespace>/` survives, and `namespace` is stored on
   the project row and deliberately never recomputed
   (`infra/README.md:84-86`), so recovery is possible in principle — but there is
   no documented path from "namespace deleted" back to a running tenant, and the
   PITR routes all assume a live source Cluster to read status from
   (`functions/backup.ts:1717`).
5. **A bad migration on the control plane.** `maxUnavailable: 0` means a
   crashlooping boot stalls forever rather than taking the site down
   (`saas-control-plane.yaml:280-283`) — a state the manifest names explicitly and
   the runbook never mentions. There is no rollback step, and §2's restore is
   scoped to data loss, not to a schema the running image cannot boot against.
6. **The control-plane PVC surviving but corrupted.** §2 assumes the pod is
   either up (dump it first) or the data is gone. A `saas-postgres-0` that starts
   but returns errors has no branch.
7. **Loss of the laptop holding Terraform state.** Named as a risk
   (`:142-146`) with the right remedy identified ("moving state to a GCS backend
   is the single cheapest resilience win in this document") — but there is no
   step, no ordering, and no `terraform import` starting point. It is a
   recommendation inside a runbook, which is the one place a recommendation is
   not enough.

---

## Open questions

These cannot be settled by reading files, and per the audit rules none of them
was executed.

1. Does the live `rebase-saas-control-plane` Deployment carry `BACKUP_S3_*`
   environment variables that `saas-control-plane.yaml` does not declare? If it
   does, H1 is narrower than stated — but any `kubectl apply` of that file
   (including `phase0-gke-config.sh:48`) would then wipe them, which is a worse
   version of the same finding. Answerable by reading the live Deployment; not
   answerable from the repo.
2. Is `archive_timeout` actually 5 minutes on the tenant clusters? Nothing in
   this repo sets it (`grep archive_timeout` over `saas/backend/src` and
   `saas/config` returns nothing), so §2's "~5-minute RPO" depends entirely on a
   CloudNativePG built-in default that no manifest here pins. If CNPG's default
   changes, or if `db.parameters` ever overrides it, the stated tenant RPO
   changes with no signal.
3. Does `*.apps.rebase.pro` still exist at Namecheap? `DISASTER-RECOVERY.md:179`
   and `infra/README.md:206-208` were edited in the same commit and disagree.
4. Which certificates does the live target-https-proxy actually carry? The repo
   now contains three plausible answers (`mcrt-ab797b1c`, `rebase-saas-cert-v2`
   in the Ingress annotation, `rebase-saas-cert-v3` in the CRD file) and
   `DEPLOYMENT.md:76-81` says the live value is partly controller-owned and drifts
   from the file by design.
5. Has the nightly `saas-postgres-backup` CronJob ever completed successfully?
   The manifest is well-built, but nothing in the repo records a successful run,
   and `startingDeadlineSeconds: 3600` plus `concurrencyPolicy: Forbid` means a
   long-running failure mode is silent. This needs `kubectl -n rebase-saas get
   jobs` — deliberately not run.
6. Does `spec.loadBalancerIP` still take effect on GKE? The field is deprecated
   upstream since Kubernetes 1.24. `baseline.ts:133` writes it, and
   `saas-control-plane.yaml:216-222` treats it as load-bearing for the entire
   tenant data plane. If GKE has moved to the annotation form on this cluster's
   LB type, a rebuild silently takes a new address and §5's whole mitigation is
   inert — which is the failure §5 exists to prevent.
7. Would the control-plane dump restore cleanly into a **brand-new** Postgres
   instance (§7's case, not §2's)? `ensureAppRole` covers the role and grants at
   boot, but nothing here has been tried, and the only way to know is to do it —
   which is exactly the drill §2 already recommends and nobody has run.
