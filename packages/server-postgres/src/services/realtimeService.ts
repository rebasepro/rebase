import { WebSocket } from "ws";
import { EventEmitter } from "events";
import { Client as PgClient } from "pg";
import { randomUUID } from "crypto";
import { DataService } from "./dataService";

import { FetchCollectionProps, ListenCollectionProps, ListenOneProps, DataDriver, CollectionUpdateMessage, SingleUpdateMessage, CollectionPatchMessage, WebSocketMessage, FilterValues, CollectionConfig, RebaseCallContext } from "@rebasepro/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { RealtimeProvider, CollectionSubscriptionConfig, SingleSubscriptionConfig } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { buildPropertyCallbacks, getTableName } from "@rebasepro/common";
import { applyAuthContext } from "../security/rls-enforcement";
import { logger } from "@rebasepro/server";
import { sanitizeErrorForClient } from "../utils/pg-error-utils";
import { CdcListener, type CdcChangeEvent } from "./cdc/CdcListener";
import { deriveRowAddress, getPrimaryKeys, type PrimaryKeyInfo } from "./collection-helpers";

/** Channel name used for Postgres LISTEN/NOTIFY cross-instance realtime. */
const PG_NOTIFY_CHANNEL = "rebase_entity_changes";

/**
 * Auth context stored per-subscription so real-time refetches respect RLS.
 * Mirrors the session variables set by PostgresBackendDriver.withAuth().
 */
export interface SubscriptionAuthContext {
    uid: string;
    roles: string[];
}

interface DataDriverWithData extends DataDriver {
    data: unknown;
}

type RealTimeListenCollectionProps = ListenCollectionProps & {
    subscriptionId: string
};

type RealTimeListenEntityProps = ListenOneProps & { subscriptionId: string };

/**
 * PostgreSQL-specific realtime service.
 * Handles WebSocket connections and subscriptions for real-time row updates.
 *
 * Implements the RealtimeProvider interface for database abstraction.
 */
export class RealtimeService extends EventEmitter implements RealtimeProvider {
    private clients = new Map<string, WebSocket>();

    // Broadcast channels: channel name → set of client IDs
    private channels = new Map<string, Set<string>>();

    // Presence: channel → Map<clientId, { state, lastSeen }>
    private presence = new Map<string, Map<string, { state: Record<string, unknown>; lastSeen: number }>>();
    private presenceInterval?: ReturnType<typeof setInterval>;
    private static readonly PRESENCE_TIMEOUT_MS = 30000; // 30s
    private dataService: DataService;
    // Enhanced subscriptions storage with full request parameters
    private _subscriptions = new Map<string, {
        clientId: string;
        type: "collection" | "single";
        path: string;
        id?: string | number;
        // Store full collection request parameters for proper refetching
        collectionRequest?: {
            filter?: Record<string, unknown>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            databaseId?: string;
            searchString?: string;
        };
        // Auth context for RLS — when set, refetches run in a transaction
        // with set_config('app.user_id', ...) / set_config('app.user_roles', ...)
        authContext?: SubscriptionAuthContext;
    }>();

    // Add callback storage for DataDriver subscriptions
    private subscriptionCallbacks = new Map<string, (data: Record<string, unknown>[] | Record<string, unknown> | null) => void>();

    private driver?: DataDriver;

    // ── Cross-instance LISTEN/NOTIFY ──
    /** Unique identifier for this process instance, used to skip own notifications. */
    private readonly instanceId = `inst_${randomUUID().slice(0, 8)}`;
    /** Dedicated pg.Client for LISTEN (outside the Drizzle pool). */
    private listenClient?: PgClient;
    /** Connection string used for reconnecting the LISTEN client. */
    private listenConnectionString?: string;
    /** Whether cross-instance broadcasting is active. */
    private broadcasting = false;
    /** Reconnection timer handle. */
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    /** Debounce timers for collection refetches to prevent refetch storms. */
    private refetchTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /** Debounce window (ms) for coalescing rapid row updates into a single correctness refetch. */
    private static readonly REFETCH_DEBOUNCE_MS = 300;

    // ── Database-level Change Data Capture (CDC) ──
    /** Dedicated LISTEN client for DB-level change events (undefined unless CDC is enabled). */
    private cdcListener?: CdcListener;
    /** Whether database-level CDC is the active cross-instance change source. */
    private cdcActive = false;
    /** Reverse lookup: `schema.table` (and bare `table`) → collection, built when CDC starts. */
    private cdcTableMap?: Map<string, CollectionConfig>;
    /**
     * Short-lived record of `path/id` keys this instance just fanned out via the
     * app path (a Rebase-API mutation). When CDC echoes the same committed change
     * back to *this* instance, we suppress the duplicate — the change was already
     * delivered locally. Other instances have no such record, so they still
     * deliver the CDC event. External writes (psql, cron, SQL editor) never match
     * and always flow through. Keyed → expiry timestamp (ms).
     */
    private recentAppEmits = new Map<string, number>();
    /** How long an app-emit key suppresses its own CDC echo. Covers NOTIFY round-trip latency. */
    private static readonly CDC_DEDUP_WINDOW_MS = 5000;

    constructor(private db: NodePgDatabase<any>, private registry: PostgresCollectionRegistry) {
        super();
        this.dataService = new DataService(db, registry);
    }

    /**
     * Restricted role that auth-scoped refetches run as (via `SET LOCAL ROLE`)
     * so RLS `select` policies bind. Set by the bootstrapper alongside
     * `PostgresBackendDriver.rlsUserRole`; undefined when the connection
     * is already subject to RLS natively. Without this, realtime refetches
     * would leak rows the initial (isolated) fetch correctly hid.
     */
    public rlsUserRole?: string;

    /** Whether to emit verbose debug logs (disabled in production). */
    private static readonly DEBUG = process.env.NODE_ENV !== "production";
    private debugLog(...args: unknown[]) {
        if (RealtimeService.DEBUG) console.debug(...args);
    }

    setDataDriver(driver: DataDriver) {
        this.driver = driver;
    }

    // Make subscriptions accessible for DataDriver
    get subscriptions() {
        return this._subscriptions;
    }

    // Add public method to register DataDriver subscriptions
    registerDataDriverSubscription(subscriptionId: string, subscription: {
        clientId: string;
        type: "collection" | "single";
        path: string;
        id?: string | number;
        collectionRequest?: {
            filter?: Record<string, unknown>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            databaseId?: string;
            searchString?: string;
        };
        authContext?: SubscriptionAuthContext;
    }) {
        this.debugLog("📋 [RealtimeService] Registering DataDriver subscription:", subscriptionId, subscription.authContext ? "(with auth)" : "(no auth)");
        this._subscriptions.set(subscriptionId, subscription);
    }

    // Add callback management methods
    addSubscriptionCallback(subscriptionId: string, callback: (data: Record<string, unknown>[] | Record<string, unknown> | null) => void) {
        this.debugLog("📋 [RealtimeService] Adding callback for subscription:", subscriptionId);
        this.subscriptionCallbacks.set(subscriptionId, callback);
    }

    removeSubscriptionCallback(subscriptionId: string) {
        this.debugLog("📋 [RealtimeService] Removing callback for subscription:", subscriptionId);
        this.subscriptionCallbacks.delete(subscriptionId);
    }

    // =============================================================================
    // RealtimeProvider Interface Methods
    // =============================================================================

    /**
     * Subscribe to collection changes (RealtimeProvider interface)
     */
    subscribeToCollection(
        subscriptionId: string,
        config: CollectionSubscriptionConfig,
        callback?: (rows: Record<string, unknown>[]) => void
    ): void {
        this._subscriptions.set(subscriptionId, {
            clientId: config.clientId,
            type: "collection",
            path: config.path,
            collectionRequest: {
                filter: config.filter as Record<string, unknown> | undefined,
                orderBy: config.orderBy,
                order: config.order,
                limit: config.limit,
                startAfter: config.startAfter as Record<string, unknown> | undefined,
                databaseId: config.databaseId,
                searchString: config.searchString
            }
        });

        if (callback) {
            this.subscriptionCallbacks.set(subscriptionId, callback as (data: Record<string, unknown>[] | Record<string, unknown> | null) => void);
        }
    }

    /**
     * Subscribe to single row changes (RealtimeProvider interface)
     */
    subscribeToOne(
        subscriptionId: string,
        config: SingleSubscriptionConfig,
        callback?: (row: Record<string, unknown> | null) => void
    ): void {
        this._subscriptions.set(subscriptionId, {
            clientId: config.clientId,
            type: "single",
            path: config.path,
            id: config.id
        });

        if (callback) {
            this.subscriptionCallbacks.set(subscriptionId, callback as (data: Record<string, unknown>[] | Record<string, unknown> | null) => void);
        }
    }

    /**
     * Unsubscribe from a subscription (RealtimeProvider interface)
     */
    unsubscribe(subscriptionId: string): void {
        this._subscriptions.delete(subscriptionId);
        this.subscriptionCallbacks.delete(subscriptionId);
    }

    // =============================================================================
    // WebSocket Client Management
    // =============================================================================

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

    // Public method to handle messages from external sources (like main WebSocket handler)
    async handleClientMessage(clientId: string, message: WebSocketMessage, authContext?: SubscriptionAuthContext) {
        await this.handleMessage(clientId, message, authContext);
    }

    async removeClient(clientId: string) {
        this.clients.delete(clientId);

        // Remove all subscriptions, callbacks, and pending refetch timers for this client
        for (const [subscriptionId, subscription] of this._subscriptions.entries()) {
            if (subscription.clientId === clientId) {
                this._subscriptions.delete(subscriptionId);
                this.subscriptionCallbacks.delete(subscriptionId);

                // Cancel any pending debounced refetch timers
                for (const prefix of ["ws_", "drv_", "wse_", "drve_"]) {
                    const key = `${prefix}${subscriptionId}`;
                    const timer = this.refetchTimers.get(key);
                    if (timer) { clearTimeout(timer); this.refetchTimers.delete(key); }
                }
            }
        }

        // Remove from all broadcast channels
        for (const [channel, members] of this.channels.entries()) {
            if (members.has(clientId)) {
                members.delete(clientId);
                this.removePresence(clientId, channel);
                if (members.size === 0) this.channels.delete(channel);
            }
        }

        // Remove from all presence channels
        for (const [channel] of this.presence) {
            this.removePresence(clientId, channel);
        }
    }

    private async handleMessage(clientId: string, message: WebSocketMessage, authContext?: SubscriptionAuthContext) {
        const payload = message.payload as Record<string, unknown> | undefined;
        switch (message.type) {
            case "subscribe_collection":
                await this.handleCollectionSubscription(clientId, message.payload as RealTimeListenCollectionProps, authContext);
                break;
            case "subscribe_one":
                await this.handleEntitySubscription(clientId, message.payload as RealTimeListenEntityProps, authContext);
                break;
            case "unsubscribe":
                await this.handleUnsubscribe(clientId, message.subscriptionId!);
                break;

            // ── Broadcast Channels ──
            case "join_channel":
                this.joinChannel(clientId, payload?.channel as string);
                break;
            case "leave_channel":
                this.leaveChannel(clientId, payload?.channel as string);
                break;
            case "broadcast":
                this.broadcastToChannel(
                    clientId,
                    payload?.channel as string,
                    payload?.event as string,
                    payload?.payload
                );
                break;

            // ── Presence ──
            case "presence_track":
                // Auto-join the channel so presence works without a separate join
                this.joinChannel(clientId, payload?.channel as string);
                this.trackPresence(
                    clientId,
                    payload?.channel as string,
                    payload?.state as Record<string, unknown> ?? {}
                );
                break;
            case "presence_untrack":
                this.removePresence(clientId, payload?.channel as string);
                break;
            case "presence_state":
                this.sendPresenceState(clientId, payload?.channel as string);
                break;

            default:
                this.sendError(clientId, "Unknown message type " + message.type, message.subscriptionId);
        }
    }

    private async handleCollectionSubscription(clientId: string, request: RealTimeListenCollectionProps, authContext?: SubscriptionAuthContext) {
        const subscriptionId = request.subscriptionId;

        try {
            // Early validation: ensure the requested collection exists in the registry
            const collection = this.registry.getCollectionByPath(request.path);
            if (!collection) {
                const registered = this.registry.getCollections().map(c => c.slug).join(", ");
                const msg = `Collection not found: '${request.path}'. Registered: [${registered}]`;
                logger.error(`[RealtimeService] ${msg}`);
                this.sendError(clientId, msg, subscriptionId);
                return;
            }

            // Store subscription with full request parameters and auth context for RLS
            this._subscriptions.set(subscriptionId, {
                clientId,
                type: "collection",
                path: request.path,
                collectionRequest: {
                    filter: request.filter,
                    orderBy: request.orderBy,
                    order: request.order,
                    limit: request.limit,
                    startAfter: request.startAfter as Record<string, unknown> | undefined,
                    databaseId: request.collection?.databaseId,
                    searchString: request.searchString
                },
                authContext
            });

            // Send initial data
            const rows = await this.fetchCollectionWithAuth(
                request.path,
                {
                    filter: request.filter,
                    orderBy: request.orderBy,
                    order: request.order,
                    limit: request.limit,
                    startAfter: request.startAfter as Record<string, unknown> | undefined,
                    searchString: request.searchString
                },
                authContext
            );

            this.sendCollectionUpdate(clientId, subscriptionId, rows, request.path);

        } catch (error) {
            const sanitized = sanitizeErrorForClient(error, request.path);
            this.sendError(clientId, sanitized.message, subscriptionId, sanitized.code);
        }
    }

    private async handleEntitySubscription(clientId: string, request: RealTimeListenEntityProps, authContext?: SubscriptionAuthContext) {
        const subscriptionId = request.subscriptionId;

        try {
            // Early validation: ensure the requested collection exists in the registry
            const collection = this.registry.getCollectionByPath(request.path);
            if (!collection) {
                const registered = this.registry.getCollections().map(c => c.slug).join(", ");
                const msg = `Collection not found: '${request.path}'. Registered: [${registered}]`;
                logger.error(`[RealtimeService] ${msg}`);
                this.sendError(clientId, msg, subscriptionId);
                return;
            }

            // Store subscription in memory with auth context for RLS
            this._subscriptions.set(subscriptionId, {
                clientId,
                type: "single",
                path: request.path,
                id: request.id,
                authContext
            });

            // Send initial data
            const row = await this.fetchEntityWithAuth(
                request.path,
                String(request.id),
                authContext
            );

            this.sendSingleUpdate(clientId, subscriptionId, row || null);

        } catch (error) {
            const sanitized = sanitizeErrorForClient(error, request.path);
            this.sendError(clientId, sanitized.message, subscriptionId, sanitized.code);
        }
    }

    private async handleUnsubscribe(_clientId: string, subscriptionId: string) {
        this._subscriptions.delete(subscriptionId);
        this.subscriptionCallbacks.delete(subscriptionId);
        // Cancel any pending debounced refetch
        for (const prefix of ["ws_", "drv_", "wse_", "drve_"]) {
            const key = `${prefix}${subscriptionId}`;
            const timer = this.refetchTimers.get(key);
            if (timer) { clearTimeout(timer); this.refetchTimers.delete(key); }
        }
    }

    /**
     * Enhanced notification method that handles nested relation updates.
     * @param broadcast When true (default), also sends a pg_notify so other instances
     *                  pick up the change. Set to false when handling an incoming
     *                  cross-instance notification to avoid infinite loops.
     * @param origin `"app"` (default) — a Rebase-API mutation on this instance;
     *               `"cdc"` — a database-level change observed via CDC (any writer,
     *               any instance). The origin drives de-duplication: an app emit
     *               records the change so this instance can suppress the matching
     *               CDC echo, while an unmatched CDC event is delivered normally.
     */
    async notifyUpdate(path: string, id: string, row: Record<string, unknown> | null, databaseId?: string, broadcast = true, origin: "app" | "cdc" = "app") {
        this.debugLog("🔔 [RealtimeService] notifyUpdate called for path:", path, "id:", id, "isDelete:", row === null, "origin:", origin);

        // De-duplicate against database-level CDC. The app path (a mutation made
        // through the Rebase API) fans out locally AND, once CDC is active, the
        // same committed change is echoed back to this instance via the WAL /
        // trigger stream. Record app emits so we can drop that echo here; deliver
        // any CDC event we did not originate (external writes, other instances).
        if (this.cdcActive) {
            const key = this.dedupKey(path, id, databaseId);
            if (origin === "cdc") {
                if (this.consumeAppEmit(key)) {
                    this.debugLog("🔁 [RealtimeService] Suppressing CDC echo of local app mutation:", key);
                    return;
                }
            } else {
                this.markAppEmit(key);
            }
        }

        // Get all paths that need to be notified - the direct path plus any parent paths
        const pathsToNotify = [path];

        // If this is a nested relation path (like "posts/70/tags"), also notify parent paths
        if (path.includes("/") && path.split("/").length > 1) {
            const parentPaths = this.getParentPaths(path);
            pathsToNotify.push(...parentPaths);
            this.debugLog(`🔗 [RealtimeService] Nested path detected. Will notify paths: ${pathsToNotify.join(", ")}`);
        }

        // Process each path that needs notification
        for (const notifyPath of pathsToNotify) {
            await this.notifyPathUpdate(notifyPath, path, id, row, databaseId);
        }

        // Broadcast to other instances via pg_notify (only for local mutations).
        // When CDC is active it IS the cross-instance channel — every instance
        // observes every commit through the change stream — so the legacy
        // per-mutation broadcast is redundant (and would double-deliver). Skip it.
        if (broadcast && this.broadcasting && !this.cdcActive) {
            try {
                await this.broadcastChange(path, id, databaseId);
            } catch (err) {
                logger.error("❌ [RealtimeService] Failed to broadcast change via pg_notify", { error: err });
            }
        }

        this.debugLog("🔔 [RealtimeService] notifyUpdate completed for path:", path);
    }

    /**
     * Notify subscriptions for a specific path
     */
    private async notifyPathUpdate(notifyPath: string, originalPath: string, id: string, row: Record<string, unknown> | null, _databaseId?: string) {
        this.debugLog(`📡 [RealtimeService] Notifying path: ${notifyPath} (original: ${originalPath})`);

        // Find all relevant subscriptions for this specific path
        const allSubscriptions = Array.from(this._subscriptions.entries()).filter(([, sub]) => {
            const isPathMatch = sub.path === notifyPath;

            // For row subscriptions, check if the id matches (only for exact path matches)
            if (sub.type === "single") {
                return isPathMatch && (notifyPath === originalPath ? sub.id === id : true);
            }
            // For collection subscriptions, it's always relevant if the path matches
            if (sub.type === "collection") {
                return isPathMatch;
            }
            return false;
        });

        this.debugLog(`📡 [RealtimeService] Found ${allSubscriptions.length} subscriptions for path: ${notifyPath}`);

        // Separate WebSocket subscriptions from DataDriver callback subscriptions
        const webSocketSubscriptions = allSubscriptions.filter(([, sub]) =>
            sub.clientId !== "driver" && this.clients.has(sub.clientId)
        );

        const driverSubscriptions = allSubscriptions.filter(([subscriptionId, sub]) =>
            sub.clientId === "driver" && this.subscriptionCallbacks.has(subscriptionId)
        );

        // Handle WebSocket subscriptions
        for (const [subscriptionId, subscription] of webSocketSubscriptions) {
            try {
                if (subscription.type === "single" && notifyPath === originalPath) {
                    // Send row update directly (only for exact path matches)
                    if (row && (row as Record<string, unknown>)?._rebase_invalidated) {
                        this.debouncedSingleRefetch(subscriptionId, notifyPath, id, subscription);
                    } else {
                        this.sendSingleUpdate(subscription.clientId, subscriptionId, row);
                    }
                } else if (subscription.type === "collection" && subscription.collectionRequest) {
                    // Phase 1: Send instant row-level patch (no DB query)
                    // This gives immediate cross-tab feedback
                    if (!row || !(row as Record<string, unknown>)?._rebase_invalidated) {
                        this.sendCollectionPatch(subscription.clientId, subscriptionId, id, row, notifyPath);
                    }

                    // Phase 2: Schedule a deferred full refetch for correctness
                    // Handles filter/sort changes and ensures consistency
                    this.debouncedCollectionRefetch(subscriptionId, notifyPath, subscription);
                }
            } catch (error) {
                const sanitized = sanitizeErrorForClient(error, notifyPath);
                this.sendError(subscription.clientId, sanitized.message, subscriptionId, sanitized.code);
            }
        }

        // Handle DataDriver callback subscriptions
        for (const [subscriptionId, subscription] of driverSubscriptions) {
            try {
                const callback = this.subscriptionCallbacks.get(subscriptionId);
                if (!callback) continue;

                if (subscription.type === "single" && notifyPath === originalPath) {
                    if (row && (row as Record<string, unknown>)?._rebase_invalidated) {
                        this.debouncedSingleDriverRefetch(subscriptionId, notifyPath, id, subscription, callback);
                    } else {
                        // Call the callback directly with the row (only for exact path matches)
                        callback(row);
                    }
                } else if (subscription.type === "collection" && subscription.collectionRequest) {
                    // Debounce collection refetches for DataDriver subscriptions too
                    this.debouncedDriverRefetch(subscriptionId, notifyPath, subscription, callback);
                }
            } catch (error) {
                logger.error(`❌ [RealtimeService] Error processing DataDriver subscription ${subscriptionId}`, { error: error });
            }
        }
    }

    /**
     * Debounce a collection refetch for a WebSocket subscription.
     * Coalesces rapid row mutations into a single database query.
     */
    private debouncedCollectionRefetch(
        subscriptionId: string,
        notifyPath: string,
        subscription: { clientId: string; collectionRequest?: { filter?: Record<string, unknown>; orderBy?: string; order?: "desc" | "asc"; limit?: number; offset?: number; startAfter?: Record<string, unknown>; databaseId?: string; searchString?: string }; authContext?: SubscriptionAuthContext }
    ) {
        const timerKey = `ws_${subscriptionId}`;
        const existing = this.refetchTimers.get(timerKey);
        if (existing) clearTimeout(existing);

        this.refetchTimers.set(timerKey, setTimeout(async () => {
            this.refetchTimers.delete(timerKey);
            // Verify subscription still exists (client may have disconnected)
            if (!this._subscriptions.has(subscriptionId)) return;
            try {
                const rows = await this.fetchCollectionWithAuth(notifyPath, subscription.collectionRequest!, subscription.authContext);
                this.sendCollectionUpdate(subscription.clientId, subscriptionId, rows, notifyPath);
            } catch (error) {
                const sanitized = sanitizeErrorForClient(error, notifyPath);
                this.sendError(subscription.clientId, sanitized.message, subscriptionId, sanitized.code);
            }
        }, RealtimeService.REFETCH_DEBOUNCE_MS));
    }

    /**
     * Debounce a collection refetch for a DataDriver callback subscription.
     */
    private debouncedDriverRefetch(
        subscriptionId: string,
        notifyPath: string,
        subscription: { collectionRequest?: { filter?: Record<string, unknown>; orderBy?: string; order?: "desc" | "asc"; limit?: number; offset?: number; startAfter?: Record<string, unknown>; databaseId?: string; searchString?: string }; authContext?: SubscriptionAuthContext },
        callback: (data: Record<string, unknown>[] | Record<string, unknown> | null) => void
    ) {
        const timerKey = `drv_${subscriptionId}`;
        const existing = this.refetchTimers.get(timerKey);
        if (existing) clearTimeout(existing);

        this.refetchTimers.set(timerKey, setTimeout(async () => {
            this.refetchTimers.delete(timerKey);
            if (!this._subscriptions.has(subscriptionId)) return;
            try {
                const rows = await this.fetchCollectionWithAuth(notifyPath, subscription.collectionRequest!, subscription.authContext);
                callback(rows);
            } catch (error) {
                logger.error(`❌ [RealtimeService] Error in debounced driver refetch for ${subscriptionId}`, { error: error });
            }
        }, RealtimeService.REFETCH_DEBOUNCE_MS));
    }

    /**
     * Fetch a collection with optional RLS auth context.
     * When authContext is provided, the fetch runs inside a transaction
     * with set_config calls so PostgreSQL RLS policies are enforced.
     */
    private async fetchCollectionWithAuth(
        notifyPath: string,
        collectionRequest: { filter?: Record<string, unknown>; orderBy?: string; order?: "desc" | "asc"; limit?: number; offset?: number; startAfter?: Record<string, unknown>; databaseId?: string; searchString?: string },
        authContext?: SubscriptionAuthContext
    ): Promise<Record<string, unknown>[]> {
        if (this.driver) {
            const collection = this.registry.getCollectionByPath(notifyPath);
            const fetchFn = async () => this.driver!.fetchCollection({
                path: notifyPath,
                collection: collection,
                filter: collectionRequest.filter as FetchCollectionProps["filter"],
                orderBy: collectionRequest.orderBy,
                order: collectionRequest.order,
                limit: collectionRequest.limit,
                offset: collectionRequest.offset,
                startAfter: collectionRequest.startAfter,
                searchString: collectionRequest.searchString
            });

            // Always wrap in a transaction with session vars, defaulting to anonymous context if missing.
            // Refetches are reads: apply the same GUCs + reader-role downgrade as the
            // driver's read path, so realtime cannot leak rows the initial fetch hid.
            const activeAuth = authContext || { uid: "anon",
roles: ["anon"] };
            return await this.db.transaction(async (tx) => {
                await applyAuthContext(tx, { uid: activeAuth.uid, roles: activeAuth.roles }, this.rlsUserRole);
                const txEntityService = new DataService(tx, this.registry);
                let fetchedEntities;
                if (collectionRequest.searchString) {
                    fetchedEntities = await txEntityService.searchRows(
                        notifyPath,
                        collectionRequest.searchString,
                        {
                            filter: collectionRequest.filter as FilterValues<string>,
                            orderBy: collectionRequest.orderBy,
                            order: collectionRequest.order,
                            limit: collectionRequest.limit,
                            databaseId: collectionRequest.databaseId
                        }
                    );
                } else {
                    fetchedEntities = await txEntityService.fetchCollection(notifyPath, {
                        filter: collectionRequest.filter as FilterValues<string>,
                        orderBy: collectionRequest.orderBy,
                        order: collectionRequest.order,
                        limit: collectionRequest.limit,
                        offset: collectionRequest.offset,
                        startAfter: collectionRequest.startAfter,
                        databaseId: collectionRequest.databaseId
                    });
                }

                // Re-apply `afterRead` lifecycle hooks to ensure consistent data structures
                // between the initial driver fetch and this RLS-bound refetch.
                const registryCollection = this.registry.getCollectionByPath(notifyPath);
                const resolvedCollection = collection ? { ...collection,
...registryCollection } as CollectionConfig : registryCollection as CollectionConfig;

                const callbacks = resolvedCollection?.callbacks;
                const globalCallbacks = this.registry?.getGlobalCallbacks();
                const propertyCallbacks = resolvedCollection?.properties ? buildPropertyCallbacks(resolvedCollection.properties) : undefined;

                if (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead) {
                    const contextForCallback = {
                        user: { uid: activeAuth.uid,
roles: activeAuth.roles },
                        driver: this.driver,
                        data: (this.driver && "data" in this.driver) ? (this.driver as DataDriverWithData).data : undefined
                    } as unknown as RebaseCallContext;

                    return await Promise.all(fetchedEntities.map(async (fetchedRow) => {
                        let processedEntity = fetchedRow;
                        // 1. Global callbacks first
                        if (globalCallbacks?.afterRead) {
                            processedEntity = await globalCallbacks.afterRead({
                                collection: resolvedCollection,
                                path: notifyPath,
                                row: processedEntity,
                                context: contextForCallback
                            }) ?? processedEntity;
                        }
                        // 2. Collection callbacks second
                        if (callbacks?.afterRead) {
                            processedEntity = await callbacks.afterRead({
                                collection: resolvedCollection,
                                path: notifyPath,
                                row: processedEntity,
                                context: contextForCallback
                            }) ?? processedEntity;
                        }
                        // 3. Property callbacks third
                        if (propertyCallbacks?.afterRead) {
                            processedEntity = await propertyCallbacks.afterRead({
                                collection: resolvedCollection,
                                path: notifyPath,
                                row: processedEntity,
                                context: contextForCallback
                            }) ?? processedEntity;
                        }
                        return processedEntity;
                    }));
                }

                return fetchedEntities;
            });
        }

        // No driver — use dataService directly (no auth wrapping possible)
        if (collectionRequest.searchString) {
            return await this.dataService.searchRows(
                notifyPath,
                collectionRequest.searchString,
                {
                    filter: collectionRequest.filter as FilterValues<string>,
                    orderBy: collectionRequest.orderBy,
                    order: collectionRequest.order,
                    limit: collectionRequest.limit,
                    databaseId: collectionRequest.databaseId
                }
            );
        }
        return await this.dataService.fetchCollection(notifyPath, {
            filter: collectionRequest.filter as FilterValues<string>,
            orderBy: collectionRequest.orderBy,
            order: collectionRequest.order,
            limit: collectionRequest.limit,
            offset: collectionRequest.offset,
            startAfter: collectionRequest.startAfter,
            databaseId: collectionRequest.databaseId
        });
    }

    /**
     * Debounce an row refetch for a WebSocket subscription.
     */
    private debouncedSingleRefetch(
        subscriptionId: string,
        notifyPath: string,
        id: string,
        subscription: { clientId: string; authContext?: SubscriptionAuthContext }
    ) {
        const timerKey = `wse_${subscriptionId}`;
        const existing = this.refetchTimers.get(timerKey);
        if (existing) clearTimeout(existing);

        this.refetchTimers.set(timerKey, setTimeout(async () => {
            this.refetchTimers.delete(timerKey);
            if (!this._subscriptions.has(subscriptionId)) return;
            try {
                const row = await this.fetchEntityWithAuth(notifyPath, id, subscription.authContext);
                this.sendSingleUpdate(subscription.clientId, subscriptionId, row || null);
            } catch (error) {
                const sanitized = sanitizeErrorForClient(error, notifyPath);
                this.sendError(subscription.clientId, sanitized.message, subscriptionId, sanitized.code);
            }
        }, RealtimeService.REFETCH_DEBOUNCE_MS));
    }

    /**
     * Debounce an row refetch for a Driver callback subscription.
     */
    private debouncedSingleDriverRefetch(
        subscriptionId: string,
        notifyPath: string,
        id: string,
        subscription: { clientId: string; authContext?: SubscriptionAuthContext },
        callback: (data: Record<string, unknown>[] | Record<string, unknown> | null) => void
    ) {
        const timerKey = `drve_${subscriptionId}`;
        const existing = this.refetchTimers.get(timerKey);
        if (existing) clearTimeout(existing);

        this.refetchTimers.set(timerKey, setTimeout(async () => {
            this.refetchTimers.delete(timerKey);
            if (!this._subscriptions.has(subscriptionId)) return;
            try {
                const row = await this.fetchEntityWithAuth(notifyPath, id, subscription.authContext);
                callback(row || null);
            } catch (error) {
                logger.error(`❌ [RealtimeService] Error in debounced row driver refetch for ${subscriptionId}`, { error: error });
            }
        }, RealtimeService.REFETCH_DEBOUNCE_MS));
    }

    /**
     * Fetch a single row with optional RLS auth context.
     */
    private async fetchEntityWithAuth(
        notifyPath: string,
        id: string | number,
        authContext?: SubscriptionAuthContext
    ): Promise<Record<string, unknown> | undefined> {
        if (this.driver) {
            const collection = this.registry.getCollectionByPath(notifyPath);
            const fetchFn = async () => this.driver!.fetchOne({
                path: notifyPath,
                id,
                collection
            });

            // Always wrap in a transaction with session vars, defaulting to anonymous context if missing.
            // Same read isolation as collection refetches: GUCs + reader-role downgrade.
            const activeAuth = authContext || { uid: "anon",
roles: ["anon"] };
            return await this.db.transaction(async (tx) => {
                await applyAuthContext(tx, { uid: activeAuth.uid, roles: activeAuth.roles }, this.rlsUserRole);
                const txEntityService = new DataService(tx, this.registry);
                let processedEntity = await txEntityService.fetchOne(notifyPath, id, collection?.databaseId);

                if (processedEntity) {
                    const registryCollection = this.registry.getCollectionByPath(notifyPath);
                    const resolvedCollection = collection ? { ...collection,
...registryCollection } as CollectionConfig : registryCollection as CollectionConfig;

                    const callbacks = resolvedCollection?.callbacks;
                    const globalCallbacks = this.registry?.getGlobalCallbacks();
                    const propertyCallbacks = resolvedCollection?.properties ? buildPropertyCallbacks(resolvedCollection.properties) : undefined;

                    if (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead) {
                        const contextForCallback = {
                            user: { uid: activeAuth.uid,
roles: activeAuth.roles },
                            driver: this.driver,
                            data: (this.driver && "data" in this.driver) ? (this.driver as DataDriverWithData).data : undefined
                        } as unknown as RebaseCallContext;

                        // 1. Global callbacks first
                        if (globalCallbacks?.afterRead) {
                            processedEntity = await globalCallbacks.afterRead({
                                collection: resolvedCollection,
                                path: notifyPath,
                                row: processedEntity,
                                context: contextForCallback
                            }) ?? processedEntity;
                        }
                        // 2. Collection callbacks second
                        if (callbacks?.afterRead) {
                            processedEntity = await callbacks.afterRead({
                                collection: resolvedCollection,
                                path: notifyPath,
                                row: processedEntity,
                                context: contextForCallback
                            }) ?? processedEntity;
                        }
                        // 3. Property callbacks third
                        if (propertyCallbacks?.afterRead) {
                            processedEntity = await propertyCallbacks.afterRead({
                                collection: resolvedCollection,
                                path: notifyPath,
                                row: processedEntity,
                                context: contextForCallback
                            }) ?? processedEntity;
                        }
                    }
                }

                return processedEntity;
            });
        }

        return await this.dataService.fetchOne(notifyPath, id);
    }

    private sendCollectionUpdate(clientId: string, subscriptionId: string, rows: Record<string, unknown>[], path: string) {
        const message: CollectionUpdateMessage = {
            type: "collection_update",
            subscriptionId,
            rows: rows,
            pks: this.primaryKeysForPath(path)
        };
        this.sendMessage(clientId, message);
    }

    private sendSingleUpdate(clientId: string, subscriptionId: string, row: Record<string, unknown> | null) {
        const message: SingleUpdateMessage = {
            type: "single_update",
            subscriptionId,
            row: row
        };
        this.sendMessage(clientId, message);
    }

    /**
     * Send a lightweight row-level patch to a collection subscriber.
     * The client can merge this into its cached data for instant feedback.
     *
     * The key columns ride along: the patch names a row by address, and the
     * client has to find that row among the ones it cached — which carry
     * columns and no address. The SDK holds no collection config to derive one
     * from, so this is the only place the mapping can come from.
     */
    private sendCollectionPatch(
        clientId: string,
        subscriptionId: string,
        id: string,
        row: Record<string, unknown> | null,
        notifyPath: string
    ) {
        const message: CollectionPatchMessage = {
            type: "collection_patch",
            subscriptionId,
            id,
            row: row,
            pks: this.primaryKeysForPath(notifyPath)
        };
        this.sendMessage(clientId, message);
    }

    /** The key columns of the collection at `path`, if they can be resolved. */
    private primaryKeysForPath(path: string): PrimaryKeyInfo[] | undefined {
        try {
            const collection = this.registry.getCollectionByPath(path);
            if (!collection) return undefined;
            const keys = getPrimaryKeys(collection, this.registry);
            return keys.length > 0 ? keys : undefined;
        } catch {
            // `getCollectionByPath` throws on a path it cannot walk — and this
            // is called for parent paths too, which include entity paths like
            // `posts/1` that name no collection. Telling the subscriber nothing
            // is right here; letting it throw would drop the notification.
            return undefined;
        }
    }

    private sendError(clientId: string, error: string, subscriptionId?: string, code?: string) {
        const message = {
            type: "error" as const,
            subscriptionId,
            payload: {
                error: code ? { message: error, code } : error
            },
            error
        };
        this.sendMessage(clientId, message);
    }

    private sendMessage(clientId: string, message: CollectionUpdateMessage | SingleUpdateMessage | CollectionPatchMessage | { type: string; subscriptionId?: string; error?: string; payload?: unknown }) {
        const client = this.clients.get(clientId);
        if (client && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    }

    /**
     * Extract parent paths from a nested path like "posts/70/tags"
     * Returns ["posts", "posts/70"] for the example above
     */
    private getParentPaths(path: string): string[] {
        const segments = path.split("/").filter(s => s.length > 0);
        const parentPaths: string[] = [];

        // Build parent paths progressively
        for (let i = 1; i < segments.length; i += 2) {
            const parentPath = segments.slice(0, i).join("/");
            if (parentPath) {
                parentPaths.push(parentPath);
            }

            // If there's an row ID, add the path including the row
            if (i + 1 < segments.length) {
                const pathWithEntity = segments.slice(0, i + 1).join("/");
                parentPaths.push(pathWithEntity);
            }
        }

        return parentPaths;
    }

    // =============================================================================
    // Broadcast Channels
    // =============================================================================

    /** Join a broadcast channel */
    joinChannel(clientId: string, channel: string): void {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        this.channels.get(channel)!.add(clientId);
        this.debugLog(`📡 [Broadcast] Client ${clientId} joined channel: ${channel}`);
    }

    /** Leave a broadcast channel */
    leaveChannel(clientId: string, channel: string): void {
        const members = this.channels.get(channel);
        if (members) {
            members.delete(clientId);
            if (members.size === 0) this.channels.delete(channel);
        }
        // Also remove presence
        this.removePresence(clientId, channel);
    }

    /** Broadcast a message to all clients in a channel except sender */
    broadcastToChannel(clientId: string, channel: string, event: string, payload: unknown): void {
        const members = this.channels.get(channel);
        if (!members) return;

        const message = JSON.stringify({
            type: "broadcast",
            channel,
            event,
            payload
        });

        for (const memberId of members) {
            if (memberId === clientId) continue; // Don't echo back to sender
            const ws = this.clients.get(memberId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    // =============================================================================
    // Presence
    // =============================================================================

    /** Track presence in a channel */
    trackPresence(clientId: string, channel: string, state: Record<string, unknown>): void {
        if (!this.presence.has(channel)) {
            this.presence.set(channel, new Map());
        }

        const channelPresence = this.presence.get(channel)!;
        channelPresence.set(clientId, { state,
lastSeen: Date.now() });

        // Broadcast join / state update to channel
        this.broadcastPresenceDiff(channel, { [clientId]: state }, {});

        // Start cleanup interval if not running
        this.ensurePresenceCleanup();
    }

    /** Remove presence from a channel */
    removePresence(clientId: string, channel: string): void {
        const channelPresence = this.presence.get(channel);
        if (!channelPresence) return;

        const entry = channelPresence.get(clientId);
        if (entry) {
            channelPresence.delete(clientId);
            this.broadcastPresenceDiff(channel, {}, { [clientId]: entry.state });
        }

        if (channelPresence.size === 0) {
            this.presence.delete(channel);
        }
    }

    /** Send full presence state to a specific client */
    sendPresenceState(clientId: string, channel: string): void {
        const channelPresence = this.presence.get(channel);
        const presences: Record<string, Record<string, unknown>> = {};

        if (channelPresence) {
            for (const [id, { state }] of channelPresence) {
                presences[id] = state;
            }
        }

        const ws = this.clients.get(clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "presence_state",
                channel,
                presences
            }));
        }
    }

    /** Broadcast presence diff (joins/leaves) to channel */
    private broadcastPresenceDiff(
        channel: string,
        joins: Record<string, Record<string, unknown>>,
        leaves: Record<string, Record<string, unknown>>
    ): void {
        const members = this.channels.get(channel);
        if (!members) return;

        const message = JSON.stringify({
            type: "presence_diff",
            channel,
            joins,
            leaves
        });

        for (const memberId of members) {
            const ws = this.clients.get(memberId);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        }
    }

    /** Periodic cleanup for stale presences */
    private ensurePresenceCleanup(): void {
        if (this.presenceInterval) return;
        this.presenceInterval = setInterval(() => {
            const now = Date.now();
            for (const [channel, channelPresence] of this.presence) {
                for (const [clientId, entry] of channelPresence) {
                    if (now - entry.lastSeen > RealtimeService.PRESENCE_TIMEOUT_MS) {
                        this.removePresence(clientId, channel);
                    }
                }
            }
            // Stop interval if no presences tracked
            if (this.presence.size === 0 && this.presenceInterval) {
                clearInterval(this.presenceInterval);
                this.presenceInterval = undefined;
            }
        }, 10000); // Check every 10s
    }

    // =============================================================================
    // Lifecycle / Cleanup
    // =============================================================================

    /**
     * Gracefully tear down all realtime resources.
     *
     * This MUST be called during process shutdown, **before** `pool.end()`.
     * It ensures:
     *  1. All debounced refetch timers are cancelled (prevents queries after pool closes).
     *  2. All subscription state and callbacks are cleared.
     *  3. The dedicated LISTEN client (outside the pool) is disconnected.
     *  4. All WebSocket clients are removed (but not forcefully closed — the
     *     HTTP server close will handle that).
     */
    async destroy(): Promise<void> {
        // 1. Cancel every pending debounced refetch timer
        for (const [key, timer] of this.refetchTimers) {
            clearTimeout(timer);
            this.refetchTimers.delete(key);
        }

        // 2. Clear subscriptions and callbacks
        this._subscriptions.clear();
        this.subscriptionCallbacks.clear();

        // 3. Clear broadcast channels and presence
        this.channels.clear();
        this.presence.clear();
        if (this.presenceInterval) {
            clearInterval(this.presenceInterval);
            this.presenceInterval = undefined;
        }

        // 4. Disconnect the dedicated LISTEN client(s)
        await this.stopListening();
        await this.stopCdc();

        // 5. Drop client references (don't close — server.close drains them)
        this.clients.clear();

        this.debugLog("🧹 [RealtimeService] destroy() complete — all resources released.");
    }

    // =============================================================================
    // Database-level Change Data Capture (CDC)
    // =============================================================================

    /** Whether database-level change capture is currently the active source. */
    public isCdcActive(): boolean {
        return this.cdcActive;
    }

    /**
     * Enable database-level change capture as the realtime source.
     *
     * A dedicated LISTEN client consumes committed changes from the `rebase_cdc`
     * channel (fed by CDC triggers — see {@link provisionTriggerCdc}) and routes
     * them into the same {@link notifyUpdate} pipeline used by API mutations. The
     * effect: subscribers see a change no matter how it was written — psql, a
     * cron in another service, raw SQL, or the Studio SQL editor — exactly like
     * Supabase Realtime tailing the WAL.
     *
     * Because CDC observes every commit on every instance, it also *replaces* the
     * legacy per-mutation cross-instance broadcast (see the guard in
     * {@link notifyUpdate}); callers should not also call {@link startListening}.
     *
     * @param connectionString Direct Postgres connection for the LISTEN client
     *                         (bypass PgBouncer — LISTEN needs a session connection).
     */
    async enableCdc(connectionString: string): Promise<void> {
        if (this.cdcActive) {
            logger.warn("⚠️ [CDC] enableCdc called but CDC is already active. Ignoring.");
            return;
        }
        this.cdcTableMap = this.buildCdcTableMap();
        this.cdcListener = new CdcListener(connectionString, (event) => this.handleCdcEvent(event));
        try {
            // start() validates the initial connection; if it can't be established
            // it rejects here, and we leave CDC inactive so the caller can fall
            // back to app-level realtime rather than silently dropping events.
            await this.cdcListener.start();
        } catch (err) {
            await this.cdcListener.stop().catch(() => { /* best effort */ });
            this.cdcListener = undefined;
            this.cdcTableMap = undefined;
            throw err;
        }
        this.cdcActive = true;
        logger.info(
            `📡 [RealtimeService] Database-level change capture ACTIVE — writes from ANY source now emit realtime events ` +
            `(${this.cdcTableMap.size} mapped table key(s)).`
        );
    }

    /** Stop the CDC listener and clear its state. */
    async stopCdc(): Promise<void> {
        this.cdcActive = false;
        if (this.cdcListener) {
            await this.cdcListener.stop();
            this.cdcListener = undefined;
        }
        this.cdcTableMap = undefined;
        this.recentAppEmits.clear();
    }

    /**
     * Build the reverse map from database table → collection. A change event
     * carries `schema` + `table`; realtime subscriptions are keyed by collection
     * path (slug). We index by both `schema.table` and bare `table` so the lookup
     * works whether or not the collection declares an explicit schema.
     */
    private buildCdcTableMap(): Map<string, CollectionConfig> {
        const map = new Map<string, CollectionConfig>();
        for (const collection of this.registry.getCollections()) {
            const table = getTableName(collection);
            if (!table) continue;
            const schema = (collection as { schema?: string }).schema ?? "public";
            map.set(`${schema}.${table}`, collection);
            // Bare-table fallback; first registration wins to keep it deterministic.
            if (!map.has(table)) map.set(table, collection);
        }
        return map;
    }

    private resolveCollectionForTable(schema: string, table: string): CollectionConfig | undefined {
        if (!this.cdcTableMap) return undefined;
        return this.cdcTableMap.get(`${schema}.${table}`) ?? this.cdcTableMap.get(table);
    }

    /**
     * Route a captured database change into the realtime pipeline.
     *
     * Delivery is RLS-safe by construction: the raw tuple from the WAL/trigger is
     * NOT forwarded to subscribers. Instead the change is marked invalidated, so
     * every matching subscription re-reads the row under its own auth context via
     * {@link fetchCollectionWithAuth} / {@link fetchEntityWithAuth}. A subscriber
     * therefore only ever receives rows its RLS policies permit — filtering is per
     * subscriber, never per publisher.
     */
    private async handleCdcEvent(event: CdcChangeEvent): Promise<void> {
        const collection = this.resolveCollectionForTable(event.schema, event.table);
        if (!collection) {
            // Unmapped table (not backed by a collection) — nothing to deliver.
            this.debugLog(`📡 [CDC] Ignoring change on unmapped table ${event.schema}.${event.table}`);
            return;
        }

        const path = collection.slug;
        const databaseId = (collection as { databaseId?: string }).databaseId;
        const id = this.extractIdFromCdcRow(collection, event.row);

        // Deletes carry a null row (subscribers drop the id); inserts/updates carry
        // an invalidation marker that forces a per-subscriber RLS-bound refetch.
        const row = event.op === "DELETE" ? null : { _rebase_invalidated: true };

        await this.notifyUpdate(path, id, row, databaseId, /* broadcast */ false, /* origin */ "cdc");
    }

    /** Compute the canonical (possibly composite) id string from a captured row. */
    private extractIdFromCdcRow(collection: CollectionConfig, row: Record<string, unknown>): string {
        // Unaddressable falls back to a collection-level invalidation: single-row
        // subs won't match, but collection subs still refetch.
        return deriveRowAddress(row, collection, this.registry) || "*";
    }

    // ── App/CDC de-duplication ──

    private dedupKey(path: string, id: string, databaseId?: string): string {
        return `${databaseId ?? ""}::${path}::${id}`;
    }

    /** Record that this instance just delivered `key` via the app path. */
    private markAppEmit(key: string): void {
        const now = Date.now();
        this.recentAppEmits.set(key, now + RealtimeService.CDC_DEDUP_WINDOW_MS);
        // Opportunistic purge so the map cannot grow unbounded under write load.
        if (this.recentAppEmits.size > 1000) {
            for (const [k, expiry] of this.recentAppEmits) {
                if (expiry <= now) this.recentAppEmits.delete(k);
            }
        }
    }

    /** Consume a matching app-emit record if present and unexpired; true ⇒ suppress the CDC echo. */
    private consumeAppEmit(key: string): boolean {
        const expiry = this.recentAppEmits.get(key);
        if (expiry === undefined) return false;
        this.recentAppEmits.delete(key);
        return expiry > Date.now();
    }

    // =============================================================================
    // Cross-Instance LISTEN/NOTIFY
    // =============================================================================

    /**
     * Enable cross-instance realtime broadcasting via Postgres LISTEN/NOTIFY.
     * Creates a dedicated pg.Client (outside the Drizzle pool) that stays
     * connected and listens for change notifications from other instances.
     *
     * This is an **optional** feature — if never called, the backend operates
     * in single-instance mode (the default, perfectly fine for most setups).
     *
     * @param connectionString Raw Postgres connection string for the LISTEN client.
     */
    async startListening(connectionString: string): Promise<void> {
        if (this.broadcasting) {
            logger.warn("⚠️ [RealtimeService] startListening called but already listening. Ignoring.");
            return;
        }

        this.listenConnectionString = connectionString;
        // Set broadcasting BEFORE connecting so that scheduleReconnect()
        // works correctly if the initial connection attempt fails.
        this.broadcasting = true;
        await this.connectListenClient();
        logger.info(`📡 [RealtimeService] Cross-instance realtime enabled (instanceId: ${this.instanceId})`);
    }

    /**
     * Stop listening and clean up the dedicated LISTEN connection.
     */
    async stopListening(): Promise<void> {
        this.broadcasting = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        if (this.listenClient) {
            try {
                await this.listenClient.end();
            } catch { /* ignore close errors */ }
            this.listenClient = undefined;
        }
        logger.info("📡 [RealtimeService] Cross-instance realtime disabled.");
    }

    /**
     * Broadcast a change notification to other instances via pg_notify.
     * Uses the main Drizzle connection (pooled) — NOT the LISTEN client.
     */
    private async broadcastChange(path: string, id: string, databaseId?: string): Promise<void> {
        const payload = JSON.stringify({
            sid: this.instanceId,
            p: path,
            eid: id,
            db: databaseId ?? null
        });
        await this.db.execute(drizzleSql`SELECT pg_notify(${PG_NOTIFY_CHANNEL}, ${payload})`);
    }

    /**
     * Create and connect the dedicated LISTEN client with auto-reconnect.
     */
    private async connectListenClient(): Promise<void> {
        if (!this.listenConnectionString) return;

        try {
            const client = new PgClient({ connectionString: this.listenConnectionString });

            client.on("error", (err) => {
                logger.error("❌ [RealtimeService] LISTEN client error", { detail: err.message });
                this.scheduleReconnect();
            });

            client.on("end", () => {
                if (this.broadcasting) {
                    logger.warn("⚠️ [RealtimeService] LISTEN client disconnected unexpectedly.");
                    this.scheduleReconnect();
                }
            });

            client.on("notification", async (msg) => {
                if (!msg.payload) return;
                try {
                    const { sid, p, eid, db } = JSON.parse(msg.payload) as {
                        sid: string;
                        p: string;
                        eid: string;
                        db: string | null;
                    };

                    // Skip our own notifications — already processed locally
                    if (sid === this.instanceId) return;

                    this.debugLog(`📡 [RealtimeService] Received cross-instance notification: path=${p}, id=${eid}, from=${sid}`);

                    // Refetch the row from the DB so row subscriptions
                    // receive the actual data instead of null (which the client
                    // would interpret as "deleted").
                    let refetchedRow: Record<string, unknown> | null = null;
                    try {
                        if (this.driver) {
                            const collection = this.registry.getCollectionByPath(p);
                            const fetched = await this.driver.fetchOne({
                                path: p,
                                id: eid,
                                collection: collection
                            });
                            refetchedRow = fetched ?? null;
                        } else {
                            const fetched = await this.dataService.fetchOne(
                                p, eid, db ?? undefined
                            );
                            refetchedRow = fetched ?? null;
                        }
                    } catch (fetchErr) {
                        // If the fetch fails (e.g. row was deleted), refetchedRow stays null
                        this.debugLog(`📡 [RealtimeService] Could not refetch row ${eid} from ${p} — treating as deleted`, fetchErr);
                    }

                    // Trigger local fan-out with broadcast=false to avoid re-broadcasting
                    await this.notifyUpdate(p, eid, refetchedRow, db ?? undefined, false);
                } catch (err) {
                    logger.error("❌ [RealtimeService] Error processing cross-instance notification", { error: err });
                }
            });

            await client.connect();
            await client.query(`LISTEN ${PG_NOTIFY_CHANNEL}`);
            this.listenClient = client;

            this.debugLog(`📡 [RealtimeService] LISTEN client connected on channel "${PG_NOTIFY_CHANNEL}"`);
        } catch (err) {
            logger.error("❌ [RealtimeService] Failed to connect LISTEN client", { error: err });
            this.scheduleReconnect();
        }
    }

    /**
     * Schedule a reconnection attempt with a fixed 3s delay.
     */
    private scheduleReconnect(): void {
        if (!this.broadcasting || this.reconnectTimer) return;

        const delay = 3000; // Fixed 3s delay; simple and predictable
        this.debugLog(`📡 [RealtimeService] Scheduling LISTEN reconnect in ${delay}ms...`);

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = undefined;
            if (!this.broadcasting) return;

            // Clean up old client
            if (this.listenClient) {
                try { await this.listenClient.end(); } catch { /* ignore */ }
                this.listenClient = undefined;
            }

            await this.connectListenClient();
        }, delay);
    }
}

/**
 * Alias for RealtimeService for consistent naming with other database implementations.
 * This allows code to use PostgresRealtimeProvider alongside future MongoRealtimeProvider, etc.
 */
export const PostgresRealtimeProvider = RealtimeService;
