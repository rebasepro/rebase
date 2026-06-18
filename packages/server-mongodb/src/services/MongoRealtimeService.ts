/**
 * MongoDB Realtime Service
 *
 * Implements RealtimeProvider interface using MongoDB Change Streams.
 * Provides real-time subscriptions to collection and entity changes.
 */

import { Db, ChangeStream, ChangeStreamDocument, Document, ObjectId } from "mongodb";
import {
    Entity,
    FilterValues,
    RealtimeProvider,
    CollectionSubscriptionConfig,
    EntitySubscriptionConfig,
    WebSocketMessage,
    User
} from "@rebasepro/types";
import { WebSocket } from "ws";
import { MongoEntityService } from "../db/MongoEntityService";

import { MongoDriver } from "./MongoDriver";

interface Subscription {
    type: "collection" | "entity";
    config: CollectionSubscriptionConfig | EntitySubscriptionConfig;
    changeStream?: ChangeStream;
    callback?: (data: any) => void;
    authContext?: { userId: string; roles: string[] };
}

/**
 * MongoDB Realtime Service
 *
 * Implements real-time subscriptions using MongoDB Change Streams.
 * Requires MongoDB replica set for change streams to work.
 */
export class MongoRealtimeService implements RealtimeProvider {
    private subscriptions = new Map<string, Subscription>();
    private clients = new Map<string, WebSocket>();
    private entityService: MongoEntityService;
    private driver?: MongoDriver;

    constructor(private db: Db) {
        this.entityService = new MongoEntityService(db);
    }

    setDataDriver(driver: MongoDriver) {
        this.driver = driver;
    }

    /**
     * Get the collection name from a path
     */
    private getCollectionName(path: string): string {
        return path.replace(/\//g, "_");
    }

    /**
     * Subscribe to collection changes
     */
    subscribeToCollection(
        subscriptionId: string,
        config: CollectionSubscriptionConfig & { authContext?: { userId: string; roles: string[] } },
        callback?: (entities: Entity[]) => void
    ): void {
        // Clean up existing subscription if any
        this.unsubscribe(subscriptionId);

        const collectionName = this.getCollectionName(config.path);
        const collection = this.db.collection(collectionName);

        // Build pipeline for change stream filtering
        const pipeline: Document[] = [];

        // Filter by operation types we care about
        pipeline.push({
            $match: {
                operationType: { $in: ["insert", "update", "replace", "delete"] }
            }
        });

        try {
            // Create change stream
            const changeStream = collection.watch(pipeline, {
                fullDocument: "updateLookup"
            });

            const subscription: Subscription = {
                type: "collection",
                config,
                changeStream,
                callback,
                authContext: config.authContext
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyCollection(subscriptionId, config, callback);

            // Listen for changes
            changeStream.on("change", async (change: ChangeStreamDocument) => {
                // Re-fetch the entire collection when any change happens
                // This is simpler and ensures consistent sorting/filtering
                await this.fetchAndNotifyCollection(subscriptionId, config, callback);
            });

            changeStream.on("error", (error: Error) => {
                console.error(`Change stream error for subscription ${subscriptionId}:`, error);
            });

        } catch (error) {
            // Change streams might not be available (e.g., standalone MongoDB)
            console.warn("Change streams not available, falling back to polling:", error);

            // Store subscription without change stream for manual notifications
            const subscription: Subscription = {
                type: "collection",
                config,
                callback,
                authContext: config.authContext
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyCollection(subscriptionId, config, callback);
        }
    }

    /**
     * Fetch collection and notify callback
     */
    private async fetchAndNotifyCollection(
        subscriptionId: string,
        config: CollectionSubscriptionConfig & { authContext?: { userId: string; roles: string[] } },
        callback?: (entities: Entity[]) => void
    ): Promise<void> {
        try {
            let entities;
            const registryCollection = this.driver?.registry?.getCollectionByPath(config.path);

            if (config.authContext && this.driver) {
                const mockUser = { uid: config.authContext.userId,
roles: config.authContext.roles } as User;
                const authenticatedDriver = await this.driver.withAuth(mockUser);
                entities = await authenticatedDriver.fetchCollection({
                    path: config.path,
                    collection: registryCollection,
                    filter: config.filter as FilterValues<string> | undefined,
                    orderBy: config.orderBy,
                    order: config.order,
                    limit: config.limit,
                    startAfter: config.startAfter,
                    searchString: config.searchString
                });
            } else {
                entities = await this.entityService.fetchCollection(config.path, {
                    filter: config.filter as FilterValues<string> | undefined,
                    orderBy: config.orderBy,
                    order: config.order,
                    limit: config.limit,
                    startAfter: config.startAfter,
                    searchString: config.searchString,
                    collection: registryCollection
                });
            }

            if (callback) {
                callback(entities);
            }
        } catch (error) {
            console.error(`Error fetching collection for subscription ${subscriptionId}:`, error);
        }
    }

    /**
     * Subscribe to single entity changes
     */
    subscribeToEntity(
        subscriptionId: string,
        config: EntitySubscriptionConfig & { authContext?: { userId: string; roles: string[] } },
        callback?: (entity: Entity | null) => void
    ): void {
        // Clean up existing subscription if any
        this.unsubscribe(subscriptionId);

        const collectionName = this.getCollectionName(config.path);
        const collection = this.db.collection(collectionName);

        // Build pipeline to watch specific document
        const entityId = typeof config.entityId === "string" && ObjectId.isValid(config.entityId)
            ? new ObjectId(config.entityId)
            : config.entityId;

        const pipeline: Document[] = [
            {
                $match: {
                    "documentKey._id": entityId,
                    operationType: { $in: ["insert", "update", "replace", "delete"] }
                }
            }
        ];

        try {
            const changeStream = collection.watch(pipeline, {
                fullDocument: "updateLookup"
            });

            const subscription: Subscription = {
                type: "entity",
                config,
                changeStream,
                callback,
                authContext: config.authContext
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyEntity(subscriptionId, config, callback);

            // Listen for changes
            changeStream.on("change", async (change: ChangeStreamDocument) => {
                if (change.operationType === "delete") {
                    if (callback) {
                        callback(null);
                    }
                } else {
                    await this.fetchAndNotifyEntity(subscriptionId, config, callback);
                }
            });

            changeStream.on("error", (error: Error) => {
                console.error(`Change stream error for subscription ${subscriptionId}:`, error);
            });

        } catch (error) {
            console.warn("Change streams not available, falling back to polling:", error);

            const subscription: Subscription = {
                type: "entity",
                config,
                callback,
                authContext: config.authContext
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyEntity(subscriptionId, config, callback);
        }
    }

    /**
     * Fetch entity and notify callback
     */
    private async fetchAndNotifyEntity(
        subscriptionId: string,
        config: EntitySubscriptionConfig & { authContext?: { userId: string; roles: string[] } },
        callback?: (entity: Entity | null) => void
    ): Promise<void> {
        try {
            let entity;
            const registryCollection = this.driver?.registry?.getCollectionByPath(config.path);

            if (config.authContext && this.driver) {
                const mockUser = { uid: config.authContext.userId,
roles: config.authContext.roles } as User;
                const authenticatedDriver = await this.driver.withAuth(mockUser);
                entity = await authenticatedDriver.fetchEntity({
                    path: config.path,
                    entityId: config.entityId,
                    collection: registryCollection
                });
            } else {
                entity = await this.entityService.fetchEntity(config.path, config.entityId);
            }

            if (callback) {
                callback(entity || null);
            }
        } catch (error) {
            console.error(`Error fetching entity for subscription ${subscriptionId}:`, error);
        }
    }

    /**
     * Unsubscribe from a subscription
     */
    unsubscribe(subscriptionId: string): void {
        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription) {
            if (subscription.changeStream) {
                subscription.changeStream.close().catch(console.error);
            }
            this.subscriptions.delete(subscriptionId);
        }
    }

    /**
     * Notify all relevant subscribers of an entity update
     * This is called after save/delete operations to push updates
     */
    async notifyEntityUpdate(
        path: string,
        entityId: string,
        entity: Entity | null,
        _databaseId?: string
    ): Promise<void> {
        // Find all subscriptions that might be affected by this update
        for (const [subscriptionId, subscription] of this.subscriptions) {
            if (subscription.type === "entity") {
                const config = subscription.config as EntitySubscriptionConfig;
                if (config.path === path && config.entityId.toString() === entityId) {
                    if (subscription.callback) {
                        subscription.callback(entity);
                    }
                }
            } else if (subscription.type === "collection") {
                const config = subscription.config as CollectionSubscriptionConfig;
                if (config.path === path) {
                    // Re-fetch the collection to get updated data
                    await this.fetchAndNotifyCollection(subscriptionId, config, subscription.callback);
                }
            }
        }
    }

    /**
     * Get all active subscriptions (for debugging)
     */
    getSubscriptions(): Map<string, Subscription> {
        return this.subscriptions;
    }

    /**
     * Close all subscriptions
     */
    async closeAll(): Promise<void> {
        for (const [subscriptionId] of this.subscriptions) {
            this.unsubscribe(subscriptionId);
        }
    }

    // =============================================================================
    // WebSocket Client Management (parity with PostgreSQL RealtimeService)
    // =============================================================================

    /**
     * Register a WebSocket client for real-time communication
     */
    addClient(clientId: string, ws: WebSocket) {
        this.clients.set(clientId, ws);

        ws.on("close", () => {
            this.removeClient(clientId);
        });

        ws.on("error", (error) => {
            console.error("WebSocket error for client", clientId, error);
            this.removeClient(clientId);
        });
    }

    /**
     * Remove a WebSocket client and clean up its subscriptions
     */
    private removeClient(clientId: string) {
        this.clients.delete(clientId);
    }

    /**
     * Handle an incoming WebSocket message for subscription management
     */
    async handleClientMessage(
        clientId: string,
        message: { type: string; payload?: any; subscriptionId?: string },
        _authContext?: { userId: string; roles: unknown[] }
    ): Promise<void> {
        const ws = this.clients.get(clientId);
        if (!ws) return;

        const authContext = _authContext ? { userId: _authContext.userId,
roles: (_authContext.roles ?? []).map(String) } : undefined;

        switch (message.type) {
            case "subscribe_collection": {
                const subscriptionId = message.payload?.subscriptionId ?? message.subscriptionId;
                if (!subscriptionId) return;

                this.subscribeToCollection(
                    subscriptionId,
                    {
                        clientId,
                        path: message.payload?.path,
                        filter: message.payload?.filter,
                        orderBy: message.payload?.orderBy,
                        order: message.payload?.order,
                        limit: message.payload?.limit,
                        startAfter: message.payload?.startAfter,
                        searchString: message.payload?.searchString,
                        authContext
                    },
                    (entities) => {
                        ws.send(JSON.stringify({
                            type: "collection_update",
                            subscriptionId,
                            entities
                        }));
                    }
                );
                break;
            }
            case "subscribe_entity": {
                const subscriptionId = message.payload?.subscriptionId ?? message.subscriptionId;
                if (!subscriptionId) return;

                this.subscribeToEntity(
                    subscriptionId,
                    {
                        clientId,
                        path: message.payload?.path,
                        entityId: message.payload?.entityId,
                        authContext
                    },
                    (entity) => {
                        ws.send(JSON.stringify({
                            type: "entity_update",
                            subscriptionId,
                            entity
                        }));
                    }
                );
                break;
            }
            case "unsubscribe": {
                const subscriptionId = message.payload?.subscriptionId ?? message.subscriptionId;
                if (subscriptionId) {
                    this.unsubscribe(subscriptionId);
                }
                break;
            }
        }
    }
}
