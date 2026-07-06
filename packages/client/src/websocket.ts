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
    BranchInfo
} from "@rebasepro/types";
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
    return { errorMessage,
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


export class ApiError extends Error {
    public code?: string;
    public error?: string;

    constructor(message: string, error?: string, code?: string) {
        super(message);
        this.name = "ApiError";
        this.code = code;
        this.error = error;
    }
}


export class RebaseWebSocketClient {
    private websocketUrl: string;
    private ws: WebSocket | null = null;
    public getAuthToken?: () => Promise<string | null>;
    private subscriptions = new Map<string, {
        onUpdate: (data: WebSocketMessage) => void,
        onError?: (error: Error) => void
    }>();

    private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

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

        if (!this.WebSocketConstructor) {
            console.warn("WebSocket is not defined in this environment. Realtime subscriptions will not work unless you provide a WebSocket implementation in the config.");
        } else {
            this.initWebSocket();
        }
    }

    /**
     * Authenticate the WebSocket connection
     */
    async authenticate(token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const requestId = `auth_${Date.now()}`;

            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                this.authPromise = null; // Clear promise so we can retry later
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

    public disconnect(): void {
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
            this.ws = new this.WebSocketConstructor(this.websocketUrl);

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
                this.isConnected = false;
                this.isAuthenticated = false;
                this.authPromise = null;
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
                        request.reject(new ApiError("Connection closed", "Connection closed"));
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

                this.sendMessage({
                    type: messageType,
                    payload: {
                        ...subscription.props,
                        subscriptionId: newBackendId
                    }
                }).catch(error => {
                    console.error(`[WS] Failed to re-subscribe ${idPrefix} after auth refresh:`, subscriptionKey, error);
                    subscription.callbacks.forEach(callback => {
                        if (callback.onError) callback.onError(error);
                    });
                });
            } else {
                const { errorMessage, errorCode } = extractMessageError(message);
                const error = new ApiError(errorMessage, errorMessage, errorCode);
                subscription.callbacks.forEach(callback => {
                    if (callback.onError) callback.onError(error);
                });
            }
        }).catch(err => {
            subscription.callbacks.forEach(callback => {
                if (callback.onError) callback.onError(err);
            });
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
                            pendingReq.reject(new ApiError(errorMessage, errorMessage, errorCode));
                        }
                    }).catch(err => {
                        pendingReq.reject(err);
                    });
                } else {
                    this.pendingRequests.delete(requestId);
                    const { errorMessage, errorCode } = extractMessageError(message);
                    pendingReq.reject(new ApiError(errorMessage, errorMessage, errorCode));
                }
            } else {
                this.pendingRequests.delete(requestId);
                pendingReq.resolve(message.payload || message);
            }
            return;
        }

        // Handle subscription updates for collection subscriptions
        if (subscriptionId && type === "collection_update") {
            const subscriptionKey = this.backendToCollectionKey.get(subscriptionId);
            if (subscriptionKey) {
                const collectionSub = this.collectionSubscriptions.get(subscriptionKey);
                if (collectionSub) {
                    const wireEntitys = (message.rows || []) as unknown as Record<string, unknown>[];
                    const incomingRows = wireEntitys;

                    // Structural merge: preserve cached row references for rows
                    // whose values haven't changed. This prevents downstream React components
                    // from re-rendering (VirtualTableCell uses deepEqual on rowData —
                    // same reference = instant true, avoiding expensive deep comparison).
                    const rows = this.mergeRows(collectionSub.latestData, incomingRows);

                    // Cache the latest data with optimizations
                    collectionSub.latestData = rows;
                    collectionSub.lastUpdated = Date.now();
                    collectionSub.isInitialDataReceived = true;

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
                    const patchEntityId = (message as unknown as { id: string }).id;
                    const patchRow = patchWireEntity ? (patchWireEntity as unknown as Record<string, unknown>) : null;
                    let updated: Record<string, unknown>[];

                    if (patchRow === null) {
                        // Row was deleted — remove it from the cached list
                        updated = collectionSub.latestData.filter(e => String(e.id) !== String(patchEntityId));
                    } else {
                        // Row was created or updated — merge into the cached list
                        const idx = collectionSub.latestData.findIndex(e => String(e.id) === String(patchRow.id));
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

                    const { errorMessage, errorCode } = extractMessageError(message);
                    const error = new ApiError(errorMessage, errorMessage, errorCode);
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

                    const { errorMessage, errorCode } = extractMessageError(message);
                    const error = new ApiError(errorMessage, errorMessage, errorCode);
                    entitySub.callbacks.forEach(callback => {
                        if (callback.onError) {
                            callback.onError(error);
                        }
                    });
                    return;
                }
            }
        }

        // Legacy subscription handling (for backward compatibility)
        if (subscriptionId && this.subscriptions.has(subscriptionId)) {
            const callback = this.subscriptions.get(subscriptionId);
            if (!callback) {
                throw new Error(`Subscription callback not found for subscriptionId: ${subscriptionId}`);
            }
            if (message.type === "ERROR" || message.error) {
                if (callback.onError) {
                    const { errorMessage, errorCode } = extractMessageError(message);
                    callback.onError(new ApiError(errorMessage, errorMessage, errorCode));
                }
            } else {
                callback.onUpdate(message);
            }
        }
    }

    private async ensureAuthenticated(retryCount = 3): Promise<void> {
        // If already authenticated or no token getter, skip
        if (this.isAuthenticated || !this.getAuthToken) return;

        // If auth is in progress, wait for it
        if (this.authPromise) {
            await this.authPromise;
            return;
        }

        // Try to authenticate with retries
        let lastError: unknown = null;

        for (let attempt = 0; attempt < retryCount; attempt++) {
            try {
                const token = await this.getAuthToken();
                if (!token) throw new Error("user not logged in");
                this.authPromise = this.authenticate(token);
                await this.authPromise;
                this.authPromise = null;
                console.debug("WebSocket authenticated on demand");
                return; // Success
            } catch (error: unknown) {
                this.authPromise = null;
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

    private sendMessage(message: Record<string, unknown>): Promise<unknown> {
        // If already has a requestId (re-sending from queue), use the stored promise handlers
        const queuedMsg = message as Record<string, unknown> & { _queuedResolve?: (p: unknown) => void; _queuedReject?: (p: Error) => void };
        if (queuedMsg._queuedResolve && queuedMsg._queuedReject) {
            return this.doSendMessage(message, queuedMsg._queuedResolve, queuedMsg._queuedReject);
        }

        if (!this.isConnected || !this.ws) {
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
        // Ensure authenticated before sending non-auth messages
        if (message.type !== "AUTHENTICATE" && this.getAuthToken && !this.isAuthenticated) {
            try {
                await this.ensureAuthenticated();
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : "Authentication required";
                reject(new ApiError(errorMessage, errorMessage));
                return;
            }
        }

        const requestId = (message.requestId as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        message.requestId = requestId;

        const expectsResponse = ![
            "subscribe_collection",
            "subscribe_one",
            "unsubscribe",
            "join_channel",
            "leave_channel",
            "broadcast",
            "presence_track",
            "presence_untrack",
            "presence_state"
        ].includes(message.type as string);

        if (expectsResponse && !this.pendingRequests.has(requestId)) {
            const timeoutHandle = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    reject(new ApiError("Request timed out", "Request timed out"));
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
            reject(new ApiError("Failed to send message", error instanceof Error ? error.message : "Unknown error"));
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
     * Merge incoming rows with cached data, preserving cached references
     * for rows whose values haven't changed. This avoids unnecessary
     * React re-renders when the server refetches all rows but most
     * haven't actually changed.
     */
    private mergeRows(cached: Record<string, unknown>[] | undefined, incoming: Record<string, unknown>[]): Record<string, unknown>[] {
        if (!cached || cached.length === 0) return incoming;

        // Build a lookup from cached rows by ID for O(1) access
        const cachedById = new Map<string | number, Record<string, unknown>>();
        for (const row of cached) {
            cachedById.set(row.id as string | number, row);
        }

        return incoming.map(incomingRow => {
            const cachedRow = cachedById.get(incomingRow.id as string | number);
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
                console.debug(`[RebaseWS] Row ${incomingRow.id} refetch mismatch:\n`, JSON.stringify(mismatches, null, 2));
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
            }

            // Return unsubscribe function
            return () => {
                callbackMap.delete(callbackId);
                if (callbackMap.size === 0) {
                    // No more callbacks, unsubscribe from backend
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

        // Send subscription request to backend
        this.sendMessage({
            type: "subscribe_collection",
            payload: {
                ...props,
                subscriptionId: backendSubscriptionId
            }
        }).catch(error => {
            if (onError) onError(error);
        });

        // Return unsubscribe function
        return () => {
            const subscription = this.collectionSubscriptions.get(subscriptionKey);
            if (subscription) {
                const callbacks = subscription.callbacks;
                callbacks.delete(callbackId);
                if (callbacks.size === 0) {
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
            }

            // Return unsubscribe function
            return () => {
                callbackMap.delete(callbackId);
                if (callbackMap.size === 0) {
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
        this.sendMessage({
            type: "subscribe_one",
            payload: {
                ...props,
                subscriptionId: backendSubscriptionId
            }
        }).catch(error => {
            if (onError) onError(error);
        });

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

            this.sendMessage({
                type: "subscribe_collection",
                payload: {
                    ...sub.props,
                    subscriptionId: newBackendId
                }
            }).catch(error => {
                console.error("[WS] Failed to re-subscribe collection:", key, error);
            });
        }

        // Re-subscribe row subscriptions
        for (const [key, sub] of this.singleSubscriptions.entries()) {
            const oldBackendId = sub.backendSubscriptionId;
            const newBackendId = `entity_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            sub.backendSubscriptionId = newBackendId;

            this.backendToEntityKey.delete(oldBackendId);
            this.backendToEntityKey.set(newBackendId, key);

            this.sendMessage({
                type: "subscribe_one",
                payload: {
                    ...sub.props,
                    subscriptionId: newBackendId
                }
            }).catch(error => {
                console.error("[WS] Failed to re-subscribe row:", key, error);
            });
        }
    }

    private createCollectionSubscriptionKey(props: FetchCollectionProps): string {
        // Create a deterministic key based on subscription parameters
        const key = {
            path: props.path,
            filter: props.filter,
            limit: props.limit,
            startAfter: props.startAfter,
            orderBy: props.orderBy,
            order: props.order,
            searchString: props.searchString,
            collection: props.collection?.name
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
