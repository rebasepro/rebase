# Apps, runtimes, and the admin

Status: **proposal — implementation-ready**
Scope: `packages/types`, `packages/admin`, `packages/admin-types`, `packages/app`,
`packages/cli`, `packages/server`, `saas`, templates

---

## 0. How to use this document

This is written to be executed by someone with no prior context on the problem.

- **§1–§3** are the decisions and why they were made. Read once.
- **§4** is the specification. It is normative: where it gives exact types or
  behaviour, implement exactly that.
- **§5** is the execution plan, in phases. **Phases are ordered by dependency.**
  Each phase ends with a verification step that must pass before moving on.
- **§6 is mandatory reading.** Every trap listed there has already caused a
  silent failure in this codebase or a closely related one.

Rules for the implementer:

1. **Do not invent behaviour this document does not specify.** If something is
   genuinely undetermined, stop and ask. There is no back-compatibility
   requirement, so the temptation to "keep both paths working" is always wrong.
2. **Line numbers are from the state of the repository when this was written.**
   Treat them as hints; find the symbol by name, not by line.
3. **Delete rather than deprecate.** No aliases, no `@deprecated` shims, no
   accepting the old shape "for now". See §5 Phase 0 note on migration.

---

## 1. Decisions

| # | Decision |
|---|---|
| D1 | The backend declares `runtime: "managed" \| "custom"`. This is the only place either word appears in an authored file. |
| D2 | `type: "admin"` is deleted. The admin is an ordinary `static` app in the user's repository. |
| D3 | `type: "custom"` is deleted as an app type. Ownership is a backend property. |
| D4 | `type: "mobile"` is deleted. Nothing consumes it. |
| D5 | `backend.mode` (`cms`/`baas`) is deleted. Behaviour is unchanged and derived from whether a config directory exists. |
| D6 | The bundle manifest's `mode` becomes `kind: "backend" \| "static"`. |
| D7 | Static apps declare a `path`. Several are served from one process. |
| D8 | The top-level version key is renamed `runtime` → `rebase`. |
| D9 | ~~The name "CMS" is removed from the product, including exported API.~~ **Dropped.** New code says "admin"; the existing `registerCMS` / `useCMSContext` / `CMSBasePropertyNoName` exports stay as they are. See §4.7. |
| D10 | `rebase init` scaffolds one app. Multi-app is taught by a preset. |
| D11 | `rebase eject` is the supported route from `managed` to `custom`. |

Resulting app types: **`backend` and `static`.** That is the whole list.

---

## 2. Why

### 2.1 `mode` means four unrelated things

| Where | Values | Actually asks |
|---|---|---|
| `apps.<backend>.mode` | `cms` \| `baas` | where collections come from |
| `apps.<admin>.mode` | `hosted` \| `bundled` | who builds the admin assets |
| bundle `manifest.mode` | `cms` \| `baas` \| `static` | what kind of bundle this is |
| project `runtimeMode` (saas) | `managed` \| `custom` | who owns the runtime image |

Four axes, one field name, and a vocabulary (`hosted`, `managed`, `bundled`,
`custom`) in which several words mean "not you" in slightly different ways.

### 2.2 `admin: { mode: "hosted" }` has no mechanism

`RebaseAdmin` takes collections as a **prop**
(`packages/admin/src/components/RebaseAdmin.tsx:13`), resolved at build time by
`rebaseCollectionsPlugin` reading `config/collections` during the Vite build.

A platform-built admin therefore cannot know a tenant's collections. This is not
"unimplemented"; it is precluded by the component's interface:

- `rebase build` prints `hosted admin panel — nothing to build`
  (`packages/cli/src/commands/build.ts:209`).
- `saas/backend/src/managed/apps-registry.ts` registers an app of type `admin`
  and nothing serves it.

Making it real would mean serializing `CollectionConfig` across the wire, and
those hold functions — `childCollections?: () => CollectionConfig[]`,
`subcollections`, and the auth collection's `hashPassword` / `sendEmail` /
`onCreateUser` (`packages/types/src/types/collections.ts:51`). That is a lossy
projection, a new public format, an authorization decision about who may read a
data model, and a compatibility contract between console and tenant runtimes. It
is a product bet, not a naming fix, and **this document does not propose it.**

Every comparable product agrees: Payload, Keystone, Strapi and Directus all run
the admin inside the user's own application. Django comes closest to an exception
and still runs its admin in your process, from your installed apps.

### 2.3 The template contradicts itself

`packages/cli/templates/template/rebase.json` declares `"backend": { "type":
"backend" }` — a managed backend, whose entrypoint is the platform runtime. The
same template also scaffolds `backend/src/index.ts`: ~190 lines configuring CORS,
auth, cookies, storage and history, which the managed runtime never loads.
`rebase build` says so out loud:

> `backend/src/index.ts` is not the bundle's entry point — it is not compiled or shipped.

It is the most important-looking file in a new project, and editing it does
nothing. Worse, `synthesizeManifest` treats its presence as evidence of an
ejected backend and infers `type: "custom"` (`packages/cli/src/manifest.ts:283`),
so a project predating the manifest lands on the custom runtime by default, with
all of its costs (`docs/cloud-deploy-workspace-vendoring.md`).

### 2.4 The consequential choice is never authored

`managed` versus `custom` is *derived* by `assessManagedCompatibility` from
whether some app declares `type: "custom"`. Nobody writes it. The only place it
surfaces is the footer of `rebase apps list` — while the platform has modelled it
as a first-class column all along (`projects_runtime_mode` pgEnum,
`saas/backend/src/schema.generated.ts:25`).

### 2.5 Nothing consumes `mobile`

`type: "mobile"` is validated (`manifest.ts:168`), excluded from builds
(`manifest.ts:395`), labelled in `apps list` (`apps.ts:89`) and stored as an enum
value. No code issues client credentials or generates configuration for it. Its
own doc comment promises "it gets client credentials and configuration"; that
code does not exist. It is a dropdown entry.

---

## 3. The model

Two axes. Conflating them is the source of the confusion.

### Axis 1 — who owns the backend's code (authored, in `rebase.json`)

- **`managed`** — the platform's runtime image runs your bundle. You supply
  collections, functions, crons and schema; Rebase supplies the server.
- **`custom`** — you supply the server: a Dockerfile and an entrypoint. The
  escape hatch, with no managed-runtime guarantees.

### Axis 2 — where it runs (**not** in `rebase.json`)

Rebase Cloud, your Kubernetes, your Docker host, a laptop. A property of the
*destination*, and already solved: `RebaseProjectLink.project` accepts "a Rebase
Cloud project id, or the base URL of any running Rebase backend… Both are
first-class", held per-checkout in `.rebase/cloud.json`.

### The axes are already orthogonal in the implementation

`managed` is not a cloud-only concept, and this is load-bearing for self-hosting.
`docker/cloudbuild-runtime.yaml` describes `rebasepro/server` as:

> the image every managed tenant runs and every self-hoster can run: the server
> package plus an entrypoint that boots a project bundle.

`docker/docker-compose.selfhost.yml` does exactly that — Postgres plus the
published runtime with `./dist-bundle` mounted at `/bundle`, "no application
image to build".

So all four combinations already work or nearly work:

| | Rebase Cloud | Self-hosted |
|---|---|---|
| **managed** | `cloud deploy --bundle` | `docker-compose.selfhost.yml` |
| **custom** | source build → kaniko | your own `docker build` |

Only the vocabulary implies `managed` means "give up control" or "must be in
Rebase's cloud". Renaming fixes the perception; nothing in the architecture moves.

### Why `runtime` is authored while other fields are inferred

This document deletes `admin.mode` and `backend.mode` on the principle *delete
the field, it is implied by data already in the file* — then makes `runtime` an
explicit field, although it too could be inferred from the presence of a
`dockerfile`. That is deliberate, and the distinction is:

- `admin.mode` and `backend.mode` were **redundant restatements** of structure.
  Getting them wrong produced a validation error or a contradiction.
- `runtime` is the **single most consequential fact** about a deployment, and
  §2.4 shows the actual harm of leaving it derived: users cannot see it, and a
  scaffolded project silently lands on the escape hatch.

Inferring it again would reintroduce exactly the defect being fixed. The rule is
therefore: *infer what is structural, author what is consequential.*

---

## 4. Specification

### 4.1 `rebase.json` — target schema

```jsonc
{
    "$schema": "https://rebase.pro/schemas/rebase.json",
    "rebase": "^1",
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" },
        "admin":   { "type": "static", "root": "admin",    "output": "admin/dist",    "path": "/admin" },
        "site":    { "type": "static", "root": "frontend", "output": "frontend/dist", "path": "/" }
    }
}
```

Ejected:

```jsonc
"backend": {
    "type": "backend",
    "runtime": "custom",
    "dockerfile": "Dockerfile",
    "port": 8080
}
```

Target types, replacing the existing declarations in
`packages/types/src/types/project_manifest.ts`:

```ts
export type RebaseAppType = "backend" | "static";

export interface RebaseBackendAppConfig {
    type: "backend";

    /**
     * Who owns the process.
     *
     * - `managed` — the platform runtime image boots this project's bundle.
     * - `custom`  — this repository builds its own image and entrypoint.
     *
     * Independent of *where* it runs: both run on Rebase Cloud and both
     * self-host. See `docker/docker-compose.selfhost.yml`.
     */
    runtime: "managed" | "custom";

    /** Directory of the config package. Default `config`. */
    config?: string;
    /** Directory of server functions. Default `backend/functions`. */
    functions?: string;
    /** Directory of cron definitions. Default `backend/crons`. */
    crons?: string;
    /** Generated Drizzle schema module. Default `backend/src/schema.generated.ts`. */
    schema?: string;
    /** Module (relative to `config`) default-exporting the auth users collection. */
    usersCollection?: string;

    /** `runtime: "custom"` only. Dockerfile path. Default `Dockerfile`. */
    dockerfile?: string;
    /** `runtime: "custom"` only. Build context. Default `.`. */
    context?: string;
    /** `runtime: "custom"` only. Container port. Default 8080. */
    port?: number;
}

export interface RebaseStaticAppConfig {
    type: "static";
    /** Package directory containing the client sources. */
    root: string;
    /** Command producing `output`. Run from the repository root. */
    build?: string;
    /** Directory of built assets, relative to the repository root. */
    output: string;
    /**
     * Public base path this app is served under. Default `/`.
     *
     * This is a BUILD-TIME input as well as a serving concern — see §4.2.
     * Changing it requires rebuilding the app.
     */
    path?: string;
    /** Serve `index.html` for unmatched paths under `path`. Default `true`. */
    spa?: boolean;
}

export type RebaseAppConfig = RebaseBackendAppConfig | RebaseStaticAppConfig;

export interface RebaseProjectManifest {
    $schema?: string;
    /** Runtime contract major this project targets, as a semver range. */
    rebase: string;
    apps: Record<string, RebaseAppConfig>;
}
```

Validation rules (`packages/cli/src/manifest.ts`, `validateManifest` /
`validateApp`):

| Rule | Message |
|---|---|
| `rebase` present, non-empty string | `is required, e.g. "^1"` |
| app name matches `/^[a-z0-9][a-z0-9-]*$/` | `name must be lowercase alphanumeric with dashes (it appears in URLs)` |
| app name not in `api`, `health`, `metrics`, `livez`, `_rebase` | `name is reserved` |
| `type` in `backend`, `static` | `must be one of: backend, static` |
| at most one `backend` app | `a project may declare at most one backend app` |
| `backend.runtime` is `managed` or `custom` | `must be "managed" or "custom"` |
| `dockerfile`/`context`/`port` only when `runtime: "custom"` | `only applies to a custom runtime` |
| `static.root`, `static.output` present, relative, non-escaping | as today |
| `static.path` starts with `/`, no `..`, no trailing slash unless `/` | `must be an absolute path like "/admin"` |
| static `path` values unique across apps | `two apps cannot serve the same path` |

Removed outright, failing validation with a message naming the replacement:
`type: "admin"`, `type: "custom"`, `type: "mobile"`, `admin.mode`,
`backend.mode`, top-level `runtime` as a version range.

### 4.2 The `path` contract — build **and** serve

**This is the part most likely to be implemented wrongly.** A static app mounted
at a non-root path must be *built* for that path. If it is not, `index.html`
loads and every asset 404s: a blank page with no server error.

`path` therefore reaches **three** places:

**(a) Vite `base`, at build time.** `rebase build` sets environment variables for
each static app's build command:

```
REBASE_APP_PATH=/admin      # normalized, no trailing slash ("/" for root)
REBASE_APP_BASE=/admin/     # Vite `base` convention: always trailing slash
```

The template's `frontend/vite.config.ts` consumes it:

```ts
export default defineConfig({
    base: process.env.REBASE_APP_BASE ?? "/",
    // …
});
```

**(b) Router `basename`, at runtime in the client.** Vite exposes `base` as
`import.meta.env.BASE_URL`, so nothing extra is passed:

```ts
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");
const router = createBrowserRouter(routes, { basename });
```

**(c) Mount and exclusions, at serve time.** See §4.4.

**Build-time assertion (required, not optional).** After a static app's build,
`rebase build` must verify the emitted `index.html` actually references the
declared path, and fail loudly if not:

1. Read `<output>/index.html`.
2. Collect every `src="…"` and `href="…"` value that begins with `/`.
3. If `path !== "/"`, every such value must begin with `${path}/`.
4. On violation, fail with:

```
✗ "admin" is declared at /admin but its build emitted assets rooted at /.
    index.html references: /assets/index-a1b2c3.js
    The app would load a blank page. Set `base` from REBASE_APP_BASE in its
    build config — see docs/apps-and-runtimes.md §4.2.
```

This single check converts the entire class of silent blank-page failures into a
build error.

**Constraint, stated plainly:** a static app is built for exactly one path. The
same artifact cannot serve `/admin` in a folded deployment and `/` on its own
hostname. If an app is deployed standalone at a root, declare `path: "/"` and
rebuild. Do not attempt to solve this with relative asset paths (`base: "./"`) —
it fixes assets and breaks deep links and the router.

### 4.3 Bundle manifest

In `packages/types/src/types/project_manifest.ts`:

```ts
export interface RebaseBundleEntrypoints {
    config?: string;
    collections?: string;
    functions?: string;
    crons?: string;
    schema?: string;
    usersCollection?: string;
    /** Built static apps to serve from this process, in mount order. */
    static?: RebaseBundleStatic[];
    // `admin` is REMOVED.
}

export interface RebaseBundleStatic {
    /** Public base path, e.g. "/" or "/admin". */
    path: string;
    /** Bundle-relative directory holding the built assets. */
    dir: string;
    /** SPA fallback for unmatched paths under `path`. */
    spa: boolean;
}

export interface RebaseBundleManifest {
    bundleFormat: number;
    runtime: { range: string; builtAgainst: string; contract: number };
    schemaVersion: string;
    app: string;
    /**
     * What the runtime does with this bundle.
     *
     * - `backend` — boot the full server: database, auth, data API, plus any
     *   static apps in `entry.static`.
     * - `static`  — serve `entry.static` only. No database, no auth.
     *
     * Replaces the old `mode: "cms" | "baas" | "static"`. The cms/baas
     * distinction is now derived from whether `entry.config` is present.
     */
    kind: "backend" | "static";
    entry: RebaseBundleEntrypoints;
    // …rest unchanged
}
```

`kind` is load-bearing at two sites in `packages/server/src/boot/boot.ts`:

- `:107` — `if (bundle.manifest.mode === "static")` dispatches to
  `bootStaticApp`. Becomes `kind === "static"`.
- `:522` — `if ((bundle.manifest.mode ?? "cms") !== "cms") return;` gates
  migrate-on-boot. Becomes: skip unless `kind === "backend"` **and**
  `entry.config` is present. A project that introspects an existing database must
  never have its schema pushed on boot.

### 4.4 `serveSPA` — mounting several apps

Target signature (`packages/server/src/serve-spa.ts`):

```ts
export interface ServeSPAConfig {
    frontendPath: string;
    /** Public base path. Default "/". No trailing slash unless it is "/". */
    basePath?: string;
    apiBasePath?: string;
    /** Extra paths the SPA fallback must not claim. */
    excludePaths?: string[];
    indexFile?: string;
    /** Serve index.html for unmatched paths. Default true. */
    spa?: boolean;
}
```

Required behaviour:

1. **Assets are scoped to `basePath`.** Today both middlewares are registered at
   `/*` (`serve-spa.ts:70-74`). They must be registered at `${basePath}/*`, and
   the static root must resolve after stripping the prefix. Use `serveStatic`'s
   `rewriteRequestPath` to strip `basePath`. **Verify this with a test before
   building anything on top of it** (§5 Phase 4). If it does not behave, the
   fallback is a sub-`Hono` mounted with `app.route(basePath, sub)`.
2. **The SPA fallback is scoped to `basePath`.** `app.get("*")`
   (`serve-spa.ts:82`) becomes `app.get(`${basePath}/*`)`.
3. **Ordering is by path specificity, longest first, `/` last.** The `/`-rooted
   app's catch-all claims everything registered after it.
4. **The `/`-rooted app must exclude every sibling path.** Ordering alone is not
   enough: a request to `/admin/foo` that misses the admin's static files falls
   through to the root app's fallback, which would serve the *site's*
   `index.html` under the admin's URL. The caller passes sibling paths in
   `excludePaths`.
5. **`spa: false`** registers assets only, no fallback.

Caller (`packages/server/src/boot/boot.ts`, replacing `:288-299`):

```ts
if (env.REBASE_SERVE_STATIC) {
    const apps = [...(bundle.manifest.entry?.static ?? [])]
        // Longest path first; "/" last.
        .sort((a, b) => b.path.length - a.path.length);

    for (const staticApp of apps) {
        const siblings = apps.filter(o => o !== staticApp).map(o => o.path);
        serveSPA(app, {
            frontendPath: path.resolve(bundle.dir, staticApp.dir),
            basePath: staticApp.path,
            apiBasePath: env.REBASE_BASE_PATH,
            excludePaths: ["/health", "/livez", "/metrics", ...siblings],
            spa: staticApp.spa
        });
    }
}
```

`bootStaticApp` (`boot.ts:371`) mounts the same way over the same list.

`packages/server/src/boot/bundle.ts`: `LoadedBundle.adminDir` is removed;
`staticDir?: string` becomes `staticApps: Array<{ path: string; dir: string;
spa: boolean }>`, each resolved through `resolveBundlePath` and dropped with a
warning when missing, exactly as today.

### 4.5 Folding

`packages/cli/src/fold-static.ts`:

- `selectFoldableApp` is deleted, along with its refusal of multiple static apps
  (currently `fold-static.ts:60-66`).
- `foldFrontendIntoBundle` folds **every** static app: runs each `build` (unless
  `skipBuild`), asserts each `output` exists, copies it to
  `<bundle>/static/<appName>/`, and appends a `RebaseBundleStatic` entry.
- It still throws when a declared `output` is missing after a build — an empty
  site is indistinguishable from a broken deploy.

`packages/cli/src/bundle.ts`, `foldStaticIntoBundle` (`:959`): takes
`{ bundleDir, assetsDir, appName, path, spa }`, copies into
`static/<appName>/`, and **appends** to `manifest.entry.static` instead of
overwriting it (`:991` currently writes `static: "static"`).

`buildStaticBundle` (`:997`) writes `kind: "static"` and a single-element
`entry.static` of `[{ path: "/", dir: "static", spa: true }]` — a standalone
static app owns its origin. See the constraint in §4.2.

### 4.6 `rebase eject`

The supported route from `managed` to `custom`. Without it, `custom` is a mode
users can only reach by hand-writing an entrypoint they have never seen.

```
rebase eject [app]        # default: the backend app
```

Behaviour:

1. Load the manifest. Resolve the backend app (or the named app).
2. If `runtime` is already `custom`, exit 1: `already ejected`.
3. Write `backend/src/index.ts` from the template that
   `packages/cli/templates/template/backend/src/index.ts` holds today. It stops
   being scaffolded by default (§4.8) and lives on as the eject payload.
4. Write `Dockerfile` at the repository root, unless one exists — never
   overwrite.
5. Rewrite `rebase.json`: `runtime: "custom"`, `dockerfile`, `port: 8080`.
6. Print what changed and what is now the user's responsibility:

```
✓ Ejected "backend" to a custom runtime.

  backend/src/index.ts   your entrypoint — the runtime no longer boots the bundle
  Dockerfile             your image
  rebase.json            runtime: custom

  You now own CORS, auth wiring, storage and shutdown. Platform runtime
  upgrades no longer reach this project.
```

`--dry-run` prints the file list and changes nothing.

There is no `rebase uneject`. Going back is deleting two files and editing one
line, and a command that silently discarded a user's server code would be worse
than its absence.

### 4.7 The name "CMS" — deferred

**This section is not being implemented.** The rename touches exported API on
packages that are already published, and it is orthogonal to everything else
here; bundling it in would make every other phase look like a breaking release.

The standing rule instead: **anything new says "admin".** New identifiers, new
doc comments, new CLI output and new manifest values use the admin vocabulary.
Existing `registerCMS` / `unregisterCMS` / `useCMSContext` / `CMSContext` /
`CMSBasePropertyNoName` / `CMSNavigationContent` stay where they are until
someone decides to spend a major on them.

What still goes, because it is a *manifest value* rather than an API name: the
`cms` / `baas` pair in `backend.mode` (D5) and in the bundle manifest's `mode`
(D6). Those are removed by Phases 2 and 5 regardless.

The rest of this section is retained as the record of what the rename would
involve, should it ever be scheduled:

| Current | Target | Location |
|---|---|---|
| `registerCMS` | `registerAdmin` | `packages/admin-types/src/controllers/registry.ts:88`, `packages/app/src/hooks/useRebaseRegistry.tsx:15`, `:43` |
| `unregisterCMS` | `unregisterAdmin` | same files, `:89` / `:16` |
| `useCMSContext` | `useAdminContext` | `packages/admin/src/hooks/useCMSContext.tsx:56` |
| `CMSContext` | `AdminContext` | `packages/admin/src/hooks/useCMSContext.tsx:34` |
| `CMSBasePropertyNoName` | `AdminBasePropertyNoName` | `packages/admin-types/src/types/property_config.tsx:4` |
| `CMSNavigationContent` | `AdminNavigationContent` | `packages/admin/src/components/DefaultDrawer.tsx:145` |

Rename the file `packages/admin/src/hooks/useCMSContext.tsx` →
`useAdminContext.tsx` and update `packages/admin/src/hooks/index.ts`.
Callers include `packages/admin/src/data_export/export/ExportCollectionAction.tsx`
and `packages/admin/src/components/RebaseAdmin.tsx:17`, `:25`.

Doc comments mentioning "CMS" — roughly ten in
`packages/types/src/controllers/data.ts`, plus `properties.ts:167`,
`entity_callbacks.ts:88`, `:135`, `data_source.ts:7`,
`collection_registry.ts:14` — become "admin".

Verification: `grep -rni "\bcms\b" packages/*/src` returns nothing.

### 4.8 `rebase init` and the templates

**Scaffold one app.** `frontend/` in the template already *is* the admin — it
renders `RebaseAdmin` — so declare it honestly and delete the entry that did
nothing. A new project stays runnable in thirty seconds, which is what every
comparable tool does (`rails new`, `create-next-app`, `create-strapi-app`,
Payload), while Firebase and Supabase hand you config and keep starters in a
separate examples repository.

`packages/cli/templates/template/rebase.json` becomes:

```json
{
    "$schema": "https://rebase.pro/schemas/rebase.json",
    "rebase": "^1",
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" },
        "admin": {
            "type": "static",
            "root": "frontend",
            "build": "npm run build --workspace frontend",
            "output": "frontend/dist",
            "path": "/"
        }
    }
}
```

**Stop scaffolding `backend/src/index.ts`.** It moves to the eject payload
(§4.6). The `baas` overlay's copy
(`packages/cli/templates/overlays/baas/backend/src/index.ts`) goes the same way.

**`--flavor cms|baas` becomes `--headless`.** With `backend.mode` gone (D5), the
pair has nothing left to name:

```
rebase init my-app              # backend + admin
rebase init my-api --headless   # backend only, collections introspected
```

`TemplateFlavor` (`packages/cli/src/commands/init.ts:60`) is deleted; the overlay
mechanism (`:708`, `:716`) keys off the boolean. Help text at `:236` and the
error paths at `:487`, `:492`, `:614` update accordingly.

**The `blog` preset gains a second static app** — a minimal public site at `/`
with the admin moved to `/admin` — which is where the multi-app model is taught.
Every other project skips a package it never asked for.

---

## 5. Execution plan

Phases are ordered by dependency. Do not start a phase before the previous one's
verification passes.

**Status (branch `claude/baas-admin-split-6872b3`).** Phases 1–5 are implemented;
Phase 0 is dropped and Phase 6 is not started.

| Phase | State | Note |
|---|---|---|
| 0 — CMS rename | dropped | §4.7 |
| 1 — manifest schema | done | CLI 413 tests green |
| 2 — template + `rebase eject` | done | new `eject` command and `templates/eject/` payload |
| 3 — `path` build contract | done | `REBASE_APP_BASE`, router basename, build assertion |
| 4 — `serveSPA` and boot | done | new `serve-spa.test.ts`; server 1091 tests green |
| 5 — folding + bundle manifest | done except the self-host acceptance run, which needs Docker |
| 6 — `saas` | not started | `saas/` is not present in this worktree |

One deviation from the phase boundaries: the type changes in
`project_manifest.ts` are a single unit, so `entry.static` becoming a list and
`mode` becoming `kind` (Phase 5) landed with Phase 1 rather than leaving the
repository uncompilable in between. The behavioural work still followed the
order above.

One decision taken during Phase 2, not anticipated here: removing the headless
overlay's entrypoint removed the only place its `storageAuthorize` hook was
wired, and the scaffold's own `docker-compose.yml` enables storage — so the
first `docker compose up` on a headless project would have crash-looped. The
headless flavour therefore keeps a config *package* holding the hook alone, and
`hasCollections` became a question about `<config>/collections` rather than
about `<config>` itself. That is the more accurate question anyway: a config
package and a set of declared collections are not the same thing.

**On migration: there is none.** The manifest is young and mostly unused outside
the template. `type: "admin" | "custom" | "mobile"`, `admin.mode`,
`backend.mode` and top-level `runtime`-as-version are removed outright, and a
manifest using them fails validation with a message naming the replacement.
`synthesizeManifest` — the no-manifest fallback — stays, because projects
predating the file are real; see Phase 2.

### Phase 0 — remove the name "CMS" — **dropped**

Not being implemented; see §4.7. New code says "admin", existing exports stay.
The `cms`/`baas` *manifest values* still go, in Phases 1 and 5.

### Phase 1 — manifest schema

- Implement §4.1 in `packages/types/src/types/project_manifest.ts` and
  `packages/cli/src/manifest.ts`.
- `assessManagedCompatibility` reads `backend.runtime` instead of inferring it.
  It keeps returning `ManagedCompatibility`, but `reasons` is now empty or a
  single "declared custom" entry.
- `resolveBackendPaths` (`manifest.ts:439`) drops `mode` and gains a
  `hasCollections: boolean` derived from whether the resolved `config` directory
  exists.
- `buildableApps` (`:381`) drops the `mobile` filter and the `admin` rank.
- `packages/cli/src/commands/apps.ts` `describeApp` (`:81`) loses the `admin`,
  `mobile` and `custom` cases.
- `packages/cli/src/commands/build.ts:209` — delete the hosted-admin branch.
- `packages/cli/src/bundle.ts:745`, `:864` — replace mode checks with
  `hasCollections`.
- Update `website/public/schemas/rebase.json`.

**Verify:** extend `packages/cli/src/manifest.test.ts` with a case per validation
rule in §4.1, including each rejection message. `rebase apps list` on the
reference app (`app/`) prints two apps and `✓ Eligible for the managed runtime.`

### Phase 2 — the template contradiction and `rebase eject`

**Ordering note.** This was Phase 1 in an earlier draft, on the grounds that it
was independent of the manifest schema. It is not: `rebase eject` writes
`runtime: "custom"` into `rebase.json`, and `synthesizeManifest` must *infer*
that same field — neither exists before Phase 1. Schema first.

- Implement §4.6 (`rebase eject`) including the new command registration and
  help entry.
- Move `templates/template/backend/src/index.ts` to the eject payload; remove it
  and the `baas` overlay copy from the scaffold.
- `synthesizeManifest` (`manifest.ts:275-309`): stop inferring an ejected backend
  from `backend/src/index.ts`. Infer `runtime: "custom"` **only** when a
  Dockerfile is declared. When a stranded `backend/src/index.ts` exists under a
  managed backend, warn:

```
⚠ backend/src/index.ts exists but this project's backend is managed — it is
    never loaded. Delete it, or run `rebase eject` to make it the entrypoint.
```

**Verify:** `rebase init` in a temp dir produces no `backend/src/index.ts`;
`rebase build` in it emits no "not the bundle's entry point" warning;
`rebase eject` then produces the entrypoint, a Dockerfile and
`runtime: "custom"`. Extend `packages/cli/src/commands/init.test.ts` and add
`packages/cli/src/commands/eject.test.ts`.

### Phase 3 — the `path` build contract

- Implement §4.2 (a), (b) and the build-time assertion in
  `packages/cli/src/commands/build.ts` and `fold-static.ts`.
- Update `app/frontend/vite.config.ts` and the template's to read
  `REBASE_APP_BASE`.
- Update the template's router to derive `basename` from
  `import.meta.env.BASE_URL`.

**Verify:** build a two-app project with the admin at `/admin`; assert
`admin/dist/index.html` references `/admin/assets/…`. Then deliberately remove
`base` from its vite config and assert `rebase build` **fails** with the §4.2
message. That negative test is the point of the phase — add it to
`packages/cli/src/bundle.test.ts`.

### Phase 4 — `serveSPA` and boot

**Start with the spike.** Before implementing, write a test proving
`serveStatic`'s `rewriteRequestPath` serves `/admin/assets/x.js` from a directory
rooted at the admin's build. If it does not, use the sub-`Hono` fallback in
§4.4(1). Nothing else in this phase is safe until that is settled.

- Implement §4.4: `serveSPA` `basePath`, `spa`, scoped middlewares.
- `boot/bundle.ts`: `adminDir` removed, `staticApps` list.
- `boot/boot.ts`: both mount sites (`:288-299`, `:371`).

**Verify:** new `packages/server/src/serve-spa.test.ts` (none exists today) with
a two-app Hono covering: `/` serves the site's index; `/admin` serves the admin's
index; `/admin/assets/x.js` serves the admin's asset; `/admin/deep/link` serves
the admin's index, **not** the site's; `/api/*` reaches the API; `/health` is not
swallowed.

### Phase 5 — folding and the bundle manifest

- Implement §4.3 and §4.5.
- `mode` → `kind` at every producer and consumer, including `boot.ts:96`, `:107`,
  `:194`, `:375`, `:522`.

**Verify:** extend `packages/cli/src/fold-static.test.ts` — two static apps both
land in the bundle, with correct `entry.static`. Then end-to-end:

```
cd app && rebase build
docker compose -f ../docker/docker-compose.selfhost.yml up -d db
rebase db push
docker compose -f ../docker/docker-compose.selfhost.yml up
```

`/` and `/admin` must both load in a browser, and the admin must list
collections. This is the self-hosting acceptance test for the whole document.

### Phase 6 — `saas`

- `saas/config/collections/apps.ts:53` — drop the `admin`, `mobile` and `custom`
  enum values; regenerate `schema.generated.ts`; write the Postgres enum
  migration.
- `saas/backend/src/managed/apps-registry.ts:20` — `AppType` down to two.
- The deploy path already reads `runtimeMode` (`projects_runtime_mode`,
  `schema.generated.ts:25`); point it at the manifest's declared value rather
  than the CLI's inference.

**Verify:** `saas` tests pass; a deploy of the reference app registers exactly
two apps with the right types.

---

## 6. Traps

Each of these has already produced a silent failure here or in a project built on
this codebase.

1. **A non-root SPA built with `base: "/"` renders a blank page and logs
   nothing.** This is why §4.2's build assertion is mandatory rather than nice to
   have.
2. **`serveSPA`'s catch-all claims everything registered after it.** Mount order
   is longest-path-first with `/` last, *and* the root app excludes its siblings.
   Getting only one of the two produces the site's HTML under `/admin/…`, which
   looks like an admin bug for a long time.
3. **`serveSPA` returns early and disables itself when its directory is
   missing** (`serve-spa.ts:56-60`) — it warns, it does not throw. A wrong path
   means the API works perfectly and the site 404s. Verify by fetching, never by
   reading logs.
4. **`entry.static` was a single string.** `foldStaticIntoBundle:991` overwrites
   it. Appending is the change; an implementer copying the old line will silently
   ship only the last app.
5. **Migrate-on-boot is gated on the old `mode`** (`boot.ts:522`). If `kind`
   replaces it carelessly, a project that introspects an existing database will
   have a schema pushed into it on boot. Gate on `kind === "backend"` **and**
   `entry.config` present.
6. **The bundle compiles only `config/**`, `functions/**`, `crons/**` and the
   schema** (`bundle.ts:740-751`). Files reachable by import are emitted too, but
   only if they are under the project root. Anything a cron imports from
   `backend/src/` ships; anything outside does not.
7. **`rebase build`'s "not the bundle's entry point" warning is the only signal**
   that a stranded entrypoint exists. Phase 1 removes the cause; do not also
   remove the warning.
8. **`pnpm --filter @rebasepro/cli run build` is required before the CLI reflects
   source changes.** The installed `rebase` binary runs `dist/`. A change that
   "does nothing" is usually an unbuilt CLI.

---

## 7. Decisions taken on the author's behalf

Flagged because they were not explicitly requested. Each is a single-line
reversal.

1. **`type: "mobile"` is deleted** (D4). Evidence in §2.5: nothing consumes it.
   The same argument that removes hosted admin removes this. If mobile
   registration is on the roadmap, keep the type and this document is otherwise
   unaffected.
2. **The top-level key is `rebase`, not `runtime`** (D8). `runtime` is needed for
   `managed | custom`, and `"rebase": "^1"` inside `rebase.json` reads like
   `engines` in a `package.json` — which is exactly what it is.
3. **`--flavor` becomes `--headless`** (§4.8). A boolean, because after D5 the
   two shapes no longer need names.
4. **No `rebase uneject`** (§4.6).
