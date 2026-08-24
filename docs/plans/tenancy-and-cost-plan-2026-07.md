# Tenancy, sharing and unit economics — plan

> **Status, 2026-07-29.** Waves 0–7 are implemented on the `feat/tenancy-tiers`
> branch of the `saas` repo (worktree `~/rebase-worktrees/saas-tiers`), 20 commits,
> 2003 tests passing — plus one commit on `feat/runtime-bundle-fetch` in the OSS
> repo, which is the last piece the serverless tier needed. **Nothing has been applied to the live cluster** — every
> change is code, manifests and an operator script waiting to be run.
>
> The reconciler's read-and-diff has been run against `rebase-saas-gke` read-only
> and agrees with the numbers here: **$667/month across the three tenants today,
> $301 once `legacy` is applied**, with no capacity change anywhere. The pool
> manifests pass `kubectl create --dry-run=server`, and the shared-pool isolation
> SQL has been executed against a real PostgreSQL and attacked.
>
> §10 records what building it found, which changed several numbers below; §11 is
> what to run and in what order.

Written 2026-07-28. Supersedes the "GKE cost optimization handoff" of the same date,
which is correct about the cluster but scoped as an infrastructure clean-up. It is not
one. The numbers below say the product is sold roughly **ten times below cost**, and no
amount of right-sizing fixes that — the tier model has to change.

Everything with a number attached was measured: pod requests from the live cluster, unit
prices from the Cloud Billing catalog API (`europe-west1`, USD list, 730 h/month). Where
a number is an estimate it says so.

---

## 1. The finding

A GCP `e2-small` project bills the customer **€19.50/month** (`compute_gcp_e2-small`:
€13 base + 50 % markup, `utils/pricing-catalog.ts`).

What that project actually provisions today, per `k8s/orchestrator.ts`:

| Pods | What | Requests |
|---|---|---|
| 2 | CNPG Postgres (`instances: Math.max(2, replicaCount+1)`) | no `resources` → Autopilot default 500m / 2 GiB each |
| 4 | PgBouncer (`Pooler` rw + ro, `instances: 2` each) | no `resources` → 500m / 2 GiB each |
| 1 | app pod (`computeResourcesFor(vmSize)`) | 2 vCPU / 2 GiB for `e2-small` |

= **5 vCPU / 14 GiB / 7 pods**, which at Autopilot on-demand rates is **$234/month**, plus
$2.30 of persistent disk.

> **We charge €19.50 and spend ≈ €215. Every tenant we add loses money at ten to one.**

The whole cluster today (3 tenants + platform) requests 15.7 vCPU / 49 GiB ≈ **$836/month**.
Every tenant's app uses **0.02 cores**.

This reframes the task. Cost optimisation gets the loss from 10× to 2×. Getting to a real
business needs a tier model where what a customer buys determines what gets provisioned,
and where the cheap tiers share infrastructure instead of each owning a copy of it.

### 1.1 What the pods actually use

`kubectl top`, 2026-07-28, alongside what each pod is billed for:

| Pod | Uses | Requests (billed) | Overprovision |
|---|---|---|---|
| tenant app (all three) | **1–2 m CPU, 40–50 MiB** | 2 vCPU / 2 GiB (`e2-small`) | ~1000× CPU |
| CNPG Postgres | 7–10 m CPU, 57–697 MiB | 500m / 2 GiB | ~60× CPU |
| PgBouncer × 4 | **1 m CPU, 11–15 MiB each** | 500m / 2 GiB each | ~500× |

The four poolers per tenant consume **4 mCPU and 48 MiB between them** and are billed
2 vCPU / 8 GiB — **$43/tenant/month to front a single app pod that opens a client-side
connection pool of its own.**

The 40–50 MiB app RSS is the number that makes §4.7 (one runtime process hosting many
bundles) plausible rather than aspirational: 200 bundles fit in 16 GiB.

---

## 2. Unit economics reference

Keep this table. It is the tool for every future decision, and the reason several
"obvious" designs below are wrong.

**Compute substrates** (europe-west1, USD list, per month):

| Substrate | per vCPU | per GiB | Minimum billable unit |
|---|---:|---:|---|
| GKE Autopilot pod, on-demand | $35.77 | $3.96 | **$10.92/pod** (250m / 512 MiB floor) |
| GKE Autopilot pod, **spot** | $10.73 | $1.19 | **$3.28/pod** |
| GKE Standard, E2 **spot** node | $8.48 | $1.14 | none — per node. `e2-standard-8` = **$104** |
| GKE Standard, E2 on-demand node | $17.52 | $2.35 | none. `e2-standard-8` = $215 |
| Cloud Run, request-billed | $0.0864/vCPU-**hour served** | $0.009/GiB-h served | **$0 when idle** (+ $0.40/M requests) |
| Cloud Run, min-instance (kept warm) | $6.57 idle | $6.57 idle | — |
| Cloud Run, instance-billed (always-on CPU) | $47.30 | $5.26 | — |

Fixed: Autopilot/Standard **cluster fee $73/month, per cluster** (do not create a second
cluster casually). Balanced PD $0.10/GiB-mo (+$0.013 Autopilot premium); regional 2×.

Three consequences drive the whole design:

1. **Spot is a 70 % discount on Autopilot and costs one `nodeSelector`.** There is not a
   single `nodeSelector`, `tolerations` or `gke-spot` reference anywhere in `saas/backend`.
   This is the largest saving available for the least work, and it is entirely untapped.
2. **On Autopilot the pod is the billing unit, and it has a floor of $3.28 (spot) /
   $10.92 (on-demand).** Pod *count* is the lever, not pod size. Seven pods per tenant can
   never cost less than $23/month spot, $76 on-demand, whatever we write in the manifest.
3. **Cloud Run request-billing is the only substrate where an idle tenant is free.** A
   tenant serving 100 k requests/month at 120 ms costs **$0.34**. The first ~180 k vCPU-s
   per month are free per billing account. Nothing on Kubernetes can compete with zero.

Also worth knowing: GKE 1.35 (this cluster) supports **burstable pods** — requests below
limits, billed on requests, bursting into spare node capacity. A tenant can be sold
"250m guaranteed, bursts to 2 vCPU" and billed at the floor. That matches the measured
behaviour of every tenant we have (idle at 0.02 cores, spiky under request) and is a
genuine product feature, not a trick.

---

## 3. The product model

The current single axis is `vmSize` — a VM name inherited from a Hetzner price list that
selects a Stripe price and one pod's `resources`. It cannot express "cheap because
shared", which is exactly what we need to sell.

Replace it with a **plan**, which determines a whole *topology*: substrate, database mode,
sharing, isolation, limits. `vmSize` stays as a column so existing rows and Stripe prices
keep working, but it stops being the thing that decides anything.

### The ladder

| Plan | Compute | Database | Isolation | Cost to serve | Price |
|---|---|---|---|---:|---:|
| **Static** | GCS + CDN, no compute | none | n/a | ~$0.05 | €0 / €5 |
| **Hobby** | Cloud Run, scale-to-zero, shared runtime image | shared pool, own database | process (Cloud Run) + database + RLS | **~$1.50** | €0 (quotas) / €9 |
| **Starter** | 1 dedicated pod, **spot**, 250m/512Mi burstable → 2 vCPU | shared pool, own database | process + database + RLS | **~$5** | €19 |
| **Pro** | 1 dedicated pod, on-demand, 500m/1Gi → 4 vCPU | dedicated Postgres, 1 instance, no pooler | dedicated cluster | **~$50** | €99 |
| **Business** | 2+ replicas, on-demand, PDB | dedicated HA Postgres (2 inst.) + 1 pooler pair, PITR | dedicated everything | **~$225** | €399 |
| **BYO cluster** | customer's cluster | customer's | theirs | ~$0 | €19 platform fee (exists) |

Margins: 85–90 % on Hobby/Starter/Pro, ~45 % on Business — improve Business later with
Autopilot spend-based committed use (the `Commitment - dollar based v1: Kubernetes Engine
Autopilot` SKUs exist at $0.0055–0.008/hour) once the run-rate is predictable.

The ladder is deliberately steep between Starter and Pro because that is where the
physical thing changes: below the line you share a database cluster, above it you get your
own. That is the honest boundary, and it is the one worth charging for.

### Orthogonal add-ons — how a customer makes it expensive on purpose

Plans set defaults; these are separately priced and separately provisioned:

- **App size** (cpu/mem) and **replica count** — already modelled (`replicaCount`).
- **Database**: shared → dedicated → HA; storage GiB; backup retention; PITR.
- **Preemptible compute** — spot, ~65 % cheaper, "may restart with ~25 s notice". Default
  on for Hobby/Starter, opt-in discount for dev/staging on Pro. Sell it as a choice, not a
  hidden cost cut.
- **Sole tenancy** — a dedicated node pool, for customers with a compliance answer to give.
- **Region**, **egress**, **extra environments**.

### Environments as the natural upsell/downsell

The single most useful sharing story for a customer is not "share with strangers", it is
**"prod is dedicated, preview and staging are shared"**. A branch deploy or a preview from
`deploy-hooks` lands on Hobby (Cloud Run, scale-to-zero, shared DB, $0 idle) while prod
stays on Pro. That is a feature people pay *more* overall for, because they stop
self-hosting their staging.

### What we say out loud

Sharing has costs, and hiding them produces support tickets and churn. Publish, per plan:
cold start on first request after idle (Hobby), no HA (Hobby/Starter/Pro), shared database
cluster with per-tenant connection and statement limits, eviction/quota policy on the free
tier, restore granularity. A shared tier with stated limits is a product. One with implied
guarantees is a liability.

---

## 4. Architecture

Five pieces. (1) and (2) are enabling refactors and everything else depends on them.

### 4.1 One topology resolver

`saas/backend/src/utils/tenant-topology.ts` — a pure function, the single place the
footprint is decided:

```ts
export interface TenantTopology {
    compute: {
        substrate: "cloudrun" | "k8s-pod" | "k8s-shared-pool" | "static";
        cpu: string; memory: string; cpuLimit?: string; memoryLimit?: string;  // burstable
        replicas: number; spot: boolean; minInstances: number; maxInstances: number;
    };
    database:
        | { mode: "none" | "byodb" }
        | { mode: "shared"; poolId: string }
        | { mode: "dedicated"; instances: 1 | 2 | 3; cpu: string; memory: string;
            storageGi: number; pooler: false | { instances: number };
            backups: { pitr: boolean; logicalDumps: boolean; retentionDays: number } };
    storage: { mode: "shared-prefix" | "dedicated-bucket" };
    limits: { dbSizeMb: number; dbConnections: number; statementTimeoutMs: number;
              requestsPerMonth: number | null; egressGb: number | null };
}

export function resolveTopology(project: ProjectLike): TenantTopology;
```

`compute-tiers.ts` folds into this. Its doc comment already argues the right principle
("a record that lies about its provider bills the customer for hardware they are not on")
and then applies it to one pod out of seven. This applies it to all of them.

Being pure is the point: it is testable without a cluster, and the reconciler can diff it
against reality.

### 4.2 A reconciler, not just a provisioner

Today the topology is written **only on deploy**, and `provisionConnectionPooler` /
`provisionPostgresCnpgCluster` swallow HTTP 409 with `"already exists. Reusing."`. So a
code change reaches new tenants only — the three live ones need hand-written
`kubectl patch`. That has already happened once (the backup-spec gap, three days
unarchived, fixed by hand per tenant). It will happen with every item in this document.

Add a `topology-reconciler` cron that, per project: computes `resolveTopology(project)`,
reads the live namespace, and patches the delta. Requirements:

- **Dry-run by default**, with a report; applying is an explicit flag or an admin action.
- **Never restarts a Postgres primary** outside a declared maintenance window — resizing a
  running CNPG instance restarts it, and `dadaki.com` is a live customer domain.
- Additive changes (annotations, resources on stateless pods, `nodeSelector` on a new
  ReplicaSet) apply freely; destructive ones (instance count down, pooler removal, storage)
  need the window.
- Reports drift it will not fix, so an unreconcilable tenant is visible rather than silent.

It also fixes the observed unreliable namespace teardown: a namespace with no project row
is drift, and the reconciler is the thing that notices.

### 4.3 Shared Postgres pool — database per tenant

Namespace `rebase-shared`, CNPG `Cluster` `pg-pool-1`, **2 instances, on-demand** (never
spot: this is everyone's data), PDB, cluster-level barman PITR.

Per shared-tier tenant, executed as the pool superuser:

```sql
CREATE ROLE app_<pid> LOGIN PASSWORD '…'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE CONNECTION LIMIT 20;
CREATE DATABASE t_<pid> OWNER app_<pid>;
REVOKE CONNECT ON DATABASE t_<pid> FROM PUBLIC;
GRANT rebase_user TO app_<pid>;                       -- pool-global NOLOGIN role
ALTER ROLE app_<pid> SET statement_timeout = '30s';
ALTER ROLE app_<pid> SET idle_in_transaction_session_timeout = '60s';
```

Notes that matter:

- **Database-per-tenant, not schema-per-tenant.** A connection is bound to one database, so
  cross-tenant reads are not merely policy-gated, they are unreachable. Schema-per-tenant
  would put every tenant's tables one `search_path` mistake apart, and we already have a
  documented case of an unqualified identifier binding to the wrong table in an RLS policy.
- `rebase_user` is a **cluster-global** role (Postgres roles are cluster-scoped) created
  once per pool. It is `NOLOGIN` and holds no privileges of its own; grants live per
  database. This preserves the framework's read-isolation model unchanged — the same trick
  CNPG's `postInitApplicationSQL` already does per tenant today.
- Inside each database also `REVOKE ALL ON SCHEMA public FROM PUBLIC`.
- **Known leak, state it:** `pg_database` is world-readable, so a tenant can list other
  database *names* (opaque project ids). They cannot connect. Acceptable; documented.
- **Noisy neighbour**: per-role `CONNECTION LIMIT`, `statement_timeout`,
  `idle_in_transaction_session_timeout`, plus `pg_stat_statements` monitoring and a
  per-plan size cap enforced from a cron (Postgres has no native per-database quota).
- **Pooling finally earns its keep.** One `Pooler` pair for the whole pool, amortised over
  ~200 tenants, is $0.11/tenant/month — versus $13–44/tenant for the four pods each tenant
  runs today to front a single consumer.
- **Per-tenant restore**: cluster barman gives disaster recovery, not tenant granularity.
  Add a nightly `pg_dump -Fc` per database to GCS ($0.02/GiB-mo), which is what a customer
  actually asks for ("restore *my* database to yesterday").
- **Sharding**: cap tenants per pool (start at 100, tune on `pg_stat_database` and
  connection counts), then provision `pg-pool-2`. The `databases` collection already
  carries `liveDatabaseCluster`; extend it with the pool id.
- **Blast radius**: one pool failure takes down every shared tenant. HA + PITR + capping
  pool size is the mitigation, and it is a stated difference between Starter and Pro.

Per-tenant database pods drop from **6 to 0**. Amortised cost ≈ **$1.14/tenant/month**.

### 4.4 One front door

Today: one `Ingress` and one `Certificate` per tenant namespace. Two problems, one of them
a hard ceiling:

- **Let's Encrypt issues at most 50 certificates per registered domain per week.** Every
  `*.rebase.website` tenant takes one. **We cannot onboard more than ~50 tenants a
  week**, and that is unrelated to cost.
- nginx reloads its config on every tenant Ingress change — O(n) reloads, and no place to
  make a routing decision.

Fix: **one wildcard certificate for `*.rebase.website`** (DNS-01 via Cloud DNS) behind a
single Ingress pointing at a router. Custom domains keep per-domain certs — low volume,
and unavoidable. The router resolves `Host` → destination from a table the control plane
maintains, where a destination is one of: in-cluster Service, Cloud Run URL, GCS prefix,
or a slot in the shared runtime pool.

This is what makes every other tier routable. It should be built before, not after, the
serverless and static tiers.

### 4.5 Serverless tier on Cloud Run

For `substrate: "cloudrun"` (Hobby, previews, staging):

- Run the existing `rebasepro/server` image and **fetch the bundle at boot** from the
  control plane's bundle route — `ManagedDeploymentInput.bundleUrl` +
  `bundleAuthToken` already exist and are already durable-by-design for exactly this
  reason (an init container re-runs on every pod start). Adds ~1–2 s to a cold start and
  reuses the machinery unchanged. The alternative — baking a per-tenant image — costs a
  build per deploy plus an Artifact Registry image per tenant to garbage-collect.
- **Direct VPC egress** into `rebase-saas-vpc` to reach the shared Postgres internal LB.
- `minInstances: 0`, concurrency 80, `maxInstances` capped per plan (this is also the
  abuse control on a free tier).
- Routed through the front door (4.4), so TLS, custom domains and cert-manager stay in one
  place and a project can move between substrates without changing its URL.

An idle Hobby tenant costs **$0**. A real one costs cents. This also removes tenants from
the GKE cluster entirely, which shrinks the Network Intelligence Center charge that the
handoff correctly notes cannot be turned off but does scale with network resources.

Cold start is the honest cost, and it is why this is the *cheap* tier and not the default.

### 4.6 Static tier

`bundle.manifest.kind === "static"` and `apps.type === "static"` already exist and
`runFromBundle` already skips schema work for them. Publish the build output to a shared
GCS bucket under `<projectId>/<deploymentId>/` and serve it from the front door (or Cloud
CDN + backend bucket). Zero compute, ~$0.02/GiB-mo, instant rollback by pointing at a
previous deployment prefix.

**`presupuestos` is the candidate** — verify whether it touches its database at all before
designing its migration.

### 4.7 Shared multi-bundle runtime pool — designed for, not built yet

The bundle format already separates engine from application ("the bundle is the project;
this process is the engine"). That makes a genuinely unusual option available: **one
`rebase-server` process hosting N bundles, routed by `Host`** — marginal cost per tenant
becomes memory only (~30–80 MB), roughly **$0.30/tenant/month**, with no cold start.

It is not wave-one work, because the isolation story has to be real first: one tenant's
`while(true)` or OOM takes down the pool. Gate it on managed bundles only (intake already
rejects native modules), per-request timeouts, per-tenant concurrency caps, a supervisor
that evicts a misbehaving bundle, and optionally a `worker_thread` per bundle when density
matters less than isolation. Revisit when Hobby volume makes Cloud Run's per-request cost
exceed the pool's fixed cost — with the numbers above, that is somewhere north of a few
hundred active tenants.

### 4.8 Why not GKE Standard (for now)

Standard with E2 spot nodes has no per-pod floor, so 80 tiny tenants on one
`e2-standard-8` spot node is ~$1.30/tenant versus $3.28 on Autopilot spot. Real, but:
Autopilot spot needs one `nodeSelector` and no migration, while Standard means owning node
pools, upgrades, autoscaling and bin-packing. Take the 70 % now; revisit Standard only if
dedicated-pod density becomes the binding constraint (roughly >100 dedicated pods), by
which time the shared tiers should have absorbed most tenants anyway.

---

## 5. Metering and billing

Selling shared resources requires measuring them. Today billing is a flat monthly Stripe
subscription with no usage input at all.

Sources, all of which already exist or are cheap:

| Signal | Source |
|---|---|
| requests, errors, latency, RSS | the runtime's `/metrics`, already scraped by `managed/tenant-metrics.ts` |
| database size, transactions, connections | `pg_database_size`, `pg_stat_database` on the shared pool |
| object storage bytes | `utils/managed-storage-telemetry.ts` |
| serverless compute | `run.googleapis.com/container/billable_instance_time` |

Roll these into a daily `usage_daily` row per project. Then a plan is **included quotas +
metered overage**: flat Stripe price for the plan, metered Stripe prices for requests over
quota, database GiB over quota, egress. That is the mechanism that makes "cheap or
expensive depending on their needs" literally true rather than a marketing line, and it is
also the abuse control the free tier needs.

Sequence it after the plan model but before the free tier opens to strangers.

---

## 6. Execution order

Each wave is independently shippable and each states its own saving. Wave 0 is days of
work and pays for the rest.

### Wave 0 — stop the bleeding (no architecture change)

| # | Change | Saving |
|---|---|---|
| 0.1 | Cluster telemetry: drop `WORKLOADS` logging, drop `advancedDatapathObservabilityConfig`, trim the Prometheus component list | ~€95/mo, ~30 min, zero risk |
| 0.2 | `nodeSelector: cloud.google.com/gke-spot: "true"` on Kaniko build jobs, poolers, and non-production tenant pods | ~65 % of those lines |
| 0.3 | Declare `resources` on the CNPG `Cluster`, both `Pooler`s, and `cert-manager.yaml` (Postgres 250m/1Gi — sized to its own `shared_buffers: 256MB` + `effective_cache_size: 768MB`, not 512Mi; poolers 250m/512Mi) | 3.0 → 1.5 vCPU/tenant |
| 0.4 | Poolers → `instances: 1`, or omitted entirely below a traffic threshold | −2 to −4 pods/tenant |
| 0.5 | Allow CNPG `instances: 1` — drop the `Math.max(2, …)` floor for non-HA plans | −1 pod/tenant |
| 0.6 | `cert-manager` 3 pods × 500m/2Gi → 100m/256Mi | ~$50/mo |
| 0.7 | One-off `kubectl patch` for the three live tenants, dadaki scheduled into a window | applies the above to reality |

Expected: **$836 → ~$260/month.**

### Wave 1 — enabling refactor
`tenant-topology.ts` (4.1) + the reconciler (4.2). No direct saving; without it every later
wave reaches new tenants only.

### Wave 2 — plans and prices
New `plan` column, `resolveTopology` wired into every provisioning call site, new Stripe
catalog and `/pricing`, console plan selector, existing projects grandfathered. **This is
the wave that fixes the margin**, and it is a pricing decision more than an engineering one.

### Wave 3 — shared Postgres pool (4.3)
The largest structural saving: 6 database pods per tenant → 0.

### Wave 4 — the front door (4.4)
Wildcard cert + router. Removes the ~50-tenants-per-week onboarding ceiling and makes
substrates swappable.

### Wave 5 — serverless tier (4.5) · **Wave 6** — static tier (4.6) · **Wave 7** — metering (§5)

### Later — shared runtime pool (4.7), Standard node pools (4.8), committed-use discounts

**End state:** marginal cost of a Hobby tenant ≈ **$1.50/month**, Starter ≈ $5, and a
platform baseline (control plane, shared pool, router, cert-manager, cluster fee) of
roughly $250–300/month that does not grow with tenant count.

---

## 7. Migrating the three live tenants

All three are ours, which makes this the cheapest possible time to do it.

| Tenant | Host | Today | Proposed |
|---|---|---|---|
| `1a78e932…` | **dadaki.com** + dadaki.rebase.website | managed runtime `rebasepro/server` 1.6.0, 2 vCPU/2 GiB app, 6 DB pods | **Pro** — dedicated Postgres, 1 instance, no pooler, on-demand. Real customer domain; schedule the Postgres restart. |
| `ee6ebb2c…` | presupuestos.rebase.website | Kaniko image, 100m/256Mi app (below every tier — worth understanding why), 6 DB pods | **Static** if it does not use its database — verify first. Otherwise **Hobby**. |
| `089c40a0…` | rebase-growth.rebase.website | Kaniko image, 2 vCPU/2 GiB app, 6 DB pods | **Hobby** — a nightly cron job with a lead table. Prime scale-to-zero candidate. |

Order: Wave 0 patches all three in place (safe, no data movement). Wave 3 moves
`presupuestos` and `rebase-growth` onto the shared pool with a `pg_dump`/`pg_restore`
cutover — small databases, minutes of downtime, and they are internal. `dadaki` stays
dedicated throughout and never needs a data migration.

Confirm before designing around it: whether `presupuestos` uses its database at all. Two
sessions have now been blocked from `kubectl exec` into tenant Postgres pods by the agent
permission classifier, so this is still unmeasured. Run it yourself:

```bash
kubectl -n rebase-tenant-ee6ebb2c-5386-46fc-80ed-e8c3d643d5d6 exec postgres-1 -c postgres -- psql -U postgres -d rebase -Atc "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 20;"
```

Its Postgres uses 8 mCPU and 77 MiB, which is consistent with either an empty database or
a very small one — the row counts settle it.

---

## 8. Decisions needed

1. **The price ladder.** €0/€9/€19/€99/€399 as sketched in §3, or different? This is the
   decision the rest depends on, and it is yours, not an engineering one.
2. **Shared Postgres as the default for the two cheapest tiers** — accepting that one pool
   failure affects every tenant on it, mitigated by HA + PITR + pool sharding.
3. **Spot as the default for Hobby/Starter**, sold visibly as "preemptible — may restart".
4. **Is `presupuestos` static?** Determines whether it leaves the cluster entirely.
5. **Does `dadaki` need HA** (Business) or is a single dedicated Postgres instance with
   PITR (Pro) the right answer for a live customer domain?
6. **Free tier: open or invite-only at launch?** Metering (§5, wave 7) is the abuse control;
   opening a free tier before it exists is how a €0 plan becomes a €400 bill.

---

## 9. What is deliberately not here

- **Moving off GCP.** Hetzner is ~3× cheaper per core and the `provider` axis already
  exists, but the operational surface (managed Postgres, object storage, load balancing,
  identity) is not free either. Worth a separate evaluation once the tier model is real —
  not while the cost problem is a design problem rather than a rate problem.
- **Network Intelligence Center (€45.76/mo).** Confirmed to have no supported opt-out. It
  scales with network resources, so it falls when the cluster shrinks and does not
  otherwise respond to anything we do.
- **A second GKE cluster** for isolation tiers. Each one is another $73/month of cluster
  fee before a single pod exists; namespaces and node pools first.

---

## 10. What building it found

Four things the measurement pass in §1 could not have surfaced, all found by
writing the code and running it.

### 10.1 Nothing has ever connected to the poolers

`cnpgDbEnvVars` points `DATABASE_URL`, `DATABASE_DIRECT_URL` **and**
`DATABASE_READ_URL` at `postgres-rw` — the CloudNativePG primary service, not the
pooler. A search of the whole repository finds `postgres-pooler-rw` / `-ro` in
exactly two places: the code that created them, and the tests asserting it had.

So the four PgBouncer pods per tenant are not merely oversized. They have **no
clients**, which is why they measure 1 mCPU and 11–15 MiB. That is
~$43/tenant/month for idle proxies, and deleting them is not a capacity
reduction — it removes something nothing can reach.

It also means `DATABASE_READ_URL` does not name a read path. Nothing currently
routes reads at a standby; the env var promises a capability the runtime does not
have. Left alone deliberately (changing it is a behavioural change for tenants),
but worth knowing before anyone builds on it.

### 10.2 Replicas and database instances were inverted

The custom deploy path hardcoded `replicas: 1` on the Deployment while feeding
the same `replicaCount` into `Math.max(2, replicaCount + 1)` on the database. A
customer paying for three replicas therefore got **one** application pod and a
**four**-instance Postgres cluster at ~$52/month each. Neither number was the one
they bought, and the €19.50 price covered neither.

### 10.3 `postgresql.parameters` ignored the pod

`shared_buffers: 256MB` and `effective_cache_size: 768MB` were hardcoded on every
tenant regardless of whether the pod had 2 GiB or 8 — so a larger database plan
would have bought memory PostgreSQL never touches. Now derived from the pod's own
memory (25% / 70%), except on `legacy`, where raising `shared_buffers` on a live
customer database is not a thing a version bump should do.

### 10.4 The shared pool leaked the estate through the maintenance databases

Found by executing the shared-pool provisioning SQL against a real PostgreSQL and
trying to break out of it. A tenant correctly refused its neighbour's database
could still open `postgres` and `template1` — `PUBLIC` has `CONNECT` on both by
default — and from `pg_stat_activity` read every database name and role on the
cluster: every neighbouring project's id, and whether it was busy. No data
crossed, but a tenant enumerating the estate is not something to leave in place.

Both are now revoked in the pool bootstrap. Verified live: own database ✓,
neighbour refused, `postgres` refused, `template1` refused, superuser unaffected,
every escalation attempt refused (`CREATE ROLE`, `CREATE DATABASE`,
self-`SUPERUSER`, self-`BYPASSRLS`, raising its own connection limit),
`CONNECTION LIMIT` applied, `DROP DATABASE … WITH (FORCE)` succeeded past an open
session leaving nothing behind.

One disclosure survives and is documented in the code rather than glossed:
`pg_roles` is world-readable and cannot be revoked from `PUBLIC` without breaking
the framework's own boot check for `rebase_user`, so a tenant can list the *role
names* on its pool — opaque project ids, nothing else.

### 10.5 Corrections to the numbers in §3

Removing the poolers and right-sizing changed three plans:

| Plan | §3 estimate | Actual, from the resolver | Margin at the §3 price |
|---|---:|---:|---:|
| Hobby | ~$1.50 | **$0** in Kubernetes terms (Cloud Run, idle) | — |
| Starter | ~$5 | **$3.28** | 84% |
| Pro | ~$50 | **$47.65** | 55% |
| Business | ~$225 | **$136.95** | 68% |
| `legacy` (today's tenants, unchanged capacity) | — | **$120.34**, from $234.29 | — |

Business improved most: the §3 figure carried four pooler pods and reserved a
full vCPU per app replica. It now reserves 500m and bursts to 4, which is
generous against a measured 2 mCPU.

`legacy` is not solvent and is not meant to be — it is a holding state that
changes no capacity. Its 49% cut is what the reconciler can take without any
product decision at all.

---

## 11. What to run, in what order

Nothing below has been applied. The first two need no product decision.

### Now, no decision needed

```bash
# ~€95/month. Reversible, affects no serving path.
gcloud container clusters update rebase-saas-gke --region=europe-west1 \
  --project=rebase-578f2 --logging=SYSTEM --monitoring=SYSTEM
```

```bash
# Deletes the four unused poolers per tenant. Interrupts nothing — see §10.1.
# Reports first; --apply is a separate word.
cd saas/backend && npm run reconcile:topology
npm run reconcile:topology -- --apply --ceiling=none
```

Together: roughly **$836 → $480/month**, with no capacity change anywhere and
nothing to decide.

### Next, in a maintenance window

```bash
# Declares resources on the CNPG clusters. Rolls Postgres, so the primary fails
# over — schedule dadaki.com. One project at a time.
npm run reconcile:topology -- --apply --ceiling=database-restart --project=<id>
```

Takes the fleet to about **$360/month**.

### Then, product decisions first (§8)

Assign plans, seed the new Stripe prices (`npm run seed:prices`), stand up
`pg-pool-1`, and migrate `presupuestos` and `rebase-growth` onto it.

### Independently: the onboarding ceiling

> **Update, 2026-07-30 — the domain moved.** Tenants are served from
> `*.rebase.website`, not `*.apps.rebase.pro`, so read every hostname below
> accordingly. Two things this changes rather than renames: the Let's Encrypt
> ceiling no longer endangers `rebase.pro` renewals (tenants are a separate
> registered domain now, so the blast radius stops at the tenant domain), and
> the DNS delegation this section calls for is a whole-zone delegation rather
> than a subdomain one. There is also now a second, independent fix for the same
> ceiling — listing `rebase.website` on the Public Suffix List gives every tenant
> its own budget (`saas/infra/PSL-SUBMISSION.md`). It composes with the wildcard;
> it is not an alternative to it, and it takes months.

The Let's Encrypt limit (§4.4) is not a cost item and does not wait for any of
the above. It needs one DNS change — delegate `rebase.website` to a Cloud DNS
zone (a whole-zone delegation, per the update above) — then the
`letsencrypt-dns01` issuer, the wildcard certificate, the
ingress-nginx `--default-ssl-certificate` flag, and only then
`REBASE_WILDCARD_TLS=true`. The order is enforced in
`k8s/wildcard-tls.ts`; doing it out of order serves every tenant a self-signed
certificate.

### Still to build

- **Wiring the shared pool into the deploy path.** The provisioning SQL, the
  cluster manifest and the network policy exist and are tested; what does not
  exist yet is the control-plane code that connects to a pool as superuser, runs
  the SQL, and hands the tenant its `DATABASE_URL`. That is the remaining work
  between "a shared tier is designed" and "a shared tier can be sold".
- **Wave 5, the serverless tier** (§4.5) and **Wave 6, static** (§4.6).
- **Metering** (§5), which the free tier needs before it opens to strangers.

---

## 12. What the second pass built, and what it found

Waves 3–5 completed, plus five defects that only surfaced by building and
running the thing.

### 12.1 Two gaps that would each have broken the shared tier on its first tenant

- **Tenant egress had no rule for `rebase-shared:5432`.** A shared tenant could
  not reach its own database: the connection matches no egress rule, is dropped,
  and the pod crashloops on a connect timeout with nothing naming the cause —
  the same failure the NetworkPolicy's own comments already describe for the
  managed bundle fetch.
- **`deployTenant` did not take the shared branch**; `deploy.ts` did. These are
  the two doors into the same stack, and the test written for it caught the
  drift on its first run.

### 12.2 `shared_preload_libraries` is not a parameter

Validating the generated pool manifests with `kubectl create --dry-run=server`
put them past the *live* CloudNativePG admission webhook, which rejected the
Cluster outright: `shared_preload_libraries` is a fixed setting CNPG composes
itself and it belongs in `postgresql.shared_preload_libraries`, not
`postgresql.parameters`. No unit test could have known — the rule exists only in
the webhook. The pool would have failed to create on its first attempt.

### 12.3 The shared pool leaked the estate through the maintenance databases

Covered in §10.4. Found by running the SQL for real, now closed and re-verified.

### 12.4 A reconciler needs to survive the shapes a real API server returns

Running the read-and-diff against the live cluster returned two shapes the unit
fixtures did not have: `spec.resources` is `{}` rather than absent (a truthiness
check reads that as "declared" and reports a clean fleet forever), and a live
Deployment carries an `ephemeral-storage` request Autopilot injected and we never
wrote (comparing whole objects would re-patch on every pass — a reconciler that
never converges is worse than one that never runs, because it rolls pods on a
schedule).

### 12.5 `pg` was a runtime import declared as a dev dependency

`functions/extensions.ts` imports it at module load; the production image runs
`pnpm install --prod`. It resolves today only because `--shamefully-hoist` hoists
it as somebody else's transitive dependency — the exact class of latent break
this repo has on record. Moved before a second runtime consumer relied on the
same accident.

### 12.6 The rules that carry the shared tier

Two invariants are worth knowing outside the code, because both fail silently:

**A tenant never changes pool.** Placement runs on every deploy. A tenant moved
to another pool gets a fresh empty database plus a `DATABASE_URL` pointing at it,
and `REBASE_MIGRATE_ON_BOOT=ensure` then creates the schema there — so the app
comes up *healthy*, serving nothing, while the customer's rows sit on the pool
nobody is looking at. Residency therefore beats capacity absolutely, and an
unreadable pool is treated as full **and** as possibly holding the tenant, never
as empty.

**A shared tenant's database outlives its namespace.** Deleting a dedicated
tenant deletes its namespace and the CNPG cluster goes with it; a shared tenant's
namespace holds nothing. `destroySharedTenantDatabase` runs on every project
deletion — not only for shared plans, because a project moved to a dedicated tier
still has a database on the pool and asking its plan would miss it.

### 12.7 Still to build

- **Applying the Cloud Run service.** The service body and the ingress routing
  are built and tested; the Admin API call, waiting for the revision and reading
  back the URL are not. The runtime also needs a boot-time bundle fetch, since
  Cloud Run has no init containers.
- **Static hosting on GCS** (§4.6). `substrate: "static"` is now reachable, and
  nothing serves it yet.
- **Metering** (§5), which the free tier needs before it opens to strangers.

---

## 13. Waves 6 and 7

### 13.1 Static hosting

A project whose apps are all static now resolves to `substrate: "static"` and is
served from a shared bucket at `sites/<projectId>/<deploymentId>/`. Nothing is
ever overwritten, so every previous deployment stays complete and rollback is one
control-plane write — no upload, no build, and no window where the site is half
of one version and half of another. (One flat prefix has that window on every
deploy: a visitor mid-upload gets the new `index.html` referencing a hashed
bundle that has not landed, sees a blank page, and nothing records it.)

Cost is storage only, about **$0.003/month** for a 50 MB site with three
deployments retained — against $3.28 for the cheapest pod that could serve it.

Three rules carry it, and each is the difference between a working site and a
confusing one: a trailing `/` resolves to `index.html` (object storage has no
directory index); an *extensionless* path may fall back to the app shell but one
naming a file must not (serving HTML where a script was expected gives a console
syntax error and a blank page, and nothing says the file is missing); and
`index.html` is never cached while content-hashed assets are cached forever.

### 13.2 Metering

Billing has had no usage input at all. That is fine while every plan is flat and
it is the thing standing between us and a €0 tier.

The runtime exposes **counters**, so usage is a difference between scrapes, and
the difficulty is that the thing being differenced restarts — and on Starter the
pod is preemptible by design, so that is most days rather than an edge case. The
rule throughout is **when in doubt, count less**: undercounting costs a little
revenue we could not prove we were owed, overcounting bills a customer for
traffic they did not send, which they will find and be right about.

Quotas carry an explicit policy per plan, never a default:

| Plan | Requests/month | Database | Storage | Past the line |
|---|---:|---:|---:|---|
| Hobby | 1M | 500 MB | 1 GB | **pauses** |
| Starter | 5M | 4 GB | 10 GB | billed, €1.50/M |
| Pro | 25M | — | 100 GB | billed, €1.00/M |
| Business | — | — | 500 GB | billed |
| legacy | — | — | — | unmetered |

A throttle sets Cloud Run's `maxScale` to zero — nothing is deleted, the database
is untouched, the URL still resolves, and coming back is one write. Expressed as
a ceiling rather than a `suspended` flag deliberately: the ceiling is a number
every deploy already writes, so a throttled project that redeploys stays
throttled and a new month releases it through the ordinary path. A flag would
need every deploy path to consult it, and the one that forgot would be the one
that let a throttled project serve again.

Warnings start at 80%, and that is what makes the throttle fair.

### 13.3 Everything in §12.7 and §13.3 is now built

- **Cloud Run** — `cloudrun/admin.ts` applies the service, waits for the revision
  and reads back the URL, and `provisionRebaseService`/`provisionIngress` route
  at it through an `ExternalName` Service.
- **The runtime fetches its own bundle** (`feat/runtime-bundle-fetch` in the OSS
  repo), which is what makes a container with no init container possible.
- **Static builds** upload to the bucket and the pointer moves last.
- **Metered Stripe prices** exist for the overage the quota model computes.

## 14. What the last pass found

**The suite was flaky, about one run in six, and had been before any of this
work.** `project-hooks.test.ts` drives the real orchestrator against an address
nothing listens on — deliberately — and each failure logs a full serialised
Error. Past some volume, node:test's IPC fails to deserialise a chunk and the
whole *file* is reported as `Unable to deserialize cloned data`, with every
subtest inside it having passed and the file passing when run alone. Fixed by
defaulting `LOG_LEVEL=error` in the test environment; 0 failures in 8 runs after,
reproduced on a clean HEAD before.

**A Service recreated on every deploy.** The first version of the
substrate-aware `provisionRebaseService` deleted and recreated unconditionally on
409 — a window with no Service behind the Ingress, on every deploy of every
tenant, to serve a migration that almost never happens. It is now conditional on
the type actually crossing the `ExternalName` boundary, where `clusterIP` being
immutable genuinely forces a delete.

**A pre-existing invariant that overage prices had to break.** "Every catalog
price is a whole number of cents" is correct *because* `unit_amount` is an
integer field — and a metered per-request price is €0.0000015, which has to reach
Stripe as `unit_amount_decimal`. Sending it as `unit_amount` would round it to
zero: a metered price that bills nothing forever and looks entirely correct in
the dashboard. The invariant is now scoped to flat prices, with its inverse added
for metered ones.

**Streaming a download into `tar` cannot be made safe.** A stream that dies
mid-transfer leaves `tar` having extracted a *prefix* of the archive and exiting
0 — a half-unpacked bundle that boots and fails much later, since missing
collections read as an empty schema and `REBASE_MIGRATE_ON_BOOT=ensure` then
creates nothing and reports success. The bundle fetch writes the whole tarball
first, which turns a truncated download into a corrupt archive, which is an
error.

## 15. Still not built

- **Wiring the Cloud Run and static paths into the deploy function.** Every
  piece exists and is tested; `runManagedDeployJob` still only knows the
  Kubernetes branch.
- **Reporting usage to Stripe.** `overageLines` and `matchUsageReports` compute
  what to send; the monthly close that sends it is not written.
- **A retention job** calling `pruneStaticDeployments`.
