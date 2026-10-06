import { DataService } from "./services/dataService";
import { createStampKeys } from "./services/PersistService";
import { BranchService } from "./services/BranchService";
import { RealtimeService, type SubscriptionAuthContext } from "./services/realtimeService";
import { DatabasePoolManager } from "./databasePoolManager";
import { DrizzleClient } from "./interfaces";
import {
    ANONYMOUS_USER_ID,
    DatabaseAdmin,
    SQLAdmin,
    DataDriver,
    DeleteProps,
    CollectionConfig,
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
    SqlScriptResult,
    StorageSource,
    UpdateManyProps,
    UpdateRelationPivotProps,
    DeleteManyProps,
    EntityValues,
    EntityStatus,
    Properties,
    Property,
    TableColumnInfo,
    TableForeignKeyInfo,
    TableJunctionInfo,
    TableMetadata,
    TablePolicyInfo,
    User,
    parseEnvBoolean
} from "@rebasepro/types";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { sqlRows, applyDefaultValuesOnCreate, buildPropertyCallbacks, buildSdkData, callbackRefusal, classifyTable, detectJunctionTables, getTenantConfig, requireCallbackClient, requireCallbackCollection, resolveCollectionRelations, resolveTenantWrite, restoresSoftDeletedRow, tenantBypassRoles, toCallbackError, updateDateAutoValues, updateUserAutoValues } from "@rebasepro/common";
import { PostgresCollectionRegistry } from "./collections/PostgresCollectionRegistry";
import { deriveRowAddress, getPrimaryKeys, parseIdValues } from "./services/collection-helpers";
import { isJunctionBackedRelation, isNestedPath, resolveNestedPath } from "./services/nested-path";
import { resolveSoftDelete, rowInTrashError } from "./services/soft-delete";
import { currentWriteScope, runInWriteScope, WriteTransactionScope } from "./services/write-transaction-scope";
import { inWriteFrame, type WriteFrame } from "./services/write-depth";
import { HistoryService } from "./history/HistoryService";
import { ApiError, logger, resolveBatchRefs } from "@rebasepro/server";
import { isRoleSwitchingPermissionError, reachedDatabase } from "./utils/pg-error-utils";
import { applyAuthContext } from "./security/rls-enforcement";
import { withFieldViewer } from "./services/field-viewer";
import { generateSchemaCommit } from "./schema/generate-schema-commit";
import { readSchemaFactsFor, type Queryable } from "./schema/ensure-collection-tables";
import { onOwnSession, RESET_SESSION_STATEMENTS, runSqlScriptOnPool, sqlScriptResultFromRows } from "./services/sql-script";

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
            `Grant the connection user membership in "${role}", or set DISABLE_DB_ROLE_SWITCHING=true ` +
            `to run SQL Editor queries as the connection owner.`
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
 * `on_update` stamp — a declared default, a tenant stamp, a create-time stamp.
 * See `PersistSaveOptions.insertOnlyKeys`.
 */
function insertOnlyKeysOf(
    finalValues: object,
    callerValues: object | undefined,
    beforeHooks: Record<string, unknown>,
    afterHooks: Record<string, unknown>,
    properties: Properties | undefined
): string[] {
    const sent = new Set(Object.keys(callerValues ?? {}));
    const updateStamps = new Set(Object.entries(properties ?? {})
        .filter(([, property]) => (property?.type === "date" && property.autoValue === "on_update")
            || (property?.type === "string" && property.autoValue === "user_on_update"))
        .map(([key]) => key));
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
    collection: CollectionConfig | undefined,
    values: Record<string, unknown> | undefined,
    path: string
): void {
    const softDelete = resolveSoftDelete(collection);
    if (!softDelete) return;
    const value = values?.[softDelete.field];
    if (value === undefined || value === null) return;
    const slug = collection?.slug ?? path;
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
    collection: CollectionConfig | undefined,
    registry: PostgresCollectionRegistry,
    id: string | number,
    values: Record<string, unknown> | undefined,
    path: string
): void {
    if (!collection || !values) return;
    const primaryKeys = getPrimaryKeys(collection, registry);
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
    const slug = collection.slug ?? path;
    const violations = moved.map(field => {
        const message = `'${field}' is the key of '${slug}', and an update cannot change it: this row is "${id}". `
            + "Create a row under the new key and delete this one.";
        return { field, code: "key_immutable", message };
    });
    throw ApiError.badRequest(violations[0].message, "KEY_IMMUTABLE", { collection: slug, violations });
}

/**
 * Refuse a write that would leave a *required* `created_by` / `updated_by`
 * column null because nobody is acting.
 *
 * A `user_on_create` column takes the uid from the call context, and an
 * anonymous request, a service token and an in-process write all have none.
 * Storing `null` is the right answer where the column allows it — plenty of
 * rows are legitimately written by the server. Where the collection has said
 * `required`, it is not: that declaration means "a row must record who made
 * it", and a write that cannot answer the question is a write this collection
 * does not accept. Better a 400 naming the field than a 23502 naming the
 * column, three layers down, after the hooks have run.
 */
function assertActingUserForAutoValues(
    properties: Properties,
    status: EntityStatus,
    uid: string | undefined,
    path: string
): void {
    if (uid) return;
    for (const [key, property] of Object.entries(properties)) {
        const prop = property as (Property & { autoValue?: string }) | undefined;
        if (!prop || prop.type !== "string") continue;
        if (prop.autoValue !== "user_on_create" && prop.autoValue !== "user_on_update") continue;
        if (!prop.validation?.required) continue;
        // `user_on_create` says nothing about an update — the column already
        // holds the creator's uid, and this write is not rewriting it.
        if (status === "existing" && prop.autoValue === "user_on_create") continue;
        throw ApiError.badRequest(
            `'${key}' on '${path}' records the acting user and is required, and this request has none. ` +
            "Sign in, or drop `required` from the property to let the server write rows anonymously.",
            "VALIDATION_CONSTRAINT",
            {
                collection: path,
                violations: [{ field: key, code: "required", message: `'${key}' records the acting user, and there is none.` }]
            }
        );
    }
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

export class PostgresBackendDriver implements DataDriver {
    key = "postgres";
    initialised = true;

    public dataService: DataService;
    public realtimeService: RealtimeService;
    public historyService?: HistoryService;
    public branchService?: BranchService;
    public user?: User;
    public data: RebaseSdkData;

    /**
     * The server singleton, attached by `initializeRebaseBackend` after boot —
     * a driver exists before the client does. Typed as what is attached: a
     * `RebaseServerClient` has no `data`, and callbacks read it as
     * `context.client`.
     */
    public client?: RebaseServerClient;

    /**
     * Auto-set to `true` once a `SET LOCAL ROLE` has failed with insufficient
     * privileges, so later statements refuse without spending the round trip
     * to be refused again.
     *
     * Deliberately NOT a mirror of `DISABLE_DB_ROLE_SWITCHING`, which it used
     * to be described as. The env var is an operator saying "run these as the
     * connection owner"; this flag is the database saying "I cannot give you
     * the role you asked for". The first is a decision and permits the
     * fallback, the second is a failure and must not — see the SECURITY note
     * in {@link executeSql}.
     */
    private _roleSwitchingUnavailable = false;

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

    /**
     * When true, realtime notifications are deferred until after the
     * wrapping transaction commits.  Set by `withAuth` → `withTransaction`.
     */
    _deferNotifications = false;
    _pendingNotifications: Array<{
        path: string;
        id: string;
        row: Record<string, unknown> | null;
        databaseId?: string;
    }> = [];

    constructor(
        public db: DrizzleClient,
        realtimeService: RealtimeService,
        public readonly registry: PostgresCollectionRegistry,
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
        this.data = buildSdkData(this);

        // Initialize BranchService when adminConnectionString is configured
        if (poolManager) {
            this.branchService = new BranchService(db, poolManager, {
                database: () => this.appDatabaseName(),
                registry: async () => this.db
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
            runSqlScript: (...args: Parameters<NonNullable<DatabaseAdmin["runSqlScript"]>>) => this.runSqlScript(...args),
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
            planSchemaChange: async (before, after, options) => generateSchemaCommit({
                before: before as CollectionConfig[],
                after: after as CollectionConfig[],
                paths: options?.paths,
                sourceOnly: options?.sourceOnly,
                existing: await readSchemaFactsFor(
                    this.schemaFactsQueryable(),
                    after as CollectionConfig[]
                )
            }),
            // Branch operations (only available when poolManager is configured)
            ...(this.branchService ? {
                createBranch: this.branchService.createBranch.bind(this.branchService),
                deleteBranch: this.branchService.deleteBranch.bind(this.branchService),
                listBranches: this.branchService.listBranches.bind(this.branchService),
                getBranchInfo: this.branchService.getBranchInfo.bind(this.branchService)
            } : {})
        };
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
     * then runs the afterRead pipeline on the results. The raw FetchService does
     * NOT run callbacks, so masking must be applied here — otherwise every
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
            // No afterRead pass: the callbacks shape rows, and an aggregate
            // returns sums and counts rather than rows. Row-level authorization
            // is not skipped — it is applied one layer down, by the
            // request-scoped handle this service reads through.
            aggregate: async (collectionPath, options) => {
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
    private buildCallContext(): RebaseCallContext {
        const client = this.client;
        return {
            user: this.user,
            driver: this,
            data: this.data,
            get client() {
                return requireCallbackClient(client);
            },
            storageSource: client?.storage as StorageSource
        };
    }

    private resolveCollectionCallbacks<M extends Record<string, unknown>>(collection: CollectionConfig<M> | undefined, path: string) {
        if (!collection && !path) return {
            collection: undefined,
            callbacks: undefined,
            globalCallbacks: undefined,
            propertyCallbacks: undefined
        };
        const registryCollection = this.registry?.getCollectionByPath(path);
        const resolvedCollection = registryCollection
            ? {
                ...collection,
                ...registryCollection
            } as CollectionConfig<M>
            : collection as CollectionConfig<M>;

        const callbacks = resolvedCollection?.callbacks;
        const globalCallbacks = this.registry?.getGlobalCallbacks();
        const properties = resolvedCollection?.properties;
        let propertyCallbacks;
        if (properties) {
            propertyCallbacks = buildPropertyCallbacks(properties);
        }
        return {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        };
    }

    /**
     * Run the three-tier afterRead pipeline (global → collection → property) on a
     * single row for a collection whose callbacks have already been resolved.
     */
    private async applyAfterReadToRow(
        row: Record<string, unknown>,
        path: string,
        resolved: ReturnType<PostgresBackendDriver["resolveCollectionCallbacks"]>,
        contextForCallback: RebaseCallContext
    ): Promise<Record<string, unknown>> {
        const { collection: resolvedCollection, callbacks, globalCallbacks, propertyCallbacks } = resolved;
        let out = row;
        if (!PostgresBackendDriver.hasAfterRead(resolved)) return out;
        // Resolved once for all three tiers — see `requireCallbackCollection`.
        const callbackCollection = requireCallbackCollection(resolvedCollection, path);
        if (globalCallbacks?.afterRead) {
            out = await globalCallbacks.afterRead({
                collection: callbackCollection,
                path, row: out, context: contextForCallback
            }) ?? out;
        }
        if (callbacks?.afterRead) {
            out = await callbacks.afterRead({
                collection: callbackCollection,
                path, row: out, context: contextForCallback
            }) ?? out;
        }
        if (propertyCallbacks?.afterRead) {
            out = await propertyCallbacks.afterRead({
                collection: callbackCollection,
                path, row: out, context: contextForCallback
            }) ?? out;
        }
        return out;
    }

    private static hasAfterRead(resolved: ReturnType<PostgresBackendDriver["resolveCollectionCallbacks"]>): boolean {
        return !!(resolved.globalCallbacks?.afterRead || resolved.callbacks?.afterRead || resolved.propertyCallbacks?.afterRead);
    }

    /**
     * Apply afterRead to REST/SDK read results.
     *
     * The REST / `include` path fetches rows through the raw fetch service, which
     * does NOT run callbacks — so without this, `afterRead` transforms (e.g. PII
     * masking) are silently skipped on every SDK/REST read, leaking raw data.
     * This choke point guarantees afterRead runs there too, matching the driver's
     * fetchCollection/fetchOne paths.
     *
     * It also masks embedded relation data one level deep by running the TARGET
     * collection's afterRead (so `post.author.email` is masked by the authors
     * collection, not left raw).
     */
    async applyAfterReadForRest(
        rows: Record<string, unknown>[],
        path: string
    ): Promise<Record<string, unknown>[]> {
        if (!rows || rows.length === 0) return rows;

        const resolved = this.resolveCollectionCallbacks(undefined, path);
        const contextForCallback = this.buildCallContext();
        const hasOwn = PostgresBackendDriver.hasAfterRead(resolved);

        // Resolve embedded relation targets (relationKey -> { path, resolved callbacks })
        // once, keeping only those whose target collection actually has an afterRead.
        const relationTargets: Record<string, { path: string; resolved: ReturnType<PostgresBackendDriver["resolveCollectionCallbacks"]> }> = {};
        if (resolved.collection) {
            try {
                const rels = resolveCollectionRelations(resolved.collection as CollectionConfig);
                for (const [key, rel] of Object.entries(rels)) {
                    const target = typeof (rel as { target?: unknown }).target === "function"
                        ? (rel as { target: () => CollectionConfig }).target()
                        : undefined;
                    const targetPath = target?.slug;
                    if (!targetPath) continue;
                    // The relation's own target, not just its slug: the target
                    // config is in hand here, so a relation pointing at a
                    // collection the registry cannot resolve by slug still
                    // masks through the config it declared, instead of handing
                    // the tiers a collection that is not there.
                    const targetResolved = this.resolveCollectionCallbacks(target, targetPath);
                    if (PostgresBackendDriver.hasAfterRead(targetResolved)) {
                        relationTargets[key] = { path: targetPath, resolved: targetResolved };
                    }
                }
            } catch {
                // Ignore relation resolution errors (e.g. incomplete config during setup)
            }
        }
        const relKeys = Object.keys(relationTargets);

        if (!hasOwn && relKeys.length === 0) return rows;

        const maskEmbedded = async (value: unknown, target: { path: string; resolved: ReturnType<PostgresBackendDriver["resolveCollectionCallbacks"]> }): Promise<unknown> => {
            if (Array.isArray(value)) {
                return Promise.all(value.map((v) => maskEmbedded(v, target)));
            }
            if (!value || typeof value !== "object") return value;
            const obj = value as Record<string, unknown>;
            // A pre-fetched relation payload may nest the row under `.data`.
            if (obj.__type === "relation" && obj.data && typeof obj.data === "object") {
                return { ...obj, data: await this.applyAfterReadToRow(obj.data as Record<string, unknown>, target.path, target.resolved, contextForCallback) };
            }
            // A bare reference pointer carries no row data to mask.
            if (obj.__type === "reference") return obj;
            return this.applyAfterReadToRow(obj, target.path, target.resolved, contextForCallback);
        };

        return Promise.all(rows.map(async (row) => {
            let out = hasOwn ? await this.applyAfterReadToRow(row, path, resolved, contextForCallback) : row;
            for (const key of relKeys) {
                if (out[key] === undefined || out[key] === null) continue;
                out = { ...out, [key]: await maskEmbedded(out[key], relationTargets[key]) };
            }
            return out;
        }));
    }

    async fetchCollection<M extends Record<string, unknown>>(
        // Forwarded whole rather than re-listed, as `listenCollection` does:
        // the list named ten of the query's fields, so `logical`, `include`,
        // `fields`, `distinct`, `withDeleted` and `searchExplain` were accepted
        // and dropped — an `or(...)` read returned every row while `count`
        // with the same group answered 1.
        { path, collection, startAfter, ...query }: FetchCollectionProps<M>
    ): Promise<Record<string, unknown>[]> {

        const rows = await this.dataService.fetchCollection<M>(path, {
            ...query,
            startAfter: startAfter as Record<string, unknown> | undefined,
            databaseId: collection?.databaseId
        });

        const {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        } = this.resolveCollectionCallbacks(collection, path);

        if (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead) {
            const contextForCallback = this.buildCallContext();
            const callbackCollection = requireCallbackCollection(resolvedCollection, path);
            return Promise.all(rows.map(async (row) => {
                let fetched = row;
                // `?? fetched` on every tier. An `afterRead` that mutates the row
                // and returns nothing is a reasonable thing to write — the guide's
                // own signature says the return is a transform, not a requirement
                // — and on the tiers that lacked the fallback it replaced the row
                // with `undefined`. The collection tier tolerated it, so the same
                // callback worked or emptied the response depending on which
                // block it was registered in.
                // 1. Global callbacks first
                if (globalCallbacks?.afterRead) {
                    fetched = await globalCallbacks.afterRead({
                        collection: callbackCollection,
                        path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                // 2. Collection callbacks second
                if (callbacks?.afterRead) {
                    fetched = await callbacks.afterRead({
                        collection: callbackCollection,
                        path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                // 3. Property callbacks third
                if (propertyCallbacks?.afterRead) {
                    fetched = await propertyCallbacks.afterRead({
                        collection: callbackCollection,
                        path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                return fetched;
            }));
        }

        return rows;
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
        { path, collection, startAfter, onUpdate, onError, vectorSearch: _vectorSearch, page: _page, withDeleted: _withDeleted, ...query }: ListenCollectionProps<M>,
        authContext: SubscriptionAuthContext | undefined = this.user ? authContextOf(this.user) : undefined
    ): () => void {
        const subscriptionId = this.generateSubscriptionId();

        this.realtimeService.startDataDriverSubscription(subscriptionId, {
            type: "collection",
            path,
            collectionRequest: {
                ...query,
                startAfter: startAfter as Record<string, unknown> | undefined,
                databaseId: collection?.databaseId
            },
            authContext,
            onError: fetchErrorListener(onError)
        }, (rows) => {
            if (Array.isArray(rows)) onUpdate(rows);
        });

        return () => this.realtimeService.unsubscribe(subscriptionId);
    }

    async fetchOne<M extends Record<string, unknown>>({
                                                             path,
                                                             id,
                                                             databaseId,
                                                             collection,
                                                             withDeleted
                                                         }: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        let row = await this.dataService.fetchOne<M>(
            path,
            id,
            databaseId || collection?.databaseId,
            withDeleted
        );

        const {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        } = this.resolveCollectionCallbacks(collection, path);

        if (row && (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead)) {
            const contextForCallback = this.buildCallContext();
            const callbackCollection = requireCallbackCollection(resolvedCollection, path);
            // `?? row` on every tier — see the note in `fetchCollection`.
            // 1. Global callbacks first
            if (globalCallbacks?.afterRead) {
                row = await globalCallbacks.afterRead({
                    collection: callbackCollection,
                    path,
                    row,
                    context: contextForCallback
                }) ?? row;
            }
            // 2. Collection callbacks second
            if (callbacks?.afterRead) {
                row = await callbacks.afterRead({
                    collection: callbackCollection,
                    path,
                    row,
                    context: contextForCallback
                }) ?? row;
            }
            // 3. Property callbacks third
            if (propertyCallbacks?.afterRead) {
                row = await propertyCallbacks.afterRead({
                    collection: callbackCollection,
                    path,
                    row,
                    context: contextForCallback
                }) ?? row;
            }
        }

        return row;
    }

    /**
     * Listen to one row: the row now, then again after every change, and
     * `null` when it is not there — deleted, never created, or not readable by
     * the subscriber. Reads as {@link listenCollection} does.
     */
    listenOne<M extends Record<string, unknown>>(
        { path, id, onUpdate, onError }: ListenOneProps<M>,
        authContext: SubscriptionAuthContext | undefined = this.user ? authContextOf(this.user) : undefined
    ): () => void {
        const subscriptionId = this.generateSubscriptionId();

        this.realtimeService.startDataDriverSubscription(subscriptionId, {
            type: "single",
            path,
            id,
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
     * Stamp, or refuse, the tenant on a write to a `tenant`-scoped collection.
     *
     * A no-op for every collection that declares no tenancy, which is the
     * common case and costs one property read.
     */
    private async applyTenantScope<M extends Record<string, unknown>>(
        collection: CollectionConfig | undefined,
        path: string,
        values: Partial<EntityValues<M>>,
        status: EntityStatus,
        previousValues: Record<string, unknown> | undefined
    ): Promise<Partial<EntityValues<M>>> {
        const tenant = getTenantConfig(collection);
        if (!tenant) return values;

        // The same set the policy lets past: the trusted server context (no
        // user at all) and the bypass roles. Deciding it here rather than
        // inside the pure helper keeps "who is calling" in the one place that
        // knows.
        const bypassRoles = tenantBypassRoles(tenant);
        const callerRoles = (this.user?.roles ?? []).map(r =>
            typeof r === "string" ? r : String((r as { id?: unknown })?.id ?? r));
        const bypass = !this.user || callerRoles.some(r => bypassRoles.includes(r));

        const { tenants, complete } = bypass
            ? { tenants: [] as unknown[], complete: true }
            : await this.resolveCallerTenants(tenant, collection);

        const decision = resolveTenantWrite({
            tenant,
            values: values as Record<string, unknown>,
            status,
            callerTenants: tenants,
            callerTenantsComplete: complete,
            bypass,
            previousValues,
            slug: collection?.slug ?? path
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
     * refuses. `validateCollectionConfig` is what makes sure the membership
     * collection is readable by its own members in the first place.
     */
    private async resolveCallerTenants(
        tenant: NonNullable<ReturnType<typeof getTenantConfig>>,
        collection: CollectionConfig | undefined
    ): Promise<{ tenants: unknown[]; complete: boolean }> {
        if ("claim" in tenant.from) {
            const value = this.user?.claims?.[tenant.from.claim];
            const empty = value === undefined || value === null || value === "";
            return { tenants: empty ? [] : [value], complete: true };
        }

        const uid = this.user?.uid;
        if (!uid) return { tenants: [], complete: true };

        const { collection: slug, userField, tenantField } = tenant.from.membership;
        const cap = PostgresBackendDriver.TENANT_MEMBERSHIP_CAP;
        try {
            // Read on the trusted plane for its fields — the database still
            // scopes the rows to the caller. This is the server deciding a
            // write, not a read served to anyone, and the caller's `access.read`
            // rules describe what they may receive: applied here, a tenant
            // column members may not read would leave every member in no
            // tenant at all.
            const rows = await withFieldViewer(undefined, () => this.dataService.fetchCollection(slug, {
                filter: { [userField]: ["==", uid] } as never,
                limit: cap + 1,
                databaseId: collection?.databaseId
            }));
            const tenants = Array.from(new Set(
                rows.slice(0, cap)
                    .map(row => (row as Record<string, unknown>)[tenantField])
                    .filter(value => value !== null && value !== undefined)
                    .map(value => (typeof value === "object"
                        ? (value as { id?: unknown }).id ?? value
                        : value))
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
        return hop && isJunctionBackedRelation(hop.relation) ? hop.targetCollection.slug : path;
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
        collection: CollectionConfig,
        values: Partial<EntityValues<M>>,
        id: string | number | undefined,
        onConflict: readonly string[] | undefined
    ): Promise<{ id: string; values: Partial<EntityValues<M>> } | undefined> {
        const primaryKeys = getPrimaryKeys(collection, this.registry);
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

        const softDelete = resolveSoftDelete(collection);
        const [row] = await withFieldViewer(undefined, () => this.dataService.fetchCollectionForRest(path, {
            filter,
            limit: 1,
            databaseId: collection.databaseId,
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
            id: deriveRowAddress(row, collection, this.registry),
            values: rest as Partial<EntityValues<M>>
        };
    }

    async save<M extends Record<string, unknown>>(props: SaveProps<M>): Promise<Record<string, unknown>> {
        // A frame per write, so a hook whose `context.data` write runs that
        // hook again is refused at a bounded depth instead of looping inside
        // the request's transaction. See `write-depth.ts`.
        return inWriteFrame(props.path, "save", frame => this.saveInFrame(props, frame));
    }

    private async saveInFrame<M extends Record<string, unknown>>({
                                                            path,
                                                            id,
                                                            values,
                                                            collection,
                                                            status,
                                                            upsert,
                                                            onConflict
                                                        }: SaveProps<M>, frame: WriteFrame): Promise<Record<string, unknown>> {

        const {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        } = this.resolveCollectionCallbacks(collection, path);

        // An upsert that finds its row is an update of that row, and runs as
        // one: the update gate, `beforeSave` told "existing" with the stored
        // values, `on_update` stamps only, history "update". Every upsert door
        // (`?on_conflict=`, bulk and `_batch` upserts, the SDK, the socket)
        // reached the create pipeline instead, and the INSERT's conflict branch
        // wrote it over the stored row: omitted fields reset to their
        // `defaultValue`, `user_on_create` handed to whoever ran the import,
        // hooks told the row was new, and a row the caller's `beforeQuery`
        // hides updated and then answered 500. The read runs in the write's
        // transaction; a row it cannot see is still met safely by the
        // statement's own conflict branch below.
        if (status === "existing") {
            assertUpdateDoesNotSoftDelete(resolvedCollection as CollectionConfig | undefined, values, path);
            if (isPresentKey(id)) {
                assertKeyUnchanged(resolvedCollection as CollectionConfig | undefined, this.registry, id, values as Record<string, unknown>, path);
            }
        }

        const upserting = upsert === true && status !== "existing";
        if (upserting && resolvedCollection) {
            const stored = await this.findUpsertTarget<M>(
                path, resolvedCollection as CollectionConfig, values, id, onConflict
            );
            if (stored) {
                // The same write, continued as an update: the same frame.
                return this.saveInFrame<M>({ path, id: stored.id, values: stored.values, collection, status: "existing" }, frame);
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
        // Before validation too: `required` on create is satisfied by a
        // default, which is why `assertWriteValuesValid` skips a property that
        // declares one.
        if ((status === "new" || status === "copy") && resolvedCollection?.properties) {
            updatedValues = applyDefaultValuesOnCreate<M>(
                updatedValues,
                resolvedCollection.properties
            ) as Partial<EntityValues<M>>;
        }

        // Fetch previous values for callbacks AND history recording. Same walk
        // as the saved row the callbacks receive (`fetchOneForRest`), so
        // `values` and `previousValues` compare like with like — a Date on one
        // side and its ISO string on the other reads as a change that never
        // happened.
        let previousValuesForHistory: Partial<M> | undefined;
        if (status === "existing" && id) {
            // An update addresses a row the caller can read, and a key that
            // reads as nothing is a 404 — answered *here*, before any hook runs
            // and before the write, as `delete` answers it. The read is the
            // caller's: their policies, their `beforeQuery`, and the trash
            // hidden. So a row in the trash is a 404 too, unless this update
            // is its restore (`restoresSoftDeletedRow`), which is the one edit
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
            try {
                const existing = await this.dataService.getFetchService().fetchOneForRest(
                    this.storedRowPath(path), id, undefined, resolvedCollection?.databaseId,
                    {
                        withDeleted: restoresSoftDeletedRow(
                            resolvedCollection as CollectionConfig | undefined,
                            values as Record<string, unknown>
                        ) ? true : undefined
                    }
                );
                if (!existing) {
                    throw ApiError.notFound(`No row "${id}" in "${path}" to update.`);
                }
                if (existing) {
                    const { id: _existingId, ...existingValues } = existing;
                    previousValuesForHistory = existingValues as Partial<M>;
                }
            } catch (err) {
                // The refusal above is the answer, not a failed enrichment.
                if (err instanceof ApiError) throw err;
                // So is a statement the database refused: on a request it
                // has aborted the write's transaction, and carrying on only
                // turns the next statement into an unrelated 25P02.
                if (reachedDatabase(err)) throw err;
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
            if (globalCallbacks?.beforeSave || callbacks?.beforeSave || propertyCallbacks?.beforeSave) {
                const callbackCollection = requireCallbackCollection(resolvedCollection, path);
                // 1. Global callbacks first
                if (globalCallbacks?.beforeSave) {
                    const result = await globalCallbacks.beforeSave({
                        collection: callbackCollection,
                        path,
                        id,
                        values: updatedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                    if (result) updatedValues = applyBeforeSaveResult(updatedValues, result);
                }

                // 2. Collection callbacks second
                if (callbacks?.beforeSave) {
                    const result = await callbacks.beforeSave({
                        collection: callbackCollection,
                        path,
                        id,
                        values: updatedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                    if (result) updatedValues = applyBeforeSaveResult(updatedValues, result);
                }

                // 3. Property callbacks third
                if (propertyCallbacks?.beforeSave) {
                    const result = await propertyCallbacks.beforeSave({
                        collection: callbackCollection,
                        path,
                        id,
                        values: updatedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                    if (result) updatedValues = applyBeforeSaveResult(updatedValues, result);
                }

            }
        } catch (callbackError) {
            throw toCallbackError(callbackError, "beforeSave", path);
        }
        const afterHooks: Partial<EntityValues<M>> = updatedValues;
        if (status === "existing" && isPresentKey(id)) {
            assertKeyUnchanged(resolvedCollection as CollectionConfig | undefined, this.registry, id, updatedValues as Record<string, unknown>, path);
        }

        // Apply autoValue timestamps (on_create / on_update) at the application layer.
        // This handles updated_at fields for all writes that flow through the Rebase backend.
        if (resolvedCollection?.properties) {
            updatedValues = updateDateAutoValues({
                inputValues: updatedValues,
                properties: resolvedCollection.properties,
                status: status ?? "new",
                timestampNowValue: new Date()
            });
            // The identity half of the same idea: `created_by` / `updated_by`
            // taken from the call context, never from the body. Stamped after
            // the hooks for the same reason the timestamps are — a hook must
            // not be able to attribute a write to another user either.
            assertActingUserForAutoValues(
                resolvedCollection.properties,
                status ?? "new",
                this.user?.uid,
                path
            );
            updatedValues = updateUserAutoValues({
                inputValues: updatedValues,
                properties: resolvedCollection.properties,
                status: status ?? "new",
                uid: this.user?.uid
            });
            // And an update leaves the create-time stamps alone. They record
            // who made the row and when, which no later write can change; left
            // to the body (or a hook), any row writer could reattribute a row
            // they edited — `created_by` is the column that exists to stop that.
            if (status === "existing") {
                const kept: Record<string, unknown> = { ...updatedValues };
                for (const key of createStampKeys(resolvedCollection.properties)) delete kept[key];
                updatedValues = kept as Partial<EntityValues<M>>;
            }
        }

        // Tenancy, last of the three stamps and for the same reason they are
        // here rather than in a hook: the tenant comes from the *call context*,
        // never from the body, so a caller (or a `beforeSave`) cannot attribute
        // a row to another tenant. The database enforces the same rule through
        // the restrictive tenancy policy — this only reaches the same answer
        // one layer earlier, with the field named. See `@rebasepro/common`'s
        // `resolveTenantWrite`.
        updatedValues = await this.applyTenantScope(
            resolvedCollection as CollectionConfig | undefined,
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
        if ((status === "new" || status === "copy") && !upsert && isPresentKey(id) && resolvedCollection) {
            updatedValues = {
                ...updatedValues,
                ...parseIdValues(id, getPrimaryKeys(resolvedCollection as CollectionConfig, this.registry))
            } as Partial<EntityValues<M>>;
            writeId = undefined;
        }

        // For an upsert whose INSERT meets a stored row anyway — one the read
        // above could not see, or one inserted concurrently — what the
        // conflict-update may set: what the caller sent, what a hook wrote, and
        // the `on_update` stamps. Everything else here the create alone decided
        // (declared defaults, a tenant stamp; the create-time stamps are left
        // out by the persistence layer), and a stored row keeps its own.
        const insertOnlyKeys = upserting
            ? insertOnlyKeysOf(updatedValues, values, beforeHooks, afterHooks, resolvedCollection?.properties)
            : undefined;
        // A stamped soft-delete field may create a row already trashed, and
        // may not trash a stored one: that is a delete (see
        // `assertUpdateDoesNotSoftDelete`).
        const softDeleteField = resolveSoftDelete(resolvedCollection as CollectionConfig | undefined)?.field;
        if (insertOnlyKeys && softDeleteField
            && updatedValues[softDeleteField] !== undefined && updatedValues[softDeleteField] !== null) {
            insertOnlyKeys.push(softDeleteField);
        }

        try {
            const storedRow = await this.dataService.save<M>(
                path,
                updatedValues,
                writeId,
                resolvedCollection?.databaseId,
                { upsert: upserting, onConflict, insertOnlyKeys }
            );

            // Two rows from here on, and which one goes where is the point.
            // `storedRow` is what the table now holds: `afterSave` judges it,
            // history records it, its address is derived from it. `savedRow` is
            // what the CALLER reads — `afterRead`'s view, for the response and
            // its realtime echo. They used to be one variable, so a masking
            // `afterRead` (`email` → `********`) was what history recorded and
            // what a revert then wrote into the column, and a computed field it
            // added made every version un-revertable. A copy goes in, so an
            // `afterRead` that edits its argument in place edits only the view.
            let savedRow = storedRow;
            if (storedRow && (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead)) {
                const callbackCollection = requireCallbackCollection(resolvedCollection, path);
                savedRow = { ...storedRow };
                // `?? savedRow` on every tier — see the note in `fetchCollection`.
                // Here it decided what the write's own response body contained.
                // 1. Global callbacks first
                if (globalCallbacks?.afterRead) {
                    savedRow = await globalCallbacks.afterRead({
                        collection: callbackCollection,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    }) ?? savedRow;
                }
                // 2. Collection callbacks second
                if (callbacks?.afterRead) {
                    savedRow = await callbacks.afterRead({
                        collection: callbackCollection,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    }) ?? savedRow;
                }
                // 3. Property callbacks third
                if (propertyCallbacks?.afterRead) {
                    savedRow = await propertyCallbacks.afterRead({
                        collection: callbackCollection,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    }) ?? savedRow;
                }
            }

            // The row is exactly its columns, so its address is derived, not read
            // off it: `storedRow.id` is undefined for every table whose key is not
            // literally named `id`, and is ordinary data for a table that has such
            // a column without it being the key. From the stored row: an
            // `afterRead` may reshape or mask the key columns of the view.
            const savedId = deriveRowAddress(
                storedRow,
                (resolvedCollection ?? collection) as CollectionConfig,
                this.registry
            );
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
                if (globalCallbacks?.afterSave || callbacks?.afterSave || propertyCallbacks?.afterSave) {
                    const callbackCollection = requireCallbackCollection(resolvedCollection, path);
                    // 1. Global callbacks first
                    if (globalCallbacks?.afterSave) {
                        await globalCallbacks.afterSave({
                            collection: callbackCollection,
                            path,
                            id: savedId,
                            values: savedValues,
                            previousValues: previousValuesForHistory,
                            status,
                            context: contextForCallback
                        });
                    }
                    // 2. Collection callbacks second
                    if (callbacks?.afterSave) {
                        await callbacks.afterSave({
                            collection: callbackCollection,
                            path,
                            id: savedId,
                            values: savedValues as Partial<M>,
                            previousValues: previousValuesForHistory,
                            status,
                            context: contextForCallback
                        });
                    }
                    // 3. Property callbacks third
                    if (propertyCallbacks?.afterSave) {
                        await propertyCallbacks.afterSave({
                            collection: callbackCollection,
                            path,
                            id: savedId,
                            values: savedValues,
                            previousValues: previousValuesForHistory,
                            status,
                            context: contextForCallback
                        });
                    }
                }
            } catch (callbackError) {
                throw toCallbackError(callbackError, "afterSave", path);
            }

            // Awaited, inside the write's transaction, so the entry commits with
            // its row. It used to be dispatched and dropped — the promise was
            // not held, the service swallowed its own errors — which meant the
            // audit trail of a collection that opted into one had silent,
            // unbounded gaps. See `HistoryService.recordHistory` for the trade.
            if (this.historyService && resolvedCollection?.history) {
                await this.historyService.recordHistory({
                    // The collection's slug, which is what the history route
                    // reads — not the path the write came in on. Keyed by
                    // `owners/1/docs`, a write made through a parent never
                    // appeared in the row's own history.
                    tableName: resolvedCollection.slug,
                    id: savedId,
                    action: status === "existing" ? "update" : "create",
                    values: savedValues as Record<string, unknown>,
                    previousValues: previousValuesForHistory as Record<string, unknown> | undefined,
                    updatedBy: this.user?.uid
                });
            }

            // Notify real-time subscribers (deferred if inside a transaction)
            if (this._deferNotifications) {
                this._pendingNotifications.push({
                    path,
                    id: savedId,
                    row: savedRow,
                    databaseId: resolvedCollection?.databaseId
                });
            } else {
                await this.realtimeService.notifyUpdate(
                    path,
                    savedId,
                    savedRow,
                    resolvedCollection?.databaseId
                );
            }

            return savedRow;
        } catch (error) {
            if (globalCallbacks?.afterSaveError || callbacks?.afterSaveError || propertyCallbacks?.afterSaveError) {
                const callbackCollection = requireCallbackCollection(resolvedCollection, path);
                // Global, then collection, then property — each on its own,
                // and guarded: a hook that throws cannot replace the failure
                // the caller is owed with its own.
                const runHooks = async (context: RebaseCallContext) => {
                    // What the hook exists to see. It was documented from the
                    // start and never passed, so `props.error` was `undefined`
                    // in every handler ever written against the guide. `id` is
                    // the caller's when there is one, and `previousValues` is
                    // whatever the pre-write read managed to fetch.
                    const errorProps = {
                        collection: callbackCollection,
                        path,
                        id,
                        values: updatedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        error,
                        context
                    };
                    for (const [tier, hook] of [
                        ["global", globalCallbacks?.afterSaveError],
                        ["collection", callbacks?.afterSaveError],
                        ["property", propertyCallbacks?.afterSaveError]
                    ] as const) {
                        if (!hook) continue;
                        try {
                            await hook(errorProps);
                        } catch (hookError) {
                            logger.error(`[save] The ${tier} afterSaveError hook for "${path}" threw; answering with the save's own failure`, { error: hookError });
                        }
                    }
                };
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
    private bindToTransaction(tx: DrizzleClient): PostgresBackendDriver {
        // Bind the whole batch to the transaction handle. Without this the rows
        // would be written through `this.db` and survive a rollback.
        const txDriver = new PostgresBackendDriver(
            tx, this.realtimeService, this.registry, this.user, this.poolManager, this.historyService
        );
        txDriver.dataService = new DataService(tx, this.registry, () => txDriver.buildCallContext());
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
        txDriver.dataService = new DataService(tx, this.registry, () => txDriver.buildCallContext());
        txDriver.client = this.client;
        return txDriver.buildCallContext();
    }

    async saveMany<M extends Record<string, unknown>>({
                                                          path,
                                                          rows,
                                                          collection,
                                                          upsert,
                                                          onConflict
                                                      }: SaveManyProps<M>): Promise<Record<string, unknown>[]> {
        return this.db.transaction(async (tx) => {
            const txDriver = this.bindToTransaction(tx);

            const saved: Record<string, unknown>[] = [];

            for (let i = 0; i < rows.length; i++) {
                const values = rows[i];
                const id = (values as Record<string, unknown>)?.id as string | number | undefined;
                try {
                    saved.push(await txDriver.save<M>({
                        path,
                        values,
                        // No `id` argument, deliberately: passing one selects the
                        // UPDATE path, and an import's rows usually carry a natural
                        // key for a row that does not exist yet — which would 404 on
                        // every one. Leaving the key inside `values` is what
                        // single-row `create(data, id)` does, and it inserts.
                        // Callers who want existing rows overwritten pass `upsert`.
                        collection,
                        status: "new",
                        upsert,
                        onConflict
                    }));
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
        updates,
        collection
    }: UpdateManyProps<M>): Promise<Record<string, unknown>[]> {
        return this.db.transaction(async (tx) => {
            const txDriver = this.bindToTransaction(tx);

            const saved: Record<string, unknown>[] = [];

            for (let i = 0; i < updates.length; i++) {
                const { id, values } = updates[i];
                try {
                    // Read first so a missing row is a 404 rather than a silent
                    // no-op. `save` with status "existing" would otherwise write
                    // an UPDATE that matches nothing and report success.
                    // A restore is an update of a row the default read hides;
                    // see `restoresSoftDeletedRow`.
                    const existing = await txDriver.fetchOne({
                        path,
                        id: String(id),
                        collection: collection as CollectionConfig,
                        withDeleted: restoresSoftDeletedRow(
                            (collection as CollectionConfig | undefined) ?? this.registry?.getCollectionByPath(path),
                            values as Record<string, unknown>
                        ) ? true : undefined
                    });
                    if (!existing) {
                        throw Object.assign(new Error(`No row with id ${JSON.stringify(id)}`), {
                            statusCode: 404,
                            code: "NOT_FOUND"
                        });
                    }

                    saved.push(await txDriver.save<M>({
                        path,
                        id: String(id),
                        values,
                        collection,
                        status: "existing"
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
        collection,
        hard
    }: DeleteManyProps<M>): Promise<void> {
        await this.db.transaction(async (tx) => {
            const txDriver = this.bindToTransaction(tx);

            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                try {
                    // No read first: `delete` reads the row itself, and an id
                    // that matches nothing is its 404, which rolls the batch
                    // back like any other failure.
                    await txDriver.delete<M>({
                        row: { id: String(id), path },
                        collection,
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
        return this.db.transaction(async (tx) => {
            const txDriver = this.bindToTransaction(tx);

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

                    let row: Record<string, unknown> | null = null;
                    switch (operation.op) {
                        case "create":
                            row = await txDriver.save<M>({
                                path: operation.path,
                                values: values ?? ({} as Partial<EntityValues<M>>),
                                collection: operation.collection,
                                status: "new"
                            });
                            break;
                        case "upsert":
                            row = await txDriver.save<M>({
                                path: operation.path,
                                values: values ?? ({} as Partial<EntityValues<M>>),
                                collection: operation.collection,
                                status: "new",
                                upsert: true,
                                onConflict: operation.onConflict
                            });
                            break;
                        case "update": {
                            // Read first, so an id matching no row is a 404
                            // rather than an UPDATE that matches nothing and
                            // reports success — the same rule `updateMany` and
                            // the single-row route both apply.
                            const existing = await txDriver.fetchOne({
                                path: operation.path,
                                id: id!,
                                collection: operation.collection as CollectionConfig,
                                // A restore is an update of a row the default
                                // read hides; see `restoresSoftDeletedRow`.
                                withDeleted: restoresSoftDeletedRow(
                                    (operation.collection as CollectionConfig | undefined) ?? this.registry?.getCollectionByPath(operation.path),
                                    values as Record<string, unknown> | undefined
                                ) ? true : undefined
                            });
                            if (!existing) {
                                throw Object.assign(new Error(`No row with id ${JSON.stringify(id)}`), {
                                    statusCode: 404,
                                    code: "NOT_FOUND"
                                });
                            }
                            row = await txDriver.save<M>({
                                path: operation.path,
                                id: id!,
                                values: values ?? ({} as Partial<EntityValues<M>>),
                                collection: operation.collection,
                                status: "existing"
                            });
                            break;
                        }
                        case "delete":
                            // `delete` reads the row itself and 404s on a miss.
                            await txDriver.delete<M>({
                                row: { id: id!, path: operation.path },
                                collection: operation.collection
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
        // A frame per write, as `save` has: see `write-depth.ts`.
        return inWriteFrame(props.row.path, "delete", frame => this.deleteInFrame(props, frame));
    }

    private async deleteInFrame<M extends Record<string, unknown>>({
                                                              row,
                                                              collection,
                                                              hard
                                                          }: DeleteProps<M>, frame: WriteFrame): Promise<void> {

        const targetPath = row.path;

        // Resolve from backend registry to restore callbacks lost during WebSocket serialization
        const {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        } = this.resolveCollectionCallbacks(collection, targetPath);

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
        const stored = await this.dataService.fetchOneForRest<M>(
            targetPath,
            row.id,
            undefined,
            resolvedCollection?.databaseId,
            { withDeleted: hard ? true : undefined }
        );
        // Not found is answered before any callback runs: a callback handed a
        // row that is not there — or not there for this caller — would be
        // judging something it cannot see.
        if (!stored) {
            throw ApiError.notFound(`No row "${row.id}" in "${targetPath}" to delete.`);
        }
        // The callbacks' `row` is the row: its columns, nothing else. The address
        // travels beside it as `id`, so merging it in here only ever invented an
        // `id` field for tables that have no such column. A copy, so a callback
        // that edits it does not edit what history records.
        const targetRow: Record<string, unknown> = { ...stored };

        const contextForCallback = this.buildCallContext();

        // A `before*` callback is the application speaking, not the server
        // failing: a bare `throw` is the documented way to block a write, so it
        // answers 400 with the author's message rather than a masked 500.
        try {
            frame.stage = "beforeDelete";
            if (globalCallbacks?.beforeDelete || callbacks?.beforeDelete || propertyCallbacks?.beforeDelete) {
                const callbackCollection = requireCallbackCollection(resolvedCollection, targetPath);
                let preventDefault = false;
                // 1. Global callbacks first
                if (globalCallbacks?.beforeDelete) {
                    const result = await globalCallbacks.beforeDelete({
                        collection: callbackCollection,
                        path: targetPath,
                        id: row.id,
                        row: targetRow,
                        context: contextForCallback
                    });
                    if (result === false) {
                        preventDefault = true;
                    }
                }
                // 2. Collection callbacks second
                if (callbacks?.beforeDelete) {
                    const result = await callbacks.beforeDelete({
                        collection: callbackCollection,
                        path: targetPath,
                        id: row.id,
                        row: targetRow,
                        context: contextForCallback
                    });
                    if (result === false) {
                        preventDefault = true;
                    }
                }
                // 3. Property callbacks third
                if (propertyCallbacks?.beforeDelete) {
                    const result = await propertyCallbacks.beforeDelete({
                        collection: callbackCollection,
                        path: targetPath,
                        id: row.id,
                        row: targetRow,
                        context: contextForCallback
                    });
                    if (result === false) {
                        preventDefault = true;
                    }
                }
                if (preventDefault) {
                    // A veto, not a silent no-op. Returning early left the route
                    // answering `204 No Content` — "the row is gone" — for a row
                    // that is still there, so the panel dropped it from the list
                    // and the next reload brought it back. Same code a throw
                    // produces, so one branch handles both.
                    throw callbackRefusal("beforeDelete", targetPath);
                }
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
        const hop = isNestedPath(targetPath) ? resolveNestedPath(targetPath, this.registry) : undefined;
        const unlinking = hop !== undefined && isJunctionBackedRelation(hop.relation);
        const softDelete = hard || unlinking
            ? undefined
            : resolveSoftDelete(resolvedCollection as CollectionConfig | undefined);
        if (softDelete) {
            await this.dataService.save(
                targetPath,
                { [softDelete.field]: new Date() } as Partial<EntityValues<M>>,
                row.id,
                resolvedCollection?.databaseId
            );
        } else {
            await this.dataService.delete(
                targetPath,
                row.id,
                resolvedCollection?.databaseId
            );
        }

        // Same contract as `afterSave`: inside the transaction, awaited, and a
        // throw undoes the delete rather than leaving the row gone and the
        // cleanup half-done. See the comment on the `afterSave` block.
        try {
            frame.stage = "afterDelete";
            if (globalCallbacks?.afterDelete || callbacks?.afterDelete || propertyCallbacks?.afterDelete) {
                const callbackCollection = requireCallbackCollection(resolvedCollection, targetPath);
                // 1. Global callbacks first
                if (globalCallbacks?.afterDelete) {
                    await globalCallbacks.afterDelete({
                        collection: callbackCollection,
                        path: targetPath,
                        id: row.id,
                        row: targetRow,
                        context: contextForCallback
                    });
                }
                // 2. Collection callbacks second
                if (callbacks?.afterDelete) {
                    await callbacks.afterDelete({
                        collection: callbackCollection,
                        path: targetPath,
                        id: row.id,
                        row: targetRow,
                        context: contextForCallback
                    });
                }
                // 3. Property callbacks third
                if (propertyCallbacks?.afterDelete) {
                    await propertyCallbacks.afterDelete({
                        collection: callbackCollection,
                        path: targetPath,
                        id: row.id,
                        row: targetRow,
                        context: contextForCallback
                    });
                }
            }
        } catch (callbackError) {
            throw toCallbackError(callbackError, "afterDelete", targetPath);
        }

        // Awaited, for the same reason the save's entry is: a delete is the one
        // change whose history nothing else can reconstruct, because the row it
        // describes is gone.
        // An unlink changed a parent's set, not the target row, so it is not
        // an entry in that row's history.
        if (this.historyService && resolvedCollection?.history && !unlinking) {
            await this.historyService.recordHistory({
                // Keyed like the save's entry: the slug, whatever the path.
                tableName: resolvedCollection.slug,
                id: row.id.toString(),
                action: "delete",
                values: stored,
                updatedBy: this.user?.uid
            });
        }

        // Notify real-time subscribers (deferred if inside a transaction)
        if (this._deferNotifications) {
            this._pendingNotifications.push({
                path: targetPath,
                id: row.id.toString(),
                row: null,
                databaseId: resolvedCollection?.databaseId
            });
        } else {
            await this.realtimeService.notifyUpdate(
                targetPath,
                row.id.toString(),
                null,
                resolvedCollection?.databaseId
            );
        }

    }

    async deleteAll(path: string): Promise<void> {
        await this.dataService.deleteAll(path);
        // Notify real-time subscribers of bulk change
        await this.realtimeService.notifyUpdate(path, "*", null);
    }

    async updateRelationPivot({ path, targetId, pivot }: UpdateRelationPivotProps): Promise<void> {
        await this.dataService.updateRelationPivot(path, targetId, pivot);
        // The junction row itself is what changed, and CDC on that table already
        // reaches the subscribers of `<parent>/<id>/<relation>` — the same route
        // a link or an unlink takes. Nothing extra to emit here; a second notify
        // would only duplicate the frame CDC is about to deliver.
    }

    async checkUniqueField(
        path: string,
        name: string,
        value: unknown,
        id?: string,
        collection?: CollectionConfig
    ): Promise<boolean> {
        return this.dataService.checkUniqueField(
            path,
            name,
            value,
            id,
            collection?.databaseId
        );
    }

    async count<M extends Record<string, unknown>>({
                                                               path,
                                                               collection,
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
     * Build one statement, binding `$n` placeholders as real parameters.
     *
     * Shared by the role-switched path (inside a transaction) and the
     * unswitched one. They held byte-identical copies of this loop, which is
     * exactly the shape where a fix lands in one copy and not the other.
     */
    private buildStatement(sqlText: string, params?: unknown[]) {
        if (!params || params.length === 0) return drizzleSql.raw(sqlText);
        const parts = sqlText.split(/\$(\d+)/);
        const chunks: ReturnType<typeof drizzleSql.raw | typeof drizzleSql.param>[] = [];
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 0) {
                if (parts[i].length > 0) chunks.push(drizzleSql.raw(parts[i]));
            } else {
                chunks.push(drizzleSql.param(params[Number(parts[i]) - 1]));
            }
        }
        return drizzleSql.join(chunks, drizzleSql.raw(""));
    }

    async executeSql(sqlText: string, options?: {
        database?: string,
        role?: string,
        params?: unknown[],
        isolateSession?: boolean
    }): Promise<Record<string, unknown>[]> {
        if (options?.isolateSession) {
            return this.onIsolatedSession(
                await this.getTargetDb(options.database),
                options.role,
                (db, role) => this.executeSqlOn(db, sqlText, { ...options, role })
            );
        }
        if (!options?.database && !options?.role) {
            return this.dataService.executeSql(sqlText, options?.params);
        }
        return this.executeSqlOn(await this.getTargetDb(options?.database), sqlText, options);
    }

    /**
     * Run a script a person wrote — the Studio console — and describe its
     * result. See `SQLAdmin.runSqlScript` and `services/sql-script.ts`.
     */
    async runSqlScript(sqlText: string, options?: {
        database?: string,
        role?: string
    }): Promise<SqlScriptResult> {
        const targetDb = await this.getTargetDb(options?.database);
        const pool = "$client" in targetDb ? targetDb.$client : undefined;
        if (!(pool instanceof Pool)) {
            // One session in process: nothing on the wire to read a column's
            // origin from, so nothing in the result is said to have one.
            return sqlScriptResultFromRows(await this.executeSql(sqlText, {
                database: options?.database,
                role: options?.role,
                isolateSession: true
            }));
        }
        const role = options?.role;
        return runSqlScriptOnPool(pool, sqlText, {
            assumeRole: role ? (connection) => this.assumeSessionRole(connection, role) : undefined
        });
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
        if (this._roleSwitchingUnavailable) throw new RoleSwitchUnavailableError(role);
        try {
            await connection.query(`SET ROLE "${role.replace(/"/g, "\"\"")}"`);
        } catch (roleError: unknown) {
            if (isRoleSwitchingPermissionError(roleError)) {
                this._roleSwitchingUnavailable = true;
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
     */
    private async onIsolatedSession<T>(
        targetDb: DrizzleClient,
        role: string | undefined,
        fn: (db: DrizzleClient, role: string | undefined) => Promise<T>
    ): Promise<T> {
        const pool = "$client" in targetDb ? targetDb.$client : undefined;
        if (!(pool instanceof Pool)) {
            try {
                return await fn(targetDb, role);
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
            (connection) => fn(drizzle(connection), undefined)
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
                } else if (this._roleSwitchingUnavailable) {
                    // Already learned this connection cannot SET ROLE; refuse
                    // without spending the round trip to be told again.
                    throw new RoleSwitchUnavailableError(options.role);
                } else {
                    const safeRole = options.role.replace(/"/g, "\"\"");
                    try {
                        return await targetDb.transaction(async (tx) => {
                            await tx.execute(drizzleSql.raw(`SET LOCAL ROLE "${safeRole}"`));
                            const result = await tx.execute(this.buildStatement(sqlText, options?.params));
                            return result.rows as Record<string, unknown>[];
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
                            this._roleSwitchingUnavailable = true;
                            throw new RoleSwitchUnavailableError(options.role, roleError);
                        }
                        throw roleError;
                    }
                }
            }

            const result = await targetDb.execute(this.buildStatement(sqlText, options?.params));
            return result.rows as Record<string, unknown>[];
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

        // Also fetch enum values for any USER-DEFINED columns
        const enumColumns = columns.filter((c) => c.data_type === "USER-DEFINED");
        if (enumColumns.length > 0) {
            for (const col of enumColumns) {
                try {
                    const enumResult = await this.db.execute(drizzleSql`
                        SELECT e.enumlabel
                        FROM pg_type t
                        JOIN pg_enum e ON t.oid = e.enumtypid
                        WHERE t.typname = ${col.udt_name as string}
                        ORDER BY e.enumsortorder
                    `);
                    col.enum_values = (enumResult.rows as Record<string, unknown>[]).map(e => e.enumlabel);
                } catch {
                    col.enum_values = [];
                }
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
    async withAuth(user: User): Promise<DataDriver> {
        return new AuthenticatedPostgresBackendDriver(this, user);
    }
}

export class AuthenticatedPostgresBackendDriver implements DataDriver {
    key = "postgres";
    initialised = true;

    public user: User;
    public data: RebaseSdkData;

    constructor(
        public delegate: PostgresBackendDriver,
        user: User
    ) {
        this.user = user;
        this.data = buildSdkData(this);

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

    private async withTransaction<T>(
        operation: (delegate: PostgresBackendDriver) => Promise<T>,
        options?: {
            accessMode?: "read only" | "read write";
            isolationLevel?: "read uncommitted" | "read committed" | "repeatable read" | "serializable"
        }
    ): Promise<T> {
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
            await runInWriteScope(writeScope, () => this.delegate.db.transaction(async (tx) => {
                if (!this.user?.uid) {
                    logger.warn("[DataDriver] User ID (uid) is missing for authenticated delegate. Using 'anonymous'. User object", { detail: this.user });
                }
                if (!this.user?.roles) {
                    logger.warn("[DataDriver] User roles are missing for authenticated delegate. Using empty array. User object", { detail: this.user });
                }

                // Set the RLS GUCs and downgrade to the restricted user role so RLS
                // binds every statement in this transaction — reads AND writes.
                // This is user context: the collection's securityRules are the
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
                await applyAuthContext(tx, authContextOf(this.user), this.delegate.rlsUserRole);

                // Bound to `tx`, so a `beforeQuery` on this request sees the
                // caller and reads through the same RLS-scoped transaction the
                // rows come from — the correction `callContextWithin` was
                // written for, applied to the hook as well as to `afterRead`.
                // Built at most once per request, and only for a collection
                // that declares a hook.
                let hookContext: RebaseCallContext | undefined;
                const txEntityService = new DataService(
                    tx, this.delegate.registry,
                    () => (hookContext ??= this.delegate.callContextWithin(tx, this.user))
                );
                const txDelegate = new PostgresBackendDriver(tx, this.delegate.realtimeService, this.delegate.registry, this.user, this.delegate.poolManager, this.delegate.historyService);

                txDelegate.dataService = txEntityService;
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
            }, options)).finally(() => writeScope?.close())
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
        return this.withTransaction((delegate) => delegate.save(props));
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
        return this.withTransaction((delegate) => delegate.saveMany(props));
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
        return this.withTransaction((delegate) => delegate.updateMany(props));
    }

    async deleteMany<M extends Record<string, unknown>>(props: DeleteManyProps<M>): Promise<void> {
        return this.withTransaction((delegate) => delegate.deleteMany(props));
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
        return this.withTransaction((delegate) => delegate.delete(props));
    }

    async deleteAll(path: string): Promise<void> {
        return this.withTransaction((delegate) => delegate.deleteAll(path));
    }

    async updateRelationPivot(props: UpdateRelationPivotProps): Promise<void> {
        return this.withTransaction((delegate) => delegate.updateRelationPivot(props));
    }

    async checkUniqueField(
        path: string,
        name: string,
        value: unknown,
        id?: string,
        collection?: CollectionConfig
    ): Promise<boolean> {
        return this.withTransaction((delegate) => delegate.checkUniqueField(path, name, value, id, collection), { accessMode: "read only" });
    }

    async count<M extends Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<number> {
        return this.withTransaction((delegate) => delegate.count(props), { accessMode: "read only" });
    }

}
