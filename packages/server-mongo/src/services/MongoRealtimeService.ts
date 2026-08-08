/**
 * MongoDB Realtime Service
 *
 * Implements RealtimeProvider interface using MongoDB Change Streams.
 * Provides real-time subscriptions to collection and row changes.
 */

import { Db, ChangeStream, ChangeStreamDocument, Document, ObjectId } from "mongodb";
import {
    FilterValues,
    RealtimeProvider,
    CollectionSubscriptionConfig,
    SingleSubscriptionConfig,
    WebSocketMessage,
    User
} from "@rebasepro/types";
import { WebSocket } from "ws";
import { MongoDataService } from "../db/MongoDataService";

import type { MongoDriver } from "./MongoDriver";
import { logger } from "@rebasepro/server";

interface Subscription {
    type: "collection" | "single";
    config: CollectionSubscriptionConfig | SingleSubscriptionConfig;
    changeStream?: ChangeStream;
    callback?: (data: any) => void;
    authContext?: { uid: string; roles: string[] };
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
    private dataService: MongoDataService;
    private driver?: MongoDriver;

    constructor(private db: Db) {
        this.dataService = new MongoDataService(db);
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
        config: CollectionSubscriptionConfig & { authContext?: { uid: string; roles: string[] } },
        callback?: (rows: Record<string, unknown>[]) => void
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
                logger.error(`Change stream error for subscription ${subscriptionId}`, { error: error });
            });

        } catch (error) {
            // Change streams might not be available (e.g., standalone MongoDB)
            logger.warn("Change streams not available, falling back to polling", { error: error });

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
        config: CollectionSubscriptionConfig & { authContext?: { uid: string; roles: string[] } },
        callback?: (rows: Record<string, unknown>[]) => void
    ): Promise<void> {
        try {
            let rows;
            const registryCollection = this.driver?.registry?.getCollectionByPath(config.path);

            if (config.authContext && this.driver) {
                const mockUser = { uid: config.authContext.uid,
roles: config.authContext.roles } as User;
                const authenticatedDriver = await this.driver.withAuth(mockUser);
                rows = await authenticatedDriver.fetchCollection({
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
                rows = await this.dataService.fetchCollection(config.path, {
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
                callback(rows);
            }
        } catch (error) {
            logger.error(`Error fetching collection for subscription ${subscriptionId}`, { error: error });
        }
    }

    /**
     * Subscribe to single row changes
     */
    subscribeToOne(
        subscriptionId: string,
        config: SingleSubscriptionConfig & { authContext?: { uid: string; roles: string[] } },
        callback?: (row: Record<string, unknown> | null) => void
    ): void {
        // Clean up existing subscription if any
        this.unsubscribe(subscriptionId);

        const collectionName = this.getCollectionName(config.path);
        const collection = this.db.collection(collectionName);

        // Build pipeline to watch specific document
        const id = typeof config.id === "string" && ObjectId.isValid(config.id)
            ? new ObjectId(config.id)
            : config.id;

        const pipeline: Document[] = [
            {
                $match: {
                    "documentKey._id": id,
                    operationType: { $in: ["insert", "update", "replace", "delete"] }
                }
            }
        ];

        try {
            const changeStream = collection.watch(pipeline, {
                fullDocument: "updateLookup"
            });

            const subscription: Subscription = {
                type: "single",
                config,
                changeStream,
                callback,
                authContext: config.authContext
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyOne(subscriptionId, config, callback);

            // Listen for changes
            changeStream.on("change", async (change: ChangeStreamDocument) => {
                if (change.operationType === "delete") {
                    if (callback) {
                        callback(null);
                    }
                } else {
                    await this.fetchAndNotifyOne(subscriptionId, config, callback);
                }
            });

            changeStream.on("error", (error: Error) => {
                logger.error(`Change stream error for subscription ${subscriptionId}`, { error: error });
            });

        } catch (error) {
            logger.warn("Change streams not available, falling back to polling", { error: error });

            const subscription: Subscription = {
                type: "single",
                config,
                callback,
                authContext: config.authContext
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyOne(subscriptionId, config, callback);
        }
    }

    /**
     * Fetch row and notify callback
     */
    private async fetchAndNotifyOne(
        subscriptionId: string,
        config: SingleSubscriptionConfig & { authContext?: { uid: string; roles: string[] } },
        callback?: (row: Record<string, unknown> | null) => void
    ): Promise<void> {
        try {
            let row;
            const registryCollection = this.driver?.registry?.getCollectionByPath(config.path);

            if (config.authContext && this.driver) {
                const mockUser = { uid: config.authContext.uid,
roles: config.authContext.roles } as User;
                const authenticatedDriver = await this.driver.withAuth(mockUser);
                row = await authenticatedDriver.fetchOne({
                    path: config.path,
                    id: config.id,
                    collection: registryCollection
                });
            } else {
                row = await this.dataService.fetchOne(config.path, config.id);
            }

            if (callback) {
                callback(row || null);
            }
        } catch (error) {
            logger.error(`Error fetching row for subscription ${subscriptionId}`, { error: error });
        }
    }

    /**
     * Unsubscribe from a subscription
     */
    unsubscribe(subscriptionId: string): void {
        const subscription = this.subscriptions.get(subscriptionId);
        if (subscription) {
            if (subscription.changeStream) {
                subscription.changeStream.close().catch((err) => logger.error("Operation failed", { error: err }));
            }
            this.subscriptions.delete(subscriptionId);
        }
    }

    /**
     * Notify all relevant subscribers of an row update
     * This is called after save/delete operations to push updates
     */
    async notifyUpdate(
        path: string,
        id: string,
        row: Record<string, unknown> | null,
        _databaseId?: string
    ): Promise<void> {
        // Find all subscriptions that might be affected by this update
        for (const [subscriptionId, subscription] of this.subscriptions) {
            if (subscription.type === "single") {
                const config = subscription.config as SingleSubscriptionConfig;
                if (config.path === path && config.id.toString() === id) {
                    if (subscription.callback) {
                        subscription.callback(row);
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
            logger.error("WebSocket error for client", { detail: clientId, error });
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
        _authContext?: { uid: string; roles: unknown[] }
    ): Promise<void> {
        const ws = this.clients.get(clientId);
        if (!ws) return;

        const authContext = _authContext ? { uid: _authContext.uid,
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
                    (rows) => {
                        ws.send(JSON.stringify({
                            type: "collection_update",
                            subscriptionId,
                            rows
                        }));
                    }
                );
                break;
            }
            case "subscribe_one": {
                const subscriptionId = message.payload?.subscriptionId ?? message.subscriptionId;
                if (!subscriptionId) return;

                this.subscribeToOne(
                    subscriptionId,
                    {
                        clientId,
                        path: message.payload?.path,
                        id: message.payload?.id,
                        authContext
                    },
                    (row) => {
                        ws.send(JSON.stringify({
                            type: "single_update",
                            subscriptionId,
                            row
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
            default: {
                // A silent `switch` over a wire protocol is how channel,
                // presence and broadcast frames came to be accepted here and
                // dropped: the client's `broadcast()` resolved, `onPresence`
                // never fired, and a `channel_history` request buffered live
                // messages until the catch-up timeout on every join. Say so,
                // and tell the sender rather than leaving it waiting.
                logger.warn(
                    `⚠️ [MongoRealtime] Unhandled realtime message type "${message.type}" — ` +
                    "channels, presence and broadcast are not implemented by the Mongo driver."
                );
                ws.send(JSON.stringify({
                    type: "ERROR",
                    subscriptionId: message.subscriptionId,
                    payload: {
                        error: {
                            message: `Realtime message type "${message.type}" is not supported by the Mongo driver`,
                            code: "REALTIME_UNSUPPORTED"
                        }
                    },
                    error: `Realtime message type "${message.type}" is not supported by the Mongo driver`
                }));
                break;
            }
        }
    }
}
