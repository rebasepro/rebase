import {
    DeleteProps,
    CollectionConfig,
    FetchCollectionProps,
    FetchOneProps,
    SaveProps,
    WebSocketMessage,
    WebSocketErrorPayload,
    CollectionUpdateMessage,
    SingleUpdateMessage,
    TableMetadata,
    BranchInfo,
    RebaseApiError
} from "@rebasepro/types";
import { buildCompositeId, COMPOSITE_ID_SEPARATOR, type PrimaryKeyInfo } from "@rebasepro/common";
import { rebaseReviver } from "./reviver";



/**
 * Extract error message and code from a WebSocket message payload.
 * Handles both `{ error: string }` and `{ error: { message, code } }` shapes.
 */
function extractMessageError(message: WebSocketMessage): { errorMessage: string; errorCode?: string } {
    const payload = message.payload as WebSocketErrorPayload | undefined;
    const errPayload = payload?.error;
    const errorMessage = typeof errPayload === "object"
        ? errPayload.message
        : payload?.message || (typeof errPayload === "string" ? errPayload : undefined) || message.error || "Unknown error";
    const errorCode = typeof errPayload === "object"
        ? errPayload.code
        : payload?.code;
    // Callers treat this as a string (`.toLowerCase()` in isAuthError). A frame
    // carrying a non-string here would throw inside the message handler, where
    // the surrounding try/catch would swallow it — and a subscription error that
    // never reaches its listener is a view stuck loading forever.
    const safeMessage = typeof errorMessage === "string"
        ? errorMessage
        : (errorMessage == null ? "Unknown error" : JSON.stringify(errorMessage));
    return { errorMessage: safeMessage,
errorCode };
}

export interface RebaseWebSocketConfig {
    websocketUrl: string;
    /** Optional auth token getter for WebSocket authentication */
    getAuthToken?: () => Promise<string | null>;
    /** Optional WebSocket constructor to override globalThis.WebSocket (e.g. for Node environments) */
    WebSocket?: typeof WebSocket;
    /** Callback to handle unauthorized requests or token expiration (refreshes auth session) */
    onUnauthorized?: () => Promise<boolean>;
}


/**
 * Broadcast and presence frames.
 *
 * Fire-and-forget (the server sends no response envelope), and exempt from the
 * client-side auth gate — a public channel is usable without an account.
 */
const CHANNEL_MESSAGE_TYPES = new Set([
    "join_channel",
    "leave_channel",
    "broadcast",
    "presence_track",
    "presence_untrack",
    "presence_state",
    // The catch-up request. Like `presence_state`, its answer comes back as a
    // channel-addressed frame rather than a response envelope, so it must not
    // be given a pending request to wait on.
    "channel_history"
]);

/**
 * Low-level realtime WebSocket client.
 *
 * @internal Not a stable app-facing API. `createRebaseClient()` constructs and
 * manages this internally (exposed as `client.ws`, typed by the minimal
 * `RebaseWebSocket` contract in `@rebasepro/types`). It stays exported from the
 * package root for the same reason it always was — a data-source driver may
 * instantiate it directly — but nothing in this repo does since
 * `@rebasepro/client-postgres` was removed; its surface may change without a
 * major bump.
 */
export class RebaseWebSocketClient {
    private websocketUrl: string;
    private ws: WebSocket | null = null;
    public getAuthToken?: () => Promise<string | null>;
    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    /** Channel-name → handlers, for broadcast and presence frames. */
    private channelHandlers = new Map<string, Set<(message: Record<string, unknown>) => void>>();

    /** Set by `close()`. Blocks any later operation from silently redialling. */
    private closedByCaller = false;

    /**
     * Set when the backoff budget ran out, cleared by anything that earns a
     * fresh one.
     *
     * Unlike {@link closedByCaller} this is not final — nobody *asked* for the
     * socket to stay down. Five attempts with exponential backoff is about a
     * minute, which a laptop lid, a wifi handover or a backend rollout all
     * exceed routinely; treating that as permanent meant realtime silently
     * stopped for the rest of the page's life, with a reload the only cure.
     */
    private gaveUp = false;

    /**
     * Whether a socket exists at all (open or still opening).
     *
     * Lets callers distinguish "authenticate the live socket" from "there is
     * nothing to authenticate yet", without that question forcing a dial.
     */
    public get hasSocket(): boolean {
        return this.ws !== null;
    }

    /** So the "no WebSocket in this environment" warning is said once, not per call. */
    private warnedNoWebSocket = false;

    /** Subscribe to broadcast/presence frames for one channel. */
    public onChannelMessage(channel: string, handler: (message: Record<string, unknown>) => void): () => void {
        if (!this.channelHandlers.has(channel)) this.channelHandlers.set(channel, new Set());
        this.channelHandlers.get(channel)!.add(handler);
        return () => {
            const handlers = this.channelHandlers.get(channel);
            if (!handlers) return;
            handlers.delete(handler);
            if (handlers.size === 0) this.channelHandlers.delete(channel);
        };
    }

    /** Notified after the socket comes back, so channels can re-join. */
    public onReconnect(handler: () => void): () => void {
        return this.on("reconnect", handler);
    }

    public on(event: "connect" | "disconnect" | "reconnect" | "error", cb: (...args: unknown[]) => void) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(cb);
        return () => this.listeners.get(event)!.delete(cb);
    }

    private emit(event: string, ...args: unknown[]) {
        if (this.listeners.has(event)) {
            this.listeners.get(event)!.forEach(cb => cb(...args));
        }
    }

    // New: Subscription deduplication management with optimizations
    private collectionSubscriptions = new Map<string, {
        backendSubscriptionId: string;
        callbacks: Map<string, {
            onUpdate: (rows: Record<string, unknown>[]) => void;
            onError?: (error: Error) => void;
        }>;
        props: FetchCollectionProps;
        latestData?: Record<string, unknown>[]; // Cache the latest flat rows
        lastUpdated?: number; // Timestamp for cache invalidation
        isInitialDataReceived?: boolean; // Track if we got initial data
        /**
         * A `subscribe_collection` frame is on the wire and its initial payload
         * has not arrived yet. Without this, a subscription whose subscribe
         * failed is indistinguishable from one still loading, and every later
         * listener attaches to it and waits forever.
         */
        subscribeInFlight?: boolean;
        /**
         * Watchdog for the above. `subscribe_collection` expects no response
         * envelope, so it is not covered by `pendingRequests`' timeout — a lost
         * initial payload would otherwise hang the subscription indefinitely.
         */
        subscribeTimeout?: ReturnType<typeof setTimeout>;
        /**
         * The key columns of this collection, as told by the server on a patch.
         * Rows are columns only, and the SDK holds no collection config, so
         * without this there is nothing to derive an address from.
         */
        pks?: PrimaryKeyInfo[];
    }>();

    private singleSubscriptions = new Map<string, {
        backendSubscriptionId: string;
        callbacks: Map<string, {
            onUpdate: (row: Record<string, unknown> | null) => void;
            onError?: (error: Error) => void;
        }>;
        props: FetchOneProps;
        latestData?: Record<string, unknown> | null; // Cache the latest flat row
        lastUpdated?: number; // Timestamp for cache invalidation
        isInitialDataReceived?: boolean; // Track if we got initial data
        /** See the collection subscription counterparts. */
        subscribeInFlight?: boolean;
        subscribeTimeout?: ReturnType<typeof setTimeout>;
    }>();

    // Maps to quickly find subscription by backend subscription ID
    private backendToCollectionKey = new Map<string, string>();
    private backendToEntityKey = new Map<string, string>();


    private pendingRequests = new Map<string, {
        resolve: (p: unknown) => void;
        reject: (p: Error) => void;
        message?: Record<string, unknown> & { _queuedResolve?: (p: unknown) => void; _queuedReject?: (p: Error) => void }
    }>();
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private isConnected = false;
    private messageQueue: Record<string, unknown>[] = [];
    private requestTimeoutMs = 30000;
    private subscriptionTimeoutMs = 30000;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    private isAuthenticated = false;
    private authPromise: Promise<void> | null = null;
    private WebSocketConstructor: typeof WebSocket | undefined;
    public onUnauthorized?: () => Promise<boolean>;
    private refreshInProgress: Promise<boolean> | null = null;

    constructor(config: RebaseWebSocketConfig) {
        this.websocketUrl = config.websocketUrl;
        this.getAuthToken = config.getAuthToken;
        this.onUnauthorized = config.onUnauthorized;
        this.WebSocketConstructor = config.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : undefined);

        // Deliberately does NOT dial here. Constructing the client is not a
        // statement that the app wants a socket — `createRebaseClient` builds
        // one whenever realtime is not explicitly disabled, so connecting here
        // opened a socket on every page load of every app that merely *might*
        // subscribe later. Anonymous-first apps paid that on every visit, to
        // authenticate with nothing, which left them choosing between "socket
        // on every page load" and "no channels at all".
        //
        // The environment warning is also deferred: an app that never
        // subscribes should say nothing at all. See `ensureConnected`.
    }

    /**
     * Open the socket if it is not open (or opening) already.
     *
     * Idempotent, synchronous, and safe to call on every operation that needs a
     * live socket — `initWebSocket` already no-ops on an open socket and is
     * re-entrant, since the reconnect path has always called it.
     */
    public ensureConnected(): void {
        // An explicit `close()` is final. Without this, one queued frame could
        // redial a socket the caller just released and keep a Node process
        // alive forever.
        if (this.closedByCaller) return;
        if (!this.WebSocketConstructor) {
            if (!this.warnedNoWebSocket) {
                this.warnedNoWebSocket = true;
                console.warn("WebSocket is not defined in this environment. Realtime subscriptions will not work unless you provide a WebSocket implementation in the config.");
            }
            return;
        }
        this.installOnlineListener();
        if (this.ws || this.reconnectTimeout) return;
        // A caller asking for a connection is a fresh reason to try, so it also
        // buys a fresh backoff budget. Without this, the first `subscribe`
        // after a give-up would exhaust the counter on attempt one.
        if (this.gaveUp) {
            this.gaveUp = false;
            this.reconnectAttempts = 0;
        }
        this.initWebSocket();
    }

    /**
     * The browser says the network is back — the usual reason the budget ran
     * out in the first place. Registered lazily so a Node client, or a page
     * that never subscribes, adds no listener.
     */
    private installOnlineListener() {
        if (this.onlineListener || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
        this.onlineListener = () => {
            if (this.closedByCaller || !this.gaveUp) return;
            console.debug("Network is back — retrying the realtime connection");
            this.ensureConnected();
        };
        window.addEventListener("online", this.onlineListener);
    }

    private onlineListener: (() => void) | null = null;

    /**
     * Authenticate the WebSocket connection
     */
    async authenticate(token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Random suffix, like every other request id here. Two auth
            // attempts started in the same millisecond produced the same id,
            // and `pendingRequests` is a Map: the second registration replaced
            // the first, so one caller's promise was never settled either way.
            const requestId = `auth_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                // `authPromise` belongs to `ensureAuthenticated`, which clears
                // it when the whole attempt — retries included — settles.
                // Clearing it here let a second attempt start while this one
                // was still retrying.
                reject(new Error("Authentication timeout"));
            }, 30000);

            this.pendingRequests.set(requestId, {
                resolve: () => {
                    clearTimeout(timeout);
                    this.isAuthenticated = true;
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            const message = {
                type: "AUTHENTICATE",
                requestId,
                payload: { token }
            };

            if (!this.isConnected || !this.ws) {
                this.messageQueue.unshift(message); // Auth should be first
            } else {
                this.ws.send(JSON.stringify(message));
            }
        });
    }

    /**
     * Set the auth token getter function
     */
    setAuthTokenGetter(getAuthToken: () => Promise<string | null>): void {
        this.getAuthToken = getAuthToken;
        // Auto-authenticate if we are already connected but didn't have the token getter yet
        if (this.isConnected && !this.isAuthenticated && !this.authPromise) {
            console.debug("WebSocket auto-authenticating after token getter set");
            this.getAuthToken().then(token => {
                if (!this.ws) return; // Prevent memory leaks / actions after disconnect
                if (token) {
                    this.authenticate(token).catch(e => {
                        if (this.ws) console.debug("WebSocket auto-auth skipped:", e?.message || e);
                    });
                }
            }).catch(e => {
                // User not logged in or auth still loading — this is expected,
                // the WebSocket will authenticate on-demand when a request is made.
                if (this.ws) console.debug("WebSocket auto-auth skipped:", e?.message || e);
            });
        }
    }

    /**
     * Drop the socket.
     *
     * `permanent` distinguishes the two callers. Signing out drops the socket
     * but the client stays usable — a later subscribe should reconnect
     * anonymously. `client.close()` is the caller saying they are done, and
     * must not be undone by a stray queued frame.
     */
    public disconnect(permanent = false): void {
        if (permanent) this.closedByCaller = true;
        if (permanent && this.onlineListener && typeof window !== "undefined") {
            window.removeEventListener("online", this.onlineListener);
            this.onlineListener = null;
        }
        this.isAuthenticated = false;
        this.authPromise = null;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.onclose = null; // Prevent reconnect on explicit disconnect
            this.ws.onerror = null; // Prevent errors on explicit disconnect
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.close();
            this.ws = null;
        }
    }

    // Initialize WebSocket connection
    private initWebSocket() {
        if (!this.WebSocketConstructor) return;
        if (this.ws?.readyState === this.WebSocketConstructor.OPEN) return;

        // Guard against race condition: if a previous socket is still connecting, tear it down
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }

        try {
            // Captured so each handler can tell "my socket" from a later one:
            // a close arriving after a redial must not clear the new socket.
            const socket = new this.WebSocketConstructor(this.websocketUrl);
            this.ws = socket;

            this.ws!.onopen = async () => {
                console.debug("Connected to PostgreSQL backend");
                const wasReconnect = this.reconnectAttempts > 0;
                this.isConnected = true;
                this.reconnectAttempts = 0;

                // Auto-authenticate if token getter is available
                if (this.getAuthToken && !this.isAuthenticated) {
                    try {
                        const token = await this.getAuthToken();
                        if (token) {
                            await this.authenticate(token);
                            console.debug("WebSocket auto-authenticated");
                        }
                    } catch (error) {
                        // User not logged in or auth still loading — this is expected.
                        // Authentication will happen on-demand when the user logs in.
                        console.debug("WebSocket connected without auth:", (error as Error)?.message || error);
                    }
                }

                this.emit(wasReconnect ? "reconnect" : "connect");
                this.processMessageQueue();

                // Re-subscribe all active subscriptions after reconnect.
                // The server-side subscription state was lost when the connection dropped,
                // so we need to re-register every active subscription.
                if (wasReconnect) {
                    this.resubscribeAll();
                }

                // Subscribes requested while offline have just gone out; they
                // could not be watchdogged at request time.
                this.armPendingSubscribeWatchdogs();
            };

            this.ws!.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data, rebaseReviver);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    console.error("Error parsing WebSocket message:", error);
                }
            };

            this.ws!.onclose = () => {
                console.debug("Disconnected from PostgreSQL backend");
                // Release the dead socket. `ensureConnected` returns early
                // while `this.ws` is set, so holding a closed one made the
                // "give up after N attempts" state permanent: nothing could
                // ever redial, not even a fresh `subscribe`.
                if (this.ws === socket) this.ws = null;
                this.isConnected = false;
                this.isAuthenticated = false;
                this.authPromise = null;
                // The reconnect path re-subscribes everything; a watchdog firing
                // in the meantime would tear down healthy subscriptions.
                this.suspendSubscribeWatchdogs();
                this.emit("disconnect");

                // Re-queue pending requests so the UI doesn't hang indefinitely or crash
                for (const [reqId, request] of this.pendingRequests.entries()) {
                    if (reqId.startsWith("auth_")) {
                        request.reject(new Error("Connection closed during authentication"));
                    } else if (request.message) {
                        request.message._queuedResolve = request.resolve;
                        request.message._queuedReject = request.reject;
                        this.messageQueue.push(request.message);
                    } else {
                        request.reject(new RebaseApiError("Connection closed"));
                    }
                    this.pendingRequests.delete(reqId);
                }

                this.attemptReconnect();
            };

            this.ws!.onerror = (error) => {
                console.error("WebSocket error:", error);
                this.isConnected = false;
                this.emit("error", error);
            };
        } catch (error) {
            console.error("Failed to initialize WebSocket:", error);
            this.attemptReconnect();
        }
    }

    private processMessageQueue() {
        while (this.messageQueue.length > 0 && this.isConnected) {
            const message = this.messageQueue.shift();
            if (message) this.sendMessage(message);
        }
    }

    private attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error("Max reconnection attempts reached");
            // Nothing will re-subscribe now, so stop every subscription that
            // never loaded from spinning forever.
            this.gaveUp = true;
            this.failAllPendingSubscriptions(
                new RebaseApiError("Connection lost", { code: "CONNECTION_LOST" })
            );
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

        console.debug(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.initWebSocket();
        }, delay);
    }

    private isAuthError(message: WebSocketMessage): boolean {
        if (message.type === "AUTH_ERROR") return true;
        const { errorMessage, errorCode } = extractMessageError(message);
        if (errorCode === "UNAUTHORIZED" || errorCode === "JWT_EXPIRED" || errorCode === "AUTH_ERROR") return true;
        const lowerMessage = errorMessage.toLowerCase();
        return lowerMessage.includes("unauthorized") || lowerMessage.includes("token expired") || lowerMessage.includes("token is expired") || lowerMessage.includes("invalid token") || lowerMessage.includes("session expired") || lowerMessage.includes("auth error");
    }

    private async handleAuthFailure(): Promise<boolean> {
        if (this.refreshInProgress) {
            return this.refreshInProgress;
        }
        this.refreshInProgress = (async () => {
            this.isAuthenticated = false;
            this.authPromise = null;
            if (this.onUnauthorized) {
                try {
                    const refreshed = await this.onUnauthorized();
                    if (refreshed && this.getAuthToken) {
                        const token = await this.getAuthToken();
                        if (token) {
                            await this.authenticate(token);
                            return true;
                        }
                    }
                } catch (error) {
                    console.error("WebSocket auth refresh failed:", error);
                }
            }
            return false;
        })();
        try {
            return await this.refreshInProgress;
        } finally {
            this.refreshInProgress = null;
        }
    }

    /**
     * Shared logic for re-subscribing a collection or row subscription
     * after an auth error is resolved by refreshing credentials.
     */
    private resubscribeAfterAuthRefresh(
        message: WebSocketMessage,
        subscription: {
            backendSubscriptionId: string;
            callbacks: Map<string, { onUpdate: (...args: never[]) => void; onError?: (error: Error) => void }>;
            props: FetchCollectionProps | FetchOneProps;
        },
        subscriptionKey: string,
        idPrefix: "collection" | "row",
        backendKeyMap: Map<string, string>,
        messageType: "subscribe_collection" | "subscribe_one"
    ): void {
        this.handleAuthFailure().then(refreshed => {
            if (refreshed) {
                const oldBackendId = subscription.backendSubscriptionId;
                const newBackendId = `${idPrefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                subscription.backendSubscriptionId = newBackendId;
                backendKeyMap.delete(oldBackendId);
                backendKeyMap.set(newBackendId, subscriptionKey);

                // Route through the helpers so the retry is watchdogged too.
                if (messageType === "subscribe_collection") {
                    this.sendCollectionSubscribe(subscriptionKey);
                } else {
                    this.sendEntitySubscribe(subscriptionKey);
                }
                return;
            }

            // The refresh did not produce usable credentials. Report the original
            // error and drop the registration, so a later mount can try again
            // rather than attaching to a subscription that will never load.
            const { errorMessage, errorCode } = extractMessageError(message);
            const error = new RebaseApiError(errorMessage, { code: errorCode });
            if (messageType === "subscribe_collection") {
                this.failCollectionSubscription(subscriptionKey, error);
            } else {
                this.failEntitySubscription(subscriptionKey, error);
            }
        }).catch(err => {
            const error = err instanceof Error ? err : new Error(String(err));
            if (messageType === "subscribe_collection") {
                this.failCollectionSubscription(subscriptionKey, error);
            } else {
                this.failEntitySubscription(subscriptionKey, error);
            }
        });
    }

    private handleWebSocketMessage(message: WebSocketMessage) {
        const {
            type,
            requestId,
            subscriptionId
        } = message;

        // Handle responses to pending requests
        if (requestId && this.pendingRequests.has(requestId)) {
            const pendingReq = this.pendingRequests.get(requestId)!;
            if (type === "ERROR" || type === "AUTH_ERROR" || message.error) {
                if (this.isAuthError(message)) {
                    this.pendingRequests.delete(requestId);
                    this.handleAuthFailure().then(refreshed => {
                        if (refreshed && pendingReq.message) {
                            this.doSendMessage(pendingReq.message, pendingReq.resolve, pendingReq.reject).catch(pendingReq.reject);
                        } else {
                            const { errorMessage, errorCode } = extractMessageError(message);
                            pendingReq.reject(new RebaseApiError(errorMessage, { code: errorCode }));
                        }
                    }).catch(err => {
                        pendingReq.reject(err);
                    });
                } else {
                    this.pendingRequests.delete(requestId);
                    const { errorMessage, errorCode } = extractMessageError(message);
                    pendingReq.reject(new RebaseApiError(errorMessage, { code: errorCode }));
                }
            } else {
                this.pendingRequests.delete(requestId);
                pendingReq.resolve(message.payload || message);
            }
            return;
        }

        // Channel traffic (broadcast / presence) is addressed by channel name
        // rather than by requestId or subscriptionId, so it is dispatched
        // before the subscription paths — none of which would match it, and
        // the message would otherwise fall through and be dropped silently.
        if (typeof message.channel === "string" &&
            (type === "broadcast" || type === "presence_state" || type === "presence_diff" || type === "channel_history")) {
            const handlers = this.channelHandlers.get(message.channel);
            if (handlers) {
                for (const handler of [...handlers]) {
                    try {
                        handler(message as unknown as Record<string, unknown>);
                    } catch (error) {
                        console.error("Error in channel handler:", error);
                    }
                }
            }
            return;
        }

        // Handle subscription updates for collection subscriptions
        if (subscriptionId && type === "collection_update") {
            const subscriptionKey = this.backendToCollectionKey.get(subscriptionId);
            if (subscriptionKey) {
                const collectionSub = this.collectionSubscriptions.get(subscriptionKey);
                if (collectionSub) {
                    const wireEntities = (message.rows || []) as unknown as Record<string, unknown>[];
                    const incomingRows = wireEntities;

                    // The keys arrive with the rows, so they are known before the
                    // first merge — a CDC-driven change never sends a patch, and
                    // learning them from patches alone would leave every
                    // externally-written collection unable to match a thing.
                    const updatePks = (message as unknown as { pks?: PrimaryKeyInfo[] }).pks;
                    if (updatePks) collectionSub.pks = updatePks;

                    // Structural merge: preserve cached row references for rows
                    // whose values haven't changed. This prevents downstream React components
                    // from re-rendering (VirtualTableCell uses deepEqual on rowData —
                    // same reference = instant true, avoiding expensive deep comparison).
                    const rows = this.mergeRows(collectionSub.latestData, incomingRows, collectionSub.pks);

                    // Cache the latest data with optimizations
                    collectionSub.latestData = rows;
                    collectionSub.lastUpdated = Date.now();
                    collectionSub.isInitialDataReceived = true;
                    // The subscribe landed — stand the watchdog down.
                    if (collectionSub.subscribeTimeout) clearTimeout(collectionSub.subscribeTimeout);
                    collectionSub.subscribeTimeout = undefined;
                    collectionSub.subscribeInFlight = false;

                    // Notify all callbacks for this subscription
                    collectionSub.callbacks.forEach(callback => {
                        try {
                            callback.onUpdate(rows);
                        } catch (error) {
                            console.error("Error in collection subscription callback:", error);
                            if (callback.onError) {
                                callback.onError(error instanceof Error ? error : new Error(String(error)));
                            }
                        }
                    });
                    return;
                }
            }
        }

        // Handle instant row-level patches for collection subscriptions.
        // These arrive before the full refetch and give immediate cross-tab feedback.
        if (subscriptionId && type === "collection_patch") {
            const subscriptionKey = this.backendToCollectionKey.get(subscriptionId);
            if (subscriptionKey) {
                const collectionSub = this.collectionSubscriptions.get(subscriptionKey);
                if (collectionSub && collectionSub.isInitialDataReceived && collectionSub.latestData) {
                    const patchWireEntity = message.row ?? null;
                    const patchMessage = message as unknown as { id: string; pks?: PrimaryKeyInfo[] };
                    const patchEntityId = patchMessage.id;
                    // The server knows the key columns; remember them, because the
                    // refetch reconciliation needs them too and carries no id.
                    if (patchMessage.pks) collectionSub.pks = patchMessage.pks;
                    const patchRow = patchWireEntity ? (patchWireEntity as unknown as Record<string, unknown>) : null;
                    let updated: Record<string, unknown>[];

                    if (patchRow === null) {
                        // Row was deleted — remove it from the cached list
                        updated = collectionSub.latestData.filter(
                            e => this.rowAddress(e, collectionSub.pks) !== String(patchEntityId)
                        );
                    } else {
                        // Row was created or updated — merge into the cached list.
                        // Matched against the patch's own address rather than
                        // anything read off the row: `patchRow.id` is undefined
                        // for a table not keyed on `id`, so every update looked
                        // like a new row and was prepended as a duplicate.
                        const idx = collectionSub.latestData.findIndex(
                            e => this.rowAddress(e, collectionSub.pks) === String(patchEntityId)
                        );
                        if (idx >= 0) {
                            // Update in place (preserve array position)
                            updated = [...collectionSub.latestData];
                            updated[idx] = patchRow;
                        } else {
                            // New row — prepend (most recently created first)
                            updated = [patchRow, ...collectionSub.latestData];
                        }
                    }

                    collectionSub.latestData = updated;
                    collectionSub.lastUpdated = Date.now();

                    // Fire all callbacks with the patched data
                    collectionSub.callbacks.forEach(callback => {
                        try {
                            callback.onUpdate(updated);
                        } catch (error) {
                            console.error("Error in collection patch callback:", error);
                            if (callback.onError) {
                                callback.onError(error instanceof Error ? error : new Error(String(error)));
                            }
                        }
                    });
                    return;
                }
            }
        }

        // Handle subscription updates for row subscriptions
        if (subscriptionId && type === "single_update") {
            const subscriptionKey = this.backendToEntityKey.get(subscriptionId);
            if (subscriptionKey) {
                const entitySub = this.singleSubscriptions.get(subscriptionKey);
                if (entitySub) {
                    const wireEntity = message.row ?? null;
                    const row = wireEntity ? (wireEntity as unknown as Record<string, unknown>) : null;
                    // Cache the latest data with optimizations
                    entitySub.latestData = row;
                    entitySub.lastUpdated = Date.now();
                    entitySub.isInitialDataReceived = true;
                    if (entitySub.subscribeTimeout) clearTimeout(entitySub.subscribeTimeout);
                    entitySub.subscribeTimeout = undefined;
                    entitySub.subscribeInFlight = false;

                    // Notify all callbacks for this subscription
                    entitySub.callbacks.forEach(callback => {
                        try {
                            callback.onUpdate(row);
                        } catch (error) {
                            console.error("Error in row subscription callback:", error);
                            if (callback.onError) {
                                callback.onError(error instanceof Error ? error : new Error(String(error)));
                            }
                        }
                    });
                    return;
                }
            }
        }

        // Handle subscription errors
        if (subscriptionId && (type === "ERROR" || message.error)) {
            const collectionKey = this.backendToCollectionKey.get(subscriptionId);
            if (collectionKey) {
                const collectionSub = this.collectionSubscriptions.get(collectionKey);
                if (collectionSub) {
                    if (this.isAuthError(message)) {
                        this.resubscribeAfterAuthRefresh(
                            message,
                            collectionSub,
                            collectionKey,
                            "collection",
                            this.backendToCollectionKey,
                            "subscribe_collection"
                        );
                        return;
                    }

                    // The server answered, so nothing is in flight any more. Leave
                    // the registration in place (its listeners are still mounted
                    // and have been told), but marked idle so the next listener
                    // re-subscribes instead of attaching to a dead entry.
                    if (collectionSub.subscribeTimeout) clearTimeout(collectionSub.subscribeTimeout);
                    collectionSub.subscribeTimeout = undefined;
                    collectionSub.subscribeInFlight = false;

                    const { errorMessage, errorCode } = extractMessageError(message);
                    const error = new RebaseApiError(errorMessage, { code: errorCode });
                    collectionSub.callbacks.forEach(callback => {
                        if (callback.onError) {
                            callback.onError(error);
                        }
                    });
                    return;
                }
            }

            const entityKey = this.backendToEntityKey.get(subscriptionId);
            if (entityKey) {
                const entitySub = this.singleSubscriptions.get(entityKey);
                if (entitySub) {
                    if (this.isAuthError(message)) {
                        this.resubscribeAfterAuthRefresh(
                            message,
                            entitySub,
                            entityKey,
                            "row",
                            this.backendToEntityKey,
                            "subscribe_one"
                        );
                        return;
                    }

                    if (entitySub.subscribeTimeout) clearTimeout(entitySub.subscribeTimeout);
                    entitySub.subscribeTimeout = undefined;
                    entitySub.subscribeInFlight = false;

                    const { errorMessage, errorCode } = extractMessageError(message);
                    const error = new RebaseApiError(errorMessage, { code: errorCode });
                    entitySub.callbacks.forEach(callback => {
                        if (callback.onError) {
                            callback.onError(error);
                        }
                    });
                    return;
                }
            }
        }

        // An error that matched no waiter used to fall off the end of this
        // method and disappear. Channel frames are the ones that always do:
        // they are fire-and-forget by design, so no `pendingRequests` entry
        // exists to reject and the server's errors about them — RATE_LIMITED,
        // CHANNEL_FORBIDDEN, CHANNEL_HISTORY_WRITE_FAILED — were dropped while
        // `await channel.broadcast(...)` resolved as if it had been sent. A
        // console warning is the floor, not the answer: an `onError` on
        // `RebaseRealtimeChannel` is the shape this should eventually take.
        if (type === "ERROR" || type === "error" || message.error) {
            const { errorMessage, errorCode } = extractMessageError(message);
            console.warn(
                `[Rebase] Realtime error from the server${errorCode ? ` (${errorCode})` : ""}: ${errorMessage}`
            );
        }
    }

    private async ensureAuthenticated(retryCount = 3): Promise<void> {
        // If already authenticated or no token getter, skip
        if (this.isAuthenticated || !this.getAuthToken) return;

        // If auth is in progress, wait for it.
        //
        // The share has to be published *before* the first await, which is why
        // the work lives in its own method. The guard used to be read here and
        // the promise only assigned after `await this.getAuthToken()` — so
        // every caller that arrived during that gap saw `null` and started an
        // attempt of its own. A queue flushing six subscriptions on connect
        // does exactly that, and each extra attempt raced the others through a
        // single `pendingRequests` slot: one settled, the rest hung until their
        // own 30s timeout, and the frames waiting behind them were never sent.
        // Their subscriptions then reported "Subscription timed out" — the
        // board's columns loading one at a time, or not at all.
        if (!this.authPromise) {
            this.authPromise = this.runAuthentication(retryCount);
            this.authPromise.finally(() => {
                this.authPromise = null;
            }).catch(() => undefined);
        }
        await this.authPromise;
    }

    private async runAuthentication(retryCount: number): Promise<void> {
        // Try to authenticate with retries
        let lastError: unknown = null;

        for (let attempt = 0; attempt < retryCount; attempt++) {
            try {
                const token = await this.getAuthToken!();
                if (!token) throw new Error("user not logged in");
                await this.authenticate(token);
                console.debug("WebSocket authenticated on demand");
                return; // Success
            } catch (error: unknown) {
                lastError = error;

                const errMsg = error instanceof Error ? error.message : String(error);
                // "not logged in" / "Session expired" are definitive - don't retry
                if (errMsg.includes("not logged in") || errMsg.includes("Session expired")) {
                    console.warn("WebSocket auth failed: user not logged in");
                    throw error;
                }

                // "still loading" is transient - retry with backoff (auth controller
                // is restoring tokens from localStorage; it will resolve shortly)
                if (errMsg.includes("still loading")) {
                    if (attempt < retryCount - 1) {
                        const delay = Math.min(500 * (attempt + 1), 2000);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }

                // For other errors, retry with backoff
                if (attempt < retryCount - 1) {
                    const delay = Math.min(1000 * (attempt + 1), 3000);
                    console.debug(`WebSocket auth attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        console.warn("WebSocket on-demand auth failed after retries:", lastError);
        throw lastError;
    }

    async reauthenticate(): Promise<void> {
        if (!this.getAuthToken) return;

        this.isAuthenticated = false;
        try {
            const token = await this.getAuthToken();
            if (!token) throw new Error("user not logged in");
            await this.authenticate(token);
            console.debug("WebSocket reauthenticated successfully");
        } catch (error) {
            console.error("WebSocket reauthentication failed:", error);
            throw error;
        }
    }

    /**
     * Public because `RebaseRealtimeChannel` sends channel frames through it.
     * Not part of the stable surface — prefer `client.realtime.channel(name)`.
     */
    public sendMessage(message: Record<string, unknown>): Promise<unknown> {
        // If already has a requestId (re-sending from queue), use the stored promise handlers
        const queuedMsg = message as Record<string, unknown> & { _queuedResolve?: (p: unknown) => void; _queuedReject?: (p: Error) => void };
        if (queuedMsg._queuedResolve && queuedMsg._queuedReject) {
            return this.doSendMessage(message, queuedMsg._queuedResolve, queuedMsg._queuedReject);
        }

        if (!this.isConnected || !this.ws) {
            // The queue is only ever drained by a socket opening, so something
            // has to open one. Before lazy connect this was guaranteed by the
            // constructor; now the first frame is what asks for it.
            this.ensureConnected();
            // Queue the message and return a promise that will be resolved when actually sent
            return new Promise<unknown>((resolve, reject) => {
                const queueable = message as Record<string, unknown> & { _queuedResolve?: (p: unknown) => void; _queuedReject?: (p: Error) => void };
                queueable._queuedResolve = resolve;
                queueable._queuedReject = reject;
                this.messageQueue.push(message);
            });
        }

        return new Promise<unknown>((resolve, reject) => {
            this.doSendMessage(message, resolve, reject);
        });
    }

    private async doSendMessage(message: Record<string, unknown>, resolve: (value: unknown) => void, reject: (error: Error) => void): Promise<void> {
        // Ensure authenticated before sending non-auth messages.
        //
        // Channel traffic is exempt. `ensureAuthenticated` throws "user not
        // logged in" when there is no token, which rejects the frame before it
        // is ever sent — so on an anonymous-first app (the kind this API was
        // added for) *every* channel operation failed client-side, and the
        // server never got to decide. Presence in a public room does not
        // require an account. A signed-in caller still authenticates: the
        // socket does it from `getAuthToken` on open, and the server authorizes
        // these frames either way.
        if (message.type !== "AUTHENTICATE"
            && !CHANNEL_MESSAGE_TYPES.has(message.type as string)
            && this.getAuthToken && !this.isAuthenticated) {
            try {
                await this.ensureAuthenticated();
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : "Authentication required";
                reject(new RebaseApiError(errorMessage));
                return;
            }
        }

        const requestId = (message.requestId as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        message.requestId = requestId;

        const expectsResponse = !(
            message.type === "subscribe_collection"
            || message.type === "subscribe_one"
            || message.type === "unsubscribe"
            || CHANNEL_MESSAGE_TYPES.has(message.type as string)
        );

        if (expectsResponse && !this.pendingRequests.has(requestId)) {
            const timeoutHandle = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new RebaseApiError("Request timed out"));
                }
            }, this.requestTimeoutMs);

            this.pendingRequests.set(requestId, {
                resolve: (value: unknown) => {
                    clearTimeout(timeoutHandle);
                    resolve(value);
                },
                reject: (error: Error) => {
                    clearTimeout(timeoutHandle);
                    reject(error);
                },
                message: message as Record<string, unknown> & { _queuedResolve?: (p: unknown) => void; _queuedReject?: (p: Error) => void }
            });
        }

        try {
            this.ws!.send(JSON.stringify(message));
            if (!expectsResponse) {
                resolve(undefined);
            }
        } catch (error) {
            if (expectsResponse) {
                this.pendingRequests.delete(requestId);
            }
            reject(new RebaseApiError("Failed to send message", { cause: error }));
        }
    }

    // Data source methods
    async fetchCollection<M extends Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<Record<string, unknown>[]> {
        const response = await this.sendMessage({
            type: "FETCH_COLLECTION",
            payload: props
        }) as { rows?: Record<string, unknown>[] };
        return (response.rows || []);
    }

    async fetchOne<M extends Record<string, unknown>>(props: FetchOneProps<M>): Promise<Record<string, unknown> | undefined> {
        const response = await this.sendMessage({
            type: "FETCH_ONE",
            payload: props
        }) as { row?: Record<string, unknown> };
        const wireEntity = response.row;
        return wireEntity ?? undefined;
    }

    async save<M extends Record<string, unknown>>(props: SaveProps<M>): Promise<Record<string, unknown>> {
        const response = await this.sendMessage({
            type: "SAVE",
            payload: props
        }) as { row: Record<string, unknown> };
        return response.row;
    }

    async delete<M extends Record<string, unknown>>(props: DeleteProps<M>): Promise<void> {
        await this.sendMessage({
            type: "DELETE",
            payload: props
        });
    }

    async executeSql(sql: string, options?: { database?: string, role?: string }): Promise<Record<string, unknown>[]> {
        const response = await this.sendMessage({
            type: "EXECUTE_SQL",
            payload: { sql,
options }
        }) as { result?: Record<string, unknown>[] };
        return response.result || [];
    }

    async fetchAvailableDatabases(): Promise<string[]> {
        const response = await this.sendMessage({
            type: "FETCH_DATABASES",
            payload: {}
        }) as { databases?: string[] };
        return response.databases || [];
    }

    async fetchAvailableRoles(): Promise<string[]> {
        const response = await this.sendMessage({
            type: "FETCH_ROLES"
        }) as { roles?: string[] };
        return response.roles || [];
    }

    async fetchApplicationRoles(): Promise<string[]> {
        const response = await this.sendMessage({
            type: "FETCH_APPLICATION_ROLES"
        }) as { roles?: string[] };
        return response.roles || [];
    }

    async fetchCurrentDatabase(): Promise<string | undefined> {
        const response = await this.sendMessage({
            type: "FETCH_CURRENT_DATABASE"
        }) as { database?: string };
        return response.database;
    }

    async checkUniqueField(path: string, name: string, value: unknown, id?: string, collection?: CollectionConfig): Promise<boolean> {
        const response = await this.sendMessage({
            type: "CHECK_UNIQUE_FIELD",
            payload: {
                path,
                name,
                value,
                id,
                collection
            }
        }) as { isUnique: boolean };
        return response.isUnique;
    }

    async count<M extends Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<number> {
        const response = await this.sendMessage({
            type: "COUNT",
            payload: props
        }) as { count: number };
        return response.count;
    }

    async fetchUnmappedTables(mappedPaths?: string[]): Promise<string[]> {
        const response = await this.sendMessage({
            type: "FETCH_UNMAPPED_TABLES",
            payload: { mappedPaths }
        }) as { tables?: string[] };
        return response.tables || [];
    }

    async fetchTableMetadata(tableName: string): Promise<TableMetadata> {
        const response = await this.sendMessage({
            type: "FETCH_TABLE_METADATA",
            payload: { tableName }
        }) as { metadata?: TableMetadata };

        return response.metadata || ({ columns: [],
foreignKeys: [],
junctions: [],
policies: [] } as TableMetadata);
    }

    async createBranch(name: string, options?: { source?: string }): Promise<BranchInfo> {
        const response = await this.sendMessage({
            type: "CREATE_BRANCH",
            payload: { name,
options }
        }) as { branch: BranchInfo };
        return response.branch;
    }

    async deleteBranch(name: string): Promise<void> {
        await this.sendMessage({
            type: "DELETE_BRANCH",
            payload: { name }
        });
    }

    async listBranches(): Promise<BranchInfo[]> {
        const response = await this.sendMessage({
            type: "LIST_BRANCHES",
            payload: {}
        }) as { branches?: BranchInfo[] };
        return response.branches || [];
    }

    /**
     * Recursively compare two values for structural equality.
     * Handles primitives, null, undefined, Date, RegExp, arrays, and plain objects.
     */
    private deepEqual(a: unknown, b: unknown): boolean {
        // Same reference or same primitive
        if (a === b) return true;

        // Handle null/undefined
        if (a === null || b === null || a === undefined || b === undefined) return false;

        // Different types
        if (typeof a !== typeof b) return false;

        // Non-object primitives (number, string, boolean, bigint, symbol)
        // that weren't caught by === above (e.g. NaN !== NaN)
        if (typeof a !== "object") return false;

        // Date comparison
        if (a instanceof Date && b instanceof Date) {
            return a.getTime() === b.getTime();
        }
        if (a instanceof Date || b instanceof Date) return false;

        // RegExp comparison
        if (a instanceof RegExp && b instanceof RegExp) {
            return a.source === b.source && a.flags === b.flags;
        }
        if (a instanceof RegExp || b instanceof RegExp) return false;

        // Array comparison
        const aIsArray = Array.isArray(a);
        const bIsArray = Array.isArray(b);
        if (aIsArray !== bIsArray) return false;

        if (aIsArray && bIsArray) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.deepEqual(a[i], b[i])) return false;
            }
            return true;
        }

        // Plain object comparison
        const aObj = a as Record<string, unknown>;
        const bObj = b as Record<string, unknown>;
        const aKeys = Object.keys(aObj);
        const bKeys = Object.keys(bObj);

        if (aKeys.length !== bKeys.length) return false;

        for (const key of aKeys) {
            if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
            if (!this.deepEqual(aObj[key], bObj[key])) return false;
        }

        return true;
    }

    private normalizeForComparison(val: unknown): unknown {
        if (!val) return val;

        if (Array.isArray(val)) {
            return val.map(item => this.normalizeForComparison(item));
        }

        if (typeof val === "object") {
            if (val instanceof Date) return val;
            if (val instanceof RegExp) return val;

            const obj = val as Record<string, unknown>;
            if (obj.__type === "relation") {
                // `data` is dropped on purpose: a relation compares by the
                // reference it holds, not by the row it happens to have loaded.
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { data, ...rest } = obj;
                return rest;
            }

            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(obj)) {
                result[k] = this.normalizeForComparison(v);
            }
            return result;
        }

        return val;
    }

    /**
     * The address of a row, for matching it against another copy of itself.
     *
     * A row is exactly its columns and carries no address, so it is derived
     * from the key columns the server named — including the ordinary case where
     * that key is `id`, which the server reports like any other.
     *
     * Undefined when there are no keys, which means the server could not
     * resolve any: such rows genuinely cannot be recognised, and guessing at a
     * column called `id` would be inventing an identity for a table that has
     * none.
     */
    private rowAddress(row: Record<string, unknown>, pks: PrimaryKeyInfo[] | undefined): string | undefined {
        if (!pks || pks.length === 0) return undefined;
        const address = buildCompositeId(row, pks);
        if (!address || address.split(COMPOSITE_ID_SEPARATOR).every(part => part === "")) return undefined;
        return address;
    }

    /**
     * Merge incoming rows with cached data, preserving cached references
     * for rows whose values haven't changed. This avoids unnecessary
     * React re-renders when the server refetches all rows but most
     * haven't actually changed.
     */
    private mergeRows(
        cached: Record<string, unknown>[] | undefined,
        incoming: Record<string, unknown>[],
        pks?: PrimaryKeyInfo[]
    ): Record<string, unknown>[] {
        if (!cached || cached.length === 0) return incoming;

        // Build a lookup from cached rows by address for O(1) access
        const cachedById = new Map<string, Record<string, unknown>>();
        for (const row of cached) {
            const address = this.rowAddress(row, pks);
            if (address !== undefined) cachedById.set(address, row);
        }

        return incoming.map(incomingRow => {
            const address = this.rowAddress(incomingRow, pks);
            const cachedRow = address === undefined ? undefined : cachedById.get(address);
            if (!cachedRow) return incomingRow;

            // Compare flat rows directly (no more path/values nesting)
            const normCached = this.normalizeForComparison(cachedRow) as Record<string, unknown>;
            const normIncoming = this.normalizeForComparison(incomingRow) as Record<string, unknown>;

            if (this.deepEqual(normCached, normIncoming)) {
                return cachedRow;
            } else {
                // Deep debug: Why did it fail?
                const mismatches: Record<string, { cached: unknown, incoming: unknown }> = {};
                const allKeys = new Set([...Object.keys(normCached), ...Object.keys(normIncoming)]);
                for (const key of allKeys) {
                    if (!this.deepEqual(normCached[key], normIncoming[key])) {
                        mismatches[key] = { cached: normCached[key],
incoming: normIncoming[key] };
                    }
                }
                console.debug(`[RebaseWS] Row ${address} refetch mismatch:\n`, JSON.stringify(mismatches, null, 2));
            }
            return incomingRow;
        });
    }

    // Subscription methods
    listenCollection<M extends Record<string, unknown>>(
        props: FetchCollectionProps<M>,
        onUpdate: (rows: Record<string, unknown>[]) => void,
        onError?: (error: Error) => void
    ): () => void {
        // A subscription is the app asking for live data, so this is where the
        // socket is wanted. Called before the dedup check below: joining an
        // existing subscription must still work if the socket has since gone.
        this.ensureConnected();

        const subscriptionKey = this.createCollectionSubscriptionKey(props);
        const callbackId = `callback_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Check if we already have a subscription for these exact parameters
        const existingSubscription = this.collectionSubscriptions.get(subscriptionKey);

        if (existingSubscription) {
            // Reuse existing subscription - just add the new callback
            const callbackMap = existingSubscription.callbacks as Map<string, {
                onUpdate: (rows: Record<string, unknown>[]) => void;
                onError?: (error: Error) => void;
            }>;
            callbackMap.set(callbackId, { onUpdate,
onError });

            // Immediately fire the callback with cached data if available
            if (existingSubscription.latestData !== undefined && existingSubscription.isInitialDataReceived) {
                try {
                    onUpdate(existingSubscription.latestData);
                } catch (error) {
                    console.error("Error in collection subscription callback:", error);
                    if (onError) {
                        onError(error instanceof Error ? error : new Error(String(error)));
                    }
                }
            } else if (!existingSubscription.subscribeInFlight) {
                // Registered but idle: its subscribe never landed (the send failed,
                // or the server answered with an error). Nothing is coming, so
                // re-issue it — otherwise this listener waits forever.
                this.sendCollectionSubscribe(subscriptionKey);
            }

            // Return unsubscribe function
            return () => {
                callbackMap.delete(callbackId);
                if (callbackMap.size === 0) {
                    // Only tear down if this is still the same registration — a
                    // failed subscribe may have replaced it in the meantime.
                    if (this.collectionSubscriptions.get(subscriptionKey) !== existingSubscription) return;
                    if (existingSubscription.subscribeTimeout) clearTimeout(existingSubscription.subscribeTimeout);
                    this.collectionSubscriptions.delete(subscriptionKey);
                    this.backendToCollectionKey.delete(existingSubscription.backendSubscriptionId);
                    if (this.isConnected && this.ws) {
                        this.sendMessage({
                            type: "unsubscribe",
                            payload: { subscriptionId: existingSubscription.backendSubscriptionId }
                        }).catch(console.error);
                    }
                }
            };
        }

        // Create new subscription
        const backendSubscriptionId = `collection_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const callbackMap = new Map<string, {
            onUpdate: (rows: Record<string, unknown>[]) => void;
            onError?: (error: Error) => void;
        }>();
        callbackMap.set(callbackId, { onUpdate,
onError });

        this.collectionSubscriptions.set(subscriptionKey, {
            backendSubscriptionId,
            callbacks: callbackMap,
            props
        });

        // Add reverse lookup
        this.backendToCollectionKey.set(backendSubscriptionId, subscriptionKey);

        // Send subscription request to backend. A failure here drops the
        // registration and notifies every listener, so the next mount retries.
        this.sendCollectionSubscribe(subscriptionKey);

        // Return unsubscribe function
        return () => {
            const subscription = this.collectionSubscriptions.get(subscriptionKey);
            if (subscription) {
                const callbacks = subscription.callbacks;
                callbacks.delete(callbackId);
                if (callbacks.size === 0) {
                    if (subscription.subscribeTimeout) clearTimeout(subscription.subscribeTimeout);
                    this.collectionSubscriptions.delete(subscriptionKey);
                    this.backendToCollectionKey.delete(subscription.backendSubscriptionId);
                    if (this.isConnected && this.ws) {
                        this.sendMessage({
                            type: "unsubscribe",
                            payload: { subscriptionId: subscription.backendSubscriptionId }
                        }).catch(console.error);
                    }
                }
            }
        };
    }

    listenOne<M extends Record<string, unknown>>(
        props: FetchOneProps<M>,
        onUpdate: (row: Record<string, unknown> | null) => void,
        onError?: (error: Error) => void
    ): () => void {
        this.ensureConnected();

        const subscriptionKey = this.createSingleSubscriptionKey(props);
        const callbackId = `callback_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Check if we already have a subscription for these exact parameters
        const existingSubscription = this.singleSubscriptions.get(subscriptionKey);

        if (existingSubscription) {
            // Reuse existing subscription - just add the new callback
            const callbackMap = existingSubscription.callbacks as Map<string, {
                onUpdate: (row: Record<string, unknown> | null) => void;
                onError?: (error: Error) => void;
            }>;
            callbackMap.set(callbackId, { onUpdate,
onError });

            // Immediately fire the callback with cached data if available
            if (existingSubscription.latestData !== undefined && existingSubscription.isInitialDataReceived) {
                try {
                    onUpdate(existingSubscription.latestData);
                } catch (error) {
                    console.error("Error in row subscription callback:", error);
                    if (onError) {
                        onError(error instanceof Error ? error : new Error(String(error)));
                    }
                }
            } else if (!existingSubscription.subscribeInFlight) {
                // See listenCollection: a registration with nothing in flight is
                // dead, and attaching to it silently would hang this listener.
                this.sendEntitySubscribe(subscriptionKey);
            }

            // Return unsubscribe function
            return () => {
                callbackMap.delete(callbackId);
                if (callbackMap.size === 0) {
                    if (this.singleSubscriptions.get(subscriptionKey) !== existingSubscription) return;
                    if (existingSubscription.subscribeTimeout) clearTimeout(existingSubscription.subscribeTimeout);
                    // No more callbacks, unsubscribe from backend
                    this.singleSubscriptions.delete(subscriptionKey);
                    this.backendToEntityKey.delete(existingSubscription.backendSubscriptionId);
                    if (this.isConnected && this.ws) {
                        this.sendMessage({
                            type: "unsubscribe",
                            payload: { subscriptionId: existingSubscription.backendSubscriptionId }
                        }).catch(console.error);
                    }
                }
            };
        }

        // Create new subscription
        const backendSubscriptionId = `entity_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const callbackMap = new Map<string, {
            onUpdate: (row: Record<string, unknown> | null) => void;
            onError?: (error: Error) => void;
        }>();
        callbackMap.set(callbackId, { onUpdate,
onError });

        this.singleSubscriptions.set(subscriptionKey, {
            backendSubscriptionId,
            callbacks: callbackMap,
            props
        });

        // Add reverse lookup
        this.backendToEntityKey.set(backendSubscriptionId, subscriptionKey);

        // Send subscription request to backend
        this.sendEntitySubscribe(subscriptionKey);

        // Return unsubscribe function
        return () => {
            const subscription = this.singleSubscriptions.get(subscriptionKey);
            if (subscription) {
                const callbacks = subscription.callbacks;
                callbacks.delete(callbackId);
                if (callbacks.size === 0) {
                    this.singleSubscriptions.delete(subscriptionKey);
                    this.backendToEntityKey.delete(subscription.backendSubscriptionId);
                    if (this.isConnected && this.ws) {
                        this.sendMessage({
                            type: "unsubscribe",
                            payload: { subscriptionId: subscription.backendSubscriptionId }
                        }).catch(console.error);
                    }
                }
            }
        };
    }

    /**
     * Send a `subscribe_collection` for an already-registered subscription and
     * arm its watchdog.
     *
     * Every path that registers a collection subscription goes through here, so
     * that a subscribe which never lands — a rejected send, or a server that
     * never answers — always ends up in `failCollectionSubscription` rather than
     * leaving the entry parked with `isInitialDataReceived === false` forever.
     */
    private sendCollectionSubscribe(subscriptionKey: string): void {
        const subscription = this.collectionSubscriptions.get(subscriptionKey);
        if (!subscription) return;

        const backendSubscriptionId = subscription.backendSubscriptionId;
        subscription.subscribeInFlight = true;

        if (subscription.subscribeTimeout) clearTimeout(subscription.subscribeTimeout);
        subscription.subscribeTimeout = undefined;
        // Only time out a frame that is actually on the wire. While offline the
        // message just sits in the queue, and reconnect backoff can exceed the
        // timeout — `armPendingSubscribeWatchdogs` picks these up on connect.
        if (this.isConnected) this.sendCollectionSubscribeWatchdog(subscriptionKey);

        this.sendMessage({
            type: "subscribe_collection",
            payload: {
                ...subscription.props,
                subscriptionId: backendSubscriptionId
            }
        }).catch(error => {
            const current = this.collectionSubscriptions.get(subscriptionKey);
            if (!current || current.backendSubscriptionId !== backendSubscriptionId) return;
            this.failCollectionSubscription(
                subscriptionKey,
                error instanceof Error ? error : new Error(String(error))
            );
        });
    }

    /** The `listenOne` counterpart of {@link sendCollectionSubscribe}. */
    private sendEntitySubscribe(subscriptionKey: string): void {
        const subscription = this.singleSubscriptions.get(subscriptionKey);
        if (!subscription) return;

        const backendSubscriptionId = subscription.backendSubscriptionId;
        subscription.subscribeInFlight = true;

        if (subscription.subscribeTimeout) clearTimeout(subscription.subscribeTimeout);
        subscription.subscribeTimeout = undefined;
        if (this.isConnected) this.sendEntitySubscribeWatchdog(subscriptionKey);

        this.sendMessage({
            type: "subscribe_one",
            payload: {
                ...subscription.props,
                subscriptionId: backendSubscriptionId
            }
        }).catch(error => {
            const current = this.singleSubscriptions.get(subscriptionKey);
            if (!current || current.backendSubscriptionId !== backendSubscriptionId) return;
            this.failEntitySubscription(
                subscriptionKey,
                error instanceof Error ? error : new Error(String(error))
            );
        });
    }

    /**
     * Report a subscribe failure to every listener and drop the registration.
     *
     * Dropping it is the point: the callbacks stay live (their components are
     * still mounted and have been told), but the next `listenCollection` for
     * these params finds no entry and issues a fresh subscribe instead of
     * silently attaching to a dead one.
     */
    private failCollectionSubscription(subscriptionKey: string, error: Error): void {
        const subscription = this.collectionSubscriptions.get(subscriptionKey);
        if (!subscription) return;

        if (subscription.subscribeTimeout) clearTimeout(subscription.subscribeTimeout);
        subscription.subscribeInFlight = false;

        this.collectionSubscriptions.delete(subscriptionKey);
        this.backendToCollectionKey.delete(subscription.backendSubscriptionId);

        subscription.callbacks.forEach(callback => {
            if (callback.onError) {
                try {
                    callback.onError(error);
                } catch (callbackError) {
                    console.error("Error in collection subscription error callback:", callbackError);
                }
            }
        });
    }

    /** The `listenOne` counterpart of {@link failCollectionSubscription}. */
    private failEntitySubscription(subscriptionKey: string, error: Error): void {
        const subscription = this.singleSubscriptions.get(subscriptionKey);
        if (!subscription) return;

        if (subscription.subscribeTimeout) clearTimeout(subscription.subscribeTimeout);
        subscription.subscribeInFlight = false;

        this.singleSubscriptions.delete(subscriptionKey);
        this.backendToEntityKey.delete(subscription.backendSubscriptionId);

        subscription.callbacks.forEach(callback => {
            if (callback.onError) {
                try {
                    callback.onError(error);
                } catch (callbackError) {
                    console.error("Error in row subscription error callback:", callbackError);
                }
            }
        });
    }

    /**
     * Stop the watchdogs without failing anything — used when the socket drops,
     * since the reconnect path re-subscribes everything anyway and a watchdog
     * firing mid-reconnect would tear down healthy subscriptions.
     */
    private suspendSubscribeWatchdogs(): void {
        for (const sub of this.collectionSubscriptions.values()) {
            if (sub.subscribeTimeout) clearTimeout(sub.subscribeTimeout);
            sub.subscribeTimeout = undefined;
            sub.subscribeInFlight = false;
        }
        for (const sub of this.singleSubscriptions.values()) {
            if (sub.subscribeTimeout) clearTimeout(sub.subscribeTimeout);
            sub.subscribeTimeout = undefined;
            sub.subscribeInFlight = false;
        }
    }

    /**
     * Arm watchdogs for subscribes that were requested while offline and have
     * just been flushed to the socket. Their timers were deliberately not set at
     * request time, so without this they would have no timeout at all.
     */
    private armPendingSubscribeWatchdogs(): void {
        for (const [key, sub] of this.collectionSubscriptions.entries()) {
            if (sub.subscribeInFlight && !sub.subscribeTimeout) this.sendCollectionSubscribeWatchdog(key);
        }
        for (const [key, sub] of this.singleSubscriptions.entries()) {
            if (sub.subscribeInFlight && !sub.subscribeTimeout) this.sendEntitySubscribeWatchdog(key);
        }
    }

    private sendCollectionSubscribeWatchdog(subscriptionKey: string): void {
        const subscription = this.collectionSubscriptions.get(subscriptionKey);
        if (!subscription) return;
        const backendSubscriptionId = subscription.backendSubscriptionId;
        subscription.subscribeTimeout = setTimeout(() => {
            const current = this.collectionSubscriptions.get(subscriptionKey);
            if (!current || current.backendSubscriptionId !== backendSubscriptionId) return;
            if (!current.subscribeInFlight) return;
            this.failCollectionSubscription(
                subscriptionKey,
                new RebaseApiError("Subscription timed out", { code: "SUBSCRIPTION_TIMEOUT" })
            );
        }, this.subscriptionTimeoutMs);
    }

    private sendEntitySubscribeWatchdog(subscriptionKey: string): void {
        const subscription = this.singleSubscriptions.get(subscriptionKey);
        if (!subscription) return;
        const backendSubscriptionId = subscription.backendSubscriptionId;
        subscription.subscribeTimeout = setTimeout(() => {
            const current = this.singleSubscriptions.get(subscriptionKey);
            if (!current || current.backendSubscriptionId !== backendSubscriptionId) return;
            if (!current.subscribeInFlight) return;
            this.failEntitySubscription(
                subscriptionKey,
                new RebaseApiError("Subscription timed out", { code: "SUBSCRIPTION_TIMEOUT" })
            );
        }, this.subscriptionTimeoutMs);
    }

    /**
     * Fail every subscription that never received data. Called when reconnection
     * is given up on, so views surface an error instead of spinning forever.
     */
    private failAllPendingSubscriptions(error: Error): void {
        for (const key of [...this.collectionSubscriptions.keys()]) {
            const sub = this.collectionSubscriptions.get(key);
            if (sub && !sub.isInitialDataReceived) this.failCollectionSubscription(key, error);
        }
        for (const key of [...this.singleSubscriptions.keys()]) {
            const sub = this.singleSubscriptions.get(key);
            if (sub && !sub.isInitialDataReceived) this.failEntitySubscription(key, error);
        }
    }

    /**
     * Re-send all active subscriptions to the backend after a reconnect.
     * The server wipes subscription state when a client disconnects, so
     * we need to re-register everything to resume receiving updates.
     */
    private resubscribeAll(): void {
        console.debug(`[WS] Re-subscribing: ${this.collectionSubscriptions.size} collection(s), ${this.singleSubscriptions.size} row(ies)`);

        // Re-subscribe collection subscriptions
        for (const [key, sub] of this.collectionSubscriptions.entries()) {
            // Generate a fresh backend ID since the old one is no longer valid on the server
            const oldBackendId = sub.backendSubscriptionId;
            const newBackendId = `collection_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            sub.backendSubscriptionId = newBackendId;

            // Update reverse lookup
            this.backendToCollectionKey.delete(oldBackendId);
            this.backendToCollectionKey.set(newBackendId, key);

            this.sendCollectionSubscribe(key);
        }

        // Re-subscribe row subscriptions
        for (const [key, sub] of this.singleSubscriptions.entries()) {
            const oldBackendId = sub.backendSubscriptionId;
            const newBackendId = `entity_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            sub.backendSubscriptionId = newBackendId;

            this.backendToEntityKey.delete(oldBackendId);
            this.backendToEntityKey.set(newBackendId, key);

            this.sendEntitySubscribe(key);
        }
    }

    private createCollectionSubscriptionKey(props: FetchCollectionProps): string {
        // Derived from the props, not a hand-listed subset of them.
        //
        // Two subscriptions share one server subscription when their keys
        // match, so a field left off the key makes two different queries
        // collide and hands the second listener the first one's rows. `offset`
        // and `logical` were both missing: page two of a live list showed page
        // one, and two views filtered by different `or(...)` groups saw the
        // same rows. Listing fields by hand is what let that happen, so the key
        // now covers whatever `FetchCollectionProps` carries.
        //
        // `collection` is the exception: it is the whole collection config,
        // property thunks and all, so it contributes its name as before.
        const { collection, ...query } = props as FetchCollectionProps & Record<string, unknown>;
        const key = {
            ...query,
            collection: collection?.name
        };
        // Use replacer function (not array) to sort keys at all levels for deterministic output
        return JSON.stringify(key, (_, value) => {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                return Object.keys(value).sort().reduce((sorted: Record<string, unknown>, k) => {
                    sorted[k] = value[k];
                    return sorted;
                }, {});
            }
            return value;
        });
    }

    private createSingleSubscriptionKey(props: FetchOneProps): string {
        return `${props.path}|${props.id}`;
    }
}
