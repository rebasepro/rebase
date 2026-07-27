/**
 * PostgresBootstrapper
 *
 * Implements the `BackendBootstrapper` interface for PostgreSQL.
 */

import { Relations, sql } from "drizzle-orm";
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
    RealtimeProvider,
    type RealtimeChannelsConfig
} from "@rebasepro/types";
import { PostgresBackendDriver } from "./PostgresBackendDriver";
import { RealtimeService } from "./services/realtimeService";
import { buildCollectionRegistry } from "./collections/buildRegistry";
import { DatabasePoolManager } from "./databasePoolManager";
import { PostgresCollectionRegistry } from "./collections/PostgresCollectionRegistry";
import { createEmailService, type EmailConfig, type EmailService, logger } from "@rebasepro/server";
import { getTableName as getCollectionTableName } from "@rebasepro/common";
import { ensureAuthTablesExist } from "./auth/ensure-tables";
import { probeAuthSchema, resolveAuthSchema } from "./auth/schema-version";
import { AuthSchemaTables, PostgresAuthRepository, UserService } from "./auth/services";
import { createAuthSchema } from "./schema/auth-schema";
import { HistoryService } from "./history/HistoryService";
import { ensureHistoryTableExists } from "./history/ensure-history-table";
import { patchPgArrayNullSafety } from "./utils/pg-array-null-patch";
import { buildCollectionsFromSchema, introspectSchema, readRlsStatus } from "./schema/introspect-runtime";
import { buildDrizzleTablesFromSchema, buildDrizzleRelationsFromSchema } from "./schema/dynamic-tables";
import { detectConnectionPosture, ensureAppRole, validatePolicyPgRoles, warnOnAnonymousGrants, REBASE_USER_ROLE, type RawSqlRunner } from "./security/rls-enforcement";
import { provisionTriggerCdc, type CdcTableRef } from "./services/cdc/trigger-cdc";
import { collectJunctionLinks } from "./services/cdc/junction-tables";
import { createChannelBus, resolveChannelBusSetting } from "./services/channel-bus";
import { isChannelBusInstance } from "@rebasepro/types";

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
    /**
     * PostgreSQL schema to read when deriving collections from the database
     * (BaaS mode). Defaults to `public`.
     */
    introspectionSchema?: string;
    /**
     * Realtime options, both opt-in:
     *
     *  - `channels` — retention. Without rules no channel keeps any history and
     *    broadcast stays fire-and-forget. See {@link ChannelRetentionRule}.
     *  - `bus` — the cross-instance transport for channel broadcast and
     *    presence. Defaults to in-process only, which is correct for a single
     *    instance and wrong for two. See {@link ChannelBusConfig}.
     */
    realtime?: RealtimeChannelsConfig;
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
    /**
     * Attach CDC triggers to tables that did not exist when the driver
     * bootstrapped. Only set when database-level capture is actually active.
     *
     * Auth owns its own tables and creates them later in boot, so at driver
     * bootstrap they are legitimately missing and get skipped; without this
     * they would stay uninstrumented until the next restart.
     */
    provisionCdcForTables?: (tables: CdcTableRef[]) => Promise<void>;
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
            // Currently config from init.ts is `{ collections, collectionRegistry, mode }`
            const { collections, collectionRegistry, introspectCollections, baas } = config as {
                collections?: CollectionConfig[];
                collectionRegistry?: unknown;
                introspectCollections?: boolean;
                baas?: { unprotectedTables?: "exclude" | "serve" };
            };
            // Secure by default: a table with no RLS is not served.
            const unprotectedTables = baas?.unprotectedTables ?? "exclude";

            const connection = pgConfig.connection;
            const rawClient = (connection && typeof connection === "object" && "$client" in connection
                ? (connection as Record<string, unknown>).$client
                : connection) as import("pg").Pool;

            // ── No declared collections: derive the schema from the database ──
            // No collection files and no generated drizzle schema exist, so read
            // the live database and build both from what is actually there.
            let introspectedCollections: CollectionConfig[] | undefined;
            let introspectedTables: Record<string, PgTable> | undefined;
            let introspectedRelations: Record<string, Relations> | undefined;
            if (introspectCollections && (!collections || collections.length === 0)) {
                const pgSchemaName = pgConfig.introspectionSchema ?? "public";
                const schema = await introspectSchema(rawClient, pgSchemaName);

                // ── Only serve what the database protects ────────────────
                // Requests run as rebase_user, which is granted DML on the
                // schema. A table with RLS disabled therefore has no
                // authorization model at all: serving it hands every row to
                // every authenticated user. baas never runs `db push`, so
                // nothing here would have enabled RLS on the user's behalf.
                const rlsStatus = await readRlsStatus(rawClient, pgSchemaName);
                const unprotected = [...schema.tablesMap.keys()].filter(
                    (t) => !schema.joinTables.has(t) && !rlsStatus.get(t)?.rlsEnabled
                );
                const policyless = [...schema.tablesMap.keys()].filter(
                    (t) => !schema.joinTables.has(t) && rlsStatus.get(t)?.rlsEnabled && rlsStatus.get(t)?.policyCount === 0
                );

                if (unprotected.length > 0) {
                    if (unprotectedTables === "serve") {
                        logger.warn(
                            `🔓 [rls] Serving ${unprotected.length} table(s) with row-level security DISABLED: ${unprotected.join(", ")}. ` +
                            "Every authenticated request can read and write every row of these. " +
                            "This is baas.unprotectedTables: \"serve\"."
                        );
                    } else {
                        logger.warn(
                            `🔒 [rls] Not serving ${unprotected.length} table(s) — row-level security is disabled, so they have no ` +
                            `authorization model: ${unprotected.join(", ")}\n` +
                            unprotected.map((t) => `      ALTER TABLE "${pgSchemaName}"."${t}" ENABLE ROW LEVEL SECURITY;  -- then add a policy`).join("\n") +
                            "\n      Set baas.unprotectedTables: \"serve\" to expose them regardless."
                        );
                        for (const t of unprotected) schema.tablesMap.delete(t);
                    }
                }
                if (policyless.length > 0) {
                    // Legal, and silently returns nothing — worth saying out loud,
                    // since an empty table reads exactly like one with no rows.
                    logger.warn(
                        `🔒 [rls] ${policyless.length} table(s) have RLS enabled but no policies, so they will return no rows: ${policyless.join(", ")}`
                    );
                }

                introspectedCollections = buildCollectionsFromSchema(schema, pgSchemaName);
                introspectedTables = buildDrizzleTablesFromSchema(schema.tablesMap, pgSchemaName);
                // Without these, drizzle's relational path can't resolve the
                // relations the collections above advertise.
                introspectedRelations = buildDrizzleRelationsFromSchema(schema.tablesMap, introspectedTables);
                logger.info(
                    `🔍 [PostgresRegistry] BaaS mode: derived ${introspectedCollections.length} collections from schema "${pgSchemaName}" [${introspectedCollections.map(c => c.slug).join(", ")}]`
                );
            }

            const activeCollections = introspectedCollections ?? collections;
            const schemaTables = introspectedTables ?? pgConfig.schema?.tables;
            const schemaRelations = introspectedRelations ?? (pgConfig.schema?.relations as Record<string, Relations> | undefined);

            // Create a fresh registry for this driver. Registration order is
            // load-bearing, so it lives in one place — see `buildCollectionRegistry`.
            const registry = buildCollectionRegistry({
                collections: activeCollections,
                tables: schemaTables,
                enums: pgConfig.schema?.enums as Record<string, PgEnum<[string, ...string[]]>> | undefined,
                relations: schemaRelations
            });

            // Patch Drizzle's PgArray columns to handle NULL values safely.
            // Drizzle's mapFromDriverValue crashes with "value.map is not a function"
            // when a native array column (text[], integer[], etc.) contains NULL.
            if (schemaTables) {
                patchPgArrayNullSafety(schemaTables as Record<string, unknown>);
            }

            // Build schema-aware Drizzle connection
            const mergedSchema: Record<string, unknown> = {
                ...schemaTables,
                ...(schemaRelations || {})
            };
            const { drizzle: createDrizzle } = await import("drizzle-orm/node-postgres");
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
                        `    • docker compose up -d db          (the service a Rebase scaffold ships)\n` +
                        `    • brew services start postgresql@18\n` +
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

                // Independent of posture: a policy targeting a role the request
                // never runs as filters every row, so the collection reads as
                // empty rather than erroring. Applies to both branches — the
                // role that matters is whichever one requests actually use.
                await validatePolicyPgRoles(
                    runSql,
                    registry.getCollections() as never,
                    driver.rlsUserRole ?? posture.role
                );

                // The same habit one surface over, and the dangerous direction:
                // a rule that reads as "signed in only" but is true for every
                // caller grants the data away rather than hiding it.
                warnOnAnonymousGrants(registry.getCollections() as never);
            }

            // Ensure branch metadata table exists when branching is available
            if (driver.branchService) {
                try {
                    await driver.branchService.ensureBranchMetadataTable();
                } catch (err) {
                    logger.warn("⚠️ Could not initialize branch metadata table", { error: err });
                }
            }

            // ── Channel history ──────────────────────────────────────────────
            // Opt-in per channel pattern. With no rules this creates no tables
            // and leaves broadcast on its original fire-and-forget path, so
            // presence-only apps pay nothing for it.
            try {
                await realtimeService.configureChannelHistory(pgConfig.realtime?.channels);
            } catch (err) {
                logger.warn("⚠️ Could not initialize channel history tables — retained channels will not replay", { error: err });
            }

            // ── Realtime change source ───────────────────────────────────────
            // Prefer DATABASE_DIRECT_URL to bypass PgBouncer for LISTEN/NOTIFY.
            const directUrl = process.env.DATABASE_DIRECT_URL || pgConfig.connectionString;

            // ── Cross-instance channel bus ───────────────────────────────────
            // Entity changes already span instances (CDC / LISTEN below).
            // Channel broadcast and presence did not — they lived in per-process
            // maps, so behind two replicas the clients of one were invisible to
            // the other. Opt-in, and a no-op when left at "memory".
            try {
                const busSetting = resolveChannelBusSetting(pgConfig.realtime?.bus);
                // A supplied instance is always installed; a named built-in only
                // when it is not the in-process default, so the common case
                // touches none of this machinery.
                const wantsBus = isChannelBusInstance(busSetting) || busSetting.type !== "memory";
                if (wantsBus) {
                    await realtimeService.configureChannelBus(
                        createChannelBus(busSetting, {
                            db: schemaAwareDb as unknown as NodePgDatabase<Record<string, unknown>>,
                            directUrl
                        })
                    );
                }
            } catch (err) {
                logger.warn("⚠️ [ChannelBus] Could not configure the channel bus — channel broadcast and presence stay per-instance", { error: err });
            }

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
            let provisionCdcForTables: PostgresDriverInternals["provisionCdcForTables"];

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
                    // Junction tables back no collection, so the list above misses
                    // them — and a link or unlink is a write nobody would hear
                    // about. Their rows are the contents of a child list, which is
                    // as much a change as a write to the rows themselves.
                    for (const link of collectJunctionLinks(registry)) {
                        cdcTables.push({ schema: link.schema,
table: link.table });
                    }
                    // Provisioning throws only when the connection can't create the
                    // trigger function (insufficient privilege); enableCdc throws when
                    // the LISTEN connection can't be established. Either → fall back.
                    await provisionTriggerCdc(cdcRunSql, cdcTables);
                    await realtimeService.enableCdc(directUrl);
                    cdcEnabled = true;
                    // Boot steps that create their own tables (auth) run after
                    // this one and use it to instrument what they just created.
                    provisionCdcForTables = async (tables) => {
                        await provisionTriggerCdc(cdcRunSql, tables);
                    };
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
                        // Auth owns its table and creates it later in this same
                        // boot (initializeAuth → ensureAuthTablesExist), so it is
                        // legitimately absent right now. Reporting it as drift
                        // tells the user to `db:push` a table that is about to
                        // exist — and on an introspected database, one that the
                        // database was never supposed to hold.
                        if ((col as { auth?: { enabled?: boolean } }).auth?.enabled) continue;

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
                            // Report what was actually looked up: an unqualified
                            // "users" sends people hunting for public.users.
                            missing.push({ slug: col.slug,
table: fullCheckName });
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
                poolManager,
                provisionCdcForTables
            };

            return {
                driver,
                realtimeProvider: realtimeService,
                collectionRegistry: registry,
                // Only set in baas mode — tells the server which collections the
                // database turned out to have.
                collections: introspectedCollections,
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

            // The driver bootstrapped before these tables existed, so CDC skipped
            // them. Instrument them now, or writes to the user table emit no
            // realtime events until the next restart.
            if (authCollection && internals.provisionCdcForTables) {
                const authSchema = "schema" in authCollection && typeof authCollection.schema === "string"
                    ? authCollection.schema
                    : "rebase";
                const authTable = "table" in authCollection && typeof authCollection.table === "string"
                    ? authCollection.table
                    : authCollection.slug;
                if (authTable) {
                    try {
                        await internals.provisionCdcForTables([{ schema: authSchema, table: authTable }]);
                    } catch (err) {
                        logger.warn(
                            `⚠️ [CDC] Could not attach change-capture to the auth table "${authSchema}.${authTable}" — ` +
                            "writes to it won't emit database-level events.",
                            { detail: err instanceof Error ? err.message : String(err) }
                        );
                    }
                }
            }

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
authRepository,
// Bound to the same schema `ensureAuthTablesExist` just migrated, so the
// health endpoint reports on the tables auth actually reads.
schemaHealthCheck: () => probeAuthSchema(db, resolveAuthSchema(authCollection)) };
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

        /**
         * Create any collection tables, columns and enum types the database is
         * missing — additively, never destructively.
         *
         * This is what lets the managed runtime boot a project against a fresh
         * database and actually serve it. Before this, only auth tables were
         * ensured, so a managed tenant came up with working sign-in and a 500 on
         * every data route.
         *
         * Runs through the drizzle handle's underlying session so it uses the
         * same connection (and therefore the same privileges) the driver already
         * proved it can bootstrap with.
         */
        async ensureCollectionSchema(
            collections: unknown[],
            driverResult: InitializedDriver,
            log?: (message: string) => void
        ): Promise<{ applied: number }> {
            const internals = driverResult.internals as PostgresDriverInternals;
            const { ensureCollectionTables } = await import("./schema/ensure-collection-tables");
            // Runs through the drizzle handle the driver already bootstrapped
            // with, so it uses exactly the connection and privileges that were
            // proven to work. Every statement is DDL or a catalogue read with no
            // bindable values (schema names are identifiers), and the module
            // validates them before they reach a string.
            const queryable = {
                async query<T>(text: string): Promise<{ rows: T[] }> {
                    const result = await internals.db.execute(sql.raw(text));
                    const rows = (result as unknown as { rows?: T[] }).rows;
                    return { rows: rows ?? (Array.isArray(result) ? (result as T[]) : []) };
                }
            };
            const plan = await ensureCollectionTables(
                queryable,
                collections as Parameters<typeof ensureCollectionTables>[1],
                log
            );
            return { applied: plan.actions.length };
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
                config as { requireAuth?: boolean; jwtSecret?: string; serviceKey?: string },
                adapter as AuthAdapter | undefined
            );
        }
    };
}
