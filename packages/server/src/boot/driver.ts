import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type {
    BackendBootstrapper,
    DatabaseAdapter,
    DatabaseAdapterInitConfig,
    InitializedDriver
} from "@rebasepro/types";
import { logger } from "../utils/logger";
import { BundleError } from "./bundle";
import type { ResolvedDataSourceConfig } from "./sources";

/**
 * Database drivers are loaded by name at runtime rather than imported.
 *
 * They have to be: every driver package depends on this one (it implements the
 * adapter interfaces defined here), so a static import would be a cycle. Loading
 * by name also keeps the runtime honestly database-agnostic — the image has no
 * opinion about Postgres, it resolves whichever driver each data source declares.
 */

/** What a driver package must export to be bootable. */
interface DriverModule {
    createDatabaseConnection?: DriverConnectionFactory;
    createPostgresDatabaseConnection?: DriverConnectionFactory;
    createAdapter?: DriverAdapterFactory;
    createPostgresAdapter?: DriverAdapterFactory;
}

type DriverConnectionFactory = (
    connectionString: string,
    schema?: Record<string, unknown>,
    poolConfig?: Record<string, unknown>
) => DatabaseConnection;

type DriverAdapterFactory = (config: Record<string, unknown>) => DatabaseAdapter;

/** The connection handle a driver hands back. */
export interface DatabaseConnection {
    db: unknown;
    /** Present for pool-based drivers; closed during shutdown when it is. */
    pool?: { end: () => Promise<void> };
    connectionString?: string;
}

/** One initialized data source: its bootstrapper plus the handle to close. */
export interface InitializedDataSource {
    key: string;
    engine: string;
    driverPackage: string;
    bootstrapper: BackendBootstrapper;
    connection: DatabaseConnection;
}

export interface BundleSchema {
    tables?: Record<string, unknown>;
    enums?: Record<string, unknown>;
    relations?: Record<string, unknown>;
}

/**
 * Locate a package by walking `node_modules` up from a directory.
 *
 * The driver has to be resolved relative to the **bundle**, not to this package.
 * A bare `import("@rebasepro/server-postgres")` resolves from wherever the
 * runtime itself is installed, which on a real deployment is somewhere else
 * entirely — the runtime image holds the server, the bundle holds the project's
 * dependencies. Resolving from the bundle is also the honest semantics: the
 * project declares which driver it uses, so the project's tree is where to look.
 */
function findPackageDir(fromDir: string, packageName: string): string | undefined {
    let dir = path.resolve(fromDir);
    for (;;) {
        const candidate = path.join(dir, "node_modules", ...packageName.split("/"));
        if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/** The ESM entry a package declares, preferring `exports` over the legacy fields. */
function resolvePackageEntry(packageDir: string): string | undefined {
    let pkg: {
        exports?: unknown;
        module?: string;
        main?: string;
    };
    try {
        pkg = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
    } catch {
        return undefined;
    }

    const fromExports = (value: unknown): string | undefined => {
        if (typeof value === "string") return value;
        if (!value || typeof value !== "object") return undefined;
        const record = value as Record<string, unknown>;
        // Import first: this is an ESM runtime, and a driver's `require` entry
        // may not exist at all.
        for (const condition of ["import", "module", "default", "node"]) {
            const resolved = fromExports(record[condition]);
            if (resolved) return resolved;
        }
        return undefined;
    };

    const candidate = (pkg.exports && typeof pkg.exports === "object"
        ? fromExports((pkg.exports as Record<string, unknown>["."]) ?? pkg.exports)
        : fromExports(pkg.exports))
        ?? pkg.module
        ?? pkg.main;

    if (!candidate) return undefined;
    const entry = path.resolve(packageDir, candidate);
    return fs.existsSync(entry) ? entry : undefined;
}

/**
 * Import a driver package, resolving its factories under either naming scheme.
 *
 * The generic names are the contract going forward; the Postgres-specific ones
 * are still accepted so a bundle can run against a driver release that predates
 * the generic aliases.
 */
async function importDriver(packageName: string, resolveFrom: string[] = []): Promise<{
    createConnection: DriverConnectionFactory;
    createAdapter: DriverAdapterFactory;
}> {
    let specifier = packageName;

    // Several roots, because a driver is installed wherever the project keeps
    // its dependencies: beside a built bundle, but inside the backend package
    // in a workspace running from source.
    for (const root of resolveFrom) {
        const packageDir = findPackageDir(root, packageName);
        const entry = packageDir ? resolvePackageEntry(packageDir) : undefined;
        if (entry) {
            specifier = pathToFileURL(entry).href;
            break;
        }
    }

    let mod: DriverModule;
    try {
        mod = await import(specifier) as DriverModule;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new BundleError(
            `Could not load the database driver "${packageName}": ${message}`,
            `Install it alongside the runtime (e.g. \`npm install ${packageName}\`), ` +
            "or point the data source at a different driver with REBASE_DRIVER."
        );
    }

    const createConnection = mod.createDatabaseConnection || mod.createPostgresDatabaseConnection;
    const createAdapter = mod.createAdapter || mod.createPostgresAdapter;

    if (!createConnection || !createAdapter) {
        throw new BundleError(
            `"${packageName}" does not look like a Rebase database driver.`,
            "A driver must export `createDatabaseConnection` and `createAdapter`."
        );
    }

    return { createConnection,
createAdapter };
}

/**
 * Wrap a `DatabaseAdapter` as a `BackendBootstrapper` carrying a registry id.
 *
 * `initializeRebaseBackend` does this internally for its single-adapter
 * convenience path, but that path hardcodes one anonymous driver. Multiple
 * sources need an explicit `id` per adapter, because the id is exactly what
 * `collection.dataSource` routes against.
 */
function adapterToBootstrapper(
    adapter: DatabaseAdapter,
    id: string,
    isDefault: boolean
): BackendBootstrapper {
    return {
        type: adapter.type,
        id,
        isDefault,
        initializeDriver: (initConfig: unknown) =>
            adapter.initializeDriver(initConfig as DatabaseAdapterInitConfig),
        initializeRealtime: adapter.initializeRealtime
            ? (_config: unknown, driverResult: InitializedDriver) =>
                adapter.initializeRealtime!(driverResult)
            : undefined,
        initializeAuth: adapter.initializeAuth,
        initializeHistory: adapter.initializeHistory,
        initializeWebsockets: adapter.initializeWebsockets,
        getAdmin: adapter.getAdmin,
        mountRoutes: adapter.mountRoutes
    };
}

/**
 * Build a driver for one data source.
 *
 * Only the default source receives the bundle's Drizzle schema: the schema
 * describes the tables generated from this project's collections, which live in
 * the default database. Handing it to a secondary source would tell that
 * driver's adapter about tables it does not have.
 */
export async function initializeDataSource(
    source: ResolvedDataSourceConfig,
    schema: BundleSchema | undefined,
    resolveFrom: string[] = []
): Promise<InitializedDataSource> {
    const { createConnection, createAdapter } = await importDriver(source.driverPackage, resolveFrom);

    // Every in-tree caller passes `undefined` for the connection's own schema —
    // drizzle only needs it for the relational query API, which the drivers do
    // not use, and passing the grouped bundle schema here would register
    // "tables"/"enums"/"relations" as if they were table names.
    const connection = createConnection(source.connectionString, undefined, source.poolConfig);

    const adapter = createAdapter({
        connection: connection.db,
        connectionString: connection.connectionString ?? source.connectionString,
        adminConnectionString: source.adminConnectionString || source.connectionString,
        readConnectionString: source.readConnectionString,
        ...(source.isDefault && schema ? { schema } : {})
    });

    logger.info("Initialized data source", {
        key: source.key,
        engine: source.engine,
        driver: source.driverPackage
    });

    return {
        key: source.key,
        engine: source.engine,
        driverPackage: source.driverPackage,
        bootstrapper: adapterToBootstrapper(adapter, source.key, source.isDefault),
        connection
    };
}

/**
 * Build drivers for every resolved data source.
 *
 * Sequential on purpose: a failure on the second source should not leave a
 * half-opened pool from a third racing behind it, and the log then reads in the
 * order a human would expect.
 */
export async function initializeDataSources(
    sources: ResolvedDataSourceConfig[],
    schema: BundleSchema | undefined,
    resolveFrom: string[] = []
): Promise<InitializedDataSource[]> {
    const initialized: InitializedDataSource[] = [];
    try {
        for (const source of sources) {
            initialized.push(await initializeDataSource(source, schema, resolveFrom));
        }
    } catch (err) {
        // Close whatever did open, so a failed boot does not hold connections
        // against the database while the container restarts.
        await Promise.allSettled(
            initialized.map(s => s.connection.pool?.end())
        );
        throw err;
    }
    return initialized;
}
