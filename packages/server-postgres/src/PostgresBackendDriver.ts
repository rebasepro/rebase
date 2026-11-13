import { DataService } from "./services/dataService";
import { filterRequired, type ConflictRule } from "./services/PersistService";
import { BranchService } from "./services/BranchService";
import { RealtimeService, type SubscriptionAuthContext } from "./services/realtimeService";
import { DatabasePoolManager } from "./databasePoolManager";
import { DrizzleClient } from "./interfaces";
import {
    ANONYMOUS_USER_ID,
    DatabaseAdmin,
    DatabaseHealthSample,
    DatabasePoolStats,
    SQLAdmin,
    CallerSqlOptions,
    DataDriver,
    DeleteProps,
    FetchCollectionProps,
    FetchOneProps,
    FilterValues,
    ListenCollectionProps,
    ListenOneProps,
    RebaseCallContext,
    RebaseServerClient,
    RebaseData,
    RebaseSdkData,
    RestFetchService,
    BatchWriteProps,
    SaveManyProps,
    SaveProps,
    SqlCursor,
    SqlScriptResult,
    StorageSource,
    UpdateManyProps,
    UpdateRelationPivotProps,
    UpdateWhereProps,
    DeleteManyProps,
    DeleteWhereProps,
    LogicalCondition,
    EntityValues,
    EntityStatus,
    TableColumnInfo,
    TableDescriptor,
    TableForeignKeyInfo,
    TableJunctionInfo,
    TableMetadata,
    TablePolicyInfo,
    TenantDescriptor,
    User,
    parseEnvBoolean,
    type BranchDiff,
    type BranchDiffOptions,
    type BranchMergeOptions
} from "@rebasepro/types";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, DatabaseError, Pool, type PoolClient } from "pg";
import { sqlRows, anonymousWriteRefusedBy, applyCreateDefaults, applyStamps, createStampKeys, hasColumnAccessRules, buildSdkData, callbackRefusal, createAccessorSlugResolver, classifyTable, detectJunctionTables, isSoftDeleteRestore, requireCallbackClient, resolveTenantWrite, stampModifier, tenantOf, toCallbackError, updateStampKeys } from "@rebasepro/common";
import { PostgresTableRegistry } from "./model/PostgresTableRegistry";
import { deriveRowAddress, getPrimaryKeys, parseIdValues, tableKeys } from "./services/collection-helpers";
import { isJunctionBackedRelation, isNestedPath, resolveNestedPath, splitPathSegments } from "./services/nested-path";
import { resolveSoftDelete, rowInTrashError } from "./services/soft-delete";
import type { RuntimeTable } from "./model/runtime-table";
import { currentWriteScope, runInWriteScope, WriteTransactionScope } from "./services/write-transaction-scope";
import { currentWriteDepth, inWriteFrame, type WriteFrame } from "./services/write-depth";
import { afterDelete, afterReadOnRow, afterReadOnRows, afterSave, afterSaveError, beforeDeleteVetoes, beforeSave, declaresAnyHook, hasAfterRead, hasBeforeQueryHook, hasBeforeSave, hasRowHook, requireHookTable, resolveTableHooks, type TableHookSet } from "./services/table-hooks";
import { stripUnreadable } from "./services/row-pipeline";
import { HistoryService } from "./history/HistoryService";
import { ApiError, logger, resolveBatchRefs } from "@rebasepro/server";
import { extractPgError, isRoleSwitchingPermissionError, reachedDatabase } from "./utils/pg-error-utils";
import { rowsOfResult } from "./utils/result-rows";
import { applyAuthContext, authContextStatement } from "./security/rls-enforcement";
import type { RequestIdentity } from "./security/rls-settings";
import { assertCallerSql } from "./security/caller-sql";
import { ColumnOrigins, fieldsOfResult, withoutUnreadableColumns } from "./security/caller-sql-columns";
import { viewRowsName } from "./schema/plan/view-names";
import { withFieldViewer } from "./services/field-viewer";
import { generateSchemaCommit } from "./schema/generate-schema-commit";
import { readSchemaFactsFor, type Queryable } from "./schema/ensure-tables";
import { readReconcileFacts } from "./schema/reconcile-schema";
import { describeUnmappedTables } from "./schema/introspect-tables";
import { onOwnSession, openSqlCursorOnPool, readWithinBudget, refuseOversizedRows, RESET_SESSION_STATEMENTS, runSqlScriptOnPool, sqlScriptResultFromRows } from "./services/sql-script";
import { PgNotifyListener } from "./services/pg-notify-listener";
import { diffDatabaseBranch, mergeDatabaseBranch } from "./branching/branch-diff";
import { isPooledPool, pooledTransactionSettings, transactionSettingsConfig, transactionSettingsStatements } from "./connection";
import { commitWithNextStatement, pipelineTarget, runPipelinedTransaction } from "./pipelined-transaction";
import { assertTableWritable, assertViewReadable } from "./services/view-access";
import { isReplicaFallbackError, type ReadRouter } from "./read-routing";
import { poolStatsOf, sampleDatabaseHealth } from "./database-health";
import { positionalStatement } from "./utils/positional-params";

/**
 * Has an operator opted out of database role switching entirely?
 *
 * `DISABLE_DB_ROLE_SWITCHING=true` is documented (README, the configuration
 * page, the backend skill) as "run Studio SQL Editor queries as the connection
 * owner", for deployments whose application roles have no database role behind
 * them. It is the only sanctioned way a statement that named a role runs
 * without it — every other route now refuses.
 *
 * Any spelling of yes, through the platform's one parser. It was an exact
 * `"true"` until that parser existed, deliberately, so that this variable would
 * not be fixed alone and left disagreeing with the rest.
 */
export function isRoleSwitchingOptedOut(): boolean {
    return parseEnvBoolean(process.env.DISABLE_DB_ROLE_SWITCHING) === true;
}

/**
 * The main database, when this process serves a branch of it.
 *
 * `rebase dev` on a checkout switched to a branch connects to the branch, and
 * names the database it was branched from in `REBASE_BRANCH_PARENT_DATABASE`.
 * Branches are kept there — the registry, and the default source of a new
 * one — as they are when the main database itself is served: a branch's own
 * `rebase.branches` is a snapshot, taken before its row was written.
 */
export function branchParentDatabase(): string | undefined {
    return process.env.REBASE_BRANCH_PARENT_DATABASE?.trim() || undefined;
}

/**
 * The role a statement will actually have run as, given the role it asked for.
 *
 * For the audit log, which recorded `options.role` — the *requested* role — and
 * so restated the caller's request as though it were the outcome. The two part
 * company exactly when {@link isRoleSwitchingOptedOut} holds, because every
 * other divergence is now an error rather than a quiet substitution.
 */
export function effectiveSqlRole(requestedRole?: string): string {
    if (!requestedRole) return CONNECTION_OWNER;
    return isRoleSwitchingOptedOut() ? CONNECTION_OWNER : requestedRole;
}

/** How {@link effectiveSqlRole} names "whatever role the connection holds". */
export const CONNECTION_OWNER = "<connection owner>";

/**
 * The role a console statement ran as, given the role it asked for — said to
 * the console with its rows, so it can say when that is not the role picked.
 *
 * The requested role whenever role switching is on: a statement that cannot
 * assume its role is refused, never run as anyone else. With
 * `DISABLE_DB_ROLE_SWITCHING`, every statement runs as the connection owner,
 * named by asking a session of its own on the same database — a role the
 * session already held is then still the one requested.
 */
export async function sqlRoleRanAs(
    admin: Pick<SQLAdmin, "executeSql">,
    requestedRole: string,
    database: string | undefined
): Promise<string> {
    if (!isRoleSwitchingOptedOut()) return requestedRole;
    try {
        const rows = await admin.executeSql("SELECT current_user AS role", { database, isolateSession: true });
        const owner = rows[0]?.role;
        return typeof owner === "string" ? owner : CONNECTION_OWNER;
    } catch {
        return CONNECTION_OWNER;
    }
}

/**
 * A statement named a database role the connection cannot assume.
 *
 * Its own type because the tempting recovery — run it anyway, as the owner — is
 * the one thing that must not happen. Callers that catch this should report it,
 * not retry unscoped.
 */
export class RoleSwitchUnavailableError extends Error {
    readonly code = "ROLE_SWITCH_UNAVAILABLE";
    readonly role: string;
    /** The underlying Postgres error, when the refusal came from a live attempt. */
    readonly pgError?: unknown;

    constructor(role: string, pgError?: unknown) {
        super(
            `Cannot execute SQL as role "${role}": this connection is not permitted to SET ROLE. ` +
            `The statement was NOT executed — running it as the connection owner would return ` +
            `owner-visible rows, which is a different question from the one that was asked. ` +
            `Grant the connection user membership in "${role}" with the right to switch to it — ` +
            `\`GRANT "${role.replace(/"/g, "\"\"")}" TO <connection user> WITH SET TRUE\` on PostgreSQL 16+, ` +
            `where a membership can exist without it (a role created by a non-superuser with CREATEROLE ` +
            `is one), or a plain \`GRANT\` before 16 — or set DISABLE_DB_ROLE_SWITCHING=true ` +
            `to run SQL Editor queries as the connection owner.` +
            (pgError ? ` Postgres said: ${extractPgError(pgError)?.message ?? (pgError instanceof Error ? pgError.message : String(pgError))}` : "")
        );
        this.name = "RoleSwitchUnavailableError";
        this.role = role;
        this.pgError = pgError;
    }
}

/**
 * Fold what a `beforeSave` returned into the values being saved.
 *
 * The hook returns the values that will be saved, so a key it returns replaces
 * the value outright: an array it filtered stays filtered, a map it narrowed
 * stays narrow. A key it leaves out keeps the value it was given, so a hook
 * that returns only the field it computed still saves the rest.
 *
 * Not a deep merge. `mergeDeep` merges arrays of objects element by element and
 * keeps every element past the end of the shorter one, so a hook that dropped
 * one line item of three had the last one merged back in and the order was
 * stored with a line duplicated.
 */
function applyBeforeSaveResult<T extends object, R extends object>(values: T, result: R): T & R {
    return { ...values, ...result };
}

/**
 * The keys of a create's final values that its INSERT alone may write: those
 * the caller did not send, no `beforeSave` hook wrote, and that are not an
 * update stamp (`.onUpdateNow()`, `.onUpdateUser()`) — a declared default, a
 * tenant stamp, a create-time stamp. See `PersistSaveOptions.insertOnlyKeys`.
 */
function insertOnlyKeysOf(
    finalValues: object,
    callerValues: object | undefined,
    beforeHooks: Record<string, unknown>,
    afterHooks: Record<string, unknown>,
    table: TableDescriptor | undefined
): string[] {
    const sent = new Set(Object.keys(callerValues ?? {}));
    const updateStamps = new Set(table ? updateStampKeys(table) : []);
    return Object.keys(finalValues).filter(key =>
        !sent.has(key)
        && !updateStamps.has(key)
        && beforeHooks[key] === afterHooks[key]);
}

/**
 * Refuse an update that stamps a `softDelete` collection's field.
 *
 * Stamping it IS the delete — every read hides the row from then on — so it is
 * `delete`'s to do, where the permission is `delete`, `beforeDelete` can veto,
 * `afterDelete` runs and history says "delete". Written by an update, a caller
 * holding only write access trashed rows, past all of that. Clearing it stays
 * an update: that is how a row is restored, and what a form sends back for a
 * live row.
 */
function assertUpdateDoesNotSoftDelete(
    table: RuntimeTable | undefined,
    values: Record<string, unknown> | undefined,
    path: string
): void {
    const softDelete = resolveSoftDelete(table);
    if (!softDelete) return;
    const value = values?.[softDelete.field];
    if (value === undefined || value === null) return;
    const slug = table?.slug ?? path;
    const message = `'${softDelete.field}' on '${slug}' records a delete, so an update may only clear it ` +
        "(null restores the row). Delete the row to set it.";
    throw ApiError.badRequest(message, "FIELD_NOT_WRITABLE", {
        collection: slug,
        violations: [{ field: softDelete.field, code: "soft_delete", message }]
    });
}

/** A key that names a row: not absent, and not the empty string a form sends. */
function isPresentKey(id: string | number | undefined | null): id is string | number {
    return id !== undefined && id !== null && id !== "";
}

/**
 * Refuse an update whose values move the row to another key.
 *
 * The row is addressed by its key, and everything after the write addresses
 * it the same way: the read-back, `afterSave`, history, the realtime event.
 * A key changed underneath them answered 500 "Could not fetch row after save."
 * on every door — and through `driver.data`, which runs outside a request's
 * transaction, the row had already moved when the call threw, with no
 * `afterSave`, no history entry and no event for the move. A key equal to the
 * address (a form that sends the whole row back) is not a change.
 *
 * Asked twice: of what the caller sent, before any hook runs, and of what the
 * hooks hand on, since a `beforeSave` can set the key too.
 */
function assertKeyUnchanged(
    table: RuntimeTable | undefined,
    registry: PostgresTableRegistry,
    id: string | number,
    values: Record<string, unknown> | undefined,
    path: string
): void {
    if (!table || !values) return;
    const primaryKeys = keysOfTable(table, registry);
    if (primaryKeys.length === 0) return;
    let address: Record<string, string | number>;
    try {
        address = parseIdValues(id, primaryKeys);
    } catch {
        // An address the key cannot parse is the write's own 404 to give.
        return;
    }
    const moved = primaryKeys
        .map(key => key.fieldName)
        .filter(field => values[field] !== undefined && String(values[field]) !== String(address[field]));
    if (moved.length === 0) return;
    const slug = table.slug ?? path;
    const violations = moved.map(field => {
        const message = `'${field}' is the key of '${slug}', and an update cannot change it: this row is "${id}". `
            + "Create a row under the new key and delete this one.";
        return { field, code: "key_immutable", message };
    });
    throw ApiError.badRequest(violations[0].message, "KEY_IMMUTABLE", { collection: slug, violations });
}

/**
 * Refuse a write that would leave a `.notNull()` `createdBy` / `updatedBy`
 * column null because nobody is acting.
 *
 * An `.onCreateUser()` column takes the uid from the call context, and an
 * anonymous request, a service token and an in-process write all have none.
 * Storing `null` is the right answer where the column allows it — plenty of
 * rows are legitimately written by the server. Where the table has said
 * `.notNull()`, it is not: that declaration means "a row must record who made
 * it", and a write that cannot answer the question is a write this table does
 * not accept. Better a 400 naming the column than a 23502, three layers down,
 * after the hooks have run. An update is refused only for an
 * `.onUpdateUser()` column: the creator is already recorded.
 */
function assertActingUserForStamps(
    table: TableDescriptor,
    status: EntityStatus,
    uid: string | undefined,
    path: string
): void {
    if (uid) return;
    const key = anonymousWriteRefusedBy(table, status !== "existing");
    if (key === undefined) return;
    const stamp = table.columns.find(column => column.key === key)?.stamp;
    throw ApiError.badRequest(
        `'${key}' on '${path}' records the acting user (\`${stamp ? stampModifier(stamp) : ".onCreateUser()"}\`) and is \`.notNull()\`, ` +
        "and this request has none. Sign in, or drop `.notNull()` from the column to let the server write rows anonymously.",
        "VALIDATION_CONSTRAINT",
        {
            collection: path,
            violations: [{ field: key, code: "required", message: `'${key}' records the acting user, and there is none.` }]
        }
    );
}

/**
 * A listener's `onError`, in the shape the realtime service calls it with.
 *
 * Registered with the subscription so a failed refetch reaches it. Before, only
 * the initial fetch did: a refetch after a change failed into a log line, and
 * the listener kept its last rows as if they were current. The error arrives as
 * thrown, not masked the way a socket frame is: this is trusted server code.
 */
function fetchErrorListener(onError: ((error: Error) => void) | undefined): ((error: unknown) => void) | undefined {
    if (!onError) return undefined;
    return (error) => onError(error instanceof Error ? error : new Error(String(error)));
}

/**
 * The principal a user's reads run as, for the transaction a request opens and
 * for a subscription alike.
 *
 * One definition because there were two. The subscription's copy was built by
 * hand after the fact and left out `isAnonymous`, so a guest's refetches ran as
 * an account: a policy that excludes guests filtered the first read and not the
 * ones after a change.
 */
function authContextOf(user: User | undefined): SubscriptionAuthContext {
    return {
        uid: user?.uid || ANONYMOUS_USER_ID,
        roles: user?.roles ?? [],
        isAnonymous: user?.isAnonymous === true,
        // A tenancy policy reads a claim. Spread rather than set, so a caller
        // carrying none produces no key at all.
        ...(user?.claims ? { claims: user.claims } : {})
    };
}

/** The `(table, column)` pairs {@link warnReplacedStamps} has spoken about, once each. */
const warnedStamps = new Set<string>();

/**
 * Say, once per column and outside production, that a value the write sent
 * for a stamped column was replaced or dropped. By design — the stamp is the
 * server's, never the caller's — and silent, which is how a migration script
 * that copies `createdAt` across found out its dates were all today's.
 */
function warnReplacedStamps(
    table: TableDescriptor,
    sent: Record<string, unknown>,
    stamped: Record<string, unknown>,
    status: EntityStatus
): void {
    if (process.env.NODE_ENV === "production") return;
    for (const column of table.columns) {
        const field = column.key;
        if (!column.stamp || sent[field] === undefined || sent[field] === null) continue;
        const replaced = stamped[field] === undefined || stamped[field] !== sent[field];
        const key = `${table.slug}.${field}`;
        if (!replaced || warnedStamps.has(key)) continue;
        warnedStamps.add(key);
        logger.warn(
            `[DataDriver] The value sent for '${field}' on "${table.slug}" was ${stamped[field] === undefined ? "dropped" : "replaced"}: ` +
            `it is \`${stampModifier(column.stamp)}\`, which the server stamps on ${status === "existing" ? "an update" : "a create"} whatever the write sends. ` +
            "Copying rows with their original value takes SQL, or a column without the stamp. (Said once per column, outside production.)"
        );
    }
}

/** The key of a served table, catalogue-aware: what an address is parsed against. */
function keysOfTable(table: RuntimeTable, registry: PostgresTableRegistry) {
    return tableKeys(table, registry.getPgTable(table.descriptor.table) ?? table.pg);
}

/**
 * A bulk or batch update's answer for an id that names no row this caller can
 * see: a 404 naming the id, which the entry's own label then wraps.
 */
function assertBatchRowFound(stored: Record<string, unknown> | undefined, id: unknown): void {
    if (stored) return;
    throw Object.assign(new Error(`No row with id ${JSON.stringify(id)}`), {
        statusCode: 404,
        code: "NOT_FOUND"
    });
}

/**
 * A query without the `collection` an admin panel may hand beside a path.
 *
 * Not part of the driver contract — the table is the one `path` names — but
 * the CMS's data-source props carry the panel's collection config, and a
 * client hands its props over the socket whole, so one can arrive here. It is
 * never read, and never kept with a subscription.
 */
function withoutViewCollection<Q extends object>(query: Q): Q {
    if (!("collection" in query)) return query;
    const copy = { ...query };
    Reflect.deleteProperty(copy, "collection");
    return copy;
}

export class PostgresBackendDriver implements DataDriver {
    key = "postgres";
    initialised = true;
    /** `save` and `delete` read the row they address and run a caller's precondition on it. */
    readonly checksRowPreconditions = true;

    public dataService: DataService;
    public realtimeService: RealtimeService;
    public historyService?: HistoryService;
    public branchService?: BranchService;
    public user?: User;
    public data: RebaseSdkData;
    /** Where the columns of a caller's SQL came from — see `caller-sql-columns.ts`. */
    readonly columnOrigins = new ColumnOrigins();

    /**
     * The server singleton, attached by `initializeRebaseBackend` after boot —
     * a driver exists before the client does. Typed as what is attached: a
     * `RebaseServerClient` has no `data`, and callbacks read it as
     * `context.client`.
     */
    public client?: RebaseServerClient;

    /**
     * Roles a `SET ROLE` has been refused for with insufficient privileges,
     * with the refusal, so later statements as that role refuse without
     * spending the round trip to be refused again.
     *
     * Deliberately NOT a mirror of `DISABLE_DB_ROLE_SWITCHING`, which it used
     * to be described as. The env var is an operator saying "run these as the
     * connection owner"; this is the database saying "I cannot give you the
     * role you asked for". The first is a decision and permits the fallback,
     * the second is a failure and must not — see the SECURITY note in
     * {@link executeSql}.
     *
     * Per role, and keeping Postgres's own error. It was one flag: a single
     * refusal for a role picked in the SQL editor then refused every other
     * role too, `rebase_user` included, and every later refusal said "not
     * permitted to SET ROLE" with the reason Postgres gave already dropped.
     */
    private readonly _roleSwitchRefusals = new Map<string, unknown>();

    /**
     * Restricted role that authenticated (user-context) requests run as (via
     * `SET LOCAL ROLE`) so RLS binds every statement — reads *and* writes. Set
     * by the bootstrapper after posture detection: defined when the connection
     * would otherwise bypass RLS (superuser / BYPASSRLS / table owner),
     * undefined when RLS already applies natively. The base (server-context)
     * driver never switches — it is the trusted owner plane (auth flows,
     * migrations, `dataAsAdmin`).
     */
    public rlsUserRole?: string;
    /** How a request picks its role and identity settings (`rls`), set with {@link rlsUserRole}. */
    public rlsRequest?: RequestIdentity;

    /**
     * The direct (non-pooled) URL {@link listen} holds its `LISTEN` on — this
     * source's, set by the bootstrapper. Never read from `DATABASE_DIRECT_URL`
     * here: that variable is the default source's, and a second database
     * listening on it hears none of its own notifications.
     */
    public listenConnectionString?: string;

    /**
     * A handle on this source's direct URL for the work that needs a session
     * of its own — the Studio SQL console's runs, cursors and cancels — set by
     * the bootstrapper when the pool reaches the database through a
     * transaction-mode pooler (`DATABASE_POOLED=true`). There, `SET ROLE` for a
     * session, a cursor held across reads and `pg_cancel_backend` of "this
     * run's backend" mean nothing: each transaction may land on another server
     * connection. Unset, the pool itself is direct and serves them.
     */
    public sessionDb?: DrizzleClient;

    /**
     * Where authenticated reads may go instead of the primary: this source's
     * read replica, with its lag guard and read-your-writes pins. Set by the
     * bootstrapper when `DATABASE_READ_URL` names another server. Read by
     * {@link AuthenticatedPostgresBackendDriver}; this driver's own reads stay
     * on the primary.
     */
    public readRouter?: ReadRouter<DrizzleClient>;

    /**
     * When true, realtime notifications are deferred until after the
     * wrapping transaction commits.  Set by `withAuth` → `withTransaction`.
     */
    _deferNotifications = false;
    /**
     * Whether the next write on this driver is the last thing its transaction
     * does, so its last statement may carry the `COMMIT`
     * (`commitWithNextStatement`). Set by `withTransaction` for a lone write,
     * and by a row-by-row batch of one row; honoured only by a write that runs
     * no hook and records no history, which is what would follow the
     * statement. Never for the last of several rows: a statement that matches
     * nothing is a 404 raised after it, and the rows before it would already
     * have committed.
     */
    _commitsWithLastWrite = false;
    _pendingNotifications: Array<{
        path: string;
        id: string;
        row: Record<string, unknown> | null;
        databaseId?: string;
    }> = [];

    constructor(
        public db: DrizzleClient,
        realtimeService: RealtimeService,
        public readonly registry: PostgresTableRegistry,
        user?: User,
        public poolManager?: DatabasePoolManager,
        historyService?: HistoryService
    ) {
        // The context every `beforeQuery` hook on this driver's reads runs
        // with, established once here rather than threaded through a dozen read
        // signatures. Lazy because `this.client` is attached after construction
        // and `this.data` reads through whichever handle this driver holds.
        this.dataService = new DataService(db, registry, () => this.buildCallContext());
        this.realtimeService = realtimeService;
        this.historyService = historyService;
        this.user = user;
        // `data.myNotes` is the collection whose accessor is `myNotes` (the
        // `my-notes` slug, whatever its table), as the generated types say.
        this.data = buildSdkData(this, { resolveAccessor: createAccessorSlugResolver(() => registry?.tables()) });

        // Initialize BranchService when adminConnectionString is configured
        if (poolManager) {
            this.branchService = new BranchService(db, poolManager, {
                database: async () => branchParentDatabase() ?? await this.appDatabaseName(),
                registry: async () => {
                    const parent = branchParentDatabase();
                    return parent && parent !== await this.appDatabaseName() ? poolManager.getDrizzle(parent) : this.db;
                }
            });
        }

    }

    /**
     * Typed admin capabilities (SQLAdmin + SchemaAdmin + BranchAdmin).
     * Implemented as a getter so method references are resolved at call-time,
     * allowing test spies applied after construction to take effect.
     */
    get admin(): DatabaseAdmin {
        return {
            executeSql: (...args: Parameters<NonNullable<DatabaseAdmin["executeSql"]>>) => this.executeSql(...args),
            probe: (timeoutMs: number) => this.probe(timeoutMs),
            runSqlScript: (...args: Parameters<NonNullable<DatabaseAdmin["runSqlScript"]>>) => this.runSqlScript(...args),
            openSqlCursor: (...args: Parameters<NonNullable<DatabaseAdmin["openSqlCursor"]>>) => this.openSqlCursor(...args),
            fetchAvailableDatabases: () => this.fetchAvailableDatabases(),
            fetchAvailableRoles: () => this.fetchAvailableRoles(),
            fetchApplicationRoles: () => this.fetchApplicationRoles(),
            fetchCurrentDatabase: () => this.fetchCurrentDatabase(),
            fetchUnmappedTables: (...args: Parameters<NonNullable<DatabaseAdmin["fetchUnmappedTables"]>>) => this.fetchUnmappedTables(...args),
            fetchTableMetadata: (...args: Parameters<NonNullable<DatabaseAdmin["fetchTableMetadata"]>>) => this.fetchTableMetadata(...args),
            // Planning a schema change is engine-specific — it renders DDL, a
            // Drizzle schema and the declarative SQL artifacts — so it lives
            // here and the server detects it structurally, the same way it
            // detects SQL. Planning only: applying is `executeSql` above, and
            // committing belongs to whatever holds the repository.
            // Planned against what this database actually has, not against an
            // empty one. Whether a NOT NULL can be added comes down to whether
            // the table holds rows, and whether an enum value will land comes
            // down to the values the type already carries — neither is knowable
            // from the collections, and both decide whether the statements this
            // returns are accepted or rejected by the database they name.
            // Both sides arrive compiled: the server compiles the edited
            // definitions as boot compiles its own (`compileSchemaDefs`), so a
            // relation between edited tables plans like any other.
            planSchemaChange: async (before, after, options) => generateSchemaCommit({
                before,
                after,
                paths: options?.paths,
                sourceOnly: options?.sourceOnly,
                existing: await readSchemaFactsFor(this.schemaFactsQueryable(), after)
            }),
            // The reviewed counterpart to boot's additive ensure: relaxing NOT
            // NULL and dropping columns no collection declares. Plans only;
            // the caller runs the statements once a person confirms them.
            planSchemaReconcile: async (tables, options) => readReconcileFacts(
                this.schemaFactsQueryable(),
                tables,
                options
            ),
            // "Import an existing table": the undeclared tables, described.
            describeUnmappedTables: (schema, mapped) => describeUnmappedTables({
                query: async <R>(text: string, values?: unknown[]) => ({ rows: sqlRows<R>(await this.executeSql(text, { params: values })) })
            }, schema, { mapped }),
            listen: (...args: Parameters<NonNullable<SQLAdmin["listen"]>>) => this.listen(...args),
            poolStats: () => this.poolStats(),
            sampleHealth: () => this.sampleHealth(),
            // Branch operations (only available when poolManager is configured)
            ...(this.branchService ? {
                createBranch: this.branchService.createBranch.bind(this.branchService),
                deleteBranch: this.branchService.deleteBranch.bind(this.branchService),
                listBranches: this.branchService.listBranches.bind(this.branchService),
                getBranchInfo: this.branchService.getBranchInfo.bind(this.branchService),
                // Read through this getter's own SQL and branch methods, so a
                // branch is compared exactly as the console and the Branches
                // pane reach it.
                diffBranch: async (name: string, options?: BranchDiffOptions) =>
                    this.nameDiffCollections(await diffDatabaseBranch(this.admin, name, options)),
                mergeBranch: (name: string, options: BranchMergeOptions) => mergeDatabaseBranch(this.admin, name, options)
            } : {})
        };
    }

    /** The diff with each table named by the slug it is served at, where it is served. */
    private nameDiffCollections(diff: BranchDiff): BranchDiff {
        const tables = this.registry?.tables() ?? [];
        const slugOf = (schema: string, table: string): string | undefined => tables.find(served =>
            served.descriptor.schema === schema && served.descriptor.table === table)?.slug;
        return {
            ...diff,
            data: diff.data.map((entry) => {
                const collection = slugOf(entry.schema, entry.table);
                return collection ? { ...entry, collection } : entry;
            })
        };
    }

    /**
     * `SQLAdmin.listen`: a `LISTEN` on a connection of its own, through the
     * listener CDC and the channel bus use, which reconnects and heartbeats.
     *
     * The connection is the one the realtime listener uses: this source's
     * direct URL ({@link listenConnectionString}) when the bootstrapper
     * resolved one — a transaction-mode pooler such as PgBouncer does not keep
     * a `LISTEN` — else the pool's own URL. The in-process development
     * database has neither, and is refused, as is a first connect that fails:
     * the caller polls instead.
     */
    async listen(
        channel: string,
        onNotify: (payload: string) => void,
        options?: { onReconnect?: () => void }
    ): Promise<() => Promise<void>> {
        const pool = "$client" in this.db ? this.db.$client : undefined;
        // Never the pool's own URL behind a transaction-mode pooler: the
        // pooler takes the LISTEN and drops it with the transaction, and the
        // channel then goes silent with nothing to say so.
        const connectionString = this.listenConnectionString
            || (pool instanceof Pool && !isPooledPool(pool) ? pool.options.connectionString : undefined);
        if (!connectionString) {
            throw new Error("no database URL to hold a LISTEN connection on (set DATABASE_DIRECT_URL)");
        }
        const listener = new PgNotifyListener({
            connectionString,
            channel,
            logLabel: `[LISTEN ${channel}]`,
            onPayload: onNotify,
            onReconnect: options?.onReconnect
        });
        await listener.start();
        return () => listener.stop();
    }

    /**
     * The catalogue-reading shim the schema planner wants.
     *
     * Text in, rows out — every statement it issues is a catalogue read keyed by
     * schema name, and schema names are identifiers rather than bindable values,
     * so there is nothing to parameterise. Runs on the driver's own handle, which
     * is the connection whose privileges are already known to work.
     */
    private schemaFactsQueryable(): Queryable {
        return {
            query: async <T>(text: string): Promise<{ rows: T[] }> => {
                return { rows: sqlRows<T>(await this.db.execute(drizzleSql.raw(text))) };
            }
        };
    }

    /**
     * REST-optimised fetch service (include-aware eager-loading).
     * Delegates to the underlying FetchService (include-aware eager loading),
     * then runs the afterRead pipeline on the results. The raw FetchService
     * runs no hooks, so masking must be applied here — otherwise every
     * REST/SDK read leaks unmasked data (see {@link applyAfterReadForRest}).
     */
    get restFetchService(): RestFetchService {
        const raw = this.dataService.getFetchService();
        return {
            fetchCollectionForRest: async (collectionPath, options, include) => {
                const rows = await raw.fetchCollectionForRest(collectionPath, options, include);
                return this.applyAfterReadForRest(rows, collectionPath);
            },
            fetchOneForRest: async (collectionPath, id, include, databaseId, options) => {
                const row = await raw.fetchOneForRest(collectionPath, id, include, databaseId, options);
                if (!row) return row;
                const [masked] = await this.applyAfterReadForRest([row], collectionPath);
                return masked;
            },
            // Forwarded, not omitted. `FetchService.aggregate` has existed for
            // as long as the route has, and this object is the only thing the
            // route can see — so leaving it out made
            // `GET /api/data/:slug/aggregate` answer 501 on every deployment,
            // including the Postgres one whose absence the 501's own comment
            // says it is describing.
            //
            // No afterRead pass: the hooks shape rows, and an aggregate
            // returns sums and counts rather than rows — so on a table
            // whose rows a hook rewrites, everything but a plain count is
            // refused (see `assertAggregateUnmasked`). Row-level authorization
            // is applied one layer down, by the request-scoped handle this
            // service reads through.
            aggregate: async (collectionPath, options) => {
                this.assertAggregateUnmasked(collectionPath, options);
                return raw.aggregate(collectionPath, options);
            },
            // Forwarded for the same reason `aggregate` is, and it was missed
            // the same way: this object is all the route can see, so a method
            // left off it does not fall back to the real one — it reads as a
            // driver that cannot do the thing. `readPage` asks `cursorFor` for
            // the `meta.nextCursor` of every page, so without this the server
            // accepted `?after=` and never issued a cursor to put in it, and
            // keyset pagination could not be started by any client.
            //
            // No transaction and no afterRead: it derives a string from a row
            // that has already been fetched and authorized.
            cursorFor: (collectionPath, row, orderBy) => raw.cursorFor(collectionPath, row, orderBy)
        };
    }

    /**
     * Build the context handed to every collection callback.
     *
     * Note `data: this.data` — `this` is whichever driver is running the
     * operation, so the callback's data plane inherits that driver's privilege.
     * On a user request `AuthenticatedPostgresBackendDriver.withTransaction`
     * constructs a fresh base driver bound to the RLS-scoped transaction and
     * runs the operation on it, so `this.data` speaks through that connection
     * and policies apply. On server-context work `this` is the base driver on
     * the owner connection, and they do not. Pinned by the
     * `"scopes context.data to the caller"` case in the `rls-enforcement` e2e
     * suite, because it is the kind of property that is easy to break from a
     * distance and impossible to notice.
     *
     * Previously returned through `as RebaseCallContext`, which
     * disabled checking for the whole object and let `driver` — documented in
     * the callbacks guide — sit on the runtime context while absent from the
     * contract. Both are declared now, so this is a plain typed return.
     *
     * `client` went through a narrower cast, `as RebaseCallContext["client"]`,
     * and it lied twice. It said `RebaseClient`, `data` included, about the
     * server singleton, which has no `data` — so `context.client.data` compiled
     * and threw in production. And it dropped the `| undefined` of a client
     * that is attached after construction. The type now leaves `data` off, and
     * a driver that was never given a client refuses by name, at the read.
     */
    /**
     * The runtime table a data path addresses (`registry.tableAt`: a slug,
     * a table name, or a walk through relations), `undefined` for no path.
     * Every write and read resolves its table here, from the path — never
     * from a `collection` a caller handed in.
     */
    private tableAt(path: string): RuntimeTable | undefined {
        return path ? this.registry.tableAt(path) : undefined;
    }

    private buildCallContext(): RebaseCallContext {
        const client = this.client;
        return {
            user: this.user,
            // The key the request authenticated with rides on the identity
            // `withAuth` was given, which every per-request driver carries
            // as `user`. Named apart so a hook can tell a personal key's
            // write from its owner's own, which `user` cannot.
            ...(this.user?.credential ? { credential: this.user.credential } : {}),
            driver: this,
            data: this.data,
            get client() {
                return requireCallbackClient(client);
            },
            storageSource: client?.storage as StorageSource
        };
    }

    /**
     * The hooks that run for the table a path addresses — global, the table's
     * own, its columns' transforms — read off the compiled table in the
     * registry, never off a collection (a socket frame's included).
     */
    private hooksAt(path: string): TableHookSet {
        return resolveTableHooks(this.registry, path);
    }

    /**
     * Refuse an aggregate that would read what `afterRead` hides.
     *
     * An aggregate reads the stored columns and never passes through the
     * hooks, so on a table whose rows one rewrites, `max(email)` or
     * `groupBy=salary` hands back the value the mask exists to withhold, one
     * bucket at a time. What a hook does to a row cannot be known from
     * here, so the rule is closed: on such a table only `count()` with no
     * `groupBy` is served — the number `GET /count` already gives — and any
     * other aggregate is refused, whichever tier (global, the table's, or a
     * column's `.transform()`) the hook sits on.
     */
    private assertAggregateUnmasked(
        path: string,
        options: { aggregates: { fn: string; field?: string }[]; groupBy?: unknown[] }
    ): void {
        // A row count, or a fingerprint of the rows' versions: neither reads a
        // stored value.
        const plainCount = (options.groupBy?.length ?? 0) === 0
            && options.aggregates.every(aggregate => (aggregate.fn === "count" || aggregate.fn === "fingerprint") && !aggregate.field);
        if (plainCount) return;
        if (!hasAfterRead(this.hooksAt(path))) return;
        throw ApiError.badRequest(
            `Aggregates other than count are refused on a table whose rows an afterRead hook rewrites ("${path}"): ` +
            "a sum, average, minimum, maximum, field count or group would read the stored values the hook hides. " +
            "Use `count()` or `fingerprint()` without `groupBy`, or read the rows.",
            "AGGREGATE_MASKED_BY_AFTER_READ",
            { collection: path }
        );
    }

    /**
     * One stored row as `restFetchService.fetchOneForRest` serves it: through
     * `afterRead`, on a copy, so the row the write itself goes on with (its
     * previous values, its history) stays the stored one. A precondition
     * compares against what the caller was served — an `ETag` is a hash of that.
     */
    private async asRestServes(
        row: Record<string, unknown> | null | undefined,
        path: string
    ): Promise<Record<string, unknown> | undefined> {
        if (!row) return undefined;
        const [served] = await this.applyAfterReadForRest([{ ...row }], path);
        return served;
    }

    /**
     * Apply `afterRead` to REST/SDK read results.
     *
     * The REST / `include` path fetches rows through the raw fetch service, which
     * runs no hooks — so without this, `afterRead` (PII masking among them) is
     * silently skipped on every SDK/REST read, leaking raw data. This choke
     * point guarantees it runs there too, as on `fetchCollection`/`fetchOne`.
     *
     * It also masks embedded relation data, at every level the include loaded,
     * by running each TARGET table's `afterRead` (so `comment.post.author.email`
     * is masked by the authors table, not left raw).
     */
    async applyAfterReadForRest(
        rows: Record<string, unknown>[],
        path: string
    ): Promise<Record<string, unknown>[]> {
        return this.applyAfterRead(rows, path);
    }

    /**
     * The driver's one `afterRead` chain (see `afterReadOnRows`): global, the
     * table's, its columns' transforms, then each embedded relation masked
     * with the TARGET table's. Every read this driver serves goes through it.
     */
    private applyAfterRead(
        rows: Record<string, unknown>[],
        path: string
    ): Promise<Record<string, unknown>[]> {
        return afterReadOnRows(
            this.registry,
            this.hooksAt(path),
            rows,
            path,
            () => this.buildCallContext(),
            // `afterRead` is application code; see `noteApplicationCode`.
            () => currentWriteScope()?.noteApplicationCode()
        );
    }

    /**
     * Rows of a table, as REST serves them: the one read walk
     * (`fetchCollectionForRest`) — columns under their own names, a foreign
     * key as a key, dates as RFC 3339, relations only when `include` names
     * them, each as the target's own row — then the one `afterRead` chain.
     *
     * It used to be the admin panel's view-model walk: every date wrapped as
     * `{ __type: "date" }`, every belongsTo turned into a relation ref, so the
     * socket's one-shot read, MCP, plugins and a function's `requireDriver(c)`
     * were handed a second row shape that no write door accepts back. The panel
     * builds its view model in the browser, from this row and the descriptor.
     */
    async fetchCollection<M extends Record<string, unknown>>(
        // Forwarded whole rather than re-listed, as `listenCollection` does:
        // the list named ten of the query's fields, so `logical`, `include`,
        // `fields`, `distinct`, `withDeleted` and `searchExplain` were accepted
        // and dropped — an `or(...)` read returned every row while `count`
        // with the same group answered 1.
        { path, startAfter, include, ...query }: FetchCollectionProps<M>
    ): Promise<Record<string, unknown>[]> {

        const rows = await this.dataService.fetchCollectionForRest<M>(path, {
            ...withoutViewCollection(query),
            startAfter: startAfter as Record<string, unknown> | undefined
        }, include);

        // The one chain: every tier, embedded relations included. A hook that
        // mutates the row and returns nothing leaves the row it mutated.
        return this.applyAfterRead(rows, path);
    }

    /**
     * Every stored row of a collection, past every read hook, for a whole-store
     * sweep — see `DataDriver.scanStoredRows`. Only this unscoped driver has
     * it: {@link AuthenticatedPostgresBackendDriver} reads as a caller, and a
     * caller's reads are scoped.
     */
    scanStoredRows(props: { path: string; pageSize?: number }): AsyncIterable<Record<string, unknown>[]> {
        return this.dataService.getFetchService().scanStoredRows(props.path, props.pageSize);
    }

    /**
     * Stored rows of a table, served as a read serves them — see
     * {@link DataDriver.serveStoredRows}. The same two steps a REST read takes
     * after the SELECT: the field strip (`stripUnreadable`, for the viewer the
     * caller's transaction set — none on this unscoped driver, which is the
     * trusted server plane), then the one `afterRead` chain. Each row is
     * copied first: the caller's stored values are not rewritten.
     */
    async serveStoredRows(path: string, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
        if (rows.length === 0) return rows;
        const set = this.hooksAt(path);
        const descriptor = requireHookTable(set, path);
        const visible = rows.map(row => stripUnreadable({ ...row }, descriptor));
        return this.applyAfterRead(visible, path);
    }

    /**
     * Listen to a collection: the rows now, then again after every change.
     *
     * The realtime service runs every read, the first one included, as
     * `authContext` — which {@link AuthenticatedPostgresBackendDriver} supplies,
     * and which defaults to this driver's own user (a driver bound to a
     * request's transaction has one). With neither, the reads run as the
     * anonymous user, as the refetches always did.
     */
    listenCollection<M extends Record<string, unknown>>(
        // Forwarded whole rather than re-listed: the list named nine of the
        // query's fields, so `logical` was dropped and an `or(...)` listener
        // was handed every row. Held back, as they always were here:
        // `vectorSearch`, which a subscription cannot serve, and `page` and
        // `withDeleted`, which the stored request has no field for.
        { path, startAfter, onUpdate, onError, vectorSearch: _vectorSearch, page: _page, withDeleted: _withDeleted, ...query }: ListenCollectionProps<M>,
        authContext: SubscriptionAuthContext | undefined = this.user ? authContextOf(this.user) : undefined
    ): () => void {
        const subscriptionId = this.generateSubscriptionId();

        this.realtimeService.startDataDriverSubscription(subscriptionId, {
            type: "collection",
            path,
            collectionRequest: {
                ...withoutViewCollection(query),
                startAfter: startAfter as Record<string, unknown> | undefined
            },
            authContext,
            onError: fetchErrorListener(onError)
        }, (rows) => {
            if (Array.isArray(rows)) onUpdate(rows);
        });

        return () => this.realtimeService.unsubscribe(subscriptionId);
    }

    /**
     * One row, as REST's `GET /:id` serves it (`fetchOneForRest`, then
     * `afterRead`): the relations `include` names and no others. It used to
     * load every relation the table declares, eagerly, as relation refs.
     */
    async fetchOne<M extends Record<string, unknown>>({
                                                             path,
                                                             id,
                                                             databaseId,
                                                             withDeleted,
                                                             include
                                                         }: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        const row = await this.dataService.fetchOneForRest<M>(path, id, include, databaseId, { withDeleted });
        if (!row) return undefined;
        const [served] = await this.applyAfterRead([row], path);
        return served;
    }

    /**
     * Listen to one row: the row now, then again after every change, and
     * `null` when it is not there — deleted, never created, or not readable by
     * the subscriber. Reads as {@link listenCollection} does.
     */
    listenOne<M extends Record<string, unknown>>(
        { path, id, include, onUpdate, onError }: ListenOneProps<M>,
        authContext: SubscriptionAuthContext | undefined = this.user ? authContextOf(this.user) : undefined
    ): () => void {
        const subscriptionId = this.generateSubscriptionId();

        this.realtimeService.startDataDriverSubscription(subscriptionId, {
            type: "single",
            path,
            id,
            include,
            authContext,
            onError: fetchErrorListener(onError)
        }, (row) => {
            // `null` is delivered, not dropped: it is how a listener learns its
            // row is gone. Dropped, the listener kept the last row it had.
            if (!Array.isArray(row)) onUpdate(row);
        });

        return () => this.realtimeService.unsubscribe(subscriptionId);
    }

    /**
     * How many membership rows a single write will read to answer "which
     * tenants is this caller in".
     *
     * A cap, not a limit on the feature: past it the API-level check stops
     * being able to prove a tenant is *not* the caller's, and defers to the
     * policy's `WITH CHECK`, which decides either way. The alternative — an
     * uncapped read of a membership table on every insert — makes the cost of a
     * write depend on how many organizations one user happens to belong to.
     */
    private static readonly TENANT_MEMBERSHIP_CAP = 100;

    /**
     * Stamp, or refuse, the tenant on a write to a `tenant`-scoped table.
     *
     * A no-op for every table that declares no tenancy, which is the common
     * case and costs one descriptor read.
     */
    private async applyTenantScope<M extends Record<string, unknown>>(
        table: RuntimeTable | undefined,
        path: string,
        values: Partial<EntityValues<M>>,
        status: EntityStatus,
        previousValues: Record<string, unknown> | undefined
    ): Promise<Partial<EntityValues<M>>> {
        const tenant = table ? tenantOf(table.descriptor) : undefined;
        if (!tenant) return values;

        // The same set the policy lets past: the trusted server context (no
        // user at all) and the bypass roles. Deciding it here rather than
        // inside the pure helper keeps "who is calling" in the one place that
        // knows.
        const bypassRoles = tenant.bypassRoles;
        const callerRoles = (this.user?.roles ?? []).map(r =>
            typeof r === "string" ? r : String((r as { id?: unknown })?.id ?? r));
        const bypass = !this.user || callerRoles.some(r => bypassRoles.includes(r));

        const { tenants, complete } = bypass
            ? { tenants: [] as unknown[], complete: true }
            : await this.resolveCallerTenants(tenant);

        const decision = resolveTenantWrite({
            tenant,
            values: values as Record<string, unknown>,
            status,
            callerTenants: tenants,
            callerTenantsComplete: complete,
            bypass,
            previousValues,
            slug: table?.slug ?? path
        });

        if (decision.refusal) {
            const { code, field, message } = decision.refusal;
            throw ApiError.badRequest(message, code, {
                collection: path,
                violations: [{ field, code, message }]
            });
        }
        return decision.values as Partial<EntityValues<M>>;
    }

    /**
     * The tenants this caller may write into.
     *
     * Two sources, and they answer at different costs. A `claim` is already on
     * the request — no query. A `membership` is rows in a table, and reading
     * them is a real query, so it is capped (see
     * {@link PostgresBackendDriver.TENANT_MEMBERSHIP_CAP}) and `complete` says
     * whether the cap was hit.
     *
     * The membership read runs in the caller's own context, so the membership
     * collection's RLS applies to it — exactly as it does inside the generated
     * policy's subquery. That is deliberate: if the two disagreed, the API
     * would refuse writes the database would have accepted, or accept writes it
     * refuses. The membership table's own rules are what make sure the membership
     * collection is readable by its own members in the first place.
     */
    private async resolveCallerTenants(
        tenant: TenantDescriptor
    ): Promise<{ tenants: unknown[]; complete: boolean }> {
        if ("claim" in tenant.from) {
            const value = this.user?.claims?.[tenant.from.claim];
            const empty = value === undefined || value === null || value === "";
            return { tenants: empty ? [] : [value], complete: true };
        }

        const uid = this.user?.uid;
        if (!uid) return { tenants: [], complete: true };

        const { table: slug, userField, tenantField } = tenant.from.membership;
        const cap = PostgresBackendDriver.TENANT_MEMBERSHIP_CAP;
        try {
            // Read on the trusted plane for its fields — the database still
            // scopes the rows to the caller. This is the server deciding a
            // write, not a read served to anyone, and the caller's `access.read`
            // rules describe what they may receive: applied here, a tenant
            // column members may not read would leave every member in no
            // tenant at all.
            const rows = await withFieldViewer(undefined, () => this.dataService.fetchCollectionForRest(slug, {
                filter: { [userField]: ["==", uid] },
                limit: cap + 1
            }));
            // `tenantField` names a column or a belongsTo; a row carries a
            // belongsTo as its foreign key, under the key of that column.
            const link = this.registry.getTable(slug)?.relations.get(tenantField);
            const tenantKey = link?.kind === "belongsTo" ? link.localField : tenantField;
            const tenants = Array.from(new Set(
                rows.slice(0, cap)
                    .map(row => row[tenantKey])
                    .filter(value => value !== null && value !== undefined)
            ));
            return { tenants, complete: rows.length <= cap };
        } catch (err) {
            // A membership table this caller cannot read is not a reason to
            // fail the write here — the policy is about to refuse it anyway,
            // and refusing with the wrong message would be worse than letting
            // the database answer. `complete: false` is what says "no evidence
            // of absence"; see `resolveTenantWrite`. A statement the database
            // refused is the exception: it has aborted the write's
            // transaction, so the database can no longer answer anything but
            // 25P02, and its own refusal is the better message.
            if (reachedDatabase(err)) throw err;
            logger.debug(`[save] Could not read '${slug}' to resolve the caller's tenants`, {
                detail: err instanceof Error ? err.message : String(err)
            });
            return { tenants: [], complete: false };
        }
    }

    /**
     * Where an update reads the row it addresses before writing it.
     *
     * The path itself, except through a many-to-many relation: there the path
     * names the parent's set, and an update may *link* a row that exists but is
     * not in that set yet (the persistence layer attaches it). Read through the
     * path, such a row is absent, so it is read from its own collection.
     */
    private storedRowPath(path: string): string {
        if (!isNestedPath(path)) return path;
        const hop = resolveNestedPath(path, this.registry);
        return hop && isJunctionBackedRelation(hop.relation) ? hop.target.slug : path;
    }

    /**
     * The row an update addresses, as this caller reads it there: what a
     * caller's precondition (the REST routes' 404 and `If-Match`) judges.
     *
     * `stored` is the row read from {@link storedRowPath}. Off a many-to-many
     * path that is the address itself. Through one, the row is judged as a
     * member of the parent's set when it is one. When it is not yet, this
     * update is the link that makes it one (the persistence layer writes the
     * junction row), so the row is judged as it is stored — provided the caller
     * can read the parent it is being linked to. A parent that is not there, or
     * that their policies hide, is no set to join, and the row reads as absent.
     */
    private async rowAnUpdateAddresses(
        path: string,
        storedPath: string,
        id: string | number,
        stored: Record<string, unknown> | null,
        databaseId: string | undefined,
        withDeleted: true | undefined
    ): Promise<Record<string, unknown> | null> {
        if (storedPath === path) return stored;
        const fetchService = this.dataService.getFetchService();
        const member = await fetchService.fetchOneForRest(path, id, undefined, databaseId, { withDeleted });
        if (member || !stored) return member;
        const segments = splitPathSegments(path);
        const parent = await fetchService.fetchOneForRest(
            segments.slice(0, -2).join("/"), segments[segments.length - 2]
        );
        return parent ? stored : null;
    }

    /**
     * The stored row an upsert's key names, if this caller can address it —
     * with its address and the values to update it with.
     *
     * Read as the caller reads: their policies and `beforeQuery` scope. On the
     * trusted plane for its fields only, like {@link resolveCallerTenants}:
     * the key columns are the server's to see.
     *
     * Soft-deleted rows are read too, and a key one of them holds is refused
     * with `ROW_IN_TRASH` (see {@link rowInTrashError}). Hidden, it was not
     * found here, the write went down the create pipeline, and the INSERT's
     * conflict branch wrote into the trashed row: `201 Created`, hooks told
     * "new", a second `create` in history, and the row still in the trash.
     *
     * `undefined` when the key is incomplete (the write is a plain insert,
     * which is the persistence layer's rule too), when a key value is not a
     * plain value, or when no such row is visible. None of those can write a
     * stored row wrongly: the statement's own conflict branch sets only what
     * the caller sent, only on a row in their scope, and never on one in the
     * trash.
     *
     * The values drop the key and the conflict target, which the stored row
     * already has: a natural-key upsert carrying a key the caller invented
     * must not move the row onto it.
     */
    private async findUpsertTarget<M extends Record<string, unknown>>(
        path: string,
        table: RuntimeTable,
        values: Partial<EntityValues<M>>,
        id: string | number | undefined,
        onConflict: readonly string[] | undefined
    ): Promise<{ id: string; values: Partial<EntityValues<M>>; row: Record<string, unknown> } | undefined> {
        const primaryKeys = keysOfTable(table, this.registry);
        const key: Record<string, unknown> = { ...values };
        if (isPresentKey(id)) Object.assign(key, parseIdValues(id, primaryKeys));
        const targetFields = onConflict && onConflict.length > 0
            ? [...onConflict]
            : primaryKeys.map(info => info.fieldName);
        if (targetFields.length === 0) return undefined;

        const filter: FilterValues<string> = {};
        for (const field of targetFields) {
            const value = key[field];
            if (value === undefined || value === null || value === "") return undefined;
            if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
            filter[field] = ["==", value];
        }

        const softDelete = resolveSoftDelete(table);
        const [row] = await withFieldViewer(undefined, () => this.dataService.fetchCollectionForRest(path, {
            filter,
            limit: 1,
            withDeleted: softDelete ? true : undefined
        }));
        // The row must be the one the key names. A filter key the table does
        // not have is dropped rather than refused under the process-wide
        // "warn" mode, and an unfiltered `limit: 1` is somebody else's row.
        if (!row || targetFields.some(field => String(row[field]) !== String(key[field]))) return undefined;
        if (softDelete && row[softDelete.field] !== null && row[softDelete.field] !== undefined) {
            throw rowInTrashError(path, targetFields.map(field => String(key[field])).join(", "), softDelete);
        }

        const rest: Record<string, unknown> = { ...values };
        for (const field of [...primaryKeys.map(info => info.fieldName), ...targetFields]) delete rest[field];
        return {
            id: deriveRowAddress(row, table, this.registry),
            values: rest as Partial<EntityValues<M>>,
            row
        };
    }

    /**
     * Refuse a write to a collection that serves a SQL view; see
     * `view-access.ts`. A path this cannot resolve is the write's own to
     * answer — this refuses views, and never fails a write over a lookup.
     */
    private assertWritable(path: string): void {
        let table: RuntimeTable | undefined;
        try {
            table = this.tableAt(path);
        } catch {
            return;
        }
        assertTableWritable(table?.descriptor, path);
    }

    /**
     * The stamps a write takes after its hooks: the time and the acting user
     * (`.onCreateNow()`, `.onUpdateNow()`, `.onCreateUser()`,
     * `.onUpdateUser()`, on columns and inside JSON documents), and on an
     * update the create-time stamp columns dropped, which record who made the
     * row and when — facts no later write can change.
     */
    private stampWrite<M extends Record<string, unknown>>(
        runtime: RuntimeTable | undefined,
        values: Partial<EntityValues<M>>,
        status: EntityStatus,
        path: string
    ): Partial<EntityValues<M>> {
        const table = runtime?.descriptor;
        if (!table) return values;
        // Stamped at the application layer, after the hooks, so every write
        // through the backend carries them and a hook cannot attribute a
        // write to another time or user. The user comes from the call
        // context, never from the body; a write nobody makes is refused
        // where the stamp column is `.notNull()`.
        assertActingUserForStamps(table, status, this.user?.uid, path);
        const stamped = applyStamps(table, values as Record<string, unknown>, {
            creating: status !== "existing",
            now: new Date(),
            uid: this.user?.uid
        });
        // And an update leaves the create-time stamps alone. They record
        // who made the row and when, which no later write can change; left
        // to the body (or a hook), any row writer could reattribute a row
        // they edited — `createdBy` is the column that exists to stop that.
        if (status === "existing") {
            for (const key of createStampKeys(table)) delete stamped[key];
        }
        warnReplacedStamps(table, values as Record<string, unknown>, stamped, status);
        return stamped as Partial<EntityValues<M>>;
    }

    /**
     * What the caller reads of a row it just wrote: the stored row through the
     * `afterRead` hooks, on a copy, so a hook that edits its argument in place
     * edits only the view. The stored row itself is what `afterSave` judges and
     * history records.
     */
    private async viewOfSavedRow(
        storedRow: Record<string, unknown>,
        path: string,
        hooks: TableHookSet,
        context: RebaseCallContext
    ): Promise<Record<string, unknown>> {
        if (!storedRow || !hasAfterRead(hooks)) return storedRow;
        // A tier that returns nothing leaves the row: here it decided what the
        // write's own response body contained.
        return afterReadOnRow(hooks, { ...storedRow }, path, context);
    }

    /**
     * Whether a write to `table` has to read the stored row before it
     * writes: for the hooks and history that are handed it, the tenancy and
     * per-field rules that judge it, a `beforeQuery` that scopes which rows
     * the caller addresses, the trash an update must not reach, and a nested
     * path, which reads its row from elsewhere. Without any of those the write
     * itself is the read — an UPDATE that matches nothing is the 404, an
     * upsert's conflict branch finds the stored row.
     */
    private writeReadsStoredRow(
        table: RuntimeTable | undefined,
        path: string,
        hooks: TableHookSet
    ): boolean {
        if (!table) return true;
        return Boolean(
            hasBeforeSave(hooks)
            || hasRowHook(hooks, "afterSave")
            || hasRowHook(hooks, "afterSaveError")
            || hasBeforeQueryHook(hooks)
            || table.descriptor.history
            || tenantOf(table.descriptor)
            || hasColumnAccessRules(table.descriptor)
            || resolveSoftDelete(table)
            || isNestedPath(path)
        );
    }

    async save<M extends Record<string, unknown>>(props: SaveProps<M>): Promise<Record<string, unknown>> {
        const saved = await this.saveRowUnlessKept(props);
        // Only a conflict rule keeps a stored row, and none was passed.
        if (!saved) throw new Error(`Saving a row in "${props.path}" answered no row.`);
        return saved;
    }

    /**
     * {@link save}, for an upsert under a conflict rule (`saveMany`'s
     * `ignoreDuplicates` / `conflictWhere`): `undefined` when the rule left
     * the stored row on the conflict target as it was, and nothing ran for
     * it — no hook, no history, no event.
     */
    private async saveRowUnlessKept<M extends Record<string, unknown>>(props: SaveProps<M>, rule?: ConflictRule): Promise<Record<string, unknown> | undefined> {
        this.assertWritable(props.path);
        // A frame per write, so a hook whose `context.data` write runs that
        // hook again is refused at a bounded depth instead of looping inside
        // the request's transaction. See `write-depth.ts`.
        return inWriteFrame(props.path, "save", frame => this.saveInFrame(props, frame, undefined, rule));
    }

    /**
     * Whether the write about to run may send its transaction's `COMMIT` with
     * its last statement: this driver was told it is the transaction's last
     * write (`_commitsWithLastWrite`), it is not a write a hook started, and
     * nothing runs after its statement — no hook (an `afterRead` included,
     * which may read through `context.data`) and no history entry.
     */
    private lastWriteCommits(
        table: RuntimeTable | undefined,
        hooks?: TableHookSet
    ): boolean {
        return this._commitsWithLastWrite && currentWriteDepth() <= 1
            && !(hooks && declaresAnyHook(hooks)) && !table?.descriptor.history;
    }

    private async saveInFrame<M extends Record<string, unknown>>({
                                                            path,
                                                            id,
                                                            values,
                                                            status,
                                                            upsert,
                                                            onConflict,
                                                            precondition
                                                        }: SaveProps<M>, frame: WriteFrame,
                                                        /**
                                                         * The stored row, when this write already read it in
                                                         * this transaction (an upsert continuing as an update).
                                                         */
                                                        knownStored?: Record<string, unknown>,
                                                        /** An upsert's conflict rule: see {@link saveRowUnlessKept}. */
                                                        rule?: ConflictRule): Promise<Record<string, unknown> | undefined> {

        const runtime = this.tableAt(path);
        const hooks = this.hooksAt(path);
        if (declaresAnyHook(hooks)) currentWriteScope()?.noteApplicationCode();
        // Before anything runs, hooks included: a write whose audit entry
        // cannot be recorded is refused, not made and rolled back.
        if (runtime?.descriptor.history) this.historyService?.assertRecordable(runtime.slug);

        // An upsert that finds its row is an update of that row, and runs as
        // one: the update gate, `beforeSave` told "existing" with the stored
        // values, update stamps only, history "update". Every upsert door
        // (`?on_conflict=`, bulk and `_batch` upserts, the SDK, the socket)
        // reached the create pipeline instead, and the INSERT's conflict branch
        // wrote it over the stored row: omitted fields reset to their
        // `.default()`, an `.onCreateUser()` column handed to whoever ran the import,
        // hooks told the row was new, and a row the caller's `beforeQuery`
        // hides updated and then answered 500. The read runs in the write's
        // transaction; a row it cannot see is still met safely by the
        // statement's own conflict branch below.
        const assertUpdateShape = () => {
            if (status !== "existing") return;
            assertUpdateDoesNotSoftDelete(runtime, values, path);
            if (isPresentKey(id)) {
                assertKeyUnchanged(runtime, this.registry, id, values as Record<string, unknown>, path);
            }
        };
        // A caller's precondition is answered first, as the REST routes
        // answered their own read of the row before handing the body on: a
        // body that is wrong for a row that is not there is still a 404.
        const preconditionFirst = precondition !== undefined && status === "existing" && Boolean(id);
        if (!preconditionFirst) assertUpdateShape();

        const upserting = upsert === true && status !== "existing";
        // Read first only for what needs the stored row; otherwise the
        // INSERT's conflict branch below is the update, in one statement.
        const readsStoredRow = this.writeReadsStoredRow(runtime, path, hooks);
        if (upserting && runtime && readsStoredRow) {
            const stored = await this.findUpsertTarget<M>(
                path, runtime, values, id, onConflict
            );
            // A stored row the rule keeps: nothing to update, nothing to run.
            if (stored && rule && (rule.ignoreDuplicates || (rule.conflictWhere
                && !await this.dataService.getPersistService().rowMatches(this.storedRowPath(path), stored.id, rule.conflictWhere)))) {
                return undefined;
            }
            if (stored) {
                // The same write, continued as an update: the same frame. The
                // row the key named was just read, in this transaction, and is
                // the update's previous values rather than a second read of
                // it — unless the two reads could differ: a `beforeQuery` may
                // narrow the "list" that found it differently from a "get", the
                // find ran on the trusted plane for per-field read access, and a
                // nested path reads the row from elsewhere.
                const reusable = !hasBeforeQueryHook(hooks)
                    && !hasColumnAccessRules(runtime.descriptor) && !isNestedPath(path);
                return this.saveInFrame<M>(
                    { path, id: stored.id, values: stored.values, status: "existing" },
                    frame,
                    reusable ? stored.row : undefined
                );
            }
        }

        let updatedValues = values;
        const contextForCallback = this.buildCallContext();

        // Declared defaults are filled in BEFORE the hooks, not after, so a
        // `beforeSave` sees the row as it will be stored rather than a version
        // of it missing every key the caller happened to omit. A hook that
        // reads `values.currency` to pick a tax rate was reading `undefined`
        // on exactly the writes the default exists to cover.
        //
        // Before validation too: `.notNull()` on create is satisfied by a
        // default, which is why `assertWriteValuesValid` skips a column that
        // declares one.
        const writtenTable = runtime?.descriptor;
        if ((status === "new" || status === "copy") && writtenTable) {
            updatedValues = applyCreateDefaults(writtenTable, updatedValues as Record<string, unknown>) as Partial<EntityValues<M>>;
        }

        // Fetch previous values for callbacks AND history recording. Same walk
        // as the saved row the callbacks receive (`fetchOneForRest`), so
        // `values` and `previousValues` compare like with like — a Date on one
        // side and its ISO string on the other reads as a change that never
        // happened.
        let previousValuesForHistory: Partial<M> | undefined;
        // Nothing here needs the stored row, so the UPDATE is the read: it
        // answers 404 for a row that is not there (or is not the caller's) as
        // this read would have — see `PersistSaveOptions.unreadRow`.
        const unreadRow = status === "existing" && Boolean(id) && !precondition && !readsStoredRow;
        if (status === "existing" && id && !unreadRow) {
            // An update addresses a row the caller can read, and a key that
            // reads as nothing is a 404 — answered *here*, before any hook runs
            // and before the write, as `delete` answers it. The read is the
            // caller's: their policies, their `beforeQuery`, and the trash
            // hidden. So a row in the trash is a 404 too, unless this update
            // is its restore (`isSoftDeleteRestore`), which is the one edit
            // that reaches a stamped row.
            //
            // This used to refuse only when the collection declared a
            // `beforeQuery`, and REST's own pre-read was the rule everywhere
            // else. Every other door wrote straight through: the socket, MCP
            // and `driver.data` ran `beforeSave` for a key no row has before
            // the 404, and edited a trashed row — hooks, history and all —
            // that REST answered 404 for. And a restore read its previous
            // values with the trash hidden, found none, and history skipped
            // the update it had nothing to compare with: every restore went
            // unrecorded, and the trail said "deleted" for a live row.
            //
            // Through a many-to-many path an update can also *link* a row
            // that exists but is not linked yet, so there the row is read from
            // its own collection. A read that fails for another reason (a
            // collection whose key the registry cannot resolve) stays
            // best-effort enrichment and is not a reason to fail a write.
            //
            // A caller's `precondition` (the REST routes' 404 and `If-Match`)
            // judges this same read, inside this transaction — after the row
            // is locked, when it asks for that — so the routes no longer read
            // the row in a transaction of their own first.
            try {
                const withDeleted = runtime && isSoftDeleteRestore(
                    runtime.descriptor,
                    values as Record<string, unknown>
                ) ? true : undefined;
                if (precondition?.lock) await this.dataService.getPersistService().lockRow(path, id);
                const storedPath = this.storedRowPath(path);
                const existing = knownStored && !precondition
                    ? knownStored
                    : await this.dataService.getFetchService().fetchOneForRest(
                        storedPath, id, undefined, undefined, { withDeleted }
                    );
                if (precondition) {
                    const addressed = await this.rowAnUpdateAddresses(
                        path, storedPath, id, existing, undefined, withDeleted
                    );
                    await precondition.check(await this.asRestServes(addressed, path));
                }
                if (!existing) {
                    throw ApiError.notFound(`No row "${id}" in "${path}" to update.`);
                }
                // Every column, the key among them — the same shape as the
                // saved row history compares it with. Without the key on this
                // side, every update listed it as changed.
                previousValuesForHistory = existing as Partial<M>;
                if (preconditionFirst) assertUpdateShape();
            } catch (err) {
                // The refusal above is the answer, not a failed enrichment.
                if (err instanceof ApiError) throw err;
                // So is a statement the database refused: on a request it
                // has aborted the write's transaction, and carrying on only
                // turns the next statement into an unrelated 25P02.
                if (reachedDatabase(err)) throw err;
                // And so is whatever a caller's precondition threw: the write
                // it guards must not go ahead on a read that failed.
                if (precondition) throw err;
                // Best-effort enrichment: callbacks and history run without
                // previous values rather than the save failing on a read the
                // write itself does not need (e.g. a collection whose key the
                // registry cannot resolve).
                logger.debug(`[save] Could not fetch previous values for "${path}"`, { detail: err instanceof Error ? err.message : String(err) });
            }
        }

        /** The row as the hooks receive it, to tell what they wrote. */
        const beforeHooks: Partial<EntityValues<M>> = updatedValues;

        // A `before*` callback is the application speaking, not the server
        // failing: a bare `throw` is the documented way to block a write, so it
        // answers 400 with the author's message rather than a masked 500.
        try {
            frame.stage = "beforeSave";
            // Global, then the table's, then its columns' transforms; each
            // tier's returned values are merged over the ones before.
            updatedValues = await beforeSave(hooks, updatedValues as Record<string, unknown>, {
                path,
                id,
                previousValues: previousValuesForHistory as Record<string, unknown> | undefined,
                status,
                context: contextForCallback
            }) as Partial<EntityValues<M>>;
        } catch (callbackError) {
            throw toCallbackError(callbackError, "beforeSave", path);
        }
        const afterHooks: Partial<EntityValues<M>> = updatedValues;
        if (status === "existing" && isPresentKey(id)) {
            assertKeyUnchanged(runtime, this.registry, id, updatedValues as Record<string, unknown>, path);
        }

        updatedValues = this.stampWrite(runtime, updatedValues, status ?? "new", path);

        // Tenancy, last of the three stamps and for the same reason they are
        // here rather than in a hook: the tenant comes from the *call context*,
        // never from the body, so a caller (or a `beforeSave`) cannot attribute
        // a row to another tenant. The database enforces the same rule through
        // the restrictive tenancy policy — this only reaches the same answer
        // one layer earlier, with the field named. See `@rebasepro/common`'s
        // `resolveTenantWrite`.
        updatedValues = await this.applyTenantScope(
            runtime,
            path,
            updatedValues,
            status ?? "new",
            previousValuesForHistory as Record<string, unknown> | undefined
        ) as Partial<EntityValues<M>>;

        // A create that names its key is still a create. The persistence layer
        // reads an `id` as "update this row", so a new row's key travels inside
        // the values, where the INSERT takes it — which is what the REST create
        // does with a key in the body. Handed down as `id`, in-process
        // `create(values, id)`, MCP `create_document { id }` and a socket
        // `SAVE { id, status: "new" }` were all UPDATEs: a new id answered 404,
        // and an existing one was overwritten with create-time values instead
        // of refused. Only `status: "existing"` addresses a stored row; a
        // duplicate key here is the driver's 409, as it is for any create.
        let writeId = id;
        if ((status === "new" || status === "copy") && !upsert && isPresentKey(id) && runtime) {
            updatedValues = {
                ...updatedValues,
                ...parseIdValues(id, keysOfTable(runtime, this.registry))
            } as Partial<EntityValues<M>>;
            writeId = undefined;
        }

        // For an upsert whose INSERT meets a stored row anyway — one the read
        // above could not see, or one inserted concurrently — what the
        // conflict-update may set: what the caller sent, what a hook wrote, and
        // the update stamps. Everything else here the create alone decided
        // (declared defaults, a tenant stamp; the create-time stamps are left
        // out by the persistence layer), and a stored row keeps its own.
        const insertOnlyKeys = upserting
            ? insertOnlyKeysOf(updatedValues, values, beforeHooks, afterHooks, writtenTable)
            : undefined;
        // A stamped soft-delete field may create a row already trashed, and
        // may not trash a stored one: that is a delete (see
        // `assertUpdateDoesNotSoftDelete`).
        const softDeleteField = resolveSoftDelete(runtime)?.field;
        if (insertOnlyKeys && softDeleteField
            && updatedValues[softDeleteField] !== undefined && updatedValues[softDeleteField] !== null) {
            insertOnlyKeys.push(softDeleteField);
        }

        try {
            const persistOptions = {
                upsert: upserting,
                onConflict,
                insertOnlyKeys,
                unreadRow,
                commitsTransaction: this.lastWriteCommits(runtime, hooks)
            };
            const storedRow = upserting && rule
                ? await this.dataService.saveUnlessKept<M>(path, updatedValues, writeId, undefined, { ...persistOptions, ...rule })
                : await this.dataService.save<M>(path, updatedValues, writeId, undefined, persistOptions);
            // Left as it was by the conflict rule: nothing was written.
            if (!storedRow) return undefined;

            // Two rows from here on, and which one goes where is the point.
            // `storedRow` is what the table now holds: `afterSave` judges it,
            // history records it, its address is derived from it. `savedRow` is
            // what the CALLER reads — `afterRead`'s view, for the response and
            // its realtime echo. They used to be one variable, so a masking
            // `afterRead` (`email` → `********`) was what history recorded and
            // what a revert then wrote into the column, and a computed field it
            // added made every version un-revertable. A copy goes in, so an
            // `afterRead` that edits its argument in place edits only the view.
            const savedRow = await this.viewOfSavedRow(storedRow, path, hooks, contextForCallback);

            // The row is exactly its columns, so its address is derived, not read
            // off it: `storedRow.id` is undefined for every table whose key is not
            // literally named `id`, and is ordinary data for a table that has such
            // a column without it being the key. From the stored row: an
            // `afterRead` may reshape or mask the key columns of the view.
            const savedId = runtime ? deriveRowAddress(storedRow, runtime, this.registry) : "";
            // `values` are the row's columns — all of them, as stored. For an
            // `id`-keyed table that includes `id`, which used to be stripped here
            // because it was the synthesized address rather than the column it now is.
            const savedValues = storedRow;

            // `afterSave` runs INSIDE the write's transaction and is awaited, so a
            // throw here rolls the row back — the write and its consequences
            // commit together or not at all. That is the contract the docs state,
            // and it only holds if the throw is answerable: routed through the
            // same `toCallbackError` path a `before*` hook uses, it becomes a 400
            // `CALLBACK_REJECTED` naming the stage instead of a masked 500 whose
            // message only the server log ever sees. Side effects that must not
            // hold a transaction open (HTTP calls, mail) belong in a job — one
            // enqueued in a transaction that rolls back was never enqueued.
            try {
                frame.stage = "afterSave";
                // Global, then the table's.
                await afterSave(hooks, savedId, savedValues, {
                    path,
                    id,
                    previousValues: previousValuesForHistory as Record<string, unknown> | undefined,
                    status,
                    context: contextForCallback
                });
            } catch (callbackError) {
                throw toCallbackError(callbackError, "afterSave", path);
            }

            // Awaited, inside the write's transaction, so the entry commits with
            // its row. It used to be dispatched and dropped — the promise was
            // not held, the service swallowed its own errors — which meant the
            // audit trail of a collection that opted into one had silent,
            // unbounded gaps. See `HistoryService.recordHistory` for the trade.
            if (this.historyService && runtime?.descriptor.history) {
                await this.historyService.recordHistory({
                    // The collection's slug, which is what the history route
                    // reads — not the path the write came in on. Keyed by
                    // `owners/1/docs`, a write made through a parent never
                    // appeared in the row's own history.
                    tableName: runtime.slug,
                    id: savedId,
                    action: status === "existing" ? "update" : "create",
                    values: savedValues as Record<string, unknown>,
                    previousValues: previousValuesForHistory as Record<string, unknown> | undefined,
                    updatedBy: this.user?.uid
                });
            }

            // Notify real-time subscribers (deferred if inside a transaction)
            const notifications: PostgresBackendDriver["_pendingNotifications"] = [{
                path,
                id: savedId,
                row: savedRow,
                databaseId: undefined
            }, ...this.childListNotifications(runtime, savedId, updatedValues as Record<string, unknown>)];
            if (this._deferNotifications) {
                this._pendingNotifications.push(...notifications);
            } else {
                for (const notification of notifications) {
                    await this.realtimeService.notifyUpdate(
                        notification.path,
                        notification.id,
                        notification.row,
                        notification.databaseId
                    );
                }
            }

            return savedRow;
        } catch (error) {
            if (hasRowHook(hooks, "afterSaveError")) {
                // Global, then the table's — each on its own, and guarded: a
                // hook that throws cannot replace the failure the caller is
                // owed with its own. `error` is what the hook exists to see;
                // `id` is the caller's when there is one, and `previousValues`
                // whatever the pre-write read managed to fetch.
                const runHooks = (context: RebaseCallContext) => afterSaveError(
                    hooks,
                    updatedValues as Record<string, unknown>,
                    error,
                    {
                        path,
                        id,
                        previousValues: previousValuesForHistory as Record<string, unknown> | undefined,
                        status,
                        context
                    },
                    (tier, hookError) => logger.error(`[save] The ${tier} afterSaveError hook for "${path}" threw; answering with the save's own failure`, { error: hookError })
                );
                // The hook is for alerting, and the documented way to alert is
                // a job. Inside a request's write it waits for that write's
                // transaction to end: it used to run inside it, so what it
                // enqueued rode the transaction this failure rolls back, and
                // vanished with it. Run after, it commits on its own.
                if (!currentWriteScope()?.afterSettled(runHooks)) {
                    frame.stage = "afterSaveError";
                    await runHooks(contextForCallback);
                }
            }
            throw error;
        }
    }

    /**
     * Write many rows through the same pipeline as {@link save}.
     *
     * The batch runs in one transaction of its own, so a failure part-way leaves
     * nothing behind — the point of a batch is that a re-run starts from a known
     * state. When this driver is already inside a transaction (the authenticated
     * path, via `withTransaction`) the nested call becomes a savepoint, which is
     * still atomic and still commits once.
     *
     * Rows are applied in order, so a batch that touches the same key twice ends
     * with the last write winning, exactly as separate calls would.
     */
    /**
     * Run a batch in one transaction of its own, on a driver bound to it, and
     * tell realtime subscribers about its rows only once it has committed.
     *
     * Inside a request's transaction the events already wait for that one to
     * commit, and the batch adds to its list. On the server's own driver they
     * did not wait at all: each row was announced as it was written, before
     * the COMMIT — a subscriber's refetch found nothing yet, and a batch that
     * then rolled back had announced rows that never existed.
     */
    private async inBatchTransaction<T>(run: (txDriver: PostgresBackendDriver) => Promise<T>): Promise<T> {
        const ownNotifications = !this._deferNotifications;
        const pending: PostgresBackendDriver["_pendingNotifications"] = ownNotifications ? [] : this._pendingNotifications;
        const result = await this.db.transaction(async (tx) => {
            const txDriver = this.bindToTransaction(tx);
            txDriver._deferNotifications = true;
            txDriver._pendingNotifications = pending;
            return run(txDriver);
        });
        if (ownNotifications) {
            for (const notification of pending) {
                try {
                    await this.realtimeService.notifyUpdate(
                        notification.path, notification.id, notification.row, notification.databaseId
                    );
                } catch (error) {
                    logger.error("[DataDriver] Error flushing deferred notification", { error });
                }
            }
        }
        return result;
    }

    private bindToTransaction(tx: DrizzleClient): PostgresBackendDriver {
        // Bind the whole batch to the transaction handle. Without this the rows
        // would be written through `this.db` and survive a rollback.
        const txDriver = new PostgresBackendDriver(
            tx, this.realtimeService, this.registry, this.user, this.poolManager, this.historyService
        );
        txDriver.dataService = new DataService(tx, this.registry, () => {
            // Asked for by a `beforeQuery` about to run: application code.
            currentWriteScope()?.noteApplicationCode();
            return txDriver.buildCallContext();
        });
        txDriver.client = this.client;
        // Carry the caller's notification batching through, so a bulk write
        // nested in an outer transaction still holds its events until commit.
        txDriver._deferNotifications = this._deferNotifications;
        txDriver._pendingNotifications = this._pendingNotifications;
        return txDriver;
    }

    /**
     * The callback context for work already running inside `tx` on behalf of
     * `user` — for a caller that opened the user-scoped transaction itself.
     *
     * The realtime refetch is that caller: it applies the subscriber's auth
     * context and role switch on its own connection. Its `afterRead` hooks used
     * to get a context assembled by hand, and it was wrong in both directions:
     * `data` was THIS driver's — the base one, on the owner connection, outside
     * that transaction — so a hook reading related rows through `context.data`
     * bypassed RLS on every subscription frame while the REST read of the same
     * rows did not; and `client` and `storageSource` were absent, though the
     * type promises both. This builds the context the REST path builds, bound to
     * the transaction the rows came from.
     */
    callContextWithin(tx: DrizzleClient, user: User): RebaseCallContext {
        const txDriver = new PostgresBackendDriver(
            tx, this.realtimeService, this.registry, user, this.poolManager, this.historyService
        );
        txDriver.dataService = new DataService(tx, this.registry, () => {
            // Asked for by a `beforeQuery` about to run: application code.
            currentWriteScope()?.noteApplicationCode();
            return txDriver.buildCallContext();
        });
        txDriver.client = this.client;
        return txDriver.buildCallContext();
    }

    async saveMany<M extends Record<string, unknown>>({
                                                          path,
                                                          rows,
                                                          upsert,
                                                          onConflict,
                                                          conflictWhere,
                                                          ignoreDuplicates
                                                      }: SaveManyProps<M>): Promise<Record<string, unknown>[]> {
        this.assertWritable(path);
        // A conflict rule shapes what an upsert does to a stored row; on an
        // insert there is no conflict for it to shape.
        if ((conflictWhere || ignoreDuplicates) && upsert !== true) {
            throw ApiError.badRequest(
                "`ignoreDuplicates` and `where` describe what an upsert does to a row already on its conflict target; " +
                "pass them with `upsert: true`.",
                "INVALID_CONFLICT_RULE"
            );
        }
        if (conflictWhere && ignoreDuplicates) {
            throw ApiError.badRequest(
                "`ignoreDuplicates` leaves every stored row as it is, so a `where` choosing which ones to update has nothing to choose. Pass one of the two.",
                "INVALID_CONFLICT_RULE"
            );
        }
        const rule: ConflictRule | undefined = conflictWhere || ignoreDuplicates ? { conflictWhere, ignoreDuplicates } : undefined;
        const commitsWithLastWrite = this._commitsWithLastWrite;
        // Together first, in a transaction of its own; a batch the database
        // refuses is undone whole and replayed row by row below, which names
        // the row that fails.
        if (rows.length > 1 && this.writesRowsTogether(path)) {
            try {
                const together = await this.inBatchTransaction(txDriver => {
                    txDriver._commitsWithLastWrite = commitsWithLastWrite;
                    return txDriver.saveRowsTogether<M>(path, rows, upsert === true, onConflict, rule);
                });
                if (together) return together;
            } catch (error) {
                logger.debug(`[saveMany] A batch write to "${path}" failed; saving its rows one by one to name the row`, {
                    detail: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return this.inBatchTransaction(async (txDriver) => {

            const saved: Record<string, unknown>[] = [];

            for (let i = 0; i < rows.length; i++) {
                const values = rows[i];
                const id = (values as Record<string, unknown>)?.id as string | number | undefined;
                // A batch of one may send its COMMIT with the row's statement. In
                // a longer one the last row's statement may still fail to write
                // (a 404, a refusal) after the rows before it, which then must
                // not have committed.
                txDriver._commitsWithLastWrite = commitsWithLastWrite && rows.length === 1;
                try {
                    const row = await txDriver.saveRowUnlessKept<M>({
                        path,
                        values,
                        // No `id` argument, deliberately: passing one selects the
                        // UPDATE path, and an import's rows usually carry a natural
                        // key for a row that does not exist yet — which would 404 on
                        // every one. Leaving the key inside `values` is what
                        // single-row `create(data, id)` does, and it inserts.
                        // Callers who want existing rows overwritten pass `upsert`.
                        status: "new",
                        upsert,
                        onConflict
                    }, rule);
                    if (row) saved.push(row);
                } catch (error) {
                    // One bad row in ten thousand is impossible to find from a
                    // message that only says the batch failed. Say which row, and
                    // keep the original error as the cause so its status survives.
                    const label = id !== undefined ? `id ${JSON.stringify(id)}` : "no id";
                    throw Object.assign(
                        new Error(`Row ${i} of ${rows.length} (${label}) failed: ${(error as Error)?.message ?? error}`, { cause: error }),
                        {
                            statusCode: (error as { statusCode?: number })?.statusCode,
                            code: (error as { code?: string })?.code,
                            name: (error as Error)?.name
                        }
                    );
                }
            }

            return saved;
        });
    }

    /**
     * Whether {@link saveMany} may write a collection's rows together
     * ({@link saveRowsTogether}): no `beforeSave`, `afterSave` or
     * `afterSaveError` hook, no history and no tenancy, at its own path. A
     * hook runs once per row between that row's writes, and history and
     * tenancy read per row, so those batches keep the row-by-row pipeline.
     */
    private writesRowsTogether(path: string): boolean {
        const resolved = this.tableAt(path);
        if (!resolved || isNestedPath(path) || resolved.descriptor.history || tenantOf(resolved.descriptor)) return false;
        const hooks = this.hooksAt(path);
        return !hasBeforeSave(hooks) && !hasRowHook(hooks, "afterSave") && !hasRowHook(hooks, "afterSaveError");
    }

    /**
     * {@link saveMany}'s rows written together, a few multi-row statements in
     * place of one statement per row (`PersistService.saveRows`), and answered
     * as {@link save} answers each: defaults and stamps applied,
     * the stored row through `afterRead`, a realtime event per row.
     *
     * For a collection {@link writesRowsTogether} allows; `undefined`, before
     * anything is written, for a batch `saveRows` declines. Its realtime events
     * join the transaction's only once every row is answered.
     */
    private async saveRowsTogether<M extends Record<string, unknown>>(
        path: string,
        rows: readonly Partial<EntityValues<M>>[],
        upsert: boolean,
        onConflict: readonly string[] | undefined,
        rule?: ConflictRule
    ): Promise<Record<string, unknown>[] | undefined> {
        const resolved = this.tableAt(path);
        if (!resolved) return undefined;
        const hooks = this.hooksAt(path);

        // What `saveInFrame` does to a new row with no hooks to run: the
        // declared defaults, then the stamps, and for an upsert the keys its
        // conflict-update must leave alone.
        const runtimeTable = resolved;
        const softDeleteField = resolveSoftDelete(runtimeTable)?.field;
        const prepared = rows.map(values => {
            const withDefaults = applyCreateDefaults(runtimeTable.descriptor, values as Record<string, unknown>) as Partial<EntityValues<M>>;
            const stamped = this.stampWrite(resolved, withDefaults, "new", path) as Record<string, unknown>;
            const insertOnlyKeys = upsert
                ? insertOnlyKeysOf(stamped, values, withDefaults as Record<string, unknown>, withDefaults as Record<string, unknown>, runtimeTable.descriptor)
                : undefined;
            if (insertOnlyKeys && softDeleteField && stamped[softDeleteField] !== undefined && stamped[softDeleteField] !== null) {
                insertOnlyKeys.push(softDeleteField);
            }
            return { values: stamped, insertOnlyKeys };
        });

        const stored = await this.dataService.getPersistService().saveRows(path, prepared, {
            upsert,
            onConflict,
            ...rule,
            commitsTransaction: this.lastWriteCommits(resolved, hooks)
        });
        if (!stored) return undefined;
        // The rows a conflict rule kept were not written, and are not answered.
        const written = stored.flatMap((row, i) => row ? [{ row, values: prepared[i].values }] : []);
        return this.answerRowsWritten(written.map(entry => entry.row), written.map(entry => entry.values), resolved, path, hooks);
    }

    /**
     * {@link updateMany}'s updates written together (`PersistService.updateRows`)
     * and answered as {@link save} answers each: the update stamps
     * applied, the stored row through `afterRead`, a realtime event per row.
     * For a collection {@link writesRowsTogether} allows; `undefined`, before
     * anything is written, for updates `updateRows` declines.
     */
    private async updateRowsTogether<M extends Record<string, unknown>>(
        path: string,
        updates: UpdateManyProps<M>["updates"]
    ): Promise<Record<string, unknown>[] | undefined> {
        const resolved = this.tableAt(path);
        if (!resolved) return undefined;
        const prepared = updates.map(({ id, values }) => {
            assertUpdateDoesNotSoftDelete(resolved, values as Record<string, unknown>, path);
            assertKeyUnchanged(resolved, this.registry, String(id), values as Record<string, unknown>, path);
            return { id, values: this.stampWrite(resolved, values, "existing", path) as Record<string, unknown> };
        });
        const stored = await this.dataService.getPersistService().updateRows(path, prepared);
        if (!stored) return undefined;
        return this.answerRowsWritten(stored, prepared.map(row => row.values), resolved, path, this.hooksAt(path));
    }

    /**
     * Rows a batch wrote, answered as {@link save} answers one: each through
     * `afterRead`, and a realtime event per row, joining the transaction's
     * only once every row is answered.
     */
    private async answerRowsWritten(
        stored: Record<string, unknown>[],
        written: Record<string, unknown>[],
        table: RuntimeTable,
        path: string,
        hooks: TableHookSet
    ): Promise<Record<string, unknown>[]> {
        const context = this.buildCallContext();
        const primaryKeys = getPrimaryKeys(table, this.registry);
        const saved: Record<string, unknown>[] = [];
        const notifications: PostgresBackendDriver["_pendingNotifications"] = [];
        for (let i = 0; i < stored.length; i++) {
            const storedRow = stored[i];
            const savedRow = await this.viewOfSavedRow(storedRow, path, hooks, context);
            const savedId = deriveRowAddress(storedRow, table, this.registry, primaryKeys);
            notifications.push(
                { path, id: savedId, row: savedRow, databaseId: undefined },
                ...this.childListNotifications(table, savedId, written[i])
            );
            saved.push(savedRow);
        }
        if (this._deferNotifications) {
            this._pendingNotifications.push(...notifications);
        } else {
            for (const notification of notifications) {
                await this.realtimeService.notifyUpdate(notification.path, notification.id, notification.row, notification.databaseId);
            }
        }
        return saved;
    }

    /**
     * Update many rows through the same pipeline as {@link save}, in one
     * transaction.
     *
     * Structurally the mirror of {@link saveMany} — same tx-bound sub-driver,
     * same deferred notifications, same per-row error labelling — but it calls
     * `save` with an explicit `id` and `status: "existing"`, which is precisely
     * what `saveMany` cannot do: that one passes `status: "new"` and keeps the
     * key inside `values`, so it inserts or upserts and can never target a
     * particular row.
     *
     * All-or-nothing, so an id matching no row aborts the batch. A partial
     * update is the outcome with no good recovery: the caller cannot tell which
     * half landed without re-reading everything.
     */
    async updateMany<M extends Record<string, unknown>>({
        path,
        updates
    }: UpdateManyProps<M>): Promise<Record<string, unknown>[]> {
        this.assertWritable(path);
        const commitsWithLastWrite = this._commitsWithLastWrite;
        // Together first, as `saveMany` does: one statement per run of updates
        // that set the same columns. Refused or partly matched, the batch is
        // undone and replayed one by one below, which names the entry and why.
        if (updates.length > 1 && this.writesRowsTogether(path)) {
            try {
                const together = await this.inBatchTransaction(txDriver => txDriver.updateRowsTogether<M>(path, updates));
                if (together) return together;
            } catch (error) {
                logger.debug(`[updateMany] A batch update of "${path}" failed; updating its rows one by one to name the row`, {
                    detail: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return this.inBatchTransaction(async (txDriver) => {

            const saved: Record<string, unknown>[] = [];

            for (let i = 0; i < updates.length; i++) {
                const { id, values } = updates[i];
                // A batch of one only: see `saveMany`.
                txDriver._commitsWithLastWrite = commitsWithLastWrite && updates.length === 1;
                try {
                    // A missing row is a 404 rather than a silent no-op, judged
                    // on the read `save` makes of the row it updates (a restore
                    // reading the trash too). That read used to be preceded by
                    // one of its own here, through the admin view-model walk,
                    // which loaded every declared relation of the row — every
                    // comment of a post — to learn that it existed.
                    saved.push(await txDriver.save<M>({
                        path,
                        id: String(id),
                        values,
                        status: "existing",
                        precondition: { check: stored => assertBatchRowFound(stored, id) }
                    }));
                } catch (error) {
                    // Say which entry, as saveMany does: "the batch failed" is
                    // unactionable at a thousand rows.
                    throw Object.assign(
                        new Error(`Update ${i} of ${updates.length} (id ${JSON.stringify(id)}) failed: ${(error as Error)?.message ?? error}`, { cause: error }),
                        {
                            statusCode: (error as { statusCode?: number })?.statusCode,
                            code: (error as { code?: string })?.code,
                            name: (error as Error)?.name
                        }
                    );
                }
            }

            return saved;
        });
    }

    /**
     * Delete many rows in one transaction, running the full delete pipeline —
     * `beforeDelete`, the delete, `afterDelete` — for each.
     *
     * Looping the single-row {@link delete} rather than emitting one
     * `DELETE ... WHERE id = ANY($1)` is the deliberate choice: a single
     * statement would be faster and would skip every callback, so a collection
     * relying on `beforeDelete` to veto or on `afterDelete` to clean up
     * dependents would behave differently depending on how many rows the caller
     * happened to delete at once. Same pipeline, one transaction.
     */
    async deleteMany<M extends Record<string, unknown>>({
        path,
        ids,
        hard
    }: DeleteManyProps<M>): Promise<void> {
        this.assertWritable(path);
        const commitsWithLastWrite = this._commitsWithLastWrite;
        await this.inBatchTransaction(async (txDriver) => {

            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                // A batch of one only: see `saveMany`.
                txDriver._commitsWithLastWrite = commitsWithLastWrite && ids.length === 1;
                try {
                    // No read first: `delete` reads the row itself, and an id
                    // that matches nothing is its 404, which rolls the batch
                    // back like any other failure.
                    await txDriver.delete<M>({
                        row: { id: String(id), path },
                        hard
                    });
                } catch (error) {
                    throw Object.assign(
                        new Error(`Delete ${i} of ${ids.length} (id ${JSON.stringify(id)}) failed: ${(error as Error)?.message ?? error}`, { cause: error }),
                        {
                            statusCode: (error as { statusCode?: number })?.statusCode,
                            code: (error as { code?: string })?.code,
                            name: (error as Error)?.name
                        }
                    );
                }
            }
        });
    }

    /**
     * Update every row a filter matches. One statement (`PersistService.updateWhere`)
     * when nothing needs the rows one by one; otherwise the rows the caller
     * reads through the filter, updated by {@link updateMany} through the full
     * pipeline, in one transaction. A filter matching nothing answers `[]`.
     */
    async updateWhere<M extends Record<string, unknown>>({
        path,
        filter,
        logical,
        values
    }: UpdateWhereProps<M>): Promise<Record<string, unknown>[]> {
        this.assertWritable(path);
        const resolved = this.assertFilteredWrite(this.tableAt(path), path, filter, logical);
        const written = values as Record<string, unknown>;
        assertUpdateDoesNotSoftDelete(resolved, written, path);
        const keys = keysOfTable(resolved, this.registry).map(key => key.fieldName).filter(field => written[field] !== undefined);
        if (keys.length > 0) {
            throw ApiError.badRequest(
                `'${keys[0]}' is the key of '${resolved.slug}', and an update cannot change it — a filtered one least of all, ` +
                "which would give every row it matches the same key.",
                "KEY_IMMUTABLE",
                { collection: resolved.slug, violations: keys.map(field => ({ field, code: "key_immutable" })) }
            );
        }
        const hooks = this.hooksAt(path);
        if (!this.writeReadsStoredRow(resolved, path, hooks)) {
            const stamped = this.stampWrite(resolved, values, "existing", path) as Record<string, unknown>;
            const stored = await this.dataService.getPersistService().updateWhere(path, filter, logical, stamped, {
                commitsTransaction: this.lastWriteCommits(resolved, hooks)
            });
            if (stored) return this.answerRowsWritten(stored, stored.map(() => stamped), resolved, path, hooks);
        }
        const ids = await this.addressesMatching(resolved, path, filter, logical);
        if (ids.length === 0) return [];
        return this.updateMany<M>({ path, updates: ids.map(id => ({ id, values })) });
    }

    /**
     * Delete every row a filter matches, under the rules of {@link updateWhere}:
     * one `DELETE` when nothing needs the rows one by one, else
     * {@link deleteMany} over the rows the caller reads through the filter.
     * Answers how many rows went.
     */
    async deleteWhere<M extends Record<string, unknown>>({
        path,
        filter,
        logical,
        hard
    }: DeleteWhereProps<M>): Promise<number> {
        this.assertWritable(path);
        const resolved = this.assertFilteredWrite(this.tableAt(path), path, filter, logical);
        const softDeleting = !hard && resolveSoftDelete(resolved) !== undefined;
        if (!softDeleting && !resolved.descriptor.history && !declaresAnyHook(this.hooksAt(path))) {
            const deleted = await this.dataService.getPersistService().deleteWhere(path, filter, logical, {
                commitsTransaction: this.lastWriteCommits(resolved)
            });
            const notifications = deleted.map(row => ({
                path,
                id: deriveRowAddress(row, resolved, this.registry),
                row: null,
                databaseId: undefined
            }));
            if (this._deferNotifications) {
                this._pendingNotifications.push(...notifications);
            } else {
                for (const notification of notifications) {
                    await this.realtimeService.notifyUpdate(notification.path, notification.id, null, notification.databaseId);
                }
            }
            return deleted.length;
        }
        const ids = await this.addressesMatching(resolved, path, filter, logical);
        if (ids.length === 0) return 0;
        await this.deleteMany<M>({ path, ids, hard });
        return ids.length;
    }

    /**
     * A row's address in the spelling a read derives it in — `010` is row
     * `10` — for an event about a row this write did not read.
     */
    private canonicalAddress(table: RuntimeTable | undefined, id: string | number): string {
        if (!table) return String(id);
        try {
            return deriveRowAddress(parseIdValues(id, getPrimaryKeys(table, this.registry)), table, this.registry) || String(id);
        } catch {
            return String(id);
        }
    }

    /**
     * The table a filtered write addresses, refused when it cannot be
     * one: a path through a relation (a filter there would reach rows the
     * path does not), or a filter with no condition (every row).
     */
    private assertFilteredWrite(
        table: RuntimeTable | undefined,
        path: string,
        filter: FilterValues<string> | undefined,
        logical: LogicalCondition | undefined
    ): RuntimeTable {
        if (!table || isNestedPath(path)) {
            throw ApiError.badRequest(
                `A filtered write addresses a collection, and "${path}" is ${table ? "a path through a relation" : "not one"}. ` +
                "Write to the related collection with a filter on its link instead.",
                "INVALID_FILTERED_WRITE"
            );
        }
        if ((!filter || Object.keys(filter).length === 0) && !logical) throw filterRequired(path);
        return table;
    }

    /**
     * The addresses of the rows a filter matches, read as this caller reads
     * them — their policies, their `beforeQuery`, the trash hidden — for a
     * filtered write that runs row by row.
     */
    private async addressesMatching(
        table: RuntimeTable,
        path: string,
        filter: FilterValues<string> | undefined,
        logical: LogicalCondition | undefined
    ): Promise<string[]> {
        const primaryKeys = getPrimaryKeys(table, this.registry);
        const rows = await this.dataService.getFetchService().fetchCollectionForRest(path, {
            filter,
            logical,
            fields: primaryKeys.map(key => key.fieldName)
        });
        return rows.map(row => deriveRowAddress(row, table, this.registry, primaryKeys));
    }

    /**
     * A mixed list of writes across collections, as one unit of work.
     *
     * Same transaction, same tx-bound sub-driver and same per-entry error
     * labelling as {@link saveMany} — deliberately the same plumbing rather
     * than a second copy of it, because the three ways this could drift
     * (notifications not deferred, the sub-driver not bound, an error losing
     * its status) are all silent.
     *
     * The one thing this adds is `$ref`. An operation may name itself, and a
     * later one may stand a `{ "$ref": "order.id" }` where a value goes; the
     * substitution happens here because inside the transaction is the only
     * place the row the reference points at exists. Backward references only —
     * the REST layer refuses a forward one before the transaction opens, so a
     * body that cannot work never costs a rollback.
     */
    async batchWrite<M extends Record<string, unknown>>({
        operations
    }: BatchWriteProps<M>): Promise<(Record<string, unknown> | null)[]> {
        return this.inBatchTransaction(async (txDriver) => {

            const results: (Record<string, unknown> | null)[] = [];
            /** What each named operation wrote, for the `$ref`s after it. */
            const named = new Map<string, Record<string, unknown>>();

            for (let i = 0; i < operations.length; i++) {
                const operation = operations[i];
                try {
                    const values = operation.values
                        ? resolveBatchRefs(operation.values, named) as Partial<EntityValues<M>>
                        : undefined;
                    const rawId = operation.id !== undefined
                        ? resolveBatchRefs(operation.id, named)
                        : undefined;
                    const id = rawId === undefined || rawId === null ? undefined : String(rawId);
                    // The envelope check saw an id here, but a `$ref` is only
                    // resolved now, and one naming a NULL field resolves to
                    // nothing. An update without an id is an INSERT to the
                    // layers below, so it is refused rather than handed on.
                    if ((operation.op === "update" || operation.op === "delete") && (id === undefined || id === "")) {
                        throw ApiError.badRequest(
                            `This ${operation.op} has no id: its \`id\` resolved to ${rawId === "" ? "an empty string" : String(rawId)}.`,
                            "INVALID_BATCH_REF"
                        );
                    }

                    let row: Record<string, unknown> | null = null;
                    switch (operation.op) {
                        case "create":
                            row = await txDriver.save<M>({
                                path: operation.path,
                                values: values ?? ({} as Partial<EntityValues<M>>),
                                status: "new"
                            });
                            break;
                        case "upsert":
                            row = await txDriver.save<M>({
                                path: operation.path,
                                values: values ?? ({} as Partial<EntityValues<M>>),
                                status: "new",
                                upsert: true,
                                onConflict: operation.onConflict
                            });
                            break;
                        case "update": {
                            // An id matching no row is a 404 rather than an
                            // UPDATE that matches nothing and reports success —
                            // the same rule `updateMany` and the single-row
                            // route apply, on the read `save` makes anyway.
                            row = await txDriver.save<M>({
                                path: operation.path,
                                id: id!,
                                values: values ?? ({} as Partial<EntityValues<M>>),
                                status: "existing",
                                precondition: { check: stored => assertBatchRowFound(stored, id) }
                            });
                            break;
                        }
                        case "delete":
                            // `delete` reads the row itself and 404s on a miss.
                            await txDriver.delete<M>({
                                row: { id: id!, path: operation.path }
                            });
                            row = null;
                            break;
                    }

                    if (operation.ref && row) named.set(operation.ref, row);
                    results.push(row);
                } catch (error) {
                    // Which operation, as the bulk methods say which row: a
                    // batch mixes collections, so "the batch failed" does not
                    // even say which table to go and look at.
                    throw Object.assign(
                        new Error(
                            `Operation ${i} of ${operations.length} (${operation.op} on "${operation.path}") failed: `
                            + `${(error as Error)?.message ?? error}`,
                            { cause: error }
                        ),
                        {
                            statusCode: (error as { statusCode?: number })?.statusCode,
                            code: (error as { code?: string })?.code,
                            name: (error as Error)?.name
                        }
                    );
                }
            }

            return results;
        });
    }

    async delete<M extends Record<string, unknown>>(props: DeleteProps<M>): Promise<void> {
        this.assertWritable(props.row.path);
        // A frame per write, as `save` has: see `write-depth.ts`.
        return inWriteFrame(props.row.path, "delete", frame => this.deleteInFrame(props, frame));
    }

    private async deleteInFrame<M extends Record<string, unknown>>({
                                                              row,
                                                              hard,
                                                              precondition
                                                          }: DeleteProps<M>, frame: WriteFrame): Promise<void> {

        const targetPath = row.path;

        // The hooks come from the compiled table in the registry, never from
        // the collection a caller (a socket frame) handed in.
        const runtime = this.tableAt(targetPath);
        const hooks = this.hooksAt(targetPath);
        if (declaresAnyHook(hooks)) currentWriteScope()?.noteApplicationCode();

        // Through a many-to-many path the target row is not what is deleted —
        // see `unlinking` below — and an unlink is no entry in its history.
        const hop = isNestedPath(targetPath) ? resolveNestedPath(targetPath, this.registry) : undefined;
        const unlinking = hop !== undefined && isJunctionBackedRelation(hop.relation);
        // Before anything runs, as `save` does.
        if (runtime?.descriptor.history && !unlinking) this.historyService?.assertRecordable(runtime.slug);

        // The row being deleted is read here, from the database, by this
        // driver — which on a user request is bound to that user's
        // transaction, so the read sees what their policies let them see. It
        // is what the callbacks judge and what history records. It used to
        // come in on the props, and over the WebSocket the props were the
        // client's frame: the caller wrote the audit record of their own
        // deletion, and a `beforeDelete` refusing on a column was bypassed by
        // sending `values: {}`. The in-process SDK sent `{}` on every delete.
        //
        // The same read the REST route makes, `withDeleted` included: a hard
        // delete of a row already in the trash is how the trash is emptied.
        //
        // Raw, not through `this.fetchOne`: that runs `afterRead`, which shapes
        // what a caller reads — and its view (a masked `email`, a computed
        // field) is not the row being deleted. It was what the delete hooks
        // judged and what history recorded as the row's final state.
        //
        // And the row as REST serves it — columns, dates as timestamps, a
        // foreign key as a key — which is what a save hands the same hooks and
        // history. The admin's view-model walk wrapped every date as
        // `{ __type: "date" }` and every relation in a ref carrying the related
        // row, and that is what the delete's history entry held: a revert to
        // it handed the envelope to Postgres as the column's value.
        //
        // A caller's `precondition` (the REST route's 404 and `If-Match`)
        // judges this same read, after the row is locked when it asks for that.
        // Nothing to judge and nothing to record: the DELETE is the read. A
        // row that is not there (or not the caller's) is its 404, answered as
        // the read would have answered it — see `explainZeroRowWrite` — and
        // the row's address comes back from the statement.
        const softDeleting = !hard && !unlinking && resolveSoftDelete(runtime) !== undefined;
        if (!precondition && !hop && !softDeleting && !runtime?.descriptor.history
            && !declaresAnyHook(hooks)) {
            await this.dataService.delete(targetPath, row.id, undefined, {
                commitsTransaction: this.lastWriteCommits(runtime)
            });
            const deletedAddress = this.canonicalAddress(runtime, row.id);
            const notification = { path: targetPath, id: deletedAddress, row: null, databaseId: undefined };
            if (this._deferNotifications) this._pendingNotifications.push(notification);
            else await this.realtimeService.notifyUpdate(notification.path, notification.id, null, notification.databaseId);
            return;
        }

        if (precondition?.lock) await this.dataService.getPersistService().lockRow(targetPath, row.id);
        const stored = await this.dataService.fetchOneForRest<M>(
            targetPath,
            row.id,
            undefined,
            undefined,
            { withDeleted: hard ? true : undefined }
        );
        if (precondition) await precondition.check(await this.asRestServes(stored, targetPath));
        // Not found is answered before any callback runs: a callback handed a
        // row that is not there — or not there for this caller — would be
        // judging something it cannot see.
        if (!stored) {
            throw ApiError.notFound(`No row "${row.id}" in "${targetPath}" to delete.`);
        }
        // The hooks' `values` is the row: its columns, nothing else. The address
        // travels beside it as `id`, so merging it in here only ever invented an
        // `id` field for tables that have no such column. A copy, so a hook
        // that edits it does not edit what history records.
        const targetRow: Record<string, unknown> = { ...stored };
        // The row's address, derived from the row as a save's is — what its
        // history entry and its realtime event are keyed by. Not `row.id`, the
        // caller's spelling: `010` finds row 10, and an entry keyed `010` is
        // one `GET /docs/10/history` never shows.
        const address = (runtime
            ? deriveRowAddress(stored, runtime, this.registry)
            : "") || row.id.toString();

        const contextForCallback = this.buildCallContext();

        // A `before*` callback is the application speaking, not the server
        // failing: a bare `throw` is the documented way to block a write, so it
        // answers 400 with the author's message rather than a masked 500.
        try {
            frame.stage = "beforeDelete";
            // Global, then the table's; every tier runs, and any `false` vetoes.
            if (await beforeDeleteVetoes(hooks, { path: targetPath, id: row.id, values: targetRow, context: contextForCallback })) {
                // A veto, not a silent no-op. Returning early left the route
                // answering `204 No Content` — "the row is gone" — for a row
                // that is still there, so the panel dropped it from the list
                // and the next reload brought it back. Same code a throw
                // produces, so one branch handles both.
                throw callbackRefusal("beforeDelete", targetPath);
            }
        } catch (callbackError) {
            throw toCallbackError(callbackError, "beforeDelete", targetPath);
        }

        // A soft delete is a delete as far as everything above this line is
        // concerned — `beforeDelete` can still veto it, `afterDelete` still
        // fires, the realtime event below still says the row is gone. What
        // changes is only how the table records it: a timestamp in the declared
        // field instead of a `DELETE`. `hard` opts back into the real thing and
        // needs no extra permission, because it is the same verb.
        //
        // Through a many-to-many path the target row is not what is deleted:
        // it is shared, and the delete removes this parent's link to it (the
        // persistence layer's rule for a junction). Its collection's soft
        // delete says how *its* rows are removed, which this is not — stamped
        // here, it trashed the tag for every post and re-asserted the link.
        const softDelete = hard || unlinking
            ? undefined
            : resolveSoftDelete(runtime);
        if (softDelete) {
            await this.dataService.save(
                targetPath,
                { [softDelete.field]: new Date() } as Partial<EntityValues<M>>,
                row.id,
                undefined
            );
        } else {
            await this.dataService.delete(
                targetPath,
                row.id,
                undefined
            );
        }

        // Same contract as `afterSave`: inside the transaction, awaited, and a
        // throw undoes the delete rather than leaving the row gone and the
        // cleanup half-done. See the comment on the `afterSave` block.
        try {
            frame.stage = "afterDelete";
            // Global, then the table's.
            await afterDelete(hooks, { path: targetPath, id: row.id, values: targetRow, context: contextForCallback });
        } catch (callbackError) {
            throw toCallbackError(callbackError, "afterDelete", targetPath);
        }

        // Awaited, for the same reason the save's entry is: a delete is the one
        // change whose history nothing else can reconstruct, because the row it
        // describes is gone.
        // An unlink changed a parent's set, not the target row, so it is not
        // an entry in that row's history.
        if (this.historyService && runtime?.descriptor.history && !unlinking) {
            await this.historyService.recordHistory({
                // Keyed like the save's entry: the slug, whatever the path.
                tableName: runtime.slug,
                id: address,
                action: "delete",
                values: stored,
                updatedBy: this.user?.uid
            });
        }

        // Notify real-time subscribers (deferred if inside a transaction)
        if (this._deferNotifications) {
            this._pendingNotifications.push({
                path: targetPath,
                id: address,
                row: null,
                databaseId: undefined
            });
        } else {
            await this.realtimeService.notifyUpdate(
                targetPath,
                address,
                null,
                undefined
            );
        }

    }

    /**
     * The child lists a save rewrote through the parent, as notifications —
     * when nothing else will announce them.
     *
     * `save("posts", "p-1", { tags: [...] })` rewrites the junction, and
     * `{ comments: [...] }` on a `hasMany` re-points the children's foreign
     * keys: either way the contents of `posts/p-1/<relation>` changed, and the
     * row notification names the parent, whose paths land on `posts`. Under
     * change capture the junction's or the children's own triggers announce
     * it. Without capture these did not reach anyone: a live list of a post's
     * tags kept the old set. Addressed to every row of the list, which also
     * reaches the target collection's own lists — a `hasMany` changed those
     * rows' foreign keys.
     */
    private childListNotifications(
        table: RuntimeTable | undefined,
        id: string,
        values: Record<string, unknown>
    ): PostgresBackendDriver["_pendingNotifications"] {
        if (!table) return [];
        const written = Object.keys(values).filter((key) => table.relations.get(key)?.cardinality === "many");
        if (written.length === 0 || this.realtimeService.isCdcActive()) return [];
        return written.map((key) => ({
            path: `${table.slug}/${id}/${key}`,
            id: "*",
            row: { _rebase_invalidated: true },
            databaseId: undefined
        }));
    }

    /**
     * Recompute the rows of a collection that serves a materialized view,
     * on this driver's connection — the owner's on the base driver, which a
     * refresh needs: Postgres lets only a view's owner refresh it.
     */
    async refreshView(path: string, options?: { concurrently?: boolean }): Promise<void> {
        const table = this.tableAt(path)?.descriptor;
        if (!table || table.kind !== "view" || !table.view?.materialized) {
            throw ApiError.badRequest(
                `"${table?.slug ?? path}" is not a materialized view, so there is nothing to refresh.`,
                "NOT_A_MATERIALIZED_VIEW"
            );
        }
        // The stored rows, not the gate the view is named after (`view-names.ts`).
        const qualified = drizzleSql`${drizzleSql.identifier(table.schema)}.${drizzleSql.identifier(viewRowsName(table.table))}`;
        await this.db.execute(options?.concurrently
            ? drizzleSql`REFRESH MATERIALIZED VIEW CONCURRENTLY ${qualified}`
            : drizzleSql`REFRESH MATERIALIZED VIEW ${qualified}`);
        await this.realtimeService.notifyUpdate(path, "*", null);
    }

    async deleteAll(path: string): Promise<void> {
        this.assertWritable(path);
        await this.dataService.deleteAll(path);
        // Notify real-time subscribers of bulk change
        await this.realtimeService.notifyUpdate(path, "*", null);
    }

    async updateRelationPivot({ path, targetId, pivot }: UpdateRelationPivotProps): Promise<void> {
        this.assertWritable(path);
        await this.dataService.updateRelationPivot(path, targetId, pivot);
        // The junction row itself is what changed. Under change capture the
        // junction table's trigger reaches the subscribers of
        // `<parent>/<id>/<relation>` — the same route a link or an unlink
        // takes — and a notify here would only duplicate that frame. Without
        // capture nothing else will: a live list of a post's tags never saw
        // the edited link columns.
        if (this.realtimeService.isCdcActive()) return;
        const notification = { path, id: String(targetId), row: { _rebase_invalidated: true }, databaseId: undefined };
        if (this._deferNotifications) {
            this._pendingNotifications.push(notification);
        } else {
            await this.realtimeService.notifyUpdate(notification.path, notification.id, notification.row);
        }
    }

    async checkUniqueField(
        path: string,
        name: string,
        value: unknown,
        id?: string
    ): Promise<boolean> {
        return this.dataService.checkUniqueField(
            path,
            name,
            value,
            id
        );
    }

    async count<M extends Record<string, unknown>>({
                                                               path,
                                                               filter,
                                                               logical,
                                                               searchString,
                                                               vectorSearch,
                                                               withDeleted
                                                           }: FetchCollectionProps<M>): Promise<number> {
        return this.dataService.count(
            path,
            {
                filter,
                // Counted as well as filtered, or `meta.total` describes a
                // different set of rows from the `data` beside it. The same
                // held for a `vectorSearch` carrying a `threshold`: it narrows
                // the fetch, so it has to narrow the count. And the same for
                // soft delete: a listing that hides four rows and a total that
                // counts them is a page saying "1 of 5".
                logical,
                searchString,
                vectorSearch,
                withDeleted
            }
        );
    }

    /** The answer to {@link appDatabaseName}, once it has been given. */
    private appDatabase?: Promise<string>;

    /**
     * The database this driver's own connection is on: the app's, which every
     * data request and the CMS read and write.
     *
     * Asked of the connection rather than read off the admin connection
     * string, which can name another database — the server's `postgres`, or
     * the main database while this process runs on a branch. The SQL console
     * preselects this name, a statement sent to it runs on this connection,
     * and branching copies it by default.
     */
    async appDatabaseName(): Promise<string> {
        this.appDatabase ??= this.db.execute(drizzleSql.raw("SELECT current_database() AS name")).then((result) => {
            const name = result.rows?.[0]?.name;
            if (typeof name !== "string") {
                throw new Error("The database did not say which database this connection is on.");
            }
            return name;
        });
        try {
            return await this.appDatabase;
        } catch (error: unknown) {
            // Asked again next time, rather than failing every later call.
            this.appDatabase = undefined;
            throw error;
        }
    }

    private async getTargetDb(databaseName?: string): Promise<DrizzleClient> {
        if (!databaseName || databaseName === await this.appDatabaseName()) {
            return this.db;
        }
        if (!this.poolManager) {
            throw new Error(
                "Cross-database execution requires adminConnectionString to be configured in the backend."
            );
        }
        return this.poolManager.getDrizzle(databaseName);
    }

    /**
     * {@link getTargetDb} for work that needs one session from start to end:
     * the app database is reached through {@link sessionDb} when there is one.
     * Other databases come from the pool manager, whose URL is already the
     * direct one (`DATABASE_DIRECT_URL` before `DATABASE_URL`).
     */
    private async getSessionTargetDb(databaseName?: string): Promise<DrizzleClient> {
        if (this.sessionDb && (!databaseName || databaseName === await this.appDatabaseName())) {
            return this.sessionDb;
        }
        return this.getTargetDb(databaseName);
    }

    /** `SQLAdmin.poolStats`: the pools this driver opened beside the server's. */
    poolStats(): DatabasePoolStats[] {
        const stats: DatabasePoolStats[] = [];
        const replica = this.readRouter && "$client" in this.readRouter.db ? this.readRouter.db.$client : undefined;
        if (replica instanceof Pool) stats.push(poolStatsOf(replica, "read"));
        const session = this.sessionDb && "$client" in this.sessionDb ? this.sessionDb.$client : undefined;
        if (session instanceof Pool) stats.push(poolStatsOf(session, "session"));
        return stats;
    }

    /**
     * `SQLAdmin.sampleHealth`: the server behind the pool, and the replica's
     * lag. Without a pg pool (PGlite) there is no server to sample.
     */
    async sampleHealth(): Promise<DatabaseHealthSample> {
        const pool = "$client" in this.db ? this.db.$client : undefined;
        if (!(pool instanceof Pool)) return {};
        const replica = this.readRouter && "$client" in this.readRouter.db ? this.readRouter.db.$client : undefined;
        return sampleDatabaseHealth(pool, replica instanceof Pool ? replica : undefined);
    }

    /**
     * Build one statement, binding `$n` placeholders as real parameters —
     * each once, however often it appears (`utils/positional-params.ts`).
     *
     * Shared by the role-switched path (inside a transaction) and the
     * unswitched one. They held byte-identical copies of this loop, which is
     * exactly the shape where a fix lands in one copy and not the other.
     */
    private buildStatement(sqlText: string, params?: unknown[]) {
        return positionalStatement(sqlText, params);
    }

    async executeSql(sqlText: string, options?: {
        database?: string,
        role?: string,
        params?: unknown[],
        isolateSession?: boolean,
        maxResultBytes?: number
    }): Promise<Record<string, unknown>[]> {
        if (options?.isolateSession) {
            return this.onIsolatedSession(
                await this.getSessionTargetDb(options.database),
                options.role,
                (db, role) => this.executeSqlOn(db, sqlText, { ...options, role }),
                options.maxResultBytes
            );
        }
        const rows = !options?.database && !options?.role
            ? await this.dataService.executeSql(sqlText, options?.params)
            : await this.executeSqlOn(await this.getTargetDb(options?.database), sqlText, options);
        return options?.maxResultBytes === undefined ? rows : refuseOversizedRows(rows, options.maxResultBytes);
    }

    /**
     * `SQLAdmin.probe`: `SELECT 1` on a connection opened for it, outside the
     * pool, so a pool whose connections are all serving slow requests does not
     * read as a database that is down. Without a pg pool (PGlite) there is no
     * queue to bypass, and the query runs like any other.
     */
    async probe(timeoutMs: number): Promise<void> {
        const pool = "$client" in this.db ? this.db.$client : undefined;
        if (!(pool instanceof Pool)) {
            await this.db.execute(drizzleSql.raw("SELECT 1"));
            return;
        }
        const client = new Client({
            ...pool.options,
            connectionTimeoutMillis: timeoutMs,
            query_timeout: timeoutMs,
            // A transaction-mode pooler refuses (or drops) a startup
            // `statement_timeout`; `query_timeout` bounds the probe there.
            ...(isPooledPool(pool) ? {} : { statement_timeout: timeoutMs })
        });
        // a probe that times out must not leave an error unhandled on the socket
        client.on("error", () => {});
        try {
            await client.connect();
            await client.query("SELECT 1");
        } finally {
            await client.end().catch(() => {});
        }
    }

    /**
     * Run a script a person wrote — the Studio console — and describe its
     * result. See `SQLAdmin.runSqlScript` and `services/sql-script.ts`.
     */
    async runSqlScript(sqlText: string, options?: {
        database?: string,
        role?: string,
        signal?: AbortSignal
    }): Promise<SqlScriptResult> {
        const targetDb = await this.getSessionTargetDb(options?.database);
        const pool = "$client" in targetDb ? targetDb.$client : undefined;
        if (!(pool instanceof Pool)) {
            // One session in process: nothing on the wire to read a column's
            // origin from, so nothing in the result is said to have one. And
            // no backend of its own to cancel: `signal` is not read.
            return sqlScriptResultFromRows(await this.executeSql(sqlText, {
                database: options?.database,
                role: options?.role,
                isolateSession: true
            }));
        }
        const role = options?.role;
        return runSqlScriptOnPool(pool, sqlText, {
            assumeRole: role ? (connection) => this.assumeSessionRole(connection, role) : undefined,
            signal: options?.signal
        });
    }

    /**
     * Read the whole result of one query a person wrote, a batch at a time —
     * see `SQLAdmin.openSqlCursor` and `openSqlCursorOnPool`. The database's
     * refusal of the query (a write, a second statement, a syntax error, a
     * role it may not take) is the caller's to read, as on the socket.
     */
    async openSqlCursor(sqlText: string, options?: {
        database?: string,
        role?: string,
        batchSize?: number
    }): Promise<SqlCursor> {
        const targetDb = await this.getSessionTargetDb(options?.database);
        const pool = "$client" in targetDb ? targetDb.$client : undefined;
        if (!(pool instanceof Pool)) {
            // One session in process: a cursor held open across a download
            // would hold every other query of the app behind it.
            throw new ApiError(501, "SQL_EXPORT_UNSUPPORTED",
                "Downloading a whole result reads it through a cursor on a connection of its own, and the " +
                "in-process development database has one connection. Point DATABASE_URL at a Postgres of your " +
                "own (`rebase dev --docker` starts one), or add a LIMIT and export the rows on screen.");
        }
        const role = options?.role;
        try {
            return await openSqlCursorOnPool(pool, sqlText, {
                assumeRole: role ? (connection) => this.assumeSessionRole(connection, role) : undefined,
                batchRows: options?.batchSize
            });
        } catch (error: unknown) {
            if (error instanceof DatabaseError || error instanceof RoleSwitchUnavailableError) {
                throw new ApiError(400, "SQL_ERROR", error.message);
            }
            throw error;
        }
    }

    /**
     * `SET ROLE` for the rest of a session of a script's own — not `SET LOCAL`
     * inside a transaction, which a `COMMIT` in the script ends, and every
     * statement after it ran as the connection owner. The session is reset
     * after the script, so the role does not outlive it.
     *
     * The same refusals as {@link executeSqlOn}: a role the session already
     * has is no switch; `DISABLE_DB_ROLE_SWITCHING` runs as the owner on
     * purpose; and a connection that may not `SET ROLE` refuses, never falls
     * back to the owner.
     */
    private async assumeSessionRole(connection: PoolClient, role: string): Promise<void> {
        const current = await connection.query<{ role: string }>("SELECT current_user AS role");
        if (current.rows[0]?.role === role) return;
        if (isRoleSwitchingOptedOut()) {
            logger.debug(
                `[PostgresBackendDriver] DISABLE_DB_ROLE_SWITCHING=true — running as the ` +
                `connection owner rather than "${role}".`
            );
            return;
        }
        if (this._roleSwitchRefusals.has(role)) throw new RoleSwitchUnavailableError(role, this._roleSwitchRefusals.get(role));
        try {
            await connection.query(`SET ROLE "${role.replace(/"/g, "\"\"")}"`);
        } catch (roleError: unknown) {
            if (isRoleSwitchingPermissionError(roleError)) {
                this._roleSwitchRefusals.set(role, roleError);
                throw new RoleSwitchUnavailableError(role, roleError);
            }
            throw roleError;
        }
    }

    /**
     * Run `fn` on a session of its own, and put that session back the way it
     * was handed out before anything else can use it.
     *
     * For SQL a person wrote — the Studio editor. It may `SET ROLE`,
     * `SET SESSION AUTHORIZATION` or `set_config(…, false)`, which outlive the
     * statement (and a transaction's commit) and stay on the connection. On a
     * pooled one they were inherited by whatever checked it out next: an auth
     * lookup, the job store or history running as `rebase_user`, on one
     * connection in N, until a restart. `SET SESSION AUTHORIZATION DEFAULT`
     * clears the role as well, which `RESET ALL` does not.
     *
     * On a pool, `role` is assumed for the whole session, and a transaction
     * the SQL leaves open is rolled back and the run refused — see
     * `onOwnSession`. `fn` is then handed no role: there is nothing left to
     * switch. A handle that is already one session (PGlite in process, a
     * single client) is reset in place, and `fn` switches the role itself.
     *
     * With `maxResultBytes`, a result past it is refused — see
     * `readWithinBudget`: on a pool the read stops there, in process the rows
     * are measured once read.
     */
    private async onIsolatedSession(
        targetDb: DrizzleClient,
        role: string | undefined,
        fn: (db: DrizzleClient, role: string | undefined) => Promise<Record<string, unknown>[]>,
        maxResultBytes?: number
    ): Promise<Record<string, unknown>[]> {
        const pool = "$client" in targetDb ? targetDb.$client : undefined;
        if (!(pool instanceof Pool)) {
            try {
                // One session in process: the rows are read whole before
                // anything could stop them, and refused afterwards all the same.
                const rows = await fn(targetDb, role);
                return maxResultBytes === undefined ? rows : refuseOversizedRows(rows, maxResultBytes);
            } finally {
                for (const statement of RESET_SESSION_STATEMENTS) {
                    await targetDb.execute(drizzleSql.raw(statement)).catch((error: unknown) =>
                        logger.error("[PostgresBackendDriver] Could not reset the session after caller SQL", { error }));
                }
            }
        }
        return onOwnSession(
            pool,
            { assumeRole: role ? (connection) => this.assumeSessionRole(connection, role) : undefined },
            (connection) => maxResultBytes === undefined
                ? fn(drizzle(connection), undefined)
                : readWithinBudget(connection, maxResultBytes, () => fn(drizzle(connection), undefined))
        );
    }

    private async executeSqlOn(targetDb: DrizzleClient, sqlText: string, options?: {
        database?: string,
        role?: string,
        params?: unknown[]
    }): Promise<Record<string, unknown>[]> {
        try {
            // Does this actually need a role switch?
            //
            // Asking for the role the session already runs as is a no-op, not a
            // downgrade — the statement really does execute as the requested
            // role — so it stays allowed even where switching is unavailable.
            // That is the ordinary Studio path: the role picker defaults to
            // `current_user`.
            let needsRoleSwitch = false;
            if (options?.role) {
                try {
                    const currentRoleResult = await targetDb.execute(drizzleSql.raw("SELECT current_user AS role"));
                    const currentRole = (currentRoleResult.rows?.[0] as Record<string, unknown>)?.role as string | undefined;
                    needsRoleSwitch = !!currentRole && currentRole !== options.role;
                } catch {
                    // Current role unknown. Assume a switch is needed rather
                    // than assume the session already is the requested role:
                    // attempting and refusing beats guessing in our own favour.
                    needsRoleSwitch = true;
                }
            }

            if (needsRoleSwitch && options?.role) {
                if (isRoleSwitchingOptedOut()) {
                    // The one sanctioned way to run this unswitched, and a
                    // decision somebody made rather than a failure: the env var
                    // is documented (README, docs/getting-started/configuration)
                    // as "run SQL Editor queries as the connection owner", for
                    // deployments whose application roles have no database role
                    // behind them. `effectiveSqlRole` reads the same switch, so
                    // the audit log records the role that actually applied.
                    logger.debug(
                        `[PostgresBackendDriver] DISABLE_DB_ROLE_SWITCHING=true — running as the ` +
                        `connection owner rather than "${options.role}".`
                    );
                } else if (this._roleSwitchRefusals.has(options.role)) {
                    // Already learned this connection cannot SET ROLE to it;
                    // refuse without spending the round trip to be told again.
                    throw new RoleSwitchUnavailableError(options.role, this._roleSwitchRefusals.get(options.role));
                } else {
                    const safeRole = options.role.replace(/"/g, "\"\"");
                    try {
                        return await targetDb.transaction(async (tx) => {
                            await tx.execute(drizzleSql.raw(`SET LOCAL ROLE "${safeRole}"`));
                            return rowsOfResult(await tx.execute(this.buildStatement(sqlText, options?.params)));
                        });
                    } catch (roleError: unknown) {
                        if (isRoleSwitchingPermissionError(roleError)) {
                            // SECURITY: do NOT fall through and run this as the
                            // owner.
                            //
                            // The caller asked for a *constrained* execution.
                            // Owner rows are not a degraded answer to that
                            // question, they are a confident wrong one: the only
                            // reason to pass a role is to see what the database
                            // looks like under RLS, and owner output makes a
                            // protected table read as exposed. This used to warn
                            // and continue — and latch, so a single failure
                            // silently unscoped every later call in the process.
                            //
                            // `applyAuthContext` (the user request path) and
                            // `scopeDataDriver` both fail closed. This is the
                            // same question, so it gets the same answer.
                            this._roleSwitchRefusals.set(options.role, roleError);
                            throw new RoleSwitchUnavailableError(options.role, roleError);
                        }
                        throw roleError;
                    }
                }
            }

            return rowsOfResult(await targetDb.execute(this.buildStatement(sqlText, options?.params)));
        } catch (error: unknown) {
            if (error instanceof RoleSwitchUnavailableError) throw error;
            const msg = error instanceof Error ? error.message : String(error);
            // Provide a user-friendly message for connection/auth errors
            if (msg.includes("pg_hba.conf") || msg.includes("no encryption") || msg.includes("connection refused")) {
                const dbName = options?.database || "unknown";
                throw new Error(`Cannot connect to database "${dbName}": the server rejected the connection. This database may require SSL or is not accessible from this host.`);
            }
            throw error;
        }
    }

    async fetchAvailableDatabases(): Promise<string[]> {
        // Exclude template databases, Cloud SQL internal databases, and the default 'postgres' system db
        const result = await this.executeSql(
            `SELECT datname FROM pg_database 
             WHERE datistemplate = false 
             AND datname NOT IN ('postgres', 'cloudsqladmin', '_cloudsqladmin')
             ORDER BY datname;`
        );
        const databases = result.map((r: Record<string, unknown>) => r.datname as string);
        // Ensure the current connected database is always first in the list
        const currentDb = await this.appDatabaseName();
        if (!databases.includes(currentDb)) {
            databases.unshift(currentDb);
        } else {
            // Move it to the front
            const idx = databases.indexOf(currentDb);
            if (idx > 0) {
                databases.splice(idx, 1);
                databases.unshift(currentDb);
            }
        }
        return databases;
    }

    async fetchAvailableRoles(): Promise<string[]> {
        const result = await this.executeSql(
            "SELECT rolname FROM pg_roles WHERE pg_has_role(current_user, rolname, 'member') ORDER BY rolname;"
        );
        return result.map((r: Record<string, unknown>) => r.rolname as string);
    }

    /**
     * Application-level roles actually in use in this project.
     *
     * Distinct from {@link fetchAvailableRoles}, which returns native
     * PostgreSQL roles from `pg_roles` (`postgres`, `rebase_user`, …). Those
     * are the roles the SQL editor can `SET ROLE` to. *These* are the strings
     * held in the users table's `roles` column, injected per-transaction as
     * `rebase.roles()` and matched by `SecurityRule.roles`. Feeding the pg roles
     * into a `SecurityRule.roles` field produces a condition no user can ever
     * satisfy, so the two must not be conflated.
     *
     * Roles have no registry table — they were migrated out of
     * `rebase.user_roles` onto an inline `roles TEXT[]` column — so the live
     * set is derived from what is assigned. A role that is declared in a policy
     * but held by nobody yet cannot be discovered here; callers that need it
     * should union in the roles they already know about.
     */
    async fetchApplicationRoles(): Promise<string[]> {
        // The users table lives in `rebase` for a default (public) setup, but
        // follows the configured schema otherwise — locate it rather than
        // assuming. The `roles` ARRAY column is what makes it the auth table.
        const located = await this.executeSql(`
            SELECT table_schema, table_name
            FROM information_schema.columns
            WHERE column_name = 'roles'
              AND data_type = 'ARRAY'
              AND table_name = 'users'
              AND table_schema NOT IN ('information_schema', 'pg_catalog')
            ORDER BY (table_schema = 'rebase') DESC, table_schema
            LIMIT 1;
        `);
        if (located.length === 0) return [];

        const schema = located[0].table_schema as string;
        const table = located[0].table_name as string;
        // Identifiers come from information_schema, not user input, but they
        // are still interpolated — quote them so odd-but-legal names survive.
        const qualified = `"${schema.replace(/"/g, "\"\"")}"."${table.replace(/"/g, "\"\"")}"`;

        const rows = await this.executeSql(`
            SELECT DISTINCT unnest(roles) AS role
            FROM ${qualified}
            WHERE roles IS NOT NULL
            ORDER BY role;
        `);
        return rows
            .map((r) => r.role as string)
            .filter((r): r is string => typeof r === "string" && r.length > 0);
    }

    async fetchCurrentDatabase(): Promise<string | undefined> {
        return this.appDatabaseName();
    }

    /**
     * Fetch public tables that are not yet mapped to a collection.
     * Excludes internal tables (_rebase_*, _auth_*, auth tables, etc.)
     * and junction/connection tables used for many-to-many relations.
     */
    async fetchUnmappedTables(mappedPaths?: string[]): Promise<string[]> {
        const result = await this.executeSql(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);

        const allTables = result
            .map((r: Record<string, unknown>) => r.table_name as string)
            .filter((name: string) => classifyTable(name, "public") !== "rebase-internal");

        // Detect junction tables: tables where every column is part of a foreign key.
        // These are typically many-to-many connection tables and shouldn't be suggested.
        let junctionTables = new Set<string>();
        try {
            junctionTables = await detectJunctionTables(this.executeSql.bind(this));
        } catch (e) {
            logger.warn("Could not detect junction tables", { error: e });
        }

        const filteredTables = allTables.filter(name => !junctionTables.has(name));

        if (!mappedPaths || mappedPaths.length === 0) return filteredTables;

        const mappedSet = new Set(mappedPaths.map(p => p.toLowerCase()));
        return filteredTables.filter((name: string) => !mappedSet.has(name.toLowerCase()));
    }

    /**
     * Fetch metadata for a given table from information_schema (columns, policies, constraints).
     */
    async fetchTableMetadata(tableName: string): Promise<TableMetadata> {
        // Sanitize table name as defense-in-depth (parameterized below)
        const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, "");

        // 1. Fetch Columns
        const result = await this.db.execute(drizzleSql`
            SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ${safeName}
            ORDER BY ordinal_position
        `);
        const columns = result.rows as Record<string, unknown>[];

        // The labels of every enum a USER-DEFINED column uses, in one query —
        // it was one per column, in turn, each a round trip. A USER-DEFINED
        // type that is not an enum (a composite, a PostGIS type) has none.
        const enumColumns = columns.filter((c) => c.data_type === "USER-DEFINED");
        if (enumColumns.length > 0) {
            const typeNames = [...new Set(enumColumns.map(col => String(col.udt_name)))];
            let labelsByType = new Map<string, unknown[]>();
            try {
                const enumResult = await this.db.execute(drizzleSql`
                    SELECT t.typname AS type_name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
                    FROM pg_type t
                    JOIN pg_enum e ON t.oid = e.enumtypid
                    WHERE t.typname IN (${drizzleSql.join(typeNames.map(name => drizzleSql`${name}`), drizzleSql`, `)})
                    GROUP BY t.typname
                `);
                labelsByType = new Map((enumResult.rows as Record<string, unknown>[])
                    .map(row => [String(row.type_name), Array.isArray(row.labels) ? row.labels : []]));
            } catch {
                // As before: a column whose labels cannot be read has none.
            }
            for (const col of enumColumns) {
                col.enum_values = labelsByType.get(String(col.udt_name)) ?? [];
            }
        }
        // Rows from hand-written SQL. The element type is the one claim nothing
        // at this layer can check — no column list is available to check it
        // against — but the shape is `sqlRows`' job, not an assertion's.
        const typedColumns = sqlRows<TableColumnInfo>(columns);

        // 2. Fetch Foreign Keys
        const fkResult = await this.db.execute(drizzleSql`
            SELECT
                kcu.column_name as column_name,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ${safeName};
        `);
        // SAFETY: Raw SQL result rows match TableForeignKeyInfo shape from the SELECT aliases
        const foreignKeys = fkResult.rows as TableForeignKeyInfo[];

        // 3. Fetch Junction Tables (Many-to-Many)
        // A simple junction table is one that has foreign keys to our table and other tables
        const junctionsResult = await this.db.execute(drizzleSql`
            SELECT 
                tc1.table_name as junction_table_name,
                kcu1.column_name as source_column_name,
                ccu2.table_name as target_table_name,
                kcu2.column_name as target_column_name
            FROM information_schema.table_constraints tc1
            JOIN information_schema.key_column_usage kcu1 ON tc1.constraint_name = kcu1.constraint_name
            JOIN information_schema.constraint_column_usage ccu1 ON ccu1.constraint_name = tc1.constraint_name
            JOIN information_schema.table_constraints tc2 ON tc1.table_name = tc2.table_name AND tc2.constraint_type = 'FOREIGN KEY'
            JOIN information_schema.key_column_usage kcu2 ON tc2.constraint_name = kcu2.constraint_name
            JOIN information_schema.constraint_column_usage ccu2 ON ccu2.constraint_name = tc2.constraint_name
            WHERE tc1.constraint_type = 'FOREIGN KEY' 
              AND ccu1.table_name = ${safeName}
              AND ccu2.table_name != ${safeName};
        `);
        // SAFETY: Raw SQL result rows match TableJunctionInfo shape from the SELECT aliases
        const junctions = junctionsResult.rows as TableJunctionInfo[];

        // 4. Fetch RLS Policies
        //
        // From `pg_policies`, not `pg_policy`: the importer writes each row
        // into a security rule, and needs the command named (`pg_policy.polcmd`
        // is `r`, `a`, `*`), `TO public` spelled `public` (the raw oid list
        // casts it to `-`) and whether the policy is restrictive, which a
        // rule read back as permissive would OR with every grant beside it.
        const policiesResult = await this.db.execute(drizzleSql`
            SELECT
                policyname AS policy_name,
                permissive,
                cmd,
                roles::text[] AS roles,
                qual,
                with_check
            FROM pg_policies
            WHERE schemaname = 'public' AND tablename = ${safeName};
        `);
        // SAFETY: Raw SQL result rows match TablePolicyInfo shape from the SELECT aliases
        const policies = policiesResult.rows as TablePolicyInfo[];

        return {
            columns: typedColumns,
            foreignKeys,
            junctions,
            policies
        };
    }

    private generateSubscriptionId(): string {
        return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Create a new delegate instance with authenticated context.
     * Starts a transaction and sets the current_user_id and current_user_roles
     * configuration parameters for PostgreSQL Row Level Security.
     */
    async withAuth(user: User): Promise<AuthenticatedPostgresBackendDriver> {
        return new AuthenticatedPostgresBackendDriver(this, user);
    }
}

/** How {@link AuthenticatedPostgresBackendDriver} opens a transaction. */
interface TransactionOptions {
    accessMode?: "read only" | "read write";
    isolationLevel?: "read uncommitted" | "read committed" | "repeatable read" | "serializable";
    /**
     * The operation is one write, so the statement it ends with may carry the
     * transaction's `COMMIT` — see `PostgresBackendDriver._commitsWithLastWrite`.
     */
    loneWrite?: boolean;
}

/**
 * The uid `dataAsAdmin`, crons and jobs act as (`SERVICE_IDENTITY` in
 * `@rebasepro/server`). Its reads stay on the primary.
 */
const SERVICE_PRINCIPAL = "service";

export class AuthenticatedPostgresBackendDriver implements DataDriver {
    key = "postgres";
    initialised = true;
    /** Its delegate's, run inside this caller's transaction. */
    readonly checksRowPreconditions = true;

    public user: User;
    public data: RebaseSdkData;

    constructor(
        public delegate: PostgresBackendDriver,
        user: User
    ) {
        this.user = user;
        this.data = buildSdkData(this, {
            resolveAccessor: createAccessorSlugResolver(() => delegate.registry?.tables())
        });

        // Delegate admin ops to the base driver (no RLS wrapping for admin)
        this.admin = delegate.admin;
    }

    /**
     * Typed admin capabilities — delegates to the base driver.
     */
    admin: DatabaseAdmin;

    get restFetchService(): RestFetchService {
        return {
            // The base driver's restFetchService already applies the afterRead
            // pipeline, so we only wrap it in the authenticated transaction here.
            fetchCollectionForRest: async (collectionPath, options, include) => {
                return this.withTransaction(async (delegate) => {
                    return delegate.restFetchService.fetchCollectionForRest(collectionPath, options, include);
                }, { accessMode: "read only" });
            },
            fetchOneForRest: async (collectionPath, id, include, databaseId, options) => {
                return this.withTransaction(async (delegate) => {
                    return delegate.restFetchService.fetchOneForRest(collectionPath, id, include, databaseId, options);
                }, { accessMode: "read only" });
            },
            // In the same read-only transaction as the two above, which is what
            // sets the RLS GUCs and drops to the restricted role. That is not a
            // detail to leave to the base implementation: an aggregate is an
            // efficient way to learn about rows the caller cannot select, and
            // `count(*)` over a table whose policies return nothing has to be
            // zero rather than the true row count.
            aggregate: async (collectionPath, options) => {
                return this.withTransaction(async (delegate) => {
                    return delegate.restFetchService.aggregate!(collectionPath, options);
                }, { accessMode: "read only" });
            },
            // Not in a transaction, unlike its neighbours: it reads no rows. It
            // derives a cursor from a row the caller has already been served,
            // so there is nothing here for RLS to scope.
            cursorFor: (collectionPath, row, orderBy) =>
                this.delegate.restFetchService.cursorFor?.(collectionPath, row, orderBy)
        };
    }

    /**
     * Stored rows of a table, served to this caller as a read serves them — see
     * {@link DataDriver.serveStoredRows}. In this caller's read-only
     * transaction, as every read here is: that is what sets the field viewer
     * the strip reads, and the identity `afterRead` is told about.
     */
    async serveStoredRows(path: string, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
        if (rows.length === 0) return rows;
        return this.withTransaction(delegate => delegate.serveStoredRows(path, rows), { accessMode: "read only" });
    }

    /**
     * Several reads in one read-only transaction — see
     * {@link DataDriver.readTogether}. The same transaction every read on this
     * driver opens for itself, with the same identity, role and field viewer;
     * `work` is handed the transaction's driver, whose reads run on it directly
     * instead of each opening another.
     *
     * `REPEATABLE READ`, because the point of reading together is reading one
     * snapshot: under the default `READ COMMITTED` each statement takes its
     * own, and a count could still describe a different set from the page
     * beside it. A read-only transaction cannot fail serialization at this
     * level, so it costs nothing.
     */
    async readTogether<T>(work: (driver: DataDriver) => Promise<T>): Promise<T> {
        return this.withTransaction((delegate) => work(delegate), {
            accessMode: "read only",
            isolationLevel: "repeatable read"
        });
    }

    /**
     * One statement as this caller — see {@link DataDriver.sql}. The same
     * transaction every SDK call on this driver opens (`rebase_user`, the
     * caller's identity), read-only unless `write`, and so on the read replica
     * when a read may go there.
     */
    async sql(query: string, options?: CallerSqlOptions): Promise<Record<string, unknown>[]> {
        assertCallerSql(query);
        return this.withTransaction(async delegate => {
            // A lone statement: a write sends its COMMIT in the same batch,
            // so it is one round trip, as the owner's `rebase.sql` is. What
            // follows only reads the catalogue for the field rules below.
            if (options?.write) commitWithNextStatement();
            const result = await delegate.dataService.executeSqlResult(query, options?.params);
            // Per-field read rules are the driver's, not Postgres's: the
            // columns this caller may not read come out, as the API's do.
            return withoutUnreadableColumns(
                rowsOfResult(result),
                fieldsOfResult(result),
                { roles: this.user?.roles ?? [] },
                this.delegate.registry?.tables().map(table => table.descriptor) ?? [],
                this.delegate.columnOrigins,
                (text, params) => delegate.dataService.executeSql(text, params)
            );
        }, { accessMode: options?.write ? "read write" : "read only" });
    }

    /**
     * Run `operation` in a transaction as this caller — on the read replica
     * when this is a read the replica may serve (see {@link replicaFor}), else
     * on the primary.
     *
     * A read the replica fails for the replica's own reasons (it is down,
     * full, or cancelled the read to replay WAL — see
     * `isReplicaFallbackError`) runs again on the primary; anything else it
     * answered is the answer. A write pins this caller to the primary for
     * `REBASE_READ_STICKY_MS`, from when it starts until that long after it
     * ends, so the caller's next list shows what it just saved.
     */
    private async withTransaction<T>(
        operation: (delegate: PostgresBackendDriver) => Promise<T>,
        options?: TransactionOptions
    ): Promise<T> {
        const router = this.delegate.readRouter;
        const principal = this.user?.uid;
        if (options?.accessMode !== "read only") {
            if (!router || !principal) return this.runTransaction(this.delegate.db, operation, options);
            router.notePrimaryWrite(principal);
            try {
                return await this.runTransaction(this.delegate.db, operation, options);
            } finally {
                router.notePrimaryWrite(principal);
            }
        }
        const replica = this.replicaFor();
        if (replica) {
            try {
                return await this.runTransaction(replica, operation, options);
            } catch (error: unknown) {
                if (!isReplicaFallbackError(error)) throw error;
                router?.noteReplicaFailure(error);
            }
        }
        return this.runTransaction(this.delegate.db, operation, options);
    }

    /**
     * The replica's handle for a read by this caller, or `undefined` for the
     * primary: there is no replica, the read is inside a write's transaction
     * (it must see what that write has not committed), the caller is the
     * service identity (crons, jobs, `dataAsAdmin` — server work that reads
     * what it acts on), or the router says the replica is behind, failing, or
     * this caller just wrote.
     */
    private replicaFor(): DrizzleClient | undefined {
        const router = this.delegate.readRouter;
        if (!router) return undefined;
        if (currentWriteScope()) return undefined;
        const principal = this.user?.uid;
        if (principal === SERVICE_PRINCIPAL) return undefined;
        const route = router.route(principal);
        if (route.target === "primary") {
            logger.debug(`[DataDriver] read served by the primary (${route.reason})`);
            return undefined;
        }
        return router.db;
    }

    private async runTransaction<T>(
        db: DrizzleClient,
        operation: (delegate: PostgresBackendDriver) => Promise<T>,
        options?: TransactionOptions
    ): Promise<T> {
        // What a transaction-mode pooler could not carry in the startup
        // packet, set for this transaction alone. Nothing for a direct pool.
        const pool = "$client" in db ? db.$client : undefined;
        const pooledSettings = pooledTransactionSettings(pool);
        // A pg pool's transaction sends its opening — the pooled settings and
        // the caller's context — in the same round trip as its first query
        // (`pipelined-transaction.ts`). Any other handle (PGlite, a caller's
        // own drizzle) opens it statement by statement.
        const pipelined = pipelineTarget(db);
        const pendingNotifications: PostgresBackendDriver["_pendingNotifications"] = [];

        // What a write's callbacks hand off — a job, a history entry, a
        // webhook — commits with the write or not at all, and is found through
        // this scope by code that is not handed the transaction. Writes only:
        // a read has nothing to roll back, and inside one the scope is
        // cleared, so a read nested in a write's callback is not taken for it.
        // See `write-transaction-scope.ts`.
        const writeScope = options?.accessMode === "read only" ? undefined : new WriteTransactionScope();
        // What a hook deferred to the end of this write (`afterSaveError`) is
        // handed: this caller, on this driver, where every call is a
        // transaction of its own — the write's is over by then.
        const client = this.delegate.client;
        writeScope?.setSettledContext({
            user: this.user,
            ...(this.user?.credential ? { credential: this.user.credential } : {}),
            driver: this,
            data: this.data,
            get client() {
                return requireCallbackClient(client);
            },
            storageSource: client?.storage as StorageSource
        });

        // The same identity the transaction is about to hand Postgres, made
        // available to the row walk so per-field `access.read` is applied to
        // whatever this read serves. Established here rather than threaded
        // through `DataService` → `FetchService` → the pipeline for the reason
        // set out in `field-viewer.ts`: those layers carry no user, and every
        // exit from the pipeline needs it. `run` and not `enterWith`, so a
        // `dataAsAdmin` read nested inside a user request restores the user's
        // viewer when it returns.
        const result = await withFieldViewer({ roles: this.user?.roles ?? [] }, async () =>
            await runInWriteScope(writeScope, () => {
                const inTransaction = async (tx: DrizzleClient): Promise<T> => {
                if (!this.user?.uid) {
                    logger.warn("[DataDriver] User ID (uid) is missing for authenticated delegate. Using 'anonymous'. User object", { detail: this.user });
                }
                if (!this.user?.roles) {
                    logger.warn("[DataDriver] User roles are missing for authenticated delegate. Using empty array. User object", { detail: this.user });
                }

                // Set the RLS GUCs and downgrade to the restricted user role so RLS
                // binds every statement in this transaction — reads AND writes.
                // This is user context: the table's `rls` rules are the
                // authorization model. The BASE driver never reaches here, so it
                // stays on the owner connection and bypasses RLS — but note that
                // `rebase.dataAsAdmin` is NOT the base driver: `init.ts` scopes it
                // with `withAuth(SERVICE_IDENTITY)`, so it arrives here like any
                // other user, with uid 'service' and the admin role, and its
                // statements are RLS-evaluated. The comment used to list it as a
                // bypass and five docblocks followed. The GUCs are transaction-local and
                // remain readable after the role switch, so `rebase.uid()` /
                // `rebase.roles()` in policies still resolve.
                //
                // Fails closed: if the switch cannot be performed, the transaction
                // aborts rather than falling back to an RLS-bypassing connection.
                // `isAnonymous` rides along so a policy can tell a GUEST from an
                // account. Anonymous sign-in mints a real user row and a real uid,
                // so without it the two are the same principal inside the database
                // and every rule meaning "signed in" also means "anybody who called
                // POST /auth/anonymous". See `rebase.is_anonymous()`. The
                // token's custom claims reach the database as `rebase.jwt()`,
                // which is what a tenancy policy reads. The same principal a
                // listener on this driver subscribes as — see `authContextOf`.
                // Applied by whichever opens the transaction, below.

                // Bound to `tx`, so a `beforeQuery` on this request sees the
                // caller and reads through the same RLS-scoped transaction the
                // rows come from — the correction `callContextWithin` was
                // written for, applied to the hook as well as to `afterRead`.
                // Built at most once per request, and only for a collection
                // that declares a hook.
                let hookContext: RebaseCallContext | undefined;
                const txEntityService = new DataService(
                    tx, this.delegate.registry,
                    () => {
                        // Asked for by a `beforeQuery` about to run: application code.
                        writeScope?.noteApplicationCode();
                        return (hookContext ??= this.delegate.callContextWithin(tx, this.user));
                    }
                );
                const txDelegate = new PostgresBackendDriver(tx, this.delegate.realtimeService, this.delegate.registry, this.user, this.delegate.poolManager, this.delegate.historyService);

                txDelegate.dataService = txEntityService;
                txDelegate._commitsWithLastWrite = options?.loneWrite === true;
                txDelegate._deferNotifications = true;
                txDelegate._pendingNotifications = pendingNotifications;
                txDelegate.client = this.delegate.client;

                writeScope?.bind(tx, (sqlText, params) => txEntityService.executeSql(sqlText, params));
                let out: T;
                try {
                    out = await operation(txDelegate);
                } catch (error) {
                    // Closed before the rethrow, so before the ROLLBACK is
                    // queued: a statement accepted after it would run on this
                    // connection in autocommit, and commit.
                    writeScope?.close();
                    throw error;
                }
                // Last, inside the transaction: whatever the callbacks started
                // on it finishes before the commit rather than after it.
                await writeScope?.settle();
                // A failure a callback caught has still aborted the
                // transaction, and its COMMIT would be a ROLLBACK that
                // reports success. Refused here, so the caller is told.
                await writeScope?.assertCommittable();
                return out;
                };
                const auth = authContextOf(this.user);
                // The transaction's own settings, without `loneWrite`; none at
                // all when there are none, or drizzle sends a bare `set transaction`.
                const config = options?.accessMode || options?.isolationLevel
                    ? { ...(options.accessMode ? { accessMode: options.accessMode } : {}), ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}) }
                    : undefined;
                if (pipelined) {
                    const opening = authContextStatement(auth, this.delegate.rlsRequest ?? this.delegate.rlsUserRole, transactionSettingsConfig(pooledSettings));
                    return runPipelinedTransaction(pipelined.db, pipelined.pool, [opening], config, inTransaction);
                }
                return db.transaction(async (tx) => {
                    const transactionSettings = transactionSettingsStatements(pooledSettings);
                    if (transactionSettings.length > 0) {
                        await tx.execute(drizzleSql.raw(transactionSettings.join("; ")));
                    }
                    await applyAuthContext(tx, auth, this.delegate.rlsRequest ?? this.delegate.rlsUserRole);
                    return inTransaction(tx);
                }, config);
            }).finally(() => writeScope?.close())
        ).catch(async (error: unknown) => {
            await writeScope?.settled();
            throw error;
        });

        writeScope?.committed();
        await writeScope?.settled();

        for (const notification of pendingNotifications) {
            try {
                await this.delegate.realtimeService.notifyUpdate(
                    notification.path,
                    notification.id,
                    notification.row,
                    notification.databaseId
                );
            } catch (e) {
                logger.error("[DataDriver] Error flushing deferred notification", { error: e });
            }
        }

        return result;
    }

    async fetchCollection<M extends Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<Record<string, unknown>[]> {
        return this.withTransaction((delegate) => delegate.fetchCollection(props), { accessMode: "read only" });
    }

    /**
     * The delegate is the base driver, on the owner connection. The user's
     * identity goes in with the subscription, so the first read runs as them
     * like every refetch after it. It used to be stamped onto the last
     * registered subscription once the delegate had returned — by which time
     * the first read had been issued unscoped, and a listener was handed rows
     * its policies deny.
     */
    listenCollection<M extends Record<string, unknown>>(props: ListenCollectionProps<M>): () => void {
        return this.delegate.listenCollection(props, authContextOf(this.user));
    }

    async fetchOne<M extends Record<string, unknown>>(props: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        return this.withTransaction((delegate) => delegate.fetchOne(props), { accessMode: "read only" });
    }

    listenOne<M extends Record<string, unknown>>(props: ListenOneProps<M>): () => void {
        return this.delegate.listenOne(props, authContextOf(this.user));
    }

    async save<M extends Record<string, unknown>>(props: SaveProps<M>): Promise<Record<string, unknown>> {
        return this.withTransaction((delegate) => delegate.save(props), { loneWrite: true });
    }

    /**
     * One transaction for the whole batch, rather than one per row.
     *
     * This is the point of the method: `save` opens a transaction per call, so
     * importing 10k rows through it means 10k transactions (and, over HTTP, 10k
     * round trips). Here the RLS context is established once and every row lands
     * or none does. Realtime notifications are already deferred to commit by
     * `withTransaction`, so a batch does not flood subscribers mid-flight.
     */
    async saveMany<M extends Record<string, unknown>>(props: SaveManyProps<M>): Promise<Record<string, unknown>[]> {
        return this.withTransaction((delegate) => delegate.saveMany(props), { loneWrite: true });
    }

    /**
     * Present for the same reason `saveMany` is, and absent until now.
     *
     * Every request that reaches the REST layer is served by *this* class — the
     * base driver never sees one — and the routes ask `if (!driver.updateMany)`
     * before doing anything. So `PATCH /api/data/<c>/bulk` and
     * `POST /api/data/<c>/bulk/delete` answered `BULK_UNSUPPORTED` on Postgres,
     * the one backend that implements them, for every authenticated caller.
     * The methods existed one class down and nothing forwarded to them.
     */
    async updateMany<M extends Record<string, unknown>>(props: UpdateManyProps<M>): Promise<Record<string, unknown>[]> {
        return this.withTransaction((delegate) => delegate.updateMany(props), { loneWrite: true });
    }

    async deleteMany<M extends Record<string, unknown>>(props: DeleteManyProps<M>): Promise<void> {
        return this.withTransaction((delegate) => delegate.deleteMany(props), { loneWrite: true });
    }

    async updateWhere<M extends Record<string, unknown>>(props: UpdateWhereProps<M>): Promise<Record<string, unknown>[]> {
        return this.withTransaction((delegate) => delegate.updateWhere(props), { loneWrite: true });
    }

    async deleteWhere<M extends Record<string, unknown>>(props: DeleteWhereProps<M>): Promise<number> {
        return this.withTransaction((delegate) => delegate.deleteWhere(props), { loneWrite: true });
    }

    /**
     * One transaction, one RLS context, every collection the batch touches.
     *
     * The whole point is that it runs as the caller: a batch that dropped to
     * the base driver would write across collections with row-level security
     * switched off, which is the opposite of what a cross-collection write
     * needs.
     */
    async batchWrite<M extends Record<string, unknown>>(
        props: BatchWriteProps<M>
    ): Promise<(Record<string, unknown> | null)[]> {
        return this.withTransaction((delegate) => delegate.batchWrite(props));
    }

    async delete<M extends Record<string, unknown>>(props: DeleteProps<M>): Promise<void> {
        return this.withTransaction((delegate) => delegate.delete(props), { loneWrite: true });
    }

    async deleteAll(path: string): Promise<void> {
        return this.withTransaction((delegate) => delegate.deleteAll(path));
    }

    /**
     * For a caller holding one of the view's roles, refreshed on the owner's
     * connection rather than in this caller's transaction: Postgres lets only
     * the owner refresh, and the caller's restricted role is not it.
     */
    async refreshView(path: string, options?: { concurrently?: boolean }): Promise<void> {
        const table = this.delegate.registry?.tableAt(path)?.descriptor;
        await withFieldViewer({ roles: (this.user?.roles ?? []).map(role => typeof role === "string" ? role : String((role as { id?: unknown }).id ?? role)) },
            async () => assertViewReadable(table));
        return this.delegate.refreshView(path, options);
    }

    async updateRelationPivot(props: UpdateRelationPivotProps): Promise<void> {
        return this.withTransaction((delegate) => delegate.updateRelationPivot(props));
    }

    async checkUniqueField(
        path: string,
        name: string,
        value: unknown,
        id?: string
    ): Promise<boolean> {
        return this.withTransaction((delegate) => delegate.checkUniqueField(path, name, value, id), { accessMode: "read only" });
    }

    async count<M extends Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<number> {
        return this.withTransaction((delegate) => delegate.count(props), { accessMode: "read only" });
    }

}
