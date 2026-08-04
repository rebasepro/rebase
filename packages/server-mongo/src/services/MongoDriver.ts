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
    SecurityRule
} from "@rebasepro/types";
import { MongoDataService } from "../db/MongoDataService";
import { MongoRealtimeService } from "./MongoRealtimeService";
import { MongoHistoryService } from "./MongoHistoryService";
import { buildPropertyCallbacks, updateDateAutoValues, buildSdkData, checkOperation } from "@rebasepro/common";
import { mergeDeep } from "@rebasepro/utils";
import { Filter, Document } from "mongodb";
import { ApiError } from "@rebasepro/server";
import { MongoConditionBuilder } from "../db/MongoConditionBuilder";
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
     * Listen to collection changes
     */
    listenCollection<M extends Record<string, any>>({
        path,
        collection,
        filter,
        limit,
        startAfter,
        orderBy,
        searchString,
        order,
        onUpdate,
        onError
    }: ListenCollectionProps<M>): () => void {
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

        this.realtimeService.subscribeToCollection(
            subscriptionId,
            {
                clientId: "driver",
                path,
                filter,
                orderBy,
                order,
                limit,
                startAfter,
                searchString
            },
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
    }: ListenOneProps<M>): () => void {
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
                id
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
                if (propertyCallbacks?.afterSaveError) {
                    await propertyCallbacks.afterSaveError({
                        collection: resolvedCollection as CollectionConfig<M>,
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

        const userQuery = MongoConditionBuilder.buildQuery({
            filter: props.filter,
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
        const unsubscribe = this.delegate.listenCollection(props);
        const authContext = { uid: this.user.uid,
roles: this.user.roles ?? [] };
        const subscriptions = this.delegate.getRealtimeService().getSubscriptions();
        const lastEntry = Array.from(subscriptions.entries()).pop();
        const lastSub = lastEntry?.[1];
        if (lastSub && lastSub.config.clientId === "driver") {
            lastSub.authContext = authContext;
        }
        return unsubscribe;
    }

    async fetchOne<M extends Record<string, any>>(props: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);
        const row = await this.delegate.fetchOne(props);
        if (row) {
            const authorized = checkOperation(resolvedCollection as CollectionConfig, { user: this.user }, rowToEntityForCheck(row, props.path), "select", { onUnknown: "deny" });
            if (!authorized) {
                return undefined;
            }
        }
        return row;
    }

    listenOne<M extends Record<string, any>>(props: ListenOneProps<M>): () => void {
        const unsubscribe = this.delegate.listenOne(props);
        const authContext = { uid: this.user.uid,
roles: this.user.roles ?? [] };
        const subscriptions = this.delegate.getRealtimeService().getSubscriptions();
        const lastEntry = Array.from(subscriptions.entries()).pop();
        const lastSub = lastEntry?.[1];
        if (lastSub && lastSub.config.clientId === "driver") {
            lastSub.authContext = authContext;
        }
        return unsubscribe;
    }

    async save<M extends Record<string, any>>(props: SaveProps<M>): Promise<Record<string, unknown>> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);

        if (props.status === "existing" && props.id) {
            const existing = await this.delegate.fetchOne({ path: props.path,
id: props.id,
collection: resolvedCollection });
            if (!existing || !checkOperation(resolvedCollection as CollectionConfig, { user: this.user }, rowToEntityForCheck(existing, props.path), "update", { onUnknown: "deny" })) {
                throw ApiError.forbidden("Forbidden");
            }
        } else {
            const tempEntity = { id: props.id || "new",
path: props.path,
values: props.values } as Entity;
            if (!checkOperation(resolvedCollection as CollectionConfig, { user: this.user }, tempEntity, "insert", { onUnknown: "deny" })) {
                throw ApiError.forbidden("Forbidden");
            }
        }

        const saved = await this.delegate.save({
            ...props,
            collection: resolvedCollection
        });

        // After save / withCheck rules verification
        if (!checkOperation(resolvedCollection as CollectionConfig, { user: this.user }, rowToEntityForCheck(saved, props.path), props.status === "existing" ? "update" : "insert", { onUnknown: "deny" })) {
            throw ApiError.forbidden("Forbidden");
        }

        return saved;
    }

    async delete<M extends Record<string, any>>(props: DeleteProps<M>): Promise<void> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.row.path);

        const existing = await this.delegate.fetchOne({ path: props.row.path,
id: props.row.id,
collection: resolvedCollection });
        if (!existing || !checkOperation(resolvedCollection as CollectionConfig, { user: this.user }, rowToEntityForCheck(existing, props.row.path), "delete", { onUnknown: "deny" })) {
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

        const userQuery = MongoConditionBuilder.buildQuery({
            filter: props.filter,
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

function getMongoFilterForSQL(sqlString: string, user: User): Filter<Document> | null {
    let cleanedSQL = sqlString.trim();
    while (cleanedSQL.startsWith("(") && cleanedSQL.endsWith(")")) {
        let openCount = 0;
        let isEnclosing = true;
        for (let i = 0; i < cleanedSQL.length - 1; i++) {
            if (cleanedSQL[i] === "(") openCount++;
            else if (cleanedSQL[i] === ")") openCount--;
            if (openCount === 0) {
                isEnclosing = false;
                break;
            }
        }
        if (isEnclosing) {
            cleanedSQL = cleanedSQL.substring(1, cleanedSQL.length - 1).trim();
        } else {
            break;
        }
    }

    const splitByTopLevel = (str: string, delimiter: string) => {
        const parts: string[] = [];
        let current = "";
        let openCount = 0;
        let i = 0;
        while (i < str.length) {
            if (str[i] === "(") openCount++;
            else if (str[i] === ")") openCount--;

            if (openCount === 0 && str.substring(i).toUpperCase().startsWith(delimiter)) {
                parts.push(current);
                current = "";
                i += delimiter.length;
            } else {
                current += str[i];
                i++;
            }
        }
        parts.push(current);
        return parts;
    };

    const orParts = splitByTopLevel(cleanedSQL, " OR ");
    if (orParts.length > 1) {
        const subFilters = orParts.map(part => getMongoFilterForSQL(part, user)).filter(f => f !== null) as Filter<Document>[];
        if (subFilters.length === 0) return null;
        if (subFilters.length === 1) return subFilters[0];
        return { $or: subFilters } as Filter<Document>;
    }

    const andParts = splitByTopLevel(cleanedSQL, " AND ");
    if (andParts.length > 1) {
        const subFilters = andParts.map(part => getMongoFilterForSQL(part, user)).filter(f => f !== null) as Filter<Document>[];
        if (subFilters.length === 0) return null;
        if (subFilters.length === 1) return subFilters[0];
        return { $and: subFilters } as Filter<Document>;
    }

    const roleIntersectMatch = cleanedSQL.match(/string_to_array\s*\(\s*auth\.roles\(\)\s*,\s*','\s*\)\s*&&\s*ARRAY\[(.*?)\]/i);
    if (roleIntersectMatch && roleIntersectMatch[1]) {
        const requiredRoles = roleIntersectMatch[1].split(",").map(r => r.trim().replace(/'/g, ""));
        const userRoles = user.roles || [];
        const matches = requiredRoles.some(r => userRoles.includes(r));
        return matches ? {} : { _id: { $exists: false } };
    }

    const roleContainMatch = cleanedSQL.match(/string_to_array\s*\(\s*auth\.roles\(\)\s*,\s*','\s*\)\s*@>\s*ARRAY\[(.*?)\]/i);
    if (roleContainMatch && roleContainMatch[1]) {
        const requiredRoles = roleContainMatch[1].split(",").map(r => r.trim().replace(/'/g, ""));
        const userRoles = user.roles || [];
        const matches = requiredRoles.every(r => userRoles.includes(r));
        return matches ? {} : { _id: { $exists: false } };
    }

    const pattern1 = new RegExp("^\\{?([a-zA-Z0-9_]+)\\}?\\s*=\\s*(?:current_setting\\s*\\(\\s*'app\\.user_id'\\s*\\)|auth\\.uid\\(\\))");
    const pattern2 = new RegExp("^(?:current_setting\\s*\\(\\s*'app\\.user_id'\\s*\\)|auth\\.uid\\(\\))\\s*=\\s*\\{?([a-zA-Z0-9_]+)\\}?");

    const match1 = cleanedSQL.match(pattern1);
    if (match1 && match1[1]) {
        return { [match1[1]]: user.uid };
    }

    const match2 = cleanedSQL.match(pattern2);
    if (match2 && match2[1]) {
        return { [match2[1]]: user.uid };
    }

    const simpleEqualityMatch = cleanedSQL.match(/^\{?([\w_]+)\}?\s*(=|!=)\s*'([^']+)'$/i);
    if (simpleEqualityMatch) {
        const field = simpleEqualityMatch[1];
        const operator = simpleEqualityMatch[2];
        const value = simpleEqualityMatch[3];
        if (operator === "=") return { [field]: value };
        if (operator === "!=") return { [field]: { $ne: value } };
    }

    return {};
}

function getMongoFilterForRule(rule: SecurityRule, user: User): Filter<Document> | null {
    if (rule.access === "public") return {};

    const filters: Filter<Document>[] = [];

    if (rule.ownerField) {
        filters.push({ [rule.ownerField]: user.uid });
    }

    if (rule.using) {
        const f = getMongoFilterForSQL(rule.using, user);
        if (f) filters.push(f);
    }

    if (rule.withCheck) {
        const f = getMongoFilterForSQL(rule.withCheck, user);
        if (f) filters.push(f);
    }

    if (filters.length === 0) return {};
    if (filters.length === 1) return filters[0];
    return { $and: filters } as Filter<Document>;
}

function buildMongoFilterFromSecurityRules<M extends Record<string, any>>(
    collection: CollectionConfig<M> | undefined,
    user: User,
    targetOperation: "select" | "insert" | "update" | "delete"
): Filter<Document> | null {
    if (!collection || !collection.securityRules || collection.securityRules.length === 0) {
        return {};
    }

    const applicableRules = collection.securityRules.filter((r: SecurityRule) =>
        r.operation === targetOperation ||
        r.operation === "all" ||
        r.operations?.includes(targetOperation) ||
        r.operations?.includes("all")
    );

    if (applicableRules.length === 0) {
        return null;
    }

    const userRoleIds = user.roles ?? [];
    const userRoles = [...userRoleIds, "public"];
    const roleApplicableRules = applicableRules.filter((rule: SecurityRule) => {
        if (!rule.roles || rule.roles.length === 0) return true;
        return rule.roles.some((r: string) => userRoles.includes(r));
    });

    if (roleApplicableRules.length === 0) {
        return null;
    }

    const permissiveFilters: Filter<Document>[] = [];
    const restrictiveFilters: Filter<Document>[] = [];

    for (const rule of roleApplicableRules) {
        const mode = rule.mode || "permissive";
        const filter = getMongoFilterForRule(rule, user);
        if (filter === null) {
            if (mode === "restrictive") {
                return null;
            }
            continue;
        }

        if (mode === "restrictive") {
            restrictiveFilters.push(filter);
        } else {
            permissiveFilters.push(filter);
        }
    }

    const finalAnds: Filter<Document>[] = [];

    if (permissiveFilters.length > 0) {
        const hasAlwaysTruePermissive = permissiveFilters.some(f => Object.keys(f).length === 0);
        if (!hasAlwaysTruePermissive) {
            if (permissiveFilters.length === 1) {
                finalAnds.push(permissiveFilters[0]);
            } else {
                finalAnds.push({ $or: permissiveFilters } as Filter<Document>);
            }
        }
    } else {
        return null;
    }

    if (restrictiveFilters.length > 0) {
        for (const rf of restrictiveFilters) {
            if (Object.keys(rf).length > 0) {
                finalAnds.push(rf);
            }
        }
    }

    if (finalAnds.length === 0) return {};
    if (finalAnds.length === 1) return finalAnds[0];
    return { $and: finalAnds } as Filter<Document>;
}
