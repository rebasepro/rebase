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
    isRelationalCollectionConfig,
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
import { patchPgNumericToNumber } from "./utils/pg-numeric-number-patch";
import { buildCollectionsFromSchema, introspectSchema, readRlsStatus } from "./schema/introspect-runtime";
import { buildDrizzleTablesFromSchema, buildDrizzleRelationsFromSchema } from "./schema/dynamic-tables";
import { detectConnectionPosture, ensureAppRole, validatePolicyPgRoles, warnOnAnonymousGrants, warnOnLegacyRlsFunctions, warnOnRoleSchemaCollision, REBASE_USER_ROLE, type RawSqlRunner } from "./security/rls-enforcement";
import { provisionTriggerCdc, type CdcTableRef } from "./services/cdc/trigger-cdc";
import { collectJunctionLinks } from "./services/cdc/junction-tables";
import { createChannelBus, resolveChannelBusSetting } from "./services/channel-bus";
import { isChannelBusInstance } from "@rebasepro/types";
import { configureUnknownFilterFields, type UnknownFilterFieldsMode } from "./utils/drizzle-conditions";

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
    /**
     * What to do with a filter field that resolves to no column at all.
     * Defaults to `"error"` — a filter that cannot be compiled would otherwise
     * be dropped, and a dropped condition can only widen the result set.
     * Set to `"warn"` to restore the pre-fix behaviour of dropping it silently.
     */
    unknownFilterFields?: UnknownFilterFieldsMode;
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
import { deepestErrorMessage, diagnoseDbError, isEconnrefused, parseHostInfo } from "./cli-errors";
import { classifyConnectFailure } from "./utils/pg-error-utils";

/**
 * Which table name the boot-time drift check should look for, for one collection.
 *
 * A declared `table` IS the table name, not a hint to be second-guessed. This
 * used to ask the registry whether it had indexed the declared name and fall
 * back to the SLUG when it had not — but "the registry does not know this table"
 * is exactly the condition the drift check exists to report, so the fallback
 * fired precisely when it was most harmful.
 *
 * A collection with `slug: "usage-daily", table: "usage_daily"` was reported as
 * missing table `usage-daily`: a name that does not exist, should never exist,
 * and that nobody can find by looking. Worse, the remediation the caller prints
 * says to run `rebase db push` — which would then CREATE that invented table
 * beside the correct one, the same "second copy" hazard the misplaced-schema
 * branch further down exists to prevent. Seen in production, where a correctly
 * migrated database reported drift on every boot.
 *
 * The slug is used only when nothing was declared, which is the config shape
 * where the slug genuinely is the table name.
 *
 * Exported for its own test: the caller needs a live pool and a real database,
 * and this is the part that was wrong.
 */
export function resolveDriftCheckName(
    col: CollectionConfig,
    registeredTableNames: string[]
): string {
    const declaredTable = isRelationalCollectionConfig(col) ? col.table : undefined;
    return declaredTable
        ?? registeredTableNames.find((k) => k === col.slug)
        ?? col.slug;
}

/**
 * Why the tables this backend serves are not in the database — the part of the
 * drift warning that has to be true rather than merely plausible.
 *
 * The three answers need three different actions, and only the caller knows
 * which one applies. This warning used to assert the first ("this runtime
 * applies the collection schema at boot unless REBASE_MIGRATE_ON_BOOT=none")
 * and then point at that variable and at driver-version skew. For an app whose
 * boot path contained no provisioning step at all, every word of that was a
 * dead end: nothing read the variable, and the driver was current. The advice
 * cost an investigation, which is a strictly worse outcome than saying less.
 *
 * Exported for its own test: the surrounding check needs a live pool and a real
 * database, and this is the part that was wrong.
 */
export function describeSchemaDriftCause(
    provisioning: { attempted: boolean; reason?: string } | undefined
): string[] {
    // A caller too old to send the signal gets no claim either way — just where
    // to look. Guessing is what got this wrong the first time.
    if (provisioning === undefined) {
        return [
            "  This runtime could not determine whether a schema-creation step ran",
            "  before this check (the caller predates that signal).",
            "    • Look for a \"Collection schema:\" line above. No such line at all",
            "      means nothing tried to create these tables in this process."
        ];
    }
    if (provisioning.attempted) {
        return [
            "  A schema-creation step DID run this boot and these tables are still",
            "  missing, so it did not create them — check the \"schema:\" lines above",
            "  for what it did instead, and for DDL errors.",
            "    • A collection routed to another engine or data source is not",
            "      created here; that is reported separately at boot.",
            "    • Otherwise this is a bug worth reporting, with those lines."
        ];
    }
    return [
        "  No schema-creation step ran this boot:",
        `    ${provisioning.reason ?? "no reason was given."}`,
        "  Resolve that reason — the drift is its consequence, not a separate",
        "  problem, and re-running a migration tool will not change it."
    ];
}

/**
 * Is this the local database `rebase init` scaffolds — i.e. the one case where
 * "you are connected as a superuser" is not news?
 *
 * The scaffold's own `docker-compose.yml` sets `POSTGRES_USER: rebase_app`,
 * which makes that role the cluster superuser, so the superuser advisory below
 * was the only WARN a brand-new project ever saw and it was about a decision
 * the tool had made for the developer.
 *
 * Of the two available fixes — provision a non-superuser table-owner role in
 * the scaffold, or recognise the local shape and stay quiet — this is the
 * second, because the first breaks the scaffold it is meant to improve: a
 * non-superuser owner cannot `CREATE EXTENSION` (search collections need
 * `pg_trgm`/`unaccent`, applied by `rebase db push` and again by the boot
 * schema-ensure), so the very first `pnpm run db:push` on a scaffolded project
 * with a search block would fail. Trading a working first run for a quieter log
 * line is the wrong trade.
 *
 * The condition is deliberately narrow — a *non-production* process talking to
 * a database on the loopback interface. A genuine production superuser
 * connection still warns, and so does a non-production process pointed at a
 * remote database (the usual "my dev machine writes to staging" mistake, where
 * the advisory is exactly right). NODE_ENV alone would not do: the scaffold
 * ships `NODE_ENV=development` and some deployments inherit it.
 */
export function isScaffoldedLocalDatabase(connectionString: string | undefined): boolean {
    if (process.env.NODE_ENV === "production") return false;
    if (!connectionString) return false;
    let host: string;
    try {
        host = new URL(connectionString).hostname;
    } catch {
        return false;
    }
    // `new URL` keeps IPv6 literals in brackets.
    const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
    return bare === "localhost"
        || bare === "::1"
        || bare === "0.0.0.0"
        || bare === ""
        || /^127\./.test(bare)
        || bare.endsWith(".localhost");
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
/**
 * Where the collections schema stamp lives.
 *
 * The runtime's own internal schema, always — unlike the auth stamp, which
 * follows the users collection. `rebase` and `auth` sit outside
 * `introspectionSchema` by construction, so nothing here is ever served as a
 * collection.
 */
const SCHEMA_META_SCHEMA = "rebase";

/**
 * One line about a statement the ensure could not apply and chose to survive.
 *
 * Each kind degrades differently and the operator's next move differs with it,
 * so they do not share a sentence. What they share is the shape: what is still
 * true, what is no longer true, and the database's own reason — never a bare
 * "failed", which is the version of this that taught nobody anything.
 */
function describeEnsureFailure(failure: { kind: string; target: string; error: string }): string {
    switch (failure.kind) {
        case "comment-column":
            // The stamp records which `search` block the generated column was
            // built from. Without it the next boot cannot tell a changed block
            // from an unchanged one and adopts the column again instead of
            // refusing.
            return (
                `🔍 [schema] Could not record the search fingerprint on "${failure.target}" — search works, ` +
                `but a later change to the \`search\` block will not be detected: ${failure.error}`
            );
        case "create-index":
            // Not fatal, on purpose: the collection serves, every query returns
            // the same rows, and only latency changes. Said at `warn` every boot
            // because the alternative is a table that is permanently unindexed
            // and looks exactly like one that is not.
            return (
                `🐢 [schema] Could not create an index on "${failure.target}" — the collection serves and returns ` +
                "the same rows, but queries that would have used this index will scan instead. Boot is not failed " +
                `over an index: ${failure.error}`
            );
        default:
            return (
                `🔗 [schema] Could not add foreign key "${failure.target}" — the column exists and the ` +
                `collection still serves, but rows are not policed by this constraint: ${failure.error}`
            );
    }
}

/**
 * Say what a failed `SELECT 1` actually means, and whether boot can go on.
 *
 * Returns the error to throw, or `undefined` when the failure could be
 * transient and the pool may still recover.
 *
 * Two problems this exists to keep fixed. First, the logged error is Drizzle's
 * wrapper — `Failed query: SELECT 1` and a stack through drizzle internals —
 * while the sentence that actually says what is wrong ("connect ECONNREFUSED
 * 127.0.0.1:5432", "password authentication failed for user …", "database …
 * does not exist") sits in `.cause`, or inside the `AggregateError` a
 * dual-stack host produces. A developer with a stopped database, or a typo in
 * their `DATABASE_URL`, got two walls of stack trace and no cause.
 *
 * Second, "continuing… the pool may recover" is only true for a transient
 * fault. A wrong password or a missing database is settled: the next query
 * fails the same way, so the process died seconds later anyway — after printing
 * a reassurance.
 *
 * The banners come from `diagnoseDbError`, the same ones the CLI prints, so a
 * developer sees one diagnosis whether the database was unreachable during
 * `rebase db push` or during boot.
 */
function diagnoseConnectFailure(err: unknown, connectionString: string | undefined): Error | undefined {
    const url = connectionString ?? "";
    const hostInfo = parseHostInfo(url);

    if (isEconnrefused(err)) {
        logger.error(diagnoseDbError(err, url) ?? `❌ Cannot connect to PostgreSQL at ${hostInfo}`);
        const reason = deepestErrorMessage(err) ?? "connection refused";
        return new Error(
            `Cannot connect to PostgreSQL at ${hostInfo}: ${reason}. Is the database running?`,
            { cause: err }
        );
    }

    const { fatal, reason, code } = classifyConnectFailure(err);
    const detail = code ? ` [${code}]` : "";

    if (fatal) {
        logger.error(
            diagnoseDbError(err, url) ??
            `\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `  ❌  PostgreSQL at ${hostInfo} refused the connection\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `\n` +
            `  ${reason}${detail}\n` +
            `\n` +
            `  The server is reachable, so this is the credentials or the\n` +
            `  database name in DATABASE_URL — check them in your .env.\n` +
            `\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
        );
        return new Error(`PostgreSQL at ${hostInfo} refused the connection: ${reason}${detail}`, { cause: err });
    }

    logger.error(`❌ Failed to connect to PostgreSQL at ${hostInfo}: ${reason}${detail}`, { error: err });
    return undefined;
}

export function createPostgresBootstrapper(pgConfig: PostgresDriverConfig): BackendBootstrapper {
    // Applied at construction rather than threaded through every read: the
    // condition builder's static methods are reached from call sites that
    // carry no config. See `UnknownFilterFieldsMode`.
    if (pgConfig.unknownFilterFields) {
        configureUnknownFilterFields(pgConfig.unknownFilterFields);
    }

    /**
     * The handle the schema/policy hooks issue their DDL through.
     *
     * Both hooks run BEFORE `initializeDriver`, so `driverResult` is a stand-in
     * the caller may not have: the bundle path can synthesize one from the
     * connection its coordinator opened, but an application that built this
     * adapter itself never handed the framework a connection — it handed it to
     * *us*, as `pgConfig.connection`. Falling back to that is what lets a
     * self-built adapter provision at all; requiring the argument is what left
     * those apps with no tables and a 500 on every data route.
     *
     * Either handle is equivalent here. The driver's `schemaAwareDb` differs
     * only by the drizzle schema object registered on it — relevant to the query
     * builder, not to `execute(sql.raw(...))` — and every statement these hooks
     * emit is schema-qualified DDL, so neither depends on `search_path`.
     */
    /**
     * The drizzle handle itself, for the statements that want parameters.
     *
     * `provisioningQueryable` below hands back a `query(text)` shim because the
     * DDL it serves is built as text. The schema stamp writes a *value*, so it
     * wants the parameterised form — building that string by hand would be one
     * more place a quoted literal has to be got right for no benefit.
     */
    const provisioningDb = (driverResult?: InitializedDriver) => {
        const internals = driverResult?.internals as PostgresDriverInternals | undefined;
        return internals?.db ?? (pgConfig.connection as PostgresDriverInternals["db"] | undefined);
    };

    const provisioningQueryable = (driverResult?: InitializedDriver) => {
        const internals = driverResult?.internals as PostgresDriverInternals | undefined;
        const db = internals?.db ?? (pgConfig.connection as PostgresDriverInternals["db"] | undefined);
        if (!db) {
            throw new Error(
                "Cannot provision the collection schema: this Postgres adapter was created without a " +
                "`connection`, and no initialized driver was supplied to fall back on. Pass `connection` " +
                "to `createPostgresAdapter` (see `createPostgresDatabaseConnection`)."
            );
        }
        return {
            async query<T>(text: string): Promise<{ rows: T[] }> {
                const result = await db.execute(sql.raw(text));
                const rows = (result as unknown as { rows?: T[] }).rows;
                return { rows: rows ?? (Array.isArray(result) ? (result as T[]) : []) };
            }
        };
    };

    return {
        type: "postgres",

        async initializeDriver(config: unknown): Promise<InitializedDriver> {
            // config is passed from coordinator, we merge it with our internal pgConfig if needed
            // Currently config from init.ts is `{ collections, collectionRegistry, mode }`
            const { collections, collectionRegistry, introspectCollections, baas, schemaProvisioning, realtime } = config as {
                collections?: CollectionConfig[];
                collectionRegistry?: unknown;
                introspectCollections?: boolean;
                baas?: { unprotectedTables?: "exclude" | "serve" };
                schemaProvisioning?: { attempted: boolean; reason?: string };
                realtime?: { subscribe: boolean; provision: boolean };
            };
            // Absent means a caller that predates the field, and every one of
            // those is a single process that both serves websockets and owns the
            // schema. Defaulting to false here would silently disable realtime
            // for them — the failure this whole area is prone to.
            const realtimeSubscribes = realtime?.subscribe ?? true;
            const realtimeProvisions = realtime?.provision ?? true;
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

            // ── Declared collections, no generated schema: read the tables back ──
            // Only the default source is handed the bundle's Drizzle schema; a
            // second database (`database("analytics")`) has collections routed
            // to it and no schema at all. Its tables were just provisioned from
            // those collections, so they are read back from the catalogue —
            // restricted to the collections that are this source's, because
            // the driver is handed every collection the project declares and
            // must not go looking for the default's tables in the analytics
            // database. Without this the registry held no table for `events`,
            // and every routed write failed with "table not found" on a
            // database that had the table.
            let ownTables: Record<string, PgTable> | undefined;
            let ownRelations: Record<string, Relations> | undefined;
            const sourceKey = (config as { dataSourceKey?: string }).dataSourceKey ?? "(default)";
            if (!introspectedCollections && !pgConfig.schema?.tables && collections && collections.length > 0) {
                const own = collections.filter(c =>
                    c.dataSource === sourceKey || (!c.dataSource && sourceKey === "(default)")
                );
                if (own.length > 0) {
                    const pgSchemaName = pgConfig.introspectionSchema ?? "public";
                    const live = await introspectSchema(rawClient, pgSchemaName);
                    const wanted = new Set(own.map(c => getCollectionTableName(c)));
                    for (const table of [...live.tablesMap.keys()]) {
                        if (!wanted.has(table) && !live.joinTables.has(table)) live.tablesMap.delete(table);
                    }
                    ownTables = buildDrizzleTablesFromSchema(live.tablesMap, pgSchemaName);
                    ownRelations = buildDrizzleRelationsFromSchema(live.tablesMap, ownTables);
                    const missing = [...wanted].filter(t => !live.tablesMap.has(t));
                    if (missing.length > 0) {
                        logger.warn(
                            `[PostgresRegistry] Data source "${sourceKey}" has no table yet for: ${missing.join(", ")}. ` +
                            "Their collections will answer \"table not found\" until the schema is provisioned."
                        );
                    }
                }
            }

            const activeCollections = introspectedCollections ?? collections;
            const schemaTables = introspectedTables ?? pgConfig.schema?.tables ?? ownTables;
            const schemaRelations = introspectedRelations
                ?? (pgConfig.schema?.relations as Record<string, Relations> | undefined)
                ?? ownRelations;

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
                // A `number` property is a `numeric` column unless it declared
                // itself integral, and Postgres sends `numeric` as text. Cast it
                // back here, where every read path goes through.
                patchPgNumericToNumber(schemaTables as Record<string, unknown>);
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
                const fatal = diagnoseConnectFailure(err, pgConfig.connectionString);
                if (fatal) throw fatal;
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
            // driver / auth flows / `rebase.sql`) stays on the owner connection
            // and bypasses; `rebase.dataAsAdmin` does NOT — it is scoped with
            // `withAuth({ uid: "service", roles: ["admin"] })` at boot, so it
            // runs as `rebase_user` and its policies are evaluated.
            // Default-on: a privileged connection that cannot be
            // isolated fails the boot rather than serving unenforced requests.
            {
                const runSql: RawSqlRunner = async (text) => {
                    const res = await schemaAwareDb.execute(sql.raw(text));
                    return (res.rows ?? []) as Record<string, unknown>[];
                };
                // Said before anything else touches the schema: if the role and
                // a schema share a name, unqualified SQL from any tool that does
                // not pin `search_path` has been landing in the wrong place, and
                // that is worth knowing before reading the drift report below.
                await warnOnRoleSchemaCollision(runSql);

                const collectionSchemas = registry.getCollections()
                    .map((c) => (c as { schema?: string }).schema)
                    .filter((s): s is string => typeof s === "string");
                // `auth` is deliberately absent: the RLS helpers moved into
                // `rebase`, and granting USAGE on a schema Rebase does not
                // own would, on a Supabase database, hand the end-user role
                // access to theirs.
                const managedSchemas = ["public", "rebase", ...collectionSchemas];

                const posture = await detectConnectionPosture(runSql, managedSchemas);
                if (posture.privileged) {
                    // Two different failures hide behind one call here, and they
                    // deserve different answers. A connection that bypasses RLS
                    // *right now* and cannot be switched must not serve: that is
                    // the original contract and it stays fatal. A connection that
                    // merely *could become* the owner — it owns nothing yet, but
                    // may create tables in a schema the server provisions — is
                    // constrained by RLS today, so refusing to boot over it would
                    // break deployments that have been correct all along
                    // (Postgres before 15 grants CREATE on public to PUBLIC, so
                    // that describes a great many ordinary app roles).
                    //
                    // For the second case the answer is: try, warn, and ask again
                    // once provisioning has run. See finalizeSecurityPosture.
                    const bypassesNow = posture.superuser || posture.bypassRLS || posture.ownsTables;
                    let switched = true;
                    try {
                        await ensureAppRole(runSql, managedSchemas);
                    } catch (err) {
                        if (bypassesNow) throw err;
                        switched = false;
                        logger.warn(
                            `⚠️ RLS enforcement: connection role "${posture.role}" owns no tables yet and is ` +
                            `subject to RLS, but it may create tables in ${managedSchemas.join(", ")} — and a ` +
                            "table's owner bypasses every non-FORCE policy on it. The restricted role could not " +
                            `be provisioned: ${err instanceof Error ? err.message : String(err)}`
                        );
                    }

                    if (switched) {
                        driver.rlsUserRole = REBASE_USER_ROLE;
                        realtimeService.rlsUserRole = REBASE_USER_ROLE;
                        const why = posture.superuser
                            ? "superuser"
                            : posture.bypassRLS
                                ? "BYPASSRLS"
                                : posture.ownsTables
                                    ? "table owner"
                                    : "may create (and would then own) tables in the schemas it serves";
                        logger.info(`🔐 RLS enforcement active: authenticated requests run as "${REBASE_USER_ROLE}" (connection "${posture.role}" bypasses RLS: ${why})`);
                    }

                    if (posture.superuser || posture.bypassRLS) {
                        const message =
                            `The database connection runs as ${posture.superuser ? "a superuser" : "a BYPASSRLS role"} ("${posture.role}"). ` +
                            `User requests are isolated via SET LOCAL ROLE, but connect as a non-superuser ` +
                            `table-owner role in production so the server/owner context is least-privilege.`;
                        if (isScaffoldedLocalDatabase(pgConfig.connectionString)) {
                            logger.debug(`🔐 ${message}`);
                        } else {
                            logger.warn(`⚠️ ${message}`);
                        }
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

                // Raw policy SQL written against the pre-1.0 helper schema. It
                // is rewritten on compile, so this is the only place the project
                // is ever told the spelling moved.
                warnOnLegacyRlsFunctions(registry.getCollections() as never);
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
                await realtimeService.configureChannelHistory(
                    pgConfig.realtime?.channels,
                    { provision: realtimeProvisions }
                );
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
            // A process that consumes nothing needs no capture *started*, and a
            // process that does not own the schema installs no triggers. They
            // come apart: the `api` in a split with an external migration Job
            // subscribes without provisioning, and both answers are correct.
            const wantsCdc = cdcMode !== "off" && (realtimeSubscribes || realtimeProvisions);
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
                    if (realtimeProvisions) await provisionTriggerCdc(cdcRunSql, cdcTables);
                    if (realtimeSubscribes) await realtimeService.enableCdc(directUrl);
                    cdcEnabled = true;
                    // Boot steps that create their own tables (auth) run after
                    // this one and use it to instrument what they just created.
                    // Left undefined where this process installs nothing, so a
                    // later boot step cannot re-enter the DDL path by the side
                    // door — the callers already treat it as optional, because a
                    // driver without CDC never sets it either.
                    if (realtimeProvisions) {
                        provisionCdcForTables = async (tables) => {
                            await provisionTriggerCdc(cdcRunSql, tables);
                        };
                    }
                    // Say which half ran. "All writes now emit realtime events"
                    // is a claim about the database and stays true for a process
                    // that only installed the triggers; what changes is whether
                    // *this* process is listening, and an operator reading one
                    // pod's log should not have to infer that from its role.
                    logger.info(
                        `📡 [CDC] Realtime source = database-level change capture (mode: ${cdcMode === "wal" ? "wal→trigger" : "trigger"}). ` +
                        `All writes now emit realtime events regardless of origin.` +
                        (realtimeSubscribes ? "" : " This process installs the capture but does not consume it.")
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
            if (!cdcEnabled && directUrl && realtimeSubscribes) {
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
                    // Deliberately unfiltered by schema: a table that is missing
                    // from where the collection says it lives is very often
                    // sitting in another schema entirely (see the misplaced-table
                    // report below), and knowing *which* is the whole answer.
                    const result = await schemaAwareDb.execute(sql.raw(`
                        SELECT table_name, table_schema
                        FROM information_schema.tables
                        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                          AND table_type = 'BASE TABLE'
                    `));
                    const tablesByName = new Map<string, string[]>();
                    for (const row of result.rows as Array<{ table_name: string; table_schema: string }>) {
                        const schemas = tablesByName.get(row.table_name) ?? [];
                        schemas.push(row.table_schema);
                        tablesByName.set(row.table_name, schemas);
                    }
                    const dbTables = new Set(
                        (result.rows as Array<{ table_name: string; table_schema: string }>).map(r =>
                            r.table_schema === "public" ? r.table_name : `${r.table_schema}.${r.table_name}`
                        )
                    );
                    const missing: Array<{ slug: string; table: string; foundIn: string[] }> = [];
                    for (const col of registeredCollections) {
                        // Auth owns its table and creates it later in this same
                        // boot (initializeAuth → ensureAuthTablesExist), so it is
                        // legitimately absent right now. Reporting it as drift
                        // tells the user to `db:push` a table that is about to
                        // exist — and on an introspected database, one that the
                        // database was never supposed to hold.
                        if ((col as { auth?: { enabled?: boolean } }).auth?.enabled) continue;

                        const schemaName = "schema" in col && col.schema ? col.schema : "public";
                        const checkName = resolveDriftCheckName(col, registry.getTableNames());
                        const fullCheckName = schemaName === "public" ? checkName : `${schemaName}.${checkName}`;
                        if (!dbTables.has(fullCheckName)) {
                            // Report what was actually looked up: an unqualified
                            // "users" sends people hunting for public.users.
                            missing.push({ slug: col.slug,
table: fullCheckName,
foundIn: (tablesByName.get(checkName) ?? []).filter(s => s !== schemaName) });
                        }
                    }
                    if (missing.length > 0) {
                        const lines = missing.map(
                            m => `    • collection "${m.slug}" → table "${m.table}"` +
                                (m.foundIn.length > 0
                                    ? ` — but a table of that name exists in ${m.foundIn.map(s => `"${s}"`).join(", ")}`
                                    : "")
                        );
                        // A table that exists under the same name in another
                        // schema is not ordinary drift: it is almost always this
                        // framework's own `search_path` hazard. Postgres resolves
                        // unqualified SQL through `"$user", public`, and this
                        // project creates a schema named `rebase` while every
                        // template names the database role `rebase` too — so an
                        // unqualified CREATE TABLE (a hand-written migration, the
                        // SQL editor, drizzle-kit) lands in `rebase`, and the
                        // runtime, which now pins `search_path=public`, cannot see
                        // it. Say so, because "missing table" sends people to
                        // re-run a push that will create a *second* copy.
                        const misplaced = missing.filter(m => m.foundIn.length > 0);
                        const misplacedHelp = misplaced.length === 0 ? [] : [
                            "  Those tables exist — in the wrong schema. Unqualified SQL run by a",
                            "  role whose name matches a schema (`rebase` is both, by default)",
                            "  resolves through search_path's \"$user\" and creates there. Move them:",
                            ...misplaced.map(m =>
                                `      ALTER TABLE "${m.foundIn[0]}"."${m.table.split(".").pop()}" SET SCHEMA "${m.table.includes(".") ? m.table.split(".")[0] : "public"}";`
                            ),
                            "  and qualify the SQL that created them, or pin search_path in DATABASE_URL",
                            "  (`?options=-c%20search_path%3Dpublic`).",
                            ""
                        ];
                        // What to tell the operator depends entirely on whether a
                        // create step ran in this process, and the caller is the
                        // only thing that knows. This warning used to assert that
                        // it had ("this runtime applies the collection schema at
                        // boot unless REBASE_MIGRATE_ON_BOOT=none") and send
                        // people to that variable and to driver-version skew. For
                        // an app whose boot path contained no provisioning step,
                        // both were dead ends: nothing read that variable, and the
                        // driver was current. Say which case this is instead of
                        // guessing, and say nothing when the caller is too old to
                        // tell us.
                        const cause = describeSchemaDriftCause(schemaProvisioning);
                        logger.warn([
                            "",
                            "⚠️  SCHEMA DRIFT — the database is missing tables this backend serves:",
                            ...lines,
                            "",
                            ...misplacedHelp,
                            ...cause,
                            "",
                            "  To apply this project's schema:",
                            "    • Managed cloud: the runtime creates tables and RLS at boot. `rebase db",
                            "      push` cannot reach a tenant's in-cluster database — redeploy instead.",
                            "    • Self-host: run `rebase db push` (dev) or `rebase db migrate` (prod)",
                            "      against DATABASE_URL.",
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
         * The cheapest round trip there is, run before boot's first real query.
         *
         * Boot provisions the collection schema *before* `initializeDriver`, so
         * the connection diagnosis above — the box naming the host, the port and
         * `docker compose up -d db` — never ran for the one failure it was
         * written for. A developer whose database was not running saw Drizzle's
         * `Failed query: [redacted]` and a stack through drizzle internals.
         *
         * Same diagnosis, one step earlier. Anything short of "the database
         * answered" is fatal here: provisioning is the next thing to happen and
         * it needs the connection, so continuing only moves the failure to a
         * frame with less to say about it.
         */
        async verifyConnection(driverResult?: InitializedDriver): Promise<void> {
            const db = provisioningDb(driverResult);
            // No handle to probe through is not a failure to report: an adapter
            // constructed without a `connection` is the case
            // `provisioningQueryable` already refuses, with a message about the
            // adapter rather than about the network.
            if (!db) return;
            try {
                await db.execute(sql`SELECT 1`);
            } catch (err: unknown) {
                throw diagnoseConnectFailure(err, pgConfig.connectionString)
                    ?? new Error(
                        `Cannot reach PostgreSQL at ${parseHostInfo(pgConfig.connectionString ?? "")} to provision the collection schema.`,
                        { cause: err }
                    );
            }
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
            driverResult?: InitializedDriver,
            log?: (message: string) => void
        ): Promise<{ applied: number }> {
            const { ensureCollectionTables } = await import("./schema/ensure-collection-tables");
            // Runs through the drizzle handle the driver already bootstrapped
            // with, so it uses exactly the connection and privileges that were
            // proven to work. Every statement is DDL or a catalogue read with no
            // bindable values (schema names are identifiers), and the module
            // validates them before they reach a string.
            const queryable = provisioningQueryable(driverResult);
            const plan = await ensureCollectionTables(
                queryable,
                collections as Parameters<typeof ensureCollectionTables>[1],
                log
            );
            for (const failure of plan.failures) {
                logger.warn(describeEnsureFailure(failure));
            }
            return { applied: plan.actions.length - plan.failures.length };
        },

        /**
         * Apply the collections' RLS policies — ENABLE ROW LEVEL SECURITY and the
         * `securityRules` compiled to `CREATE POLICY` — so a freshly provisioned
         * database serves data instead of denying every user-context read.
         *
         * The companion to {@link ensureCollectionSchema}: that creates the
         * tables, this makes them servable. Boot runs it *after* auth
         * initialization, because the generated policies call `rebase.uid()` /
         * `rebase.roles()`, and `CREATE POLICY` validates those functions exist.
         *
         * Runs through the same drizzle handle, one statement at a time (that
         * handle speaks the extended query protocol, which rejects multi-command
         * strings). Failures are per-table and non-fatal: a table left un-policed
         * stays RLS-enabled, so it denies rather than leaks.
         */
        /**
         * The helper functions every generated policy calls — `rebase.uid()`,
         * `rebase.roles()` and their siblings — on THIS database.
         *
         * On the default source they arrive with the auth tables, because auth
         * lives there. A second database (`database("analytics")`) has no auth
         * tables and used to have no helpers either, so every `CREATE POLICY`
         * on it failed and every user-context read was denied. Same statements
         * as the auth path and the migration preamble, from the same constant.
         */
        async ensureRlsRuntime(driverResult?: InitializedDriver): Promise<void> {
            const { RLS_BOOTSTRAP_STATEMENTS } = await import("./schema/rls-bootstrap-sql");
            const queryable = provisioningQueryable(driverResult);
            // One statement per call — this handle speaks the extended query
            // protocol, which rejects multi-command strings. Advisory-locked
            // for the same reason the auth path is: two instances booting
            // against one fresh database must not race on CREATE OR REPLACE.
            await queryable.query("SELECT pg_advisory_lock(hashtext('rebase_auth_functions_init'))");
            try {
                for (const statement of RLS_BOOTSTRAP_STATEMENTS) {
                    await queryable.query(statement);
                }
            } finally {
                await queryable.query("SELECT pg_advisory_unlock(hashtext('rebase_auth_functions_init'))");
            }
        },

        async ensureCollectionPolicies(
            collections: unknown[],
            driverResult?: InitializedDriver,
            log?: (message: string) => void
        ): Promise<{ applied: number }> {
            const { ensureCollectionPolicies } = await import("./schema/ensure-collection-policies");
            const queryable = provisioningQueryable(driverResult);
            const outcome = await ensureCollectionPolicies(
                queryable,
                collections as CollectionConfig[],
                log
            );

            for (const skip of outcome.skipped) {
                logger.warn(`🔐 [rls] Policies not applied to "${skip.table}": ${skip.reason}`);
            }
            for (const failure of outcome.failures) {
                logger.warn(
                    `🔐 [rls] Could not fully apply policies to "${failure.table}" — RLS is on, so it denies until this is resolved: ${failure.error}`
                );
            }

            // RLS could not be turned on at all. The schema-wide grant to the
            // user role has already run by this point, so without the revoke
            // below the table is readable and writable by every authenticated
            // request with no row filtering — the one state this boot path must
            // never leave behind, and the one it used to describe as "locked".
            const unrevoked = outcome.unsecured.filter(u => !u.grantWithdrawn);
            for (const u of outcome.unsecured.filter(u => u.grantWithdrawn)) {
                logger.error(
                    `🔐 [rls] Could not enable row-level security on "${u.table}": ${u.error}. ` +
                    `Its privileges have been revoked from ${REBASE_USER_ROLE}, so the table is ` +
                    "unreachable rather than unprotected. Reads and writes to that collection will " +
                    "fail until RLS can be enabled."
                );
            }
            if (unrevoked.length > 0) {
                // Neither securable nor closable. Serving here would mean
                // handing every authenticated caller unfiltered access, so the
                // boot fails instead — this is the one failure that is not
                // survivable per-table.
                throw new Error(
                    "Refusing to start: row-level security could not be enabled on " +
                    unrevoked.map(u => `"${u.table}" (${u.error})`).join(", ") +
                    `, and the privileges granted to ${REBASE_USER_ROLE} could not be revoked either. ` +
                    "The table would be served with no row filtering. Fix the database permissions " +
                    "(the connection role must own these tables, or be able to ALTER them) and boot again."
                );
            }

            // Retire the pre-1.0 `auth` schema now that the policies above no
            // longer call into it. Deliberately after, and deliberately quiet:
            // Postgres refuses to drop a function an RLS policy still
            // references, so on a database where some table has not been
            // recompiled yet this is expected to fail and succeed on a later
            // boot. See DROP_LEGACY_AUTH_SCHEMA_SQL for the guards that keep it
            // off a Supabase `auth` schema.
            try {
                const { dropLegacyAuthSchema } = await import("./schema/rls-bootstrap-sql");
                await dropLegacyAuthSchema(
                    async (text) => (await queryable.query<Record<string, unknown>>(text)).rows,
                    { info: (m) => logger.info(m), warn: (m) => logger.warn(m) }
                );
            } catch (err) {
                logger.info(
                    "Left the legacy `auth` schema in place: " +
                    (err instanceof Error ? err.message : String(err))
                );
            }

            return { applied: outcome.policiesApplied };
        },

        /**
         * Read what the last provisioning boot recorded, or `null`.
         *
         * The meta schema is `rebase` rather than the auth stamp's — see
         * `schema/collections-schema-version.ts` for why the two can differ.
         */
        async readCollectionsSchemaVersion(driverResult?: InitializedDriver): Promise<string | null> {
            const db = provisioningDb(driverResult);
            if (!db) return null;
            const { readCollectionsSchemaVersion } = await import("./schema/collections-schema-version");
            return readCollectionsSchemaVersion(db as never, SCHEMA_META_SCHEMA);
        },

        /** Record what this process just applied. Only the provisioning process calls this. */
        async stampCollectionsSchemaVersion(version: string, driverResult?: InitializedDriver): Promise<void> {
            const db = provisioningDb(driverResult);
            if (!db) return;
            const { stampCollectionsSchemaVersion } = await import("./schema/collections-schema-version");
            await stampCollectionsSchemaVersion(db as never, SCHEMA_META_SCHEMA, version);
        },

        /**
         * Ask the RLS question again, now that the schema exists.
         *
         * `initializeDriver` decides the posture before anything auth or
         * introspection creates, and on a genuinely fresh database the catalogue
         * has nothing to answer with: the role owns no tables, so it does not
         * bypass, so no role switch is configured — and then this very process
         * creates the tables and owns every one of them. Table owners bypass all
         * non-FORCE policies, so from that point on the process serves every
         * request unfiltered, for its whole lifetime, while the boot log records
         * that RLS was fine. The next restart sees the tables and quietly fixes
         * it, which is why the state is so easy to miss.
         *
         * This runs after provisioning and after auth has created its own tables,
         * and asks once more. Three outcomes:
         *
         * - a switch is already configured — nothing to do;
         * - the connection still owns nothing — the original answer held;
         * - the connection now owns tables — the answer has changed under us, so
         *   configure the switch, and if that is impossible, FAIL. A boot that
         *   crashes with the reason in its logs is recoverable. A boot that
         *   serves every row to everyone is not.
         */
        async finalizeSecurityPosture(driverResult: InitializedDriver): Promise<void> {
            const internals = driverResult.internals as PostgresDriverInternals;
            const { driver, realtimeService, registry, db } = internals;
            if (!db || driver.rlsUserRole) return;

            const runSql: RawSqlRunner = async (text) => {
                const res = await db.execute(sql.raw(text));
                return (res.rows ?? []) as Record<string, unknown>[];
            };

            const collectionSchemas = registry.getCollections()
                .map((c) => (c as { schema?: string }).schema)
                .filter((s): s is string => typeof s === "string");
            const managedSchemas = ["public", "rebase", ...collectionSchemas];

            const posture = await detectConnectionPosture(runSql, managedSchemas);
            // Only ownership matters here. `canCreateTables` was already weighed
            // at boot, and re-failing on it now would turn the tolerant branch
            // above into a hard failure by the back door.
            if (!posture.superuser && !posture.bypassRLS && !posture.ownsTables) return;

            try {
                await ensureAppRole(runSql, managedSchemas);
            } catch (err) {
                throw new Error(
                    `The database connection role "${posture.role}" now owns tables in this database, so it ` +
                    "bypasses every row-level security policy on them — but the restricted role it should " +
                    "switch to could not be provisioned, so authenticated requests would be served with no " +
                    `policy applied at all. Refusing to serve.\n\n${err instanceof Error ? err.message : String(err)}`
                );
            }

            driver.rlsUserRole = REBASE_USER_ROLE;
            realtimeService.rlsUserRole = REBASE_USER_ROLE;
            logger.info(
                `🔐 RLS enforcement active: the connection role "${posture.role}" became a table owner during ` +
                `this boot, so authenticated requests now run as "${REBASE_USER_ROLE}".`
            );
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
