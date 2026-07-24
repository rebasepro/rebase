import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
    BUNDLE_FORMAT_VERSION,
    RUNTIME_CONTRACT_VERSION,
    type CollectionConfig,
    type DataSourceDefinition,
    type RebaseBundleManifest,
    type StorageSourceDefinition
} from "@rebasepro/types";
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
    /** Absolute path to built admin assets, when the admin panel is bundled. */
    adminDir?: string;
    /** Absolute path to built static assets to serve from this process. */
    staticDir?: string;
}

const MANIFEST_FILENAME = "manifest.json";

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
        const resolved = path.resolve(dir, entry);
        // A manifest is a build artifact, not user input, but it is also a file
        // on disk that a deploy pipeline moves around — keep it inside the bundle
        // so a malformed one cannot make the runtime read arbitrary paths.
        const relative = path.relative(dir, resolved);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new BundleError(
                `Bundle entry "${label}" points outside the bundle: ${entry}`
            );
        }
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
        adminDir: resolveEntry(entry.admin, "admin"),
        staticDir: resolveEntry(entry.static, "static")
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

    const schemaPath = path.resolve(bundle.dir, entry);
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
    mode?: "cms" | "baas";
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
        mode: options.mode ?? "cms",
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
        adminDir: undefined,
        staticDir: undefined
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

    const configDir = path.resolve(bundle.dir, configEntry);
    const indexPath = path.join(configDir, "index.js");
    if (!fs.existsSync(indexPath)) return {};

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

    return {
        dataSources: readArray<DataSourceDefinition>("dataSources"),
        storageSources: readArray<StorageSourceDefinition>("storageSources")
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
    const configDir = entry?.config ? path.resolve(bundle.dir, entry.config) : undefined;

    const candidates: string[] = [];
    if (entry?.usersCollection) {
        const declared = path.resolve(bundle.dir, entry.usersCollection);
        candidates.push(declared, `${declared}.js`);
    }
    if (configDir) {
        candidates.push(path.join(configDir, "collections", "users.js"));
    }
    if (bundle.collectionsDir) {
        candidates.push(path.join(bundle.collectionsDir, "users.js"));
    }

    for (const candidate of candidates) {
        if (!candidate.endsWith(".js") || !fs.existsSync(candidate)) continue;
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
