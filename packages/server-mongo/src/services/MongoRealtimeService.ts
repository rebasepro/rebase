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
    User,
    ListLimitError,
    resolveClientListLimit
} from "@rebasepro/types";
import { WebSocket } from "ws";

import type { MongoDriver } from "./MongoDriver";
import { logger } from "@rebasepro/server";

/** The acting user for a subscription, as the driver and the socket carry it. */
export interface SubscriptionAuthContext {
    uid: string;
    roles: string[];
}

/**
 * The query half of a subscription config — everything except who is watching.
 *
 * Spread into the re-fetch rather than re-listed field by field. Re-listing is
 * how `logical` and `offset` went missing twice on this path: the type declares
 * them, every boundary accepted them, and each hand-written list quietly named
 * a subset. A function that removes the two non-query fields cannot fall behind
 * the type the way a list of the other nine can.
 */
const queryOf = <T extends { clientId: string; authContext?: SubscriptionAuthContext }>(
    config: T
): Omit<T, "clientId" | "authContext"> => {
    const { clientId: _clientId, authContext: _authContext, ...query } = config;
    return query;
};

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
    /**
     * How many deliveries have been started for this subscription, and the
     * highest that has already reached the callback.
     *
     * Every delivery here is a re-fetch, and three independent things start one
     * for the same subscription: the initial fetch, the change stream, and
     * `notifyUpdate` after a save. They overlap, and a fetch that started
     * earlier can finish later — at which point the callback replaces the
     * client's whole list with the state before the change. Nothing corrects it
     * until something else happens to that collection.
     *
     * A counter taken before the await and checked after it is what makes the
     * last *started* delivery the last *delivered* one.
     */
    started: number;
    delivered: number;
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
     * Claim a delivery slot for a subscription, before doing the work.
     *
     * Returns the check to run immediately before calling the callback. It
     * refuses in three cases, all of which used to deliver:
     *
     * - **Out of order.** A newer fetch has already delivered, so this one is
     *   stale — the client would go back to the state before the change.
     * - **Unsubscribed.** The subscription was cancelled while the fetch was in
     *   flight, and its callback belongs to a client that stopped listening.
     * - **Re-subscribed.** `subscribeToCollection` unsubscribes first, so the
     *   same id can name a *different* subscription by the time a fetch lands —
     *   with a different filter, and a different caller's rows.
     *
     * Synchronous deliveries claim a slot too. A `delete` notification with no
     * fetch behind it is the newest thing known about the row, so it must also
     * be the thing that closes the door on an older fetch still in flight —
     * otherwise the deleted row reappears a moment after it vanished.
     */
    private beginDelivery(subscriptionId: string, subscription: Subscription): () => boolean {
        const seq = ++subscription.started;
        return () => {
            if (this.subscriptions.get(subscriptionId) !== subscription) return false;
            if (seq <= subscription.delivered) return false;
            subscription.delivered = seq;
            return true;
        };
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
                callback,
                started: 0,
                delivered: 0
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyCollection(subscriptionId, subscription);

            // Listen for changes
            changeStream.on("change", async (change: ChangeStreamDocument) => {
                // Re-fetch the entire collection when any change happens
                // This is simpler and ensures consistent sorting/filtering
                await this.fetchAndNotifyCollection(subscriptionId, subscription);
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
                started: 0,
                delivered: 0
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyCollection(subscriptionId, subscription);
        }
    }

    /**
     * Fetch collection and notify callback
     */
    private async fetchAndNotifyCollection(
        subscriptionId: string,
        subscription: Subscription
    ): Promise<void> {
        const config = subscription.config as CollectionSubscriptionConfig & { authContext?: SubscriptionAuthContext };
        const callback = subscription.callback;
        const canDeliver = this.beginDelivery(subscriptionId, subscription);
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
            // The stored config forwarded whole. Re-listing its fields here is
            // how `logical` and `offset` went missing a second time, one layer
            // below where they went missing the first time: the subscription
            // carried them and the re-fetch did not ask for them.
            const rows = await driver.fetchCollection({
                ...queryOf(config),
                filter: config.filter as FilterValues<string> | undefined,
                collection: registryCollection
            });

            if (callback && canDeliver()) {
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
                callback,
                started: 0,
                delivered: 0
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyOne(subscriptionId, subscription);

            // Listen for changes
            changeStream.on("change", async (change: ChangeStreamDocument) => {
                if (change.operationType === "delete") {
                    // Claims a slot like any other delivery: the deletion is the
                    // newest fact about this row, so an older fetch still in
                    // flight must not put it back.
                    const canDeliver = this.beginDelivery(subscriptionId, subscription);
                    if (callback && canDeliver()) {
                        callback(null);
                    }
                } else {
                    await this.fetchAndNotifyOne(subscriptionId, subscription);
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
                started: 0,
                delivered: 0
            };

            this.subscriptions.set(subscriptionId, subscription);

            // Fetch initial data
            this.fetchAndNotifyOne(subscriptionId, subscription);
        }
    }

    /**
     * Fetch row and notify callback
     */
    private async fetchAndNotifyOne(
        subscriptionId: string,
        subscription: Subscription
    ): Promise<void> {
        const config = subscription.config as SingleSubscriptionConfig & { authContext?: SubscriptionAuthContext };
        const callback = subscription.callback;
        const canDeliver = this.beginDelivery(subscriptionId, subscription);
        try {
            const registryCollection = this.driver?.registry?.getCollectionByPath(config.path);
            const driver = await this.scopedDriver(config.authContext);
            const row = await driver.fetchOne({
                path: config.path,
                id: config.id,
                collection: registryCollection
            });

            if (callback && canDeliver()) {
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
                        // A deletion carries no row to authorize — but it still
                        // claims a delivery slot, so a re-fetch already in
                        // flight cannot land after it and resurrect the row.
                        const canDeliver = this.beginDelivery(subscriptionId, subscription);
                        if (canDeliver()) subscription.callback?.(null);
                    } else {
                        // Re-fetched through the subscriber's own driver rather
                        // than pushed verbatim: `notifyUpdate` runs after every
                        // save, and handing it the row as written broadcast any
                        // document to whoever happened to be watching its id.
                        await this.fetchAndNotifyOne(subscriptionId, subscription);
                    }
                }
            } else if (subscription.type === "collection") {
                const config = subscription.config as CollectionSubscriptionConfig & { authContext?: SubscriptionAuthContext };
                if (config.path === path) {
                    // Re-fetch the collection to get updated data
                    await this.fetchAndNotifyCollection(subscriptionId, subscription);
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

                // The same list bound the Postgres socket and every REST route
                // apply. This ingress applied none: an absent limit reached the
                // driver as `undefined` and emitted no `.limit()` at all, so one
                // subscribe frame streamed the whole collection — and re-streamed
                // it on every matching write. An over-large limit is refused
                // rather than shrunk, because a `collection_update` frame carries
                // no `total` or `hasMore` for the client to notice with.
                let boundedLimit: number;
                try {
                    boundedLimit = resolveClientListLimit(message.payload?.limit);
                } catch (e) {
                    if (!(e instanceof ListLimitError)) throw e;
                    logger.warn(`⚠️ [MongoRealtime] Refused subscription to '${message.payload?.path}': ${e.message}`);
                    ws.send(JSON.stringify({
                        type: "ERROR",
                        subscriptionId,
                        payload: { error: { message: e.message, code: "INVALID_LIMIT" } },
                        error: e.message
                    }));
                    return;
                }

                this.subscribeToCollection(
                    subscriptionId,
                    {
                        clientId,
                        path: message.payload?.path,
                        filter: message.payload?.filter,
                        // `logical` and `offset` were absent from this list, so
                        // an `or(...)` subscription was pushed every row the
                        // caller's policies allowed and a subscription to page
                        // two was pushed page one. The client has been sending
                        // both since it stopped stringifying `offset` into
                        // `startAfter`; nothing here read them.
                        logical: message.payload?.logical,
                        offset: message.payload?.offset,
                        orderBy: message.payload?.orderBy,
                        order: message.payload?.order,
                        limit: boundedLimit,
                        startAfter: message.payload?.startAfter,
                        searchString: message.payload?.searchString,
                        searchExplain: message.payload?.searchExplain,
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
