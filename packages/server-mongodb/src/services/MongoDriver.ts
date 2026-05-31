/**
 * MongoDB DataDriver Delegate
 *
 * Implements the DataDriver interface for Rebase frontend integration.
 * This is the main entry point for Rebase to interact with MongoDB.
 */

import { Db } from "mongodb";
import {
    DataDriver,
    DeleteEntityProps,
    Entity,
    EntityCollection,
    FetchCollectionProps,
    FetchEntityProps,
    ListenCollectionProps,
    ListenEntityProps,
    SaveEntityProps,
    RebaseCallContext,
    CollectionRegistryInterface,
    User,
    RebaseClient,
    RebaseData
} from "@rebasepro/types";
import { MongoEntityService } from "../db/MongoEntityService";
import { MongoRealtimeService } from "./MongoRealtimeService";
import { MongoHistoryService } from "./MongoHistoryService";
import { buildPropertyCallbacks, updateDateAutoValues, buildRebaseData } from "@rebasepro/common";
import { mergeDeep } from "@rebasepro/utils";

/**
 * MongoDB DataDriver Delegate
 *
 * Implements the DataDriver interface for Rebase.
 * Provides all data operations needed by the Rebase frontend.
 */
export class MongoDriver implements DataDriver {
    key = "mongodb";
    initialised = true;

    private entityService: MongoEntityService;
    private realtimeService: MongoRealtimeService;
    public historyService: MongoHistoryService;
    public user?: User;
    public data: RebaseData;
    public client?: RebaseClient;

    constructor(
        private db: Db,
        realtimeService?: MongoRealtimeService,
        historyService?: MongoHistoryService,
        public readonly registry?: CollectionRegistryInterface,
        user?: User
    ) {
        this.entityService = new MongoEntityService(db);
        this.realtimeService = realtimeService ?? new MongoRealtimeService(db);
        this.historyService = historyService ?? new MongoHistoryService(db);
        this.user = user;
        this.data = buildRebaseData(this);
    }

    /**
     * Get the current timestamp
     */
    currentTime(): Date {
        return new Date();
    }

    private resolveCollectionCallbacks<M extends Record<string, unknown>>(
        collection: EntityCollection<M> | undefined,
        path: string
    ) {
        if (!collection && !path) return { collection: undefined, callbacks: undefined, propertyCallbacks: undefined };
        const registryCollection = this.registry?.getCollectionByPath(path);
        const resolvedCollection = registryCollection
            ? ({ ...collection, ...registryCollection } as EntityCollection<M>)
            : (collection as EntityCollection<M>);

        const callbacks = resolvedCollection?.callbacks;
        const properties = resolvedCollection?.properties;
        let propertyCallbacks;
        if (properties) {
            propertyCallbacks = buildPropertyCallbacks(properties);
        }
        return {
            collection: resolvedCollection,
            callbacks,
            propertyCallbacks
        };
    }

    /**
     * Fetch a collection of entities
     */
    async fetchCollection<M extends Record<string, any>>({
        path,
        collection,
        filter,
        limit,
        startAfter,
        orderBy,
        searchString,
        order
    }: FetchCollectionProps<M>): Promise<Entity<M>[]> {
        const entities = await this.entityService.fetchCollection<M>(path, {
            filter,
            limit,
            startAfter,
            orderBy,
            order,
            searchString,
            collection: collection as EntityCollection
        });

        const { collection: resolvedCollection, callbacks, propertyCallbacks } = this.resolveCollectionCallbacks(collection, path);

        if (callbacks?.afterRead || propertyCallbacks?.afterRead) {
            const contextForCallback = {
                user: this.user,
                driver: this,
                data: this.data,
                client: this.client,
                storageSource: this.client?.storage
            } as unknown as RebaseCallContext; // Backend context
            return Promise.all(entities.map(async (entity) => {
                let fetched = entity;
                if (callbacks?.afterRead) {
                    fetched = await callbacks.afterRead({
                        collection: resolvedCollection as EntityCollection<M>,
                        path,
                        entity: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                if (propertyCallbacks?.afterRead) {
                    fetched = await propertyCallbacks.afterRead({
                        collection: resolvedCollection as EntityCollection<M>,
                        path,
                        entity: fetched,
                        context: contextForCallback
                    }) as Entity<M> ?? fetched;
                }
                return fetched;
            }));
        }

        return entities;
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

        const callback = (entities: Entity<any>[]) => {
            try {
                onUpdate(entities as Entity<M>[]);
            } catch (error) {
                console.error("Error in collection update callback:", error);
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
     * Fetch a single entity
     */
    async fetchEntity<M extends Record<string, any>>({
        path,
        entityId,
        databaseId,
        collection
    }: FetchEntityProps<M>): Promise<Entity<M> | undefined> {
        let entity = await this.entityService.fetchEntity<M>(path, entityId, databaseId);

        const { collection: resolvedCollection, callbacks, propertyCallbacks } = this.resolveCollectionCallbacks(collection, path);

        if (entity && (callbacks?.afterRead || propertyCallbacks?.afterRead)) {
            const contextForCallback = {
                user: this.user,
                driver: this,
                data: this.data,
                client: this.client,
                storageSource: this.client?.storage
            } as unknown as RebaseCallContext; // Backend context
            if (callbacks?.afterRead) {
                entity = await callbacks.afterRead({
                    collection: resolvedCollection as EntityCollection<M>,
                    path,
                    entity,
                    context: contextForCallback
                }) ?? entity;
            }
            if (propertyCallbacks?.afterRead) {
                entity = await propertyCallbacks.afterRead({
                    collection: resolvedCollection as EntityCollection<M>,
                    path,
                    entity,
                    context: contextForCallback
                }) as Entity<M> ?? entity;
            }
        }

        return entity;
    }

    /**
     * Listen to entity changes
     */
    listenEntity<M extends Record<string, any>>({
        path,
        entityId,
        collection,
        onUpdate,
        onError
    }: ListenEntityProps<M>): () => void {
        const subscriptionId = this.generateSubscriptionId();

        const callback = (entity: Entity<any> | null) => {
            try {
                onUpdate(entity as Entity<M>);
            } catch (error) {
                console.error("Error in entity update callback:", error);
                if (onError) {
                    onError(error instanceof Error ? error : new Error(String(error)));
                }
            }
        };

        this.realtimeService.subscribeToEntity(
            subscriptionId,
            {
                clientId: "driver",
                path,
                entityId
            },
            callback
        );

        // Return unsubscribe function
        return () => {
            this.realtimeService.unsubscribe(subscriptionId);
        };
    }

    /**
     * Save an entity (create or update)
     */
    async saveEntity<M extends Record<string, any>>({
        path,
        entityId,
        values,
        collection,
        status
    }: SaveEntityProps<M>): Promise<Entity<M>> {
        const { collection: resolvedCollection, callbacks, propertyCallbacks } = this.resolveCollectionCallbacks(collection, path);

        let updatedValues = values;
        const contextForCallback = {
            user: this.user,
            driver: this,
            data: this.data,
            client: this.client,
            storageSource: this.client?.storage
        } as unknown as RebaseCallContext;

        // Fetch previous values for callbacks AND history recording
        let previousValuesForHistory: Partial<Entity<M>["values"]> | undefined;
        if (status === "existing" && entityId) {
            const existing = await this.entityService.fetchEntity<M>(path, entityId, resolvedCollection?.databaseId);
            if (existing) {
                previousValuesForHistory = existing.values as Partial<Entity<M>["values"]>;
            }
        }

        if (callbacks?.beforeSave || propertyCallbacks?.beforeSave) {
            if (callbacks?.beforeSave) {
                const result = await callbacks.beforeSave({
                    collection: resolvedCollection as EntityCollection<M>,
                    path,
                    entityId,
                    values: updatedValues,
                    previousValues: previousValuesForHistory,
                    status,
                    context: contextForCallback
                });
                if (result) updatedValues = mergeDeep(updatedValues, result);
            }

            if (propertyCallbacks?.beforeSave) {
                const result = await propertyCallbacks.beforeSave({
                    collection: resolvedCollection as EntityCollection<M>,
                    path,
                    entityId,
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
            let savedEntity = await this.entityService.saveEntity<M>(
                path,
                updatedValues,
                entityId,
                resolvedCollection?.databaseId
            );

            if (savedEntity && (callbacks?.afterRead || propertyCallbacks?.afterRead)) {
                if (callbacks?.afterRead) {
                    savedEntity = await callbacks.afterRead({
                        collection: resolvedCollection as EntityCollection<M>,
                        path,
                        entity: savedEntity,
                        context: contextForCallback
                    }) ?? savedEntity;
                }
                if (propertyCallbacks?.afterRead) {
                    savedEntity = await propertyCallbacks.afterRead({
                        collection: resolvedCollection as EntityCollection<M>,
                        path,
                        entity: savedEntity,
                        context: contextForCallback
                    }) as Entity<M> ?? savedEntity;
                }
            }

            if (callbacks?.afterSave || propertyCallbacks?.afterSave) {
                if (callbacks?.afterSave) {
                    await callbacks.afterSave({
                        collection: resolvedCollection as EntityCollection<M>,
                        path,
                        entityId: savedEntity.id,
                        values: savedEntity.values,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                }
                if (propertyCallbacks?.afterSave) {
                    await propertyCallbacks.afterSave({
                        collection: resolvedCollection as EntityCollection<M>,
                        path,
                        entityId: savedEntity.id,
                        values: savedEntity.values,
                        previousValues: previousValuesForHistory,
                        status,
                        context: contextForCallback
                    });
                }
            }

            // Record entity history (fire-and-forget, never blocks the save)
            if (this.historyService && resolvedCollection?.history) {
                this.historyService.recordHistory({
                    tableName: path,
                    entityId: savedEntity.id.toString(),
                    action: status === "new" ? "create" : "update",
                    values: savedEntity.values as Record<string, unknown>,
                    previousValues: previousValuesForHistory as Record<string, unknown> | undefined,
                    updatedBy: this.user?.uid
                }).catch(err => {
                    console.error(`Failed to record history for ${path}/${savedEntity.id}:`, err);
                });
            }

            // Notify real-time subscribers
            await this.realtimeService.notifyEntityUpdate(
                path,
                savedEntity.id.toString(),
                savedEntity
            );

            return savedEntity;
        } catch (error) {
            if (callbacks?.afterSaveError || propertyCallbacks?.afterSaveError) {
                if (callbacks?.afterSaveError) {
                    await callbacks.afterSaveError({
                        collection: resolvedCollection as EntityCollection<M>,
                        path,
                        entityId: entityId || "unknown",
                        values: updatedValues,
                        previousValues: undefined,
                        status,
                        context: contextForCallback
                    });
                }
                if (propertyCallbacks?.afterSaveError) {
                    await propertyCallbacks.afterSaveError({
                        collection: resolvedCollection as EntityCollection<M>,
                        path,
                        entityId: entityId || "unknown",
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
     * Delete an entity
     */
    async deleteEntity<M extends Record<string, any>>({
        entity,
        collection
    }: DeleteEntityProps<M>): Promise<void> {
        const { collection: resolvedCollection, callbacks, propertyCallbacks } = this.resolveCollectionCallbacks(collection, entity.path);

        const contextForCallback = {
            user: this.user,
            driver: this,
            data: this.data,
            client: this.client,
            storageSource: this.client?.storage
        } as unknown as RebaseCallContext;

        if (callbacks?.beforeDelete || propertyCallbacks?.beforeDelete) {
            let preventDefault = false;
            if (callbacks?.beforeDelete) {
                const result = await callbacks.beforeDelete({
                    collection: resolvedCollection as EntityCollection<M>,
                    path: entity.path,
                    entityId: entity.id,
                    entity,
                    context: contextForCallback
                });
                if (result === false) {
                    preventDefault = true;
                }
            }
            if (propertyCallbacks?.beforeDelete) {
                const result = await propertyCallbacks.beforeDelete({
                    collection: resolvedCollection as EntityCollection<M>,
                    path: entity.path,
                    entityId: entity.id,
                    entity,
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

        await this.entityService.deleteEntity(entity.path, entity.id);

        if (callbacks?.afterDelete || propertyCallbacks?.afterDelete) {
            if (callbacks?.afterDelete) {
                await callbacks.afterDelete({
                    collection: resolvedCollection as EntityCollection<M>,
                    path: entity.path,
                    entityId: entity.id,
                    entity,
                    context: contextForCallback
                });
            }
            if (propertyCallbacks?.afterDelete) {
                await propertyCallbacks.afterDelete({
                    collection: resolvedCollection as EntityCollection<M>,
                    path: entity.path,
                    entityId: entity.id,
                    entity,
                    context: contextForCallback
                });
            }
        }

        // Record history
        if (this.historyService && resolvedCollection?.history) {
            this.historyService.recordHistory({
                action: "delete",
                entityId: String(entity.id),
                tableName: entity.path,
                previousValues: entity.values,
                updatedBy: this.user?.uid
            }).catch(err => {
                console.error(`Failed to record history for ${entity.path}/${entity.id}:`, err);
            });
        }

        // Notify subscribers of the deletion
        await this.realtimeService.notifyEntityUpdate(entity.path, String(entity.id), null);
    }

    /**
     * Check if a field value is unique
     */
    async checkUniqueField(
        path: string,
        name: string,
        value: any,
        entityId?: string,
        collection?: EntityCollection
    ): Promise<boolean> {
        return this.entityService.checkUniqueField(path, name, value, entityId);
    }

    /**
     * Generate a new entity ID
     */
    generateEntityId(path: string, collection?: EntityCollection): string {
        return this.entityService.generateEntityId();
    }

    /**
     * Count entities in a collection
     */
    async countEntities<M extends Record<string, any>>({
        path,
        collection,
        filter
    }: FetchCollectionProps<M>): Promise<number> {
        return this.entityService.countEntities<M>(path, { filter });
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
     * Get the underlying entity service for direct access
     */
    getEntityService(): MongoEntityService {
        return this.entityService;
    }

    /**
     * Get the underlying realtime service for direct access
     */
    getRealtimeService(): MongoRealtimeService {
        return this.realtimeService;
    }
}
