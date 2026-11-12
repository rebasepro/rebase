/**
 * PostgresBootstrapper
 *
 * Implements the `BackendBootstrapper` interface for PostgreSQL.
 */

import { Relations, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { asRebasePgTable, type RebasePgTable } from "./types";
import {
    type AuthAdapter,
    BackendBootstrapper,
    BootstrappedAuth,
    DatabaseAdmin,
    type DataDriver,
    CollectionConfig,
    DEFAULT_DATA_SOURCE_KEY,
    isRelationalCollectionConfig,
    type HistoryConfig,
    InitializedDriver,
    type DatabaseAdapterInitConfig,
    RealtimeProvider,
    resourceEnvSuffix,
    type RealtimeChannelsConfig,
    type RealtimeSocketOptions,
    type CompiledTable,
    type TableDescriptor
} from "@rebasepro/types";
import { PostgresBackendDriver } from "./PostgresBackendDriver";
import { RealtimeService, parseMaxSocketsPerUser, parseMaxSubscriptionsPerSocket, parseRealtimeTuning } from "./services/realtimeService";
import { buildTableRegistry } from "./model/build-registry";
import { DatabasePoolManager } from "./databasePoolManager";
import { PostgresTableRegistry } from "./model/PostgresTableRegistry";
import { createEmailService, type EmailConfig, type EmailService, logger } from "@rebasepro/server";
import { compileDescribedTables, getTableName as getCollectionTableName, sqlRows } from "@rebasepro/common";
import { ensureAuthTablesExist } from "./auth/ensure-tables";
import { assertAuthSchemaCompatible, probeAuthSchema, resolveAuthSchema } from "./auth/schema-version";
import { AuthSchemaTables, PostgresAuthRepository, UserService } from "./auth/services";
import { createAuthSchema } from "./schema/auth-schema";
import { expectationOf, findUnusableAuthTables, unusableAuthTablesError, usersExpectation } from "./auth/verify-auth-tables";
import { HistoryService } from "./history/HistoryService";
import { ensureHistoryIndexes, ensureHistoryTableExists, historyUnavailableReason, readHistoryTableState } from "./history/ensure-history-table";
import { patchPgArrayNullSafety } from "./utils/pg-array-null-patch";
import { patchPgNumericToNumber } from "./utils/pg-numeric-number-patch";
import { introspectSchema, lowerIntrospectedTables } from "./schema/introspect-runtime";
import { introspectTables } from "./schema/introspect-tables";
import { buildBaasSchema, readCatalogueSchema } from "./schema/catalogue-schema";
import { diffGeneratedSchemaAgainstCatalogue, warnOnGeneratedSchemaDrift } from "./schema/generated-schema-diff";
import type { TableMeta } from "./schema/introspect-db-logic";
import { assertAppRoleRestricted, assertRecordedRequestRoles, detectConnectionPosture, ensureAppRole, ensureAppRoleGrants, ensureConnectionInheritsAdminRole, findExposedInternalTables, findOtherRoleMembers, findUngrantableTables, proveRoleSwitch, readRecordedRequestRoles, recordRequestRoles, revokeUserRoleSql, roleHoldsTableGrants, settleAdminSwitch, validatePolicyPgRoles, warnOnAnonymousGrants, warnOnLegacyRlsFunctions, warnOnRoleSchemaCollision, REBASE_USER_ROLE, type ManagedTable, type RawSqlRunner } from "./security/rls-enforcement";
import { resolveRlsSettings, rlsConfigFromEnv, rlsHandoverNotes, type PostgresRlsConfig, type RlsSettings } from "./security/rls-settings";
import { provisionTriggerCdc, removeTriggerCdc, settleInstalledCapture, type CdcTableRef } from "./services/cdc/trigger-cdc";
import { provisionWalPublication, reportUnpublishedTables, walCaptureBlocker } from "./services/cdc/wal-cdc";
import { collectJunctionLinks } from "./services/cdc/junction-tables";
import { tableKeyColumns } from "./services/cdc/identity-columns";
import { createChannelBus, resolveChannelBusSetting } from "./services/channel-bus";
import { declaredDatabaseRls, declaredRlsPolicyShape, isChannelBusInstance, isPostgresCollectionConfig } from "@rebasepro/types";
import { configureUnknownFilterFields, type UnknownFilterFieldsMode } from "./utils/drizzle-conditions";
import { isPooledPool, closeWithPool } from "./connection";
import { ReadRouter, readReplicaLagMs, readRoutingOptionsFromEnv, sameDatabaseTarget, type ReadRoutingOptions } from "./read-routing";
import { ensurePooledRoleDefaults } from "./pooled-database";

export interface PostgresDriverConfig {
    connectionString?: string;
    adminConnectionString?: string;
    /**
     * This database's read replica: reads are routed there, writes stay on
     * the primary. Unset, the boot ({@link postgresDriverConfigFromEnv}) fills
     * it from `DATABASE_READ_URL` for the default source only; any other
     * source has none unless its config names one — the managed runtime
     * resolves `DATABASE_READ_URL__<KEY>` into this for each source.
     */
    readConnectionString?: string;
    /**
     * A direct (non-pooled) URL to this database, for the connections that
     * hold a `LISTEN`: change capture, cross-instance realtime, the Postgres
     * channel bus and `admin.listen`. A transaction-mode pooler such as
     * PgBouncer does not keep a `LISTEN`, so behind one this has to name the
     * database itself.
     *
     * Unset, the boot fills it from `DATABASE_DIRECT_URL` for the default
     * source only, and any other source listens on its own
     * `connectionString` — see {@link resolveSourceUrls}. The managed runtime
     * resolves `DATABASE_DIRECT_URL__<KEY>` into this for each source.
     */
    directConnectionString?: string;
    /**
     * `connectionString` reaches the database through a transaction-mode
     * pooler (PgBouncer), as `DATABASE_POOLED=true` says for the default
     * source. Then nothing that needs a session runs on the pool: `LISTEN`s,
     * index builds and the SQL console go to {@link directConnectionString},
     * which becomes required — the boot refuses rather than holding a
     * `LISTEN` on the pooler, where it would go silent. The pool itself sends
     * no session settings at connect and sets them per transaction (see
     * `PostgresPoolConfig.pooled`). The read replica's URL is taken to be
     * pooled the same way.
     */
    pooled?: boolean;
    /**
     * The `DB_POOL_*` settings of this source, for the pools the driver opens
     * itself — the read replica's. The server's own pool already has them.
     */
    poolConfig?: { max?: number; idleTimeoutMillis?: number; connectionTimeoutMillis?: number };
    /**
     * How authenticated reads use the read replica: read-your-writes and the
     * lag guard. From `REBASE_READ_STICKY_MS` and `REBASE_READ_MAX_LAG_MS` at
     * boot; defaults 5000 and 1000. Ignored without a replica.
     */
    readRouting?: ReadRoutingOptions;
    connection?: unknown;
    /**
     * The project's generated Drizzle module, for **diagnostics only**.
     *
     * The tables this driver serves are read from `information_schema` at boot
     * (see `catalogue-schema.ts`); the only thing this is used for is telling
     * the developer that their committed `schema.generated.ts` no longer
     * describes the database, which still matters for Atlas, `db push`, `eject`
     * and any code importing it. Leaving it out costs the warning and nothing
     * else.
     */
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
     * Realtime options, among them:
     *
     *  - `channels` — retention. Without rules no channel keeps any history and
     *    broadcast stays fire-and-forget. See {@link ChannelRetentionRule}.
     *  - `bus` — the cross-instance transport for channel broadcast and
     *    presence. Defaults to in-process only, which is correct for a single
     *    instance and wrong for two. See {@link ChannelBusConfig}.
     *  - `cdc` — how changes are captured (`auto` by default).
     *
     * At boot each has an environment variable that wins over it — see
     * {@link postgresDriverConfigFromEnv}.
     */
    realtime?: RealtimeChannelsConfig;
    /**
     * What to do with a filter field that resolves to no column at all.
     * Defaults to `"error"` — a filter that cannot be compiled would otherwise
     * be dropped, and a dropped condition can only widen the result set.
     * Set to `"warn"` to restore the pre-fix behaviour of dropping it silently.
     */
    unknownFilterFields?: UnknownFilterFieldsMode;
    /**
     * The request role and everything around it — which role requests run as,
     * whether Rebase creates it, what it grants, whom policies target, which
     * session settings carry the caller. Every default is what Rebase did
     * before the setting existed; see {@link PostgresRlsConfig}. The
     * `REBASE_RLS_*` variables win over it at boot.
     */
    rls?: PostgresRlsConfig;
}

/**
 * Opaque internals bag that PostgresBootstrapper stores during `initializeDriver()`
 * and re-uses in subsequent lifecycle hooks.
 */
export interface PostgresDriverInternals {
    db: NodePgDatabase<any>;
    readDb?: NodePgDatabase<any>;
    registry: PostgresTableRegistry;
    realtimeService: RealtimeService;
    driver: PostgresBackendDriver;
    poolManager?: DatabasePoolManager;
    /**
     * Whether the driver was opened with provisioning (`provision`, default
     * true). The hooks that run after it — auth, history, the final security
     * posture — read it, so `provision: false` means no DDL anywhere on the
     * driver's path, not only while it opens.
     */
    provisioned: boolean;
    /** The resolved `rls` settings this driver was opened with. Absent reads as every default. */
    rls?: RlsSettings;
    /**
     * Whether this driver's admin switch is live (`settleAdminSwitch`): admin
     * requests run as `<request role>_admin` and the connection passes
     * `rebase_admin`. The policies step writes the server-or-admin policies
     * `TO rebase_admin` only then, and `TO public` otherwise. Absent reads as
     * not live.
     */
    adminPoliciesLive?: boolean;
    /**
     * Whether `rebase_admin_request` is the admin request roles' alone
     * (`settleAdminRequestGroup`), so the admin-only policies may have their
     * `USING (true)` companions and an admin request plans as the owner's.
     * Absent reads as not: no companions, and the policies step drops any.
     */
    adminRequestPoliciesLive?: boolean;
    /** The tables this driver serves, read from the registry when asked — for `grants: "managed"`. */
    managedTables?: () => ManagedTable[];
    /**
     * How authenticated requests are isolated on this connection, in one
     * line: run as the restricted role, or filtered natively.
     *
     * Returned rather than logged by {@link openPostgresDriver}. Announcing it
     * is the server boot's business — `initializeDriver` logs it at info — and
     * a script's `openRebase` logs it at debug, so a script's stdout holds what
     * the script prints.
     */
    rlsEnforcement?: string;
    /**
     * Attach CDC triggers to tables that did not exist when the driver
     * bootstrapped. Only set when database-level capture is actually active.
     *
     * Auth owns its own tables and creates them later in boot, so at driver
     * bootstrap they are legitimately missing and get skipped; without this
     * they would stay uninstrumented until the next restart.
     */
    provisionCdcForTables?: (tables: CdcTableRef[]) => Promise<void>;
    /**
     * Opened without provisioning: the framework's internal tables the
     * request role can reach, which a provisioning boot would have revoked.
     * Empty when there are none or requests do not run as that role. The
     * server's boot refuses on any; a script's `openRebase` only warns.
     */
    exposedInternalTables?: string[];
}

// Re-export from shared CLI error utilities
import { closedDatabaseName, deepestErrorMessage, diagnoseDbError, isEconnrefused, parseHostInfo } from "./cli-errors";
import { classifyConnectFailure, extractPgError } from "./utils/pg-error-utils";
import type { OpenIndexBuildSession, ScheduledIndexBuild } from "./schema/deferred-index-build";

/**
 * How long after the policies step the deferred index builds start: past the
 * rest of boot, so the server is listening by then.
 */
const DEFERRED_INDEX_BUILD_DELAY_MS = 5_000;

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
 * The relations the boot's drift check looks for a collection's table among.
 *
 * Deliberately unfiltered by schema: a table that is missing from where the
 * collection says it lives is very often sitting in another schema entirely
 * (see the misplaced-table report), and knowing *which* is the whole answer.
 *
 * Views as well as tables: a view collection serves a view of its own name (a
 * materialized one, a plain view over its stored rows), and reading only base
 * tables reported every one of them as missing on every boot.
 */
export const DRIFT_CHECK_RELATIONS_SQL = `
    SELECT table_name, table_schema
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND table_type IN ('BASE TABLE', 'VIEW')
`;

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
 * The URLs one source's driver opens besides its pool: the read replica, and
 * the direct connection its `LISTEN`s are held on.
 *
 * The bare `DATABASE_READ_URL` and `DATABASE_DIRECT_URL` belong to the default
 * source. Both used to be read here for every source, so a second database
 * (`database("analytics")`) held its change-capture `LISTEN` on the default
 * database — where none of its notifications are sent, so its realtime feed
 * was silent — and read through the default's replica. A keyed source gets
 * the URLs its config names, and otherwise its own connection and no replica.
 *
 * The default source still falls back to the environment: an application that
 * builds this adapter itself passes a `connectionString` and nothing else, and
 * has always had those two variables honoured.
 *
 * Exported for its own test; the caller needs a live database.
 */
export function resolveSourceUrls(
    pgConfig: Pick<PostgresDriverConfig, "connectionString" | "readConnectionString" | "directConnectionString" | "pooled">,
    sourceKey: string,
    env: Record<string, string | undefined> = process.env
): { readUrl?: string; directUrl?: string } {
    const isDefault = sourceKey === DEFAULT_DATA_SOURCE_KEY;
    return {
        readUrl: pgConfig.readConnectionString || (isDefault ? env.DATABASE_READ_URL : undefined) || undefined,
        directUrl: pgConfig.directConnectionString
            || (isDefault ? env.DATABASE_DIRECT_URL : undefined)
            // Behind a transaction-mode pooler the pool's own URL is the one
            // place a LISTEN must never go: the pooler accepts it and drops
            // it with the transaction. No fallback, so the caller refuses.
            || (pgConfig.pooled ? undefined : pgConfig.connectionString)
            || undefined
    };
}

/**
 * The refusal for a pooled source with no direct URL — named so the
 * control plane's log line and the self-hoster's both say what to set.
 */
export function pooledWithoutDirectUrlError(sourceKey: string): Error {
    const suffix = resourceEnvSuffix(sourceKey);
    return new Error(
        `DATABASE_POOLED${suffix}=true says DATABASE_URL${suffix} goes through a transaction-mode pooler, ` +
        `but DATABASE_DIRECT_URL${suffix} is not set. Realtime, the job queue's wake-up, index builds and the ` +
        "SQL console need a connection that keeps its session, which a transaction-mode pooler does not give. " +
        `Set DATABASE_DIRECT_URL${suffix} to the database itself (not the pooler), or unset DATABASE_POOLED${suffix}.`
    );
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
        case "rename-index":
            // An identical index was there under another name and could not
            // take the declared one's; the next step builds the declared
            // index beside it, so the table ends up with both.
            return (
                `🐢 [schema] Could not adopt an existing index on "${failure.target}" — the declared index is ` +
                `built beside it instead, and writes maintain both until one is dropped: ${failure.error}`
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

    // Closed to new connections: settled until someone opens it again, which
    // the banner says how to do.
    const closed = closedDatabaseName(err);
    if (closed) {
        logger.error(diagnoseDbError(err, url) ?? `❌ Database "${closed}" at ${hostInfo} is closed to new connections`);
        return new Error(
            `Database "${closed}" at ${hostInfo} is closed to new connections: ${reason}${detail}. ` +
            "Open it again with `rebase db branch list`.",
            { cause: err }
        );
    }

    // Every connection the server accepts is taken: SQLSTATE 53300, what
    // Postgres answers over its `max_connections` and what the managed
    // development database's proxy answers over its few. Not a database that
    // is down, so it says which, with the managed database's own remedy (its
    // refusal's hint) where it sent one. Not settled either: a connection may
    // free up, so a caller that can carry on still does.
    if (code === "53300") {
        const remedy = extractPgError(err)?.hint
            ?? "Close another client, cap this process's pool with REBASE_DB_POOL_MAX, or raise the server's max_connections.";
        logger.error(
            `\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `  ❌  PostgreSQL at ${hostInfo} has no free connection\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `\n` +
            `  ${reason}${detail}\n` +
            `\n` +
            `  ${remedy}\n` +
            `\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
        );
        return undefined;
    }

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

/** The capture modes `realtime.cdc` takes. */
const REALTIME_CDC_MODES = ["auto", "wal", "trigger", "off"] as const;
type RealtimeCdcMode = typeof REALTIME_CDC_MODES[number];

function isRealtimeCdcMode(value: string): value is RealtimeCdcMode {
    return REALTIME_CDC_MODES.some((mode) => mode === value);
}

/**
 * Read a capture mode, case and surrounding space aside. An unknown one is
 * `auto`, said out loud — a typo must not switch capture off.
 */
function parseRealtimeCdcMode(value: string, source: string): RealtimeCdcMode {
    const mode = value.trim().toLowerCase();
    if (isRealtimeCdcMode(mode)) return mode;
    logger.warn(`⚠️ [CDC] Unknown ${source} value "${mode}" — expected auto|wal|trigger|off. Defaulting to "auto".`);
    return "auto";
}

/**
 * `config` with the environment read into it, the way the server's boot reads
 * it. The one place this driver reads environment variables:
 *
 * | variable                               | setting                                |
 * |----------------------------------------|----------------------------------------|
 * | `DATABASE_READ_URL`                    | `readConnectionString`, when unset (*) |
 * | `DATABASE_DIRECT_URL`                  | `directConnectionString`, when unset (*)|
 * | `REALTIME_CDC`                         | `realtime.cdc`                         |
 * | `REALTIME_CHANNEL_BUS`                 | `realtime.bus` (a named transport)     |
 * | `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET`| `realtime.maxSubscriptionsPerSocket`   |
 * | `REALTIME_MAX_SOCKETS_PER_USER`        | `realtime.maxSocketsPerUser`           |
 * | `REALTIME_REFETCH_MAX_WAIT_MS`         | `realtime.refetchMaxWaitMs`            |
 * | `REALTIME_RECOUNT_INTERVAL_MS`         | `realtime.recountIntervalMs`           |
 * | `REALTIME_RECOUNT_MIN_ROWS`            | `realtime.recountMinRows`              |
 *
 * A `REALTIME_*` variable that is set wins over the option, so a deployment
 * can change it without a rebuild; the URLs fill in only what the config left
 * empty. A mistyped number throws, naming the variable.
 *
 * (*) For the default source only. The bare URL variables name the default
 * database; read for a second source (`database("analytics")`), they put its
 * change-capture `LISTEN` on the default database, where none of its
 * notifications arrive, and its reads on the default's replica. A keyed
 * source's URLs come from its own config — the managed runtime passes
 * `DATABASE_*_URL__<KEY>` there — see {@link resolveSourceUrls}.
 *
 * `createPostgresAdapter` applies this when the server boots, and
 * {@link openPostgresDriver} does not — a script that opens the driver itself
 * gets exactly the config it passed.
 */
export function postgresDriverConfigFromEnv(
    config: PostgresDriverConfig,
    env: NodeJS.ProcessEnv = process.env,
    sourceKey: string = DEFAULT_DATA_SOURCE_KEY
): PostgresDriverConfig {
    const read = (name: string): string | undefined => env[name]?.trim() || undefined;
    const realtime: RealtimeChannelsConfig = { ...config.realtime };

    const subscriptions = read("REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET");
    if (subscriptions) {
        realtime.maxSubscriptionsPerSocket = parseMaxSubscriptionsPerSocket(subscriptions, "REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET");
    }
    const sockets = read("REALTIME_MAX_SOCKETS_PER_USER");
    if (sockets) realtime.maxSocketsPerUser = parseMaxSocketsPerUser(sockets, "REALTIME_MAX_SOCKETS_PER_USER");
    const refetchMaxWaitMs = read("REALTIME_REFETCH_MAX_WAIT_MS");
    if (refetchMaxWaitMs) realtime.refetchMaxWaitMs = parseRealtimeTuning(refetchMaxWaitMs, "REALTIME_REFETCH_MAX_WAIT_MS", "milliseconds");
    const recountIntervalMs = read("REALTIME_RECOUNT_INTERVAL_MS");
    if (recountIntervalMs) realtime.recountIntervalMs = parseRealtimeTuning(recountIntervalMs, "REALTIME_RECOUNT_INTERVAL_MS", "milliseconds");
    const recountMinRows = read("REALTIME_RECOUNT_MIN_ROWS");
    if (recountMinRows) realtime.recountMinRows = parseRealtimeTuning(recountMinRows, "REALTIME_RECOUNT_MIN_ROWS", "rows");
    const cdc = read("REALTIME_CDC");
    if (cdc) realtime.cdc = parseRealtimeCdcMode(cdc, "REALTIME_CDC");
    realtime.bus = resolveChannelBusSetting(config.realtime?.bus, env);

    const isDefaultSource = sourceKey === DEFAULT_DATA_SOURCE_KEY;
    const readConnectionString = config.readConnectionString || (isDefaultSource ? read("DATABASE_READ_URL") : undefined);
    const directConnectionString = config.directConnectionString || (isDefaultSource ? read("DATABASE_DIRECT_URL") : undefined);
    const pooled = config.pooled ?? (isDefaultSource ? read("DATABASE_POOLED")?.toLowerCase() === "true" : undefined);
    // Unset, the driver uses the defaults; read here so a mistyped value throws at boot.
    const readRouting = config.readRouting
        ?? (read("REBASE_READ_STICKY_MS") || read("REBASE_READ_MAX_LAG_MS") ? readRoutingOptionsFromEnv(env) : undefined);
    const rls = rlsConfigFromEnv(config.rls, read);
    return {
        ...config,
        ...(rls ? { rls } : {}),
        ...(readConnectionString ? { readConnectionString } : {}),
        ...(directConnectionString ? { directConnectionString } : {}),
        ...(pooled ? { pooled } : {}),
        ...(readRouting ? { readRouting } : {}),
        realtime
    };
}

/**
 * Open the Postgres data driver from explicit settings.
 *
 * What `createPostgresAdapter` runs when the server boots, once it has read
 * the environment into `pgConfig` (see {@link postgresDriverConfigFromEnv});
 * this function reads no environment variable itself. `config` says what the
 * caller wants opened: which collections, whether opening may change the
 * database (`provision`, default true), and what part this process takes in
 * realtime (`realtime`, or `false` for none at all).
 *
 * `openRebase` is this with `provision: false` and `realtime: false`.
 */
export async function openPostgresDriver(
    pgConfig: PostgresDriverConfig,
    config: DatabaseAdapterInitConfig
): Promise<InitializedDriver & { internals: PostgresDriverInternals }> {
    const { collections, tables: declaredTables, introspectCollections, baas, schemaProvisioning, realtime } = config;
    // `false` keeps every DDL statement out of this open: the restricted
    // role, the branch table, channel-history tables, capture triggers.
    const provision = config.provision !== false;
    // `realtime: false` is a process that takes no part in realtime: nothing
    // installed, nothing consumed, its writes not announced.
    const realtimeOff = realtime === false;
    // Absent means a caller that predates the field, and every one of
    // those is a single process that both serves websockets and owns the
    // schema. Defaulting to false here would silently disable realtime
    // for them — the failure this whole area is prone to.
    const realtimeSubscribes = realtimeOff ? false : realtime?.subscribe ?? true;
    const realtimeProvisions = provision && !realtimeOff && (realtime?.provision ?? true);
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
    // Their descriptors, read from the catalogue: what the server serves at
    // `GET /api/schema/tables` for a project that declares no tables.
    let introspectedDescriptors: TableDescriptor[] | undefined;
    // The same tables compiled for the runtime: each descriptor as introspected,
    // beside the definition that states it. No hooks: nobody declared them.
    let introspectedCompiled: CompiledTable[] | undefined;
    // The tables skipped for having no authorization model, for the server to
    // name if it then has nothing to serve.
    let skippedUnprotected: { schema: string; table: string }[] | undefined;
    let introspectedTables: Record<string, PgTable> | undefined;
    let introspectedRelations: Record<string, Relations> | undefined;
    if (introspectCollections && (!collections || collections.length === 0)) {
        const pgSchemaName = pgConfig.introspectionSchema ?? "public";

        // ── Only serve what the database protects ────────────────
        // Requests run as rebase_user, which is granted DML on the
        // schema. A table with RLS disabled therefore has no
        // authorization model at all: serving it hands every row to
        // every authenticated user. baas never runs `db push`, so
        // nothing here would have enabled RLS on the user's behalf.
        // `introspectTables` leaves such a table out (with the SQL that
        // protects it) unless `unprotectedTables` is "serve".
        const introspected = await introspectTables(rawClient, pgSchemaName, { unprotectedTables });
        const policyless = introspected.tables
            .filter((t) => t.rls.rules.length === 0 && !t.rls.defaultPolicies)
            .map((t) => t.table);
        // Outside the skip because enabling RLS would not serve one: a join
        // table is never served, either way.
        const unprotectedJoinTables = introspected.junctions.filter((j) => !j.rlsEnabled).map((j) => j.table);

        if (introspected.unprotected.length > 0) {
            logger.warn(
                `🔓 [rls] Serving ${introspected.unprotected.length} table(s) with row-level security DISABLED: ${introspected.unprotected.join(", ")}. ` +
                "Every authenticated request can read and write every row of these. " +
                "This is baas.unprotectedTables: \"serve\"."
            );
        }
        if (introspected.skipped.length > 0) {
            const unprotected = introspected.skipped.map((s) => s.table);
            logger.warn(
                `🔒 [rls] Not serving ${unprotected.length} table(s) — row-level security is disabled, so they have no ` +
                `authorization model: ${unprotected.join(", ")}\n` +
                introspected.skipped.map((s) => s.remediationSql.split("\n").map((line) => `      ${line}`).join("\n")).join("\n") +
                "\n      To serve them without RLS anyway, pass baas: { unprotectedTables: \"serve\" } to the server " +
                "entry: an option `rebase eject` gives you, which the managed runtime does not read from backend/ or " +
                "the environment."
            );
            skippedUnprotected = unprotected.map((table) => ({ schema: pgSchemaName, table }));
        }
        if (unprotectedJoinTables.length > 0) {
            // Left out of the Drizzle schema below, so that serving no
            // descriptor for it is not the only thing keeping it from a
            // caller. The grants stay: a policy on a served table commonly
            // reads a join table in a subquery, which runs as the caller, so
            // revoking would turn every such read into "permission denied".
            const requestRoles = resolveRlsSettings({
                ...declaredDatabaseRls(config.dataSourceKey ?? DEFAULT_DATA_SOURCE_KEY),
                ...pgConfig.rls
            }).roles.join(", ");
            logger.warn(
                `🔒 [rls] ${unprotectedJoinTables.length} join table(s) have row-level security disabled: ` +
                `${unprotectedJoinTables.join(", ")}. The API does not serve a join table, with RLS or without, ` +
                `but ${requestRoles} keeps its grants on these, so SQL your own code runs as a caller reaches every row.`
            );
        }
        if (policyless.length > 0) {
            // Legal, and silently returns nothing — worth saying out loud,
            // since an empty table reads exactly like one with no rows.
            logger.warn(
                `🔒 [rls] ${policyless.length} table(s) have RLS enabled but no policies, so they will return no rows: ${policyless.join(", ")}`
            );
        }

        // The request-time collections, lowered from the descriptors at the
        // boundary a declared table crosses at boot.
        const lowered = lowerIntrospectedTables(introspected.tables);
        for (const { table, reason } of lowered.dropped) {
            logger.warn(`[PostgresRegistry] BaaS mode: not serving table "${table}": ${reason}`);
        }
        introspectedDescriptors = lowered.tables;
        introspectedCollections = lowered.collections;
        introspectedCompiled = compileDescribedTables(lowered.tables, { rls: () => "admin-only" });

        // The Drizzle tables the query layer reads, from the same catalogue:
        // the served tables and the protected join tables their relations
        // go through, keyed the way the collections above name their fields,
        // with relations derived from the foreign keys.
        const schema = await introspectSchema(rawClient, pgSchemaName);
        const keep = new Set([
            ...lowered.tables.map((t) => t.table),
            ...introspected.junctions.filter((j) => j.rlsEnabled).map((j) => j.table)
        ]);
        for (const table of [...schema.tablesMap.keys()]) {
            if (!keep.has(table)) schema.tablesMap.delete(table);
        }
        ({ tables: introspectedTables, relations: introspectedRelations } =
            buildBaasSchema(schema.tablesMap, pgSchemaName, introspectedDescriptors));
        logger.info(
            `🔍 [PostgresRegistry] BaaS mode: derived ${introspectedCollections.length} tables from schema "${pgSchemaName}" [${introspectedCollections.map(c => c.slug).join(", ")}]`
        );
    }

    // ── Declared collections: read the tables back from the database ──
    //
    // Every source, the default included. The bundle's generated Drizzle
    // module used to be authoritative here for the default source, and a
    // file one commit behind the database changed what the server did:
    // a renamed foreign-key column 500'd every request in production, a
    // property boot-ensure had already created answered 400
    // VALIDATION_UNKNOWN_FIELDS on first save, and relations the module
    // lacked went silently missing from list reads. Boot-ensure runs
    // before this, so `information_schema` is the current, complete
    // description of what is actually there — and it cannot drift from
    // itself. The module is now read only to tell the developer their
    // file is stale (`warnOnGeneratedSchemaDrift`, below).
    //
    // Restricted to the collections that are this source's, because the
    // driver is handed every collection the project declares and must
    // not go looking for the default's tables in the analytics database.
    // Without that filter the registry held no table for `events`, and
    // every routed write failed with "table not found" on a database
    // that had the table.
    let ownTables: Record<string, PgTable> | undefined;
    let ownRelations: Record<string, Relations> | undefined;
    let ownCatalogue: Map<string, TableMeta> | undefined;
    let ownDescriptors: TableDescriptor[] = [];
    const sourceKey = config.dataSourceKey ?? DEFAULT_DATA_SOURCE_KEY;
    if (!introspectedCollections && declaredTables && declaredTables.length > 0) {
        ownDescriptors = declaredTables
            .map(t => t.descriptor)
            .filter(d => (d.database ?? DEFAULT_DATA_SOURCE_KEY) === sourceKey);
        if (ownDescriptors.length > 0) {
            // Reading the catalogue is the first query this driver
            // issues, so it is the one that meets an unreachable
            // database — and the diagnosis that names the host, the
            // port and `docker compose up -d db` lives on the `SELECT
            // 1` further down, which would never be reached. Asked
            // here, in the same words, so a stopped database still says
            // so instead of failing inside the introspector.
            try {
                await rawClient.query("SELECT 1");
            } catch (err) {
                const fatal = diagnoseConnectFailure(err, pgConfig.connectionString);
                if (fatal) throw fatal;
            }
            const catalogue = await readCatalogueSchema({
                client: rawClient,
                tables: ownDescriptors,
                defaultSchema: pgConfig.introspectionSchema ?? "public"
            });
            ownTables = catalogue.tables;
            ownRelations = catalogue.relations;
            ownCatalogue = catalogue.meta;
            if (catalogue.missing.length > 0) {
                logger.warn(
                    `[PostgresRegistry] Data source "${sourceKey}" has no table yet for: ${catalogue.missing.join(", ")}. ` +
                    "Their collections will answer \"table not found\" until the schema is provisioned."
                );
            }
        }
    }

    const activeCollections = introspectedCollections ?? collections;
    const schemaTables = introspectedTables ?? ownTables;
    const schemaRelations = introspectedRelations ?? ownRelations;

    // The one remaining reader of the generated module: a warning per
    // difference, and no effect on anything served. Wrapped because a
    // diagnostic must never be the reason a server does not start.
    if (ownCatalogue) {
        try {
            warnOnGeneratedSchemaDrift(diffGeneratedSchemaAgainstCatalogue({
                generated: pgConfig.schema?.tables,
                catalogue: ownCatalogue,
                tables: ownDescriptors
            }));
        } catch (err) {
            logger.debug("[schema] Could not compare schema.generated.ts against the database", { error: err });
        }
    }

    // Create a fresh registry for this driver. Registration order is
    // load-bearing, so it lives in one place — see `buildTableRegistry`.
    //
    // No enums: a catalogue-built enum column is `text`, which is what a
    // generated `pgEnum` column served anyway (drizzle validates no
    // labels; Postgres does), and nothing reads the registry's enum map.
    const registry = buildTableRegistry({
        compiledTables: introspectedCompiled ?? declaredTables ?? [],
        collections: activeCollections,
        tables: schemaTables,
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

    // ── Which collections are THIS database's? ────────────────────────
    //
    // The driver is handed every collection the project declares —
    // relations resolve across sources, and the API routes by slug — but
    // three passes below speak about this database and only this one:
    // the change-capture attach, the drift check and the RLS/grants
    // pass. Reading the registry unfiltered made a second source
    // (`database("analytics")`) report the default's tables as SCHEMA
    // DRIFT, try to attach CDC triggers to tables it does not hold, and
    // validate the default's policies against its own catalogue. Same
    // rule as the table read-back above.
    //
    // In BaaS mode the registry holds what THIS database was introspected
    // for, so every registered collection is already this source's.
    const introspectedHere = Boolean(introspectedCollections);
    const collectionsOnThisSource = (): CollectionConfig[] => {
        const all = registry.getCollections() as CollectionConfig[];
        if (introspectedHere) return all;
        return all.filter(c => c.dataSource === sourceKey || (!c.dataSource && sourceKey === DEFAULT_DATA_SOURCE_KEY));
    };

    // Create services
    const realtimeService = new RealtimeService(schemaAwareDb, registry);
    // The per-socket subscription ceiling. Checked here, before anything
    // else boots: a ceiling someone set and mistyped must not quietly
    // become another number.
    if (pgConfig.realtime?.maxSubscriptionsPerSocket !== undefined) {
        realtimeService.maxSubscriptionsPerSocket = parseMaxSubscriptionsPerSocket(
            pgConfig.realtime.maxSubscriptionsPerSocket, "realtime.maxSubscriptionsPerSocket"
        );
    }
    // How long a change may wait for its refetch, and how often a big
    // list is recounted. Unset, both are what they always were.
    const tuning = (option: number | undefined, optionName: string, unit: string): number | undefined =>
        option !== undefined ? parseRealtimeTuning(option, optionName, unit) : undefined;
    const refetchMaxWaitMs = tuning(pgConfig.realtime?.refetchMaxWaitMs, "realtime.refetchMaxWaitMs", "milliseconds");
    if (refetchMaxWaitMs !== undefined) realtimeService.refetchMaxWaitMs = refetchMaxWaitMs;
    realtimeService.recountIntervalMs = tuning(pgConfig.realtime?.recountIntervalMs, "realtime.recountIntervalMs", "milliseconds");
    const recountMinRows = tuning(pgConfig.realtime?.recountMinRows, "realtime.recountMinRows", "rows");
    if (recountMinRows !== undefined) realtimeService.recountMinRows = recountMinRows;

    // This source's own replica and direct URL, never the default's. No
    // environment here: the boot read it into `pgConfig` already, for the
    // default source only (see postgresDriverConfigFromEnv).
    // Pooled by the config (DATABASE_POOLED) or by the pool the server
    // opened for it: either way nothing session-scoped may run on it.
    const pooled = pgConfig.pooled === true || isPooledPool(rawClient);
    const { readUrl, directUrl } = resolveSourceUrls({ ...pgConfig, pooled }, sourceKey, {});
    if (pooled && !directUrl) throw pooledWithoutDirectUrlError(sourceKey);
    const primaryUrl = pgConfig.connectionString
        || (rawClient && typeof rawClient === "object" && "options" in rawClient ? rawClient.options.connectionString : undefined);

    // The read replica, when DATABASE_READ_URL names another server. Compared
    // as database targets, not as strings: the primary's URL carries the
    // pinned search_path, so a read URL naming the primary never equalled it
    // and a second pool to the primary was opened and never used.
    let readDb: import("drizzle-orm/node-postgres").NodePgDatabase<any> | undefined;
    let readRouter: ReadRouter<import("drizzle-orm/node-postgres").NodePgDatabase<any>> | undefined;
    let readPool: import("pg").Pool | undefined;
    if (readUrl && !(primaryUrl && sameDatabaseTarget(readUrl, primaryUrl))) {
        try {
            const { createReadReplicaConnection } = await import("./connection");
            const readResources = createReadReplicaConnection(readUrl, mergedSchema, { ...pgConfig.poolConfig, pooled });
            readDb = readResources.db;
            readPool = readResources.pool;
            readRouter = new ReadRouter(readDb, () => readReplicaLagMs(readResources.pool), pgConfig.readRouting ?? readRoutingOptionsFromEnv({}));
            readRouter.start();
            logger.info(
                `📖 [PostgresBootstrapper] Authenticated reads may use the read replica ` +
                `(read-your-writes ${readRouter.stickyMs} ms, lag limit ${readRouter.maxLagMs} ms)`
            );
        } catch (err) {
            logger.warn("⚠️ Could not connect to read replica, falling back to primary for all queries", { error: err });
        }
    }

    // A session of its own, for the SQL console, behind a pooler: on the
    // direct URL, small, and closed when idle — the console is used rarely,
    // and every connection here counts against the database's direct budget.
    let sessionDb: import("drizzle-orm/node-postgres").NodePgDatabase<any> | undefined;
    let sessionPool: import("pg").Pool | undefined;
    if (pooled && directUrl) {
        const { createDirectDatabaseConnection } = await import("./connection");
        const session = createDirectDatabaseConnection(directUrl, undefined, { max: 3, idleTimeoutMillis: 10_000 });
        sessionDb = session.db;
        sessionPool = session.pool;
    }

    // Branching and cross-database SQL hold session advisory locks and run
    // CREATE DATABASE: the admin URL, else the direct one. An admin URL that
    // is just the pooled URL again (what a server that predates
    // DATABASE_POOLED passes) is replaced by the direct URL.
    const adminUrl = pooled && directUrl && pgConfig.adminConnectionString && primaryUrl
        && sameDatabaseTarget(pgConfig.adminConnectionString, primaryUrl)
        ? directUrl
        : pgConfig.adminConnectionString;
    const poolManager = adminUrl ? new DatabasePoolManager(adminUrl) : undefined;

    // The pools above are this driver's own, and nothing outside it knows
    // to close them. The server closes the pool it opened; they close with it.
    closeWithPool(rawClient, async () => {
        readRouter?.stop();
        await Promise.allSettled([
            readPool?.end(),
            sessionPool?.end(),
            poolManager?.shutdown()
        ]);
    });

    const driver = new PostgresBackendDriver(schemaAwareDb, realtimeService, registry, undefined, poolManager);
    driver.listenConnectionString = directUrl;
    driver.sessionDb = sessionDb;
    driver.readRouter = readRouter;

    // Behind a pooler, the role's default search_path is what an unqualified
    // statement outside a transaction resolves with — see
    // `ensurePooledRoleDefaults`.
    if (pooled && directUrl) {
        await ensurePooledRoleDefaults(rawClient, directUrl, { provision });
    }
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
    let rlsEnforcement: string | undefined;
    let exposedInternalTables: string[] | undefined;
    /** Set where the admin switch is settled; see {@link PostgresDriverInternals.adminPoliciesLive}. */
    let adminPoliciesLive = false;
    /** Set where the admin switch is settled; see {@link PostgresDriverInternals.adminRequestPoliciesLive}. */
    let adminRequestPoliciesLive = false;
    // The `rls` escape hatches, decided once: the database declaration, the
    // driver's own block over it, and the environment over both (folded into
    // the driver's block by `postgresDriverConfigFromEnv`). Every default is
    // what Rebase did before.
    const rls = resolveRlsSettings({ ...declaredDatabaseRls(sourceKey), ...pgConfig.rls });
    // The two policy settings change the SQL `rebase db generate` writes, and
    // the CLI sees the declaration and the environment but never the driver's
    // code. Set only there, the boot and the CLI would compile different
    // policies and correct each other forever.
    const policyShape = declaredRlsPolicyShape(sourceKey);
    if (rls.policyTarget !== policyShape.policyTarget || rls.defaultPolicies !== policyShape.defaultPolicies
        || rls.adminPolicies !== policyShape.adminPolicies) {
        throw new Error(
            "rls.policyTarget, rls.adminPolicies and rls.defaultPolicies shape the policy SQL that `rebase db generate` " +
            "writes, and the CLI cannot see the driver's code. Declare them on the database instead — " +
            `database({ rls: { policyTarget: "${rls.policyTarget}", adminPolicies: "${rls.adminPolicies}", defaultPolicies: ${rls.defaultPolicies} } }) — ` +
            "or set REBASE_RLS_POLICY_TARGET / REBASE_RLS_ADMIN_POLICIES / REBASE_RLS_DEFAULT_POLICIES."
        );
    }
    /** The tables this driver serves — collections, junctions — for `grants: "managed"`. */
    const managedTables = (): ManagedTable[] => registry.getPgTableNames().flatMap((name) => {
        const table = registry.getPgTable(name);
        if (!table) return [];
        const config = getTableConfig(table);
        return [{ schema: config.schema ?? "public", table: config.name }];
    });
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
            const roleList = rls.roles.map((r) => `"${r}"`).join(", ");
            let switched = true;
            if (!provision) {
                // Nothing is created here, so the switch is to a role an
                // earlier boot made. A connection that bypasses RLS switches
                // whether or not it exists: a user's request then fails on
                // the missing role, where not switching would run it with
                // no policy applied. One that does not bypass yet is filtered
                // natively and switches only when there is a role to use.
                const existing = await runSql(
                    `SELECT rolname FROM pg_roles WHERE rolname = ANY(ARRAY[${rls.roles.map((r) => `'${r}'`).join(", ")}]::text[])`
                );
                const roleExists = existing.length === rls.roles.length;
                switched = roleExists || bypassesNow;
                if (roleExists) {
                    // Adopted as found, so checked as found: a role that
                    // bypasses RLS, or one this connection cannot switch to,
                    // or one this database does not record as its own, is
                    // refused here rather than on every request. Nothing
                    // here writes.
                    try {
                        assertRecordedRequestRoles(
                            rls.roles,
                            await readRecordedRequestRoles(runSql),
                            await roleHoldsTableGrants(runSql, managedSchemas)
                        );
                        for (const role of rls.roles) {
                            await assertAppRoleRestricted(runSql, role);
                            await proveRoleSwitch(runSql, managedSchemas, posture.role, role);
                        }
                    } catch (err) {
                        if (bypassesNow) throw err;
                        switched = false;
                        logger.warn(
                            `⚠️ RLS enforcement: connection role "${posture.role}" owns no tables yet and is ` +
                            `subject to RLS, so requests are served without the switch: ` +
                            `${err instanceof Error ? err.message : String(err)}`
                        );
                    }
                    for (const role of rls.roles) {
                        const exposed = await findExposedInternalTables(runSql, managedSchemas, role);
                        if (exposed.length === 0) continue;
                        exposedInternalTables = [...(exposedInternalTables ?? []), ...exposed];
                        logger.warn(
                            `⚠️ RLS enforcement: the request role "${role}" can reach framework tables no ` +
                            `user should: ${exposed.join(", ")}. A provisioning boot revokes this; ` +
                            "this driver was opened without provisioning, so nothing does."
                        );
                    }
                }
                if (!roleExists && bypassesNow) {
                    logger.warn(
                        `⚠️ RLS enforcement: connection role "${posture.role}" bypasses row-level security and the ` +
                        `restricted role ${roleList} does not exist yet — this driver was opened without ` +
                        "provisioning, so it was not created. Requests made as a user will fail until a server " +
                        "boot (or `rebase db push`) creates it; requests as the connection itself are unaffected."
                    );
                }
            } else {
                try {
                    // Recorded before anything is granted: every store's
                    // revoke on its own tables reads this record to know whom
                    // to take them back from.
                    const recorded = await readRecordedRequestRoles(runSql);
                    assertRecordedRequestRoles(rls.roles, recorded, await roleHoldsTableGrants(runSql, managedSchemas));
                    // Nothing recorded reads as the default role, so the
                    // default is not written: that would create the `rebase`
                    // schema at connect, before provisioning owns it.
                    const differs = recorded
                        ? recorded.join(",") !== rls.roles.join(",")
                        : rls.roles.join(",") !== REBASE_USER_ROLE;
                    if (differs) await recordRequestRoles(runSql, rls.roles);
                    for (const role of rls.roles) {
                        await ensureAppRole(runSql, managedSchemas, {
                            role,
                            provisionRole: rls.provisionRole,
                            grants: rls.grants,
                            managedTables: managedTables(),
                            inheritRoles: rls.inheritTo.includes(role) ? rls.inheritRoles : []
                        });
                    }
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
            }

            if (switched) {
                // Admin requests switch to `<role>_admin` once those roles are
                // ready (`rls.adminPolicies: "adminRole"`); the connection
                // inherits `rebase_admin` for the tables it does not own. Only
                // when all of it holds do the policies go TO rebase_admin.
                const settled = await settleAdminSwitch(runSql, managedSchemas, rls, { provision });
                const request = settled.request;
                adminPoliciesLive = settled.adminPoliciesLive;
                adminRequestPoliciesLive = settled.adminRequestPoliciesLive;
                driver.rlsUserRole = rls.defaultRole;
                realtimeService.rlsUserRole = rls.defaultRole;
                driver.rlsRequest = request;
                realtimeService.rlsRequest = request;
                const why = posture.superuser
                    ? "superuser"
                    : posture.bypassRLS
                        ? "BYPASSRLS"
                        : posture.ownsTables
                            ? "table owner"
                            : "may create (and would then own) tables in the schemas it serves";
                rlsEnforcement = `🔐 RLS enforcement active: authenticated requests run as ${roleList} (connection "${posture.role}" bypasses RLS: ${why})` +
                    (rls.nonDefaults.length > 0 ? `; rls: ${rls.nonDefaults.join(", ")}` : "");
                for (const note of rlsHandoverNotes(rls)) logger.info(`🔐 [rls] ${note}`);

                for (const role of [...rls.roles, ...rls.adminRoles.values()]) {
                    // Another login that can become this role passes this
                    // database's policies as anyone: the settings they read are
                    // settable by any session. Roles belong to the cluster, so
                    // this is what two projects sharing one looks like.
                    if (rls.sharedRole === "ignore") break;
                    const others = await findOtherRoleMembers(runSql, role);
                    if (others.length === 0) continue;
                    const message =
                        `The request role "${role}" can also be used by ${others.map((o) => `"${o}"`).join(", ")}, ` +
                        "which can connect to this database, switch into it, and pass its policies as whichever user it likes. " +
                        "Give this project a role of its own (rls.requestRole / REBASE_RLS_REQUEST_ROLE, then " +
                        "`rebase db request-role migrate`), revoke CONNECT on this database from PUBLIC, or set " +
                        "rls.sharedRole to \"ignore\" if the role is shared on purpose.";
                    if (rls.sharedRole === "refuse") throw new Error(`Refusing to serve: ${message}`);
                    logger.warn(`⚠️ RLS enforcement: ${message}`);
                }

                for (const role of rls.roles) {
                    const ungrantable = await findUngrantableTables(runSql, collectionsOnThisSource()
                        .map((c) => ({ schema: (c as { schema?: string }).schema ?? "public", table: getCollectionTableName(c) }))
                        .filter((t) => Boolean(t.table)), role);
                    if (ungrantable.length === 0) continue;
                    logger.warn(
                        `⚠️ RLS enforcement: requests run as "${role}", which holds no privilege on ` +
                        `${ungrantable.length === 1 ? "this table" : "these tables"}, and connection "${posture.role}" ` +
                        "cannot grant one because another role owns them. Every request to them will be refused " +
                        "until the owner runs the grant:\n" +
                        ungrantable.map((t) => `  ${t.name} (owner "${t.owner}"): ${t.grant}`).join("\n")
                    );
                }
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
            rlsEnforcement = `🔐 RLS enforcement: connection role "${posture.role}" is subject to RLS natively; no role switch needed.`;
            // Requests run as the connection itself, so its server context and
            // its admin requests pass the server-or-admin policies only through
            // `rebase_admin` — what `TO public` used to give it. They stay TO
            // public here (`adminPoliciesLive` false): every request is this
            // connection, so `TO rebase_admin` would narrow nothing, and no
            // admin request role is settled for `db push` or `doctor` to see.
            if (rls.adminPolicies === "adminRole") await ensureConnectionInheritsAdminRole(runSql, { provision });
        }
        if (!driver.rlsUserRole && rls.policyTarget === "requestRole") {
            // Requests run as the connection role itself, which is not a
            // request role, so every policy narrowed to the request roles would
            // deny every row. Said now rather than read as an empty database.
            throw new Error(
                `rls.policyTarget is "requestRole", but requests are not switching to a request role here ` +
                `(connection "${posture.role}" is ${posture.privileged ? "not able to switch" : "subject to RLS natively"}), ` +
                "so every policy would deny every row. Use policyTarget \"public\" with this connection, or connect " +
                "as a role that owns the tables so requests switch."
            );
        }

        // Independent of posture: a policy targeting a role the request
        // never runs as filters every row, so the collection reads as
        // empty rather than erroring. Applies to both branches — the
        // role that matters is whichever one requests actually use.
        await validatePolicyPgRoles(
            runSql,
            collectionsOnThisSource(),
            driver.rlsUserRole ? rls.roles : posture.role
        );

        // The same habit one surface over, and the dangerous direction:
        // a rule that reads as "signed in only" but is true for every
        // caller grants the data away rather than hiding it.
        warnOnAnonymousGrants(collectionsOnThisSource());

        // Raw policy SQL written against the pre-1.0 helper schema. It
        // is rewritten on compile, so this is the only place the project
        // is ever told the spelling moved.
        warnOnLegacyRlsFunctions(collectionsOnThisSource());
    }

    // Ensure branch metadata table exists when branching is available
    if (provision && driver.branchService) {
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
        if (!realtimeOff) {
            await realtimeService.configureChannelHistory(
                pgConfig.realtime?.channels,
                { provision: realtimeProvisions }
            );
        }
    } catch (err) {
        logger.warn("⚠️ Could not initialize channel history tables — retained channels will not replay", { error: err });
    }

    // ── Realtime change source ───────────────────────────────────────
    // A direct URL bypasses PgBouncer, which does not keep a LISTEN.
    // `directUrl` (resolved above) bypasses PgBouncer for LISTEN/NOTIFY.

    // ── Cross-instance channel bus ───────────────────────────────────
    // Entity changes already span instances (CDC / LISTEN below).
    // Channel broadcast and presence did not — they lived in per-process
    // maps, so behind two replicas the clients of one were invisible to
    // the other. Opt-in, and a no-op when left at "memory".
    try {
        const busSetting = pgConfig.realtime?.bus ?? { type: "memory" };
        // A supplied instance is always installed; a named built-in only
        // when it is not the in-process default, so the common case
        // touches none of this machinery.
        const wantsBus = !realtimeOff && (isChannelBusInstance(busSetting) || busSetting.type !== "memory");
        if (wantsBus) {
            await realtimeService.configureChannelBus(
                createChannelBus(busSetting, {
                    db: schemaAwareDb as NodePgDatabase<Record<string, unknown>>,
                    directUrl
                }),
                // The roster table is the framework's, like `api_keys`: made by
                // whichever process provisions, whatever its realtime part.
                { provision }
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
    // `realtime.cdc` (`REALTIME_CDC` at boot):
    //   auto     → default: enable where the connection supports it;
    //              silently fall back to app-level otherwise
    //   trigger  → force trigger-based capture (warns if it can't)
    //   wal      → prefer WAL logical replication (degrades to trigger)
    //   off      → app-level realtime only
    const cdcMode = parseRealtimeCdcMode(pgConfig.realtime?.cdc ?? "auto", "realtime.cdc");

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
    const cdcRunSql: RawSqlRunner = async (text) => {
        const res = await schemaAwareDb.execute(sql.raw(text));
        return (res.rows ?? []) as Record<string, unknown>[];
    };
    /** Whether this boot left the trigger function at the current body. */
    let cdcFunctionCurrent = false;

    if (wantsCdc && !directUrl) {
        const reason = "no direct database connection is available for the realtime LISTEN client " +
            `(set DATABASE_DIRECT_URL${resourceEnvSuffix(sourceKey)})`;
        if (explicitCdc) logger.warn(`⚠️ [CDC] REALTIME_CDC=${cdcMode} but ${reason} — using app-level realtime.`);
        else logger.info(`ℹ️ [CDC] Using app-level realtime — ${reason}.`);
    } else if (wantsCdc && directUrl) {
        // Each table is captured with the columns its rows are addressed
        // by, and a change carries those and nothing else — any login can
        // LISTEN. See `buildCdcFunctionSql`.
        const cdcTables: CdcTableRef[] = collectionsOnThisSource()
            // A view has no rows of its own to capture: its tables' do.
            .filter((c) => !(isPostgresCollectionConfig(c) && c.view))
            .map((c) => ({
                schema: (c as { schema?: string }).schema ?? "public",
                table: getCollectionTableName(c),
                identityColumns: tableKeyColumns(registry.requireTable(c.slug)).map((k) => k.columnName)
            }))
            .filter((t) => Boolean(t.table) && registry.hasPgTable(t.table));
        // Junction tables back no collection, so the list above misses
        // them — and a link or unlink is a write nobody would hear
        // about. Their rows are the contents of a child list, which is
        // as much a change as a write to the rows themselves.
        // Filtered by the parent's source for the same reason as the
        // list above: `posts_tags` lives in the database `posts`
        // lives in, and asking a second database to instrument it
        // produced one "Could not attach change-capture trigger"
        // warning per junction on every boot.
        const ownSlugs = new Set(collectionsOnThisSource().map(c => c.slug));
        for (const link of collectJunctionLinks(registry)) {
            if (!ownSlugs.has(link.parentSlug)) continue;
            // A junction row is addressed by the two ids that name
            // the child list it belongs to, whatever its own key is.
            cdcTables.push({
                schema: link.schema,
                table: link.table,
                identityColumns: [link.sourceColumn, link.targetColumn]
            });
        }

        // REALTIME_CDC=wal reads changes from the write-ahead log, so a
        // write pays for no trigger and no NOTIFY — whose commit-time lock
        // makes notifying transactions commit one at a time, disk flush
        // included (tooling/scripts/bench-cdc-notify.mts). Whatever is in
        // the way — wal_level, a role that may not replicate, no free slot
        // — falls through to trigger capture below.
        let walActive = false;
        if (cdcMode === "wal") {
            try {
                const blocker = await walCaptureBlocker(cdcRunSql);
                if (blocker) throw new Error(blocker);
                if (realtimeProvisions) reportUnpublishedTables(await provisionWalPublication(cdcRunSql, cdcTables));
                if (realtimeSubscribes) await realtimeService.enableWalCdc(directUrl, cdcTables);
                walActive = true;
            } catch (err) {
                logger.warn(
                    "⚠️ [CDC] REALTIME_CDC=wal, but changes cannot be streamed from the WAL — using trigger-based capture instead.",
                    { detail: err instanceof Error ? err.message : String(err) }
                );
            }
        }

        if (walActive) {
            cdcEnabled = true;
            if (realtimeProvisions && realtimeSubscribes) {
                // This process streams the WAL, so the capture triggers now
                // only cost every write a trigger and a NOTIFY: they come off,
                // as with REALTIME_CDC=off. An instance still running trigger
                // capture stops hearing writes made elsewhere until it is
                // replaced; its own writes still reach its subscribers.
                try {
                    const removed = await removeTriggerCdc(cdcRunSql);
                    cdcFunctionCurrent = true;
                    if (removed > 0) {
                        logger.info(`ℹ️ [CDC] Removed ${removed} change-capture trigger(s): this process streams changes from the WAL instead.`);
                    }
                } catch (err) {
                    logger.warn(
                        "⚠️ [CDC] Could not remove the change-capture triggers, so every write still runs one and a NOTIFY. The next boot tries again.",
                        { detail: err instanceof Error ? err.message : String(err) }
                    );
                }
                provisionCdcForTables = async (tables) => {
                    reportUnpublishedTables(await provisionWalPublication(cdcRunSql, tables));
                };
            } else if (realtimeProvisions) {
                // Provisioning alone: the consumers are other processes, and
                // whether each can stream is for it to find out. One that
                // cannot falls back to LISTEN, so the triggers stay for it.
                try {
                    await provisionTriggerCdc(cdcRunSql, cdcTables);
                    cdcFunctionCurrent = true;
                } catch (err) {
                    logger.warn(
                        "⚠️ [CDC] Could not attach the change-capture triggers a consumer that cannot stream the WAL would fall back to.",
                        { detail: err instanceof Error ? err.message : String(err) }
                    );
                }
                provisionCdcForTables = async (tables) => {
                    reportUnpublishedTables(await provisionWalPublication(cdcRunSql, tables));
                    await provisionTriggerCdc(cdcRunSql, tables);
                };
            }
            logger.info(
                "📡 [CDC] Realtime source = database-level change capture (mode: wal). " +
                "All writes now emit realtime events regardless of origin." +
                (realtimeSubscribes ? "" : " This process sets up the capture but does not consume it.")
            );
        } else {
            try {
                // Provisioning throws only when the connection can't create the
                // trigger function (insufficient privilege); enableCdc throws when
                // the LISTEN connection can't be established. Either → fall back.
                if (realtimeProvisions) {
                    await provisionTriggerCdc(cdcRunSql, cdcTables);
                    cdcFunctionCurrent = true;
                }
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
                    // Handled — realtime carries on, app-level — so one line with
                    // the reason, not a stack.
                    logger.warn(
                        "⚠️ [CDC] Could not enable database-level change capture — falling back to app-level realtime.",
                        { detail: err instanceof Error ? err.message : String(err) }
                    );
                } else {
                    logger.info(
                        "ℹ️ [CDC] Database-level change capture unavailable (likely insufficient privileges to create triggers, " +
                        "or the LISTEN connection was refused) — using app-level realtime. Set REALTIME_CDC=off to silence this.",
                        { detail: err instanceof Error ? err.message : String(err) }
                    );
                }
            }
        }
    }

    // Triggers an earlier boot attached keep firing whether or not this
    // one provisions capture. With capture switched off they are taken
    // off the tables: each write ran one and announced itself on a
    // channel nothing listens to. Otherwise (capture wanted, not
    // installed this boot) a function from a version that sent whole
    // rows is replaced — any login can LISTEN to what it sends. Nothing
    // is installed here either way.
    if (realtimeProvisions && !cdcFunctionCurrent) {
        const capture = cdcMode === "off" ? "off" : "not-provisioned";
        try {
            const settled = await settleInstalledCapture(cdcRunSql, { capture });
            if ("removed" in settled && settled.removed > 0) {
                logger.info(
                    `ℹ️ [CDC] REALTIME_CDC=off: removed the change-capture triggers an earlier boot attached ` +
                    `(${settled.removed}). Realtime is app-level; unset REALTIME_CDC to capture changes again.`
                );
            }
        } catch (err) {
            logger.warn(
                capture === "off"
                    ? "⚠️ [CDC] REALTIME_CDC=off, but the change-capture triggers an earlier boot attached could not be " +
                      "removed; they keep firing on every write. Remove them with " +
                      "`DROP FUNCTION rebase.rebase_cdc_notify() CASCADE; DROP FUNCTION rebase.rebase_cdc_notify_statement() CASCADE`."
                    : "⚠️ [CDC] A change-capture trigger function from an earlier boot is installed and could not be " +
                      "brought up to date. Older versions of it send every changed row on a channel any database " +
                      "login can LISTEN to; if capture is not wanted, set REALTIME_CDC=off, or remove it with " +
                      "`DROP FUNCTION rebase.rebase_cdc_notify() CASCADE`.",
                { detail: err instanceof Error ? err.message : String(err) }
            );
        }
    }

    // Legacy cross-instance realtime (app-level). Skipped when CDC is
    // active because CDC already spans instances.
    if (!cdcEnabled && directUrl && realtimeSubscribes) {
        try {
            await realtimeService.startListening(directUrl);
        } catch (err) {
            logger.warn("⚠️ Cross-instance realtime could not be started", { detail: err instanceof Error ? err.message : String(err) });
        }
    } else if (!cdcEnabled && !realtimeSubscribes && !realtimeOff) {
        // A worker or a functions process, with no capture to publish
        // its writes for it (REALTIME_CDC=off, or `auto` fell back).
        // It has nobody to deliver to, but the `api` does: announce
        // each write the way an `all` process would, minus the
        // LISTEN. Where the `api` turns out to run capture after all,
        // nothing listens on this channel and the notification is
        // dropped by the database.
        realtimeService.startPublishing();
    }

    // ── Startup Schema Validation ────────────────────────────────────
    // One-directional: only checks collections → DB (extra DB tables
    // that aren't mapped to collections are perfectly fine).
    try {
        const registeredCollections = collectionsOnThisSource();
        if (registeredCollections.length > 0) {
            const result = await schemaAwareDb.execute(sql.raw(DRIFT_CHECK_RELATIONS_SQL));
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
                const checkName = resolveDriftCheckName(col, registry.getPgTableNames());
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
        provisioned: provision,
        rls,
        adminPoliciesLive,
        adminRequestPoliciesLive,
        managedTables,
        rlsEnforcement,
        exposedInternalTables,
        provisionCdcForTables
    };

    return {
        driver,
        realtimeProvider: realtimeService,
        collectionRegistry: registry,
        // Only set in baas mode — tells the server which collections the
        // database turned out to have.
        collections: introspectedCollections,
        tables: introspectedDescriptors,
        ...(skippedUnprotected && { unprotectedTables: skippedUnprotected }),
        internals
    };
}

export function createPostgresBootstrapper(pgConfig: PostgresDriverConfig): BackendBootstrapper {
    /**
     * `pgConfig` with the environment read into it — this is the boot, and
     * the boot is where `DATABASE_READ_URL`, `DATABASE_DIRECT_URL` and the
     * `REALTIME_*` variables are honoured. Read once, when the first hook
     * that needs it runs, so a mistyped value fails that hook and a warning
     * about one is said once.
     */
    let resolvedConfig: PostgresDriverConfig | undefined;
    // A bootstrapper opens one source, so the first caller's key is the
    // key: the bare URL variables are read for the default source only.
    const effectiveConfig = (sourceKey?: string): PostgresDriverConfig =>
        resolvedConfig ??= postgresDriverConfigFromEnv(pgConfig, process.env, sourceKey);

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

    const requireProvisioningDb = (driverResult?: InitializedDriver) => {
        const db = provisioningDb(driverResult);
        if (!db) {
            throw new Error(
                "Cannot provision the collection schema: this Postgres adapter was created without a " +
                "`connection`, and no initialized driver was supplied to fall back on. Pass `connection` " +
                "to `createPostgresAdapter` (see `createPostgresDatabaseConnection`)."
            );
        }
        return db;
    };

    const provisioningQueryable = (driverResult?: InitializedDriver) => {
        const db = requireProvisioningDb(driverResult);
        return {
            async query<T>(text: string): Promise<{ rows: T[] }> {
                return { rows: sqlRows<T>(await db.execute(sql.raw(text))) };
            }
        };
    };

    /**
     * A connection of its own for the index builds on live tables — see
     * `poolIndexBuildSession` for why it cannot be the pool's next free one. A
     * handle with no pool behind it (PGlite, an application's own client)
     * gets the shared queryable, and the builder leaves session settings
     * alone on it.
     */
    const openIndexBuildSession = (driverResult?: InitializedDriver): OpenIndexBuildSession => async () => {
        const db = requireProvisioningDb(driverResult);
        const pool = "$client" in db ? db.$client : undefined;
        const { clientIndexBuildSession, isPgPool, poolIndexBuildSession } = await import("./schema/deferred-index-build");
        // Behind a transaction-mode pooler a checked-out client is not one
        // backend: the build gets a connection of its own on the direct URL.
        const config = effectiveConfig();
        if (isPooledPool(pool) || config.pooled) {
            if (!config.directConnectionString) throw pooledWithoutDirectUrlError(DEFAULT_DATA_SOURCE_KEY);
            return clientIndexBuildSession(config.directConnectionString)();
        }
        if (isPgPool(pool)) return poolIndexBuildSession(pool)();
        const queryable = provisioningQueryable(driverResult);
        return { dedicated: false, query: <T>(text: string) => queryable.query<T>(text), release: () => undefined };
    };

    /**
     * The indexes the last schema ensure left for later on live tables —
     * see `schema/deferred-index-build`. Started once the policies step is
     * done, the last DDL a boot runs, so the build never holds a table that
     * step needs; and by its own fallback timer if that step never runs here.
     */
    let pendingIndexBuild: ScheduledIndexBuild | undefined;

    /**
     * Create the `rebase` schema and the helper functions every generated
     * policy calls — `rebase.uid()`, `rebase.roles()` and their siblings — on
     * whichever database the queryable points at.
     *
     * Idempotent and cheap to repeat: `CREATE SCHEMA IF NOT EXISTS` plus a
     * handful of `CREATE OR REPLACE FUNCTION`.
     */
    const provisionRlsRuntime = async (driverResult?: InitializedDriver): Promise<void> => {
        const db = requireProvisioningDb(driverResult);
        const { RLS_BOOTSTRAP_STATEMENTS, rlsRuntimeIsCurrent, ensureRequestRoleFunction } = await import("./schema/rls-bootstrap-sql");
        const run = async (text: string) => sqlRows<Record<string, unknown>>(await db.execute(sql.raw(text)));
        // `rls.policyTarget: "requestRole"` compiles every permissive policy
        // against this function, so it has to be there before they are.
        if (declaredRlsPolicyShape().policyTarget === "requestRole") await ensureRequestRoleFunction(run);
        // Nothing to replace: a `CREATE OR REPLACE` of an unchanged function
        // still rewrites it and invalidates every cached plan that calls it.
        if (await rlsRuntimeIsCurrent(run).catch(() => false)) return;
        // One statement per call — this handle speaks the extended query
        // protocol, which rejects multi-command strings. Advisory-locked
        // for the same reason the auth path is, and on the same key: two
        // instances booting against one fresh database must not race on
        // CREATE OR REPLACE.
        //
        // A transaction lock, inside the transaction the statements run in,
        // exactly as `auth/ensure-tables.ts` takes it. The handle is a pool,
        // and a session lock taken by one statement and released by another
        // could be released on a connection that never held it — behind a
        // transaction-mode pooler, a different server connection every time.
        // The unlock then answered `false`, the lock stayed on an idle pooled
        // connection, and the next boot waited on it until
        // `statement_timeout`. This one is released by the commit or the
        // rollback, on the connection that holds it.
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'))`);
            for (const statement of RLS_BOOTSTRAP_STATEMENTS) {
                await tx.execute(sql.raw(statement));
            }
        });
    };

    /**
     * Tables the policies step could not lock, whose user-role privileges it
     * took back instead — `schema.table` → its parts.
     *
     * Kept because the boot grants again after that step: the final posture
     * check runs `ensureAppRole`, whose `GRANT … ON ALL TABLES IN SCHEMA`
     * covers these tables too. It handed every withdrawn privilege straight
     * back — RLS off, DML granted, every authenticated request reading every
     * row — while the log said the table was closed. So whatever grants
     * schema-wide after the policies step withholds these again.
     */
    const withheldTables = new Map<string, { schema: string; table: string }>();

    const withholdAgain = async (runSql: RawSqlRunner): Promise<void> => {
        for (const [qualified, { schema, table }] of withheldTables) {
            try {
                await runSql(revokeUserRoleSql(schema, table));
            } catch (err) {
                throw new Error(
                    `Refusing to start: row-level security could not be enabled on "${qualified}", and the ` +
                    "privileges the schema-wide grant just gave the request role on it could not be taken " +
                    "back. The table would be served with no row filtering. Fix the database permissions " +
                    "(the connection role must own the table, or be able to ALTER it) and boot again: " +
                    (err instanceof Error ? err.message : String(err))
                );
            }
        }
    };

    return {
        type: "postgres",

        async initializeDriver(config: unknown): Promise<InitializedDriver> {
            const init = config as DatabaseAdapterInitConfig;
            const opened = await openPostgresDriver(effectiveConfig(init.dataSourceKey), init);
            // The boot announces the connection's posture; `openRebase` does not.
            if (opened.internals.rlsEnforcement) logger.info(opened.internals.rlsEnforcement);
            // A server is what serves requests as the restricted role, so it is
            // the one that must not come up while that role can read session
            // tokens and key hashes. Fail closed, with the statements to run.
            const exposed = opened.internals.exposedInternalTables ?? [];
            if (exposed.length > 0) {
                throw new Error(
                    `The request role ${(opened.internals.rls?.roles ?? [REBASE_USER_ROLE]).map((r) => `"${r}"`).join(", ")} can read or write framework tables that hold sessions, ` +
                    `key hashes and job payloads: ${exposed.join(", ")}.\n` +
                    "A provisioning boot revokes this, and this backend changes nothing in its database " +
                    "(provisioning is off). Revoke it as part of your change process:\n" +
                    exposed.map(table => `  REVOKE ALL ON ${table.split(".").map(part => `"${part}"`).join(".")} FROM ${(opened.internals.rls?.roles ?? [REBASE_USER_ROLE]).join(", ")};`).join("\n")
                );
            }
            return opened;
        },

        async initializeAuth(config: unknown, driverResult: InitializedDriver): Promise<BootstrappedAuth | undefined> {
            const authConfig = config as Record<string, unknown> | undefined;
            if (!authConfig) return undefined;

            const internals = driverResult.internals as PostgresDriverInternals;
            const db = internals.db;
            const registry = internals.registry;

            // Resolve the auth collection from the explicit config.
            // This replaces the old `registry.getPgTable("users")` magic string lookup.
            const authCollection = authConfig.collection as CollectionConfig | undefined;
            // The users table's descriptor: its name, schema and key type.
            const authDescriptor = authCollection ? registry.requireTable(authCollection.slug).descriptor : undefined;

            // A driver opened without provisioning creates and migrates nothing:
            // the tables are another process's to make. The one read that
            // guards every login still runs — a database a newer runtime has
            // migrated is refused here, not at the first sign-in.
            if (internals.provisioned !== false) {
                await ensureAuthTablesExist(db, authDescriptor);
            } else {
                await assertAuthSchemaCompatible(db, resolveAuthSchema(authDescriptor));
                // And the tables themselves, with every column auth reads: a
                // missing one would otherwise be met as a 500 on the first
                // sign-in. Placed where `ensureAuthTablesExist` puts them.
                const usersSchema = authDescriptor ? authDescriptor.schema : "rebase";
                const usersTableName = authDescriptor ? authDescriptor.table : "users";
                const authTablesSchema = usersSchema === "public" ? "rebase" : usersSchema;
                const expected = createAuthSchema(authTablesSchema);
                const problems = await findUnusableAuthTables(db, [
                    usersExpectation(usersSchema === "public" ? `"${usersTableName}"` : `"${usersSchema}"."${usersTableName}"`),
                    ...[
                        expected.refreshTokens, expected.passwordResetTokens, expected.appConfig,
                        expected.userIdentities, expected.mfaFactors, expected.mfaChallenges,
                        expected.recoveryCodes, expected.magicLinkTokens
                    ].map(expectationOf)
                ]);
                if (problems.length > 0) throw unusableAuthTablesError(problems);
            }

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
                        await internals.provisionCdcForTables([{
                            schema: authSchema,
                            table: authTable,
                            // The auth table above all: its rows carry password
                            // hashes and verification tokens, and the payload
                            // names the row by its key and nothing else.
                            identityColumns: tableKeyColumns(registry.requireTable(authCollection.slug)).map((k) => k.columnName)
                        }]);
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
                ? registry.getPgTable(tableName) as RebasePgTable | undefined
                : undefined;

            let usersSchemaName = "rebase";
            if (authCollection && "schema" in authCollection && typeof authCollection.schema === "string") {
                usersSchemaName = authCollection.schema;
            }

            // Named field by field through `asRebasePgTable`, not asserted
            // wholesale. `createAuthSchema` returns ten tables and
            // `AuthSchemaTables` declares five, so the assertion also claimed
            // the other five were absent while handing them straight through —
            // and if one of the five were ever renamed there, nothing here would
            // have said so.
            const schema = createAuthSchema(usersSchemaName);
            const authTables: AuthSchemaTables = {
                users: asRebasePgTable(schema.users),
                refreshTokens: asRebasePgTable(schema.refreshTokens),
                passwordResetTokens: asRebasePgTable(schema.passwordResetTokens),
                appConfig: asRebasePgTable(schema.appConfig),
                userIdentities: asRebasePgTable(schema.userIdentities)
            };
            if (usersTable) {
                authTables.users = usersTable as RebasePgTable;
            }

            const userService = new UserService(db, authTables);
            const authRepository = new PostgresAuthRepository(db, authTables);

            return { userService,
emailService,
authRepository,
// Bound to the same schema `ensureAuthTablesExist` just migrated, so the
// health endpoint reports on the tables auth actually reads.
schemaHealthCheck: () => probeAuthSchema(db, resolveAuthSchema(authDescriptor)) };
        },

        async initializeHistory(config: HistoryConfig, driverResult: InitializedDriver): Promise<{ historyService: HistoryService } | undefined> {
            if (!config) return undefined;

            const internals = driverResult.internals as PostgresDriverInternals;
            const db = internals.db;

            // Without provisioning, history uses what an earlier boot left —
            // read, not made — and builds no index.
            if (internals.provisioned === false) {
                const retention = typeof config === "object" ? config.retention : undefined;
                const state = await readHistoryTableState(db);
                return {
                    historyService: new HistoryService(db, retention ? { ttlDays: retention } : undefined, {
                        inTransaction: state.inTransaction,
                        entryFormat: state.entryFormat,
                        unavailable: historyUnavailableReason(state, { requireTransaction: false })
                    })
                };
            }

            const { BOOT_LOCK_TIMEOUT_MS } = await import("./schema/boot-ddl");
            const historyTable = await ensureHistoryTableExists(db, { lockTimeoutMs: BOOT_LOCK_TIMEOUT_MS });

            // The index the hourly retention sweep reads, built like any
            // index a live table is missing: concurrently, after the boot —
            // or right here in a provisioning-only run, which exits when boot
            // returns. See `ensureHistoryIndexes`.
            const historyIndexes = await ensureHistoryIndexes(db, { lockTimeoutMs: BOOT_LOCK_TIMEOUT_MS });
            if (historyIndexes.length > 0) {
                const { buildDeferredIndexes, scheduleDeferredIndexBuild } = await import("./schema/deferred-index-build");
                const indexOptions = { log: (message: string) => logger.info(`[history] ${message}`), lockTimeoutMs: BOOT_LOCK_TIMEOUT_MS };
                const provisionOnly = ["1", "true"].includes((process.env.REBASE_PROVISION_ONLY ?? "").trim().toLowerCase());
                if (provisionOnly) {
                    await buildDeferredIndexes(openIndexBuildSession(driverResult), historyIndexes, indexOptions);
                } else {
                    scheduleDeferredIndexBuild(openIndexBuildSession(driverResult), historyIndexes, {
                        ...indexOptions,
                        delayMs: DEFERRED_INDEX_BUILD_DELAY_MS
                    }).start();
                }
            }

            const retention = typeof config === "object" ? config.retention : undefined;
            const historyService = new HistoryService(db, retention ? { ttlDays: retention } : undefined, historyTable);

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
                const hostInfo = parseHostInfo(pgConfig.connectionString ?? "");
                const { reason, code } = classifyConnectFailure(err);
                throw diagnoseConnectFailure(err, pgConfig.connectionString)
                    ?? new Error(
                        code === "53300"
                            ? `PostgreSQL at ${hostInfo} has no free connection: ${reason} [53300]`
                            : `Cannot reach PostgreSQL at ${hostInfo} to provision the collection schema.`,
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
            tables: readonly CompiledTable[],
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
            const { BOOT_LOCK_TIMEOUT_MS } = await import("./schema/boot-ddl");
            // A provisioning-only run exits as soon as boot returns, so an
            // index left for later would never be built by it — and the
            // serving processes of such a deployment provision nothing. It is
            // a migration job: building inline is what it is for.
            const provisionOnly = ["1", "true"].includes((process.env.REBASE_PROVISION_ONLY ?? "").trim().toLowerCase());
            const plan = await ensureCollectionTables(
                queryable,
                tables,
                log,
                // A change to a table a long reader holds waits in one-second
                // slices, so live queries on it are never held behind the boot
                // for longer than that. See `schema/boot-ddl`. And a table this
                // boot creates is built in a few transactions, not one commit
                // per column.
                {
                    lockTimeoutMs: BOOT_LOCK_TIMEOUT_MS,
                    batchNewTables: true,
                    deferIndexBuilds: !provisionOnly,
                    openIndexBuildSession: openIndexBuildSession(driverResult)
                }
            );
            for (const failure of plan.failures) {
                logger.warn(describeEnsureFailure(failure));
            }
            pendingIndexBuild?.cancel();
            pendingIndexBuild = undefined;
            if (!provisionOnly && plan.deferredIndexes.length > 0) {
                const { scheduleDeferredIndexBuild } = await import("./schema/deferred-index-build");
                logger.info(
                    `[schema] ${plan.deferredIndexes.length} index(es) are missing, or were left INVALID, on tables that ` +
                    "already exist. They are built in the background once the server is serving, one at a time, " +
                    "without blocking reads or writes."
                );
                pendingIndexBuild = scheduleDeferredIndexBuild(openIndexBuildSession(driverResult), plan.deferredIndexes, {
                    log: message => logger.info(`[schema] ${message}`),
                    lockTimeoutMs: BOOT_LOCK_TIMEOUT_MS,
                    delayMs: DEFERRED_INDEX_BUILD_DELAY_MS
                });
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
         * Runs through the same drizzle handle, one transaction per table under
         * a lock budget (see `schema/ensure-collection-policies`). Failures are
         * per-table and non-fatal: a table left un-policed stays RLS-enabled, so
         * it denies rather than leaks, and a table whose lock another session
         * held throughout is left exactly as it was.
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
            await provisionRlsRuntime(driverResult);
        },

        async ensureCollectionPolicies(
            tables: readonly CompiledTable[],
            driverResult?: InitializedDriver,
            log?: (message: string) => void
        ): Promise<{ applied: number }> {
            const { ensureCollectionPolicies, describeRulesDropped } = await import("./schema/ensure-collection-policies");
            const queryable = provisioningQueryable(driverResult);
            // The order this depends on is set by the caller, and a caller that
            // gets it wrong fails silently-but-permanently: `CREATE POLICY`
            // validates the functions its expression calls, so every policy on
            // the source is refused and the table stays RLS-enabled with no way
            // in. That is what a second database did for a whole release — the
            // helpers arrived with the auth tables, and auth lives on the
            // default source only. So the invariant is checked here, where the
            // policies are actually written, instead of being an ordering rule
            // three modules away. One catalogue lookup when it already holds.
            const { rows } = await queryable.query<{ present: boolean }>(
                "SELECT to_regprocedure('rebase.roles()') IS NOT NULL AS present"
            );
            if (!rows[0]?.present) await provisionRlsRuntime(driverResult);
            // The server-or-admin policies go TO rebase_admin only where this
            // driver's admin switch is live; no driver, no switch, TO public.
            const internals = driverResult?.internals as PostgresDriverInternals | undefined;
            const outcome = await ensureCollectionPolicies(
                queryable,
                tables,
                log,
                {
                    adminRoleAvailable: internals?.adminPoliciesLive === true,
                    adminRequestRoleAvailable: internals?.adminRequestPoliciesLive === true
                }
            );
            // This run covers every collection on the source, so what it could
            // not lock is the whole set — a table locked since is dropped from it.
            withheldTables.clear();
            for (const u of outcome.unsecured.filter(u => u.grantWithdrawn)) {
                const dot = u.table.indexOf(".");
                withheldTables.set(u.table, { schema: u.table.slice(0, dot), table: u.table.slice(dot + 1) });
            }

            for (const skip of outcome.skipped) {
                logger.warn(`🔐 [rls] Policies not applied to "${skip.table}": ${skip.reason}`);
            }
            for (const failure of outcome.failures) {
                logger.warn(
                    `🔐 [rls] Could not fully apply policies to "${failure.table}" — RLS is on, so it denies until this is resolved: ${failure.error}`
                );
            }
            // Applied — the declaration wins, and the table is left admin-only
            // rather than open — but never in silence: it changes who reads
            // the table on every server sharing this database.
            for (const dropped of outcome.rulesDropped) logger.warn(describeRulesDropped(dropped));
            // Not a failure: the table's transaction rolled back, so it is
            // exactly as it was — RLS on, its existing policies in force. Only
            // worth more than a warning when those are not the declared ones.
            for (const deferred of outcome.deferred) {
                const message =
                    `🔐 [rls] Policies on "${deferred.table}" were not re-applied: ${deferred.error}. ` +
                    "RLS is on and the table keeps the policies it already had";
                if (deferred.rulesChanged) {
                    logger.error(
                        `${message} — which are NOT the ones this deploy declares, so its new security rules are ` +
                        "not in force on this table yet. Boot again once that session has finished."
                    );
                } else {
                    logger.warn(`${message}; they are re-applied on the next boot.`);
                }
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
                    "Its privileges have been revoked from the request role, so the table is " +
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
                    ", and the privileges granted to the request role could not be revoked either. " +
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

            // The last DDL this boot runs; the deferred index builds may have
            // the tables now.
            pendingIndexBuild?.start();
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
            return readCollectionsSchemaVersion(db, SCHEMA_META_SCHEMA);
        },

        /** Record what this process just applied. Only the provisioning process calls this. */
        async stampCollectionsSchemaVersion(version: string, driverResult?: InitializedDriver): Promise<void> {
            const db = provisioningDb(driverResult);
            if (!db) return;
            const { stampCollectionsSchemaVersion } = await import("./schema/collections-schema-version");
            await stampCollectionsSchemaVersion(db, SCHEMA_META_SCHEMA, version);
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
            if (!db) return;
            // Opened without provisioning: nothing has been created since the
            // posture was read at open, so there is nothing new to grant on,
            // and granting is DDL this process was told not to run.
            if (internals.provisioned === false) return;

            const runSql: RawSqlRunner = async (text) => {
                const res = await db.execute(sql.raw(text));
                return (res.rows ?? []) as Record<string, unknown>[];
            };

            const collectionSchemas = registry.getCollections()
                .map((c) => (c as { schema?: string }).schema)
                .filter((s): s is string => typeof s === "string");
            const managedSchemas = ["public", "rebase", ...collectionSchemas];

            // The switch was configured at connect — and its grants were made
            // then, on the schemas that existed then. On a fresh database that
            // is `public` alone: `rebase` (the RLS helpers, the history table,
            // `rebase.record_history`, the job store) and a collection's own
            // schema are created by provisioning, after. The grant skipped for
            // a missing schema was never made, so every write to a
            // `history: true` collection answered "permission denied for schema
            // rebase" until a restart found the schema at connect time. Made
            // now, once provisioning has created them.
            //
            // The grant tier only — the role and the membership were settled at
            // connect, in this process — and only what the catalogue says is
            // still missing: on a database whose grants already hold, one read.
            // It used to repeat every grant and every internal-table revoke the
            // connect-time call had just made.
            const rls = internals.rls ?? resolveRlsSettings(undefined);
            const grantOptions = (role: string) => ({ role, mode: rls.grants, managedTables: internals.managedTables?.() ?? [] });
            if (driver.rlsUserRole) {
                try {
                    for (const role of rls.roles) await ensureAppRoleGrants(runSql, managedSchemas, grantOptions(role));
                } catch (err) {
                    // Fails closed — a missing grant refuses requests, it does
                    // not widen them — so a warning, not a refusal to serve.
                    logger.warn(
                        `⚠️ RLS enforcement: could not grant ${rls.roles.map((r) => `"${r}"`).join(", ")} on the schemas provisioning ` +
                        `created (${managedSchemas.join(", ")}). Requests that touch them will be refused with ` +
                        `"permission denied for schema …" until a boot can: ${err instanceof Error ? err.message : String(err)}`
                    );
                }
                await withholdAgain(runSql);
                return;
            }

            const posture = await detectConnectionPosture(runSql, managedSchemas);
            // Only ownership matters here. `canCreateTables` was already weighed
            // at boot, and re-failing on it now would turn the tolerant branch
            // above into a hard failure by the back door.
            if (!posture.superuser && !posture.bypassRLS && !posture.ownsTables) return;

            try {
                for (const role of rls.roles) {
                    await ensureAppRole(runSql, managedSchemas, {
                        role,
                        provisionRole: rls.provisionRole,
                        grants: rls.grants,
                        managedTables: internals.managedTables?.() ?? [],
                        inheritRoles: rls.inheritTo.includes(role) ? rls.inheritRoles : []
                    });
                }
            } catch (err) {
                throw new Error(
                    `The database connection role "${posture.role}" now owns tables in this database, so it ` +
                    "bypasses every row-level security policy on them — but the restricted role it should " +
                    "switch to could not be provisioned, so authenticated requests would be served with no " +
                    `policy applied at all. Refusing to serve.\n\n${err instanceof Error ? err.message : String(err)}`
                );
            }
            await withholdAgain(runSql);

            // The policies were written before this, TO public (the driver was
            // not switching then), so whatever this settles, nobody is refused.
            const { request } = await settleAdminSwitch(runSql, managedSchemas, rls, { provision: true });
            driver.rlsUserRole = rls.defaultRole;
            realtimeService.rlsUserRole = rls.defaultRole;
            driver.rlsRequest = request;
            realtimeService.rlsRequest = request;
            logger.info(
                `🔐 RLS enforcement active: the connection role "${posture.role}" became a table owner during ` +
                `this boot, so authenticated requests now run as ${rls.roles.map((r) => `"${r}"`).join(", ")}.`
            );
        },

        getAdmin(driverResult: InitializedDriver): DatabaseAdmin | undefined {
            const internals = driverResult.internals as PostgresDriverInternals;
            return internals.driver.admin;
        },

        async initializeWebsockets(server: unknown, realtimeService: RealtimeProvider, driver: DataDriver, config?: unknown, adapter?: unknown, limits?: RealtimeSocketOptions): Promise<void> {
            const { createPostgresWebSocket, isSocketRealtimeService, socketRealtimeMissing } = await import("./websocket");
            // Narrowed, not cast: on a multi-source project this is the routed
            // composite, and a cast to the Postgres service is what let the
            // socket call a method the composite did not have.
            if (!isSocketRealtimeService(realtimeService)) {
                throw new Error(
                    "The realtime service handed to the Postgres socket cannot serve it — it has no " +
                    `${socketRealtimeMissing(realtimeService).join(", ")}. Every socket would fail on its first frame.`
                );
            }
            // The per-identity socket ceiling, opt-in. Read here, at boot, and
            // refused if mistyped rather than quietly becoming no ceiling.
            const realtimeConfig = effectiveConfig().realtime;
            const maxSocketsPerUser = realtimeConfig?.maxSocketsPerUser !== undefined
                ? parseMaxSocketsPerUser(realtimeConfig.maxSocketsPerUser, "realtime.maxSocketsPerUser")
                : undefined;
            // The path this adapter was told to answer on wins over the one
            // the server derived from its mount point.
            const path = realtimeConfig?.path ?? limits?.path;
            createPostgresWebSocket(
                server as import("http").Server,
                realtimeService,
                driver as PostgresBackendDriver,
                config as { requireAuth?: boolean; jwtSecret?: string; serviceKey?: string },
                adapter as AuthAdapter | undefined,
                {
                    ...limits,
                    ...(maxSocketsPerUser !== undefined ? { maxSocketsPerUser } : {}),
                    ...(path !== undefined ? { path } : {})
                }
            );
        }
    };
}
