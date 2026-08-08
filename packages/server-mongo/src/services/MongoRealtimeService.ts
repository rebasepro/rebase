/**
 * MongoDB Realtime Service
 *
 * Implements RealtimeProvider interface using MongoDB Change Streams.
 * Provides real-time subscriptions to collection and row changes.
 */

import { Db, ChangeStream, ChangeStreamDocument, Document, ObjectId } from "mongodb";
import {
    ANONYMOUS_USER_ID,
    DataDriver,
    FilterValues,
    RealtimeProvider,
    CollectionSubscriptionConfig,
    SingleSubscriptionConfig,
    WebSocketMessage,
    User
} from "@rebasepro/types";
import { WebSocket } from "ws";

import type { MongoDriver } from "./MongoDriver";
import { logger } from "@rebasepro/server";

/** The acting user for a subscription, as the driver and the socket carry it. */
export interface SubscriptionAuthContext {
    uid: string;
    roles: string[];
}

interface Subscription {
    type: "collection" | "single";
    /**
     * Carries `authContext`. There is deliberately no second copy on this
     * object: every fetch reads `config.authContext`, and the one that used to
     * live here was written from three places and read from none — so a
     * subscription that looked authorized was re-fetched as nobody.
     */
    config: (CollectionSubscriptionConfig | SingleSubscriptionConfig) & { authContext?: SubscriptionAuthContext };
    changeStream?: ChangeStream;
    callback?: (data: any) => void;
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
    private driver?: MongoDriver;

    constructor(private db: Db) {}

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
        config: CollectionSubscriptionConfig & { authContext?: SubscriptionAuthContext },
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
                callback
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
                callback
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
        config: CollectionSubscriptionConfig & { authContext?: SubscriptionAuthContext },
        callback?: (rows: Record<string, unknown>[]) => void
    ): Promise<void> {
        try {
            const registryCollection = this.driver?.registry?.getCollectionByPath(config.path);
            // One path, authenticated or not. The `else` branch used to reach
            // past the driver into the repository, which applies no security
            // rules at all — the fallback stubbing out the contract the primary
            // branch honours, and granting more while doing it. An anonymous
            // subscriber is now a user like any other: rules are evaluated
            // against the anonymous uid, and a rule that needs a real one
            // matches nothing.
            const driver = await this.scopedDriver(config.authContext);
            const rows = await driver.fetchCollection({
                path: config.path,
                collection: registryCollection,
                filter: config.filter as FilterValues<string> | undefined,
                orderBy: config.orderBy,
                order: config.order,
                limit: config.limit,
                startAfter: config.startAfter,
                searchString: config.searchString
            });

            if (callback) {
                callback(rows);
            }
        } catch (error) {
            logger.error(`Error fetching collection for subscription ${subscriptionId}`, { error: error });
        }
    }

    /**
     * The driver scoped to a subscriber.
     *
     * Never the bare repository: everything a subscription delivers has to pass
     * the same row authorization an HTTP read does.
     */
    private async scopedDriver(authContext?: SubscriptionAuthContext): Promise<DataDriver> {
        if (!this.driver) {
            throw new Error("MongoRealtimeService has no data driver — subscriptions cannot be authorized");
        }
        const user = { uid: authContext?.uid ?? ANONYMOUS_USER_ID,
roles: authContext?.roles ?? [] } as User;
        return this.driver.withAuth(user);
    }

    /**
     * Subscribe to single row changes
     */
    subscribeToOne(
        subscriptionId: string,
        config: SingleSubscriptionConfig & { authContext?: SubscriptionAuthContext },
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
                callback
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
                callback
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
        config: SingleSubscriptionConfig & { authContext?: SubscriptionAuthContext },
        callback?: (row: Record<string, unknown> | null) => void
    ): Promise<void> {
        try {
            const registryCollection = this.driver?.registry?.getCollectionByPath(config.path);
            const driver = await this.scopedDriver(config.authContext);
            const row = await driver.fetchOne({
                path: config.path,
                id: config.id,
                collection: registryCollection
            });

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
                const config = subscription.config as SingleSubscriptionConfig & { authContext?: SubscriptionAuthContext };
                if (config.path === path && config.id.toString() === id) {
                    if (row === null) {
                        // A deletion carries no row to authorize.
                        subscription.callback?.(null);
                    } else {
                        // Re-fetched through the subscriber's own driver rather
                        // than pushed verbatim: `notifyUpdate` runs after every
                        // save, and handing it the row as written broadcast any
                        // document to whoever happened to be watching its id.
                        await this.fetchAndNotifyOne(subscriptionId, config, subscription.callback);
                    }
                }
            } else if (subscription.type === "collection") {
                const config = subscription.config as CollectionSubscriptionConfig & { authContext?: SubscriptionAuthContext };
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
        }
    }
}
