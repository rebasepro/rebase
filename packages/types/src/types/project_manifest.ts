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

/**
 * Which kind of thing an app is.
 *
 * - `backend` — the collections/hooks/functions that define the project's API.
 *   Exactly one per *project* (not per repository); the registry enforces it.
 * - `static`  — a pre-built client bundle (SPA, static site) served over CDN.
 * - `admin`   — the Rebase admin panel, either hosted by the platform or built
 *   into this repository.
 * - `mobile`  — a native app. Registration only: it gets client credentials and
 *   configuration, and is never built or hosted here.
 * - `custom`  — an arbitrary container image built from a Dockerfile. The eject
 *   hatch: full control, no managed-runtime guarantees.
 */
export type RebaseAppType = "backend" | "static" | "admin" | "mobile" | "custom";

/**
 * The backend app: the project's API surface.
 *
 * Paths are relative to the directory holding `rebase.json`. The defaults match
 * the layout `rebase init` scaffolds, so a stock project may declare simply
 * `{ "type": "backend" }`.
 */
export interface RebaseBackendAppConfig {
    type: "backend";
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
     * Which collections source the runtime uses.
     *
     * - `cms` (default) — collections come from the config package.
     * - `baas` — collections are introspected from the live database at boot and
     *   the config package is not required.
     */
    mode?: "cms" | "baas";
    /**
     * Module path (relative to `config`) exporting the auth users collection as
     * its default export. Default `collections/users`.
     */
    usersCollection?: string;
}

/**
 * A static client bundle — SPA or static site — built here and served from CDN.
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
     * Serve `index.html` for unmatched paths (client-side routing).
     * Default `true` — the overwhelmingly common case for a client app, and a
     * static *site* generator emits real files for its routes anyway.
     */
    spa?: boolean;
}

/**
 * The admin panel.
 *
 * `hosted` is the default and means the platform serves it — nothing is built
 * into this repository and nothing ships in the bundle. `bundled` builds it here,
 * which is what a self-hosted or air-gapped deployment wants.
 */
export interface RebaseAdminAppConfig {
    type: "admin";
    mode?: "hosted" | "bundled";
    /** Only for `bundled`: package directory containing the admin sources. */
    root?: string;
    /** Only for `bundled`: build command. */
    build?: string;
    /** Only for `bundled`: directory of built assets. */
    output?: string;
}

/**
 * A native app. Registered for credentials and configuration; never built here.
 */
export interface RebaseMobileAppConfig {
    type: "mobile";
    platform: "ios" | "android" | "other";
}

/**
 * An app built from a Dockerfile into an arbitrary image.
 *
 * This is the deliberate escape hatch. A project containing one is not eligible
 * for the managed runtime — the platform cannot make guarantees about an image
 * it did not build — but it still deploys, and nothing else about the project
 * changes.
 */
export interface RebaseCustomAppConfig {
    type: "custom";
    /** Dockerfile path relative to the repository root. */
    dockerfile?: string;
    /** Build context relative to the repository root. Default `.`. */
    context?: string;
    /** Port the container listens on. Default 8080. */
    port?: number;
}

export type RebaseAppConfig =
    | RebaseBackendAppConfig
    | RebaseStaticAppConfig
    | RebaseAdminAppConfig
    | RebaseMobileAppConfig
    | RebaseCustomAppConfig;

/**
 * `rebase.json` — the authored project manifest.
 */
export interface RebaseProjectManifest {
    /** JSON Schema URL, for editor completion. Ignored by the tooling. */
    $schema?: string;
    /**
     * The runtime **major** this project targets, as a semver range
     * (e.g. `^1`, `~1.4`, or an exact `1.4.2` to pin).
     *
     * The platform upgrades patches and minors underneath a project without
     * asking; it never crosses a major. See {@link RUNTIME_CONTRACT_VERSION}.
     */
    runtime: string;
    /**
     * Apps this repository contributes, keyed by app name. The key is the app's
     * identity within the project: it is what `rebase deploy <app>` names, what
     * client credentials are issued against, and what a second repository must
     * not collide with.
     */
    apps: Record<string, RebaseAppConfig>;
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
 */
export const BUNDLE_FORMAT_VERSION = 1;

/**
 * The runtime contract major.
 *
 * Distinct from the `@rebasepro/server` package version: the package may release
 * any number of minors and patches while this stays put. It changes only when
 * the bundle/runtime contract breaks compatibility, and a project's
 * `manifest.runtime` range is matched against *this*.
 */
export const RUNTIME_CONTRACT_VERSION = 1;

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
    /** Built admin assets, when the admin panel is bundled rather than hosted. */
    admin?: string;
    /** Built static assets to serve from the runtime, when not on a CDN. */
    static?: string;
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
    mode: "cms" | "baas";
    entry: RebaseBundleEntrypoints;
    /** Collection slugs contained in the bundle, for quick inspection. */
    collections?: string[];
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
    deps: {
        /** Runtime dependencies of user code, as declared. */
        declared: Record<string, string>;
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
    mode: "cms" | "baas";
    /** Full collection definitions, serialized — the input to SDK generation. */
    collections: unknown[];
    /** Collection slugs, for cheap inspection without parsing the definitions. */
    collectionSlugs: string[];
    generatedAt: string;
}

/** Header carrying the schema version an SDK was generated from. */
export const SCHEMA_VERSION_HEADER = "x-rebase-schema";
