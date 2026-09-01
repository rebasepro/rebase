# Deployment, placement and separability — audit

Status: **audit**, 2026-08-17. No code changed.
Scope: everything that decides *where a project's parts run and how they get there* —
`packages/server` boot/roles/surfaces, `packages/cli` build & cloud deploy, the whole
`saas/backend/src/{k8s,managed,static,cloudrun,metering}` estate, `saas/infra`, `docker/`,
and the deployment docs.

Read this before starting any work on independent services, Helm, or bring-your-own-cluster.
The headline is not "here is what to build". It is:

> **The end state is already designed and roughly half-built, in modules that do not call
> each other. The risk is not missing code — it is building a second copy of code that
> already exists.**

Five subsystems are complete, tested, and reachable from nothing. They are not stray dead
code: together they are waves 4–7 of
the tenancy and cost plan (moved to the private control-plane repo), each built in
isolation and never wired to the others.

---

## 0. The one-paragraph answer

Independent services do not need a new architecture. They need (a) the existing
`REBASE_ROLE` split to be reachable from the platform, which is one argument to a function
that already takes it; (b) one of the two existing static-hosting implementations to be
chosen and wired; (c) the front door from §4.4 of the tenancy plan, without which none of
the other substrates are routable. Helm is the right call for self-hosting and for the
tenant-facing manifests, but it collides head-on with the reconciler's deliberate
per-field patching discipline, and that collision has to be resolved explicitly
(§7) rather than discovered.

---

## 1. Inventory — what exists, and whether anything reaches it

| Module | What it does | Reachable? |
|---|---|---|
| [`packages/server/src/boot/role.ts`](../packages/server/src/boot/role.ts) | `REBASE_ROLE=all\|api\|functions\|worker` → surfaces + owned singletons | **Yes**, self-host only |
| [`packages/server/src/init/surfaces.ts`](../packages/server/src/init/surfaces.ts) | 7 mountable surfaces × 3 ownership flags | Yes |
| `bootStaticApp` ([`boot.ts:158`](../packages/server/src/boot/boot.ts:158)) | serves N static apps by path, no DB, no JWT | Yes |
| [`saas/.../utils/tenant-topology.ts`](../saas/backend/src/utils/tenant-topology.ts) | **pure** plan → `TenantTopology` (compute/db/storage) | Yes (`orchestrator.ts:668`) |
| [`saas/.../k8s/topology-diff.ts`](../saas/backend/src/k8s/topology-diff.ts) | **pure** desired vs live → `TopologyChange[]` + impact | Yes |
| [`saas/.../k8s/reconciler.ts`](../saas/backend/src/k8s/reconciler.ts) | reads a namespace, applies approved changes | Yes |
| [`saas/.../managed/deployment.ts`](../saas/backend/src/managed/deployment.ts) | **pure** `buildManagedDeployment` + `pinnedRuntimeEnv(role)` | Yes |
| [`saas/.../k8s/resolve.ts`](../saas/backend/src/k8s/resolve.ts) | project → which cluster drives it (kubeconfig / GCP WIF / Hetzner token) | Yes |
| [`saas/.../k8s/baseline.ts`](../saas/backend/src/k8s/baseline.ts) | installs ingress-nginx + cert-manager + CNPG onto a new cluster | Yes |
| [`saas/.../k8s/external-backend.ts`](../saas/backend/src/k8s/external-backend.ts) | `ExternalName` Service so a tenant URL can front anything | **Wired, never exercised** |
| [`saas/.../k8s/wildcard-tls.ts`](../saas/backend/src/k8s/wildcard-tls.ts) | `*.apps.<base>` certificate handling | **Gated off** (`REBASE_WILDCARD_TLS`) |
| [`saas/.../static/hosting.ts`](../saas/backend/src/static/hosting.ts) + `publish.ts` | bucket-hosted static sites, immutable prefixes, free rollback | **Tests only** |
| [`saas/.../cloudrun/service.ts`](../saas/backend/src/cloudrun/service.ts) | `buildCloudRunService` for `substrate: "cloudrun"` | **Tests only** |
| [`saas/.../metering/enforcement.ts`](../saas/backend/src/metering/enforcement.ts) | quota → Cloud Run `maxScale` ceiling | **Tests only** (says so at line 46) |
| the front-door router (§4.4 of the plan) | `Host` → destination table | **Does not exist** |
| Helm / kustomize, anywhere in the repo | — | **Does not exist** |

`saas/backend/manifests/` (2 MB of vendored cert-manager, CNPG, ingress-nginx) is the
closest thing to a chart, applied create-then-tolerate-409. It provisions *clusters*, not
tenants.

---

## 2. The five built-but-unreachable subsystems

Listed together because they share one cause: each was built against an assumed end state
that includes the other four.

1. **Cloud Run substrate.** `PLANS.hobby` declares `substrate: "cloudrun"` and is returned
   by `sellablePlans()`. `buildCloudRunService` is pure and has no caller.
   [`topology-diff.ts:156`](../saas/backend/src/k8s/topology-diff.ts:156) explicitly
   refuses to treat a non-`k8s-pod` substrate as a patch: *"Migrating substrates needs a
   routing change, not a patch."* → **the plan ladder currently sells a substrate with no
   deploy path.**
2. **Static hosting (cloud).** `static/hosting.ts` names its purpose precisely — *"the
   right home for the admin panel, marketing pages, docs sites"* — with immutable
   `<projectId>/<deploymentId>/` prefixes and rollback by repointing. Consumed by its own
   tests only, and
   [`deploy-plan.ts:126`](../saas/backend/src/managed/deploy-plan.ts:126) rejects the
   bundle at intake: *"the platform does not host static apps yet."*
3. **External backends.** `BackendTarget` supports `external-https`, `provisionRebaseService`
   and `provisionIngress` both accept it, and every call site passes the `in-cluster`
   default. The capability is complete and has never run.
4. **Quota enforcement.** `maxScaleFor` needs a caller *on a Cloud Run provisioning path*
   and a front door to return the 429. Both are items 1 and 5.
5. **Wildcard TLS.** Built, correct, and off — the half of §4.4 that shipped without the
   router half.

**Consequence for planning:** four of the five unblock in one move — the front door. That
is why the plan puts it at Wave 4, *before* the serverless and static tiers, and that
ordering is still right.

---

## 3. Overlaps — where two things already do one job

This is the part the audit was asked for.

### O1 — Two homes for the word "topology" (resolved, do not reopen)

`TenantTopology` is plan-derived, server-side, pure. An earlier idea in this conversation
was a `topology` block in the tenant's `rebase.json`. **That would have been a second
definition of the same word**, on the wrong side of the trust boundary, and it repeats the
`mode` failure catalogued in
[apps-and-runtimes.md §2.1](../apps-and-runtimes.md). Decision: topology stays derived and
platform-side. Nothing tenant-authored.

Minor drift worth fixing while nearby: the plan's §4.1 lists a `k8s-shared-pool`
substrate; the implemented `ComputeSubstrate` is `k8s-pod | cloudrun | static`.

### O2 — Two deployment-manifest builders

- **managed:** `buildManagedDeployment(input)` — pure, one place, called at
  `orchestrator.ts:1809`. This is the good shape.
- **custom:** built inline inside `provisionRebaseDeployment` (~`orchestrator.ts:1367–1640`),
  restating the whole pod template on *both* the create and the patch branch.

`orchestrator.ts` is **4,029 lines**, and its own comments document create-path/patch-path
divergence as a recurring bug class. Adding units (functions, worker, admin) by extending
the inline path is how that class reproduces at 4× the surface.

**Rule to adopt: no third builder.** Every new unit goes through a pure
`build*(input) → manifest` function, and the custom path is migrated onto one.

### O3 — Two static-hosting implementations, neither reachable

| | OSS runtime | Cloud |
|---|---|---|
| Mechanism | `bootStaticApp` serves the bundle from a pod | bucket prefix + rewriting router |
| Cost | one pod (Autopilot floor) | ~$0.02/GiB-mo |
| Rollback | redeploy | repoint a prefix |
| State | works today | tests only, refused at intake |

**These imply different answers to "deploy the admin panel independently."** Both are
legitimate; they are not both worth maintaining as tenant-facing paths.

Recommendation: **bucket for cloud, pod for self-host.** The self-hoster already has the
runtime image and does not want a bucket dependency; the platform already has the bucket
code and should not pay a pod floor to serve files. `apps.type === "static"` is the same
declaration either way, so the tenant's `rebase.json` does not change — which is exactly
the property `external-backend.ts` was written to preserve.

### O4 — Two "where does traffic go" mechanisms

Per-tenant `Ingress` with a single `path: "/"` rule
([`orchestrator.ts:2256`](../saas/backend/src/k8s/orchestrator.ts:2256)) versus the planned
front-door router. The existing Ingress cannot express per-path fan-out to different
services without becoming a per-tenant routing table — which is what the front door is.

Two hard limits already documented in §4.4 and still live: Let's Encrypt's **50
certs/registered-domain/week** caps onboarding at ~50 tenants/week regardless of cost, and
nginx reloads on every tenant Ingress change.

**So: `/admin` and `/api/functions/x` fan-out should land on the front door, not on the
per-tenant Ingress.** My earlier suggestion to add path rules to `provisionIngress` was
the cheap version of the wrong thing — it would build a third routing mechanism a month
before the second one replaces it.

### O5 — Two reconciliation philosophies, and they genuinely conflict

`reconciler.ts` is explicit: *"A reconciler that computed a whole desired object and
applied it in one write would also overwrite every field nobody asked it to touch —
including fields set by an autoscaler, by CloudNativePG's own controller, or by a human
mid-incident."* Hence one patch per approved change, and the hand-rolled
`delete patchSpec.replicas` at `orchestrator.ts:1826` (*"a runtime rollout that stomped
every managed pod back to 1 replica would be an outage disguised as an upgrade"*).

A Helm chart, and any `render(topology) → apply` design, is whole-object by nature. **This
is the one real architectural conflict in the whole direction**, and it is resolvable but
not by ignoring it:

- **Server-side apply with field managers** is the Kubernetes-native answer to exactly this
  problem: our manager owns only the fields we set, HPA keeps `replicas`, CNPG keeps its
  own. It replaces the hand-rolled discipline with a mechanism, and it is standard, not
  custom — which matches the "favor Helm or similar" constraint.
- **Split ownership by object.** Objects no other controller writes (Service, Ingress,
  ConfigMap, NetworkPolicy, the tenant Secret) are safe to apply wholesale. Objects a
  controller co-owns (Deployment, CNPG `Cluster`, `Pooler`) keep the diff-and-approve path.

Note that Helm 3's own three-way merge has a weaker version of this problem, so "use Helm"
does not dissolve it. Decide it before writing templates.

### O6 — The role split is one argument away, and pinned shut

`pinnedRuntimeEnv(role)` already takes a role and emits the six variables plus the
`REBASE_MIGRATE_ON_BOOT=none` rule for non-provisioning roles. Its own comment says why it
takes an argument nobody passes: *"Every managed pod is `all` today, and this takes a role
anyway so that building a second one is a call with an argument rather than a fresh
hand-written list."*

**This is the cheapest real win available.** The runtime work shipped; the platform work is
a second Deployment through a pure builder.

### O7 — Crons need no new unit (but the cloud cannot express them)

Two axes already exist and are documented: *surfaces* (which URLs answer) versus
*ownership* (which timers fire). Separating scheduled work from job execution is two
`worker` pods with opposite `REBASE_CRON_SCHEDULER` / `REBASE_JOB_WORKERS`. No fifth role,
no new code.

Caveat: `pinnedRuntimeEnv` neutralises both variables on every managed pod, so **on the
cloud this is currently inexpressible** — correctly, since the platform owns topology, but
it means "separate crons" is a platform feature to add, not a tenant setting to document.

### O8 — Self-hosting has no Kubernetes story at all

Eight deployment guides — `aws, azure, flyio, gcp, hetzner, railway, scaleway,
self-hosting`, plus `split-processes` — and **not one mentions Kubernetes or Helm.**
Self-hosting is compose-only today. This is the clearest greenfield in the audit: a chart
overlaps nothing.

### O9 — Shared-state gaps that gate every split

| Concern | Implementations | Status |
|---|---|---|
| Channel bus | `PostgresChannelBus` | exists, **opt-in**, warns only on evidence of a peer |
| Rate-limit store | `MemoryRateLimitStore` **only** | **real gap** — every unit gets its own budget |

The rate-limit store is the single missing runtime piece for any multi-process deployment,
self-hosted or managed, and it is invisible until someone measures a limit that lets 3× the
traffic through.

---

## 4. Separability, per the parts you named

| Part | Separable today? | What blocks it |
|---|---|---|
| **Backend core** (`api`) | Yes, self-host | — |
| **Functions** | Yes, self-host (`REBASE_ROLE=functions`, name selection, api-side proxy) | Cloud: `pinnedRuntimeEnv` pins `all`. Per-function granularity is groups-on-`defineFunction`, unbuilt by design (Phase 2) |
| **Crons** | Yes, via ownership flags | Cloud: pinned off (O7) |
| **Job workers** | Yes, same | Cloud: pinned off |
| **Admin panel** | Yes as a `static` app in OSS | Cloud: refused at intake; two competing hosting impls (O3) |
| **User apps** | Same as admin — it is the same mechanism | Same |
| **Database** | Yes: `byodb`, shared pool, dedicated | — |
| **Storage** | Yes: shared prefix / dedicated bucket, multi-source | — |

Worth stating plainly: the admin panel and a customer's marketing site are **the same kind
of thing** to this system (`type: "static"`), and always should be. Nothing in the audit
suggests special-casing the admin.

---

## 5. BYOC — what is already there

`plan: "byo"` exists and is sellable: *"Bring your own cluster. Runs on infrastructure you
own. We provide the control plane."* With `database: { mode: "byodb" }` and
`billedAs: "customer"` — the only `byo`-aware line in the codebase.

Mechanically, `resolve.ts` already drives **any registered cluster on any provider**
(`kubeconfig`, `gcp-wif`, `hetzner-token`), with a refusal rather than a silent fallback
when resolution fails. Hetzner k3s is a first-class target with terraform and
`bootstrap-k3s.sh`.

So BYOC is ~70% built in the **push** direction: we hold the customer's credentials and
call their API. Two decisions are unmade:

1. **Push or pull.** Holding customer cluster credentials is the thing enterprises refuse
   and the thing that makes a control-plane compromise a fleet-wide compromise. The pull
   alternative — an agent in their cluster that fetches desired state — is unusually cheap
   here *because `tenant-topology.ts` is already the pure desired-state producer and
   `topology-diff.ts` is already the differ*. It is an inversion of who calls the API, not
   a rewrite. It also interacts with O5: an agent applying a document is whole-object by
   nature.
2. **Secrets must stop flowing outward.** `provisionRebaseDeployment` writes Secrets with
   values the control plane holds. BYOC requires reference-by-name and local
   materialisation. `mode: "byodb"` already points this way.

Two consequences to plan for, not solve now: **version skew** becomes a fifth contract axis
(their data plane will run an image we did not roll — and `minimumFrameworkVersion` is NULL
everywhere), and **pod count stops being the billing unit** on a tier where the pods are
theirs.

---

## 6. Contradictions and decisions needed

| # | Question | Why it must be answered first |
|---|---|---|
| D1 | Front door before or after per-unit fan-out? | Adding path rules to `provisionIngress` builds a third routing mechanism that §4.4 then replaces |
| D2 | Bucket or pod for cloud static apps? | Two complete implementations; maintaining both is the actual cost |
| D3 | Whole-object apply (SSA) or per-change patches? | O5. Helm templates cannot be written until this is settled |
| D4 | Push or pull for BYOC? | Decides whether the desired-state document becomes a public contract |
| D5 | Does `hobby` keep selling Cloud Run? | It currently sells a substrate with no deploy path |
| D6 | Who owns per-unit scale — plan, HPA, or the tenant? | `replicas` is already deliberately unowned on patch |

---

## 7. On Helm specifically

A chart is the right call, with three caveats the audit surfaced:

1. **It does not overlap self-hosting — it creates it** (O8). Highest-value, lowest-risk
   piece of the whole direction.
2. **It cannot simply replace the orchestrator.** The orchestrator does things a chart
   cannot: per-project cluster resolution, Kaniko builds, CNPG lifecycle with maintenance
   windows, PITR repointing, fleet rollout in waves. A chart is the *tenant workload*
   templates; the orchestrator remains the thing that decides and sequences.
3. **Sharing templates between self-host and platform is the prize, and D3 is its price.**
   If both render the same templates, the platform's apply strategy has to become
   whole-object for at least the controller-free objects.

The realistic split: chart templates for Deployment/Service/Ingress/NetworkPolicy/Job
(stateless, controller-free, identical in both worlds), and keep CNPG and anything with a
maintenance window on the existing diff-and-approve path.

---

## 8. Recommended order, deduplicated against the tenancy plan

Numbered against the plan's waves so nothing gets built twice.

| Step | Work | Relation to the plan |
|---|---|---|
| 1 | **Publish the runtime image** to a public registry | prerequisite for everything, including self-host; currently on no registry at any tag |
| 2 | **Shared rate-limit store** | O9; unblocks any split anywhere |
| 3 | **Helm chart for the self-host split** (api / functions / worker / static, migration Job) | new; overlaps nothing (O8) |
| 4 | **Front door** — wildcard cert (built) + Host→destination router | plan **Wave 4**; unblocks 4 of the 5 dead subsystems |
| 5 | **Decide D2, wire one static path** → admin and user apps deploy independently | plan **Wave 6** |
| 6 | **Second managed unit via `pinnedRuntimeEnv(role)`** → functions/worker pods | O6; not in the plan, cheaper than anything in it |
| 7 | **Decide D3, migrate the custom path onto a pure builder** | shrinks `orchestrator.ts`; precondition for shared templates |
| 8 | **Cloud Run substrate** or drop it from the ladder (D5) | plan **Wave 5** |
| 9 | **BYOC pull agent** (D4) | not in the plan; `plan: "byo"` stops being a label |

Steps 1–3 are worth doing even if the cloud direction changes entirely, which is the test
of whether the ordering is right.

---

## 9. Method, and what this audit did not cover

Read directly: `boot/role.ts`, `init/surfaces.ts`, `boot/boot.ts`, `serve-spa.ts`,
`infra/docker/docker-compose.selfhost.yml`, `MODULAR-ARCHITECTURE.md`,
`docs/runtime-roles-plan-2026-08.md`, `docs/apps-and-runtimes.md`,
the tenancy and cost plan (private), and in `saas/backend/src`: `utils/tenant-topology.ts`,
`k8s/{orchestrator,resolve,client,baseline,external-backend,reconciler,topology-diff,wildcard-tls}.ts`,
`managed/{deployment,deploy-plan,apps-registry,rollout}.ts`, `static/{hosting,publish}.ts`,
`cloudrun/service.ts`, `metering/enforcement.ts`. Reachability was established by grepping
for non-test importers, not by running anything.

Not covered, and worth a second pass before implementation:

- **Networking policy per unit.** Splitting units changes what may talk to what; the
  existing tenant NetworkPolicies were written for one pod.
- **`saas/infra/hetzner` currency.** `bootstrap-k3s.sh` uses a hardcoded `~/.ssh/id_rsa`
  and k3sup; whether it still runs against current Hetzner and k3s is untested here.
- **Observability across units.** Logs and metrics are per-pod today; four units per
  project multiplies what the console must aggregate.
- **Cold-start cost of a functions unit.** A functions process still boots data sources,
  auth and collections, and normally loads two copies of `@rebasepro/server`. Nobody has
  measured `bootFromBundle`, and scale-to-zero claims depend on it.
