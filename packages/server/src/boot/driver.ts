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
import { findPackageDir, readPackageVersion } from "./version-skew";

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
) => DriverConnection;

type DriverAdapterFactory = (config: Record<string, unknown>) => DatabaseAdapter;

/**
 * The connection handle a driver hands back at boot: the client object, the
 * pool to close on shutdown, and how to probe it.
 *
 * Named `DatabaseConnection` until that collided with `DatabaseConnection` in
 * `@rebasepro/types` — an abstract `{ type, isConnected, close() }` that
 * `MongoDBConnection` implements. The two share no field, and both are public:
 * one is re-exported from `@rebasepro/server`'s index, the other from
 * `@rebasepro/types`, packages that are installed together.
 */
export interface DriverConnection {
    db: unknown;
    /**
     * Present for pool-based drivers. Closed during shutdown, and used to probe
     * the source for health — `query` lives here, not on the connection itself.
     */
    pool?: {
        end: () => Promise<void>;
        query?: (sql: string) => Promise<unknown>;
    };
    /** Some drivers expose a query directly instead of via a pool. */
    query?: (sql: string) => Promise<unknown>;
    connectionString?: string;
}

/**
 * Run a trivial query against a source, to see whether it answers.
 *
 * Returns `undefined` when the driver exposes no way to ask — a driver that
 * cannot be probed must not be reported as unhealthy, only as unknown.
 */
export async function probeDataSource(
    source: InitializedDataSource
): Promise<{ healthy: boolean; error?: string } | undefined> {
    const query = source.connection.query ?? source.connection.pool?.query;
    if (typeof query !== "function") return undefined;

    try {
        await query.call(source.connection.pool ?? source.connection, "SELECT 1");
        return { healthy: true };
    } catch (err) {
        return {
            healthy: false,
            error: err instanceof Error ? err.message : String(err)
        };
    }
}

/** One initialized data source: its bootstrapper plus the handle to close. */
export interface InitializedDataSource {
    key: string;
    engine: string;
    driverPackage: string;
    /**
     * The driver's installed version, when it could be read.
     *
     * Carried so a boot that finds a capability missing can say whether the
     * driver is *old* or merely *different* — see `version-skew.ts`. Optional
     * because a driver resolved from outside a `node_modules` tree (a linked
     * workspace, a bare specifier) has no manifest to read, and that must not
     * be fatal.
     */
    driverVersion?: string;
    bootstrapper: BackendBootstrapper;
    connection: DriverConnection;
}

export interface BundleSchema {
    tables?: Record<string, unknown>;
    enums?: Record<string, unknown>;
    relations?: Record<string, unknown>;
}

/**
 * Where to look for packages a bundle brought with it.
 *
 * A driver has to be resolved relative to the **bundle**, not to this package.
 * A bare `import("@rebasepro/server-postgres")` resolves from wherever the
 * runtime itself is installed, which on a real deployment is somewhere else
 * entirely — the runtime image holds the server, the bundle holds the project's
 * dependencies. Resolving from the bundle is also the honest semantics: the
 * project declares which driver it uses, so the project's tree is where to look.
 *
 * Several roots, because a driver is installed wherever the project keeps its
 * dependencies: beside a built bundle, but inside the backend package in a
 * workspace running from source.
 */
export function bundleResolutionRoots(bundleDir: string): string[] {
    return [
        bundleDir,
        path.join(bundleDir, "backend"),
        path.join(bundleDir, "config")
    ];
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
    /** Where the driver was found, when it resolved from a `node_modules` tree. */
    packageDir?: string;
}> {
    let specifier = packageName;
    let resolvedDir: string | undefined;

    for (const root of resolveFrom) {
        const packageDir = findPackageDir(root, packageName);
        const entry = packageDir ? resolvePackageEntry(packageDir) : undefined;
        if (entry) {
            specifier = pathToFileURL(entry).href;
            resolvedDir = packageDir;
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

    return { createConnection, createAdapter, packageDir: resolvedDir };
}

/**
 * Wrap a `DatabaseAdapter` as a `BackendBootstrapper` carrying a registry id.
 *
 * `initializeRebaseBackend` does this internally for its single-adapter
 * convenience path, but that path hardcodes one anonymous driver. Multiple
 * sources need an explicit `id` per adapter, because the id is exactly what
 * `collection.dataSource` routes against.
 */
export function adapterToBootstrapper(
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
        // Load-bearing for a managed boot: the runtime creates a fresh tenant's
        // tables and RLS through these at boot. Dropping them here (the previous
        // shape did) left the schema-ensure feature dead on the real adapter
        // path — `boot.ts` saw no method and skipped, so every data route 500'd
        // on a missing relation with only a "driver does not implement" warning.
        ensureCollectionSchema: adapter.ensureCollectionSchema
            ? (collections, driverResult, log) =>
                adapter.ensureCollectionSchema!(collections, driverResult, log)
            : undefined,
        ensureCollectionPolicies: adapter.ensureCollectionPolicies
            ? (collections, driverResult, log) =>
                adapter.ensureCollectionPolicies!(collections, driverResult, log)
            : undefined,
        readCollectionsSchemaVersion: adapter.readCollectionsSchemaVersion
            ? (driverResult) => adapter.readCollectionsSchemaVersion!(driverResult)
            : undefined,
        stampCollectionsSchemaVersion: adapter.stampCollectionsSchemaVersion
            ? (version, driverResult) => adapter.stampCollectionsSchemaVersion!(version, driverResult)
            : undefined,
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
    const { createConnection, createAdapter, packageDir } = await importDriver(source.driverPackage, resolveFrom);
    const driverVersion = packageDir ? readPackageVersion(packageDir) : undefined;

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
        driver: source.driverPackage,
        driverVersion
    });

    return {
        key: source.key,
        engine: source.engine,
        driverPackage: source.driverPackage,
        driverVersion,
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
