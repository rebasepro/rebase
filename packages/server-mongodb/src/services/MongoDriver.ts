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
    RebaseData,
    SecurityRule
} from "@rebasepro/types";
import { MongoEntityService } from "../db/MongoEntityService";
import { MongoRealtimeService } from "./MongoRealtimeService";
import { MongoHistoryService } from "./MongoHistoryService";
import { buildPropertyCallbacks, updateDateAutoValues, buildRebaseData, checkOperation } from "@rebasepro/common";
import { mergeDeep } from "@rebasepro/utils";
import { Filter, Document } from "mongodb";
import { ApiError } from "@rebasepro/server-core";
import { MongoConditionBuilder } from "../db/MongoConditionBuilder";

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
    public data: RebaseData;

    constructor(public delegate: MongoDriver, user: User) {
        this.user = user;
        this.data = buildRebaseData(this);
    }

    currentTime(): Date {
        return this.delegate.currentTime();
    }

    async fetchCollection<M extends Record<string, any>>(props: FetchCollectionProps<M>): Promise<Entity<M>[]> {
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

        const originalService = this.delegate.getEntityService();
        const entities = await originalService.fetchCollection<M>(props.path, {
            ...props,
            rawQuery: combinedQuery,
            collection: resolvedCollection
        });

        const { callbacks, propertyCallbacks } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);

        if (callbacks?.afterRead || propertyCallbacks?.afterRead) {
            const contextForCallback = {
                user: this.user,
                driver: this,
                data: this.data,
                client: this.delegate.client,
                storageSource: this.delegate.client?.storage
            } as unknown as RebaseCallContext;
            return Promise.all(entities.map(async (entity) => {
                let fetched = entity;
                if (callbacks?.afterRead) {
                    fetched = await callbacks.afterRead({
                        collection: resolvedCollection as EntityCollection<M>,
                        path: props.path,
                        entity: fetched,
                        context: contextForCallback
                    }) ?? fetched;
                }
                if (propertyCallbacks?.afterRead) {
                    fetched = await propertyCallbacks.afterRead({
                        collection: resolvedCollection as EntityCollection<M>,
                        path: props.path,
                        entity: fetched,
                        context: contextForCallback
                    }) as Entity<M> ?? fetched;
                }
                return fetched;
            }));
        }

        return entities;
    }

    listenCollection<M extends Record<string, any>>(props: ListenCollectionProps<M>): () => void {
        const unsubscribe = this.delegate.listenCollection(props);
        const authContext = { userId: this.user.uid, roles: this.user.roles ?? [] };
        const subscriptions = this.delegate.getRealtimeService().getSubscriptions();
        const lastEntry = Array.from(subscriptions.entries()).pop();
        const lastSub = lastEntry?.[1];
        if (lastSub && lastSub.config.clientId === "driver") {
            lastSub.authContext = authContext;
        }
        return unsubscribe;
    }

    async fetchEntity<M extends Record<string, any>>(props: FetchEntityProps<M>): Promise<Entity<M> | undefined> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);
        const entity = await this.delegate.fetchEntity(props);
        if (entity) {
            const authorized = checkOperation(resolvedCollection as EntityCollection, { user: this.user }, entity as Entity, "select");
            if (!authorized) {
                return undefined;
            }
        }
        return entity;
    }

    listenEntity<M extends Record<string, any>>(props: ListenEntityProps<M>): () => void {
        const unsubscribe = this.delegate.listenEntity(props);
        const authContext = { userId: this.user.uid, roles: this.user.roles ?? [] };
        const subscriptions = this.delegate.getRealtimeService().getSubscriptions();
        const lastEntry = Array.from(subscriptions.entries()).pop();
        const lastSub = lastEntry?.[1];
        if (lastSub && lastSub.config.clientId === "driver") {
            lastSub.authContext = authContext;
        }
        return unsubscribe;
    }

    async saveEntity<M extends Record<string, any>>(props: SaveEntityProps<M>): Promise<Entity<M>> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.path);

        if (props.status === "existing" && props.entityId) {
            const existing = await this.delegate.fetchEntity({ path: props.path, entityId: props.entityId, collection: resolvedCollection });
            if (!existing || !checkOperation(resolvedCollection as EntityCollection, { user: this.user }, existing as Entity, "update")) {
                throw ApiError.forbidden("Forbidden");
            }
        } else {
            const tempEntity = { id: props.entityId || "new", path: props.path, values: props.values } as Entity;
            if (!checkOperation(resolvedCollection as EntityCollection, { user: this.user }, tempEntity, "insert")) {
                throw ApiError.forbidden("Forbidden");
            }
        }

        const saved = await this.delegate.saveEntity({
            ...props,
            collection: resolvedCollection
        });

        // After save / withCheck rules verification
        if (!checkOperation(resolvedCollection as EntityCollection, { user: this.user }, saved as Entity, props.status === "existing" ? "update" : "insert")) {
            throw ApiError.forbidden("Forbidden");
        }

        return saved;
    }

    async deleteEntity<M extends Record<string, any>>(props: DeleteEntityProps<M>): Promise<void> {
        const { collection: resolvedCollection } = this.delegate.resolveCollectionCallbacks(props.collection, props.entity.path);

        const existing = await this.delegate.fetchEntity({ path: props.entity.path, entityId: props.entity.id, collection: resolvedCollection });
        if (!existing || !checkOperation(resolvedCollection as EntityCollection, { user: this.user }, existing as Entity, "delete")) {
            throw ApiError.forbidden("Forbidden");
        }

        return this.delegate.deleteEntity(props);
    }

    async checkUniqueField(
        path: string,
        name: string,
        value: any,
        entityId?: string,
        collection?: EntityCollection
    ): Promise<boolean> {
        return this.delegate.checkUniqueField(path, name, value, entityId, collection);
    }

    generateEntityId(path: string, collection?: EntityCollection): string {
        return this.delegate.generateEntityId(path, collection);
    }

    async countEntities<M extends Record<string, any>>(props: FetchCollectionProps<M>): Promise<number> {
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

        const originalService = this.delegate.getEntityService();
        return originalService.countEntities(props.path, {
            ...props,
            rawQuery: combinedQuery
        });
    }

    isReady(): boolean {
        return this.delegate.isReady();
    }
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
    collection: EntityCollection<M> | undefined,
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
