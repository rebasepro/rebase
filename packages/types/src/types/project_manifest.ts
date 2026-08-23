/**
 * The project manifest (`rebase.json`) and the build artifacts derived from it.
 *
 * Three separate documents live in this file, and keeping them distinct matters:
 *
 * 1. {@link RebaseProjectManifest} — `rebase.json`. **Authored** by the developer,
 *    committed to the repository. Declares topology only: which runtime major the
 *    project targets, and which apps *this repository* contributes to the project.
 *    Schema, security rules, hooks and functions stay in TypeScript under the
 *    config package — nothing that needs a type system belongs here.
 *
 * 2. {@link RebaseProjectLink} — the per-checkout link (`.rebase/cloud.json`).
 *    **Not committed**, because it is per-developer like a git remote. Says which
 *    deployed project this working copy points at, whether that is a Rebase Cloud
 *    project or the base URL of a self-hosted backend.
 *
 * 3. {@link RebaseBundleManifest} — `manifest.json` inside a built bundle.
 *    **Generated**, never hand-edited. It is the lockfile analogue: the exact
 *    contract a built artifact claims to satisfy, which the runtime validates
 *    before it boots and a control plane validates before it deploys.
 *
 * A repository declares only the apps it contains. The set of apps belonging to a
 * project is held by the project itself, which is what makes multi-repo projects
 * work: two repositories never need to know about each other, only about the
 * project.
 */

import type { StorageSourceDefinition } from "./storage_source";
import type { ResourceGraph } from "./resources";

/**
 * Which kind of thing an app is.
 *
 * - `backend` — the collections/hooks/functions that define the project's API.
 *   Exactly one per *project* (not per repository); the registry enforces it.
 * - `static`  — a pre-built client bundle (SPA, static site), served from the
 *   backend process at its declared `path` or from a CDN. The admin panel is
 *   one of these: it is an app in the user's repository like any other.
 *
 * That is the whole list. Ownership of the server process is a property of the
 * backend app ({@link RebaseBackendAppConfig.runtime}), not an app type.
 */
export type RebaseAppType = "backend" | "static";

/**
 * The backend app: the project's API surface.
 *
 * Paths are relative to the directory holding `rebase.json`. The defaults match
 * the layout `rebase init` scaffolds, so a stock project may declare simply
 * `{ "type": "backend", "runtime": "managed" }`.
 */
export interface RebaseBackendAppConfig {
    type: "backend";
    /**
     * Who owns the process this backend runs in.
     *
     * - `managed` — the platform's runtime image boots this project's bundle.
     *   You supply collections, functions, crons and schema; Rebase supplies the
     *   server.
     * - `custom` — this repository builds its own image and entrypoint. The
     *   escape hatch: full control, no managed-runtime guarantees.
     *
     * Independent of *where* it runs. Both run on Rebase Cloud and both
     * self-host — the destination lives in `.rebase/cloud.json`, not here. See
     * `docker/docker-compose.selfhost.yml`, which boots a managed bundle on a
     * developer's own Docker host.
     *
     * This is authored rather than inferred on purpose. It is the single most
     * consequential fact about a deployment, and inferring it is what used to
     * land projects on the custom runtime without anyone choosing it.
     */
    runtime: "managed" | "custom";
    /** Directory of the config package (collections + index). Default `config`. */
    config?: string;
    /** Directory of server functions. Default `backend/functions`. */
    functions?: string;
    /** Directory of cron job definitions. Default `backend/crons` when present. */
    crons?: string;
    /**
     * Path to the generated Drizzle schema module (tables/enums/relations).
     * Default `backend/src/schema.generated.ts`.
     */
    schema?: string;
    /**
     * Module path (relative to `config`) exporting the auth users collection as
     * its default export. Default `collections/users`.
     */
    usersCollection?: string;

    /**
     * `runtime: "custom"` only. Dockerfile path relative to the repository root.
     * Default `Dockerfile`.
     */
    dockerfile?: string;
    /** `runtime: "custom"` only. Build context relative to the root. Default `.`. */
    context?: string;
    /** `runtime: "custom"` only. Port the container listens on. Default 8080. */
    port?: number;
}

/**
 * A static client bundle — SPA or static site — built here and served at `path`.
 */
export interface RebaseStaticAppConfig {
    type: "static";
    /** Package directory containing the client sources. */
    root: string;
    /** Command that produces `output`. Run from the repository root. */
    build?: string;
    /** Directory of built assets, relative to the repository root. */
    output: string;
    /**
     * Public base path this app is served under. Default `/`.
     *
     * Several static apps run in one process, each at its own path — the API at
     * `/api`, a site at `/`, the admin at `/admin` — which is what keeps a
     * self-hosted deployment a single container.
     *
     * **This is a build-time input, not only a serving concern.** An app mounted
     * at `/admin` must be *built* for `/admin` (Vite's `base`), or `index.html`
     * loads and every asset 404s: a blank page with no server error. `rebase
     * build` passes it as `REBASE_APP_BASE` and asserts the emitted HTML honours
     * it. Changing this value requires rebuilding the app.
     */
    path?: string;
    /**
     * Serve `index.html` for unmatched paths under `path` (client-side routing).
     * Default `true` — the overwhelmingly common case for a client app, and a
     * static *site* generator emits real files for its routes anyway.
     */
    spa?: boolean;
}

export type RebaseAppConfig = RebaseBackendAppConfig | RebaseStaticAppConfig;

/**
 * Path prefixes the backend owns, which no static app may claim.
 *
 * One process — and, on the platform, one hostname — serves both the API and
 * however many static apps a project has. Mounting is longest-path-first, so an
 * app declaring `/api` would win against the API itself and every request to it
 * would be answered with that app's `index.html`: a 200 carrying HTML where the
 * caller expected JSON, from a project that looks deployed and healthy.
 *
 * Declared here rather than in either enforcer because both must agree. The CLI
 * checks it so a developer finds out while editing `rebase.json`; the control
 * plane checks it again at deploy intake, because the front door's correctness
 * cannot rest on a check that ran in somebody else's CLI — and a repository can
 * be deployed by a CLI older than this rule.
 */
export const RESERVED_BACKEND_PREFIXES = ["/api", "/health", "/healthz", "/livez", "/readyz", "/metrics"] as const;

/**
 * Whether `path` collides with a prefix the backend owns.
 *
 * Compares at segment boundaries, so `/api` and `/api/v2` collide while
 * `/apidocs` does not — the same rule the router matches with, because a check
 * that is stricter than the router rejects paths that would have worked, and one
 * that is looser admits paths that will not.
 */
export function reservedPrefixFor(path: string): string | undefined {
    const normalized = path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
    return RESERVED_BACKEND_PREFIXES.find(
        reserved => normalized === reserved || normalized.startsWith(`${reserved}/`)
    );
}

/**
 * One declared storage source, as authored in `rebase.json`.
 *
 * The key comes from the enclosing record, so this is
 * {@link StorageSourceDefinition} minus its `key` — the same document the
 * runtime registry and the frontend router consume, expressed the way a JSON
 * object naturally expresses "a set of named things".
 */
export interface RebaseStorageSourceConfig {
    /** Engine backing this source: `local`, `s3`, `gcs`, or a custom id. */
    engine: string;
    /**
     * How the frontend reaches it. Default `server` (proxied through
     * `/api/storage`). `direct` means a provider SDK talks to the bucket and the
     * backend is not in the upload path.
     */
    transport?: "server" | "direct";
    /** Human-readable label for the console and the admin UI. */
    label?: string;
}

/**
 * `rebase.json` — the authored project manifest.
 */
export interface RebaseProjectManifest {
    /** JSON Schema URL, for editor completion. Ignored by the tooling. */
    $schema?: string;
    /**
     * The runtime contract **major** this project targets, as a semver range
     * (e.g. `^1`, `~1.4`, or an exact `1.4.2` to pin).
     *
     * The platform upgrades patches and minors underneath a project without
     * asking; it never crosses a major. See {@link RUNTIME_CONTRACT_VERSION}.
     *
     * Named `rebase` rather than `runtime` so that `runtime` means exactly one
     * thing — {@link RebaseBackendAppConfig.runtime}, who owns the process. It
     * reads like `engines` in a `package.json`, which is what it is.
     */
    rebase: string;
    /**
     * Apps this repository contributes, keyed by app name. The key is the app's
     * identity within the project: it is what `rebase deploy <app>` names, what
     * client credentials are issued against, and what a second repository must
     * not collide with.
     */
    apps: Record<string, RebaseAppConfig>;
    /**
     * Buckets are NOT declared here any more.
     *
     * They were, and the runtime merged this block with the declarations in
     * config code — a bucket named in both had one engine kept and the other
     * silently discarded. Two homes for one concept, with a merge to decide
     * between them, is the shape this whole model replaced.
     *
     * `bucket("media", { engine: "s3" })` in the project's config declares one
     * now, and `rebase resources --write` generates `rebase.resources.json`,
     * which is what a host reads before a build. A `storage` block left in this
     * file is refused by the validator, by name, with the replacement in the
     * message — not ignored, because a key that still parses and does nothing
     * is the failure this removed.
     */
    /**
     * Repository-wide opt-out from anonymous CLI usage sharing.
     *
     * **Only `false` does anything.** It suppresses sharing for everyone who
     * clones this repository, overriding each developer's own opt-in — an
     * organisation setting policy for work done on its behalf, the same shape
     * as a committed `.npmrc`.
     *
     * `true` is deliberately ignored, and the CLI says so rather than obeying
     * quietly. This file is committed, so a `true` here would be one developer
     * answering a privacy question for every colleague who later clones the
     * repo — consent by proxy, which is the exact thing opt-in exists to
     * prevent. Individuals opt in with `rebase telemetry enable`.
     */
    telemetry?: boolean;
}

/**
 * The per-checkout project link.
 *
 * Deliberately separate from `rebase.json`: the manifest is committed and shared,
 * while the link is per-developer. Keeping them in one file would mean either
 * committing someone's project id or gitignoring the topology.
 */
export interface RebaseProjectLink {
    /**
     * A Rebase Cloud project id, or the base URL of any running Rebase backend
     * (`https://api.example.com`). Both are first-class: every command that
     * accepts a project reference accepts either, so a self-hosted project has
     * the same tooling as a cloud one.
     */
    project: string;
    /** Organization slug. Cloud projects only. */
    org?: string;
    /** Explicit API base URL, when it differs from the project's default. */
    apiUrl?: string;
}

/**
 * Whether a project can run on the managed runtime, and if not, precisely why.
 *
 * The reasons are returned rather than summarised so tooling can print something
 * a developer can act on. "Not eligible" is never a dead end — it selects the
 * custom-runtime path, which still deploys.
 */
export interface ManagedCompatibility {
    eligible: boolean;
    reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Version of the bundle *format* itself.
 *
 * Bumped only when the on-disk layout changes in a way an older runtime could
 * not read. A runtime accepts any bundle whose `bundleFormat` is less than or
 * equal to its own — old bundles keep booting on new runtimes, which is the
 * whole point of separating the artifact from the engine.
 *
 * - **1** — `mode: "cms" | "baas" | "static"`, `entry.static` a single directory
 *   string, `entry.admin` for a bundled admin panel.
 * - **2** — `kind: "backend" | "static"`, `entry.static` a list of
 *   {@link RebaseBundleStatic}, `entry.admin` removed. A format-1 runtime reading
 *   one of these would find no `mode` and an array where it expects a string, so
 *   the bump is what turns that into a refusal to boot instead of a bundle that
 *   starts and serves nothing.
 */
export const BUNDLE_FORMAT_VERSION = 2;

/**
 * The runtime contract major.
 *
 * Distinct from the `@rebasepro/server` package version: the package may release
 * any number of minors and patches while this stays put. It changes only when
 * the bundle/runtime contract breaks compatibility, and a project's
 * `manifest.runtime` range is matched against *this*.
 *
 * ## v2 — resources are declared, not configured
 *
 * `RebaseBackendConfig.dataSources` and `.storageSources` are gone. A project
 * declares its databases and buckets with `database()` / `bucket()` in its
 * config, and the runtime reads those declarations.
 *
 * This had to be a major, and the reason is the managed tier: it moves projects
 * onto new images WITHOUT rebuilding them. A bundle built against v1 exports
 * those keys, and a v2 runtime refuses them at boot — so without this bump, one
 * image rollout would crash-loop every tenant that had ever declared a second
 * database or bucket, in a wave, with the cause in a container log nobody is
 * watching.
 *
 * With the bump, a v1 bundle on a v2 runtime is refused by
 * `assertBundleCompatibility` with the remedy in the message, and the platform
 * keeps it on a v1 image until it is rebuilt. That is the whole purpose of this
 * number.
 *
 * **Release order matters and is not optional.** The control plane is the side
 * that rejects, so it ships FIRST: raise `SUPPORTED_RUNTIME_CONTRACT` in the
 * saas repo (it rejects only `contract >` its own, so it then accepts both),
 * deploy that, and only then release a runtime implementing v2. Shipping the
 * runtime first turns every deploy into a rejected intake blaming the tenant's
 * bundle.
 */
export const RUNTIME_CONTRACT_VERSION = 2;

/** Where the runtime finds each part of the bundle. Paths are bundle-relative. */
export interface RebaseBundleEntrypoints {
    /** Compiled config package directory (collections live under it). */
    config?: string;
    /** Compiled collections directory, when it differs from `<config>/collections`. */
    collections?: string;
    /** Compiled functions directory. */
    functions?: string;
    /** Compiled crons directory. */
    crons?: string;
    /** Compiled Drizzle schema module. */
    schema?: string;
    /** Module exporting the auth users collection (default export). */
    usersCollection?: string;
    /**
     * Built static apps to serve from this process, in declaration order.
     *
     * A list rather than a single directory because one process serves several
     * apps at different paths — a site at `/` and the admin at `/admin`. The
     * runtime mounts them longest-path-first so the `/`-rooted app's catch-all
     * does not claim its siblings' URLs.
     */
    static?: RebaseBundleStatic[];
}

/** One built static app inside a bundle. */
export interface RebaseBundleStatic {
    /** Public base path, e.g. `/` or `/admin`. */
    path: string;
    /** Bundle-relative directory holding the built assets. */
    dir: string;
    /** Serve `index.html` for unmatched paths under `path`. */
    spa: boolean;
}

/**
 * A native module found in the dependency closure.
 *
 * Recorded rather than merely counted so a rejection can name the offending
 * package instead of saying "something here is native".
 */
export interface NativeDependency {
    name: string;
    /** Why it was flagged — a `.node` binary, a gyp build, or an install script. */
    reason: string;
}

/**
 * `manifest.json` — generated, and the document the runtime and control plane
 * both validate against.
 */
/**
 * One custom function, as recorded in a built bundle.
 *
 * @see RebaseBundleManifest.functions
 */
export interface RebaseBundleFunction {
    /**
     * The filename without its extension — which is also the URL segment it
     * mounts at (`/api/functions/<name>`), the API-key permission that grants
     * it, and the name `REBASE_FUNCTIONS_ONLY` selects by. One identity, used
     * everywhere.
     */
    name: string;
    /** Path inside the bundle, so a host can point at the file. */
    file: string;
    /**
     * `false` when the function's own source imports a Node built-in or a
     * package that needs one.
     *
     * Descriptive, never a gate: nothing refuses to build or deploy on this. It
     * says where this function *could* run, not where it should.
     */
    portable: boolean;
    /**
     * Why it is not portable — one short phrase per reason, deduplicated.
     * Absent when it is.
     */
    requires?: string[];
}

export interface RebaseBundleManifest {
    /** @see BUNDLE_FORMAT_VERSION */
    bundleFormat: number;
    runtime: {
        /** The `runtime` range copied from `rebase.json`. */
        range: string;
        /** Exact `@rebasepro/server` version this bundle was built against. */
        builtAgainst: string;
        /** Runtime contract major this bundle requires. */
        contract: number;
    };
    /**
     * Hash of the compiled collection definitions.
     *
     * This is the contract stamp. A generated SDK records the value it was built
     * from, a client sends it back, and a mismatch is what lets the platform say
     * "this app was built against an older schema" instead of failing mysteriously
     * at the first request. It covers collections only — a hook edit does not
     * change a client's contract, so it must not invalidate every SDK.
     */
    schemaVersion: string;
    /** Which app in `rebase.json` this bundle was built from. */
    app: string;
    /**
     * What the runtime does with this bundle.
     *
     * - `backend` — boot the full server: database, auth and the data API, plus
     *   any static apps in `entry.static`.
     * - `static` — no backend at all: serve `entry.static` and nothing else. No
     *   database, no auth, no data sources. This is how a static app runs on the
     *   same image as the backend.
     *
     * Replaces an earlier `mode: "cms" | "baas" | "static"`. The cms/baas
     * distinction was never a third kind of thing — it is simply whether
     * `entry.config` is present, so it is derived rather than declared.
     */
    kind: "backend" | "static";
    entry: RebaseBundleEntrypoints;
    /** Collection slugs contained in the bundle, for quick inspection. */
    collections?: string[];
    /**
     * Every custom function in the bundle, named and classified.
     *
     * Two things are recorded per function, and both are answers a host would
     * otherwise have to get by importing user code:
     *
     * - **What it is called.** That name is the function's identity everywhere —
     *   the URL segment it mounts at, the `functions/<name>` API-key
     *   permission, the value `REBASE_FUNCTIONS_ONLY` selects by. A host that
     *   wants to give one slow function its own replica count currently has to
     *   boot the bundle to discover what is in it.
     * - **Whether it needs Node.** Purely descriptive: a function that opens a
     *   file or runs raw SQL is a fine function, and every deployment today is
     *   a Node process. It is recorded because the question "which of these
     *   could run somewhere else" has to be answerable from the artifact, and
     *   because answering it per-file after the fact — across a codebase
     *   already written — is the expensive version of the same question.
     *
     * Absent on a bundle built before this field existed, which is why every
     * consumer must treat it as optional rather than as an empty list.
     */
    functions?: RebaseBundleFunction[];
    hooks: {
        /**
         * Whether the dependency closure contains native code.
         *
         * The managed runtime refuses these: a prebuilt binary cannot be run on
         * an image the platform did not build it for, and the honest failure is
         * at deploy time rather than at 3am in a crash loop.
         */
        native: boolean;
        nativeModules?: NativeDependency[];
    };
    /**
     * What the bundle's config says about storage access control.
     *
     * Storage is not under RLS and its keys share one flat namespace, so a
     * deployment with file storage enabled and no access model serves every
     * user's files to every signed-in user. The runtime refuses to boot in that
     * state — which, on a hosted platform that enables storage from the *console*
     * rather than from the bundle, surfaces as a crash loop the developer cannot
     * read.
     *
     * Recording it here lets a host reject the deploy with the reason instead.
     * Absent on bundles built before this field existed.
     */
    storage?: {
        /** Whether the config package exports a `storageAuthorize` hook. */
        authorize: boolean;
        /**
         * Buckets, on bundles built before {@link RebaseBundleManifest.resources}.
         *
         * No longer written. A host reads `resources`, which carries every kind
         * in one list; this stays declared so a control plane can keep reading
         * the bundles a project shipped before it was rebuilt.
         */
        sources?: StorageSourceDefinition[];
    };
    /**
     * Everything the project declares it needs — databases, buckets, topics,
     * and whatever kind is registered next.
     *
     * Recorded so a host can tell, from the artifact alone and before starting
     * anything, what a deploy will need provisioned. That question used to be
     * answerable for buckets and for nothing else, because buckets were the
     * only kind written into an artifact — which is how a project's databases
     * became invisible to the platform that runs them.
     *
     * Absent on bundles built before this field existed.
     */
    resources?: ResourceGraph;
    deps: {
        /** Runtime dependencies of user code, as declared. */
        declared: Record<string, string>;
        /**
         * The dependency tree ships *inside* the bundle, already installed.
         *
         * Absent or false means the tree is declared but not present, and
         * whoever boots the bundle has to install it. On the managed runtime that
         * install runs in an init container on **every** pod start — the bundle
         * lives on a volume that is wiped each time — and it is the single
         * largest cost in a managed pod's life: 35–55 seconds of a 40–60 second
         * cold start. Since a pod restarts on every eviction, node failure, OOM
         * and runtime rollout, that number is not a startup detail. It is what an
         * outage costs.
         *
         * Vendoring moves the install to build time, where it happens once. It is
         * skipped when the closure contains native code, because a prebuilt
         * binary is only valid for the platform it was built for — see
         * {@link vendorTarget} for what "the platform" means here.
         */
        vendored?: boolean;
        /**
         * What {@link vendored} was resolved for, recorded so a mismatch can be
         * refused rather than discovered at import time.
         *
         * Cross-platform vendoring is safe for pure JavaScript and unsafe for
         * anything compiled, and the boundary between them is not always visible
         * in a dependency list: `esbuild` is pure-JS with a *platform-specific
         * optional dependency* holding the actual binary, so an install run on a
         * developer's Mac silently produces a tree that cannot run on the Linux
         * image. The install therefore resolves optional dependencies for the
         * target explicitly rather than for the machine it runs on, and records
         * the answer here.
         */
        vendorTarget?: {
            /** npm `--os`, e.g. `linux`. */
            os: string;
            /** npm `--cpu`, e.g. `x64`. */
            cpu: string;
            /** Node major the tree was resolved for. */
            node: string;
        };
    };
    build: {
        /** `@rebasepro/cli` version that produced this bundle. */
        cli: string;
        /** Node major the bundle was compiled on. */
        node: string;
        /** ISO-8601. */
        createdAt: string;
    };
}

/** The contract a running backend serves at `GET /api/meta/contract`. */
export interface RebaseProjectContract {
    /** Matches {@link RebaseBundleManifest.schemaVersion}. */
    schemaVersion: string;
    runtime: {
        /** `@rebasepro/server` version currently running. */
        version: string;
        contract: number;
    };
    /** Full collection definitions, serialized — the input to SDK generation. */
    collections: unknown[];
    /** Collection slugs, for cheap inspection without parsing the definitions. */
    collectionSlugs: string[];
    generatedAt: string;
}

/** Header carrying the schema version an SDK was generated from. */
export const SCHEMA_VERSION_HEADER = "x-rebase-schema";
