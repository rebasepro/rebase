# Multi-app projects: one project, several repositories

Status: **implemented** — Phases 0–3, verified against the source 2026-08-23.
Branch `feat/multi-app-projects` in both repositories.

| Phase | Where it landed |
| --- | --- |
| 0 — the guard | superseded by Phase 2 and removed; the commit stands alone if you want it early |
| 1 — app-scoped hosting | migration `0050_app_static_hosting`, `apps.static_deployment_id/path/spa`, `sites/<p>/<app>/<d>/`, `tooling/scripts/migrate-static-prefixes.ts` |
| 2 — path-aware front door | `RouteTable = Map<host, Mount[]>`, `mountsFor`, `RESERVED_BACKEND_PREFIXES` in `@rebasepro/types` |
| 3 — `rebase deploy <app>` | `selectDeployApp`, shared `uploadAndTrigger` |
| 4 — admin from a remote contract | **not built.** Still needs its own spec — see §5. |

Two deviations from what is written below, both deliberate:

- **`projects.static_deployment_id` is not dropped** (§4.1 said "dropped, and its
  data migrated"). Dropping it makes a control-plane rollback fatal rather than
  stale — the previous `load-routes.ts` SELECTs it, so every route-table refresh
  fails and a front door that cannot complete its first load refuses to start.
  It is left vestigial and unread for a later migration. This is trap 8 below,
  decided rather than discovered.
- **`--bundle` is not removed** (§4.6). App selection is derived now, but that
  flag is about bundle-vs-source for a *backend* app, whose counterpart
  `--source` remains. Removing it would drop the only way to force a bundle
  deploy on a repository whose manifest does not declare managed.

Three bugs were found while implementing, all fixed in the phase that exposed
them: retention deleting a sibling app's live site (§2.4, the one this document
predicted), `slice(-0)` making `keep = 1` prune nothing, and
`x-rebase-deployment` reporting the app name as a build id once the layout grew
a segment.
Scope: `saas` (front door, static hosting, apps registry, `deploy`), `packages/cli`
(`deploy`, `build`), `packages/types` (manifest validation).

Prerequisite: `docs/apps-and-runtimes.md` §1–§4. That document established the
manifest model this one builds on, and nothing here changes `rebase.json`. The
manifest already says the right thing; the plumbing under it does not.

---

## 0. How to use this document

- **§1–§2** are the decisions and the failures that motivate them. Read once.
- **§3** is the model. **§4** is normative: where it gives exact shapes, implement
  exactly those.
- **§5** is ordered by dependency. Each phase ends with a verification that must
  pass before the next begins. **Phase 0 ships alone and ships first** — it closes
  a hole that is reachable with supported commands today.
- **§6 is mandatory reading.** Every trap there is either already live or is
  introduced by the naive version of this change.

Rules for the implementer, carried over from `apps-and-runtimes.md`:

1. Do not invent behaviour this document does not specify. If something is
   genuinely undetermined, stop and ask.
2. Line numbers are hints. Find symbols by name.
3. Delete rather than deprecate. No aliases, no accepting the old shape.

---

## 1. Decisions

| # | Decision |
|---|---|
| D1 | The static hosting pointer moves from `projects.staticDeploymentId` to `apps.staticDeploymentId`. One live site **per app**, not per project. |
| D2 | Static object prefixes become app-scoped: `sites/<projectId>/<appName>/<deploymentId>/`. Pruning is scoped to one app. |
| D3 | A host resolves to an **ordered list of mounts**, not a single destination. Longest declared path first, backend last. |
| D4 | The backend permanently owns a set of reserved prefixes. A static app may not declare a `path` that collides with one. |
| D5 | `rebase deploy <app>` is the single verb. The app's `type` selects which deploy path runs. A repository with no backend deploys its static apps and nothing else. |
| D6 | Until D3 ships, a static deploy that would shadow a live backend is **refused**. |
| D7 | An app is served from the front door **or** folded into the backend bundle, never both. Where both exist the front door wins, and the deploy log says so. |
| D8 | `apps` gains `path` and `spa`, written from the bundle manifest at deploy time. The front door cannot route without them and `rebase.json` is not readable from the control plane. |

`rebase.json` is unchanged. So is the bundle format.

---

## 2. Why

### 2.1 One pointer, N apps

`staticDeploymentId` is a single column on `projects`
(`saas/config/collections/projects.ts`), written by `deployStaticBundle`
(`saas/backend/functions/deploy.ts`). The `apps` registry is already per-app and
already models the multi-repo world correctly — `sourceRepo` distinguishes a
redeploy from a takeover, and the hook enforces one backend per project. The
hosting pointer never followed. An admin repo and a frontend repo deploying to
one project overwrite each other's site, and the loser's deploy reports success.

### 2.2 A static deploy takes the whole origin

`destinationFor` (`saas/backend/src/front-door/route-table.ts`) tests
`staticSite` before `namespace`, and a host maps to exactly one destination. So
publishing any static bundle to a project that has a managed backend routes
**100% of that host — `/api` included — to object storage.** The backend keeps
running and stops being reachable. Nothing logs an error; the API simply returns
the SPA's `index.html` to every caller.

This is the one to fix first. It needs no new model, only a refusal.

### 2.3 A static-only repo cannot deploy

`deployBundle` fails with "This repository declares no backend app to deploy as a
bundle" (`packages/cli/src/commands/cloud/deploy.ts`). `rebase build <app>`
happily produces a `kind: "static"` bundle in `dist-bundle-<name>`, and the
control plane happily accepts one — but the only way to connect the two is to
hand-build and pass `--bundle-dir`. The supported path does not exist.

### 2.4 The latent one: prune deletes the other app's live site

`pruneStaticDeployments` (`saas/backend/src/static/publish.ts`) lists
`sites/<projectId>/`, treats every first path segment as a deployment id, and
deletes everything outside the keep set. Under one project prefix with two apps,
**deploying the admin deletes the frontend's live files** — including the prefix
the routing table is still pointing at.

This is why D2 is not cosmetic. Moving only the pointer (D1) without moving the
prefix produces silent data loss on the second app's third deploy.

---

## 3. The model

Two substrates, one routing table.

- **Object storage** serves a static app: no compute, immutable prefixes, a
  pointer switch for deploy and rollback.
- **The tenant pod** serves the backend, plus any static app *folded into its own
  bundle* at build time.

A project may use both at once, and which apps live where is not a global mode —
it is per app, decided by which repository built it. The front door is the only
place that knows the whole picture, because it is the only component that sees
the project rather than a repository.

The routing rule is the rule `serveSPA` already applies inside the runtime:
**longest declared path first, each mount excluding its siblings, catch-all
last.** Using the same rule in both places is worth more than the routing itself
— an app moving from folded to independently deployed must not change what its
URLs mean.

---

## 4. Specification

### 4.1 Schema

Migration `0050_app_static_hosting.sql`. Journal `when` must exceed
`1784880240000` (0049) — a lower value is skipped silently and never runs.

On `apps`:

| Column | Type | Notes |
|---|---|---|
| `static_deployment_id` | `text` null | The live prefix for this app. Server-written. |
| `path` | `text` null | Public base path, e.g. `/` or `/admin`. From the bundle manifest. |
| `spa` | `boolean` null | Serve `index.html` for unmatched paths under `path`. |

Declare all three in `saas/config/collections/apps.ts`. **Do not** hand-edit
`saas/backend/src/schema.generated.ts`: `prebuild` rewrites it on every build,
including inside the Docker image, and emits exactly what the collections
declare. This is the failure 0044 already caused once — the column existed, the
front door read it, nothing declared it, and every image built after that shipped
a Drizzle table without it. A declaration is the only thing that survives.

`projects.staticDeploymentId` is **dropped**, and its data migrated: for each
project with a non-null value, set it on that project's single static app, or on
a synthesized app row named `web` when none exists. No dual-read period.

Extend the client-write refusal in `saas/backend/src/hooks/project-hooks.ts` to
the new columns on `apps` — repointing a site is a deploy, not a field edit.

### 4.2 Prefix layout and pruning

```
sites/<projectId>/<appName>/<deploymentId>/…
```

- `staticPrefix(projectId, appName, deploymentId)`
- `staticAppPrefix(projectId, appName)` — the unit of pruning
- `staticProjectPrefix(projectId)` — unchanged, still the unit of teardown

`pruneStaticDeployments` takes an `appName` and lists `staticAppPrefix`. Its
first-segment parse changes accordingly. Everything a project has ever published
remains a single prefix, so teardown and lifecycle rules are unaffected.

Existing objects live at `sites/<projectId>/<deploymentId>/`. Migrate by copying
the live deployment's objects to the new prefix under its app name, leaving the
old ones for the next teardown to sweep. A prefix nothing points at costs storage
and nothing else; a prefix moved out from under a live pointer is an outage.

### 4.3 The routing table

`Destination` is unchanged. `RouteTable` becomes:

```ts
export interface Mount {
    /** Public base path. "/" is the catch-all. No trailing slash except root. */
    path: string;
    destination: Destination;
}

export type RouteTable = Map<string, Mount[]>;
```

The host lookup stays a `Map` — a linear scan over a few thousand tenants per
request is the cost the `Map` exists to avoid, and that reasoning is unchanged.
The scan that is added is over one project's mounts, which is one to three
entries.

`buildRoutes` emits, per host, in this order:

1. **Reserved backend prefixes** (§4.4), when the project has a backend
   destination. These are emitted first and are not overridable.
2. **One mount per static app** with a non-null `static_deployment_id`, sorted by
   path length descending.
3. **The backend destination at `/`**, when there is one.

A `suspended` project emits exactly one mount at `/` — a stopped project must not
keep serving its bucket, which is the ordering `destinationFor` already gets
right and must keep.

`resolveDestination(table, host, pathname)` returns the first mount whose path is
`/` or is a prefix of `pathname` at a segment boundary. Segment boundary, not
string prefix: `/admin` must not claim `/administrators`.

A project with no backend and no published static app contributes no entries, as
today.

**The loader must read apps.** `LoadRoutesOptions.loadProjects` returns rows that
carry their static apps:

```ts
staticApps?: { name: string; path: string; spa: boolean; deploymentId: string }[];
```

One query joining `apps` where `static_deployment_id is not null`, grouped by
project. An app row missing `path` is skipped and warned about rather than
defaulted to `/` — defaulting would silently give it the catch-all and take the
backend off the air, which is §2.2 reintroduced through a null.

### 4.4 Reserved prefixes

```ts
export const RESERVED_BACKEND_PREFIXES = ["/api", "/health", "/livez", "/metrics"];
```

Two enforcement points, both required:

- **`packages/cli/src/manifest.ts`**, in `checkAppPath`: a static app's `path` may
  not equal or nest under a reserved prefix. This is where a developer finds out,
  and the message names the prefix.
- **The control plane**, at deploy intake: the manifest check is client-side, and
  the front door's correctness cannot rest on a check that ran in someone else's
  CLI.

### 4.5 Serving a mount

`resolveStaticRequest` receives the pathname **with the mount path stripped**:

```
request  /admin/assets/x.js
mount    /admin
key      sites/<p>/admin/<d>/assets/x.js
```

The assets were built for `/admin` via `REBASE_APP_BASE`, so their in-bundle keys
are already app-root-relative. Passing the unstripped path looks for
`…/<d>/admin/assets/x.js` and 404s every asset while `index.html` loads — the
blank-page failure `assertBuiltForPath` exists to prevent, arriving from the
other side.

The SPA fallback resolves to the mount's own `index.html`, never the root app's.

### 4.6 `rebase deploy <app>`

One verb. The app's declared `type` selects the path:

- `backend` → build bundle, fold this repo's static apps, upload, trigger.
  Unchanged behaviour.
- `static` → `buildStaticBundle`, upload, trigger. The control plane's existing
  `decision.kind === "static"` branch handles it.

With no argument: the backend if this repository declares one, otherwise the sole
static app, otherwise an error listing the apps and asking which. A repository
with no backend must reach the cloud without a flag — that is the whole point.

`--bundle` becomes derived and is removed. `--bundle-dir` stays; it is the escape
hatch for a prebuilt artifact.

The deploy body carries `app` (the name) and the static bundle's `entry.static[0]`
`path` and `spa`, which is what §4.1's columns are written from. It already
carries `declaredApps`; that registration path is unchanged and still runs.

### 4.7 The interim guard (D6)

Before §4.3 exists, `deployStaticBundle` refuses when the project has a live
backend — a non-null `namespace`, or an `externalHost`:

> Publishing a static site to this project would route every request, including
> `/api`, to object storage and take the backend off the air. Fold the app into
> the backend's bundle with `rebase build`, or deploy it to a project of its own.

This is a real restriction with a real workaround, and it is removed by Phase 2.

---

## 5. Execution plan

### Phase 0 — close the hole *(shipped, then superseded)*

`saas/backend/functions/deploy.ts` only: §4.7.

**Verify.** A project with a namespace refuses a static deploy with that message.
A project without one still publishes. Existing static projects redeploy
unaffected.

Ship this alone. Everything below can take as long as it takes.

### Phase 1 — app-scoped hosting *(shipped)*

Migration 0050, collection declarations, prefix functions, `pruneStaticDeployments`
scoped by app, `deployStaticBundle` writing the app row instead of the project
row, the data and object migrations, `project-hooks` refusal extended.

The front door still reads one site per project in this phase — read the app
row's pointer where it read the project's, taking the app at `/` when there are
several. Behaviour is deliberately unchanged; only the storage moves.

**Verify.** `saas/backend/src/static/deploy-static.test.ts` extended: two apps on
one project, three deploys each, alternating. Both live prefixes survive; each
app prunes only its own. This test is the reason Phase 1 exists separately —
run it before Phase 2 makes the second app reachable.

### Phase 2 — path-aware front door *(shipped)*

`destinations.ts`, `route-table.ts`, `load-routes.ts`, `app.ts`, reserved
prefixes in both enforcement points, mount-path stripping.

**Verify.** Extend `route-table.test.ts`: backend + static at `/admin` →
`/api/x` reaches the pod, `/admin/assets/x.js` reaches the bucket with the
stripped key, `/administrators` reaches the pod, `/` reaches the pod. Static at
`/` + backend → `/api/x` still reaches the pod. Suspended wins over both.
Then remove Phase 0's guard, and only then.

### Phase 3 — `rebase deploy <app>` *(shipped)*

CLI only, per §4.6.

**Verify.** A repository containing only a static app deploys to an existing
project and is served at its path. `packages/cli/src/manifest-consistency.test.ts`
covers the reserved-prefix rejection.

### Phase 4 — the admin from a remote contract *(not built)*

Not required by anything above; a separate admin repository is what wants it.
`RebaseCMS` takes collections as a build-time prop, so an admin repo needs
definitions rather than the types `generate-sdk --from` produces.

The pieces exist: `/api/meta/contract` serves serialized definitions,
`deserializeCollections` (`packages/types/src/types/collection_contract.ts`)
rehydrates them and already ships in `@rebasepro/types`, and the endpoint is
gated by `createRequireAuth + requireAdmin` — which **an admin user's own session
satisfies**. So the shape is: the admin app boots, authenticates the user, fetches
the contract as that user, and renders.

Do not solve this with a build-time fetch. It would need a service key at build
time, in CI, in a client repository — the credential this codebase already
refuses to attach to an arbitrary host in `generate_sdk.ts`.

Specify separately before building.

---

## 6. Traps

1. **Prune is the data-loss one.** §2.4. Moving the pointer without moving the
   prefix passes every test that deploys each app once.

2. **Do not hand-edit `schema.generated.ts`.** §4.1. It has already eaten one
   column that the front door depended on, and the symptom was a static site
   silently ceasing to be recognised as one.

3. **A null `path` must not default to `/`.** §4.3. It hands the catch-all to a
   static app and takes the backend off the air — the exact failure this plan
   exists to remove, arriving through a missing value instead of a routing rule.

4. **Strip the mount path before the object key.** §4.5. `index.html` loads,
   every asset 404s, no server error.

5. **Segment-boundary prefix matching.** `/admin` must not claim
   `/administrators`.

6. **Ordering: suspended first, reserved second, longest static third, backend
   last.** Any other order breaks something that currently works. `destinationFor`
   gets suspended-first right today; keep it.

7. **Folded and front-door copies of one app.** D7. The front door wins because it
   never reaches the pod. Say so in the deploy log — a developer looking at a
   stale folded copy that is no longer being served has no way to discover why.

8. **The migration is not reversible.** Dropping `projects.staticDeploymentId`
   after copying it forward means a rollback of the control plane serves nothing
   for every static project. Deploy Phase 1's code before its migration, or
   accept that the rollback is forward-only. Decide explicitly; do not discover
   it.
