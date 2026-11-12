import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
    BUNDLE_FORMAT_VERSION,
    LEGACY_LAYOUT_REMEDY,
    RUNTIME_CONTRACT_VERSION,
    isValidAppHost,
    reservedPrefixFor,
    type RebaseBundleManifest,
    type RebaseBundleStatic,
    type TableHooks
} from "@rebasepro/types";
import type { StorageAuthorize } from "../storage/types";
import { logger } from "../utils/logger";
import { assertNoReplacedResourceConfig } from "./resource-adapters";

/** Thrown when a bundle cannot be read, or claims a contract this runtime cannot honour. */
export class BundleError extends Error {
    constructor(message: string, readonly hint?: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "BundleError";
    }
}

/** A bundle that has been located and whose manifest has been validated. */
export interface LoadedBundle {
    dir: string;
    manifest: RebaseBundleManifest;
    /**
     * Absolute path to the `backend/schema` directory (compiled, or the source
     * one for `rebase dev`), when the bundle declares tables.
     */
    tablesDir?: string;
    /** Absolute path to the `backend/resources` module, when there is one. */
    resourcesModule?: string;
    /** Absolute path to the `backend/storage` module (`storageAuthorize`), when there is one. */
    storageModule?: string;
    /** Absolute path to the `backend/hooks` module (global table `hooks`), when there is one. */
    hooksModule?: string;
    functionsDir?: string;
    cronsDir?: string;
    /**
     * Built static apps to serve from this process, in mount order.
     *
     * A list, not a single directory: one process serves a site at `/` and an
     * admin at `/admin`. Entries whose directory is missing are dropped with a
     * warning, so a partially-built bundle still boots its API.
     */
    staticApps: LoadedStaticApp[];
    /**
     * True when this "bundle" is a view over the project's own source tree —
     * what `rebase dev` boots — rather than a built one.
     *
     * The difference matters to anything that would write a file back: the
     * schema editor rewrites schema *source*, which exists on one of these
     * paths and not the other. Read it from here rather than from
     * `manifest.runtime.builtAgainst === "source"`: the manifest is what a
     * build wrote down, and a bundle can carry any string a builder put there.
     */
    isSource: boolean;
}

/** One built static app inside a loaded bundle, with an absolute directory. */
export interface LoadedStaticApp {
    /** Public base path, e.g. `/` or `/admin`. */
    path: string;
    /**
     * The one hostname this app answers on, lowercase — see
     * {@link RebaseBundleStatic.host}. Absent means every hostname.
     */
    host?: string;
    /** Absolute path to the built assets. */
    dir: string;
    /** Serve `index.html` for unmatched paths under `path`. */
    spa: boolean;
}

/**
 * The order static apps are mounted in, which is also the order they are
 * matched in: longest path first, and at an equal path the app that names a
 * hostname before the one that does not.
 *
 * Longest first because the "/"-rooted app's catch-all would otherwise claim
 * every sibling's URLs. Host first at an equal path because `admin.example.com`
 * at "/" is a more specific claim than "every hostname" at "/" — the host-less
 * app still answers on every other hostname, it just loses this one.
 *
 * The CLI orders `entry.static` the same way when it builds; this does not rely
 * on that, because a bundle's order is whatever the program that wrote it chose.
 */
export function compareStaticApps(
    a: Pick<LoadedStaticApp, "path" | "host">,
    b: Pick<LoadedStaticApp, "path" | "host">
): number {
    return b.path.length - a.path.length
        || Number(b.host !== undefined) - Number(a.host !== undefined);
}

/**
 * The file that makes a directory a bundle.
 *
 * Exported because `fetch-bundle.ts` has to recognise the same thing after
 * unpacking, and when it had its own idea of the name — `rebase-bundle.json`,
 * which nothing has ever written — every download was rejected as "not a Rebase
 * bundle". A marker with two spellings is a marker with none.
 */
export const MANIFEST_FILENAME = "manifest.json";

/** The legacy entries a format-2 bundle names, which no format-3 bundle carries. */
const LEGACY_ENTRY_KEYS = ["config", "collections", "usersCollection"] as const;

/**
 * Refuse a bundle built from the `config/collections` layout.
 *
 * Every bundle before format 3 was: its schema is `defineCollection` files in a
 * config package, which this runtime does not read. Booting it would
 * introspect the database instead of serving the declared tables — a
 * different API, announced as healthy. There is no in-runtime adapter: the
 * project's source is migrated once, with the codemod, and rebuilt.
 */
function refuseLegacyLayout(manifest: RebaseBundleManifest, manifestPath: string): void {
    const entry: object = manifest.entry ?? {};
    const legacyKeys = LEGACY_ENTRY_KEYS.filter(key => key in entry);
    if (manifest.bundleFormat >= BUNDLE_FORMAT_VERSION && legacyKeys.length === 0) return;
    const what = manifest.bundleFormat < BUNDLE_FORMAT_VERSION
        ? `${manifestPath} is bundle format ${manifest.bundleFormat}`
        : `${manifestPath} names ${legacyKeys.map(key => `\`entry.${key}\``).join(", ")}`;
    throw new BundleError(
        `${what}: it was built from config/collections, which this runtime (bundle format ` +
        `${BUNDLE_FORMAT_VERSION}, runtime contract v${RUNTIME_CONTRACT_VERSION}) no longer reads — tables come ` +
        "from backend/schema (`defineTable`).",
        `To migrate: ${LEGACY_LAYOUT_REMEDY}.`
    );
}

/**
 * Read and validate a bundle's manifest.
 *
 * The checks here are the runtime half of the compatibility contract, and they
 * all fail loudly at boot rather than at the first request. A container that
 * refuses to start is a deploy that rolls back; a container that starts and then
 * misbehaves is an incident.
 */
export function readBundleManifest(bundleDir: string): RebaseBundleManifest {
    const manifestPath = path.join(bundleDir, MANIFEST_FILENAME);

    if (!fs.existsSync(manifestPath)) {
        throw new BundleError(
            `No ${MANIFEST_FILENAME} found in ${bundleDir}`,
            "Build the project with `rebase build` and point the runtime at the output directory."
        );
    }

    let manifest: RebaseBundleManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RebaseBundleManifest;
    } catch (err) {
        throw new BundleError(
            `${manifestPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
        );
    }

    if (typeof manifest.bundleFormat !== "number") {
        throw new BundleError(`${manifestPath} is missing "bundleFormat".`);
    }

    // Newer format on an older runtime: the layout may have fields this code
    // does not know how to read, so refuse rather than half-load it.
    if (manifest.bundleFormat > BUNDLE_FORMAT_VERSION) {
        throw new BundleError(
            `This bundle uses format ${manifest.bundleFormat}, but this runtime understands up to ${BUNDLE_FORMAT_VERSION}.`,
            "Upgrade the runtime image, or rebuild the bundle with a matching CLI."
        );
    }

    // An older one is refused too, with the codemod: formats 1 and 2 carry
    // collections, and format 3 is where tables begin.
    refuseLegacyLayout(manifest, manifestPath);

    const contract = manifest.runtime?.contract;
    if (typeof contract === "number" && contract !== RUNTIME_CONTRACT_VERSION) {
        throw new BundleError(
            `This bundle targets runtime contract v${contract}, but this runtime implements v${RUNTIME_CONTRACT_VERSION}.`,
            contract > RUNTIME_CONTRACT_VERSION
                ? "Upgrade the runtime image to a version that implements the newer contract."
                : "Rebuild the bundle against the current runtime (`rebase build`), or run a runtime image from the previous major."
        );
    }

    return manifest;
}

/**
 * Locate a bundle and resolve every directory the runtime needs from it.
 *
 * Entry paths in the manifest are bundle-relative and are resolved here, once,
 * so nothing downstream has to know the layout. A declared directory that does
 * not exist is dropped with a warning rather than failing the boot: an empty
 * `functions/` is a perfectly ordinary project, and refusing to start over one
 * would be the runtime inventing a requirement the developer never stated.
 */
/**
 * Resolve a bundle-relative entry, refusing anything that escapes the bundle.
 *
 * Applied to the entries that are `import()`ed — the schema, the config index,
 * the users collection — and not only to the ones that are merely scanned. Those
 * three *execute code*, so they are precisely the ones a malformed or hostile
 * manifest would target, and leaving them unchecked while guarding the read-only
 * paths would be defending the wrong door.
 */
export function resolveBundlePath(
    bundleDir: string,
    entry: string,
    label: string
): string {
    const resolved = path.resolve(bundleDir, entry);
    const relative = path.relative(bundleDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new BundleError(
            `Bundle entry "${label}" points outside the bundle: ${entry}`
        );
    }
    return resolved;
}

/** The extensions a project module is found under: compiled first, then source (`rebase dev` runs under tsx). */
const MODULE_EXTENSIONS = [".js", ".mjs", ".ts", ".mts"] as const;

/**
 * The file a module path names: itself when it is a file, else the first of
 * `<path>.js|.mjs|.ts|.mts` or `<path>/index.*` that exists.
 */
export function resolveModulePath(modulePath: string): string | undefined {
    if (fs.existsSync(modulePath) && fs.statSync(modulePath).isFile()) return modulePath;
    const candidates = [
        ...MODULE_EXTENSIONS.map(ext => `${modulePath}${ext}`),
        ...MODULE_EXTENSIONS.map(ext => path.join(modulePath, `index${ext}`))
    ];
    return candidates.find(candidate => fs.existsSync(candidate));
}

export function loadBundle(bundleDir: string): LoadedBundle {
    const dir = path.resolve(bundleDir);

    if (!fs.existsSync(dir)) {
        throw new BundleError(
            `Bundle directory not found: ${dir}`,
            "Run `rebase build` first, or pass the correct path (e.g. `rebase-server ./dist-bundle`)."
        );
    }

    const manifest = readBundleManifest(dir);

    const resolveEntry = (entry: string | undefined, label: string): string | undefined => {
        if (!entry) return undefined;
        // A manifest is a build artifact, but it is also a file a deploy
        // pipeline moves around — keep every entry inside the bundle so a
        // malformed one cannot point the runtime at arbitrary paths.
        const resolved = resolveBundlePath(dir, entry, label);
        if (!fs.existsSync(resolved)) {
            logger.warn(`Bundle declares ${label} at "${entry}", but that path does not exist — skipping.`);
            return undefined;
        }
        return resolved;
    };

    const entry = manifest.entry ?? {};
    const resolveModule = (module: string | undefined, label: string): string | undefined => {
        if (!module) return undefined;
        const found = resolveModulePath(resolveBundlePath(dir, module, label));
        if (!found) logger.warn(`Bundle declares ${label} at "${module}", but no such module exists — skipping.`);
        return found;
    };

    return {
        dir,
        manifest,
        isSource: false,
        tablesDir: resolveEntry(entry.tables, "tables"),
        resourcesModule: resolveModule(entry.resources, "resources"),
        storageModule: resolveModule(entry.storage, "storage"),
        hooksModule: resolveModule(entry.hooks, "hooks"),
        functionsDir: resolveEntry(entry.functions, "functions"),
        cronsDir: resolveEntry(entry.crons, "crons"),
        staticApps: (entry.static ?? [])
            .map(item => {
                // Before the directory check, so a bad hostname is reported
                // even on an app whose build is missing.
                const host = readStaticAppHost(item);
                refuseReservedStaticPath(item);
                const resolved = resolveEntry(item.dir, `static app "${item.path}"`);
                if (!resolved) return undefined;
                return {
                    path: item.path,
                    // Only when declared, so an app without one is the same
                    // object it always was.
                    ...(host !== undefined ? { host } : {}),
                    dir: resolved,
                    spa: item.spa !== false
                };
            })
            .filter((item): item is LoadedStaticApp => item !== undefined)
            .sort(compareStaticApps)
    };
}

/**
 * Refuse a static app at a path the backend owns (`/api`, `/health`, …).
 *
 * The CLI and the control plane refuse it with the same function, so a bundle
 * that reaches here with one was written by something else. Mounted, the app
 * would sit under routes that answer first: an app nobody can reach, booted
 * without a word.
 */
function refuseReservedStaticPath(item: RebaseBundleStatic): void {
    const reserved = reservedPrefixFor(item.path);
    if (!reserved) return;
    const name = item.name ?? path.basename(item.dir);
    throw new BundleError(
        `Static app "${name}" is at ${item.path}, under ${reserved}, which the backend serves.`,
        "Move the app to another path in rebase.json and rebuild with `rebase build`."
    );
}

/**
 * Read a static app's hostname, refusing one that is not a hostname.
 *
 * Refused rather than dropped: an app whose `host` is ignored is not an app
 * served somewhere else, it is an app served on every hostname — at "/", that
 * is the admin answering on the site's domain. The CLI and the control plane
 * both validate the same field with the same function, so a bundle reaching
 * here with a bad one was written by something else, and saying so at boot is
 * the only place left to say it.
 */
function readStaticAppHost(item: RebaseBundleStatic): string | undefined {
    const host: unknown = item.host;
    if (host === undefined) return undefined;
    if (typeof host === "string" && isValidAppHost(host)) return host;
    const name = item.name ?? path.basename(item.dir);
    throw new BundleError(
        `Static app "${name}" (at ${item.path}) declares host ${JSON.stringify(host)}, which is not a hostname this runtime can serve it on.`,
        "A static app's host is a lowercase public DNS name such as \"admin.example.com\" — no scheme, port or path. " +
        "Fix the app's `path` in rebase.json and rebuild with `rebase build`."
    );
}

/**
 * The Drizzle schema a bundle ships: tables, enums and relations, as generated
 * from the project's collections.
 *
 * **Not what the runtime serves.** The Postgres driver builds its tables from
 * `information_schema` after boot-ensure has run, so this module is loaded for
 * one purpose only: comparing it against the live database at boot and saying
 * so when the committed file has fallen behind (`generated-schema-diff.ts` in
 * `@rebasepro/server-postgres`). It used to be authoritative, and a file one
 * commit behind the database was then able to 500 every request, refuse a boot,
 * or lose a relation from a list read.
 */
export interface BundleSchemaExports {
    tables?: Record<string, unknown>;
    enums?: Record<string, unknown>;
    relations?: Record<string, unknown>;
}

/**
 * Import the bundle's Drizzle schema module, for the boot-time staleness check.
 *
 * Returns `undefined` when the bundle declares none, and that is not a
 * degraded boot: every table the server serves is read from the database. All
 * that is lost is the warning that the committed file no longer describes it.
 */
export async function loadBundleSchema(bundle: LoadedBundle): Promise<BundleSchemaExports | undefined> {
    const entry = bundle.manifest.entry?.schema;
    if (!entry) return undefined;

    const schemaPath = resolveBundlePath(bundle.dir, entry, "schema");
    if (!fs.existsSync(schemaPath)) {
        logger.warn(`Bundle declares a schema at "${entry}", but that file does not exist — continuing without it.`);
        return undefined;
    }

    const mod = await import(pathToFileURL(schemaPath).href) as BundleSchemaExports;
    return {
        tables: mod.tables,
        enums: mod.enums,
        relations: mod.relations
    };
}

/**
 * Build a bundle view over a project's **source** directories.
 *
 * `rebase dev` runs TypeScript directly through tsx, so there is no compiled
 * bundle to load — but everything downstream of loading (drivers, storage, auth,
 * routes) should be identical, or development stops predicting production. This
 * produces the same {@link LoadedBundle} shape from source paths, so the one boot
 * path serves both.
 *
 * Every path defaults to the project layout: `backend/schema` (the tables),
 * `backend/resources`, `backend/storage` and `backend/hooks`.
 *
 * The schema version is left empty deliberately: nothing has been built, so
 * there is no build-time answer, and the runtime computes one from the
 * compiled tables instead.
 */
export function createSourceBundle(options: {
    projectRoot: string;
    /** The schema directory. `backend/schema` when omitted. */
    tables?: string;
    /** The resources module. `backend/resources` when omitted. */
    resources?: string;
    /** The module exporting `storageAuthorize`. `backend/storage` when omitted. */
    storage?: string;
    /** The module exporting global table `hooks`. `backend/hooks` when omitted. */
    hooks?: string;
    functions?: string;
    crons?: string;
    schema?: string;
    app?: string;
}): LoadedBundle {
    const dir = path.resolve(options.projectRoot);
    const resolve = (entry: string | undefined): string | undefined => {
        if (!entry) return undefined;
        const full = path.resolve(dir, entry);
        return fs.existsSync(full) ? full : undefined;
    };
    const resolveModule = (entry: string): string | undefined => resolveModulePath(path.resolve(dir, entry));

    const tables = options.tables ?? "backend/schema";
    const resources = options.resources ?? "backend/resources";
    const storage = options.storage ?? "backend/storage";
    const hooks = options.hooks ?? "backend/hooks";

    // A manifest states what this project HAS, never what it might have: a
    // `--headless`-style project with no schema directory, no generated schema
    // or no hooks module boots without being told its build is broken. A
    // project genuinely missing a file it should have still gets the warning,
    // because then the path is real and empty rather than never declared.
    const manifest: RebaseBundleManifest = {
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: {
            range: `^${RUNTIME_CONTRACT_VERSION}`,
            builtAgainst: "source",
            contract: RUNTIME_CONTRACT_VERSION
        },
        schemaVersion: "",
        app: options.app ?? "backend",
        kind: "backend",
        entry: {
            tables: resolve(tables) ? tables : undefined,
            resources: resolveModule(resources) ? resources : undefined,
            storage: resolveModule(storage) ? storage : undefined,
            hooks: resolveModule(hooks) ? hooks : undefined,
            functions: resolve(options.functions) ? options.functions : undefined,
            crons: resolve(options.crons) ? options.crons : undefined,
            schema: resolve(options.schema) ? options.schema : undefined
        },
        hooks: { native: false },
        deps: { declared: {} },
        build: { cli: "source",
node: process.versions.node.split(".")[0],
createdAt: new Date().toISOString() }
    };

    return {
        dir,
        manifest,
        isSource: true,
        tablesDir: resolve(tables),
        resourcesModule: resolveModule(resources),
        storageModule: resolveModule(storage),
        hooksModule: resolveModule(hooks),
        functionsDir: resolve(options.functions),
        cronsDir: resolve(options.crons),
        staticApps: []
    };
}

/**
 * What a project's backend modules export for the runtime, beside its tables.
 *
 * `storageAuthorize` comes from `backend/storage`, the global table `hooks`
 * from `backend/hooks`. Both are functions, so they can only come from the
 * project's own code — no environment variable can express "this user may
 * read this key".
 */
export interface BundleProjectExports {
    /**
     * Per-object storage access control, from `backend/storage`.
     *
     * Without a way to supply it, a production deployment with a bucket would be
     * forced to choose between `STORAGE_PUBLIC_READ` (world-readable) and
     * `STORAGE_ALLOW_ANY_AUTHENTICATED` (every signed-in user can read, overwrite
     * and delete every other user's files) — the runtime would be making an
     * insecure choice on the developer's behalf.
     */
    storageAuthorize?: StorageAuthorize;
    /** Global table hooks, from `backend/hooks`: run for every table. */
    hooks?: TableHooks;
}

/**
 * Import one of the project's backend modules, fatally when it is there and
 * cannot be imported: every declaration in it would be gone, and the process
 * would come up with a different access model than the project declares,
 * announcing success. That is not a degraded start, it is a different
 * deployment.
 */
async function importProjectModule(file: string, declares: string): Promise<Record<string, unknown>> {
    try {
        return await import(pathToFileURL(file).href) as Record<string, unknown>;
    } catch (err) {
        // A `BundleError`, so the fatal path treats it as the configuration
        // problem it is: the message below IS the answer.
        throw new BundleError(
            `Could not load ${file}.\n\n` +
            `${err instanceof Error ? err.message : String(err)}\n\n` +
            `This module declares ${declares}. Booting without it would serve this project under a ` +
            "different access model than it declares, so this is fatal rather than a warning.",
            undefined,
            { cause: err }
        );
    }
}

/**
 * Read `storageAuthorize` from `backend/storage` and `hooks` from
 * `backend/hooks`.
 *
 * Absent modules are the ordinary case. A malformed export — `hooks` that is
 * not an object — is reported and ignored; a module that fails to import is
 * fatal (see `importProjectModule`).
 */
export async function loadBundleProjectExports(bundle: LoadedBundle): Promise<BundleProjectExports> {
    const out: BundleProjectExports = {};
    if (bundle.storageModule) {
        const mod = await importProjectModule(bundle.storageModule, "this project's storage access control (`storageAuthorize`)");
        // A module still exporting `dataSources` / `storageSources` is refused
        // by name rather than booted with its declarations ignored.
        assertNoReplacedResourceConfig(mod);
        warnOnUnreadProjectExports(mod, bundle.storageModule);
        const value = mod.storageAuthorize;
        if (typeof value === "function") {
            out.storageAuthorize = value as StorageAuthorize;
        } else if (value !== undefined) {
            logger.warn(`${bundle.storageModule} exports "storageAuthorize" but it is not a function — ignoring.`);
        }
    }
    if (bundle.hooksModule) {
        const mod = await importProjectModule(bundle.hooksModule, "this project's global table hooks (`hooks`)");
        assertNoReplacedResourceConfig(mod);
        warnOnUnreadProjectExports(mod, bundle.hooksModule);
        const value = mod.hooks;
        if (typeof value === "object" && value !== null) {
            out.hooks = value as TableHooks;
        } else if (value !== undefined) {
            logger.warn(`${bundle.hooksModule} exports "hooks" but it is not an object of table hooks — ignoring.`);
        }
    }
    return out;
}

/**
 * Everything the managed runtime reads out of a project's backend modules:
 * `storageAuthorize` (`backend/storage`) and `hooks` (`backend/hooks`).
 *
 * `dataSources` and `storageSources` are deliberately absent: a module
 * exporting them is refused by name (`assertNoReplacedResourceConfig`), and the
 * topology they used to carry lives in `backend/resources.ts`. Listing them
 * here would make the docs gate that reads this set say they are still a
 * supported export.
 */
const READ_CONFIG_EXPORTS = new Set([
    "storageAuthorize",
    "hooks",
    // Module machinery.
    "default",
    "__esModule"
]);

/**
 * `initializeRebaseBackend` options that a managed bundle cannot supply.
 *
 * Every one of them is a function or a live handler — something no environment
 * variable can express — so on the managed runtime there is no route for them at
 * all. Exporting one from a backend module looks like it should work, does
 * nothing, and says nothing. Each maps to the honest alternative.
 */
const NO_MANAGED_ROUTE: Record<string, string> = {
    jobs: "no managed route — enqueue from a custom function, or eject and pass `jobs` to initializeRebaseBackend",
    storagePolicies: "no managed route — express the rule in `storageAuthorize`, which IS read from backend/storage",
    storageTriggers: "no managed route — react to the upload in a custom function, or eject",
    rateLimit: "no managed route — put the limit in front of the deployment, or eject",
    webhooks: "no managed route — send from a job or a custom function, or eject",
    auth: "no managed route for `auth.hooks` — the rest of `auth` comes from environment variables; eject to pass hooks"
};

/**
 * Say so when a backend module exports an `initializeRebaseBackend` option
 * nothing will read.
 *
 * Warn, never throw: a project is free to export whatever it likes from its own
 * modules, and a boot that refuses over an unrecognised name would break every
 * project that keeps a shared constant there.
 */
function warnOnUnreadProjectExports(mod: Record<string, unknown>, file: string): void {
    const unread = Object.keys(mod).filter(name => !READ_CONFIG_EXPORTS.has(name));
    const known = unread.filter(name => name in NO_MANAGED_ROUTE);
    if (known.length === 0) return;

    logger.warn(
        `⚠️ ${file} exports ${known.map(name => `\`${name}\``).join(", ")}, and the managed ` +
        "runtime does not read " + (known.length === 1 ? "it" : "them") + ".\n" +
        known.map(name => `  • ${name}: ${NO_MANAGED_ROUTE[name]}`).join("\n") + "\n" +
        "  The runtime reads only `storageAuthorize` (backend/storage) and `hooks` (backend/hooks). " +
        "Databases and buckets are declared in `backend/resources.ts`; everything else is configured " +
        "with environment variables, or by ejecting."
    );
}
