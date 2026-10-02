import type { CollectionConfig, FilterValues, WhereFilterOp } from "./collections";
import type { CollectionCallbacks } from "./entity_callbacks";
import type { OrderByTuple } from "./filter-operators";
import type { LogicalCondition } from "../controllers/data";
import type { AuthAdapter } from "./auth_adapter";
import type { HistoryConfig } from "../controllers/client";
import type { ChannelBusSetting } from "./channel_bus";
import type { SchemaEditingAdmin } from "./schema_editing";

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
    /** See `FetchCollectionProps.orderBy`: a field name plus `order`, or a list of tuples. */
    orderBy?: string | OrderByTuple[];
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
    /** See `FetchCollectionProps.orderBy`: a field name plus `order`, or a list of tuples. */
    orderBy?: string | OrderByTuple[];
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
    /**
     * An `or(...)`/`and(...)` group, alongside `filter`.
     *
     * Counted as well as fetched, or `total` describes a different set of rows
     * from the one that was served — the same reason `filter` is here.
     */
    logical?: LogicalCondition;
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
     * Build search conditions for text search.
     *
     * At most one condition comes back, already complete: callers OR what they
     * get, and OR is right across the searchable *fields* but wrong across the
     * *terms* of the search string — a person typing two words means both, and
     * the two halves of a name are two different fields. The empty array still
     * means "nothing here can be searched", which every caller reads as "no
     * rows".
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
    /**
     * An `or(...)`/`and(...)` group, applied alongside `filter`.
     *
     * Declared here because a subscription is a query, and every field a query
     * has this one needs too. It was missing, so the type-checked boundary
     * dropped it: the client sent the group, nothing rejected it, and the
     * subscription re-fetched with the group gone — pushing every row the
     * caller's policies allowed rather than the ones they asked for. The same
     * defect `FetchCollectionProps.logical` documents, one layer up.
     */
    logical?: LogicalCondition;
    /**
     * Where the subscription's page starts. Missing for the same reason, with
     * a quieter symptom: a subscriber watching page two was pushed page one,
     * and a `collection_update` frame carries no window for it to notice with.
     */
    offset?: number;
    /** See `FetchCollectionProps.orderBy`: a field name plus `order`, or a list of tuples. */
    orderBy?: string | OrderByTuple[];
    order?: "desc" | "asc";
    limit?: number;
    startAfter?: unknown;
    databaseId?: string;
    searchString?: string;
    /** Ask each row which declared search field matched. */
    searchExplain?: boolean;
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
 * Opt-in retention for one set of broadcast channels.
 *
 * Retention is configured on the server and nowhere else. A channel is created
 * by whoever names it, so letting a client ask for its own history depth would
 * let any visitor commit the backend to unbounded storage; and presence-only or
 * notification-only channels — the overwhelming majority — must not pay for a
 * feature they never use. With no rules configured nothing is written, no table
 * is created, and broadcast behaves exactly as it did before history existed.
 */
export interface ChannelRetentionRule {
    /**
     * Channel name to match. Either exact (`"doc:42"`) or a trailing-`*` prefix
     * (`"doc:*"`). Deliberately not a full glob or RegExp: this decides what
     * gets written to disk, and a rule whose blast radius is not obvious at a
     * glance is the wrong shape for that.
     */
    match: string;
    /** Keep at most this many of the most recent messages per channel. */
    limit?: number;
    /**
     * Keep messages for at most this long. Accepts a millisecond count or a
     * short duration string (`"30s"`, `"15m"`, `"24h"`, `"7d"`).
     */
    ttl?: number | string;
}

/**
 * Server-side realtime options.
 *
 * The channel bus contract and its config live in `./channel_bus` so that a
 * transport shipped as its own package depends on the contract alone.
 */
export interface RealtimeChannelsConfig {
    /**
     * Retention rules, most specific first — the first match wins. Omitted or
     * empty means no channel retains anything.
     */
    channels?: ChannelRetentionRule[];
    /**
     * How channel broadcast and presence reach other backend instances.
     * Defaults to `{ type: "memory" }` — i.e. they don't.
     */
    bus?: ChannelBusSetting;
    /**
     * How many subscriptions one socket may hold; the next is refused with
     * `TOO_MANY_SUBSCRIPTIONS`. A positive whole number, checked at boot.
     * Defaults to 1000. `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` wins over it.
     */
    maxSubscriptionsPerSocket?: number;
}

/**
 * Abstract realtime provider interface.
 * Handles real-time subscriptions and notifications for entity changes.
 */
export interface RealtimeProvider {
    /**
     * Subscribe to collection changes.
     *
     * `onError` is called when a fetch behind the subscription fails, a
     * refetch after a change included, with the error as it was thrown. It is
     * not called for a fetch that newer rows have already overtaken, or after
     * the subscription is gone. Without it, a subscriber whose fetch failed
     * was told nothing and kept waiting for rows.
     */
    subscribeToCollection(
        subscriptionId: string,
        config: CollectionSubscriptionConfig,
        callback?: (rows: Record<string, unknown>[]) => void,
        onError?: (error: unknown) => void
    ): void;

    /**
     * Subscribe to single entity changes. `onError` as for
     * {@link RealtimeProvider.subscribeToCollection}.
     */
    subscribeToOne(
        subscriptionId: string,
        config: SingleSubscriptionConfig,
        callback?: (row: Record<string, unknown> | null) => void,
        onError?: (error: unknown) => void
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

    /**
     * The long-lived connections realtime depends on, for `/health`. A change
     * feed that has gone quiet — a half-open LISTEN connection — loses every
     * external and cross-instance change while writes through this instance
     * still look live, so it is reported rather than inferred.
     */
    health?(): RealtimeListenerHealth[];
}

/**
 * One long-lived realtime connection, as `/health` reports it.
 * @group Backend
 */
export interface RealtimeListenerHealth {
    /** What it carries — `"cdc"`, `"cross-instance"`, `"channel-bus"`. */
    name: string;
    /** Listening on a connection that answered its last heartbeat. */
    connected: boolean;
    /** When (epoch ms) it went down, while it is down. */
    downSince?: number;
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

    /**
     * Take the global callbacks declared on `initializeRebaseBackend({ callbacks })`.
     *
     * A driver resolves callbacks from the registry it builds for itself, so
     * this is how the backend's global ones reach it: the coordinator hands
     * them over after `initializeDriver` returns. Optional so a registry for a
     * driver that runs no callbacks still type-checks, but a project that
     * declares global callbacks over a registry without it is refused at boot
     * — hooks that never run look exactly like hooks that passed.
     */
    setGlobalCallbacks?(callbacks: CollectionCallbacks): void;
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
 * The table column a value of a {@link SqlScriptResult} was read from, as the
 * database itself reported it — not as the query's text suggests.
 *
 * @group Admin
 */
export interface SqlScriptColumnSource {
    schema: string;
    table: string;
    column: string;
}

/**
 * One column of a {@link SqlScriptResult}, in result order.
 *
 * @group Admin
 */
export interface SqlScriptColumn {
    /** The name the result gives it. Two columns of one result may share it. */
    name: string;
    /** Its type, as the database names it: `integer`, `text[]`, `timestamp with time zone`. */
    type?: string;
    /**
     * Where the database says the value came from: a plain reference to a
     * column of a table or view, through any number of subqueries.
     *
     * Absent for everything no stored row holds — an expression, a cast that
     * changes the type, a literal, an aggregate, a function's output, a
     * `UNION`.
     */
    source?: SqlScriptColumnSource;
}

/**
 * A table or view some column of a {@link SqlScriptResult} came from.
 *
 * @group Admin
 */
export interface SqlScriptTable {
    schema: string;
    table: string;
    /** What the relation is. Only a `table` or a `partitioned table` holds rows that can be updated by key. */
    kind: "table" | "partitioned table" | "view" | "materialized view" | "foreign table" | "other";
    /** Its primary key columns, in key order. Empty when it has none. */
    primaryKey: string[];
    /**
     * Other tables inherit this one (by `INHERITS`, not as partitions). A row
     * read from it may live in one of them, and a primary key is not unique
     * across them.
     */
    hasInheritors: boolean;
}

/**
 * Something the database said while a script ran: `there is no transaction in
 * progress` for a ROLLBACK with nothing to end, a `RAISE NOTICE`.
 *
 * @group Admin
 */
export interface SqlScriptNotice {
    severity: string;
    message: string;
}

/**
 * What a SQL script a person wrote returned. See {@link SQLAdmin.runSqlScript}.
 *
 * @group Admin
 */
export interface SqlScriptResult {
    /**
     * The last statement's rows, every value as the text the database wrote
     * for it and `null` for SQL NULL — so a value written back is the value
     * that was read, whatever its type. Keyed by column name: of two columns
     * that share a name, the row holds the last.
     */
    rows: Record<string, string | null>[];
    /** The last statement's columns, in order. */
    columns: SqlScriptColumn[];
    /** The tables and views {@link SqlScriptColumn.source} names. */
    tables: SqlScriptTable[];
    /** The last statement's command: `SELECT`, `UPDATE`, `CREATE TABLE` … */
    command?: string;
    /** How many rows the last statement returned or changed, when its command reports a count. */
    rowCount?: number;
    /** What the database said while the script ran, in order. */
    notices: SqlScriptNotice[];
}

/**
 * Administrative operations for SQL-based databases (PostgreSQL, MySQL, etc.).
 * Used by the SQL Editor, RLS Editor, and schema browser.
 *
 * @group Admin
 */
export interface SQLAdmin {
    /**
     * Execute raw SQL against the database.
     *
     * `isolateSession` runs it on a connection of its own and resets that
     * connection's session state — role, session authorization, settings —
     * before it is reused. For SQL a person wrote (the Studio editor), which
     * may `SET ROLE` and must not leave that on a pooled connection the
     * server's own queries use next.
     */
    executeSql(sql: string, options?: { database?: string; role?: string; params?: unknown[]; isolateSession?: boolean }): Promise<Record<string, unknown>[]>;

    /**
     * Run a script a person wrote — the Studio SQL console — and describe what
     * it returned.
     *
     * On a session of its own, reset afterwards, as `role` for every statement
     * of it. Values come back as the database's text, and each column says
     * which table column it was read from, when the database says so: what
     * the console needs to write a cell back to the row it came from and to
     * no other. A script that leaves a transaction open is refused, and the
     * transaction rolled back: nothing outlives the run to be committed or
     * rolled back by a later one.
     */
    runSqlScript?(sql: string, options?: { database?: string; role?: string }): Promise<SqlScriptResult>;

    /**
     * Fetch the available databases on the server.
     */
    fetchAvailableDatabases?(): Promise<string[]>;

    /**
     * Fetch the available *native PostgreSQL* database roles (from `pg_roles`).
     *
     * These are connection-level roles — what the SQL editor can `SET ROLE` to,
     * and what `SecurityRule.pgRoles` targets. They are NOT application roles;
     * for those use {@link fetchApplicationRoles}.
     */
    fetchAvailableRoles?(): Promise<string[]>;

    /**
     * Fetch the *application-level* roles in use in this project.
     *
     * These are the strings stored on the users table's `roles` column and
     * exposed to policies as `rebase.roles()` — what `SecurityRule.roles`
     * matches against. Distinct from {@link fetchAvailableRoles}; the two are
     * not interchangeable.
     */
    fetchApplicationRoles?(): Promise<string[]>;

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
export type DatabaseAdmin = Partial<SQLAdmin> & Partial<DocumentAdmin> & Partial<SchemaAdmin>
    & Partial<BranchAdmin> & Partial<SchemaEditingAdmin>;

/**
 * Type guard: can this admin plan a live schema change?
 *
 * Planning is engine-specific — it renders DDL, a Drizzle schema and the
 * declarative SQL artifacts — so the implementation lives in the driver
 * package. The server detects the capability structurally, exactly as it does
 * for SQL, rather than importing an engine it is supposed to know nothing
 * about.
 *
 * @group Admin
 */
export function isSchemaEditingAdmin(admin: DatabaseAdmin | undefined): admin is SchemaEditingAdmin {
    return !!admin && typeof (admin as SchemaEditingAdmin).planSchemaChange === "function";
}

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
 * A caller of the data API as its rate limiter buckets one outside an HTTP
 * request: a realtime socket's frame, counted in the same bucket the same
 * person's HTTP requests are.
 * @group Backend
 */
export interface DataRateLimitCaller {
    /**
     * The signed-in user's uid. Absent, or the anonymous principal, buckets
     * the caller by address at the anonymous allowance.
     */
    uid?: string;
    /**
     * A header of the request that opened the connection, by lower-case name:
     * the proxy headers an address is read from when proxies are declared.
     */
    header(name: string): string | undefined;
    /** The address the connection comes from. */
    socketAddress?: string;
}

/**
 * What the realtime socket shares with the HTTP data API: its request limits,
 * so a frame carries the ones an HTTP request to the same rows does, and its
 * API-key verification, so a key means the same thing on both.
 * @group Backend
 */
export interface RealtimeSocketOptions {
    /**
     * Verify an `rk_` API key presented to `AUTHENTICATE`: the identity it acts
     * as and the scopes it holds, or why it does not authenticate. Absent when
     * the deployment has no API-key store, and then keys cannot authenticate
     * the socket.
     */
    resolveApiKey?: (token: string) => Promise<{ uid: string; roles: string[]; scopes: string[] } | { message: string }>;
    /**
     * The largest frame accepted, in bytes — the data API's body limit. `0` or
     * less for none. Defaults to the server's default body limit.
     */
    maxPayload?: number;
    /**
     * Count one data request from `caller` in the data API's per-caller
     * buckets and say whether it is allowed; `null` for a caller who is not
     * limited. Absent when the deployment has rate limiting off.
     */
    dataRateLimit?: (caller: DataRateLimitCaller) => Promise<{ allowed: boolean; retryAfterMs: number } | null>;
    /**
     * How often a socket that only listens has its identity re-read, in ms
     * (default 30 000). A socket that sends frames is re-checked before each
     * one; this bounds how long a subscription keeps receiving rows as an
     * identity that has since signed out, been revoked, demoted or deleted.
     */
    identityRecheckIntervalMs?: number;
}

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
     * Ask the database whether it is there, before anything else touches it.
     *
     * Boot's first database call is not `initializeDriver` — it is the schema
     * provisioning that runs ahead of it, and a driver's connection diagnosis
     * therefore never got the chance to run. A stopped database produced
     * `Failed query: [redacted]` and a stack through drizzle internals: no host,
     * no port, no `ECONNREFUSED`, and no hint about starting the thing.
     *
     * Implementations MUST issue the cheapest round trip they have (`SELECT 1`),
     * MUST throw an error whose message names the host, the port and the
     * driver's own reason, and MAY log a fuller diagnosis first. They MUST NOT
     * throw for a reachable database that merely answered something unexpected —
     * the caller treats a throw as fatal.
     *
     * `driverResult` is optional for the same reason as
     * {@link ensureCollectionSchema}: this runs before `initializeDriver`, so an
     * adapter that was constructed with its own connection has to fall back to
     * it.
     */
    verifyConnection?(driverResult?: InitializedDriver): Promise<void>;

    /**
     * Bring the database's collection tables up to date, additively.
     *
     * Optional because it is only meaningful for schema-ful drivers. A managed
     * runtime boots a compiled project against a database it has never seen; auth
     * tables are ensured on boot but collection tables were created by nothing,
     * so every data request answered 500 on a missing relation. The CLI's `db
     * push` cannot fill the gap — it needs Atlas, and the runtime image ships no
     * CLI.
     *
     * Implementations MUST be additive-only: create missing tables, columns and
     * enum types, and never drop, narrow or rewrite anything. This runs
     * unattended against live customer data with nobody reading a diff, so the
     * destructive half stays a deliberate migration.
     *
     * `driverResult` is optional: this runs before `initializeDriver`, and only
     * the bundle path has a pre-init stand-in to pass. An adapter built by an
     * application already holds its own connection and MUST use it when this is
     * `undefined` — dereferencing it unconditionally works for managed tenants
     * and breaks every app that builds its own adapter.
     */
    ensureCollectionSchema?(
        collections: unknown[],
        driverResult?: InitializedDriver,
        log?: (message: string) => void
    ): Promise<{ applied: number }>;

    /**
     * Apply the collections' row-level-security policies, additively and
     * idempotently — the companion to {@link ensureCollectionSchema}.
     *
     * That method creates the tables; a table with RLS disabled and no policies
     * is not servable, because authenticated requests run as a restricted role:
     * a read with no `SELECT` policy returns nothing (a public collection
     * answers 401) and a write with no `INSERT`/`UPDATE` policy is denied. The
     * `db push` CLI applies these from the same collections, but it cannot reach
     * a managed tenant's in-cluster database — the runtime, already connected,
     * is the only thing that can.
     *
     * MUST be idempotent (re-run on every boot) and MUST NOT be destructive.
     * Runs after auth initialization, because the generated policies call the
     * `auth.*` helper functions and `CREATE POLICY` validates they exist.
     */
    ensureCollectionPolicies?(
        collections: unknown[],
        driverResult?: InitializedDriver,
        log?: (message: string) => void
    ): Promise<{ applied: number }>;

    /**
     * Create the RLS helper functions on this source's database. See
     * `DatabaseAdapter.ensureRlsRuntime`; needed on every source that is not
     * the default, whose helpers arrive with the auth tables.
     */
    ensureRlsRuntime?(driverResult?: InitializedDriver): Promise<void>;

    /**
     * Re-check, after the schema exists, that requests will actually be
     * constrained by the database's own authorization.
     *
     * A driver that isolates user requests by switching to a restricted role has
     * to decide at connect time whether the switch is needed — and on a fresh
     * database that question is asked before there is anything to answer with.
     * The process then creates the schema, becomes its owner, and an owner is
     * exempt from the policies on what it owns. So the answer that was true when
     * the driver initialized can be false by the time it serves a request.
     *
     * This is where a driver asks again. It runs once, after collection tables,
     * auth tables and policies are all in place, and it MUST fail rather than
     * serve when the answer changed and cannot be acted on: booting anyway
     * produces exactly the unenforced server this exists to prevent.
     *
     * Optional, because it is only meaningful for drivers whose isolation
     * depends on state the schema affects. A driver with nothing to re-check
     * omits it.
     */
    finalizeSecurityPosture?(driverResult: InitializedDriver): Promise<void>;

    /**
     * Read the collections schema version this database was last provisioned
     * from, or `null` when nothing has ever stamped it.
     *
     * The companion to {@link stampCollectionsSchemaVersion}: one process writes
     * what it applied, every other process compares itself to it. This is what
     * lets a split deployment — several processes over one database, only one of
     * which provisions — notice that a unit is serving against a schema it was
     * not built for. That failure is otherwise silent in both directions: a
     * column that does not exist is a SQL error on one route, and a policy that
     * was never applied is a 200 with no rows.
     *
     * `null` is not an error and MUST NOT be treated as one — every database
     * provisioned before the stamp existed reads this way, and so does every
     * fresh one until its first provisioning boot finishes.
     */
    readCollectionsSchemaVersion?(
        driverResult?: InitializedDriver
    ): Promise<string | null>;

    /**
     * Record the collections schema version this process just applied.
     *
     * Called only by the process that provisions, and only after both
     * {@link ensureCollectionSchema} and {@link ensureCollectionPolicies} have
     * run — a stamp written before the policies would claim a schema that is
     * only half in place, and the half that is missing is the one that fails
     * without an error.
     */
    stampCollectionsSchemaVersion?(
        version: string,
        driverResult?: InitializedDriver
    ): Promise<void>;

    /**
     * Initialize WebSocket server for realtime operations.
     */
    initializeWebsockets?(server: unknown, realtimeService: RealtimeProvider, driver: import("../controllers/data_driver").DataDriver, config?: unknown, authAdapter?: AuthAdapter, limits?: RealtimeSocketOptions): Promise<void> | void;
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

    /**
     * Collections the driver derived from the live database schema.
     *
     * Set by drivers that introspect in `baas` mode; the server serves these
     * instead of collections loaded from config files.
     */
    collections?: import("./collections").CollectionConfig[];

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
    /** Email service (optional). */
    emailService?: unknown;
    /** Combined Auth Repository for unified token and user management. */
    authRepository?: unknown;
    /**
     * Whether the auth schema in the database is one this runtime can serve.
     *
     * Folded into `healthCheck()` so a schema mismatch shows up as a degraded
     * health response. Without it, a server whose auth is entirely broken still
     * reports healthy — the database connection it probes is fine, and the
     * mismatch is only discovered one failed login at a time.
     */
    schemaHealthCheck?(): Promise<AuthSchemaHealth>;
}

/**
 * Result of {@link BootstrappedAuth.schemaHealthCheck}.
 * @group Lifecycle
 */
export interface AuthSchemaHealth {
    /** False when this runtime cannot be trusted to serve auth against this database. */
    healthy: boolean;
    /** Human-readable descriptions of each mismatch found. Empty when healthy. */
    problems: string[];
    /** Auth schema version recorded in the database, when it records one. */
    databaseVersion?: number | null;
    /** Auth schema version this runtime expects. */
    runtimeVersion?: number;
}
