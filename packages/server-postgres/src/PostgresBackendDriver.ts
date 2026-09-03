import { DataService } from "./services/dataService";
import { BranchService } from "./services/BranchService";
import { RealtimeService } from "./services/realtimeService";
import { DatabasePoolManager } from "./databasePoolManager";
import { DrizzleClient } from "./interfaces";
import {
    DatabaseAdmin,
    DataDriver,
    DeleteProps,
    CollectionConfig,
    FetchCollectionProps,
    FetchOneProps,
    ListenCollectionProps,
    ListenOneProps,
    RebaseCallContext,
    RebaseClient,
    RebaseData,
    RebaseSdkData,
    RestFetchService,
    SaveManyProps,
    SaveProps,
    StorageSource,
    UpdateManyProps,
    DeleteManyProps,
    EntityValues,
    TableColumnInfo,
    TableForeignKeyInfo,
    TableJunctionInfo,
    TableMetadata,
    TablePolicyInfo,
    User
} from "@rebasepro/types";
import { sql as drizzleSql } from "drizzle-orm";
import { buildPropertyCallbacks, buildSdkData, classifyTable, detectJunctionTables, resolveCollectionRelations, toCallbackError, updateDateAutoValues } from "@rebasepro/common";
import { PostgresCollectionRegistry } from "./collections/PostgresCollectionRegistry";
import { deriveRowAddress } from "./services/collection-helpers";
import { HistoryService } from "./history/HistoryService";
import { mergeDeep } from "@rebasepro/utils";
import { logger } from "@rebasepro/server";
import { isRoleSwitchingPermissionError } from "./utils/pg-error-utils";
import { applyAuthContext } from "./security/rls-enforcement";
import { generateSchemaCommit } from "./schema/generate-schema-commit";
import { readSchemaFactsFor, type Queryable } from "./schema/ensure-collection-tables";

/**
 * Has an operator opted out of database role switching entirely?
 *
 * `DISABLE_DB_ROLE_SWITCHING=true` is documented (README, the configuration
 * page, the backend skill) as "run Studio SQL Editor queries as the connection
 * owner", for deployments whose application roles have no database role behind
 * them. It is the only sanctioned way a statement that named a role runs
 * without it — every other route now refuses.
 *
 * Exact `"true"` on purpose, matching the check this replaced. `=1` and `=yes`
 * silently do nothing, which `docs/audits/80-config-and-env.md` already records
 * as a finding across the env surface; fixing it here alone would make this one
 * variable disagree with the rest.
 */
export function isRoleSwitchingOptedOut(): boolean {
    return process.env.DISABLE_DB_ROLE_SWITCHING === "true";
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

export class PostgresBackendDriver implements DataDriver {
    key = "postgres";
    initialised = true;

    public dataService: DataService;
    public realtimeService: RealtimeService;
    public historyService?: HistoryService;
    public branchService?: BranchService;
    public user?: User;
    public data: RebaseSdkData;
    public client?: RebaseClient;

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
        this.dataService = new DataService(db, registry);
        this.realtimeService = realtimeService;
        this.historyService = historyService;
        this.user = user;
        this.data = buildSdkData(this);

        // Initialize BranchService when adminConnectionString is configured
        if (poolManager) {
            this.branchService = new BranchService(db, poolManager);
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
                const result = await this.db.execute(drizzleSql.raw(text));
                const rows = (result as unknown as { rows?: T[] }).rows;
                return { rows: rows ?? (Array.isArray(result) ? (result as T[]) : []) };
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
            fetchOneForRest: async (collectionPath, id, include, databaseId) => {
                const row = await raw.fetchOneForRest(collectionPath, id, include, databaseId);
                if (!row) return row;
                const [masked] = await this.applyAfterReadForRest([row], collectionPath);
                return masked;
            }
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
     * Previously returned through `as unknown as RebaseCallContext`, which
     * disabled checking for the whole object and let `driver` — documented in
     * the callbacks guide — sit on the runtime context while absent from the
     * contract. Both are declared now, so this is a plain typed return.
     */
    private buildCallContext(): RebaseCallContext {
        return {
            user: this.user,
            driver: this,
            data: this.data,
            client: this.client as RebaseCallContext["client"],
            storageSource: this.client?.storage as StorageSource
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
        if (globalCallbacks?.afterRead) {
            out = await globalCallbacks.afterRead({
                collection: resolvedCollection as unknown as CollectionConfig,
                path, row: out, context: contextForCallback
            }) ?? out;
        }
        if (callbacks?.afterRead) {
            out = await callbacks.afterRead({
                collection: resolvedCollection as CollectionConfig,
                path, row: out, context: contextForCallback
            }) ?? out;
        }
        if (propertyCallbacks?.afterRead) {
            out = await propertyCallbacks.afterRead({
                collection: resolvedCollection as unknown as CollectionConfig,
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
                    const targetResolved = this.resolveCollectionCallbacks(undefined, targetPath);
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

    async fetchCollection<M extends Record<string, unknown>>({
                                                                 path,
                                                                 collection,
                                                                 filter,
                                                                 limit,
                                                                 offset,
                                                                 startAfter,
                                                                 orderBy,
                                                                 searchString,
                                                                 order,
                                                                 vectorSearch
                                                             }: FetchCollectionProps<M>): Promise<Record<string, unknown>[]> {

        const rows = await this.dataService.fetchCollection<M>(path, {
            filter,
            orderBy,
            order,
            limit,
            offset,
            startAfter: startAfter as Record<string, unknown> | undefined,
            databaseId: collection?.databaseId,
            searchString,
            vectorSearch
        });

        const {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        } = this.resolveCollectionCallbacks(collection, path);

        if (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead) {
            const contextForCallback = this.buildCallContext();
            return Promise.all(rows.map(async (row) => {
                let fetched = row;
                // 1. Global callbacks first
                if (globalCallbacks?.afterRead) {
                    fetched = await globalCallbacks.afterRead({
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        row: fetched,
                        context: contextForCallback
                    });
                }
                // 2. Collection callbacks second
                if (callbacks?.afterRead) {
                    fetched = await callbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                // 3. Property callbacks third
                if (propertyCallbacks?.afterRead) {
                    fetched = await propertyCallbacks.afterRead({
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        row: fetched,
                        context: contextForCallback
                    });
                }
                return fetched;
            }));
        }

        return rows;
    }

    listenCollection<M extends Record<string, unknown>>({
                                                            path,
                                                            collection,
                                                            filter,
                                                            limit,
                                                            offset,
                                                            startAfter,
                                                            orderBy,
                                                            searchString,
                                                            order,
                                                            onUpdate,
                                                            onError
                                                        }: ListenCollectionProps<M>): () => void {

        const subscriptionId = this.generateSubscriptionId();

        // Type-adapter wrapper: RealtimeService expects a union callback signature
        const callbackWrapper = (rows: Record<string, unknown>[]) => {
            onUpdate(rows);
        };

        // Store the subscription in RealtimeService properly using the new public method
        this.realtimeService.registerDataDriverSubscription(subscriptionId, {
            clientId: "driver",
            type: "collection" as const,
            path,
            collectionRequest: {
                filter,
                orderBy,
                order,
                limit,
                offset,
                startAfter: startAfter as Record<string, unknown> | undefined,
                databaseId: collection?.databaseId,
                searchString
            }
        });

        // Store the callback for this subscription
        this.realtimeService.addSubscriptionCallback(subscriptionId, callbackWrapper as (data: Record<string, unknown> | Record<string, unknown>[] | null) => void);

        // Send initial data immediately
        this.fetchCollection({
            path: path,
            collection,
            filter,
            limit,
            offset,
            startAfter,
            orderBy,
            searchString,
            order
        }).then(rows => {
            callbackWrapper(rows);
        }).catch(error => {
            if (onError) onError(error);
        });

        return () => {
            this.realtimeService.removeSubscriptionCallback(subscriptionId);
            this.realtimeService.subscriptions.delete(subscriptionId);
        };
    }

    async fetchOne<M extends Record<string, unknown>>({
                                                             path,
                                                             id,
                                                             databaseId,
                                                             collection
                                                         }: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        let row = await this.dataService.fetchOne<M>(
            path,
            id,
            databaseId || collection?.databaseId
        );

        const {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        } = this.resolveCollectionCallbacks(collection, path);

        if (row && (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead)) {
            const contextForCallback = this.buildCallContext();
            // 1. Global callbacks first
            if (globalCallbacks?.afterRead) {
                row = await globalCallbacks.afterRead({
                    collection: resolvedCollection as unknown as CollectionConfig,
                    path,
                    row,
                    context: contextForCallback
                });
            }
            // 2. Collection callbacks second
            if (callbacks?.afterRead) {
                row = await callbacks.afterRead({
                    collection: resolvedCollection as CollectionConfig<M>,
                    path,
                    row,
                    context: contextForCallback
                }) ?? row;
            }
            // 3. Property callbacks third
            if (propertyCallbacks?.afterRead) {
                row = await propertyCallbacks.afterRead({
                    collection: resolvedCollection as unknown as CollectionConfig,
                    path,
                    row,
                    context: contextForCallback
                });
            }
        }

        return row;
    }

    listenOne<M extends Record<string, unknown>>({
                                                        path,
                                                        id,
                                                        collection,
                                                        onUpdate,
                                                        onError
                                                    }: ListenOneProps<M>): () => void {

        const subscriptionId = this.generateSubscriptionId();
        const callbackWrapper = (row: Record<string, unknown> | null) => {
            if (row)
                onUpdate(row);
        };

        // Register the subscription with the RealtimeService
        this.realtimeService.registerDataDriverSubscription(subscriptionId, {
            clientId: "driver",
            type: "single" as const,
            path,
            id
        });

        // Store the callback for this subscription
        this.realtimeService.addSubscriptionCallback(subscriptionId, callbackWrapper as (data: Record<string, unknown> | Record<string, unknown>[] | null) => void);

        // Fetch initial data
        this.fetchOne({
            path,
            id,
            collection
        })
            .then(row => {
                if (row) onUpdate(row);
            })
            .catch(error => {
                if (onError) onError(error as Error);
            });

        // Return the unsubscribe function
        return () => {
            this.realtimeService.removeSubscriptionCallback(subscriptionId);
            this.realtimeService.subscriptions.delete(subscriptionId);
        };
    }

    async save<M extends Record<string, unknown>>({
                                                            path,
                                                            id,
                                                            values,
                                                            collection,
                                                            status,
                                                            upsert
                                                        }: SaveProps<M>): Promise<Record<string, unknown>> {

        const {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        } = this.resolveCollectionCallbacks(collection, path);

        let updatedValues = values;
        const contextForCallback = this.buildCallContext();

        // Fetch previous values for callbacks AND history recording. Same walk
        // as the saved row the callbacks receive (`fetchOneForRest`), so
        // `values` and `previousValues` compare like with like — a Date on one
        // side and its ISO string on the other reads as a change that never
        // happened.
        let previousValuesForHistory: Partial<M> | undefined;
        if (status === "existing" && id) {
            try {
                const existing = await this.dataService.getFetchService()
                    .fetchOneForRest(path, id, undefined, resolvedCollection?.databaseId);
                if (existing) {
                    const { id: _existingId, ...existingValues } = existing;
                    previousValuesForHistory = existingValues as Partial<M>;
                }
            } catch (err) {
                // Best-effort enrichment: callbacks and history run without
                // previous values rather than the save failing on a read the
                // write itself does not need (e.g. a collection whose key the
                // registry cannot resolve).
                logger.debug(`[save] Could not fetch previous values for "${path}"`, { detail: err instanceof Error ? err.message : String(err) });
            }
        }

        // A `before*` callback is the application speaking, not the server
        // failing: a bare `throw` is the documented way to block a write, so it
        // answers 400 with the author's message rather than a masked 500.
        try {
            if (globalCallbacks?.beforeSave || callbacks?.beforeSave || propertyCallbacks?.beforeSave) {
                // 1. Global callbacks first
                if (globalCallbacks?.beforeSave) {
                    const result = await globalCallbacks.beforeSave({
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        id,
                        values: updatedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                    if (result) updatedValues = mergeDeep(updatedValues, result);
                }

                // 2. Collection callbacks second
                if (callbacks?.beforeSave) {
                    const result = await callbacks.beforeSave({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        id,
                        values: updatedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                    if (result) updatedValues = mergeDeep(updatedValues, result);
                }

                // 3. Property callbacks third
                if (propertyCallbacks?.beforeSave) {
                    const result = await propertyCallbacks.beforeSave({
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        id,
                        values: updatedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                    if (result) updatedValues = mergeDeep(updatedValues, result);
                }

            }
        } catch (callbackError) {
            throw toCallbackError(callbackError, "beforeSave", path);
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
        }

        try {
            let savedRow = await this.dataService.save<M>(
                path,
                updatedValues,
                id,
                resolvedCollection?.databaseId,
                { upsert }
            );

            if (savedRow && (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead)) {
                // 1. Global callbacks first
                if (globalCallbacks?.afterRead) {
                    savedRow = await globalCallbacks.afterRead({
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    });
                }
                // 2. Collection callbacks second
                if (callbacks?.afterRead) {
                    savedRow = await callbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    }) ?? savedRow;
                }
                // 3. Property callbacks third
                if (propertyCallbacks?.afterRead) {
                    savedRow = await propertyCallbacks.afterRead({
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    });
                }
            }

            // The row is exactly its columns, so its address is derived, not read
            // off it: `savedRow.id` is undefined for every table whose key is not
            // literally named `id`, and is ordinary data for a table that has such
            // a column without it being the key.
            const savedId = deriveRowAddress(
                savedRow,
                (resolvedCollection ?? collection) as CollectionConfig,
                this.registry
            );
            // `values` are the row's columns — all of them. For an `id`-keyed table
            // that includes `id`, which used to be stripped here because it was the
            // synthesized address rather than the column it now is.
            const savedValues = savedRow;

            if (globalCallbacks?.afterSave || callbacks?.afterSave || propertyCallbacks?.afterSave) {
                // 1. Global callbacks first
                if (globalCallbacks?.afterSave) {
                    await globalCallbacks.afterSave({
                        collection: resolvedCollection as unknown as CollectionConfig,
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
                        collection: resolvedCollection as CollectionConfig<M>,
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
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        id: savedId,
                        values: savedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                }
            }

            // Record row history (fire-and-forget, never blocks the save)
            if (this.historyService && resolvedCollection?.history) {
                this.historyService.recordHistory({
                    tableName: path,
                    id: savedId,
                    action: status === "new" ? "create" : "update",
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
                // 1. Global callbacks first
                if (globalCallbacks?.afterSaveError) {
                    await globalCallbacks.afterSaveError({
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        id: id || "unknown",
                        values: updatedValues,
                        previousValues: undefined,
                        status,
                        context: contextForCallback
                    });
                }
                // 2. Collection callbacks second
                if (callbacks?.afterSaveError) {
                    await callbacks.afterSaveError({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        id: id || "unknown",
                        values: updatedValues,
                        previousValues: undefined,
                        status,
                        context: contextForCallback
                    });
                }
                // 3. Property callbacks third
                if (propertyCallbacks?.afterSaveError) {
                    await propertyCallbacks.afterSaveError({
                        collection: resolvedCollection as unknown as CollectionConfig,
                        path,
                        id: id || "unknown",
                        values: updatedValues,
                        previousValues: undefined,
                        status,
                        context: contextForCallback
                    });
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
    async saveMany<M extends Record<string, unknown>>({
                                                          path,
                                                          rows,
                                                          collection,
                                                          upsert
                                                      }: SaveManyProps<M>): Promise<Record<string, unknown>[]> {
        return this.db.transaction(async (tx) => {
            // Bind the whole batch to the transaction handle. Without this the
            // rows would be written through `this.db` and survive a rollback.
            const txDriver = new PostgresBackendDriver(
                tx, this.realtimeService, this.registry, this.user, this.poolManager, this.historyService
            );
            txDriver.dataService = new DataService(tx, this.registry);
            txDriver.client = this.client;
            // Carry the caller's notification batching through, so a bulk write
            // nested in an outer transaction still holds its events until commit.
            txDriver._deferNotifications = this._deferNotifications;
            txDriver._pendingNotifications = this._pendingNotifications;

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
                        upsert
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
            const txDriver = new PostgresBackendDriver(
                tx, this.realtimeService, this.registry, this.user, this.poolManager, this.historyService
            );
            txDriver.dataService = new DataService(tx, this.registry);
            txDriver.client = this.client;
            txDriver._deferNotifications = this._deferNotifications;
            txDriver._pendingNotifications = this._pendingNotifications;

            const saved: Record<string, unknown>[] = [];

            for (let i = 0; i < updates.length; i++) {
                const { id, values } = updates[i];
                try {
                    // Read first so a missing row is a 404 rather than a silent
                    // no-op. `save` with status "existing" would otherwise write
                    // an UPDATE that matches nothing and report success.
                    const existing = await txDriver.fetchOne({
                        path,
                        id: String(id),
                        collection: collection as CollectionConfig
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
        collection
    }: DeleteManyProps<M>): Promise<void> {
        await this.db.transaction(async (tx) => {
            const txDriver = new PostgresBackendDriver(
                tx, this.realtimeService, this.registry, this.user, this.poolManager, this.historyService
            );
            txDriver.dataService = new DataService(tx, this.registry);
            txDriver.client = this.client;
            txDriver._deferNotifications = this._deferNotifications;
            txDriver._pendingNotifications = this._pendingNotifications;

            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                try {
                    const existing = await txDriver.fetchOne({
                        path,
                        id: String(id),
                        collection: collection as CollectionConfig
                    });
                    if (!existing) {
                        throw Object.assign(new Error(`No row with id ${JSON.stringify(id)}`), {
                            statusCode: 404,
                            code: "NOT_FOUND"
                        });
                    }

                    await txDriver.delete<M>({
                        row: {
                            // The address from the caller, not read back off the
                            // row: a row is only its columns, so `existing.id` is
                            // undefined for any table not keyed on `id`.
                            id: String(id),
                            path,
                            values: existing as Partial<EntityValues<M>>
                        },
                        collection
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

    async delete<M extends Record<string, unknown>>({
                                                              row,
                                                              collection
                                                          }: DeleteProps<M>): Promise<void> {

        const targetPath = row.path;
        // The callbacks' `row` is the row: its columns, nothing else. The address
        // travels beside it as `id`, so merging it in here only ever invented an
        // `id` field for tables that have no such column.
        const targetRow: Record<string, unknown> = { ...(row.values ?? {}) };

        // Resolve from backend registry to restore callbacks lost during WebSocket serialization
        const {
            collection: resolvedCollection,
            callbacks,
            globalCallbacks,
            propertyCallbacks
        } = this.resolveCollectionCallbacks(collection, targetPath);

        const contextForCallback = this.buildCallContext();

        // A `before*` callback is the application speaking, not the server
        // failing: a bare `throw` is the documented way to block a write, so it
        // answers 400 with the author's message rather than a masked 500.
        try {
            if (globalCallbacks?.beforeDelete || callbacks?.beforeDelete || propertyCallbacks?.beforeDelete) {
                let preventDefault = false;
                // 1. Global callbacks first
                if (globalCallbacks?.beforeDelete) {
                    const result = await globalCallbacks.beforeDelete({
                        collection: resolvedCollection as unknown as CollectionConfig,
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
                        collection: resolvedCollection as CollectionConfig<M>,
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
                        collection: resolvedCollection as unknown as CollectionConfig,
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
                    return;
                }
            }
        } catch (callbackError) {
            throw toCallbackError(callbackError, "beforeDelete", targetPath);
        }

        await this.dataService.delete(
            targetPath,
            row.id,
            resolvedCollection?.databaseId
        );

        if (globalCallbacks?.afterDelete || callbacks?.afterDelete || propertyCallbacks?.afterDelete) {
            // 1. Global callbacks first
            if (globalCallbacks?.afterDelete) {
                await globalCallbacks.afterDelete({
                    collection: resolvedCollection as unknown as CollectionConfig,
                    path: targetPath,
                    id: row.id,
                    row: targetRow,
                    context: contextForCallback
                });
            }
            // 2. Collection callbacks second
            if (callbacks?.afterDelete) {
                await callbacks.afterDelete({
                    collection: resolvedCollection as CollectionConfig<M>,
                    path: targetPath,
                    id: row.id,
                    row: targetRow,
                    context: contextForCallback
                });
            }
            // 3. Property callbacks third
            if (propertyCallbacks?.afterDelete) {
                await propertyCallbacks.afterDelete({
                    collection: resolvedCollection as unknown as CollectionConfig,
                    path: targetPath,
                    id: row.id,
                    row: targetRow,
                    context: contextForCallback
                });
            }
        }

        // Record delete history (fire-and-forget)
        if (this.historyService && resolvedCollection?.history) {
            this.historyService.recordHistory({
                tableName: targetPath,
                id: row.id.toString(),
                action: "delete",
                values: row.values as Record<string, unknown> ?? {},
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
                                                               vectorSearch
                                                           }: FetchCollectionProps<M>): Promise<number> {
        return this.dataService.count(
            path,
            {
                filter,
                // Counted as well as filtered, or `meta.total` describes a
                // different set of rows from the `data` beside it. The same
                // held for a `vectorSearch` carrying a `threshold`: it narrows
                // the fetch, so it has to narrow the count.
                logical,
                searchString,
                vectorSearch
            }
        );
    }

    private getTargetDb(databaseName?: string): DrizzleClient {
        if (!databaseName || databaseName === this.poolManager?.defaultDatabaseName) {
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
        params?: unknown[]
    }): Promise<Record<string, unknown>[]> {
        if (!options?.database && !options?.role) {
            return this.dataService.executeSql(sqlText, options?.params);
        }

        const targetDb = this.getTargetDb(options?.database);

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
        const currentDb = this.poolManager?.defaultDatabaseName;
        if (currentDb && !databases.includes(currentDb)) {
            databases.unshift(currentDb);
        } else if (currentDb) {
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
        return this.poolManager?.defaultDatabaseName;
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
        // SAFETY: Raw SQL result rows are typed as QueryResultRow[]; the query shape matches TableColumnInfo
        const typedColumns = columns as unknown as TableColumnInfo[];

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
        const policiesResult = await this.db.execute(drizzleSql`
            SELECT 
                polname as policy_name, 
                polcmd as cmd, 
                polroles::regrole[]::text[] as roles, 
                pg_get_expr(polqual, polrelid) as qual, 
                pg_get_expr(polwithcheck, polrelid) as with_check
            FROM pg_policy
            WHERE polrelid = (SELECT oid FROM pg_class WHERE relname = ${safeName} AND relnamespace = 'public'::regnamespace);
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
            fetchOneForRest: async (collectionPath, id, include, databaseId) => {
                return this.withTransaction(async (delegate) => {
                    return delegate.restFetchService.fetchOneForRest(collectionPath, id, include, databaseId);
                }, { accessMode: "read only" });
            }
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

        const result = await this.delegate.db.transaction(async (tx) => {
            let uid = this.user?.uid;
            if (!uid) {
                logger.warn("[DataDriver] User ID (uid) is missing for authenticated delegate. Using 'anonymous'. User object", { detail: this.user });
                uid = "anonymous";
            }

            const userRoles = this.user?.roles ?? [];
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
            // POST /auth/anonymous". See `rebase.is_anonymous()`.
            await applyAuthContext(
                tx,
                { uid, roles: userRoles, isAnonymous: this.user?.isAnonymous === true },
                this.delegate.rlsUserRole
            );

            const txEntityService = new DataService(tx, this.delegate.registry);
            const txDelegate = new PostgresBackendDriver(tx, this.delegate.realtimeService, this.delegate.registry, this.user, this.delegate.poolManager, this.delegate.historyService);

            txDelegate.dataService = txEntityService;
            txDelegate._deferNotifications = true;
            txDelegate._pendingNotifications = pendingNotifications;
            txDelegate.client = this.delegate.client;

            return await operation(txDelegate);
        }, options);

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
     * Injects the authenticated user's context into the most recently
     * registered realtime subscription so RLS-aware polling can apply.
     */
    private injectAuthContext(unsubscribe: () => void): () => void {
        const authContext = {
            uid: this.user?.uid || "anonymous",
            roles: this.user?.roles ?? []
        };
        const entries = Array.from(this.delegate.realtimeService.subscriptions.entries());
        const lastEntry = entries[entries.length - 1];
        const lastSub = lastEntry?.[1] as Record<string, unknown> | undefined;
        if (lastSub && lastSub.clientId === "driver") {
            lastSub.authContext = authContext;
        }
        return unsubscribe;
    }

    listenCollection<M extends Record<string, unknown>>(props: ListenCollectionProps<M>): () => void {
        return this.injectAuthContext(this.delegate.listenCollection(props));
    }

    async fetchOne<M extends Record<string, unknown>>(props: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        return this.withTransaction((delegate) => delegate.fetchOne(props), { accessMode: "read only" });
    }

    listenOne<M extends Record<string, unknown>>(props: ListenOneProps<M>): () => void {
        return this.injectAuthContext(this.delegate.listenOne(props));
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

    async delete<M extends Record<string, unknown>>(props: DeleteProps<M>): Promise<void> {
        return this.withTransaction((delegate) => delegate.delete(props));
    }

    async deleteAll(path: string): Promise<void> {
        return this.withTransaction((delegate) => delegate.deleteAll(path));
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
