import type { CollectionConfig, FilterValues, WhereFilterOp } from "./collections";
import type { AuthAdapter } from "./auth_adapter";
import type { HistoryConfig } from "../controllers/client";

// =============================================================================
// DATABASE CONNECTION INTERFACES
// =============================================================================

/**
 * Abstract database connection interface.
 * Represents a connection to any database system.
 */
export interface DatabaseConnection {
    /**
     * Type identifier for this database (e.g., 'postgres', 'mongodb', 'mysql')
     */
    readonly type: string;

    /**
     * Whether the connection is currently active
     */
    readonly isConnected?: boolean;

    /**
     * Close the database connection and release resources.
     */
    close?(): Promise<void>;
}

// =============================================================================
// QUERY BUILDING INTERFACES
// =============================================================================

/**
 * A single filter condition for database queries
 */
export interface QueryFilter {
    field: string;
    operator: WhereFilterOp;
    value: unknown;
}

/**
 * Options for fetching a collection of entities
 */
export interface FetchCollectionOptions<M extends Record<string, unknown> = Record<string, unknown>> {
    filter?: FilterValues<Extract<keyof M, string>>;
    orderBy?: string;
    order?: "desc" | "asc";
    limit?: number;
    offset?: number;
    startAfter?: unknown;
    searchString?: string;
    databaseId?: string;
    collection?: CollectionConfig;
}

/**
 * Options for searching entities
 */
export interface SearchOptions<M extends Record<string, unknown> = Record<string, unknown>> {
    filter?: FilterValues<Extract<keyof M, string>>;
    orderBy?: string;
    order?: "desc" | "asc";
    limit?: number;
    databaseId?: string;
    collection?: CollectionConfig;
}

/**
 * Options for counting entities
 */
export interface CountOptions<M extends Record<string, unknown> = Record<string, unknown>> {
    filter?: FilterValues<Extract<keyof M, string>>;
    searchString?: string;
    databaseId?: string;
}

/**
 * Abstract condition builder interface.
 * Implementations translate Rebase filter conditions to database-specific queries.
 *
 * Note: This interface can be implemented as instance methods or as a class with static methods.
 * For static implementations (like DrizzleConditionBuilder), use the ConditionBuilderStatic type.
 *
 * @template T The type of condition returned by the builder (e.g., SQL for PostgreSQL, Filter<Document> for MongoDB)
 */
export interface ConditionBuilder<T = unknown> {
    /**
     * Build filter conditions from Rebase FilterValues
     */
    buildFilterConditions<M extends Record<string, unknown>>(
        filter: FilterValues<Extract<keyof M, string>>,
        collectionPath: string,
        ...args: unknown[]
    ): T[];

    /**
     * Build search conditions for text search
     */
    buildSearchConditions(
        searchString: string,
        properties: Record<string, unknown>,
        ...args: unknown[]
    ): T[];

    /**
     * Combine multiple conditions with AND operator
     */
    combineConditionsWithAnd(conditions: T[]): T | undefined;

    /**
     * Combine multiple conditions with OR operator
     */
    combineConditionsWithOr(conditions: T[]): T | undefined;
}

/**
 * Static condition builder type for implementations using static methods.
 * Use this type when the class provides static methods rather than instance methods.
 *
 * @example
 * // DrizzleConditionBuilder satisfies this type
 * const builder: ConditionBuilderStatic<SQL> = DrizzleConditionBuilder;
 */
export type ConditionBuilderStatic<T = unknown> = {
    buildFilterConditions<M extends Record<string, unknown>>(
        filter: FilterValues<Extract<keyof M, string>>,
        ...args: unknown[]
    ): T[];
    buildSearchConditions(
        searchString: string,
        properties: Record<string, unknown>,
        ...args: unknown[]
    ): T[];
    combineConditionsWithAnd(conditions: T[]): T | undefined;
    combineConditionsWithOr(conditions: T[]): T | undefined;
};

// =============================================================================
// ENTITY REPOSITORY INTERFACES
// =============================================================================

/**
 * Abstract entity repository interface.
 * Handles all CRUD operations for entities in the database.
 *
 * Implementations should handle:
 * - Entity serialization/deserialization
 * - Relation resolution
 * - ID generation and conversion
 */
export interface DataRepository {
    /**
     * Fetch a single entity by ID
     */
    fetchOne<M extends Record<string, unknown>>(
        collectionPath: string,
        id: string | number,
        databaseId?: string
    ): Promise<Record<string, unknown> | undefined>;

    /**
     * Fetch a collection of entities with optional filtering, ordering, and pagination
     */
    fetchCollection<M extends Record<string, unknown>>(
        collectionPath: string,
        options?: FetchCollectionOptions<M>
    ): Promise<Record<string, unknown>[]>;

    /**
     * Search entities by text
     */
    searchRows<M extends Record<string, unknown>>(
        collectionPath: string,
        searchString: string,
        options?: SearchOptions<M>
    ): Promise<Record<string, unknown>[]>;

    /**
     * Count entities in a collection
     */
    count<M extends Record<string, unknown>>(
        collectionPath: string,
        options?: CountOptions<M>
    ): Promise<number>;

    /**
     * Save a entity (create or update)
     */
    save<M extends Record<string, unknown>>(
        collectionPath: string,
        values: Partial<M>,
        id?: string | number,
        databaseId?: string
    ): Promise<Record<string, unknown>>;

    /**
     * Delete a entity by ID
     */
    delete(
        collectionPath: string,
        id: string | number,
        databaseId?: string
    ): Promise<void>;

    /**
     * Check if a field value is unique in a collection
     */
    checkUniqueField(
        collectionPath: string,
        fieldName: string,
        value: unknown,
        excludeEntityId?: string,
        databaseId?: string
    ): Promise<boolean>;

}

// =============================================================================
// REALTIME INTERFACES
// =============================================================================

/**
 * Configuration for subscribing to a collection
 */
export interface CollectionSubscriptionConfig {
    clientId: string;
    path: string;
    filter?: unknown;
    orderBy?: string;
    order?: "desc" | "asc";
    limit?: number;
    startAfter?: unknown;
    databaseId?: string;
    searchString?: string;
}

/**
 * Configuration for subscribing to a single entity
 */
export interface SingleSubscriptionConfig {
    clientId: string;
    path: string;
    id: string | number;
}

/**
 * Abstract realtime provider interface.
 * Handles real-time subscriptions and notifications for entity changes.
 */
export interface RealtimeProvider {
    /**
     * Subscribe to collection changes
     */
    subscribeToCollection(
        subscriptionId: string,
        config: CollectionSubscriptionConfig,
        callback?: (rows: Record<string, unknown>[]) => void
    ): void;

    /**
     * Subscribe to single entity changes
     */
    subscribeToOne(
        subscriptionId: string,
        config: SingleSubscriptionConfig,
        callback?: (row: Record<string, unknown> | null) => void
    ): void;

    /**
     * Unsubscribe from a subscription
     */
    unsubscribe(subscriptionId: string): void;

    /**
     * Notify all relevant subscribers of a entity update
     */
    notifyUpdate(
        path: string,
        id: string,
        row: Record<string, unknown> | null,
        databaseId?: string
    ): Promise<void>;

    /**
     * Called when the HTTP server is ready and listening.
     * Useful for providers that need the server address for callbacks.
     */
    onServerReady?(serverInfo: { port: number; hostname?: string }): void;

    /**
     * Gracefully shut down the realtime provider.
     * Called during server shutdown to clean up resources.
     */
    destroy?(): Promise<void>;

    /**
     * Stop the internal LISTEN client (e.g., PostgreSQL LISTEN/NOTIFY).
     * Called during graceful shutdown before closing database connections.
     */
    stopListening?(): Promise<void>;
}

// =============================================================================
// COLLECTION REGISTRY INTERFACES
// =============================================================================

/**
 * Abstract collection registry interface.
 * Manages registration and lookup of entity collections.
 */
export interface CollectionRegistryInterface {
    /**
     * Register a collection
     */
    register(collection: CollectionConfig): void;

    /**
     * Get a collection by its path
     */
    getCollectionByPath(path: string): CollectionConfig | undefined;

    /**
     * Get all registered collections
     */
    getCollections(): CollectionConfig[];

    /**
     * Get the currently registered global callbacks, if any.
     */
    getGlobalCallbacks(): any | undefined;
}

// =============================================================================
// DATA TRANSFORMER INTERFACES
// =============================================================================

/**
 * Abstract data transformer interface.
 * Handles serialization/deserialization between frontend and database formats.
 */
export interface DataTransformer {
    /**
     * Transform entity data for storage in the database
     */
    serializeToDatabase<M extends Record<string, unknown>>(
        entity: M,
        collection: CollectionConfig
    ): Record<string, unknown>;

    /**
     * Transform database data back to entity format
     */
    deserializeFromDatabase<M extends Record<string, unknown>>(
        data: Record<string, unknown>,
        collection: CollectionConfig
    ): Promise<M>;
}

// =============================================================================
// DATABASE ADMIN — CAPABILITY-SPECIFIC INTERFACES (1.3)
// =============================================================================

/**
 * Administrative operations for SQL-based databases (PostgreSQL, MySQL, etc.).
 * Used by the SQL Editor, RLS Editor, and schema browser.
 *
 * @group Admin
 */
export interface SQLAdmin {
    /**
     * Execute raw SQL against the database.
     */
    executeSql(sql: string, options?: { database?: string; role?: string; params?: unknown[] }): Promise<Record<string, unknown>[]>;

    /**
     * Fetch the available databases on the server.
     */
    fetchAvailableDatabases?(): Promise<string[]>;

    /**
     * Fetch the available database roles.
     */
    fetchAvailableRoles?(): Promise<string[]>;

    /**
     * Fetch the current database name.
     */
    fetchCurrentDatabase?(): Promise<string | undefined>;
}

/**
 * Administrative operations for document-based databases (MongoDB, Firestore, etc.).
 * Used by future document administration tools.
 *
 * @group Admin
 */
export interface DocumentAdmin {
    /**
     * Execute an aggregation pipeline or equivalent query.
     */
    executeAggregate?(pipeline: Record<string, unknown>[]): Promise<Record<string, unknown>[]>;

    /**
     * Fetch statistics for a collection (document count, size, etc.).
     */
    fetchCollectionStats?(collectionName: string): Promise<{ count: number; sizeBytes?: number }>;
}

/**
 * Administrative operations for schema management.
 * Shared across SQL and document databases.
 *
 * @group Admin
 */
export interface SchemaAdmin {
    /**
     * Fetch database tables/collections not yet mapped to a Rebase collection.
     */
    fetchUnmappedTables?(mappedPaths?: string[]): Promise<string[]>;

    /**
     * Fetch column/field metadata for a single table/collection.
     * The return type is generic — SQL backends return TableMetadata,
     * document backends may return a different shape.
     */
    fetchTableMetadata?(tableName: string): Promise<unknown>;
}

/**
 * Metadata for a database branch.
 * @group Admin
 */
export interface BranchInfo {
    /** Branch name (without prefix). */
    name: string;
    /** The database this branch was created from. */
    parentDatabase: string;
    /** When the branch was created. */
    createdAt: Date;
    /** Size in bytes, if available from the server. */
    sizeBytes?: number;
}

/**
 * Administrative operations for database branching.
 * Allows creating isolated database copies for development/preview workflows.
 *
 * @group Admin
 */
export interface BranchAdmin {
    /** Create a new branch (database copy) from the current or specified source database. */
    createBranch(name: string, options?: { source?: string }): Promise<BranchInfo>;

    /** Delete a branch database. Cannot delete the main/default database. */
    deleteBranch(name: string): Promise<void>;

    /** List all branches (databases that were created via branching). */
    listBranches(): Promise<BranchInfo[]>;

    /** Get info about a specific branch. */
    getBranchInfo(name: string): Promise<BranchInfo | undefined>;
}

/**
 * Union type for all admin capabilities.
 * A backend may implement any combination of these interfaces.
 *
 * Use type guards (`isSQLAdmin`, `isDocumentAdmin`, `isSchemaAdmin`, `isBranchAdmin`)
 * to safely narrow the type before calling methods.
 *
 * @group Admin
 */
export type DatabaseAdmin = Partial<SQLAdmin> & Partial<DocumentAdmin> & Partial<SchemaAdmin> & Partial<BranchAdmin>;

/**
 * Type guard: does this admin support SQL operations?
 * @group Admin
 */
export function isSQLAdmin(admin: DatabaseAdmin | undefined): admin is SQLAdmin {
    return !!admin && typeof (admin as SQLAdmin).executeSql === "function";
}

/**
 * Type guard: does this admin support document operations?
 * @group Admin
 */
export function isDocumentAdmin(admin: DatabaseAdmin | undefined): admin is DocumentAdmin {
    return !!admin && (
        typeof (admin as DocumentAdmin).executeAggregate === "function" ||
        typeof (admin as DocumentAdmin).fetchCollectionStats === "function"
    );
}

/**
 * Type guard: does this admin support schema management?
 * @group Admin
 */
export function isSchemaAdmin(admin: DatabaseAdmin | undefined): admin is SchemaAdmin {
    return !!admin && (
        typeof (admin as SchemaAdmin).fetchUnmappedTables === "function" ||
        typeof (admin as SchemaAdmin).fetchTableMetadata === "function"
    );
}

/**
 * Type guard: does this admin support database branching?
 * @group Admin
 */
export function isBranchAdmin(admin: DatabaseAdmin | undefined): admin is BranchAdmin {
    return !!admin && typeof (admin as BranchAdmin).createBranch === "function";
}

// =============================================================================
// LIFECYCLE INTERFACES (1.4)
// =============================================================================

/**
 * Health check result returned by `healthCheck()`.
 * @group Lifecycle
 */
export interface HealthCheckResult {
    /** Whether the backend is healthy and able to serve requests. */
    healthy: boolean;
    /** Round-trip latency to the database in milliseconds. */
    latencyMs: number;
    /** Optional details (e.g., pool stats, replication lag). */
    details?: Record<string, unknown>;
}

/**
 * Lifecycle contract for backend components that hold resources
 * (database connections, WebSocket pools, timers, etc.).
 *
 * All methods are optional — simple backends (e.g., in-memory) can skip them.
 * @group Lifecycle
 */
export interface BackendLifecycle {
    /**
     * Initialize the backend: open connections, run migrations, seed data.
     * Called once during startup. Idempotent.
     */
    initialize?(): Promise<void>;

    /**
     * Check whether the backend is healthy and reachable.
     * Should be fast (< 1 s) and safe to call frequently.
     */
    healthCheck?(): Promise<HealthCheckResult>;

    /**
     * Gracefully shut down: close connections, flush buffers, cancel timers.
     * After calling `destroy()`, no other methods should be called.
     */
    destroy?(): Promise<void>;
}

// =============================================================================
// BACKEND FACTORY INTERFACES
// =============================================================================

/**
 * Configuration for creating a database backend
 */
export interface BackendConfig {
    /**
     * Type of database backend
     */
    type: string;

    /**
     * Database connection (implementation-specific)
     */
    connection: unknown;

    /**
     * Schema definition (implementation-specific, e.g., Drizzle schema for PostgreSQL)
     */
    schema?: unknown;
}

/**
 * A complete backend instance with all required services.
 *
 * Now includes optional lifecycle management and admin capabilities.
 */
export interface BackendInstance extends BackendLifecycle {
    /**
     * Entity repository for CRUD operations
     */
    entityRepository: DataRepository;

    /**
     * Realtime provider for subscriptions
     */
    realtimeProvider: RealtimeProvider;

    /**
     * Collection registry
     */
    collectionRegistry: CollectionRegistryInterface;

    /**
     * The underlying database connection
     */
    connection: DatabaseConnection;

    /**
     * Administrative operations (SQL, schema, documents).
     * What's available depends on the backend type — use type guards
     * (`isSQLAdmin`, `isSchemaAdmin`, etc.) to narrow.
     */
    admin?: DatabaseAdmin;
}

/**
 * Factory function type for creating backend instances
 */
export type BackendFactory<TConfig extends BackendConfig = BackendConfig> =
    (config: TConfig) => BackendInstance;

// =============================================================================
// BACKEND BOOTSTRAPPER (1.2)
// =============================================================================

/**
 * A `BackendBootstrapper` encapsulates all driver-specific initialization logic.
 *
 * Instead of hard-coding Postgres setup into `initializeRebaseBackend()`,
 * each database backend provides its own bootstrapper that knows how to:
 * - Create the DataDriver from a config object
 * - Optionally initialize auth tables
 * - Optionally create a realtime service
 * - Mount driver-specific API routes
 *
 * The main `initializeRebaseBackend()` becomes a **coordinator** that iterates
 * registered bootstrappers, calls their hooks, and wires the results together.
 *
 * @group Backend
 *
 * @example
 * ```typescript
 * // Third-party MySQL bootstrapper
 * const mysqlBootstrapper: BackendBootstrapper = {
 *   type: "mysql",
 *   initializeDriver: async (config) => new MySQLDataDriver(config.connection),
 *   initializeRealtime: async (config) => new MySQLChangeStreamRealtime(config.connection),
 * };
 *
 * initializeRebaseBackend({
 *   ...config,
 *   bootstrappers: [postgresBootstrapper, mysqlBootstrapper]
 * });
 * ```
 */
export interface BackendBootstrapper {
    /**
     * Which driver type this bootstrapper handles.
     * Must match the `type` field on the driver config object
     * (e.g., `"postgres"`, `"mongodb"`, `"mysql"`).
     */
    type: string;

    /**
     * Unique identifier for this bootstrapper instance.
     * Used to register the driver in the driver registry.
     * Defaults to `type` if not set.
     */
    id?: string;

    /**
     * Whether this bootstrapper provides the default driver.
     * When true, the coordinator uses this driver as the primary one.
     */
    isDefault?: boolean;

    /**
     * Run database migrations for this driver.
     * Called by the coordinator after all drivers are initialized.
     */
    runMigrations?(config: unknown, driverResult: InitializedDriver): Promise<void>;

    /**
     * Create a DataDriver from the given config.
     * This is the only **required** method.
     */
    initializeDriver(config: unknown): Promise<InitializedDriver>;

    /**
     * Initialize auth tables / services if this driver supports them.
     * Return undefined if auth is not supported by this backend.
     */
    initializeAuth?(config: unknown, driverResult: InitializedDriver): Promise<BootstrappedAuth | undefined>;

    /**
     * Initialize history tables / services if this driver supports them.
     * Return undefined if history is not supported by this backend.
     */
    initializeHistory?(config: HistoryConfig, driverResult: InitializedDriver): Promise<{ historyService: unknown } | undefined>;

    /**
     * Create a realtime provider for this driver.
     * Return undefined if the driver does not support realtime.
     */
    initializeRealtime?(config: unknown, driverResult: InitializedDriver): Promise<RealtimeProvider | undefined>;

    /**
     * Mount any driver-specific HTTP routes (e.g., custom admin endpoints).
     * Called after all drivers are initialized.
     */
    mountRoutes?(app: unknown, basePath: string, driverResult: InitializedDriver): void;

    /**
     * Return admin capabilities for this driver.
     */
    getAdmin?(driverResult: InitializedDriver): DatabaseAdmin | undefined;

    /**
     * Initialize WebSocket server for realtime operations.
     */
    initializeWebsockets?(server: unknown, realtimeService: RealtimeProvider, driver: import("../controllers/data_driver").DataDriver, config?: unknown, authAdapter?: AuthAdapter): Promise<void> | void;
}

/**
 * Result of `BackendBootstrapper.initializeDriver()`.
 * @group Backend
 */
export interface InitializedDriver {
    /** The DataDriver instance, ready for use. */
    driver: import("../controllers/data_driver").DataDriver;

    /** The realtime service, if the driver created one during init. */
    realtimeProvider?: RealtimeProvider;

    /** A collection registry to register schema / tables into. */
    collectionRegistry?: CollectionRegistryInterface;

    /** The underlying database connection (for lifecycle management). */
    connection?: DatabaseConnection;

    /**
     * Opaque handle that the bootstrapper can use in subsequent hooks
     * (e.g., `initializeAuth`, `mountRoutes`) to access driver internals.
     * Not used by the coordinator.
     */
    internals?: unknown;
}

/**
 * Result of `BackendBootstrapper.initializeAuth()`.
 * @group Backend
 */
export interface BootstrappedAuth {
    /** User management service. */
    userService: unknown;
    /** Role management service (optional, roles are now simple strings). */
    roleService?: unknown;
    /** Email service (optional). */
    emailService?: unknown;
    /** Combined Auth Repository for unified token and user management. */
    authRepository?: unknown;
}
