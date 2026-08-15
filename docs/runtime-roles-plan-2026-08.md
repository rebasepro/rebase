# Runtime roles: running functions in their own process

Status: **implemented** — 2026-08-15, on `claude/rebase-cloud-functions-dac59a`.
Scope: `packages/server`, `packages/server-postgres`, `docker/`,
`website/src/content/docs`.

All seven steps in §4 landed. Two decisions changed while building, and both are
recorded where they matter rather than only here — a plan that still describes a
refusal the code does not have is worse than no plan:

- **§3.5 refusal 2 (the channel bus) was dropped.** A role split does not create
  the problem: only the API-serving roles have websocket clients, so what makes
  the in-memory bus matter is the *replica count* of that process — equally true
  of a single `all` deployment scaled to three, and not readable from a process's
  own environment. The runtime already answers it from evidence
  (`warnIfMemoryBusOnMultiplePods` fires on a notification actually seen from a
  peer). The reasoning is in `packages/server/src/boot/role.ts`.
- **§3.1's role enum lives in `packages/server`, not `packages/types`.** It is
  read from the environment by the runtime and by nothing else; putting it in the
  shared contract package would have implied a contract that does not exist.

Everything else shipped as specified. §5 gained four traps found while building —
the last three are all about test harnesses claiming to prove something they
structurally cannot.

This is Phase 1 of making custom functions independently deployable. It is
deliberately the smallest change that delivers a real capability on its own:
**one image and one bundle can be booted as several cooperating processes, each
serving a different part of the project.** A heavy function stops competing with
the data API for the event loop, and it can be restarted, scaled and rolled
without touching the API.

It ships self-hosted first and unaided. Nothing here requires Rebase Cloud, a
control plane, or a Kubernetes cluster — a `docker compose up --scale` is the
whole story. Phase 2+ (per-function declared resources, scale-to-zero,
per-function autoscaling and metering) is control-plane work that builds on this
and is out of scope; see §6.

Related reading: [apps-and-runtimes.md](apps-and-runtimes.md) for the
bundle/runtime split this sits on top of, and
`website/src/content/docs/docs/architecture/runtime-and-bundles.md` for the
published version of the same.

---

## 0. How to use this document

- **§1** is the problem and what the codebase already gives us. Read once.
- **§2** is the decisions. Read once.
- **§3** is the specification. It is **normative**: where it names an exact type,
  env var or behaviour, implement exactly that.
- **§4** is the execution plan, ordered by dependency. Each step ends with a
  verification that must pass before the next one starts.
- **§5 is mandatory.** Every trap listed there has already caused a silent
  failure in this repository.

Rules for the implementer:

1. **Default behaviour must not change.** A deployment that sets none of the new
   variables must boot byte-for-byte the process it boots today. This is the
   single most important constraint in the document.
2. Line numbers are hints from 2026-08-15. Find symbols by name.
3. Fail closed. An unsupported combination refuses to boot; it does not warn and
   continue. A warning in a boot log is not a control — see §5.

---

## 1. Why this is small

Functions are already much closer to independently deployable than they look.

| What we need | What already exists |
| --- | --- |
| A stable per-function address | `createFunctionRoutes` mounts each file at `/api/functions/<name>` ([function-routes.ts](../packages/server/src/functions/function-routes.ts)). `FunctionsClient.invoke` builds exactly that path ([functions.ts](../packages/client/src/functions.ts)). Routing one function elsewhere is an ingress rule — no client change. |
| An unambiguous function identity | `loadFunctionsWithDiagnostics` is flat by construction: subdirectories are explicitly refused and reported ([function-loader.ts](../packages/server/src/functions/function-loader.ts)). The name space is already a set of strings. |
| Code decoupled from the process | The bundle. `entry.functions` is a directory in the manifest; `bootFromBundle` mounts it. Upgrading the runtime is an image tag. |
| Deps for a second copy of the framework | Already handled. The singleton lives on `Symbol.for("@rebasepro/server:singleton-instance")` precisely because a bundle loads its own copy of `@rebasepro/server` alongside the image's ([singleton.ts](../packages/server/src/singleton.ts)). |
| Multi-instance cron | **Already coordinated.** `CronScheduler` claims each `(job, slot)` pair via `tryClaimRun` against `rebase.cron_claims`, and the store is attached by default on any SQL driver ([cron-scheduler.ts](../packages/server/src/cron/cron-scheduler.ts), [cron-store.ts](../packages/server/src/cron/cron-store.ts)). |
| Multi-worker job queue | **Already safe.** `JobStore.claim` uses `FOR UPDATE SKIP LOCKED` and reclaims from workers that stop responding ([job-store.ts](../packages/server/src/jobs/job-store.ts)). |
| A per-function permission scope | API keys already carry `functions` / `functions/<name>` permissions. |
| Multi-container self-host | [docker-compose.selfhost.yml](../docker/docker-compose.selfhost.yml) already runs the published image against a mounted bundle, with no application image to build. Adding services is adding services. |

So the work is **not** "make functions deployable". It is: make the set of
surfaces a process mounts, and the set of singletons it owns, a boot-time
decision instead of a hardcoded one.

### What is genuinely missing

1. `initializeRebaseBackend` mounts every surface unconditionally. There is no
   way to boot a process that serves functions and *not* `/api/data`, or the
   reverse.
2. `ensureCollectionSchema` / `ensureCollectionPolicies` in
   [boot.ts](../packages/server/src/boot/boot.ts) run on every boot and do **not**
   go through [ddl-bootstrap.ts](../packages/server/src/boot/ddl-bootstrap.ts).
   Concurrent boots racing `CREATE … IF NOT EXISTS` is measured, not theoretical:
   5 instances, 8 of 10 calls took the losing branch. Today one replica hides
   this; three do not.
3. The rate-limit store defaults to `MemoryRateLimitStore`, shared across the
   data, functions and storage limiters *within one process*. Split the process
   and each one gets its own budget.
4. The channel bus defaults to memory, so broadcast and presence stop crossing
   instances the moment there is more than one.

Items 2–4 are pre-existing multi-replica bugs. This work does not create them —
it makes them reachable, which means it has to fix or fail-close on them.

---

## 2. Decisions

| # | Decision |
|---|---|
| D1 | One image, one bundle, one binary. A role is **deployment configuration**, never a build variant and never a separate package. |
| D2 | The default role is `all` — exactly today's process. Splitting is opt-in and silent for every existing deployment. |
| D3 | A role decides two things: which HTTP surfaces mount, and which **owned singletons** the process runs (schema DDL, cron scheduler, job workers). Route mounting alone is not enough — a process that does not serve `/api/cron` must also not be firing timers. |
| D4 | Illegal or lossy combinations **refuse to boot**. In particular: more than one process against one database with a memory channel bus, or a non-`api` role left on `REBASE_MIGRATE_ON_BOOT=ensure`. |
| D5 | The `api` role can proxy `/api/functions/*` to a functions process. This makes the split invisible to clients and means nobody needs to stand up Caddy to try it. It is opt-in; a reverse proxy in front remains the production-grade option. |
| D6 | **No per-function configuration in Phase 1.** Selection is by name at boot. Declared memory/timeout/concurrency belongs on `defineFunction` and lands in Phase 2, after this has been used. |
| D7 | Cloud gets no runtime capability self-hosting lacks. Autoscaling, scale-to-zero and metering are control-plane decisions about *how many copies exist*; the runtime behaves identically either way. |
| D8 | Roles are a closed enum, not a free-form list of surfaces. Four named shapes people can reason about beat sixteen combinations nobody tests. |

---

## 3. Specification

### 3.1 The role

```ts
/** packages/types — one of four deployment shapes for a runtime process. */
export type RebaseRuntimeRole = "all" | "api" | "functions" | "worker";
```

Read from `REBASE_ROLE` in [boot/env.ts](../packages/server/src/boot/env.ts),
alongside `REBASE_MIGRATE_ON_BOOT`, as a `z.enum([...]).default("all")`.

Env rather than a CLI flag on purpose: Compose, Kubernetes and Cloud Run all
configure environment identically, and `docker/entrypoint.mjs` does not have to
learn to forward arguments.

### 3.2 What each role owns

| | `all` | `api` | `functions` | `worker` |
| --- | --- | --- | --- | --- |
| `/api/auth`, `/api/admin`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | proxy or off (§3.4) | ✅ | — |
| `/api/cron` (the admin surface) | ✅ | ✅ | — | — |
| `/health`, `/livez`, metrics | ✅ | ✅ | ✅ | ✅ |
| Runs `ensureCollectionSchema` + `ensureCollectionPolicies` | ✅ | ✅ | — | — |
| Runs the cron **scheduler** | ✅ | ✅ | — | ✅ |
| Runs job-queue **workers** | ✅ | ✅ | — | ✅ |

Notes on the shape of that table:

- **`api` keeps cron and jobs.** They are already claim-coordinated (§1), so this
  is not a correctness requirement — it is the default that keeps a two-service
  split (`api` + `functions`) complete without a third container.
- **`worker` exists for the case where you want them off the request path
  entirely.** A deployment that runs `api` + `functions` + `worker` should set
  `REBASE_CRON_SCHEDULER=false` on `api`; see §3.3.
- **`functions` runs no timers at all.** A function process is scaled by request
  load and may be replaced at any time; giving it scheduled work makes its
  replica count semantically meaningful, which is exactly what we are trying to
  avoid.
- **Health and metrics are on every role**, unconditionally. A process an
  orchestrator cannot probe is a process it cannot roll.

### 3.3 Overrides

Two escape hatches, both defaulting to the role's value from §3.2:

- `REBASE_CRON_SCHEDULER=true|false` — run the scheduler in this process.
- `REBASE_JOB_WORKERS=true|false` — run job-queue workers in this process.

These exist because the ownership question ("who fires timers") is genuinely
independent of the surface question ("what URLs answer"), and pretending
otherwise forces a fifth and sixth role. They are the only two overrides; do not
add a general `REBASE_SURFACES` list.

### 3.4 Function selection and proxying

On the `functions` role:

- `REBASE_FUNCTIONS_ONLY` — comma-separated function names. When set, only these
  are mounted. Unset means all.
- `REBASE_FUNCTIONS_EXCLUDE` — comma-separated names to skip. Applied after
  `ONLY`.

A name in either list that does not exist in the bundle is a **boot failure**,
not a warning. The whole point of naming a function in your deployment config is
that the deployment is about that function; a typo that silently serves nothing
is the failure mode this must not have. The error message must list the names
the bundle does contain.

On the `api` role:

- `REBASE_FUNCTIONS_UPSTREAM` — a base URL. When set, `/api/functions/*` is
  proxied there rather than mounted. When unset, the `api` role does not serve
  `/api/functions/*` at all and returns 404.

The proxy forwards method, path, query, body and headers verbatim, adds nothing,
and does not re-authenticate: the upstream process runs the same auth middleware
against the same `JWT_SECRET` and must see the original `Authorization` header.
It is a transport hop, not a trust boundary.

### 3.5 Refusals

Boot must fail, with an actionable message, when:

1. `REBASE_ROLE` is not `api` or `all`, and `REBASE_MIGRATE_ON_BOOT` resolves to
   `ensure` or `push`. Schema ownership belongs to exactly one role.
2. `REBASE_ROLE` is set to anything other than `all` and the resolved channel bus
   is the in-memory one. Broadcast and presence would silently stop crossing
   instances. Point at `realtime: { bus: { type: "postgres" } }`
   ([channel_bus.ts](../packages/types/src/types/channel_bus.ts)).
3. `REBASE_FUNCTIONS_UPSTREAM` is set on a role other than `api`.
4. `REBASE_FUNCTIONS_ONLY` / `_EXCLUDE` is set on a role other than `functions`.
5. A name in `ONLY` / `EXCLUDE` is not in the bundle (§3.4).

Refusal 2 is the one that will be argued about. It stands: a deployment that
splits processes and loses presence has a bug that reproduces only under load,
and the operator has no way to attribute it. The opt-out is configuring a real
bus, which takes one line.

### 3.6 The rate-limit store

`MemoryRateLimitStore` gives each process its own budget, so splitting into N
processes multiplies every caller's allowance by N. Phase 1 does **not** build a
shared store. It:

- logs, once at boot, on any role other than `all` with a memory store, naming
  the multiplication; and
- documents `rateLimit.store` as the supported answer.

A shared store is real work (a Postgres or Redis-backed limiter with its own
correctness questions) and it is not on the critical path for the capability this
phase delivers. Say so in the log line rather than implying the limit still holds.

### 3.7 Self-hosted topology

The published compose file gains a commented second topology. Two services, same
image, same bundle volume, same database:

```yaml
  api:
    image: rebasepro/server:${REBASE_VERSION:-latest}
    environment:
      REBASE_ROLE: api
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080

  functions:
    image: rebasepro/server:${REBASE_VERSION:-latest}
    deploy:
      replicas: 3
    environment:
      REBASE_ROLE: functions
      REBASE_MIGRATE_ON_BOOT: none
```

`docker compose up --scale functions=5` is then the whole operation. The single-
container topology stays the default and the documented starting point.

---

## 4. Execution plan

Ordered by dependency. Each step is independently mergeable and each ends with a
verification that must pass before the next begins.

**Where each step landed** (one commit per step, in this order):

| Step | Landed in |
| --- | --- |
| 1 | `packages/server/src/init/surfaces.ts`, gates through `init.ts`; `test/runtime-surfaces.test.ts` |
| 2 | `ownership` on the backend config, `provisionSchema` on `BootOptions`; `test/runtime-ownership.test.ts` |
| 3 | `isDuplicateObjectRace` + `applyAction` in `ensure-collection-tables.ts`; `schema/drizzle-ddl.ts` for the channel stores |
| 4 | `packages/server/src/boot/role.ts` + `REBASE_ROLE` in `boot/env.ts`; `boot/role.test.ts` |
| 5 | `packages/server/src/functions/selection.ts`; `selection.test.ts` |
| 6 | `packages/server/src/functions/proxy.ts`; `test/functions-proxy.test.ts` |
| 7 | `docker/docker-compose.selfhost.yml`, `docs/deployment/split-processes.md` ×6 locales |

Gates at the end: 2330 server tests, 2062 server-postgres tests, both typecheck
projects, eslint on both packages, `verify:docs`, `check:generated`, and a
regenerated `api-surface/server.api.txt` (nine additions, no removals).

### Step 1 — Make the surface set explicit (no behaviour change)

Introduce an internal `surfaces` option on `initializeRebaseBackend`, defaulting
to every surface. Gate each `config.app.route(...)` call on it. Do not read any
environment variable yet, and do not touch `boot.ts`.

**Verify:** the full existing suite passes unchanged, and a test asserts that the
default option set mounts exactly the routes mounted today — enumerated
explicitly, so a future surface added without a `surfaces` entry fails the test
rather than silently becoming unsplittable.

### Step 2 — Make ownership explicit (no behaviour change)

Same treatment for the two owned singletons: `cronScheduler.start()` and
`jobQueue.start()` become conditional on options that default to `true`.
`ensureCollectionSchema` / `ensureCollectionPolicies` in `boot.ts` gain the same.

**Verify:** suite green. A test boots with ownership off and asserts no timer is
registered and no DDL statement is issued.

### Step 3 — Fix the DDL race that N replicas exposes

Route `ensureCollectionSchema` and `ensureCollectionPolicies` through
`createDdlBootstrapper` from
[ddl-bootstrap.ts](../packages/server/src/boot/ddl-bootstrap.ts), as
`cron-store.ts` and `api-key-store.ts` already do. Same pass: the still-unfixed
`ensureTables()` in `channel-presence.ts` / `channel-history.ts`
(`packages/server-postgres`).

**Verify:** unit tests that inject a wrapped `23505` at the losing branch and
assert the bootstrap completes, including any trailing revoke. An end-state
assertion is not sufficient and will pass against the unfixed code — see §5.

### Step 4 — `REBASE_ROLE`

Add the enum to `boot/env.ts` and map it onto the options from Steps 1–2 in
`bootFromBundle`. Implement the §3.5 refusals. Add the §3.3 overrides.

**Verify:** a table-driven test over all four roles × both overrides asserting
the resolved surface and ownership sets, plus one test per refusal asserting boot
fails with a message naming the variable to change.

### Step 5 — Function selection

`REBASE_FUNCTIONS_ONLY` / `_EXCLUDE`, applied to the result of
`loadFunctionsWithDiagnostics`. Unknown-name boot failure with the bundle's
actual names in the message.

**Verify:** selection tests, including the unknown-name failure and its message
content.

### Step 6 — `REBASE_FUNCTIONS_UPSTREAM`

The `api`-role proxy. Verbatim forwarding of method, path, query, body and
headers.

**Verify:** an integration test that boots two in-process runtimes from one
bundle — one `api` with an upstream pointed at the other `functions` — and
asserts that an authenticated call through the proxy sees the same `c.var.user`
as the same call made directly. Auth passthrough is the thing most likely to
break and the thing that breaks most quietly.

### Step 7 — Ship the topology and the docs

The compose file (§3.7), a documentation page under
`website/src/content/docs/docs/deployment/`, and the six locale copies. The page
must state plainly what a split deployment does not give you: shared rate limits
(§3.6), and scale-to-zero, which is not a runtime feature.

**Verify:** `pnpm verify:docs` — every fence in the new page typechecks against
the workspace, and the page has a sidebar entry (without one it is absent from
`llms.txt`).

---

## 5. Traps

Every one of these has already burned this repository.

1. **`CREATE … IF NOT EXISTS` is not atomic.** Measured on Postgres 18: five
   instances, 8 of 10 calls took the losing branch with `23505` on a *catalog*
   index. The classic shape of the bug is a bootstrap written as one long `try`,
   where the losing statement abandons everything after it — including trailing
   `REVOKE`s that are the actual security control. Create, then **probe** what
   exists, then drive sweeps and revokes off the probe — never off who won.

2. **An end-state assertion passes against the unfixed code.** At least one
   instance always finishes, and a table-global revoke is table-global. The
   regression guard has to inject the error at the unit level. This is why Step 3
   specifies injection and not an e2e.

3. **A warning in a boot log is not a control.** `cron-scheduler.ts` already logs
   "runs are uncoordinated" when no store is attached, and nobody would ever see
   it in a rolling deploy. That is why §3.5 refusals are refusals.

4. **A blank environment variable is not an unset one.** `Number("")` is `0`, and
   `REBASE_FUNCTIONS_TIMEOUT_MS=${SOMETHING}` with `SOMETHING` undefined is the
   ordinary way to write a compose file. `resolveFunctionsTimeoutMs` in
   [request-timeout.ts](../packages/server/src/functions/request-timeout.ts)
   already handles this correctly — every new variable here must too, and each
   needs a test with `""` and `" "`.

5. **A wrapper that re-lists methods silently drops the ones it forgets.** This
   is how boot-time table creation shipped dead: `adapterToBootstrapper()` and
   `createPostgresAdapter()` both forward a hand-listed subset and had omitted
   `ensureCollectionSchema`, invisible in the types because the method is
   optional. If Step 3 touches either wrapper, extend the forwarding tests.

6. **Two copies of `@rebasepro/server` in one process is the normal layout**, not
   an edge case: the image ships one at `/app/node_modules`, the bundle installs
   another at `/bundle/node_modules`. Any new module-local state added here must
   go on a `Symbol.for` slot, exactly as `singleton.ts` does, or it will be dead
   in whichever copy did not boot.

7. **`backend/src` and `backend/functions` are separate trees.** A grep scoped to
   `src` misses every function and every cron. Grep the package whole.

8. **`fetch` decodes a response but keeps its `Content-Encoding`.** Found while
   building the proxy, and it cost the longest debugging cycle in this work. The
   runtime compresses its own responses, so *every* forwarded response arrives
   with the header set over a body undici has already gunzipped; copying it onto
   the response handed back tells the client to decode plain bytes, and that does
   not fail cleanly — it hangs. A `Content-Length` from the upstream is wrong for
   the same reason.

9. **`app.request()` is not a transport.** It hands the `Response` object
   straight back, so neither of the bugs above is reachable through it, and
   `getConnInfo` has no socket to report — which silently made the
   `X-Forwarded-For` behaviour untestable. Two real servers on ephemeral ports
   found both in one run. Resolve the port from `serve`'s listening callback, not
   after a sleep: a fixed delay is a race that only loses under parallel load.

10. **Fixture directories are shared state.** `functions-mount.test.ts` asserted
    that exactly 2 subdirectories were skipped; adding one unrelated fixture
    directory elsewhere in the suite failed it with a number that said nothing
    about the behaviour under test. Count from the filesystem, not from a
    literal.

---

## 6. Out of scope

Named explicitly so the boundary is not argued later.

- **Per-function declared resources** (memory, timeout, concurrency,
  min/max instances) on `defineFunction`, and their journey into the manifest and
  through managed intake. This is Phase 2 and it is an API change; it should be
  designed after somebody has run a split deployment.
- **Per-function content hashing** so a deploy can say "only `send-invoice`
  changed". Requires tracing the import graph per function, or accepting that
  every function process carries the whole compiled tree — which for Phase 1 it
  does, and which is fine.
- **A shared rate-limit store.** See §3.6.
- **Scale-to-zero and per-function autoscaling.** Control-plane features. Note
  that `scale-to-zero.ts` already warns that cron timers never fire on a frozen
  platform; the same class of trap applies to any function that enqueues work.
- **Cold-start optimisation.** A function process still boots data sources, auth
  and the collections config, because `defineFunction` hands handlers the full
  `rebase` singleton and `c.var.driver`. Nothing here reduces that. Measure
  `bootFromBundle` before anyone promises a scale-to-zero tier.
- **Isolate or edge runtimes.** A different product.
