# One pod, two builders — what they disagreed on

Status: **audit + fix**, 2026-08-22. Branch `feat/shared-pod-spec`.
Scope: `infra/charts/rebase`, `saas/backend/src/managed/deployment.ts`,
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

1. ~~**Bundle delivery is three mechanisms.**~~ **DONE** — see §5. Collapsing
   them turned up the reason there were ever two: the runtime's own fetch path
   had never worked.

2. **`infra/charts/rebase/values.yaml` describes the init container it does not have.**
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


---

## 5. Bundle delivery, unified (2026-08-22, `feat/unify-bundle-delivery`)

### 5.1 The reason there were two implementations

`fetchBundle` looked for a marker file called **`rebase-bundle.json`** to decide
whether what it unpacked was a bundle. Nothing has ever written that file. The
CLI writes `manifest.json` (`bundle.ts`), `loadBundle` reads `manifest.json`, and
the only thing in the repository that ever produced `rebase-bundle.json` was the
fixture in `fetch-bundle.test.ts`, which wrote the marker it then asserted on.

So every real bundle was rejected with *"It is not a Rebase bundle, or it was
truncated"* — a message that blames the bundle for the reader's mistake. Proven
by building a tarball from `rebase build`'s actual output shape and running
`fetchBundle` against it: it threw. The name was introduced in the commit that
added the feature (`b17249b69`), so `REBASE_BUNDLE_URL` had never worked, on any
platform, since the day it shipped.

Everything downstream follows from that:

- `saas/backend/src/cloudrun/service.ts` sets `REBASE_BUNDLE_URL`. **The Cloud
  Run substrate could not have worked.** It is listed as "open" in the
  2026-08-18 audit's step 8; this is why.
- The chart's `bundle.mode: url` could not have worked either.
- Kubernetes grew an init container that did the same three jobs in shell,
  because the supported path did not function.

A fixture that invents its own subject can only ever agree with itself. That is
the class, and it is worth a sweep: `docs/bug-classes.md`.

### 5.2 What the unification changed

The runtime's fetch now does everything the init container did — and the init
container is deleted (146 lines of embedded shell and a heredoc'd Node script).

| | Before | After |
|---|---|---|
| Marker | `rebase-bundle.json` (fictional) | `MANIFEST_FILENAME`, imported from the loader |
| Download | `await response.arrayBuffer()` — a ~100MB bundle in RSS at boot | streamed to disk |
| Retries | none (init container had 6) | 6, with backoff, and **no retry on 4xx** |
| Install | never | `npm ci`/`install`, `--omit=dev --ignore-scripts`, cache dropped |
| Where it unpacks | a fresh temp dir | `REBASE_BUNDLE_FETCH_DIR` when set — fixed, so a container restart inside a live pod reuses the tree |
| Diagnosis on ENOSPC | silence | a logged error naming the volume |

Verified end to end against real tarballs and a real `npm`, not a stub: with a
lockfile it runs `npm ci`, without one `npm install`, `node_modules` lands in
the bundle root, and the archive is cleaned up.

### 5.3 What this trade gives up, honestly

Kubernetes has no per-phase resources. An init container is how you size
boot-time work separately from steady-state serving, and that is now gone: the
install runs under the tier's memory limit.

The init container's own comment had already called this: its 2Gi floored every
managed pod at 2Gi fleet-wide "whatever its dials said", and it named the fix as
*"move that install out of the init path, not shave this number."* So the floor
lifting is the intended outcome, and given
[[saas-unit-economics]] it is a cost win.

The ephemeral storage did **not** go away — that is the resource the incident was
actually about, and it moved onto the app container with the work
(`withBundleStorage` merges it into the tier's block rather than replacing it).

### 5.4 The memory question, measured

`node:22-slim` under cgroup v2, `npm install --omit=dev --ignore-scripts`, peak
read from `memory.peak` after the run:

| bundle | packages | tree | peak @2Gi | peak @512Mi | peak @256Mi | @128Mi |
|---|---|---|---|---|---|---|
| real (`dist-bundle-acceptance`) | 35 | 23 MiB | 608 MiB | 86 MiB | — | — |
| heavy (14 deps incl. googleapis) | 156 | 289 MiB | 681 MiB | 196 MiB | 198 MiB | **OOMKill** |
| pathological (25 deps, a frontend's worth) | 458 | 591 MiB | 294 MiB | — | — | — |

**The 2Gi column is the misleading one.** npm's peak scales with what it is
given — V8 sizes its heap from the cgroup limit — so measuring at the limit
measures generosity, not requirement. The same install that peaks at 608 MiB
with 2Gi available completes having peaked at 86 MiB with 512Mi available. The
real number is the one that stops moving under pressure: **~200 MiB**, with the
floor between 128Mi and 256Mi.

**The smallest tier's memory limit is 2Gi and cannot be dialled lower.**
`DEFAULT_DIALS.compute` is `res("250m", "512Mi", "2", "2Gi")`, and
`dialledResources` derives limits as request × the burst ratio it started with
(4), over a request floored at `AUTOPILOT_POD_FLOOR`'s 512Mi. So the minimum
limit any tenant can reach is 512Mi × 4 = 2Gi.

So: **~10x headroom, at every tier that exists.** The concern is closed, and the
init container's 2Gi turns out to have been buying nothing the app container did
not already have. Even the *request* — 512Mi, the number that governs eviction
under node pressure rather than OOMKill — sits above the measured requirement.

Disk behaved as the incident described: the pathological bundle peaked at
**724 MiB** across the extracted tree and npm's cache together. That is 12% of
the 6Gi reservation, and 72% of the 1Gi Autopilot grants when it is unset —
which is what made a slightly larger project fail, silently.

### 5.5 What the measurement found that was not the question

At 128Mi the heavy install is OOMKilled, and it leaves `node_modules` holding
**124 of its 156 packages**. A directory check cannot tell that from a finished
install — and `installBundleDependencies` skipped when `node_modules` existed,
as did the init container's `[ ! -d node_modules ]` before it, over a volume
that also survives a container restart.

So the sequence was: install killed → container restarts → tree looks present →
install skipped → the runtime boots against a bundle missing a third of its
dependencies, and fails as an import error deep inside a request.

Fixed by deleting what a failed install wrote, which is what makes the skip
sound. A vendored tree is still left alone. Both directions are tested, and the
cleanup is mutation-tested.
