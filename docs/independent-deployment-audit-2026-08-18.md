# Independent deployment — where we stand

Status: **audit**, 2026-08-18. No code changed.
Supersedes the reachability tables in
[deployment-placement-audit-2026-08-17.md](deployment-placement-audit-2026-08-17.md),
which is one day old and already stale in two places (O8 and O9 both closed the
same day). Read that one for the *reasoning*; read this one for the *state*.

Scope: `packages/server` boot/roles/surfaces, `packages/cli` build & deploy,
`charts/rebase`, `docker/`, and `saas/backend/src/{k8s,managed,static,front-door}`.

---

## 0. The one-paragraph answer

The runtime half is **done and gated in CI**. One image and one bundle boot as
`api` + `functions` + `worker`, the last runtime blocker (a shared rate-limit
store) closed, a Helm chart renders the whole topology, and the image is finally
on Docker Hub. The default is untouched: `split: false`, `REBASE_ROLE` unset, one
container — self-hosting stayed simple, which was the constraint.

What is **not** done is the thing the goal actually names. Today a split gives
independent *isolation, scaling and restart*. It does not give independent
*release*: every backend unit shares one bundle and one image tag, so changing
one function still rebuilds the bundle and rolls the API. That is §G1, and it is
the only structural gap left on the self-host side.

---

## 1. Shipped since the last audit

| Step (audit §8 numbering) | State |
|---|---|
| 1. Publish the runtime image | **Done** — `rebasepro/server` `0.14.0`, `0.14.1`, `latest`, pushed 2026-08-16. The longest-open blocker in the repo |
| 2. Shared rate-limit store | **Done** — `packages/server/src/auth/sql-rate-limit-store.ts` + `resolve-rate-limit-store.ts` |
| 3. Helm chart for the self-host split | **Done** — `charts/rebase`, commit `7a4a4ddc1` |
| 4. Front door | **Code-complete, not deployed** — `saas/backend/src/front-door/` (5 modules, 3 test files), on saas `main` |
| 5. Static path wired | **Code-complete, not deployed** — `saas/backend/src/static/{publish,serve,deploy-static}.ts`; intake accepts `kind: static` (`deploy-plan.ts:141`) |
| 6. Second managed unit | **Wired, unsold** — `resolveManagedUnits` is called at `orchestrator.ts:1818`; no plan sets `split` |
| 7. Decide D3, one pure builder | **Open** |
| 8. Cloud Run substrate or drop it | **Open** |
| 9. BYOC pull agent | **Open** |

### The runtime, in detail

- `packages/server/src/boot/role.ts` — pure resolution of `REBASE_ROLE` into
  surfaces, owned singletons and schema ownership, with two refusals that fail
  the boot rather than warn.
- `packages/server/src/init/surfaces.ts` — 7 mountable surfaces × 2 ownership
  flags. Surfaces default to on, so a surface added later mounts in every
  existing deployment without anyone editing a list.
- `packages/server-postgres/test/e2e/split-roles-e2e.test.ts` spawns
  `rebase-server` as **real OS processes**, and it runs in CI (`verify.yml:508`).
  That is what makes the split a supported shape rather than a documented one.

### The chart, in detail

Rendered and read for this audit. It is good work: `split: true` produces
`api` + `functions` + `worker` Deployments, a Service per HTTP unit, a migration
Job that takes DDL off the request path entirely, per-unit `TRUSTED_PROXY_HOPS`,
and an **ingress that fans `/api/functions` out to the functions Service** rather
than routing it through the api-side proxy — one hop instead of two, which is the
difference between per-caller and per-pod rate-limit buckets.

`staticApps[]` is the one place independent release already works: each app is
its own Deployment with **its own image repository and tag**, and
`rebase build <app>` produces a per-app `kind: static` bundle
(`packages/cli/src/commands/build.ts:229`).

---

## 2. Gaps, ordered by how much they block the goal

### G1 — "Independent deploy" is isolation, not release *(structural)*

Every backend unit renders `image: {{ include "rebase.image" $root }}`
(`charts/rebase/templates/deployment.yaml:87`) — one global repository and tag.
`bundle.url` is global too. There is no `functions.image` and no
`functions.bundle`. So:

- a one-line change to a function rebuilds the whole bundle and rolls `api`,
  `functions` and `worker` together;
- the functions unit cannot lag or lead the api unit;
- `REBASE_FUNCTIONS_ONLY` selects at **boot**, from a bundle that carries every
  function's compiled tree anyway.

This is by design and it is written down — `docs/runtime-roles-plan-2026-08.md`
§6 puts per-function content hashing and per-function declared resources in
Phase 2, explicitly "after somebody has run a split deployment". Somebody now has.

The cheap version (per-unit `image`/`bundle` overrides in the chart) is about two
hours of templating, **and it opens a real question rather than closing one**:
two units on different bundles are two units with different collection sets and
different `schemaVersion`s, against one database. That is the same version-skew
axis the previous audit flagged for BYOC, arriving early. Decide it deliberately;
do not let a values-file field decide it.

The five ways to answer it, what each costs and what it forecloses, are written
up in [independent-release-options-g1.md](independent-release-options-g1.md).

### G2 — The chart's default image tag does not exist — **FIXED**

`Chart.yaml` set `appVersion: "0.15.0"` while `packages/server` was at `0.14.1`.
`rebase.image` defaults `image.tag` to `.Chart.AppVersion`, so the chart's own
documented "minimum viable install" — four `--set` flags, stock image — rendered
`rebasepro/server:0.15.0` and landed in `ImagePullBackOff`. Verified by
rendering.

The number closed itself mid-audit when a release bumped the repo to 0.15.0,
which is the more interesting fact: **nothing held the two together**, so the
chart could sit ahead of the release (a tag nothing built) or behind it (every
default install quietly running an old runtime against a current bundle) and
neither shows up as an error. `scripts/check-runtime-image.mjs` now treats the
chart as what it is — a user-facing image reference — and holds `appVersion` to
`@rebasepro/server`'s version, with `--live` covering whether the tag is
pullable. Mutation-tested: bumping `appVersion` alone turns it red.

### G3 — The chart has no CI coverage at all — **FIXED**

No `helm lint`, no `helm template`, nothing in `.github/workflows`. The chart
carried a `_validate.tpl` with nineteen refusals for topologies that would be
silently wrong (two schema owners, private rate-limit counting) and **nothing
exercised a single one of them**. G2 was exactly the class of defect one `helm
template` in CI would have caught on the commit that introduced it.

`scripts/check-chart.mjs` (`pnpm run check:chart`, wired into `verify.yml`) lints,
renders the three documented topologies and reads the decisions back out — the
roles, who provisions, that the worker gets no Service, that functions are
reached in one hop through the ingress rather than two through the api's proxy,
that a static app takes its own image and carries no Secret. Then it extracts
every `fail` from `_validate.tpl` and requires a case that reaches it, so a
refusal added later fails the check until it is covered. Mutation-tested in both
directions: deleting a refusal and leaking `REBASE_ROLE` onto the unsplit pod
each turn it red.

### G4 — Realtime and CDC are neither a surface nor role-aware — **FIXED**

`realtime` is not in `ALL_RUNTIME_SURFACES`, and neither
`initializeRealtime` (`init.ts:957`) nor `initializeWebsockets`
(`init.ts:2291`) is gated on anything. Consequences, per pod, on **every** role:

1. A `functions` or `worker` pod mounts a websocket server no client will ever
   connect to, and opens a dedicated `LISTEN` client outside the pool — a second
   Postgres connection per replica, spent on nothing.
2. More seriously, it **runs DDL**. `PostgresBootstrapper.ts:665` calls
   `provisionTriggerCdc` at driver bootstrap, which issues
   `CREATE SCHEMA IF NOT EXISTS rebase`, `CREATE OR REPLACE FUNCTION`, and
   `DROP TRIGGER IF EXISTS … ; CREATE TRIGGER …` **for every collection table**.
   `directUrl` falls back to the ordinary connection string
   (`PostgresBootstrapper.ts:580`), so this is on by default, not opt-in.

That contradicts the invariant the role model refuses to boot without: `role.ts`
rejects a `functions` or `worker` process whose `REBASE_MIGRATE_ON_BOOT` is
anything but `none`, on the grounds that exactly one process owns schema DDL —
and then the driver runs schema DDL from all of them regardless. Each statement
is individually idempotent and the multi-statement string is atomic under the
simple query protocol, so this is not corruption; it is N × replicas ×
tables `ACCESS EXCLUSIVE` locks taken on live tables on every rollout.

`realtime` is a surface now, off for `functions` and `worker`, and
`DatabaseAdapterInitConfig.realtime` carries two separate answers to the driver:
`subscribe` (does this process have anyone to deliver to) and `provision` (does
it own the DDL). They are deliberately independent — an `api` behind an external
migration Job subscribes without provisioning. The websocket attachment, the
`LISTEN` client, the capture triggers and the channel-history tables all follow
one or the other; the channel *bus* deliberately does not, because publishing to
a channel is something a function handler does as readily as a websocket client.

Proven against a real Postgres and real spawned processes in
`split-roles-e2e.test.ts`: a `functions` process creates no
`rebase.rebase_cdc_notify` and holds no `LISTEN` connection, while the `api`
creates both. Both assertions were mutation-tested — and the first version of
them was **vacuous**, asserting on per-table triggers that a database with no
tables yet has none of either way. The trigger *function* is the fact that
separates the two.

### G5 — The cloud plumbs the split but sells nobody

`ComputeSplit` exists (`saas/.../utils/tenant-topology.ts:132`),
`resolveManagedUnits` and `unitsToRemove` are called from the orchestrator, and
`pinnedRuntimeEnv(role)` finally has a caller that passes a role
(`managed/deployment.ts:468`). But the field's own comment is accurate: "Absent
for every plan today." Nothing produces a `split`, so no tenant can get one.

Related and still true: `pinnedRuntimeEnv` neutralises `REBASE_CRON_SCHEDULER`
and `REBASE_JOB_WORKERS` on every managed pod, so separating cron from job
execution is inexpressible on cloud — correctly, since topology is a platform
decision, but it means it is a feature to build, not a setting to document.

### G6 — Two answers to "how does the admin panel deploy", still

`rebase cloud deploy` **folds the frontend into the backend bundle** by default
(`cloud/deploy.ts:239`, `--no-static` to opt out), while intake now *also*
accepts a standalone `kind: static` bundle and the bucket path exists to serve
it. Both are live in the same CLI. D2 was decided on paper (bucket for cloud, pod
for self-host); the default deploy path has not moved to match.

### G7 — Front door and static hosting are inert in production

`frontDoorEnabled()` keys off `REBASE_STATIC_BUCKET`
(`front-door/listener.ts:73`), and that variable appears in **no** manifest —
`infra/gcp/saas-control-plane.yaml` sets `REBASE_SERVICE_KEY` and
`REBASE_CONTROL_PLANE_URL` and nothing else from that family. Five modules and
three test files that have never answered a request. This is the same
built-but-unreachable pattern the previous audit catalogued, one layer up: the
code stopped being unreachable, the deployment did not follow.

### G8 — Open architectural decision: D3

Whole-object apply (server-side apply with field managers) versus the
reconciler's deliberate per-field patching. Unmade. It is the price of sharing
chart templates between self-host and platform, and it does not dissolve by
choosing Helm. Everything in §1 rows 7–9 waits behind it.

### G9 — Small and stale

- ~~`docker/docker-compose.selfhost.yml:102` names `rebasepro/server:0.11.0` in a
  comment~~ — **fixed**, it now uses `${REBASE_VERSION}` like the live references
  in the same file.
- Cold start is unmeasured. A `functions` pod still boots data sources, auth and
  the full collections config, because `defineFunction` hands handlers the whole
  `rebase` singleton. Any scale-to-zero claim depends on a number nobody has.
- Observability and NetworkPolicy are both written for one pod per project.

---

## 3. What I would do next

Ordered so that each step is worth doing even if the one after it is cancelled.

1. ~~**G2 + G3 together.**~~ **Done.** Both are gates now, and both were
   mutation-tested rather than assumed.
2. ~~**G4.**~~ **Done**, with the e2e that proves it.
3. **G1 — decide it before building it.** Per-unit image/bundle overrides are
   easy; two units on skewed bundles against one database is not. Either accept
   skew and define the contract (which unit owns `schemaVersion`? what does the
   contract endpoint answer?), or reject it and say so in the chart, so the
   question stops being open.
4. **G7, then G5.** Set `REBASE_STATIC_BUCKET` and give the front door traffic —
   it unblocks four subsystems that are otherwise finished and idle. Then put
   `split` on a plan so the managed side of §1 row 6 is reachable by a customer
   rather than by a test.
5. **G6 and G8** are decisions, not work. They should be made in writing before
   anyone writes templates against them.
