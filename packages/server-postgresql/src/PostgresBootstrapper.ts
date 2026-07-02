/**
 * PostgresBootstrapper
 *
 * Implements the `BackendBootstrapper` interface for PostgreSQL.
 */

import { getTableName, isTable, Relations, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgEnum, PgTable } from "drizzle-orm/pg-core";
import type { RebasePgTable } from "./types";
import {
    type AuthAdapter,
    BackendBootstrapper,
    BootstrappedAuth,
    DatabaseAdmin,
    type DataDriver,
    EntityCollection,
    type HistoryConfig,
    InitializedDriver,
    RealtimeProvider
} from "@rebasepro/types";
import { PostgresBackendDriver } from "./PostgresBackendDriver";
import { RealtimeService } from "./services/realtimeService";
import { DatabasePoolManager } from "./databasePoolManager";
import { PostgresCollectionRegistry } from "./collections/PostgresCollectionRegistry";
import { createEmailService, type EmailConfig, type EmailService, logger } from "@rebasepro/server-core";
import { ensureAuthTablesExist } from "./auth/ensure-tables";
import { AuthSchemaTables, PostgresAuthRepository, UserService } from "./auth/services";
import { createAuthSchema } from "./schema/auth-schema";
import { HistoryService } from "./history/HistoryService";
import { ensureHistoryTableExists } from "./history/ensure-history-table";
import { patchPgArrayNullSafety } from "./utils/pg-array-null-patch";

export interface PostgresDriverConfig {
    connectionString?: string;
    adminConnectionString?: string;
    readConnectionString?: string;
    connection?: unknown;
    schema?: {
        tables?: Record<string, unknown>;
        enums?: Record<string, unknown>;
        relations?: Record<string, unknown>;
    };
}

/**
 * Opaque internals bag that PostgresBootstrapper stores during `initializeDriver()`
 * and re-uses in subsequent lifecycle hooks.
 */
export interface PostgresDriverInternals {
    db: NodePgDatabase<any>;
    readDb?: NodePgDatabase<any>;
    registry: PostgresCollectionRegistry;
    realtimeService: RealtimeService;
    driver: PostgresBackendDriver;
    poolManager?: DatabasePoolManager;
}

// Re-export from shared CLI error utilities
import { isEconnrefused } from "./cli-errors";

/**
 * Default PostgreSQL bootstrapper.
 *
 * Use it to register Postgres with `initializeRebaseBackend()`:
 * ```typescript
 * initializeRebaseBackend({
 *   ...config,
 *   bootstrappers: [postgresBootstrapper()]
 * });
 * ```
 */
export function createPostgresBootstrapper(pgConfig: PostgresDriverConfig): BackendBootstrapper {
    return {
        type: "postgres",

        async initializeDriver(config: unknown): Promise<InitializedDriver> {
            // config is passed from coordinator, we merge it with our internal pgConfig if needed
            // Currently config from init.ts is `{ collections, collectionRegistry }`
            const { collections, collectionRegistry } = config as {
                collections?: EntityCollection[];
                collectionRegistry?: unknown;
            };

            // Create a fresh registry for this driver
            const registry = new PostgresCollectionRegistry();
            if (collections) {
                registry.registerMultiple(collections);
                logger.info(`📋 [PostgresRegistry] Registered ${registry.getCollections().length} collections: [${registry.getCollections().map(c => c.slug).join(", ")}]`);
            }

            // Register tables
            if (pgConfig.schema?.tables) {
                Object.values(pgConfig.schema.tables).forEach((table) => {
                    if (isTable(table)) {
                        const tableName = getTableName(table);
                        registry.registerTable(table as PgTable, tableName);
                    }
                });
            }

            if (pgConfig.schema?.enums) registry.registerEnums(pgConfig.schema.enums as Record<string, PgEnum<[string, ...string[]]>>);
            if (pgConfig.schema?.relations) registry.registerRelations(pgConfig.schema.relations as Record<string, Relations>);

            // Patch Drizzle's PgArray columns to handle NULL values safely.
            // Drizzle's mapFromDriverValue crashes with "value.map is not a function"
            // when a native array column (text[], integer[], etc.) contains NULL.
            if (pgConfig.schema?.tables) {
                patchPgArrayNullSafety(pgConfig.schema.tables as Record<string, unknown>);
            }

            // Build schema-aware Drizzle connection
            const mergedSchema: Record<string, unknown> = {
                ...pgConfig.schema?.tables,
                ...(pgConfig.schema?.relations || {})
            };
            const { drizzle: createDrizzle } = await import("drizzle-orm/node-postgres");
            const connection = pgConfig.connection;
            const rawClient = (connection && typeof connection === "object" && "$client" in connection
                ? (connection as Record<string, unknown>).$client
                : connection) as import("pg").Pool;
            const schemaAwareDb = createDrizzle(rawClient, { schema: mergedSchema });

            // Verify connection — fail fast if the database is unreachable
            try {
                await schemaAwareDb.execute(sql`SELECT 1`);
            } catch (err: unknown) {
                const isConnectionRefused = isEconnrefused(err);
                if (isConnectionRefused) {
                    // Parse host/port from connection string for a helpful message
                    let hostInfo = pgConfig.connectionString || "unknown";
                    try {
                        const parsed = new URL(pgConfig.connectionString || "");
                        hostInfo = `${parsed.hostname}:${parsed.port || 5432}`;
                    } catch { /* use raw string */ }

                    const message =
                        `\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `  ❌  Cannot connect to PostgreSQL at ${hostInfo}\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `\n` +
                        `  The database server is not running or is not accepting\n` +
                        `  connections. Common fixes:\n` +
                        `\n` +
                        `    • brew services start postgresql@18\n` +
                        `    • docker compose up -d postgres\n` +
                        `    • Verify DATABASE_URL in your .env file\n` +
                        `\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    logger.error(message);
                    throw new Error(`Cannot connect to PostgreSQL at ${hostInfo}: connection refused. Is the database running?`);
                }

                // For other errors (timeouts, auth failures, etc.) warn but continue —
                // the pool may recover on subsequent attempts.
                logger.error("❌ Failed to connect to PostgreSQL", { error: err });
                logger.warn("⚠️ Continuing without initial database verification. Drizzle/PG will attempt to connect on subsequent queries.");
            }

            // Create services
            const realtimeService = new RealtimeService(schemaAwareDb, registry);

            // Initialize read replica connection if configured
            let readDb: import("drizzle-orm/node-postgres").NodePgDatabase<any> | undefined;
            const readUrl = process.env.DATABASE_READ_URL;
            if (readUrl && readUrl !== pgConfig.connectionString) {
                try {
                    const { createReadReplicaConnection } = await import("./connection");
                    const readResources = createReadReplicaConnection(readUrl, mergedSchema);
                    readDb = readResources.db;
                    logger.info("📖 [PostgresBootstrapper] Read replica connection established");
                } catch (err) {
                    logger.warn("⚠️ Could not connect to read replica, falling back to primary for all queries", { error: err });
                }
            }
            const poolManager = pgConfig.adminConnectionString
                ? new DatabasePoolManager(pgConfig.adminConnectionString)
                : undefined;
            const driver = new PostgresBackendDriver(schemaAwareDb, realtimeService, registry, undefined, poolManager);
            realtimeService.setDataDriver(driver);

            // Ensure branch metadata table exists when branching is available
            if (driver.branchService) {
                try {
                    await driver.branchService.ensureBranchMetadataTable();
                } catch (err) {
                    logger.warn("⚠️ Could not initialize branch metadata table", { error: err });
                }
            }

            // Enable cross-instance realtime (opt-in)
            // Prefer DATABASE_DIRECT_URL to bypass PgBouncer for LISTEN/NOTIFY
            const directUrl = process.env.DATABASE_DIRECT_URL || pgConfig.connectionString;
            if (directUrl) {
                try {
                    await realtimeService.startListening(directUrl);
                } catch (err) {
                    logger.warn("⚠️ Cross-instance realtime could not be started", { error: err });
                }
            }

            // ── Startup Schema Validation ────────────────────────────────────
            // One-directional: only checks collections → DB (extra DB tables
            // that aren't mapped to collections are perfectly fine).
            try {
                const registeredCollections = registry.getCollections();
                if (registeredCollections.length > 0) {
                    const schemasToCheck = Array.from(new Set(
                        registeredCollections.map(c => "schema" in c && c.schema ? c.schema : "public")
                    ));
                    const schemasList = schemasToCheck.map(s => `'${s}'`).join(",");
                    const result = await schemaAwareDb.execute(sql.raw(`
                        SELECT table_name, table_schema
                        FROM information_schema.tables
                        WHERE table_schema IN (${schemasList})
                          AND table_type = 'BASE TABLE'
                    `));
                    const dbTables = new Set(
                        (result.rows as Array<{ table_name: string; table_schema: string }>).map(r =>
                            r.table_schema === "public" ? r.table_name : `${r.table_schema}.${r.table_name}`
                        )
                    );
                    const missing: Array<{ slug: string; table: string }> = [];
                    for (const col of registeredCollections) {
                        const schemaName = "schema" in col && col.schema ? col.schema : "public";
                        const tableName = registry.hasTableForCollection(
                            col.table ?? col.slug
                        )
                            ? (col.table ?? col.slug)
                            : col.slug;
                        // Resolve the actual table name the registry stored
                        const resolvedTable = registry.getTableNames().find((k) =>
                            k === tableName ||
                            k === col.slug
                        );
                        const checkName = resolvedTable ?? tableName;
                        const fullCheckName = schemaName === "public" ? checkName : `${schemaName}.${checkName}`;
                        if (!dbTables.has(fullCheckName)) {
                            missing.push({ slug: col.slug,
table: checkName });
                        }
                    }
                    if (missing.length > 0) {
                        const lines = missing.map(
                            m => `    • collection "${m.slug}" → table "${m.table}"`
                        );
                        logger.warn([
                            "",
                            "┌──────────────────────────────────────────────────────────────┐",
                            "│  ⚠️  SCHEMA DRIFT — Missing tables in database               │",
                            "├──────────────────────────────────────────────────────────────┤",
                            ...lines.map(l => `│ ${l.padEnd(60)}│`),
                            "├──────────────────────────────────────────────────────────────┤",
                            "│  Run one of:                                                 │",
                            "│    pnpm db:push      (dev — fast, no migration files)        │",
                            "│    pnpm db:migrate   (prod — creates migration files)        │",
                            "└──────────────────────────────────────────────────────────────┘",
                            ""
                        ].join("\n"));
                    }
                }
            } catch (err) {
                logger.warn("⚠️ Startup schema validation could not run", {
                    error: err instanceof Error ? err.message : String(err)
                });
            }

            const internals: PostgresDriverInternals = {
                db: schemaAwareDb,
                readDb,
                registry,
                realtimeService,
                driver,
                poolManager
            };

            return {
                driver,
                realtimeProvider: realtimeService,
                collectionRegistry: registry,
                internals
            };
        },

        async initializeAuth(config: unknown, driverResult: InitializedDriver): Promise<BootstrappedAuth | undefined> {
            const authConfig = config as Record<string, unknown> | undefined;
            if (!authConfig) return undefined;

            const internals = driverResult.internals as PostgresDriverInternals;
            const db = internals.db;
            const registry = internals.registry;

            // Resolve the auth collection from the explicit config.
            // This replaces the old `registry.getTable("users")` magic string lookup.
            const authCollection = authConfig.collection as EntityCollection | undefined;

            // ensureAuthTablesExist works with the collection abstraction — no Drizzle leakage.
            await ensureAuthTablesExist(db, authCollection);

            let emailService: EmailService | undefined;
            if (authConfig.email) {
                emailService = createEmailService(authConfig.email as EmailConfig);
            }

            // Resolve the Drizzle table for the internal UserService/AuthRepository.
            // These are internal Postgres-specific services that need the Drizzle table reference.
            const tableName = authCollection
                ? ("table" in authCollection && typeof authCollection.table === "string"
                    ? authCollection.table
                    : authCollection.slug)
                : undefined;
            const usersTable = tableName
                ? registry.getTable(tableName) as RebasePgTable | undefined
                : undefined;

            let usersSchemaName = "rebase";
            if (authCollection && "schema" in authCollection && typeof authCollection.schema === "string") {
                usersSchemaName = authCollection.schema;
            }

            const authTables = createAuthSchema(usersSchemaName) as unknown as AuthSchemaTables;
            if (usersTable) {
                authTables.users = usersTable as RebasePgTable;
            }

            const userService = new UserService(db, authTables);
            const authRepository = new PostgresAuthRepository(db, authTables);

            return { userService,
roleService: userService,
emailService,
authRepository };
        },

        async initializeHistory(config: HistoryConfig, driverResult: InitializedDriver): Promise<{ historyService: HistoryService } | undefined> {
            if (!config) return undefined;

            const internals = driverResult.internals as PostgresDriverInternals;
            const db = internals.db;

            await ensureHistoryTableExists(db);

            const retention = typeof config === "object" ? config.retention : undefined;
            const historyService = new HistoryService(db, retention ? { ttlDays: retention } : undefined);

            return { historyService };
        },

        async initializeRealtime(_config: unknown, driverResult: InitializedDriver): Promise<RealtimeProvider | undefined> {
            const internals = driverResult.internals as PostgresDriverInternals;
            return internals.realtimeService;
        },

        getAdmin(driverResult: InitializedDriver): DatabaseAdmin | undefined {
            const internals = driverResult.internals as PostgresDriverInternals;
            return internals.driver.admin;
        },

        mountRoutes(app: unknown, basePath: string, driverResult: InitializedDriver): void {
            // The coordinator handles auth/storage/data routes.
            // This hook is for driver-specific extensions only.
            // Currently Postgres doesn't need additional routes beyond what the coordinator mounts.
        },

        async initializeWebsockets(server: unknown, realtimeService: RealtimeProvider, driver: DataDriver, config?: unknown, adapter?: unknown): Promise<void> {
            const { createPostgresWebSocket } = await import("./websocket");
            createPostgresWebSocket(
                server as import("http").Server,
                realtimeService as RealtimeService,
                driver as PostgresBackendDriver,
                config as { requireAuth?: boolean },
                adapter as AuthAdapter | undefined
            );
        }
    };
}
