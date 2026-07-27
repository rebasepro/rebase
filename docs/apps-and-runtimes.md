# Apps, runtimes, and the admin

Status: proposal
Scope: `packages/types`, `packages/admin`, `packages/admin-types`, `packages/app`,
`packages/cli`, `packages/server`, `saas`, templates

## Summary

`rebase.json` currently describes a project with four different fields called
`mode`, an app type (`admin`) that has no mechanism behind it, and a
managed-versus-custom distinction that nobody ever writes down. This proposes a
manifest designed as if from scratch, with no migration path:

1. **One authored choice, on the backend: `runtime: "managed" | "custom"`.** Who
   owns the code that runs the server. Nothing else.
2. **Delete `type: "admin"`.** The admin is an app like any other — a static app
   in the user's repository, built from their collections.
3. **Delete `type: "custom"` as an app type.** Ownership is a backend property
   now; an app type for arbitrary containers earns nothing.
4. **Delete `backend.mode`.** The behaviour stays; the field is already implied
   by whether a config package exists.
5. **Where a project runs is not in `rebase.json`.** Rebase Cloud and self-hosted
   are the same artifact pointed at a different destination. That is already true
   in the implementation; only the naming suggests otherwise.
6. **Static apps get a `path`, and several can be served from one process.**
   Required by (2), and required for self-hosting to stay a single container.
7. **Remove the name "CMS" from the product.** It is in exported API, not only in
   prose.

Every field that survives answers a question that cannot be answered from
something else in the file. The result is that a project scaffolded by `rebase
init` runs unchanged on Rebase Cloud or on the user's own Docker host, with the
admin and the public site both served, and no field in the manifest that means
"the cloud does this bit".

## The problem

### `mode` means four unrelated things

| Where | Values | Actually asks |
|---|---|---|
| `apps.<backend>.mode` | `cms` \| `baas` | where collections come from |
| `apps.<admin>.mode` | `hosted` \| `bundled` | who builds the admin assets |
| bundle `manifest.mode` | `cms` \| `baas` \| `static` | what kind of bundle this is |
| project `runtimeMode` | `managed` \| `custom` | who owns the runtime image |

Four axes, one field name, and a vocabulary (`hosted`, `managed`, `bundled`,
`custom`) in which several words mean "not you" in slightly different ways.

### `admin: { mode: "hosted" }` has nothing behind it

`RebaseAdmin` takes collections as a **prop**
(`packages/admin/src/components/RebaseAdmin.tsx:13`), resolved at build time —
in a scaffolded project by `rebaseCollectionsPlugin`, which reads
`config/collections` during the Vite build.

A platform-built admin therefore cannot know a tenant's collections. This is not
"unimplemented"; it is precluded by the component's interface. Accordingly:

- `rebase build` prints `hosted admin panel — nothing to build`
  (`packages/cli/src/commands/build.ts:209`).
- `saas/backend/src/managed/apps-registry.ts` registers an app of type `admin`
  and nothing serves it.

Making it real would mean serializing a `CollectionConfig` across the wire — and
those hold functions (`childCollections?: () => CollectionConfig[]`,
`subcollections`, and the auth collection's `hashPassword` / `sendEmail` /
`onCreateUser`). That is a lossy projection, a new public format, an
authorization decision about who may read a data model, and a compatibility
contract between console and tenant runtimes. It is a product bet, not a naming
fix, and this document does not propose it.

Every comparable product agrees: Payload, Keystone, Strapi and Directus all run
the admin inside the user's own application. Django comes closest to an exception
and still runs its admin in your process, from your installed apps.

### The template contradicts itself

`packages/cli/templates/template/rebase.json` declares:

```json
"backend": { "type": "backend" }
```

— a managed backend, whose entrypoint is the platform runtime. The same template
also scaffolds `backend/src/index.ts`: ~190 lines configuring CORS, auth,
cookies, storage and history, which the managed runtime never loads. `rebase
build` even says so:

> `backend/src/index.ts` is not the bundle's entry point — it is not compiled or shipped.

It is the most important-looking file in a new project, and editing it does
nothing. Worse, `synthesizeManifest` treats the presence of that file as evidence
of an ejected backend and infers `type: "custom"`
(`packages/cli/src/manifest.ts:283`) — so a project that predates the manifest
lands on the custom runtime by default, with all of its costs (see
`docs/cloud-deploy-workspace-vendoring.md`).

### The important choice is never authored

`managed` versus `custom` is *derived* by `assessManagedCompatibility` from
whether some app declares `type: "custom"`. Nobody writes it. The only place it
surfaces is the footer of `rebase apps list`. The single most consequential fact
about a deployment is something a user discovers rather than declares.

## The model

Two axes. They are independent, and conflating them is the source of the
confusion.

### Axis 1 — who owns the backend's code (authored, in `rebase.json`)

- **`managed`** — the platform's runtime image runs your bundle. You supply
  collections, functions, crons and schema; Rebase supplies the server.
- **`custom`** — you supply the server: a Dockerfile and an entrypoint. The
  escape hatch, with no managed-runtime guarantees.

This is the one param.

### Axis 2 — where it runs (not in `rebase.json`)

Rebase Cloud, your Kubernetes, your Docker host, a laptop. This is a property of
the *destination*, not of the repository, and it is **already solved**:
`RebaseProjectLink.project` accepts "a Rebase Cloud project id, or the base URL
of any running Rebase backend… Both are first-class", held per-checkout in
`.rebase/cloud.json`.

### The two axes are already orthogonal in the code

`managed` is not a cloud-only concept, and this is the load-bearing point for
self-hosting. `docker/cloudbuild-runtime.yaml` describes `rebasepro/server` as:

> the image every managed tenant runs and every self-hoster can run: the server
> package plus an entrypoint that boots a project bundle.

And `docker/docker-compose.selfhost.yml` does exactly that — Postgres plus the
published runtime with `./dist-bundle` mounted at `/bundle`, with "no application
image to build".

So all four combinations already work or nearly work:

| | Rebase Cloud | Self-hosted |
|---|---|---|
| **managed** | `cloud deploy --bundle` | `docker-compose.selfhost.yml` |
| **custom** | source build → kaniko | your own `docker build` |

Only the vocabulary implies that `managed` means "give up control" or "must be in
Rebase's cloud". Neither is true. Renaming fixes the perception; nothing in the
architecture needs to move.

## What changes

### The admin is an app

`type: "admin"` is deleted. The admin is a `static` app whose source happens to
be `@rebasepro/admin`, owned by the user, in their repository, built against
their collections. Custom fields and views work on day one because there is no
"hosted" tier to fall out of.

The platform's own surface already exists and is **Studio**: `saas/frontend`
depends on `@rebasepro/studio` and renders `<RebaseStudio/>`. SQL, logs, cron
runs, RLS, storage, schema visualizer, the API explorer — the developer surface
is the platform's, the content surface is the user's app. That boundary is
already a package boundary; the manifest should stop contradicting it.

### App types

`backend`, `static`, `mobile`. That is the whole list.

`custom` is gone: it existed to describe an ejected backend, which is now
`backend.runtime: "custom"`. An app type for arbitrary sidecar containers can be
reintroduced the day someone actually asks for one.

`mobile` stays as it is — registration only, never built or hosted here.

### Collections come from wherever they are

`backend.mode` is deleted. The behaviour is unchanged and both workflows remain
first-class:

- The backend's `config` directory exists → collections come from code, the
  bundle ships them, `db push` creates the tables.
- No config directory → collections are introspected from the live database at
  boot (`packages/server/src/init.ts:248`), which is the headless-API product
  scaffolded today by `rebase init --flavor baas`.

The field never carried information: `synthesizeManifest` already derives exactly
this from whether a config package exists. Removing it also removes the
contradictory state where a manifest declares code-first with no collections
anywhere. The dev-time override already exists as an environment variable
(`packages/cli/src/commands/dev.ts:109`) and stays there, where a debugging
switch belongs.

### `rebase.json`, before and after

Before:

```json
{
    "runtime": "^1",
    "apps": {
        "backend": { "type": "backend" },
        "web":     { "type": "static", "root": "frontend", "output": "frontend/dist", "spa": true },
        "admin":   { "type": "admin", "mode": "hosted" }
    }
}
```

After:

```json
{
    "rebase": "^1",
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" },
        "admin":   { "type": "static", "root": "admin",    "output": "admin/dist",    "path": "/admin" },
        "site":    { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/" }
    }
}
```

Ejecting:

```json
"backend": { "type": "backend", "runtime": "custom", "dockerfile": "Dockerfile", "port": 8080 }
```

The top-level version key is renamed `rebase` so that `runtime` can mean exactly
one thing. It reads like `engines` in a `package.json`, which is what it is.

### Static apps get a `path`, and several can be served

This falls out of making the admin an app, and it is not optional.
`selectFoldableApp` refuses more than one static app:

> `2 static apps (admin, site) — none folded in. Pick one to serve from the backend, or host them separately.`

Since `cloud deploy` only ever deploys the backend bundle, a project with an
admin *and* a site would today deploy with neither. Two changes:

1. **`serveSPA` gains a base path.** It currently hardcodes `app.use("/*", …)`
   (`packages/server/src/serve-spa.ts:70`), so one process can serve exactly one
   SPA. It needs to mount under a prefix, with the `/`-rooted app registered
   last because its catch-all claims everything.
2. **Fold every static app, each at its declared `path`** — instead of picking
   one or refusing.

One container then serves the API at `/api`, the site at `/`, and the admin at
`/admin`. That is the self-hosting story, and it is also a perfectly good cheap
tier on Rebase Cloud.

Deploying static apps to separate pods or a CDN stays available — `bootStaticApp`
already boots a static app with no database and no JWT, "provisioned by the exact
same deployment path as a backend" — but it becomes an optimization rather than a
prerequisite. The same manifest supports both topologies.

## The name "CMS" goes

It is not only prose. These are exported today:

- `registerCMS` / `unregisterCMS` — `packages/admin-types/src/controllers/registry.ts:88`,
  `packages/app/src/hooks/useRebaseRegistry.tsx:15`, called from
  `packages/admin/src/components/RebaseAdmin.tsx:17`
- `useCMSContext` and the `CMSContext` type — `packages/admin/src/hooks/useCMSContext.tsx`,
  re-exported from `packages/admin/src/hooks/index.ts`
- `CMSBasePropertyNoName` — `packages/admin-types/src/types/property_config.tsx:4`
- `CMSNavigationContent` — `packages/admin/src/components/DefaultDrawer.tsx:145`

Plus doc comments throughout `packages/types/src/controllers/data.ts` (about ten
mentions), `properties.ts`, `entity_callbacks.ts`, `data_source.ts` and
`collection_registry.ts`.

The replacement is *admin* throughout: `registerAdmin`, `unregisterAdmin`,
`useAdminContext`, `AdminContext`. It is what the package is called, what the
component is called, and what the app in `rebase.json` is called.

This also removes the last reason to keep `cms` as a manifest value, and it
leaves `rebase init --flavor cms|baas` without a name. The pair does not need
one: the default scaffolds a backend and an admin, and a flag drops the admin.

```
rebase init my-app              # backend + admin
rebase init my-api --headless   # backend only, collections introspected
```

## Self-hosting

The constraint: a project scaffolded by `rebase init` must be able to run on
Rebase Cloud *and* be self-hosted, without editing the manifest.

After this change:

```
rebase build                    # dist-bundle: backend + both SPAs, each at its path
docker compose -f docker/docker-compose.selfhost.yml up -d db
rebase db push
docker compose -f docker/docker-compose.selfhost.yml up
```

…serves the API, the site and the admin from the published runtime image with
nothing built locally beyond the bundle. The same `dist-bundle` uploaded by
`rebase cloud deploy --bundle` runs on the managed tier. `custom` swaps the image
for the user's own in both destinations.

What still needs doing for self-host parity:

- `serveSPA` base paths, per above — without it a self-hoster serves one SPA and
  must put a reverse proxy in front for the other.
- The compose file currently sets no `STORAGE_TYPE`, deliberately (the container
  filesystem loses uploads on restart). Unchanged by this proposal, worth a
  documentation pass alongside it.

## What `rebase init` scaffolds

**One app.** `frontend/` already *is* the admin — it renders `RebaseAdmin` — so
the change is to declare it honestly (a `static` app named `admin`) and delete
the `admin` entry that did nothing. A new project stays something you can run in
thirty seconds, which is what every comparable tool does: `rails new`,
`create-next-app`, `create-strapi-app` and Payload all hand you one working
thing, while Firebase and Supabase hand you config and keep starters in a
separate examples repository.

The two-app shape is taught by a **preset**, not by the default. The machinery
exists — `--template <blog|ecommerce|blank>` — so `blog` ships a minimal public
site alongside the admin, demonstrating two static apps at two paths. Every other
project skips an empty package it never asked for.

## Migration

None. The manifest is small, young, and mostly unused outside the template;
designing around its first draft would cost more than it saves. `type: "admin"`,
`type: "custom"`, `admin.mode` and `backend.mode` are removed outright, and a
manifest using them fails validation with a message naming the replacement.

`synthesizeManifest` — the no-manifest fallback — stays, because projects that
predate the file are real. Two fixes: it should infer `runtime: "custom"` only
when a Dockerfile is actually declared, not from the mere existence of
`backend/src/index.ts`, and it should warn loudly about an entrypoint that will
never be loaded.

`saas` still has `'admin'` and `'custom'` in the `apps_type` pgEnum and in
`managed/apps-registry.ts`; both need a migration once no client sends them.

## Work list

**`packages/types/src/types/project_manifest.ts`**
- `RebaseAppType` becomes `backend | static | mobile`; delete
  `RebaseAdminAppConfig` and `RebaseCustomAppConfig` and their union members.
- `RebaseBackendAppConfig`: add `runtime: "managed" | "custom"`, plus
  `dockerfile?` / `port?` for the custom case; remove `mode`.
- `RebaseStaticAppConfig`: add `path?: string`.
- Rename the top-level version key to `rebase`.
- `RebaseBundleManifest`: drop `entry.admin`; `entry.static` becomes a list of
  `{ path, dir }`; drop `mode`.

**`packages/cli/src/manifest.ts`**
- `APP_TYPES` down to three; delete the `admin` and `custom` validation branches;
  delete the collections-source check.
- Validate `path` (leading slash, no `..`, unique across static apps) and
  `runtime`.
- Rewrite `assessManagedCompatibility` to read `backend.runtime` instead of
  inferring it.
- `resolveBackendPaths`: derive the collections source from whether `config`
  exists.
- Fix `buildableApps` ranking and `synthesizeManifest` per Migration above.

**`packages/cli`**
- `commands/build.ts` — delete the hosted-admin branch.
- `commands/apps.ts` — `describeApp`'s admin and custom cases.
- `fold-static.ts` — fold all static apps at their paths; delete the
  more-than-one refusal.
- `bundle.ts` — multi-static `entry.static`; replace the collections-source
  branches with config-directory presence.
- `commands/init.ts` — `--flavor` becomes `--headless`; drop `TemplateFlavor`.

**`packages/server`**
- `serve-spa.ts` — base-path mounting; register `/` last.
- `boot/bundle.ts` — drop `adminDir` from `LoadedBundle`; `staticDir` becomes a
  list.
- `boot/boot.ts` — mount each static app (`~289`), and `bootStaticApp` (`~371`).
- `init.ts` — collections source from config presence rather than a mode flag.

**Naming purge** (`packages/admin`, `packages/admin-types`, `packages/app`,
`packages/types`)
- `registerCMS` → `registerAdmin`, `unregisterCMS` → `unregisterAdmin`.
- `useCMSContext` → `useAdminContext`, `CMSContext` → `AdminContext`.
- `CMSBasePropertyNoName`, `CMSNavigationContent`, and the doc comments listed
  above.

**`saas`**
- `apps_type` pgEnum migration; `AppType` in `managed/apps-registry.ts`.

**Templates**
- `rebase.json`: drop the `admin` entry, rename `web` → `admin`, add `path`.
- Stop scaffolding `backend/src/index.ts` for a managed backend; move it behind
  `rebase eject`, which flips `runtime` to `custom` and writes the entrypoint and
  Dockerfile together.
- `blog` preset gains a minimal public site as the second static app.
