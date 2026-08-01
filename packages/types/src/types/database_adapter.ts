/**
 * @module DatabaseAdapter
 *
 * Pluggable database abstraction for Rebase.
 *
 *
 * A `DatabaseAdapter` focuses purely on data persistence and related concerns (realtime, history).
 * It does NOT handle authentication — auth is managed separately by an `AuthAdapter`.
 *
 * @example
 * ```ts
 * import { createPostgresAdapter } from "@rebasepro/server-postgres";
 *
 * initializeRebaseBackend({
 *   database: createPostgresAdapter({ connection: db, schema }),
 *   auth: { jwtSecret: "..." },
 * });
 * ```
 *
 * @group Backend
 */

import type { DataDriver } from "../controllers/data_driver";
import type { CollectionConfig } from "./collections";
import type {
    CollectionRegistryInterface,
    DatabaseAdmin,
    InitializedDriver,
    RealtimeProvider,
    BootstrappedAuth
} from "./backend";
import type { HistoryConfig } from "../controllers/client";

/**
 * A `DatabaseAdapter` provides data persistence for Rebase.
 *
 * @group Backend
 */
export interface DatabaseAdapter {
    /**
     * Which database engine this adapter handles.
     *
     * @example "postgres", "mysql", "mongodb", "sqlite"
     */
    readonly type: string;

    /**
     * Create the DataDriver for CRUD operations.
     *
     * This is the only **required** method.
     *
     * @param config - Coordinator-provided config containing registered
     *                 collections and the collection registry.
     */
    initializeDriver(config: DatabaseAdapterInitConfig): Promise<InitializedDriver>;

    /**
     * Create a realtime provider for this database.
     *
     * Return `undefined` if the database does not support realtime
     * change notifications.
     */
    initializeRealtime?(driverResult: InitializedDriver): Promise<RealtimeProvider | undefined>;

    /**
     * Initialize auth tables / services if this driver supports them.
     */
    initializeAuth?(
        config: unknown,
        driverResult: InitializedDriver,
    ): Promise<BootstrappedAuth | undefined>;

    /**
     * Initialize entity history tracking.
     *
     * Return `undefined` if the database does not support history.
     */
    initializeHistory?(
        config: HistoryConfig,
        driverResult: InitializedDriver,
    ): Promise<{ historyService: unknown } | undefined>;

    /**
     * Initialize WebSocket server for realtime operations.
     *
     * `adapter` is the configured AuthAdapter, if any. It is what makes the
     * socket secure by default: an implementation that receives one requires
     * authentication regardless of whether a local `jwtSecret` exists. The
     * parameter was missing from this signature while the caller in `init.ts`
     * already passed it, so it was dropped at every adapter that routed through
     * here — turning an adapter-authenticated server's socket into one that
     * accepted every client as already authenticated.
     */
    initializeWebsockets?(
        server: unknown,
        realtimeService: RealtimeProvider,
        driver: DataDriver,
        config?: unknown,
        adapter?: import("./auth_adapter").AuthAdapter,
    ): Promise<void> | void;

    /**
     * Bring the database's collection tables up to date, additively — the boot
     * companion to `db push`. See `BackendBootstrapper.ensureCollectionSchema`
     * for the contract (create-only; never drop, narrow, or rewrite).
     *
     * Optional, and MUST be forwarded by any wrapper that turns this adapter
     * into a `BackendBootstrapper`: the runtime calls it through the bootstrapper
     * at boot, and a wrapper that silently omits it leaves a managed tenant
     * 500ing every data route with no create step ever having run.
     */
    ensureCollectionSchema?(
        collections: unknown[],
        driverResult: InitializedDriver,
        log?: (message: string) => void,
    ): Promise<{ applied: number }>;

    /**
     * Apply the collections' RLS policies (ENABLE ROW LEVEL SECURITY + the
     * `securityRules` compiled to `CREATE POLICY`) — the boot companion to the
     * policy half of `db push`. Idempotent; see
     * `BackendBootstrapper.ensureCollectionPolicies`.
     *
     * Same forwarding requirement as `ensureCollectionSchema`: without the
     * policies, tables exist but every user-context read is denied (a public
     * collection answers 401).
     */
    ensureCollectionPolicies?(
        collections: unknown[],
        driverResult: InitializedDriver,
        log?: (message: string) => void,
    ): Promise<{ applied: number }>;

    /**
     * Return admin capabilities for this database (SQL editor, schema browser, branching).
     */
    getAdmin?(driverResult: InitializedDriver): DatabaseAdmin | undefined;

    /**
     * Mount any database-specific HTTP routes (e.g., custom admin endpoints).
     *
     * Called after all adapters are initialized.
     */
    mountRoutes?(app: unknown, basePath: string, driverResult: InitializedDriver): void;

    /**
     * Graceful shutdown: close connections, release resources.
     */
    destroy?(): Promise<void>;
}

/**
 * Configuration passed by the coordinator to `DatabaseAdapter.initializeDriver()`.
 *
 * @group Backend
 */
export interface DatabaseAdapterInitConfig {
    /** Registered collection definitions. */
    collections: CollectionConfig[];
    /** The shared collection registry to register into. */
    collectionRegistry: CollectionRegistryInterface;
    /**
     * Whether this driver should describe its own schema.
     *
     * True when the project declared no collections, so there is nothing to
     * serve unless the driver reads the live database and reports what it found
     * on `InitializedDriver.collections`. Drivers that cannot introspect may
     * ignore it — `initializeRebaseBackend` fails the boot with their name
     * rather than serving nothing.
     *
     * This was a `mode: "cms" | "baas"` flag, which was never independent of
     * `collections`: every consumer already required the list to be empty
     * before acting on it, so the flag could only ever agree or contradict.
     */
    introspectCollections?: boolean;
    /**
     * Options for an introspecting driver — see `RebaseBackendConfig.baas`.
     * Drivers that introspect should honour `unprotectedTables`.
     */
    baas?: { unprotectedTables?: "exclude" | "serve" };
}
