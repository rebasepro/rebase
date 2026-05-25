/**
 * PostgresBootstrapper
 *
 * Implements the `BackendBootstrapper` interface for PostgreSQL.
 */

import { getTableName, isTable, Relations, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PgEnum, PgTable } from "drizzle-orm/pg-core";
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
import { RoleService, UserService, PostgresAuthRepository } from "./auth/services";

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

            if (pgConfig.schema?.enums) registry.registerEnums(pgConfig.schema.enums as Record<string, PgEnum<any>>);
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
            if (pgConfig.connectionString) {
                try {
                    await realtimeService.startListening(pgConfig.connectionString);
                } catch (err) {
                    console.warn("⚠️ Cross-instance realtime could not be started:", err);
                }
            }

            const internals: PostgresDriverInternals = {
                db: schemaAwareDb,
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
            const userService = new UserService(db, customUsersTable);
            const roleService = new RoleService(db);
            const authRepository = new PostgresAuthRepository(db, customUsersTable);

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
