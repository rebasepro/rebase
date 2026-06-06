/**
 * PostgresBootstrapper
 *
 * Implements the `BackendBootstrapper` interface for PostgreSQL.
 */

import { getTableName, isTable, Relations, sql, Table } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgEnum, PgTable, getTableConfig, AnyPgColumn } from "drizzle-orm/pg-core";
import {
    BackendBootstrapper,
    InitializedDriver,
    BootstrappedAuth,
    DatabaseAdmin,
    RealtimeProvider,
    type DataDriver,
    type AuthAdapter,
    EntityCollection
} from "@rebasepro/types";
import { PostgresBackendDriver } from "./PostgresBackendDriver";
import { RealtimeService } from "./services/realtimeService";
import { DatabasePoolManager } from "./databasePoolManager";
import { PostgresCollectionRegistry } from "./collections/PostgresCollectionRegistry";
import {
    createAuthRoutes,
    createAdminRoutes,
    requireAuth,
    requireAdmin
// @ts-ignore
} from "@rebasepro/server-core";
import { ensureAuthTablesExist } from "./auth/ensure-tables";
import { RoleService, UserService, PostgresAuthRepository, AuthSchemaTables } from "./auth/services";
import { createAuthSchema } from "./schema/auth-schema";

// @ts-ignore
import { createEmailService, type EmailConfig, type EmailService } from "@rebasepro/server-core";
// @ts-ignore
import { createHistoryRoutes } from "@rebasepro/server-core";
import { HistoryService } from "./history/HistoryService";
import { ensureHistoryTableExists } from "./history/ensure-history-table";
// @ts-ignore
import type { AuthConfig, PostgresDriverConfig, HistoryConfig } from "@rebasepro/server-core";
import type { Hono } from "hono";
// @ts-ignore
import type { HonoEnv } from "@rebasepro/server-core";

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
                console.log(`📋 [PostgresRegistry] Registered ${registry.getCollections().length} collections: [${registry.getCollections().map(c => c.slug).join(", ")}]`);
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

            // Build schema-aware Drizzle connection
            const mergedSchema: Record<string, unknown> = {
                ...pgConfig.schema?.tables,
                ...(pgConfig.schema?.relations || {})
            };
            const { drizzle: createDrizzle } = await import("drizzle-orm/node-postgres");
            const rawClient = ("$client" in pgConfig.connection
                ? (pgConfig.connection as Record<string, unknown>).$client
                : pgConfig.connection) as import("pg").Pool;
            const schemaAwareDb = createDrizzle(rawClient, { schema: mergedSchema });

            // Verify connection
            try {
                await schemaAwareDb.execute(sql`SELECT 1`);
            } catch (err) {
                console.error("❌ Failed to connect to PostgreSQL:", err);
                console.warn("⚠️ Continuing without initial database verification. Drizzle/PG will attempt to connect on subsequent queries.");
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
                    console.log("📖 [PostgresBootstrapper] Read replica connection established");
                } catch (err) {
                    console.warn("⚠️ Could not connect to read replica, falling back to primary for all queries:", err);
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
                    console.warn("⚠️ Could not initialize branch metadata table:", err);
                }
            }

            // Enable cross-instance realtime (opt-in)
            // Prefer DATABASE_DIRECT_URL to bypass PgBouncer for LISTEN/NOTIFY
            const directUrl = process.env.DATABASE_DIRECT_URL || pgConfig.connectionString;
            if (directUrl) {
                try {
                    await realtimeService.startListening(directUrl);
                } catch (err) {
                    console.warn("⚠️ Cross-instance realtime could not be started:", err);
                }
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
            const authConfig = config as AuthConfig | undefined;
            if (!authConfig) return undefined;

            const internals = driverResult.internals as PostgresDriverInternals;
            const db = internals.db;
            const registry = internals.registry;

            await ensureAuthTablesExist(db, registry);

            let emailService: EmailService | undefined;
            if (authConfig.email) {
                emailService = createEmailService(authConfig.email);
            }

            const customUsersTable = registry?.getTable("users");
            const customRolesTable = registry?.getTable("roles");

            let usersSchemaName = "rebase";
            let rolesSchemaName = "rebase";

            if (customUsersTable) {
                usersSchemaName = getTableConfig(customUsersTable).schema || "public";
            }
            if (customRolesTable) {
                rolesSchemaName = getTableConfig(customRolesTable).schema || "public";
            }

            const authTables = createAuthSchema(rolesSchemaName, usersSchemaName) as unknown as AuthSchemaTables;
            if (customUsersTable) {
                authTables.users = customUsersTable as unknown as PgTable & Record<string, AnyPgColumn>;
            }
            if (customRolesTable) {
                authTables.roles = customRolesTable as unknown as PgTable & Record<string, AnyPgColumn>;
            }

            const userService = new UserService(db, authTables);
            const roleService = new RoleService(db, authTables);
            const authRepository = new PostgresAuthRepository(db, authTables);

            return { userService,
roleService,
emailService,
authRepository };
        },

        async initializeHistory(config: unknown, driverResult: InitializedDriver): Promise<{ historyService: HistoryService } | undefined> {
            const historyConfig = config as HistoryConfig | boolean | undefined;
            if (!historyConfig) return undefined;

            const internals = driverResult.internals as PostgresDriverInternals;
            const db = internals.db;

            await ensureHistoryTableExists(db);

            const retention = typeof historyConfig === "object" && historyConfig !== null ? (historyConfig as { retention?: number }).retention : undefined;
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
                config as AuthConfig,
                adapter as AuthAdapter | undefined
            );
        }
    };
}
