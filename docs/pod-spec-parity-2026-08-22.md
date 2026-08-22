# One pod, two builders — what they disagreed on

Status: **audit + fix**, 2026-08-22. Branch `feat/shared-pod-spec`.
Scope: `charts/rebase`, `saas/backend/src/managed/deployment.ts`,
`saas/backend/src/k8s/orchestrator.ts`, `packages/server/src/deploy`.

Follows [independent-deployment-audit-2026-08-18.md](independent-deployment-audit-2026-08-18.md),
which closed G1 and left G8 ("one pure builder") open. This is the answer to G8,
arrived at by rendering both builders rather than by reading them.

---

## 0. The one-paragraph answer

Two things put this runtime in a pod: the Helm chart, for self-hosting, and
`buildManagedContainer`, for cloud tenants. Rendered for the same unit and
diffed, they disagreed in **four** places that are not deployment preferences at
all — they are claims about how this process behaves — and in three of them the
chart was doing the thing the runtime's own source, and the published
self-hosting guide, warn against. The fourth was the reverse: the cloud was
missing something the chart had.

Nobody had rendered them side by side before. That is the whole finding. The fix
is a contract in the runtime (`packages/server/src/deploy/pod-contract.ts`) that
the cloud imports and the chart is gated against, because the chart cannot
import TypeScript.

**Not** merged: how each side assembles the rest of the manifest. Those
differences are correct and are listed in §3.

---

## 1. What differed

Rendered from `helm template` and `buildManagedDeployment` for the same logical
unit (`bundle.mode=url`, one process, port 8080).

| Field | Chart, before | Cloud, before | Verdict |
|---|---|---|---|
| `livenessProbe.path` | `/health` | `/livez` | **Chart wrong** — fixed |
| `startupProbe.path` | `/health` | *(no startup probe)* | **Both wrong** — fixed |
| `startupProbe` presence | present | **absent** | **Cloud wrong** — fixed |
| `lifecycle.preStop` | **absent** | `sleep 5` | **Chart wrong** — fixed |
| topology vars via operator/tenant env | **settable** | pinned | **Chart wrong** — now refused |
| `readinessProbe.path` | `/health` | `/health` | agreed, and correct |
| probe *timings* | slower | tighter | legitimately different |
| `name`, `resources`, `securityContext`, `envFrom`, `ports`, scheduling | differ | differ | legitimately different (§3) |

### 1.1 Liveness on `/health` restarts a healthy pod

`/health` opens the default driver and every configured secondary and **answers
503** when any is unreachable (`boot.ts`, the `healthPaths` handler). `/livez`
answers `{status:"ok"}` and touches nothing.

Liveness *restarts the container*. The chart put it on `/health` with
`periodSeconds: 20, failureThreshold: 3`, so a database outage lasting more than
about a minute restarted every self-hosted pod, kept restarting them until the
database returned, and left logs that read like an application crash.

This is not a subtle call. The runtime says so at the point it registers the
route:

> `/health` touches the database, so a database blip would make an orchestrator
> kill an otherwise healthy process. `/livez` answers "is this process running",
> which is the question a liveness probe is actually asking.

And the published guide says so too — `deployment/self-hosting.md`, "Health
checks": *point liveness probes at `/livez`; a liveness probe on `/health`
restarts a perfectly healthy process during a brief database hiccup.* The docs
were right, the runtime was right, the cloud was right, and the chart — the
thing an operator actually installs — shipped the opposite. Another instance of
[[skills-drifted-while-docs-stayed-right]]: bet on the doc page.

### 1.2 Startup on `/health` is worse, because it never resolves

The startup probe gates when liveness and readiness begin. On `/health` with a
300s budget, a database that is slow or cold does not delay startup — it
*prevents* it. The pod never passes, liveness never runs, and the pod CrashLoops
with nothing in its output about a database.

### 1.3 The cloud had no startup probe at all, and boots behind one

`runFromBundle` binds its socket **last** — after the bundle is read, the drivers
connect and, on a provisioning role, the schema DDL runs ("schema DDL happens
during boot, above"). So the gap between container start and the first answer is
a whole provisioning run.

With no startup probe, *liveness* measures that gap. On the control plane's
numbers that is 20s grace plus three 20s failures — **80 seconds** — after which
a slow first boot is killed and retried from the beginning, re-running the init
container's `npm install` each time. It does not converge.

Fixed by giving the managed container the same 300s budget the chart already had.
A healthy pod passes on its first check and spends nothing.

### 1.4 The chart had no preStop drain

Kubelet sends SIGTERM and removes the pod from its Service **concurrently**. The
runtime drains on SIGTERM and finishes what is in flight, but cannot stop new
requests arriving while endpoint removal propagates. The cloud added a 5s
`preStop` sleep after observing exactly this on a tenant serving a custom domain
during the 2026-07-22 rollout (`orchestrator.ts`, `TENANT_PRESTOP_DRAIN_SECONDS`).
The chart never got it. Self-hosted rollouts dropped requests for the same
reason, with no incident to name because nobody was watching.

### 1.5 `config.env` could set the topology, and the chart said it could not

values.yaml claimed: *"Topology variables set here are ignored: the chart owns
them."* Rendered, it is half true and the wrong half is the default:

- `split: true` — the chart writes `REBASE_ROLE` **after** the operator's entry,
  Kubernetes takes the last duplicate, the operator's is ignored. As documented.
- `split: false`, **the default** — the chart writes no `REBASE_ROLE` at all, so
  the operator's is the only one. It takes effect.

`REBASE_ROLE=worker` on the single pod yields a deployment that serves no HTTP.
Both probe endpoints answer on every role, so startup, liveness and readiness all
pass, the rollout reports success, and every request 404s. This is the same
failure the cloud shipped and then fixed by pinning
([[runtime-roles-split-processes]], "K8s `env` shadows `envFrom` only for names
it LISTS").

Now a refusal, not a filter — the chart's own idiom, and it names the value.

---

## 2. The fix, and why it is shaped this way

`packages/server/src/deploy/pod-contract.ts`. What goes in it is anything that is
really a statement about **this process**: which endpoint answers what, which
variables decide topology, where the bundle mounts, how long a first boot may
take. Those are facts about the runtime, so they live in the runtime.

- **The cloud conforms by construction** — `deployment.ts` and `orchestrator.ts`
  import it. `saas/backend` already imported `@rebasepro/server` for `logger`, so
  this adds no dependency.
- **The chart conforms by gate** — Helm cannot import TypeScript, so
  `scripts/check-chart.mjs` reads the contract as text and asserts the rendered
  chart against it: probe paths on *every* unit, the preStop drain, and both
  directions of the topology-variable list. It fails rather than passing empty if
  the contract stops parsing, because a parity check that silently matches
  nothing is worse than no check.

**Helm was considered for the control plane and rejected** — that question is
what started this. The chart covers a fraction of what the orchestrator manages
(no CNPG clusters, poolers, ResourceQuota, PDB, wildcard TLS, custom domains,
Kaniko builds, backup CronJobs), the reconciler patches per-field on purpose
because a whole-object apply clobbers fields owned by an autoscaler, CNPG or a
human mid-incident (`reconciler.ts`, "Why the changes are applied one at a
time"), and the control-plane image ships neither `helm` nor `kubectl`. Sharing
the *pod contract* gets the parity that was actually wanted; sharing the *deploy
mechanism* would trade away the reconciler behaviour that exists because it was
paid for.

---

## 3. What deliberately still differs

Listed so the next person does not read them as drift:

| Field | Why |
|---|---|
| `envFrom` / explicit `secretKeyRef` | A managed pod takes tenant environment from a Secret it does not read; a self-hosted one takes it from values or `existingSecret`. |
| `name` (`rebase` vs `rebase-backend`) | The reconciler finds the container by name in namespaces that predate the chart. Renaming either is a rollout, for nothing. |
| `resources` | Billed tier vs operator's choice. |
| `securityContext` | Autopilot constrains the managed one; the chart's is the operator's to set. |
| scheduling (`nodeSelector`/`tolerations`) | Spot capacity a plan sold vs wherever the operator's nodes are. |
| bundle delivery | Init container + `npm install` (cloud) vs `REBASE_BUNDLE_URL` self-fetch (chart) vs baked image. **Three mechanisms** — see §4. |
| probe timings | Same endpoints, different patience. A self-hosted VM and an Autopilot pod are not the same machine. |

---

## 4. Still open

1. **Bundle delivery is three mechanisms.** Baked image; runtime self-fetch
   (`fetch-bundle.ts`, written for Cloud Run, used by `bundle.mode=url`); init
   container that downloads *and* `npm install`s (`buildBundleInitContainer`,
   with the 6Gi ephemeral limit and the documented silent `epoll_wait` hang).
   Collapsing to one is worth doing and is **not** a rename: the init container
   installs dependencies and the self-fetch does not, so unifying means moving
   that install into the fetch path or into the bundle build. That is the next
   piece of real work, and it would delete the failure mode that is hardest to
   diagnose in the whole managed path.

2. **`charts/rebase/values.yaml` describes the init container it does not have.**
   `mode: url` is documented as "an init container fetching a tarball at every
   pod start". There is no init container in the chart; the runtime fetches for
   itself. Fixed in this branch, noted here because it is the tell — the comment
   was written from the cloud's mechanism while the template implemented the
   other one, which is exactly the drift this document is about.

3. **`terminationGracePeriodSeconds` is unset on both sides.** Default 30s, and
   preStop 5s + a 15s drain fits. It stops fitting the moment anyone raises the
   drain, and nothing would say so. `RUNTIME_MIN_TERMINATION_GRACE_SECONDS`
   records the floor; neither side reads it yet.

4. **G6 is still undecided** — `rebase cloud deploy` folds the frontend into the
   backend bundle by default while intake also accepts a standalone
   `kind: static`. Untouched here; it is a decision, not a defect.
