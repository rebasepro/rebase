# Platform Rethink — Implementation Plan (2026-07)

> **Status (2026-07-24).** Phases 1 and 2 are implemented on
> `feat/platform-runtime-bundle`: the three contracts, multi-source configuration,
> the contract endpoint and remote SDK generation, `/metrics`, the official image
> and compose quickstart, and the app-aware CLI. Verified against the demo app end
> to end — build, boot, and a typed client generated over HTTP from a separate
> directory that is byte-identical to the locally generated one. Phases 3–6 (the
> cloud control plane, release channels, shared Postgres, the apps registry and
> hosting, the console) remain, and all of them consume rather than change the
> contracts below.
>
> Two deliberate deviations from this plan, both found while building:
> - The project link reuses the existing `.rebase/cloud.json` instead of adding a
>   competing `.rebase/project.json`. A second link file would fork every command
>   that reads one, and the tooling would drift into being cloud-only by accident.
> - `schemaVersion` hashes a *projection* of each collection (slug, properties,
>   relations) rather than the whole thing. Hashing everything meant a hook edit
>   invalidated every SDK — and worse, the runtime applies default security rules
>   at load time, so a build-time stamp could never match the server serving it.

**Goal:** evolve rebase from "monorepo template you build and we (or you) run as a monolith container" into a
Firebase/Supabase-class platform: a **platform-versioned runtime** that loads a **validated project bundle**,
a **project = backend + N registered apps** model that works across repos, an **autopilot managed tier**
(autoscaling, fleet upgrades, scale-to-zero), and honest **infra observability** — while keeping self-host a
first-class, equally easy path.

**Non-negotiable principles**

1. **One runtime, no fork.** The "platform runtime" IS `@rebasepro/server`. Cloud managed runs the same
   published Docker image a self-hoster runs. Anything cloud-only is orchestration around it, never inside it.
2. **OSS is customer zero.** Every contract (manifest, bundle, entrypoint, contract endpoint) lands in the OSS
   repo and works self-hosted before cloud consumes it.
3. **Schema and logic stay TypeScript.** `rebase.json` holds topology only. Collections, rules, hooks,
   functions remain typed code in `config/` — that is the differentiator.
4. **Escape hatches everywhere.** Eject to a custom `index.ts` → project becomes `runtime: custom` (today's
   Kaniko path) and still deploys. Self-host can always import the server as a library. Nothing is removed.
5. **Migration is automatic and lazy.** Existing projects keep working untouched, classified `custom`.
   The CLI synthesizes manifests; nobody is forced to migrate on a date.

---

## Current state (what we build on)

- Template ([packages/cli/templates/template](packages/cli/templates/template)) is already a workspace:
  `config/` (own package: collections + index), `backend/` (glue `index.ts` + `functions/` + Dockerfile),
  `frontend/` (own package + Dockerfile), `docker-compose.yml`. The `baas` overlay is a backend-only variant.
- `backend/src/index.ts` is ~200 lines of glue: env→options wiring (CORS, storage, auth/SMTP), then
  `initializeRebaseBackend({ collectionsDir, functionsDir, database, auth, storage, ... })`. The runtime
  entrypoint 80% exists — it just lives in user-land.
- CLI already has `build`, `start`, `dev`, `generate-sdk`, `schema`, `db`, and `cloud {link, deploy, projects,
  deployments, env, domains, databases, ...}` ([packages/cli/src/commands](packages/cli/src/commands)).
- Cloud today: project = git repo or `--source` upload → Kaniko builds the **whole repo** into one image →
  1 Deployment pod (replicaCount 1–5) + dedicated CNPG Postgres per tenant namespace on GKE Autopilot.
  BYODB and BYOS exist. Studio is embedded in the console (hosted-admin precedent already shipped).
- Known scaling/quality gaps (AUDIT-2026-07-23): per-tenant CNPG cluster is heavy; managed storage hard-stops
  ~100 tenants; `projects` schema carries dead Docker-era fields (`provider`, `vmSize`, `enableVpc`,
  `vpcCidr`); observability is pod-level only; prod schema not auto-created; no provider deploy templates.

---

## The three contracts (design first, everything hangs off these)

### Contract A — `rebase.json` (authored project manifest)

Repo-root, human-edited, machine-read. Declares the apps **this repo contributes** to a project and the
runtime compatibility target. JSON Schema published as `@rebasepro/types/rebase-json.schema.json`; CLI
validates on every command.

```jsonc
{
  "$schema": "https://rebase.pro/schemas/rebase.json",
  "runtime": "^1",                    // runtime MAJOR compatibility target (semver range)
  "apps": {
    "backend": {
      "type": "backend",              // exactly 0 or 1 backend app per PROJECT (registry-enforced)
      "config": "config",             // dir containing config package (collections, index)
      "functions": "backend/functions"
    },
    "web": {
      "type": "static",
      "root": "frontend",
      "build": "pnpm --filter frontend build",
      "output": "frontend/dist",
      "spa": true
    },
    "admin": { "type": "admin", "mode": "hosted" }   // "hosted" | "bundled" (legacy)
    // { "type": "custom", "dockerfile": "backend/Dockerfile" }  ← eject marker
  }
}
```

- Project linkage is NOT in this file (it's committed; project refs are per-checkout):
  `.rebase/project.json` written by `rebase link` — `{ "project": "<id-or-url>", "org": "..." }`.
  `rebase link https://api.myapp.com` (self-host URL) must work wherever a cloud project id works.
- Absent file ⇒ legacy: CLI synthesizes one in-memory from current conventions and offers to write it.

### Contract B — the project bundle (built artifact)

Output of `rebase build` for a `backend` app. Layout:

```
dist-bundle/
  manifest.json          // GENERATED, never hand-edited
  config/                // compiled config package (collections, index) — JS + .d.ts
  functions/             // compiled functions
  schema.generated.js    // drizzle schema (tables/enums/relations)
  node_modules-lock.json // exact resolved deps of user code (pruned, prod only)
  assets/                // (optional) email templates etc.
```

`manifest.json` (the lockfile-analog the platform validates):

```jsonc
{
  "bundleFormat": 1,
  "runtime": { "range": "^1", "builtAgainst": "1.4.2" },
  "schemaVersion": "sha256:...",      // hash of compiled config — the contract stamp for SDK drift
  "app": "backend",
  "hooks": { "native": false },       // native modules detected? (managed tier rejects true)
  "deps": { "declared": {...} },
  "build": { "cli": "0.11.0", "node": "22", "createdAt": "..." }
}
```

Rules: bundle contains **only compiled JS + declared deps** — no Dockerfile, no repo. Managed tier constraint
line (DECIDED HERE, revisit only with data): bundled JS + npm deps allowed; **no native modules, no
filesystem persistence, no child processes** in hooks/functions on managed. Projects needing more →
`runtime: custom` or self-host.

### Contract C — runtime entrypoint + versioning

- New OSS entrypoint in `@rebasepro/server`: `bootFromBundle(bundleDir, env)` — absorbs everything template
  `index.ts` does today (CORS policy, storage selection incl. the prod-501 rule, auth/SMTP wiring, health,
  SPA serving optional, shutdown handlers), driven by env + bundle manifest. Template `index.ts` shrinks to
  nothing (deleted) on the stock path; ejecting = re-creating it (docs show how; it's a supported library API).
- Official image `rebasepro/server:<semver>`: `FROM node:22-slim`, server package installed, entry
  `rebase-server /bundle`. Published from CI on every release (same trusted-publisher discipline as npm).
- **Semver contract:** within a runtime MAJOR, every bundle with `bundleFormat` ≤ current that validated
  MUST keep working. Enforced by the bundle-corpus CI suite (see Testing). MINOR/PATCH are always
  drop-in. MAJOR bumps change Contract A/B/C and require a CLI-assisted migrate.
- **Contract endpoint (OSS):** authenticated `GET /api/meta/contract` serving `{ schemaVersion, runtime,
  collections: <typegen payload>, apps: [...] }` — powers remote `generate-sdk` and drift detection.
  Served by every runtime ≥ this release, self-host included.

---

## Phase 1 — OSS runtime entrypoint + bundle (self-host gets better first)

*Everything here lands in the monorepo; no saas changes. Ship behind the next minor.*

1. **`bootFromBundle` in `@rebasepro/server`** (new `packages/server/src/boot/`):
   - Extract template `index.ts` logic verbatim into option-resolvers: `resolveCorsOptions(env)`,
     `resolveStorageOptions(env)` (keep the prod-501 no-bucket rule), `resolveAuthOptions(env, usersCollection)`.
   - `bootFromBundle(dir)` reads `manifest.json`, loads compiled config + schema + functions, calls
     `initializeRebaseBackend`, installs health route + shutdown. Bin: `rebase-server` in server package.
   - Users collection discovery: convention `config/collections/users.js` + manifest override key.
2. **`rebase build` rework** ([build.ts](packages/cli/src/commands/build.ts)): compile `config/` + functions
   (tsc esbuild-bundled per function later; plain tsc now), run schema generation, emit `dist-bundle/` +
   `manifest.json` (hash config for `schemaVersion`, detect native deps by walking declared deps for
   `.node`/gyp). `rebase start` = `bootFromBundle(dist-bundle)`.
3. **Official Docker image + compose**: `docker/server.Dockerfile` in monorepo, CI publishes
   `rebasepro/server` on release. New self-host template output: compose file = `rebasepro/server` +
   `postgres:16` + bundle mount. **This kills the template's backend Dockerfile as the default path** and
   fixes the audit gap "prod schema not auto-created": image entrypoint runs ensure-tables + optional
   `REBASE_MIGRATE_ON_BOOT=push` gate (default off in prod, on in compose quickstart with a printed warning).
4. **Template slimming**: delete `backend/src/index.ts` + env.ts glue from the stock template (kept in an
   `eject` doc/recipe); backend package becomes `functions/` + tsconfig only. `baas` overlay collapses into a
   `rebase.json` variant (Phase 2 completes this).
5. **Docs**: new "Deploy anywhere" section — compose, Fly, Railway, VPS w/ systemd — all "run the image with
   your bundle". This is marketing-relevant (self-host got easier, per principle 2).

**Exit criteria:** a fresh `rebase init` project runs via `rebase build && docker compose up` with zero user
Dockerfiles; existing projects untouched; e2e: local-registry recipe (Verdaccio) proves published-CLI flow
end-to-end incl. the image.

## Phase 2 — `rebase.json`, apps in the CLI, remote SDK

1. **Manifest loader** (`packages/cli/src/manifest.ts`): parse + JSON-Schema-validate `rebase.json`;
   synthesize from conventions when absent (template layout ⇒ backend+web+admin entries); `rebase init`
   writes it; `rebase doctor` reports classification (managed-compatible vs custom and why — this is the
   drift detector).
2. **App-aware commands**: `rebase build [app]`, `rebase deploy [app...]` (deploy = cloud in Phase 3; for
   now `build` of static apps runs `build` cmd and collects `output/`). `rebase dev` unchanged (runs source).
3. **`rebase link` refactor** ([cloud/link.ts](packages/cli/src/commands/cloud/link.ts)): write
   `.rebase/project.json`; accept project id OR base URL; all cloud commands + `generate-sdk` resolve
   through it.
4. **Contract endpoint** in server (`/api/meta/contract`, admin-or-service-key gated) + **remote typegen**:
   `rebase generate-sdk --from <link|url>` fetches the contract instead of importing local `config/`.
   SDK embeds `schemaVersion`; client sends it as `X-Rebase-Schema` header; server compares and exposes
   drift counters (used by Phase 5 console and by `rebase check` in CI).
5. **Multi-repo template**: `rebase init --app static` scaffolds a frontend-only repo (rebase.json with one
   static app + link step). Docs: "multiple repos, one project".

**Exit criteria:** two separate repos (backend repo, web repo) build against one running self-hosted project
with typed SDK pulled remotely; drift header visible in server logs.

## Phase 3 — cloud managed runtime (the autopilot tier)

*All in `saas/` + cluster config. The big one; sub-phase it.*

**3a. Bundle intake + platform-image deploys**
1. `projects.runtimeMode: "managed" | "custom"` (new column; default `custom` for all existing rows,
   `managed` for new projects that pass validation). Retire dead columns (`provider`, `vmSize`, `enableVpc`,
   `vpcCidr`) — console first, then migration dropping them.
2. New deploy path in `rebase cloud deploy`: if managed-compatible → `rebase build` locally (or CI), upload
   **bundle tarball** (not source) to the existing artifact bucket; saas records
   `deployments.bundleManifest` (jsonb) + `deployments.runtimeVersion`.
3. Server-side validation on intake ([saas deploy hooks](saas/backend/src)): bundleFormat supported, runtime
   range satisfiable by an active release, `hooks.native === false`, deps installable. Fail the deploy with
   a structured error BEFORE touching k8s.
4. Orchestrator ([k8s/orchestrator.ts](saas/backend/src/k8s/orchestrator.ts)): managed Deployment =
   `rebasepro/server:<resolved>` + initContainer that fetches/unpacks the bundle + `npm ci` of declared deps
   into an emptyDir (or pre-baked dep layer cache keyed by lock hash — later optimization). **No Kaniko for
   managed.** Deploy time target: <60s (vs minutes today) — this is a headline feature.
5. Keep Kaniko path untouched for `custom` (it is the escape hatch and the migration default).

**3b. Runtime releases + wave rollouts**
1. New collections: `runtime-releases` (`version`, `channel: stable|canary`, `status`, `notes`) and
   `rollouts` (`release`, `wave`, `status`, health stats). Admin-only (platform staff).
2. Rollout controller (saas cron/worker): for a promoted release, patch managed Deployments' image tag in
   waves (internal/canary tenants → 10% → 50% → all), gated on per-tenant `/health` + error-rate deltas
   from Phase 5 metrics; auto-pause + revert the wave on regression. Tenants may pin
   (`projects.runtimeVersionPin`, nullable, staff-clearable, surfaced in console with a "pinned — you're
   missing security patches" nag).
3. MAJOR handling: a bundle's `runtime.range` selects the stream; controller never crosses majors. Console
   banner + `rebase doctor` prompt drive redeploy-based major migrations.

**3c. Density: shared Postgres + scale-to-zero (free/dev tier)**
1. `databases.type` gains `managed-shared`: one multi-tenant CNPG cluster per region/cell, per-project
   database + role, pgbouncer in front; provisioning creates DB+role instead of a cluster. Paid tier keeps
   dedicated CNPG (`managed`, unchanged) — upgrade = logical dump/restore job (build on existing
   backup/restore machinery, cutover pattern already exists from PITR work).
2. Scale-to-zero for managed pods: KEDA http-add-on (or activator sidecar at ingress) — scale 0↔N on
   request; requires bootFromBundle cold-start budget <2s (measure in Phase 1; lazy-load SMTP/storage
   clients if needed). Dev/free projects default on; paid default min-replicas 1 + HPA on
   CPU+RPS (autoscaling finally honest — replaces the manual `replicaCount`).
3. Capacity ledger: per-cell counters (tenants, DBs, storage HMAC keys) so the ~100-tenant storage
   hard-stop becomes a monitored, cell-sharded limit instead of a surprise.

**Exit criteria:** new project → managed deploy under 60s on platform image; runtime patch release rolled to
all managed tenants by controller with an observed auto-revert test; a free-tier project runs on shared PG
and scales to zero; every pre-existing tenant still on `custom`, untouched.

## Phase 4 — apps in the cloud (registry, keys, hosting, hosted admin)

1. **`apps` collection** in saas (`project`, `name`, `type: backend|static|admin|mobile`, `platform` for
   mobile, `status`, `sourceRepo` note, `schemaVersionBuiltAgainst`). RLS mirrors projects. Registry
   enforces: one backend per project; app-name uniqueness per project; deploys **claim** an app (409 on
   cross-repo collisions — deliberate, that's the multi-repo guard).
2. **Per-app client keys**: publishable key per app (backed by existing API-key model, double-gated
   perms+RLS), issued on registration; `rebase apps config <app>` prints/writes client bootstrap (API URL,
   key). Server tags requests with app-key → per-app attribution for Phase 5.
3. **Static hosting**: bundles of `static` apps → GCS bucket per project (reuse managed-storage plumbing) +
   Cloud CDN + existing ingress/cert machinery (custom-domain verification flow already exists — extend to
   per-app subdomains: `<app>--<project>.apps.rebase.pro`, custom domains attachable per app). SPA fallback
   honoring manifest `spa: true`. Atomic deploys: versioned prefix + pointer flip; instant rollback =
   pointer move (reuse `deployments` rows with `app` column).
4. **Hosted admin default**: `admin.mode: "hosted"` ⇒ no admin in tenant bundle; console Studio (already
   shipped) is the admin surface, gated by existing `studioEnabled` consent. `"bundled"` stays supported for
   self-host/air-gapped.
5. Console: project page grows an Apps section (list, keys, per-app deploys, domains, drift badge
   "built against schema v41, project at v45" via `schemaVersionBuiltAgainst` vs current).

**Exit criteria:** a second repo deploys a static app to a managed project with its own key + subdomain;
mobile app registration issues keys with zero hosting; drift badge fires when the backend schema moves.

## Phase 5 — observability (activity, capacity)

1. **Runtime emission (OSS)**: `@rebasepro/server` exposes `/metrics` (Prometheus format; off by default,
   env-gated) — request count/latency by surface (data/auth/storage/functions/realtime), rows
   read/written, active realtime connections, function invocations+duration, hook errors, schema-drift
   counter, all labeled by app-key where present. Self-hosters get this for free (docs: scrape it).
2. **Cloud pipeline**: per-cell Prometheus (or GMP on GKE) scrapes tenant pods → recording rules → a
   compact per-project rollup written to saas PG (`project-metrics` hypertable-style table: 1m raw → 1h/1d
   rollups, retention tiered by plan). No new datastore until proven necessary.
3. **DB/storage gauges**: CNPG metrics (DB size, connections, replication lag) + storage bytes/object
   counts (existing capacity code) joined into the same rollup.
4. **Console**: project Overview becomes real — RPS/latency charts, per-surface and per-app breakdown, DB
   size vs plan, storage vs plan, realtime connections, deploy markers on the timeline; Capacity panel =
   plan limits with current usage + projected exhaustion. `custom`-runtime projects show pod CPU/mem + logs
   only, with an explicit "switch to managed for full metrics" note (honesty as upsell).
5. Wave-rollout gating (3b) consumes these same rollups — build 5.1–5.3 early enough in parallel that 3b
   doesn't ship blind.

**Exit criteria:** console shows live request charts within 2 min of traffic on a managed project; rollout
controller consumes error-rate rollups; a self-host user can scrape `/metrics` into their own Grafana.

## Phase 6 — migration, docs, pricing surface

1. **Classification sweep:** all existing projects → `custom`, console banner explaining tiers + a
   "Check managed compatibility" button running the validator against their last source snapshot.
2. **CLI-assisted migration:** `rebase migrate-to-managed` = synthesize `rebase.json`, run validator,
   test-build bundle, first managed deploy to a preview URL, then flip. Template-diff report for projects
   whose `index.ts` drifted (classify: cosmetic vs real ejection).
3. **Docs restructure** (all 6 locales, per i18n conventions): Concepts (project/apps/runtime/bundle),
   Deploy-anywhere, Cloud tiers matrix (runtime × database × storage axes), Eject guide, Multi-repo guide.
   `verify:docs` corpus extended to the new CLI surface.
4. **Deprecations (announced, not enforced):** bundled-admin default, backend Dockerfile in template, source
   Kaniko deploys *for managed-eligible projects* (custom stays indefinitely).

---

## Cross-cutting: testing strategy

- **Bundle-corpus CI (the keystone):** repo `fixtures/bundles/` — template output, baas overlay, kitchen-sink
  (every property type, hooks, functions, m2m/junctions, auth variants), ejected-then-migrated, plus
  (cloud-side, private) snapshots of real consenting tenants' bundles. Every server PR boots the new runtime
  against every corpus bundle: schema push, CRUD + RLS smoke, auth flows, functions invoke, contract
  endpoint golden file. **This suite is the license to auto-roll patches; it blocks Phase 3b if red.**
- Wire it into the existing Postgres CI job alongside `test:e2e` (closing the audit's "security tests not in
  CI" item goes first — one line, already scoped).
- Rollout controller: e2e in a kind cluster (extend existing k8s test harness) — promote release, observe
  waves, inject failing health, assert auto-revert.
- Cold-start budget test: bootFromBundle p95 < 2s gate in CI (scale-to-zero depends on it).
- Local-registry (Verdaccio) recipe re-run per phase for published-CLI truth.

## Cross-cutting: saas schema changes (one migration per phase, hand-written per RLS convention)

- P3: `projects.runtimeMode`, `projects.runtimeVersionPin`, `deployments.bundleManifest`,
  `deployments.runtimeVersion`; new `runtime-releases`, `rollouts`; `databases.type += managed-shared`;
  drop `provider/vmSize/enableVpc/vpcCidr` (console references removed first).
- P4: new `apps` (+ per-app key linkage, `deployments.app`).
- P5: `project-metrics` rollup table (+ retention job).
- Every migration: verify against the drizzle skip-forever footgun (`when` ordering) on merge.

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Hook/dep constraint too tight → managed feels crippled | Constraint is validator-enforced with named errors + one-command fallback to `custom`; collect rejection telemetry to decide what to whitelist next |
| npm-install-at-boot slow/flaky for managed pods | Dep-layer cache keyed by lock hash (bake once per unique lockfile, reuse across deploys/scale-ups); ship v1 with initContainer install, optimize behind the same interface |
| Fleet rollout bricks tenants | Corpus CI gate + wave sizing + health auto-revert + tenant pin escape valve; never cross majors |
| Shared PG noisy neighbors | Free/dev tier only at first; per-DB connection caps via pgbouncer; statement timeout defaults; promote-to-dedicated is the paid upsell |
| Multi-repo drift breaks prod frontends | `schemaVersion` stamp in SDK + header + console badge from day one (cheap), `rebase check` CI gate (opt-in) |
| Scope: this is 6 phases across 2 codebases | Phases 1–2 are pure OSS and independently shippable/marketable ("self-host got easier", "multi-repo SDKs") even if cloud phases slip |

## Open decisions (settle before the phase that needs them)

1. **Before P1:** exact managed-tier hook sandbox line (proposed above: JS+deps, no native/fs/child_process) —
   affects manifest fields and validator.
2. **Before P3c:** scale-to-zero tech (KEDA http-add-on vs custom activator) — spike both in kind, pick on
   cold-start + ops burden.
3. **Before P4:** static hosting CDN choice (Cloud CDN on GCS vs Cloudflare in front) — cost + custom-domain
   cert story must compose with the existing ingress/verification flow.
4. **Before P5:** GMP (managed Prometheus) vs self-run per-cell Prometheus — cost at tenant counts.
5. **Pricing** (product, not eng): what the runtime×database×storage matrix maps to as plans; when
   `custom` runtime costs more than `managed` (it should — it's heavier for us).

## Sequencing & dependency graph

```
P1 (OSS entrypoint+bundle) ──► P2 (manifest, apps-CLI, remote SDK) ──► P3a (bundle deploys)
                                                        │                    │
                                                        │            P3b (releases+waves) ◄── needs P5.1–5.3 rollups
                                                        │                    │
                                                        └──► P4 (apps registry/hosting/keys)   P3c (shared PG, scale-to-zero)
                                                                             │
                                                                     P5.4 (console charts)
                                                                             │
                                                                            P6 (migration+docs)
```

P1 and P2 are sequential OSS work. P3a unblocks everything cloud-side. P3b needs the metrics substrate
(start P5.1–5.3 in parallel with P3a). P3c and P4 are parallel tracks after P3a. P6 trails everything and is
mostly docs + tooling.

Rough effort feel (calendar, one strong contributor + review): P1 ~2wk, P2 ~2wk, P3a ~2–3wk, P3b ~2wk,
P3c ~3wk, P4 ~3wk, P5 ~2–3wk, P6 ~1–2wk — ~4 months of focused work end-to-end; first user-visible win
(self-host image + compose) at week ~2, first cloud win (60s managed deploys) around week ~7–8.
