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
    CollectionConfig,
    type HistoryConfig,
    InitializedDriver,
    RealtimeProvider
} from "@rebasepro/types";
import { PostgresBackendDriver } from "./PostgresBackendDriver";
import { RealtimeService } from "./services/realtimeService";
import { DatabasePoolManager } from "./databasePoolManager";
import { PostgresCollectionRegistry } from "./collections/PostgresCollectionRegistry";
import { createEmailService, type EmailConfig, type EmailService, logger } from "@rebasepro/server-core";
import { getTableName as getCollectionTableName } from "@rebasepro/common";
import { ensureAuthTablesExist } from "./auth/ensure-tables";
import { AuthSchemaTables, PostgresAuthRepository, UserService } from "./auth/services";
import { createAuthSchema } from "./schema/auth-schema";
import { HistoryService } from "./history/HistoryService";
import { ensureHistoryTableExists } from "./history/ensure-history-table";
import { patchPgArrayNullSafety } from "./utils/pg-array-null-patch";
import { detectConnectionPosture, ensureAppRole, REBASE_USER_ROLE, type RawSqlRunner } from "./security/rls-enforcement";
import { provisionTriggerCdc, type CdcTableRef } from "./services/cdc/trigger-cdc";

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
                collections?: CollectionConfig[];
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

            // ── RLS enforcement (user context) ───────────────────────────────
            // Authenticated requests are authorized entirely by RLS policies,
            // but a privileged connection (superuser / BYPASSRLS / table owner)
            // bypasses RLS. Detect the posture and, when privileged, provision
            // the restricted `rebase_user` role and route authenticated
            // requests (reads AND writes) through it. The server context (base
            // driver / dataAsAdmin / auth flows) stays on the owner connection
            // and bypasses. Default-on: a privileged connection that cannot be
            // isolated fails the boot rather than serving unenforced requests.
            {
                const runSql: RawSqlRunner = async (text) => {
                    const res = await schemaAwareDb.execute(sql.raw(text));
                    return (res.rows ?? []) as Record<string, unknown>[];
                };
                const posture = await detectConnectionPosture(runSql);
                if (posture.privileged) {
                    const collectionSchemas = registry.getCollections()
                        .map((c) => (c as { schema?: string }).schema)
                        .filter((s): s is string => typeof s === "string");
                    await ensureAppRole(runSql, ["public", "rebase", "auth", ...collectionSchemas]);
                    driver.rlsUserRole = REBASE_USER_ROLE;
                    realtimeService.rlsUserRole = REBASE_USER_ROLE;
                    logger.info(`🔐 RLS enforcement active: authenticated requests run as "${REBASE_USER_ROLE}" (connection "${posture.role}" bypasses RLS: ${posture.superuser ? "superuser" : posture.bypassRLS ? "BYPASSRLS" : "table owner"})`);
                    if (posture.superuser || posture.bypassRLS) {
                        logger.warn(
                            `⚠️ The database connection runs as ${posture.superuser ? "a superuser" : "a BYPASSRLS role"} ("${posture.role}"). ` +
                            `User requests are isolated via SET LOCAL ROLE, but connect as a non-superuser ` +
                            `table-owner role in production so the server/owner context is least-privilege.`
                        );
                    }
                } else {
                    logger.info(`🔐 RLS enforcement: connection role "${posture.role}" is subject to RLS natively; no role switch needed.`);
                }
            }

            // Ensure branch metadata table exists when branching is available
            if (driver.branchService) {
                try {
                    await driver.branchService.ensureBranchMetadataTable();
                } catch (err) {
                    logger.warn("⚠️ Could not initialize branch metadata table", { error: err });
                }
            }

            // ── Realtime change source ───────────────────────────────────────
            // Prefer DATABASE_DIRECT_URL to bypass PgBouncer for LISTEN/NOTIFY.
            const directUrl = process.env.DATABASE_DIRECT_URL || pgConfig.connectionString;

            // Database-level Change Data Capture. When active, realtime events are
            // emitted for EVERY committed write — including ones that bypass the
            // Rebase API (psql, another service's cron, raw SQL, the Studio SQL
            // editor) — matching Supabase Realtime's WAL-tailing model. CDC also
            // becomes the cross-instance channel, so the legacy per-mutation
            // LISTEN/NOTIFY is not started alongside it.
            //   REALTIME_CDC=auto     → default: enable where the connection supports
            //                           it; silently fall back to app-level otherwise
            //   REALTIME_CDC=trigger  → force trigger-based capture (warns if it can't)
            //   REALTIME_CDC=wal      → prefer WAL logical replication (degrades to trigger)
            //   REALTIME_CDC=off      → app-level realtime only
            const validModes = new Set(["auto", "wal", "trigger", "off"]);
            let cdcMode = (process.env.REALTIME_CDC || "auto").trim().toLowerCase();
            if (!validModes.has(cdcMode)) {
                logger.warn(`⚠️ [CDC] Unknown REALTIME_CDC value "${cdcMode}" — expected auto|wal|trigger|off. Defaulting to "auto".`);
                cdcMode = "auto";
            }

            // `auto` tries CDC but treats "can't" as a normal outcome (info log);
            // explicit trigger/wal was asked for, so a failure is worth a warning.
            const wantsCdc = cdcMode !== "off";
            const explicitCdc = cdcMode === "trigger" || cdcMode === "wal";
            let cdcEnabled = false;

            if (wantsCdc && !directUrl) {
                const reason = "no direct database connection is available for the realtime LISTEN client (set DATABASE_DIRECT_URL)";
                if (explicitCdc) logger.warn(`⚠️ [CDC] REALTIME_CDC=${cdcMode} but ${reason} — using app-level realtime.`);
                else logger.info(`ℹ️ [CDC] Using app-level realtime — ${reason}.`);
            } else if (wantsCdc && directUrl) {
                if (cdcMode === "wal") {
                    // Native WAL logical-replication streaming requires wal_level=logical,
                    // a replication-privileged role and a replication slot, none of which
                    // are bundled with this adapter yet. Degrade to trigger-based capture,
                    // which provides equivalent database-level coverage.
                    logger.warn(
                        "⚠️ [CDC] REALTIME_CDC=wal: native WAL streaming is not bundled in this build; " +
                        "using trigger-based change capture instead (equivalent database-level coverage)."
                    );
                }
                try {
                    const cdcRunSql: RawSqlRunner = async (text) => {
                        const res = await schemaAwareDb.execute(sql.raw(text));
                        return (res.rows ?? []) as Record<string, unknown>[];
                    };
                    const cdcTables: CdcTableRef[] = registry.getCollections()
                        .map((c) => ({
                            schema: (c as { schema?: string }).schema ?? "public",
                            table: getCollectionTableName(c)
                        }))
                        .filter((t) => Boolean(t.table) && registry.hasTableForCollection(t.table));
                    // Provisioning throws only when the connection can't create the
                    // trigger function (insufficient privilege); enableCdc throws when
                    // the LISTEN connection can't be established. Either → fall back.
                    await provisionTriggerCdc(cdcRunSql, cdcTables);
                    await realtimeService.enableCdc(directUrl);
                    cdcEnabled = true;
                    logger.info(
                        `📡 [CDC] Realtime source = database-level change capture (mode: ${cdcMode === "wal" ? "wal→trigger" : "trigger"}). ` +
                        `All writes now emit realtime events regardless of origin.`
                    );
                } catch (err) {
                    if (explicitCdc) {
                        logger.warn("⚠️ [CDC] Could not enable database-level change capture — falling back to app-level realtime.", { error: err });
                    } else {
                        logger.info(
                            "ℹ️ [CDC] Database-level change capture unavailable (likely insufficient privileges to create triggers, " +
                            "or the LISTEN connection was refused) — using app-level realtime. Set REALTIME_CDC=off to silence this.",
                            { detail: err instanceof Error ? err.message : String(err) }
                        );
                    }
                }
            }

            // Legacy cross-instance realtime (app-level). Skipped when CDC is
            // active because CDC already spans instances.
            if (!cdcEnabled && directUrl) {
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
            const authCollection = authConfig.collection as CollectionConfig | undefined;

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
