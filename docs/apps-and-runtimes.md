# Apps, runtimes, and the admin

Status: **implemented** — verified against the source 2026-08-01.
Scope: `packages/types`, `packages/admin`, `packages/admin-types`, `packages/app`,
`packages/cli`, `packages/server`, `saas`, templates

§5's execution plan is history; read §1–§4 for the decisions and §6 for the
traps, which is what the code cannot carry on its own. Checked, not assumed:

| Decision | Where it landed |
| --- | --- |
| D1 `runtime: "managed" \| "custom"` | `RebaseBackendAppConfig.runtime` |
| D2–D4 `admin` / `custom` / `mobile` deleted | `RebaseAppType = "backend" \| "static"` |
| D5 `backend.mode` (`cms`/`baas`) deleted | no live field left — only comments recording what replaced it |
| D6 manifest `kind` | `kind: "backend" \| "static"` |
| D8 `runtime` → `rebase` | `rebase: string` on the project manifest |
| D9 "CMS" out of the exported API | the last three — `firestoreToCMSModel`, `cmsToFirestoreModel`, `toCmsRow` — are now `firestoreToRebaseModel`, `rebaseToFirestoreModel`, `toFlatRow` |
| D11 `rebase eject` | `packages/cli/src/commands/eject.ts`, plus its template |

A plan that still says "proposal" after it has shipped is worse than no status
line at all: it is what a reader trusts when deciding whether the work is still
outstanding, and it says the opposite of the truth.

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
| D9 | The name "CMS" is removed from the product, including exported API and every locale. Deferred once, done later — see §4.7. |
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

**This is a format change, so `BUNDLE_FORMAT_VERSION` goes to 2.** Both
directions of the compatibility contract depend on it, and both were missed in
the first draft of this document:

- *Old bundle, new runtime.* Every already-deployed project ships format 1. Read
  as-is it would load with no `kind`, so every gate keyed on `kind === "backend"`
  — migrate-on-boot among them — would silently skip, and the loader would
  iterate a directory string as a list. `upgradeLegacyManifest` in
  `packages/server/src/boot/bundle.ts` normalizes on read: `cms`/`baas` →
  `backend`, a single `entry.static` string → one root-mounted entry, and
  `entry.admin` → the same, matching the old `staticDir ?? adminDir`.
- *New bundle, old runtime.* A format-1 runtime finds no `mode` and an array
  where it expects a string. The bump turns that into the refusal to boot that
  `readBundleManifest` already implements, rather than a container that starts
  and serves nothing.

The control plane needs the same treatment from the other side — see §4.9.

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
   being scaffolded by default (§4.8) and lives on as the eject payload (now at
   `packages/cli/templates/eject/`). If that file already exists, exit 1 rather
   than replace it: a managed backend never loads it, but `rebase dev` does, so
   it is often a server someone is running. `--force` replaces it and keeps the
   old contents as `backend/src/index.ts.bak`.
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

### 4.7 The name "CMS" — done

D9 was deferred once, on the grounds that the rename touches exported API on
published packages. It is done now, and it was smaller than it looked: the
CMS-named symbols had **no consumers outside `packages/admin` and
`admin-types`** — the only other references were compiled `dist/`.

| Was | Is |
|---|---|
| `useCMSContext`, `CMSContext` | `useAdminContext`, `AdminContext` |
| `registerCMS`, `unregisterCMS` | `registerAdmin`, `unregisterAdmin` |
| `CMSBasePropertyNoName` | `AdminBasePropertyNoName` |
| `CMSNavigationContent` | `AdminNavigationContent` |
| `hooks/useCMSContext.tsx` | `hooks/useAdminContext.tsx` |

**The audit that justified deferring it was wrong in one place.** I reported "no
user-visible strings say CMS", having grepped only for console output. Seven
locale files said it — `"CMS Users"`, `"CMS View"`, and translated sentences in
Spanish, Portuguese, German, French, Italian and Hindi. Those are the surface
that matters most, and they are translated per language rather than sed'd.

Two traps in doing it, both caught by the typechecker rather than by review:

- `studio_sql_admin` **already existed** as a distinct key (`"(Admin)"`).
  Renaming `studio_sql_cms` onto it would have silently merged two different
  strings into one. It became `studio_sql_collections_label`, which says what
  the value is.
- A prose sweep over `\bCMS\b` reaches identifiers as readily as comments. It
  is scoped to files that do not mention FireCMS, and every run was typechecked.

**Deliberately untouched: `packages/firebase`.** `FireCMS`, `__FIRECMS`,
`firestoreToCMSModel`, `getCMSPathFromFirestorePath` and the
`DataDriver.delegateToCMSModel` contract method it implements are heritage from
a different product, not this one's naming. `delegateToCMSModel` is also an
optional method on a public driver contract: renaming it would break a
third-party driver *silently*, since an unimplemented optional method is simply
never called. Worth doing when the driver contract next takes a major.

What stays "CMS" on purpose is prose about the product *category* — "like
Payload/Directus", the `blog-cms` recipe. That is a thing to be compared to, not
a thing this codebase builds.

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

### 4.9 The control plane, and what authoring `runtime` buys

`saas` reads the bundle manifest through its own duplicated `BundleManifest`
shape — deliberately, because the platform must be able to read a manifest a
*newer* CLI produced. `parseBundleManifest` returned `null` for anything without
`mode`, and the deploy path turns `null` into `MALFORMED_MANIFEST`. So without a
change there, every deploy from a current CLI is refused with a message blaming
the user's manifest.

It accepts both formats now and normalizes to `kind`, and
`SUPPORTED_BUNDLE_FORMAT` goes to 2. The raw document is copied rather than
mutated: it is stored on the deployment row as the record of what was shipped.

**`rebase cloud deploy` honours the declared runtime.** This is the payoff of
§2.4 — the reason to author the field rather than infer it:

- Before: a bare `rebase cloud deploy` on a managed project was *refused*, with
  "redeploy it with `rebase cloud deploy --bundle`". Forgetting the flag meant
  the command tried to build a container image and eject the project, so the
  refusal had to exist.
- After: the backend declares `runtime: "managed"`, so the bare command builds
  and ships a bundle. `--source` and `--bundle-dir` are explicit acts and still
  win, and the refusal stays for the case it was written for — a manifest that
  says `custom` deploying over a project the platform has as managed.

The deploy still *decides* rather than obeying a stored mode (`saas`
`deploy-plan.ts` documents why at length): shipping a bundle is what earns
`managed`. The manifest is now what makes shipping one the default.

**Also removed: `RebaseProjectContract.mode`.** I first kept this, on the
grounds that `GET /api/meta/contract` is a wire contract consumed by SDK
generation. It is not consumed: nothing in the CLI, codegen, client or console
reads the field. It was emitted and ignored, so it is gone from both
`/api/meta/contract` and `/api/meta/schema-version`. Under Rule 1 (§4.11) a
reader that ignored it is unaffected, and there was no reader that did not.

### 4.10 What `rebase init` scaffolds for self-hosting

Self-hosting is the *first* thing that has to be right — for a while it is the
only option — and the scaffold was contradicting the manifest it wrote.

A new project declared `runtime: "managed"` and shipped a `docker-compose.yml`
that built **two custom images**: `backend/Dockerfile`, whose `CMD` ran the
entrypoint the managed runtime never loads, and `frontend/Dockerfile`, an nginx
image serving the SPA the runtime now serves itself. §4.8 removed the entrypoint
from the scaffold, which left that compose file not merely inconsistent but
**broken**: `docker compose up` on a fresh project built an image around a file
that no longer existed.

The scaffolded compose runs the managed shape instead — Postgres, plus
`rebasepro/server` with `./dist-bundle` mounted at `/bundle`:

```
rebase build              # produces ./dist-bundle
docker compose up -d db
rebase db push            # create the collection tables, once
docker compose up
```

One container, serving the API at `/api` and the admin at `/`. Same origin, so
there is no CORS between them and no second web server. No application image is
built at any point.

That is the property worth protecting: **the artifact you self-host is the
artifact Rebase Cloud runs.** Nothing in the repository changes when a project
moves between them — the destination lives in `.rebase/cloud.json`, which is not
committed — so "works self-hosted" and "works on Cloud" stop being two things
that can drift apart.

The image-building path moves behind `rebase eject`, which now writes
`Dockerfile` **and** `docker-compose.custom.yml` together, and deliberately does
not touch the scaffolded `docker-compose.yml`: going back should stay a one-line
change in `rebase.json` rather than a restore from git.

Two things the scaffold must keep getting right, both of which have their own
test:

- **No `build:` key in the scaffolded compose.** One would mean the project
  contradicts its own manifest again.
- **`FORCE_LOCAL_STORAGE` only alongside a durable mount.** The flag exists to
  acknowledge a volume; set without one, every uploaded file is destroyed on the
  next restart, which is the failure it was invented to prevent.

### 4.9b `mode: "cms" | "baas"` is gone from the server too

Deleting `backend.mode` from the manifest (D5) left the same pair standing one
layer down, in `RebaseBackendConfig.mode` — authored by anyone who ejects, and
passed to every driver. It is now derived everywhere, from one question: **did
any collections resolve?**

The flag was never independent of that. `PostgresBootstrapper` already guarded
`mode === "baas" && collections.length === 0`, so it could only ever agree with
the collections or contradict them — and when it contradicted, the server warned
and threw the declared collections away. That state cannot be expressed now.

- `RebaseBackendConfig.mode` — deleted. `introspectCollections` is derived after
  the collections directory is loaded, so a `collectionsDir` pointing at nothing
  falls through to introspection rather than serving an empty API.
- `DriverInitConfig.mode` → `introspectCollections: boolean`. A driver may now
  only contribute collections when it was asked to describe the schema; it can
  no longer inject whatever the database happens to contain into a project that
  declared its own.
- `REBASE_DEV_MODE` — deleted. `createSourceBundle` already drops a config
  directory that does not exist, so the env var said it a second time, and a
  second place to say it is a second place for it to disagree.
- `rebase init --flavor cms|baas` → `--headless` (§4.8, finally implemented).
  Neither word survived what it described: "cms" is a product category rather
  than a thing this tool builds, and "baas" was the manifest value that is now
  derived.

What legitimately remains: `templates/overlays/baas/` as a directory name, and
`saas`'s reader for format-1 bundles, which must keep understanding `cms`/`baas`
forever (§4.3).

---

### 4.10b Can a custom self-hosted project ignore `rebase.json`?

Yes — and that already works, because a missing manifest is never an error.
`loadManifest` synthesizes one from the directory layout, and
`synthesizeManifest` infers `runtime: "custom"` from a Dockerfile, so deleting
the file preserves behaviour rather than changing it.

What the manifest is actually *for*, per consumer:

| Command | What it reads it for | Needed by custom + self-hosted? |
|---|---|---|
| `build` | which apps to build, bundle entry paths, folding | **No** — it builds an image |
| `dev` | where `config`/`functions`/`crons`/`schema` live | Only if they are not in the conventional places |
| `eject` | find the backend, flip `runtime` | One-time |
| `apps list` / `apps config` | inspection | No |
| `cloud deploy` | app registration, runtime routing | Cloud only |
| `db`, `schema`, `generate-sdk` | **nothing — they never read it** | No |

So for a custom, self-hosted project the manifest earns exactly one thing:
directory overrides for `rebase dev`. Everything else it declares is about
building a bundle, and that project does not build one.

**The bug this question surfaced.** `rebase build` had no `runtime` check, so an
ejected project still got a `dist-bundle/` built for it — one it never deploys.
That is worse than doing nothing: it looks like the thing that ships. A custom
backend is now skipped, with the two commands that *do* build it named
(`npm run build --workspace backend`, then `docker build`).

The honest summary for a self-hoster on the custom runtime: **keep the file only
if your directories are unconventional, or if you may go back to `managed`.**
Otherwise delete it; nothing will miss it.

---

---

## 4.11 How this holds when things change

The cloud service depends on these contracts, and three things ship on their own
cadences: the **CLI** that writes a bundle, the **runtime image** that boots one,
and the **control plane** that intakes one. They cannot be released atomically,
and the control plane cannot even import the CLI's types. So the arrangement
survives on rules, not on coordination.

### Rule 1 — additive changes must be a non-event

Adding a field to the bundle manifest must never break a reader. If it did, no
field could be added without releasing three things in lockstep, and in practice
that means fields stop being added.

Both readers ignore what they do not recognise, and both now have a test that
says so with a manifest full of invented fields:
`packages/server/src/boot/bundle-compat.test.ts` and
`saas/backend/src/managed/bundle-manifest.test.ts`. Those tests are the contract;
if either starts failing, the change being made is not additive.

### Rule 2 — only an unreadable change earns a format bump

`bundleFormat` means "an older reader cannot make sense of this", not "something
changed". `mode` → `kind` qualified: the field an older reader looks for simply
is not there, and its absence reads as `undefined` rather than as an error.

### Rule 3 — a format bump ships control plane first

The control plane is the side that **rejects**. Release a CLI ahead of it and
every deploy becomes `MALFORMED_MANIFEST` or `BUNDLE_FORMAT_TOO_NEW`, with a
message that blames the user's manifest for a mistake we made. Order:

1. Teach the runtime to read the **old** shape (`upgradeLegacyManifest`). This is
   the direction nothing else checks — a missing field is not an error, it is a
   gate that silently stops firing.
2. Raise `SUPPORTED_BUNDLE_FORMAT` and teach `parseBundleManifest` both shapes.
3. **Ship the control plane.**
4. Then the CLI and the runtime image.

The version constants have a test whose only job is to fail when they change, so
that step 1 cannot be skipped by someone who did not know it existed.

### What is deliberately not guarded, and why

- **The control plane's hand-copied `BundleManifest`.** It cannot import
  `@rebasepro/types` — that is the point of the copy, and no test on either side
  can see the other. Rule 1 is what makes the copy safe to be stale: it only has
  to understand the fields it uses. Its header now says so, instead of promising
  a drift test that was never written.
- **Unknown fields in `rebase.json` warn rather than fail.** A typo (`pathh`)
  would otherwise be silently dropped — the app builds for `/`, mounts at `/`,
  and the only symptom is that it is not where you put it. But an unknown field
  is also what an *older* CLI sees in a newer manifest, so failing would make
  every future field breaking. It names the field, suggests the near-miss, and
  carries on.
- **A future app type reaching an older control plane.** `declaredAppsFrom` sends
  `backend` or `static` and nothing else, so a type added later arrives as
  `static` rather than as a rejected registration. Mislabelled beats a failed
  deploy; revisit when there is a third type worth naming.

---

## 5. Execution plan

Phases are ordered by dependency. Do not start a phase before the previous one's
verification passes.

**Status.** Phase 0 is dropped; 1–6 are implemented across two branches —
`claude/baas-admin-split-6872b3` here, and `feat/apps-runtimes-two-types` in
`saas`, which is **not merged** (a local merge to `saas` main is effectively a
publish, since another agent's push carries it).

| Phase | State | Note |
|---|---|---|
| 0 — CMS rename | dropped | §4.7 |
| 1 — manifest schema | done | CLI 416 tests green |
| 2 — template + `rebase eject` | done | new `eject` command and `templates/eject/` payload |
| 3 — `path` build contract | done | `REBASE_APP_BASE`, router basename, build assertion |
| 4 — `serveSPA` and boot | done | new `serve-spa.test.ts`; server 1099 tests green |
| 5 — folding + bundle manifest | done | plus `bundleFormat` 2 and format-1 compat (§4.3) |
| 6 — `saas` | done, unmerged | §4.9; migration 0032; saas backend 1504 tests green |

**The self-host acceptance test passes**, as `pnpm verify:selfhost`
(`scripts/verify-selfhost.mts`). Docker was unavailable, so it runs everything
the compose file runs except the container: a real bundle built from the
reference app's 11 collections, two static apps folded in at `/` and `/admin`, a
real `rebase db push` into Postgres, a real `bootFromBundle`, and real requests
through the booted app — including `/api/data/posts` returning rows from the
tables the push created, out of the same process serving the SPAs.

What it does not cover is the container itself: the published image, the volume
mount, and the bundle's own `npm install` at first start. Worth one manual
`docker compose -f docker/docker-compose.selfhost.yml up` before release.

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

### Phase 0 — remove the name "CMS" — done last, not first

Deferred at the start as an orthogonal rename on published packages, and carried
out after the rest had landed. §4.7 has the result, including the two traps and
the one thing the original audit got wrong.

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
reference app (`app/`) prints two apps.

Note that `app/` is **`runtime: "custom"`**, not managed, and that is correct: it
has its own 177-line `backend/src/index.ts` and `backend/Dockerfile`, built by
`cloudbuild.yaml` and run on Cloud Run. It was briefly mislabelled `managed`
during this work, which — once `rebase cloud deploy` started honouring the
declared runtime (§4.9) — would have quietly switched the demo from its image to
a bundle. Migrating the demo to the managed runtime is worth doing, and is its
own deliberate change rather than a side effect of a manifest edit.

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

`pnpm verify:selfhost` does all of it except the container — same build, same
push, same boot, same requests — so run that first and keep the compose run for
what only it can prove.

### Phase 6 — `saas`

**Do the manifest compatibility first — it is not optional.** `bundle-manifest.ts`
rejects a manifest without `mode`, and `deploy-plan.ts` turns that rejection into
`MALFORMED_MANIFEST`, so until it accepts `kind` the platform refuses every
deploy from a current CLI. See §4.9.

- `saas/backend/src/managed/bundle-manifest.ts` — `mode` → `kind`, accept both
  formats, `SUPPORTED_BUNDLE_FORMAT` → 2.
- `saas/backend/src/managed/deploy-plan.ts` — the static-bundle rejection reads
  `kind`.
- `saas/config/collections/apps.ts` — drop the `admin`, `mobile` and `custom`
  enum values; narrow the pgEnum in `schema.generated.ts` to match.
- `saas/backend/src/managed/apps-registry.ts` — `AppType` down to two;
  `hooks/apps-hooks.ts` no longer defaults an unknown row to `custom`.
- Migration `0032_apps_two_types.sql`. **Backfill and swap in one file, backfill
  first**: the enum swap re-casts every row, so one unmapped row fails the
  migration and blocks every deploy. An ejected backend becomes `backend` only
  where the project has no other one — two would violate the
  one-backend-per-project invariant, turning a data migration into a rule
  violation nothing catches until the next deploy. Everything else becomes
  `static`. Nothing is deleted.
- `packages/cli/src/commands/cloud/bundle-deploy.ts` — `declaredAppsFrom` runs on
  raw parsed JSON and defaulted an unknown type to `custom`, which the narrowed
  registry now refuses.

**Verify:** `saas` backend tests pass; `parseBundleManifest` has a case per
format (`bundle-manifest.test.ts`); `intake.test.ts`'s "format too new" case is
expressed against `SUPPORTED_BUNDLE_FORMAT`, not the literal `2` — as a literal
it stopped testing anything the moment the platform learned to read format 2.

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
9. **A manifest shape change has two compatibility directions, and the format
   version only protects one of them for free.** New-bundle-on-old-runtime is
   caught by the version check. Old-bundle-on-new-runtime is *not* — it loads,
   with the renamed field simply absent, so every gate keyed on it skips
   silently. Both were missed here until the `saas` phase surfaced the third
   case: old-*client*-on-new-*platform*, where a strict parser rejects the new
   shape and blames the user's manifest. See §4.3 and §4.9.
10. **In a `.claude/worktrees/*` worktree, `tsc` does not see cross-package type
    edits.** `packages/<x>/node_modules/@rebasepro/types` is a relative symlink
    inside the *primary* checkout's `node_modules`, so it resolves to the primary
    `packages/types` — editing types in the worktree and typechecking a consumer
    silently checks against the old ones and reports nothing. A throwaway
    tsconfig with `paths` pointing at `../types/src` (and a `rootDir` override,
    or every import errors TS6059) is the way through. Jest is unaffected;
    `jest.config.cjs` already maps to `../types/src`.

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
