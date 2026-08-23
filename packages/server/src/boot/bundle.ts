import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
    BUNDLE_FORMAT_VERSION,
    RUNTIME_CONTRACT_VERSION,
    type CollectionConfig,
    type CollectionCallbacks,
    type DataSourceDefinition,
    type RebaseBundleManifest,
    type StorageSourceDefinition
} from "@rebasepro/types";
import type { StorageAuthorize } from "../storage/types";
import { logger } from "../utils/logger";

/** Thrown when a bundle cannot be read, or claims a contract this runtime cannot honour. */
export class BundleError extends Error {
    constructor(message: string, readonly hint?: string) {
        super(message);
        this.name = "BundleError";
    }
}

/** A bundle that has been located and whose manifest has been validated. */
export interface LoadedBundle {
    dir: string;
    manifest: RebaseBundleManifest;
    /** Absolute path to the compiled collections directory, when present. */
    collectionsDir?: string;
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
}

/** One built static app inside a loaded bundle, with an absolute directory. */
export interface LoadedStaticApp {
    /** Public base path, e.g. `/` or `/admin`. */
    path: string;
    /** Absolute path to the built assets. */
    dir: string;
    /** Serve `index.html` for unmatched paths under `path`. */
    spa: boolean;
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

/**
 * Bring a format-1 manifest up to the shape the rest of this runtime expects.
 *
 * Old bundles booting on a new runtime is the case the format version exists to
 * protect, so this is not a courtesy — it is the contract. A project built
 * before the rename ships `mode` and a single `entry.static` directory string,
 * and without this it would boot with no `kind` (so every gate keyed on
 * `kind === "backend"` would skip) and an `entry.static` the loader would try to
 * iterate as a list.
 *
 * In place, and only ever filling in what is absent, so a format-2 manifest
 * passes through untouched.
 */
function upgradeLegacyManifest(manifest: RebaseBundleManifest): void {
    const legacy = manifest as RebaseBundleManifest & {
        mode?: string;
        entry?: { static?: unknown; admin?: unknown };
    };

    if (!legacy.kind) {
        // `cms` and `baas` were both backends — the distinction between them is
        // derived from `entry.config` now.
        legacy.kind = legacy.mode === "static" ? "static" : "backend";
    }

    const entry = legacy.entry;
    if (!entry) return;

    if (typeof entry.static === "string") {
        entry.static = [{ path: "/",
dir: entry.static,
spa: true }];
    } else if (!entry.static && typeof entry.admin === "string") {
        // A format-1 bundled admin panel was served at the root, exactly as a
        // static app was — `staticDir ?? adminDir`, one or the other.
        entry.static = [{ path: "/",
dir: entry.admin,
spa: true }];
    }
    delete entry.admin;
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
    // does not know how to read, so refuse rather than half-load it. The reverse
    // — an older bundle on a newer runtime — is the case that must keep working,
    // and does.
    if (manifest.bundleFormat > BUNDLE_FORMAT_VERSION) {
        throw new BundleError(
            `This bundle uses format ${manifest.bundleFormat}, but this runtime understands up to ${BUNDLE_FORMAT_VERSION}.`,
            "Upgrade the runtime image, or rebuild the bundle with a matching CLI."
        );
    }

    upgradeLegacyManifest(manifest);

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

    // Collections live under the config package unless stated otherwise.
    const collectionsDir = entry.collections
        ? resolveEntry(entry.collections, "collections")
        : entry.config
            ? resolveEntry(path.join(entry.config, "collections"), "collections")
            : undefined;

    return {
        dir,
        manifest,
        collectionsDir,
        functionsDir: resolveEntry(entry.functions, "functions"),
        cronsDir: resolveEntry(entry.crons, "crons"),
        staticApps: (entry.static ?? [])
            .map(item => {
                const resolved = resolveEntry(item.dir, `static app "${item.path}"`);
                return resolved ? { path: item.path,
dir: resolved,
spa: item.spa !== false } : undefined;
            })
            .filter((item): item is LoadedStaticApp => item !== undefined)
            // Longest path first, "/" last: the root app's catch-all would
            // otherwise claim every sibling's URLs.
            .sort((a, b) => b.path.length - a.path.length)
    };
}

/**
 * The Drizzle schema a bundle ships: tables, enums and relations, as generated
 * from the project's collections.
 */
export interface BundleSchemaExports {
    tables?: Record<string, unknown>;
    enums?: Record<string, unknown>;
    relations?: Record<string, unknown>;
}

/**
 * Import the bundle's Drizzle schema module.
 *
 * Returns `undefined` when the bundle declares none — `baas` mode introspects the
 * live database instead of shipping a schema.
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
 * The schema version is left empty deliberately: nothing has been built, so
 * there is no build-time answer, and the runtime computes one from the live
 * collections instead.
 */
export function createSourceBundle(options: {
    projectRoot: string;
    config?: string;
    collections?: string;
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

    const configDir = options.config ?? "config";
    const collectionsDir = options.collections
        ?? (options.config !== undefined || fs.existsSync(path.join(dir, configDir))
            ? path.join(configDir, "collections")
            : undefined);

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
            config: options.config ?? configDir,
            collections: collectionsDir,
            functions: options.functions,
            crons: options.crons,
            schema: options.schema
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
        collectionsDir: resolve(collectionsDir),
        functionsDir: resolve(options.functions),
        cronsDir: resolve(options.crons),
        staticApps: []
    };
}

/**
 * Declarations a bundle's config package exports alongside its collections.
 *
 * These describe *topology* — which databases and which buckets exist — so they
 * belong to the project rather than to the environment. The environment then
 * supplies credentials for each declared key. Splitting it this way is what lets
 * a deploy be validated before it runs: the set of things needing configuration
 * is known from the bundle, without reading anyone's secrets.
 */
export interface BundleConfigExports {
    dataSources?: DataSourceDefinition[];
    storageSources?: StorageSourceDefinition[];
    /**
     * Per-object storage access control.
     *
     * A function, so it can only come from the project's own code — there is no
     * environment variable that could express "this user may read this key".
     * Without a way to supply it, a production deployment with a bucket would be
     * forced to choose between `STORAGE_PUBLIC_READ` (world-readable) and
     * `STORAGE_ALLOW_ANY_AUTHENTICATED` (every signed-in user can read, overwrite
     * and delete every other user's files) — the runtime would be making an
     * insecure choice on the developer's behalf.
     */
    storageAuthorize?: StorageAuthorize;
    /** Lifecycle callbacks applied to every collection. */
    callbacks?: CollectionCallbacks;
}

/**
 * Read the config package's `index` for declarations.
 *
 * Absent, empty or unreadable all mean the same thing: a single default database
 * and a single default bucket. That is the overwhelmingly common project, and it
 * must not be required to say so. A malformed export is reported and ignored
 * rather than fatal — a typo in an optional declaration should not take down a
 * server whose collections are fine.
 */
export async function loadBundleConfigExports(bundle: LoadedBundle): Promise<BundleConfigExports> {
    const configEntry = bundle.manifest.entry?.config;
    if (!configEntry) return {};

    const configDir = resolveBundlePath(bundle.dir, configEntry, "config");
    // `.ts` for a source boot (`rebase dev` runs under tsx, which imports
    // TypeScript directly); `.js` for a built bundle.
    const indexPath = [".js", ".ts"]
        .map(ext => path.join(configDir, `index${ext}`))
        .find(candidate => fs.existsSync(candidate));
    if (!indexPath) return {};

    let mod: Record<string, unknown>;
    try {
        mod = await import(pathToFileURL(indexPath).href) as Record<string, unknown>;
    } catch (err) {
        logger.warn(
            `Could not import the config index at ${indexPath}: ` +
            `${err instanceof Error ? err.message : String(err)}. ` +
            "Continuing with a single default data source and storage source."
        );
        return {};
    }

    const readArray = <T>(name: string): T[] | undefined => {
        const value = mod[name];
        if (value === undefined) return undefined;
        if (!Array.isArray(value)) {
            logger.warn(`Config exports "${name}" but it is not an array — ignoring.`);
            return undefined;
        }
        return value as T[];
    };

    const readFunction = <T>(name: string): T | undefined => {
        const value = mod[name];
        if (value === undefined) return undefined;
        if (typeof value !== "function") {
            logger.warn(`Config exports "${name}" but it is not a function — ignoring.`);
            return undefined;
        }
        return value as T;
    };

    const callbacks = mod.callbacks;

    return {
        dataSources: readArray<DataSourceDefinition>("dataSources"),
        storageSources: readArray<StorageSourceDefinition>("storageSources"),
        storageAuthorize: readFunction<StorageAuthorize>("storageAuthorize"),
        callbacks: callbacks && typeof callbacks === "object"
            ? callbacks as CollectionCallbacks
            : undefined
    };
}

/**
 * Import the collection that backs authentication.
 *
 * Auth needs to know which table holds users. The bundle names the module; the
 * convention (`collections/users`) covers every project that did not rename it.
 * Returning `undefined` is valid — a `baas`-mode project has no config package,
 * and the auth bootstrapper falls back to its own default users table.
 */
export async function loadUsersCollection(bundle: LoadedBundle): Promise<CollectionConfig | undefined> {
    const entry = bundle.manifest.entry;
    const configDir = entry?.config
        ? resolveBundlePath(bundle.dir, entry.config, "config")
        : undefined;

    const candidates: string[] = [];
    if (entry?.usersCollection) {
        const declared = resolveBundlePath(bundle.dir, entry.usersCollection, "usersCollection");
        candidates.push(declared, `${declared}.js`, `${declared}.ts`);
    }
    for (const dir of [configDir && path.join(configDir, "collections"), bundle.collectionsDir]) {
        if (!dir) continue;
        candidates.push(path.join(dir, "users.js"), path.join(dir, "users.ts"));
    }

    for (const candidate of candidates) {
        if (!/\.(js|ts)$/.test(candidate) || !fs.existsSync(candidate)) continue;
        try {
            const mod = await import(pathToFileURL(candidate).href) as { default?: CollectionConfig };
            if (mod.default) return mod.default;
            logger.warn(`Users collection module ${candidate} has no default export — ignoring.`);
        } catch (err) {
            logger.warn(
                `Failed to import users collection from ${candidate}: ${err instanceof Error ? err.message : String(err)}`
            );
        }
    }

    return undefined;
}
