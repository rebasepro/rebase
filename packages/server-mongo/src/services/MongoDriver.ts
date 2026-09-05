/**
 * MongoDB DataDriver Delegate
 *
 * Implements the DataDriver interface for Rebase frontend integration.
 * This is the main entry point for Rebase to interact with MongoDB.
 */

import { Db } from "mongodb";
import {
    DataDriver,
    DeleteProps,
    Entity,
    CollectionConfig,
    FetchCollectionProps,
    FetchOneProps,
    ListenCollectionProps,
    ListenOneProps,
    SaveProps,
    RebaseCallContext,
    CollectionRegistryInterface,
    User,
    RebaseClient,
    RebaseData,
    RebaseSdkData,
    SecurityOperation
} from "@rebasepro/types";
import { MongoDataService } from "../db/MongoDataService";
import { MongoRealtimeService } from "./MongoRealtimeService";
import { MongoHistoryService } from "./MongoHistoryService";
import { buildPropertyCallbacks, buildSdkData, checkOperation, PolicyClauses, toCallbackError, updateDateAutoValues } from "@rebasepro/common";
import { mergeDeep } from "@rebasepro/utils";
import { Filter, Document } from "mongodb";
import { ApiError } from "@rebasepro/server";
import { MongoConditionBuilder } from "../db/MongoConditionBuilder";
import { assertSecurityRulesEnforceable, buildMongoFilterFromSecurityRules } from "../db/securityRuleFilter";
import { logger } from "@rebasepro/server";

/**
 * MongoDB DataDriver Delegate
 *
 * Implements the DataDriver interface for Rebase.
 * Provides all data operations needed by the Rebase frontend.
 */
export class MongoDriver implements DataDriver {
    key = "mongodb";
    initialised = true;

    private dataService: MongoDataService;
    private realtimeService: MongoRealtimeService;
    public historyService: MongoHistoryService;
    public user?: User;
    public data: RebaseSdkData;
    public client?: RebaseClient;

    constructor(
        private db: Db,
        realtimeService?: MongoRealtimeService,
        historyService?: MongoHistoryService,
        public readonly registry?: CollectionRegistryInterface,
        user?: User
    ) {
        this.dataService = new MongoDataService(db);
        this.realtimeService = realtimeService ?? new MongoRealtimeService(db);
        this.historyService = historyService ?? new MongoHistoryService(db);
        this.user = user;
        this.data = buildSdkData(this);
        this.realtimeService.setDataDriver(this);
    }

    /**
     * Get the current timestamp
     */
    currentTime(): Date {
        return new Date();
    }

    /**
     * Resolve a collection's callbacks and property callbacks from the registry.
     * Used by AuthenticatedMongoDriver to apply callbacks after RLS filtering.
     */
    resolveCollectionCallbacks<M extends Record<string, unknown>>(
        collection: CollectionConfig<M> | undefined,
        path: string
    ) {
        if (!collection && !path) return { collection: undefined,
callbacks: undefined,
globalCallbacks: undefined,
propertyCallbacks: undefined };
        const registryCollection = this.registry?.getCollectionByPath(path);
        const resolvedCollection = registryCollection
            ? ({ ...collection,
...registryCollection } as CollectionConfig<M>)
            : (collection as CollectionConfig<M>);

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
     * Fetch a collection of rows
     */
    async fetchCollection<M extends Record<string, any>>(
        props: FetchCollectionProps<M>
    ): Promise<Record<string, unknown>[]> {
        // Forwarded whole rather than re-listed. The hand-written list here
        // named eight of the eleven fields `FetchCollectionProps` declares, so
        // `logical` and `offset` were accepted by every type-checked boundary
        // above and then dropped — an `or(...)` query ran unfiltered and
        // `?offset=` served page one.
        const { path, collection, ...query } = props;
        const rows = await this.dataService.fetchCollection<M>(path, {
            ...query,
            collection: collection as CollectionConfig
        });

        const { collection: resolvedCollection, callbacks, globalCallbacks, propertyCallbacks } = this.resolveCollectionCallbacks(collection, path);

        if (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead) {
            const contextForCallback = {
                user: this.user,
                driver: this,
                data: this.data,
                client: this.client,
                storageSource: this.client?.storage
            } as unknown as RebaseCallContext; // Backend context
            return Promise.all(rows.map(async (row) => {
                let fetched = row;
                if (globalCallbacks?.afterRead) {
                    fetched = await globalCallbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                if (callbacks?.afterRead) {
                    fetched = await callbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                if (propertyCallbacks?.afterRead) {
                    fetched = await propertyCallbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
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
     * Listen to collection changes.
     *
     * `authContext` is not part of `ListenCollectionProps`; it is supplied by
     * {@link AuthenticatedMongoDriver}, which is the only caller that has one.
     * It has to travel *into* the subscription config, because that config is
     * what every re-fetch reads — the wrapper used to stamp the field on the
     * `Subscription` object instead, and nothing has ever read that one.
     */
    listenCollection<M extends Record<string, any>>(
        // `collection` is re-resolved from the registry on every re-fetch, and
        // `vectorSearch` is not a thing a subscription can do — the Postgres
        // service refuses it outright rather than run it once and never again.
        { onUpdate, onError, collection, vectorSearch, ...query }: ListenCollectionProps<M>,
        authContext?: { uid: string; roles: string[] }
    ): () => void {
        const subscriptionId = this.generateSubscriptionId();

        const callback = (rows: Record<string, unknown>[]) => {
            try {
                onUpdate(rows);
            } catch (error) {
                logger.error("Error in collection update callback", { error: error });
                if (onError) {
                    onError(error instanceof Error ? error : new Error(String(error)));
                }
            }
        };

        // Forwarded whole rather than re-listed, for the reason `fetchCollection`
        // gives above: the hand-written list named seven of the eleven fields
        // `ListenCollectionProps` declares, so `logical` and `offset` were
        // accepted at every type-checked boundary and then dropped — an
        // `or(...)` subscription was pushed every row, and a subscription to
        // page two was pushed page one.
        this.realtimeService.subscribeToCollection(
            subscriptionId,
            { clientId: "driver", ...query, authContext },
            callback
        );

        // Return unsubscribe function
        return () => {
            this.realtimeService.unsubscribe(subscriptionId);
        };
    }

    /**
     * Fetch a single row
     */
    async fetchOne<M extends Record<string, any>>({
        path,
        id,
        databaseId,
        collection
    }: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        let row = await this.dataService.fetchOne<M>(path, id, databaseId);

        const { collection: resolvedCollection, callbacks, globalCallbacks, propertyCallbacks } = this.resolveCollectionCallbacks(collection, path);

        if (row && (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead)) {
            const contextForCallback = {
                user: this.user,
                driver: this,
                data: this.data,
                client: this.client,
                storageSource: this.client?.storage
            } as unknown as RebaseCallContext; // Backend context
            let processedRow: Record<string, unknown> = row;
            if (globalCallbacks?.afterRead) {
                processedRow = await globalCallbacks.afterRead({
                    collection: resolvedCollection as CollectionConfig<M>,
                    path,
                    row: processedRow,
                    context: contextForCallback
                }) ?? processedRow;
            }
            if (callbacks?.afterRead) {
                processedRow = await callbacks.afterRead({
                    collection: resolvedCollection as CollectionConfig<M>,
                    path,
                    row: processedRow,
                    context: contextForCallback
                }) ?? processedRow;
            }
            if (propertyCallbacks?.afterRead) {
                processedRow = await propertyCallbacks.afterRead({
                    collection: resolvedCollection as CollectionConfig<M>,
                    path,
                    row: processedRow,
                    context: contextForCallback
                }) ?? processedRow;
            }
            row = processedRow;
        }

        return row;
    }

    /**
     * Listen to row changes
     */
    listenOne<M extends Record<string, any>>({
        path,
        id,
        collection,
        onUpdate,
        onError
    }: ListenOneProps<M>, authContext?: { uid: string; roles: string[] }): () => void {
        const subscriptionId = this.generateSubscriptionId();

        const callback = (row: Record<string, unknown> | null) => {
            try {
                onUpdate(row);
            } catch (error) {
                logger.error("Error in row update callback", { error: error });
                if (onError) {
                    onError(error instanceof Error ? error : new Error(String(error)));
                }
            }
        };

        this.realtimeService.subscribeToOne(
            subscriptionId,
            {
                clientId: "driver",
                path,
                id,
                authContext
            },
            callback
        );

        // Return unsubscribe function
        return () => {
            this.realtimeService.unsubscribe(subscriptionId);
        };
    }

    /**
     * Save an row (create or update)
     */
    async save<M extends Record<string, any>>({
        path,
        id,
        values,
        collection,
        status
    }: SaveProps<M>): Promise<Record<string, unknown>> {
        const { collection: resolvedCollection, callbacks, globalCallbacks, propertyCallbacks } = this.resolveCollectionCallbacks(collection, path);

        let updatedValues = values;
        const contextForCallback = {
            user: this.user,
            driver: this,
            data: this.data,
            client: this.client,
            storageSource: this.client?.storage
        } as unknown as RebaseCallContext;

        // Fetch previous values for callbacks AND history recording
        let previousValuesForHistory: Partial<M> | undefined;
        if (status === "existing" && id) {
            const existing = await this.dataService.fetchOne<M>(path, id, resolvedCollection?.databaseId);
            if (existing) {
                const { id: _existingId, ...existingValues } = existing;
                previousValuesForHistory = existingValues as Partial<M>;
            }
        }

        // A `before*` callback is the application speaking, not the server
        // failing: a bare `throw` is the documented way to block a write, so it
        // answers 400 with the author's message rather than a masked 500.
        try {
            if (globalCallbacks?.beforeSave || callbacks?.beforeSave || propertyCallbacks?.beforeSave) {
                if (globalCallbacks?.beforeSave) {
                    const result = await globalCallbacks.beforeSave({
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

                if (propertyCallbacks?.beforeSave) {
                    const result = await propertyCallbacks.beforeSave({
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
            }
        } catch (callbackError) {
            throw toCallbackError(callbackError, "beforeSave", path);
        }

        // Apply autoValue timestamps (on_create / on_update) at the application layer.
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
                resolvedCollection?.databaseId
            );

            if (savedRow && (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead)) {
                if (globalCallbacks?.afterRead) {
                    savedRow = await globalCallbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    }) ?? savedRow;
                }
                if (callbacks?.afterRead) {
                    savedRow = await callbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    }) ?? savedRow;
                }
                if (propertyCallbacks?.afterRead) {
                    savedRow = await propertyCallbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        row: savedRow,
                        context: contextForCallback
                    }) ?? savedRow;
                }
            }

            const savedId = savedRow.id as string | number;
            const { id: _savedId, ...savedValues } = savedRow;

            if (globalCallbacks?.afterSave || callbacks?.afterSave || propertyCallbacks?.afterSave) {
                if (globalCallbacks?.afterSave) {
                    await globalCallbacks.afterSave({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path,
                        id: savedId,
                        values: savedValues,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                }
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
                if (propertyCallbacks?.afterSave) {
                    await propertyCallbacks.afterSave({
                        collection: resolvedCollection as CollectionConfig<M>,
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
                    id: savedId.toString(),
                    action: status === "new" ? "create" : "update",
                    values: savedValues as Record<string, unknown>,
                    previousValues: previousValuesForHistory as Record<string, unknown> | undefined,
                    updatedBy: this.user?.uid
                }).catch(err => {
                    logger.error(`Failed to record history for ${path}/${savedId}`, { error: err });
                });
            }

            // Notify real-time subscribers
            await this.realtimeService.notifyUpdate(
                path,
                savedId.toString(),
                savedRow
            );

            return savedRow;
        } catch (error) {
            if (callbacks?.afterSaveError || propertyCallbacks?.afterSaveError) {
                // `error` is the reason the hook exists; it was documented and
                // never passed. Same fix as the Postgres driver.
                const errorProps = {
                    collection: resolvedCollection as CollectionConfig<M>,
                    path,
                    id,
                    values: updatedValues,
                    previousValues: undefined,
                    status,
                    error,
                    context: contextForCallback
                };
                if (callbacks?.afterSaveError) {
                    await callbacks.afterSaveError(errorProps);
                }
                if (propertyCallbacks?.afterSaveError) {
                    await propertyCallbacks.afterSaveError(errorProps);
                }
            }
            throw error;
        }
    }

    /**
     * Delete an row
     */
    async delete<M extends Record<string, any>>({
        row,
        collection
    }: DeleteProps<M>): Promise<void> {
        const { collection: resolvedCollection, callbacks, globalCallbacks, propertyCallbacks } = this.resolveCollectionCallbacks(collection, row.path);

        const callbackRow: Record<string, unknown> = { id: row.id, ...(row.values ?? {}) };

        const contextForCallback = {
            user: this.user,
            driver: this,
            data: this.data,
            client: this.client,
            storageSource: this.client?.storage
        } as unknown as RebaseCallContext;

        // A `before*` callback is the application speaking, not the server
        // failing: a bare `throw` is the documented way to block a write, so it
        // answers 400 with the author's message rather than a masked 500.
        try {
            if (globalCallbacks?.beforeDelete || callbacks?.beforeDelete || propertyCallbacks?.beforeDelete) {
                let preventDefault = false;
                if (globalCallbacks?.beforeDelete) {
                    const result = await globalCallbacks.beforeDelete({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path: row.path,
                        id: row.id,
                        row: callbackRow,
                        context: contextForCallback
                    });
                    if (result === false) {
                        preventDefault = true;
                    }
                }
                if (callbacks?.beforeDelete) {
                    const result = await callbacks.beforeDelete({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path: row.path,
                        id: row.id,
                        row: callbackRow,
                        context: contextForCallback
                    });
                    if (result === false) {
                        preventDefault = true;
                    }
                }
                if (propertyCallbacks?.beforeDelete) {
                    const result = await propertyCallbacks.beforeDelete({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path: row.path,
                        id: row.id,
                        row: callbackRow,
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
            throw toCallbackError(callbackError, "beforeDelete", row.path);
        }

        await this.dataService.delete(row.path, row.id);

        if (globalCallbacks?.afterDelete || callbacks?.afterDelete || propertyCallbacks?.afterDelete) {
            if (globalCallbacks?.afterDelete) {
                await globalCallbacks.afterDelete({
                    collection: resolvedCollection as CollectionConfig<M>,
                    path: row.path,
                    id: row.id,
                    row: callbackRow,
                    context: contextForCallback
                });
            }
            if (callbacks?.afterDelete) {
                await callbacks.afterDelete({
                    collection: resolvedCollection as CollectionConfig<M>,
                    path: row.path,
                    id: row.id,
                    row: callbackRow,
                    context: contextForCallback
                });
            }
            if (propertyCallbacks?.afterDelete) {
                await propertyCallbacks.afterDelete({
                    collection: resolvedCollection as CollectionConfig<M>,
                    path: row.path,
                    id: row.id,
                    row: callbackRow,
                    context: contextForCallback
                });
            }
        }

        // Record history
        if (this.historyService && resolvedCollection?.history) {
            this.historyService.recordHistory({
                action: "delete",
                id: String(row.id),
                tableName: row.path,
                previousValues: row.values,
                updatedBy: this.user?.uid
            }).catch(err => {
                logger.error(`Failed to record history for ${row.path}/${row.id}`, { error: err });
            });
        }

        // Notify subscribers of the deletion
        await this.realtimeService.notifyUpdate(row.path, String(row.id), null);
    }

    /**
     * Check if a field value is unique
     */
    async checkUniqueField(
        path: string,
        name: string,
        value: any,
        id?: string,
        collection?: CollectionConfig
    ): Promise<boolean> {
        return this.dataService.checkUniqueField(path, name, value, id);
    }

    /**
     * Generate a new row ID
     */
    generateId(path: string, collection?: CollectionConfig): string {
        return this.dataService.generateId();
    }

    /**
     * Count rows in a collection
     */
    async count<M extends Record<string, any>>({
        path,
        collection,
        filter,
        logical,
        searchString
    }: FetchCollectionProps<M>): Promise<number> {
        // The same narrowing the listing gets, or the total describes a
        // different query than the rows it is reported beside.
        return this.dataService.count<M>(path, {
            filter,
            logical,
            searchString,
            collection: collection as CollectionConfig
        });
    }

    /**
     * Generate a unique subscription ID
     */
    private generateSubscriptionId(): string {
        return `mongo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Check if the delegate is ready
     */
    isReady(): boolean {
        return this.initialised;
    }

    /**
     * Get the underlying row service for direct access
     */
    getDataService(): MongoDataService {
        return this.dataService;
    }

    /**
     * Get the underlying realtime service for direct access
     */
    getRealtimeService(): MongoRealtimeService {
        return this.realtimeService;
    }

    /**
     * Scope the MongoDriver with an authenticated user context
     */
    async withAuth(user: User): Promise<DataDriver> {
        return new AuthenticatedMongoDriver(this, user);
    }
}

export class AuthenticatedMongoDriver implements DataDriver {
    key = "mongodb";
    initialised = true;
    public user: User;
    public data: RebaseSdkData;

    constructor(public delegate: MongoDriver, user: User) {
        this.user = user;
        this.data = buildSdkData(this);
    }

    currentTime(): Date {
        return this.delegate.currentTime();
    }

    async fetchCollection<M extends Record<string, any>>(props: FetchCollectionProps<M>): Promise<Record<string, unknown>[]> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);
        const rlsFilter = buildMongoFilterFromSecurityRules(resolvedCollection, this.user, "select");
        if (rlsFilter === null) {
            return [];
        }

        // `logical` belongs in this query, not in the props spread below: the
        // repository reads `rawQuery ?? buildQuery(...)`, so a `logical` that
        // travelled only in the spread was never consulted — and a dropped
        // `or(...)` group does not fail, it widens.
        const userQuery = MongoConditionBuilder.buildQuery({
            filter: props.filter,
            logical: props.logical,
            searchString: props.searchString,
            properties: resolvedCollection?.properties
        });

        const combinedQuery = Object.keys(rlsFilter).length > 0
            ? ({ $and: [userQuery, rlsFilter] } as Filter<Document>)
            : userQuery;

        const originalService = this.delegate.getDataService();
        const rows = await originalService.fetchCollection<M>(props.path, {
            ...props,
            rawQuery: combinedQuery,
            collection: resolvedCollection
        });

        const { callbacks, globalCallbacks, propertyCallbacks } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);

        if (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead) {
            const contextForCallback = {
                user: this.user,
                driver: this,
                data: this.data,
                client: this.delegate.client,
                storageSource: this.delegate.client?.storage
            } as unknown as RebaseCallContext;
            return Promise.all(rows.map(async (row) => {
                let fetched = row;
                if (globalCallbacks?.afterRead) {
                    fetched = await globalCallbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path: props.path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                if (callbacks?.afterRead) {
                    fetched = await callbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path: props.path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                if (propertyCallbacks?.afterRead) {
                    fetched = await propertyCallbacks.afterRead({
                        collection: resolvedCollection as CollectionConfig<M>,
                        path: props.path,
                        row: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                return fetched;
            }));
        }

        return rows;
    }

    listenCollection<M extends Record<string, any>>(props: ListenCollectionProps<M>): () => void {
        // Handed to the subscription rather than stamped on it afterwards: the
        // config is what every re-fetch reads, and the stamp also landed after
        // the initial fetch had already been dispatched unfiltered.
        return this.delegate.listenCollection(props, this.authContext());
    }

    /** The acting user, in the shape the realtime subscriptions carry. */
    private authContext(): { uid: string; roles: string[] } {
        return { uid: this.user.uid,
roles: this.user.roles ?? [] };
    }

    /**
     * Evaluate the collection's rules for one row, fail-closed.
     *
     * A path with no resolvable collection has no declared rules — the same
     * answer `buildMongoFilterFromSecurityRules` gives a listing on such a path,
     * so the two never disagree about whether this engine has row security.
     */
    private authorize(
        collection: CollectionConfig | undefined,
        entity: Entity,
        operation: SecurityOperation,
        clauses?: PolicyClauses
    ): boolean {
        if (!collection) return true;
        return checkOperation(collection, { user: this.user }, entity, operation, { onUnknown: "deny",
clauses });
    }

    async fetchOne<M extends Record<string, any>>(props: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);
        assertSecurityRulesEnforceable(resolvedCollection, "select");
        const row = await this.delegate.fetchOne(props);
        if (row && !this.authorize(resolvedCollection, rowToEntityForCheck(row, props.path), "select")) {
            return undefined;
        }
        return row;
    }

    listenOne<M extends Record<string, any>>(props: ListenOneProps<M>): () => void {
        return this.delegate.listenOne(props, this.authContext());
    }

    /**
     * Save, with both halves of the rule checked *before* the write.
     *
     * There is no transaction here, so a check that runs after
     * `delegate.save` cannot undo anything: the document is written, history is
     * recorded and subscribers have been notified by then, and a 403 at that
     * point only misleads the caller about what happened. Postgres evaluates
     * `WITH CHECK` inside the transaction; the closest this driver can get is to
     * evaluate it against the row as it *will* be, and refuse before writing.
     */
    async save<M extends Record<string, any>>(props: SaveProps<M>): Promise<Record<string, unknown>> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);

        if (props.status === "existing" && props.id) {
            assertSecurityRulesEnforceable(resolvedCollection, "update");
            const existing = await this.delegate.fetchOne({ path: props.path,
id: props.id,
collection: resolvedCollection });
            // USING against the stored row, WITH CHECK against the row that
            // will replace it — the split Postgres makes, and the reason
            // `clauses` exists on `checkOperation`.
            const projected = rowToEntityForCheck({ ...existing,
...props.values,
id: props.id }, props.path);
            if (!existing ||
                !this.authorize(resolvedCollection, rowToEntityForCheck(existing, props.path), "update", "using") ||
                !this.authorize(resolvedCollection, projected, "update", "withCheck")) {
                throw ApiError.forbidden("Forbidden");
            }
        } else {
            assertSecurityRulesEnforceable(resolvedCollection, "insert");
            const tempEntity = { id: props.id || "new",
path: props.path,
values: props.values } as Entity;
            if (!this.authorize(resolvedCollection, tempEntity, "insert")) {
                throw ApiError.forbidden("Forbidden");
            }
        }

        return this.delegate.save({
            ...props,
            collection: resolvedCollection
        });
    }

    async delete<M extends Record<string, any>>(props: DeleteProps<M>): Promise<void> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.row.path);
        assertSecurityRulesEnforceable(resolvedCollection, "delete");

        const existing = await this.delegate.fetchOne({ path: props.row.path,
id: props.row.id,
collection: resolvedCollection });
        if (!existing || !this.authorize(resolvedCollection, rowToEntityForCheck(existing, props.row.path), "delete")) {
            throw ApiError.forbidden("Forbidden");
        }

        return this.delegate.delete(props);
    }

    async checkUniqueField(
        path: string,
        name: string,
        value: any,
        id?: string,
        collection?: CollectionConfig
    ): Promise<boolean> {
        return this.delegate.checkUniqueField(path, name, value, id, collection);
    }

    generateId(path: string, collection?: CollectionConfig): string {
        return this.delegate.generateId(path, collection);
    }

    async count<M extends Record<string, any>>(props: FetchCollectionProps<M>): Promise<number> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);
        const rlsFilter = buildMongoFilterFromSecurityRules(resolvedCollection, this.user, "select");
        if (rlsFilter === null) {
            return 0;
        }

        // Narrowed by exactly what the listing is narrowed by — `logical`
        // included — or the total describes a different query than the rows.
        const userQuery = MongoConditionBuilder.buildQuery({
            filter: props.filter,
            logical: props.logical,
            searchString: props.searchString,
            properties: resolvedCollection?.properties
        });

        const combinedQuery = Object.keys(rlsFilter).length > 0
            ? ({ $and: [userQuery, rlsFilter] } as Filter<Document>)
            : userQuery;

        const originalService = this.delegate.getDataService();
        return originalService.count(props.path, {
            ...props,
            rawQuery: combinedQuery
        });
    }

    isReady(): boolean {
        return this.delegate.isReady();
    }
}

/**
 * Wrap a flat row into the Entity shape expected by `checkOperation`,
 * which evaluates security rules against `row.values`.
 */
function rowToEntityForCheck(row: Record<string, unknown>, path: string): Entity {
    return {
        id: row.id as string | number,
        path,
        values: row
    };
}
