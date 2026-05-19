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
 * import { createPostgresAdapter } from "@rebasepro/server-postgresql";
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
import type { EntityCollection } from "./collections";
import type {
    CollectionRegistryInterface,
    DatabaseAdmin,
    InitializedDriver,
    RealtimeProvider,
} from "./backend";

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
     * Initialize entity history tracking.
     *
     * Return `undefined` if the database does not support history.
     */
    initializeHistory?(
        config: unknown,
        driverResult: InitializedDriver,
    ): Promise<{ historyService: unknown } | undefined>;

    /**
     * Initialize WebSocket server for realtime operations.
     */
    initializeWebsockets?(
        server: unknown,
        realtimeService: RealtimeProvider,
        driver: DataDriver,
        config?: unknown,
    ): Promise<void> | void;

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
    collections: EntityCollection[];
    /** The shared collection registry to register into. */
    collectionRegistry: CollectionRegistryInterface;
}
