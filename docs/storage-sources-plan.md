# Multiple storage sources, end to end

Plan of record for making multi-bucket storage work identically on managed and
custom runtimes, and for making the cloud console honest about which
configuration is actually in force.

Sibling of [data-sources.md](data-sources.md), which solved the same problem for
databases.

## The problem today

Storage has one destination but three ways in, and nothing tells you which won.

1. **Three independent env readers** parse the same `STORAGE_TYPE`/`S3_*` names:
   [`boot/sources.ts:resolveStorageBackend`](../packages/server/src/boot/sources.ts)
   (managed runtime), the hand-written branch in
   [`templates/eject/backend/src/index.ts`](../packages/cli/templates/eject/backend/src/index.ts)
   (custom builds), and
   [`tenant-storage.ts:describeTenantStorage`](../saas/backend/src/utils/tenant-storage.ts)
   (cloud build-log verdict). Only the first supports named sources.
2. **The console can only ever configure one bucket.** `storageSources` is
   declared in the config package and read at boot inside the container, so the
   control plane never learns a project wants a `media` bucket. The settings form
   writes one flat set of `S3_*` — the default source.
3. **Env vars silently override the settings row**
   ([project-storage.ts](../saas/backend/src/utils/project-storage.ts)) and the
   console never says so, so the form reads as authoritative when it is not.
4. **Named sources are reachable only by hand**, via the `S3_BUCKET__MEDIA`
   suffix scheme, and only on the managed runtime. That is why projects in the
   wild configure storage through custom env vars.

## Target model

Four concerns, each with exactly one home:

| Concern | Home | Notes |
|---|---|---|
| **Topology** — which buckets exist | `rebase.json` → `storage` block | Read by the platform *before* any build; identical for managed and custom |
| **Credentials** — how to reach each | Environment, `<BASE>__<KEY>` suffix | Already implemented; `(default)` takes no suffix |
| **Access model** — who may touch what | `storageAuthorize` in config code | Unchanged; recorded as a manifest boolean |
| **Cloud convenience** — a form instead of env | `storages` row per (project, source) | Rendered into suffixed env; env still wins, but visibly |

```jsonc
// rebase.json
{
  "rebase": "^1",
  "storage": {
    "(default)": { "engine": "s3" },
    "media":     { "engine": "s3",  "label": "Media" },
    "backups":   { "engine": "gcs", "label": "Backups" }
  },
  "apps": { }
}
```

```
rebase.json.storage ──CLI──> manifest.storageSources ──> runtime registry
         │                                                      ▲
         └──deploy payload──> projects.storage_sources           │
                                     │                           │
                              console renders one card per source│
                                     │                           │
                              storages rows ──suffixed env──> tenant Secret
```

Two rules that must not break:

- **Flat `S3_*` keeps working**, meaning the `(default)` source. Every existing
  project must deploy unchanged.
- **Customer env vars keep winning** over the stored row. The rule is load-bearing
  for projects that predate the row being read at all; the fix is to *show* the
  override, not to remove it.

---

## Phase 0 — stop the confusion (independent, ship first)

Nothing here depends on the rest. It is the half of the problem that is purely
"the console does not say what is true".

1. **Show the effective verdict.** `GET /storage-provision/:projectId` already
   returns `effective` / `overridden` / `resolution`
   ([storage-provision.ts](../saas/backend/functions/storage-provision.ts)) and
   the frontend only ever calls the POST
   ([client.ts](../saas/frontend/src/api/client.ts)). Wire it into
   `StorageSettings` and render "these settings are overridden by environment
   variables on this project" where that is the case.
2. **Stop rewriting `type` on save.** `StorageSettings.tsx` unconditionally writes
   `type: "byos"`, so editing any field on a platform-provisioned project rewrites
   its origin. Preserve `managed` when the row was provisioned.
3. **Hide the dead fields.** `bucketName`, `region`, `provider` are written by
   provisioning and read by nothing — `ProjectStorageRow` consumes only `type` and
   `s3*`. Keep the columns as provisioning bookkeeping, mark them read-only, and
   drop them from the customer-facing form so `bucketName` no longer sits beside
   `s3Bucket` looking like a choice.
4. **Fix the two nav labels.** Services → "Storage" is the file browser;
   Infrastructure → "File storage" is the settings form
   ([nav.ts](../saas/frontend/src/views/project/nav.ts)). The names are
   interchangeable and the pages are not.

## Phase 1 — declare topology in `rebase.json`

- `packages/types/src/types/project_manifest.ts`: add `storage?: Record<string,
  {engine, transport?, label?}>` to `RebaseProjectManifest`, and
  `storageSources?: StorageSourceDefinition[]` to `RebaseBundleManifest`.
- Update the published `rebase.json` JSON Schema.
- `packages/cli/src/bundle.ts`: merge the `rebase.json` block with any
  config-exported `storageSources` (code may still add `direct`-transport
  sources), normalize to `StorageSourceDefinition[]`, write into `manifest.json`.
  Validate distinct env suffixes at build time — export the currently-private
  `assertDistinctSuffixes` from `boot/sources.ts` rather than reimplementing.
- `packages/server/src/boot/boot.ts`: prefer `manifest.storageSources`, fall back
  to config exports. Older bundles keep working.
- **Custom builds:** the CLI sends the declared sources in the deploy request on
  *both* paths, and the control plane persists them to a new
  `projects.storage_sources` jsonb. The console then reads one place regardless of
  runtime mode — which is what makes custom builds first-class rather than an
  afterthought.

## Phase 2 — one `storages` row per source

Field-level encryption is per column
([`ENCRYPTED_FIELDS.storages = ["s3SecretAccessKey"]`](../saas/backend/src/hooks/encryption-hooks.ts)),
so a jsonb map of sources would put secrets outside the encryption hook. Row per
source is the only shape that keeps secrets encrypted.

- Migration `00XX_storage_source_key.sql`: add `source_key text not null default
  '(default)'`, unique `(project_id, source_key)`, backfill existing rows.
- `saas/config/collections/storages.ts`: add `sourceKey`, update
  `propertiesOrder`. RLS is project-scoped and needs no change.
- Replace every `find({ where: { project }, limit: 1 })` with a keyed lookup:
  `deploy.ts` (×3), `storage-provision.ts` (×2), `setup-key.ts`,
  `StorageSettings.tsx`, `CreateProject.tsx`.

## Phase 3 — collapse three env readers into one

- `resolveProjectStorage` → `resolveProjectStorageSources(rows)`, returning a
  per-source resolution and rendering env through `envSuffixForKey`, imported from
  `@rebasepro/server` (already exported; saas already depends on it). No second
  copy of the suffix rule.
- `mergeStorageEnv` / `storageEnvIsOverridden` / `projectStorageLogLine` become
  per-source, so the build log names *which* bucket was overridden.
- `describeTenantStorage` takes the declared source list and reports a verdict per
  source.
- **Delete the eject template's hand-written branch** and call the exported
  `resolveStorageSources(env, storageSources, basePath)` instead. This removes
  reader #2 entirely and gives ejected and custom projects multi-bucket for free —
  the single highest-leverage change in the plan.
- Fix `detectStorageAuthorize`: the regex misses `export * from "./storage.js"`,
  producing `authorize: false` and a hard deploy rejection for a project that does
  have a hook.

## Phase 4 — the console shows every source

- `StorageSettings` renders one card per declared source, read from
  `projects.storage_sources`: its key, label, engine, the S3 form, its own
  effective/overridden verdict, and its own Provision button.
- **Declared but unconfigured sources appear explicitly.** That is the
  discoverability that is missing today — the console currently cannot tell you a
  bucket is expected.
- A configured row whose key is no longer declared renders as orphaned rather than
  disappearing, so switching off a source never silently strands its credentials.

## Phase 5 — managed provisioning per source

- `provisionManagedStorage(projectId)` → `(projectId, sourceKey)`. Bucket name
  derives from project id + source key; **one service account per project**, reused
  across that project's buckets.
- The 100-service-account GCP ceiling is therefore unchanged —
  `managed-storage-capacity.ts` still counts one per project and needs no edit.
- The "already has a bucket" conflict check in `storage-provision.ts` becomes
  per-source; `ensureManagedStorage` loops the declared managed sources on deploy.

## Phase 6 — docs and anti-drift tests

- `docs/storage-sources.md`, sibling to `data-sources.md`.
- `website/src/content/docs/docs/backend/storage.md` + all 6 locales; run
  `pnpm verify:docs`.
- **Conformance test:** one table of env fixtures asserted against *both*
  `resolveStorageSources` and `describeTenantStorage`, so the readers can never
  disagree again. This is the regression guard for the defect class that produced
  this plan.

---

## Sequencing

Phase 0 is independent and fixes the reported confusion on its own. Phases 1–2 are
the foundation and should land together. Phase 3 is where the three-reader defect
class dies. Phase 4 is the visible payoff. Phase 5 can trail.

## Compatibility checklist

- [ ] Flat `S3_*` env with no `rebase.json` storage block → one `(default)` source
- [ ] Bundle built before `manifest.storageSources` → config exports → default only
- [ ] Existing single `storages` row → backfilled to `(default)`, byte-identical env
- [ ] Env vars still override the row, on every source, and now say so
