# Platform Audit — Managed Runtime, Bundles & Apps (2026-07-24)

> **Status update (same day, after the audit).** Both branches were merged and pushed to their mains
> (OSS `865062639`, saas `5341141`). Then fixed: **4 of the 5 deploy-chain blockers** (version scheme split
> with digest pinning, `curl`→node fetch, NetworkPolicy egress, storage access model rejected at intake),
> **both rollout criticals** (C1 vacuous health gate, M2 wave-plan shape), plus H6 `--ignore-scripts`, M5
> dead drift badge, and M6 static-bundle rejection. Migrations 0027 and 0028 added.
>
> **Still open — do not onboard a managed tenant until these land:** chain item #5 (**no schema apply** —
> collection tables are never created, so `/api/data/*` 500s), C2 (image provenance: `0.10.0` still names two
> different artifacts, no CI publish, mutable tag), H1/H2 (bundle upload buffers 100MB through the control
> plane; no GC or quota), M3/M4 (no deploy heartbeat, no controller lease), and the bundle-corpus
> conformance CI. See "Recommended order" — items 1(e), 3, 4.

**Scope:** the platform-rethink implementation (PLATFORM-PLAN-2026-07.md) across both halves — OSS
`feat/platform-runtime-bundle` (merged to main `865062639` today) and cloud `feat/managed-runtime-bundle`
(merged to saas main `5341141` today; control plane already deployed to prod). Method: 4 parallel deep-dives
(OSS branch, cloud managed tier adversarial, plan-vs-reality + prior-audit status, cross-repo seam
coherence), every finding traced to file:line. Complements AUDIT-2026-07-23.md.

## Verdict

The architecture is right and the hard security parts hold: per-tenant derived keys with domain-separated
labels and constant-time compares, RLS on the new collections matching the migration SQL exactly, no
cross-tenant path to bundles or metrics, image tags never customer-influenced, a genuinely well-factored
pure-core (intake/rollout/semver/manifest all honestly unit-tested). **But the managed tier does not work
end-to-end yet** — the failures are concentrated exactly at the seams the tests never cross: where pure
logic meets the mutated DB row, the NetworkPolicy, the Docker image contents, and the other repo. The first
real managed deploy fails five separate ways in sequence, and the fleet-rollout safety story (the reason
this tier exists) is currently vacuous. Nothing here is architectural rework; it is 1–2 weeks of seam fixes
plus the conformance test the plan already called the keystone.

## The first-deploy failure chain (each independently fatal, in order of encounter)

1. **Intake rejects every bundle.** CLI scaffolds `runtime: "^1"` (contract-major semantics,
   `cli/src/manifest.ts:29`) but cloud intake matches ranges against **release version strings** and the only
   prod release is `0.10.0` → `satisfiesRange("0.10.0","^1")` = false → `NO_MATCHING_RUNTIME`
   (`intake.ts:148-152`, `semver.ts:63-75`). Two version universes: contract-line vs package-version.
2. **Tenant egress NetworkPolicy drops the bundle fetch.** Init container curls the control plane on `:3002`
   cross-namespace; egress allows only DNS, same-namespace, and TCP 80/443 (`orchestrator.ts:2381-2434`).
   Pod wedges in Init. (Ingress for metrics scrape is fine — it's the egress direction that's blocked.)
3. **`curl` does not exist in the runtime image.** Init script uses curl (`managed/deployment.ts:130-132`)
   but the image is `node:22-slim` + tini + ca-certificates only (`docker/server.Dockerfile:81-87`) —
   verified empirically. Use `node -e 'fetch(...)'` instead.
4. **Storage-enabled tenants refuse to boot.** Cloud sets `STORAGE_TYPE=s3` but never an access-control
   opt-in; a stock bundle exports no `storageAuthorize` → `assertStorageAccessControlConfigured` throws in
   prod (`init/storage.ts:120-133`). (No-storage projects boot fine → storage 501.)
5. **Collection tables are never created.** `REBASE_MIGRATE_ON_BOOT` is declared (`boot/env.ts:45`) but read
   by nothing; `runManagedDeployJob` applies no schema. First tenant: auth works, every `/api/data/*` 500s.

   **Design note for whoever picks this up (the one blocker left).** The pieces exist but do not compose yet.
   `generatePostgresDdl(collections)` (`server-postgres/src/schema/generate-postgres-ddl-logic.ts:193`)
   already emits full DDL in-process from collection configs — no atlas, so it can run inside the runtime
   image, which has no CLI. But it emits bare `CREATE TABLE`, not `IF NOT EXISTS`: it is a *fresh-database*
   script and will error on the first existing table. A managed applier therefore needs an
   introspect-and-diff step (`schema/introspect-runtime.ts` is the starting point) emitting only missing
   `CREATE TABLE` / `ADD COLUMN`. Recommended contract: **additive-only, never a drop.** That makes it
   safe by construction (the managed tier can never lose a column to an automated apply), covers new
   project / new collection / new field — which is the whole common path — and leaves renames and removals
   to a deliberate human migration. Policies are already idempotent (`DROP POLICY IF EXISTS` then `CREATE`,
   `:86`) so RLS can be re-applied wholesale each time. Wire it to the `REBASE_MIGRATE_ON_BOOT=ensure` that
   already exists in the env schema, and make the managed deploy path set it. Not started deliberately: this
   writes DDL to customer databases and is the wrong thing to half-build.

## CRITICAL

- **C1 — Rollout health gate is vacuous; revert can never fire.** `provisionManagedRuntimeVersion` updates
  `projects.runtimeVersion` on move (`deploy.ts:1021`); the next tick re-derives wave targets from the
  refreshed list, so every moved project is no longer eligible, the wave's target set is empty, health is
  `healthy` with zero observations (`rollout.ts:180`), and the rollout advances a wave per 3-min tick.
  Metrics are never scraped for a moved wave; the revert path filters an empty set (dead code); the
  revert-to-`currentVersion` fallback would revert to the *bad* version. A bad release reaches the whole
  fleet in `waves × 3 min` with "watch and revert" inoperative. Tests pass because every fake hard-codes
  `currentVersion` and never simulates the side effect. Fix: judge waves against stored `movedProjectIds` /
  a pre-move version snapshot, never a re-derived eligible set. Also `observationFromMetricsText` always
  returns `ready: true` (`metrics-rollup.ts:239`) — `ready:false` regression is unreachable even in principle.
- **C2 — "0.10.0" is not one artifact.** npm `@rebasepro/server@0.10.0` was published from pre-merge main
  (no `bootFromBundle`, no bin); the AR image `rebasepro/server:0.10.0` was built from the then-unmerged
  branch via an **untracked** `cloudbuild-runtime.yaml`, and the tag was already mutated once today
  (orphaned digest in AR). The cloud resolves images by mutable tag (`deployment.ts:162-167`). The
  `bundleFormat`/`contract` handshake only defends declared bumps — a silent rebuild under the same tag is
  the silent late-night failure. Fix: commit the build config, publish via CI on tags, store + deploy by
  digest (`runtime_releases.imageDigest` exists but is unused).

## HIGH

- **H1 (cloud) — Bundle upload/download buffers whole tarballs through the 512Mi control plane.**
  `deploy.ts:2573,2629` double-copy up to 100 MB per request; every pod restart and every rollout wave
  re-fetches through control-plane heap; two concurrent fetches ≈ OOMKill of the thing that also serves
  console/billing. Any org member can trigger at will. Needs streaming or pre-signed handoff + quota.
- **H2 (cloud) — No bundle GC, quota, or rate limit.** New random key per upload, nothing ever deletes
  `bundles/*`; a member-role invitee can loop 100 MB uploads into GCS at platform cost (`bundle-store.ts:42`,
  `deploy.ts:2562`).
- **H3 (OSS) — Native-dep detection has structural false negatives.** Only top-level `node_modules` roots
  and only `dependencies` are walked (`cli/src/bundle.ts:328-398`) — pnpm's `.pnpm` layout and
  `optionalDependencies` (the standard prebuilt-binary pattern) are invisible → `hooks.native: false` lies,
  bundle passes intake, tenant crash-loops at boot where `--ignore-scripts` guarantees no rebuild.
- **H4 (OSS) — `REBASE_MIGRATE_ON_BOOT` is accepted, documented, and inert** (`boot/env.ts:45`; only
  `entrypoint.mjs:88-100` glances at it). `none` still runs auth-table DDL; docs contradict each other on
  the default. Related: this is also failure-chain #5 — the managed path needs a real schema-apply story.
- **H5 (OSS) — Two boot paths ship simultaneously.** Template still contains the 207-line
  `backend/src/index.ts`; `rebase dev` runs it while `rebase start`/managed runs `bootFromBundle`
  (`dev.ts:453-455`) — dev does not predict prod, and the shipped `template/rebase.json` contradicts
  `synthesizeManifest`'s ejection classification.
- **H6 (seam) — Init container runs `npm install` WITHOUT `--ignore-scripts`** (`deployment.ts:140-141`)
  while the entrypoint insists on it (`entrypoint.mjs:60-64`) — the init container runs first and wins, so
  arbitrary install scripts execute at tenant boot, voiding the hermetic-boot design. Plus no lockfile is
  ever packed (plan's `node_modules-lock.json` unimplemented): non-reproducible boots, registry-trusting.

## MEDIUM

- **M1 — The semver matcher can't represent the platform's own reality:** prerelease rejected outright
  (`semver.ts:22-27`) so the `canary` channel is dead weight; caret-on-0.x pins the minor, so `^0.10.x`
  bundles never get 0.11; `runtime_releases.version` has no shape validation; range grammar unvalidated
  CLI-side (`1.x`, `*` build fine, die at intake — and `"*"` in `rollout-controller.ts:99` parses to null,
  silently excluding pre-0026 projects from every rollout).
- **M2 — Console-authored rollouts are silent no-ops.** `wavePlan` is `type: "map"` (object) but the cron
  requires an array (`rollout-cron.ts:71`); an admin-UI rollout instantly `completed` having done nothing.
  No other authoring surface exists.
- **M3 — Managed deploys emit no heartbeat** → control-plane crash mid-deploy 409-blocks the project for
  60 min (`deploy.ts:444,478-486`); two concurrent managed POSTs can interleave k8s patches (no lock).
- **M4 — Rollout controller runs on every replica with no lease/CAS** (`crons/rollout-controller.ts:11-13`).
- **M5 — The drift badge is permanently dead.** `apps.schemaVersionBuiltAgainst` is read by the console
  (`apps-display.ts:63-69`) but never written by `ensureBackendApp` (`deploy.ts:1030-1060`). 15-min fix.
- **M6 — `mode: "static"` bundles are rejected by cloud** (`bundle-manifest.ts:75` accepts only cms|baas)
  while OSS docs say they deploy through the identical path.
- **M7 — A second full engine copy installs beside every bundle and wins driver resolution**
  (`bundle.ts:476-502` RUNTIME_PROVIDED excludes the server but not `server-postgres`, whose install drags
  the whole engine into `/bundle/node_modules`; `boot.ts:124-128` tries bundle roots first) — partially
  defeats image-swap fleet patching; no version-agreement check between the two copies.
- **M8 — Unauthenticated `/health` leaks raw driver error strings** (internal hostnames/roles) for
  secondary data sources (`boot.ts:238-249`).
- **M9 — The `/api/meta/contract` auth gate has zero test coverage** (`init.ts:1559-1579` is good
  fail-closed design; `contract-routes.test.ts` tests the ungated router only).
- **M10 — The manifest contract is duplicated across repos with no drift test** — `bundle-manifest.ts:14`
  even cites "the contract-drift test below", which does not exist. The metrics-rollup fixture is likewise a
  hand-written mirror, able to catch cloud regressions but never OSS format changes.

## What's genuinely solid (don't regress)

Per-project bundle auth (HMAC service key, `timingSafeEqual`, 16-byte random ids, traversal-proof), metrics
token domain separation + applied-last so tenants can't disable the health signal, RLS on
apps/releases/rollouts matching config exactly (diffed), admin-only releases, one-backend-per-project
enforced at the DB, no customer-influenced image tags, SSRF-clean init fetch, egress policy blocks metadata,
migrations 0025/0026 idempotent with journal ordering verified, integer-column gotchas handled, OSS contract
endpoint fail-closed, Docker image non-root, ambient-key handling in remote generate-sdk.

## Plan coverage (terse)

**Done:** Contracts A/B/C core (rebase.json + loader + published schema, build→bundle, bootFromBundle +
bin + Dockerfile + compose), app-aware build, self-host `rebase link <url>`, contract endpoint + remote
generate-sdk, cloud intake/deploy/orchestrator/releases/rollouts/apps registry/Apps+Activity tabs, OSS
/metrics (partial metric set), migrations.
**Missing:** bundle-corpus CI (the plan's self-declared keystone and 3b-blocker), cold-start p95 test,
Verdaccio re-run, image publish CI, template slimming, `rebase init --app static`, X-Rebase-Schema
request-header drift counting, per-app keys, static hosting, hosted-admin mode, shared-Postgres density,
scale-to-zero, capacity ledger, dead-column retirement, migrate-to-managed, docs beyond one en-only page,
metrics persistence (rollup table/retention — Activity holds ~5 min of browser state).

## Prior audit (2026-07-23) status

**Fixed on main:** P0 #1 list-read caps, #2 RLS e2e in CI, #4 storage safe default + traversal, #6
first-run docs, #7 db push fail-closed + role-complete backups.
**Still open:** P0 #3 realtime refetch storm (path-only matching unchanged — the scale ceiling under the
managed tier); P1: MCP hardening (shell-injection RCE `mcp/index.ts:846,1239`, unconditional admin, hardcoded
`fcms-` key in plugin-ai, README still says point at prod), per-tenant pool exhaustion (~10 tenants/instance),
real FTS (still ILIKE), offline-sync data loss (mutation ids exist but never sent as idempotency keys), CMS
drafts/versioning, `@hono/node-server` still 2.0.4 in `@rebasepro/server`, auth-table RLS/comma-roles P2s.
**Unverifiable from repo:** ingress IP reservation, live netpol state.

## Recommended order

1. **Before any managed tenant** (incl. dadaki): fix the 5-step deploy chain — version-scheme decision
   (`>=0.10` scaffold or contract-line releases + `imageTag` column), netpol egress rule to `rebase-saas:3002`,
   `node -e 'fetch'` instead of curl, storage opt-out/intake requirement, schema-apply job. Fix C1 and M2
   before the first real rollout. (~1 week)
2. **The keystone test:** OSS CI job that builds a template bundle, runs the *literal* init-container script
   inside the freshly built image against a stub bundle server, asserts /livez + /health + /metrics; golden
   metrics fixture generated not hand-written; manifest round-trip fixture shared with cloud. This single
   suite would have caught chain #1/#2/#3/#4/#5, H6, M6, M10. (~1-2 days)
3. **Provenance:** commit cloudbuild-runtime.yaml, CI-publish image on tags, deploy by digest. (~0.5 day)
4. **Abuse surface before opening to customers:** bundle streaming/pre-signed handoff, GC + per-project
   quota + rate limit, deploy heartbeat, controller lease. (~1 week)
5. **Then** the carried-over P0/P1s: realtime refetch storm, MCP hardening + key rotation, pool budget.
