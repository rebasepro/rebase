import { WebSocket } from "ws";
import { EventEmitter } from "events";
import { Client as PgClient } from "pg";
import { randomUUID } from "crypto";
import { DataService } from "./dataService";

import { ANONYMOUS_USER_ID, FetchCollectionProps, ListenCollectionProps, ListenOneProps, DataDriver, CollectionUpdateMessage, SingleUpdateMessage, CollectionPatchMessage, WebSocketMessage, FilterValues, LogicalCondition, CollectionConfig, RebaseCallContext, resolveClientListLimit, ListLimitError } from "@rebasepro/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { RealtimeProvider, CollectionSubscriptionConfig, SingleSubscriptionConfig } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { buildPropertyCallbacks, getTableName } from "@rebasepro/common";
import { applyAuthContext } from "../security/rls-enforcement";
import { buildJunctionLinkMap, type JunctionLink } from "./cdc/junction-tables";
import { logger } from "@rebasepro/server";
import { sanitizeErrorForClient } from "../utils/pg-error-utils";
import { CdcListener, type CdcChangeEvent } from "./cdc/CdcListener";
import { deriveRowAddress, getPrimaryKeys, type PrimaryKeyInfo } from "./collection-helpers";
import { ChannelHistoryStore, type ResolvedRetention } from "./channel-history";
import { ChannelPresenceStore } from "./channel-presence";
import { ChannelBus, ChannelBusFrame, MemoryChannelBus, frameByteLength } from "./channel-bus";
import type { ChannelHistoryEntry, ChannelRetentionRule } from "@rebasepro/types";

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

/** What a channel frame is asking to do. */
export type ChannelAction = "join" | "broadcast" | "presence" | "history";

/** Everything an authorizer is told about the frame it is asked to allow. */
export interface ChannelAuthorizationRequest {
    /** The channel the frame names, exactly as the client wrote it. */
    channel: string;
    action: ChannelAction;
    /** The socket, not the principal — one user may hold several. */
    clientId: string;
    /** The socket's authenticated principal, or the anonymous one. */
    user?: SubscriptionAuthContext;
}

/**
 * The extension point for channel access rules.
 *
 * **This is deliberately not a product API yet.** The rule *language* — a
 * config key, a per-pattern DSL, how it composes with `securityRules` — is an
 * open design question (see `docs/channel-authorization.md`), and
 * inventing one here would be inventing the answer. What exists is the single
 * place every channel frame passes through, so that whatever shape the rules
 * eventually take has exactly one seam to plug into and no arm of the switch
 * can be forgotten.
 *
 * Returning `false` — or throwing — refuses the frame. It is consulted *after*
 * the membership floor below, so an authorizer can only ever narrow access,
 * never widen it.
 */
export type ChannelAuthorizer = (request: ChannelAuthorizationRequest) => boolean | Promise<boolean>;

interface DataDriverWithData extends DataDriver {
    data: unknown;
}

type RealTimeListenCollectionProps = ListenCollectionProps & {
    subscriptionId: string
};

/**
 * The narrowing a collection subscription was created with, kept so that every
 * refetch answers the same query the initial fetch did.
 *
 * Named once because it used to be written out inline in five places, and a
 * field missing from one of them is accepted over the wire and then silently
 * ignored: `offset` was declared on the incoming props and never stored, so a
 * live list on page three served page one, and `logical` was never stored
 * either, so an `or(...)` subscription was pushed every row in the table.
 */
type StoredCollectionRequest = {
    filter?: Record<string, unknown>;
    logical?: LogicalCondition;
    orderBy?: string;
    order?: "desc" | "asc";
    limit?: number;
    offset?: number;
    startAfter?: Record<string, unknown>;
    databaseId?: string;
    searchString?: string;
    /** Ask each row which declared search field matched — populates `_matches`. */
    searchExplain?: boolean;
};

type RealTimeListenEntityProps = ListenOneProps & { subscriptionId: string };

/**
 * PostgreSQL-specific realtime service.
 * Handles WebSocket connections and subscriptions for real-time row updates.
 *
 * Implements the RealtimeProvider interface for database abstraction.
 */
export class RealtimeService extends EventEmitter implements RealtimeProvider {
    /**
     * Declares to the multi-engine router that channel frames can be handled
     * here. Read by `createRoutedRealtimeService`, which otherwise would have to
     * guess — and guessed "the default provider", whichever engine that is.
     */
    public readonly supportsChannels = true;

    private clients = new Map<string, WebSocket>();

    // Broadcast channels: channel name → set of client IDs
    private channels = new Map<string, Set<string>>();

    // Presence: channel → Map<clientId, { state, lastSeen }>
    private presence = new Map<string, Map<string, { state: Record<string, unknown>; lastSeen: number }>>();

    /**
     * Ordered, replayable history for channels that opt into it.
     *
     * Undefined until {@link configureChannelHistory} is called, and inert even
     * then unless retention rules were supplied — so presence and ephemeral
     * notification channels never touch it. See `channel-history.ts`.
     */
    private channelHistory?: ChannelHistoryStore;

    /**
     * One promise chain per retained channel, so that assigning a sequence
     * number and fanning the message out happen in the same order for every
     * message on that channel.
     *
     * Without it, two concurrent broadcasts can be numbered 4 and 5 by the
     * database and still reach subscribers as 5 then 4 — live order and replay
     * order would disagree, which is exactly the divergence sequence numbers
     * are supposed to rule out. Keyed by channel, so unrelated channels never
     * wait on each other.
     */
    private channelSendQueues = new Map<string, Promise<void>>();

    /**
     * Cross-instance transport for channel frames and presence.
     *
     * Defaults to the memory bus, which publishes nowhere — so a single-instance
     * deployment runs the same fan-out it always did, with one resolved promise
     * per broadcast for company. See `channel-bus/ChannelBus.ts`.
     */
    private bus: ChannelBus = new MemoryChannelBus();

    /**
     * The shared presence roster, present only when a real bus is active.
     *
     * Fan-out alone is not enough for presence: `presence_state` has to answer
     * with everyone in the channel, and per-process maps can only answer for
     * this replica's clients. See `channel-presence.ts`.
     */
    private presenceStore?: ChannelPresenceStore;

    /** Sweeps roster rows left behind by instances that stopped heartbeating. */
    private presenceSweepInterval?: ReturnType<typeof setInterval>;

    /**
     * Channels whose oversized ephemeral broadcasts have already been reported,
     * so a hot channel logs the problem once rather than once per message.
     */
    private oversizedBroadcastWarned = new Set<string>();

    /**
     * Optional narrowing on top of the membership floor — see
     * {@link ChannelAuthorizer}. Unset by default, which leaves membership as
     * the whole of the rule.
     */
    private channelAuthorizer?: ChannelAuthorizer;

    /**
     * Whether a notification from another instance has ever arrived.
     *
     * The entity LISTEN handler sees a foreign `sid` on every cross-instance
     * change, which is proof that this deployment runs more than one pod — the
     * one fact needed to tell "the memory bus is fine here" from "broadcast and
     * presence silently reach a fraction of your users".
     */
    private foreignInstanceSeen = false;

    /** So the multi-pod memory-bus warning is emitted once, not once per join. */
    private memoryBusWarned = false;

    private presenceInterval?: ReturnType<typeof setInterval>;
    private static readonly PRESENCE_TIMEOUT_MS = 30000; // 30s
    /** How often stale roster rows from other instances are reaped. */
    private static readonly PRESENCE_SWEEP_INTERVAL_MS = 10000; // 10s
    private dataService: DataService;
    // Enhanced subscriptions storage with full request parameters
    private _subscriptions = new Map<string, {
        clientId: string;
        type: "collection" | "single";
        path: string;
        id?: string | number;
        // Store full collection request parameters for proper refetching
        collectionRequest?: StoredCollectionRequest;
        // Auth context for RLS — when set, refetches run in a transaction
        // with set_config('app.uid', ...) / set_config('app.user_roles', ...)
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
    /** Junction table → the child lists its rows belong to, built when CDC starts. */
    private junctionLinkMap?: Map<string, JunctionLink[]>;

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
        collectionRequest?: StoredCollectionRequest;
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
                searchString: config.searchString,
                searchExplain: config.searchExplain
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
                this.removePresence(clientId, channel, { skipStore: true });
                if (members.size === 0) this.channels.delete(channel);
            }
        }

        // Remove from all presence channels
        for (const [channel] of this.presence) {
            this.removePresence(clientId, channel, { skipStore: true });
        }

        // One statement for every channel the client was in, rather than one
        // per channel above — a disconnect is the common case, not a rare one.
        void this.presenceStoreOp(() => this.presenceStore!.removeClient(clientId), "client removal");
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

            // ── Broadcast Channels & Presence ──
            //
            // One arm for all of them, because every one has to pass the same
            // gate and a switch with seven arms is a place to forget it once.
            // See `handleChannelMessage`.
            case "join_channel":
            case "leave_channel":
            case "broadcast":
            case "channel_history":
            case "presence_track":
            case "presence_untrack":
            case "presence_state":
                await this.handleChannelMessage(clientId, message.type, payload, authContext);
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

            // A vector search cannot be served here, and the parameter used to
            // be read for one thing only — the limit default below — and then
            // dropped: the stored request carries no `vectorSearch` and the
            // refetch has no branch for one. So `.vectorSearch(…).listen()`
            // delivered an ordinary `id DESC` listing, with no `_distance` and
            // no error, forever. Refusing says what the silence did not.
            if (request.vectorSearch) {
                const msg =
                    "Realtime subscriptions do not support vector search: a subscription is re-run on every " +
                    "matching write, and nothing here computes distances. Use `.vectorSearch(...).find()` for " +
                    "the query, and subscribe without it if you need live updates.";
                logger.warn(`[RealtimeService] ${msg}`);
                this.sendError(clientId, msg, subscriptionId, "VECTOR_SEARCH_NOT_LIVE");
                return;
            }

            // Bound the client-supplied limit with the SAME guarantee the REST
            // ingress applies (`resolveClientListLimit`): default an absent
            // limit by mode, refuse one above the ceiling. A subscription is
            // re-fetched on every matching write, so an unbounded one is a DoS
            // amplified per write — resolve it once and reuse for the stored
            // request and the initial fetch.
            //
            // Refusing matters more here than on the REST route: a
            // `collection_update` frame carries rows and nothing else — no
            // `total`, no `hasMore` — so a subscriber handed a quietly smaller
            // page has no way at all to learn it is not seeing the collection.
            let boundedLimit: number;
            try {
                boundedLimit = resolveClientListLimit(request.limit);
            } catch (e) {
                if (!(e instanceof ListLimitError)) throw e;
                logger.warn(`[RealtimeService] Refused subscription to '${request.path}': ${e.message}`);
                this.sendError(clientId, e.message, subscriptionId, "INVALID_LIMIT");
                return;
            }

            // Store subscription with full request parameters and auth context for RLS
            this._subscriptions.set(subscriptionId, {
                clientId,
                type: "collection",
                path: request.path,
                collectionRequest: {
                    filter: request.filter,
                    logical: request.logical,
                    orderBy: request.orderBy,
                    order: request.order,
                    limit: boundedLimit,
                    offset: request.offset,
                    startAfter: request.startAfter as Record<string, unknown> | undefined,
                    databaseId: request.collection?.databaseId,
                    searchString: request.searchString,
                    searchExplain: request.searchExplain
                },
                authContext
            });

            // Send initial data. Built from the request the subscription just
            // stored, so the first answer and every refetch after it cannot
            // describe different queries.
            const rows = await this.fetchCollectionWithAuth(
                request.path,
                this._subscriptions.get(subscriptionId)!.collectionRequest!,
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
        subscription: { clientId: string; collectionRequest?: StoredCollectionRequest; authContext?: SubscriptionAuthContext }
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
        subscription: { collectionRequest?: StoredCollectionRequest; authContext?: SubscriptionAuthContext },
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
        collectionRequest: StoredCollectionRequest,
        authContext?: SubscriptionAuthContext
    ): Promise<Record<string, unknown>[]> {
        if (this.driver) {
            const collection = this.registry.getCollectionByPath(notifyPath);
            const fetchFn = async () => this.driver!.fetchCollection({
                path: notifyPath,
                collection: collection,
                filter: collectionRequest.filter as FetchCollectionProps["filter"],
                logical: collectionRequest.logical,
                orderBy: collectionRequest.orderBy,
                order: collectionRequest.order,
                limit: collectionRequest.limit,
                offset: collectionRequest.offset,
                startAfter: collectionRequest.startAfter,
                searchString: collectionRequest.searchString,
                searchExplain: collectionRequest.searchExplain
            });

            // Always wrap in a transaction with session vars, defaulting to anonymous context if missing.
            // Refetches are reads: apply the same GUCs + reader-role downgrade as the
            // driver's read path, so realtime cannot leak rows the initial fetch hid.
            const activeAuth = authContext || { uid: ANONYMOUS_USER_ID,
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
                            // The subscription stored a group; the search branch
                            // did not pass it on, so a filtered live search
                            // widened to every row matching the text.
                            logical: collectionRequest.logical,
                            orderBy: collectionRequest.orderBy,
                            order: collectionRequest.order,
                            limit: collectionRequest.limit,
                            databaseId: collectionRequest.databaseId,
                            searchExplain: collectionRequest.searchExplain
                        }
                    );
                } else {
                    fetchedEntities = await txEntityService.fetchCollection(notifyPath, {
                        filter: collectionRequest.filter as FilterValues<string>,
                        logical: collectionRequest.logical,
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

        // No driver — use dataService directly (no auth wrapping possible).
        // The `logical` group is carried here as well: this branch answers the
        // same subscription as the one above, and a fallback that drops a
        // condition returns *more* rows than the path it stands in for.
        if (collectionRequest.searchString) {
            return await this.dataService.searchRows(
                notifyPath,
                collectionRequest.searchString,
                {
                    filter: collectionRequest.filter as FilterValues<string>,
                    logical: collectionRequest.logical,
                    orderBy: collectionRequest.orderBy,
                    order: collectionRequest.order,
                    limit: collectionRequest.limit,
                    databaseId: collectionRequest.databaseId,
                    searchExplain: collectionRequest.searchExplain
                }
            );
        }
        return await this.dataService.fetchCollection(notifyPath, {
            filter: collectionRequest.filter as FilterValues<string>,
            logical: collectionRequest.logical,
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
            const activeAuth = authContext || { uid: ANONYMOUS_USER_ID,
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

    /**
     * Install a channel authorizer — see {@link ChannelAuthorizer}.
     *
     * Nothing in the framework calls this yet: it is the seam a rules API will
     * be built on, kept deliberately separate from the membership floor so the
     * floor holds whether or not anyone uses it.
     */
    setChannelAuthorizer(authorizer: ChannelAuthorizer | undefined): void {
        this.channelAuthorizer = authorizer;
    }

    /** Which action each channel frame is asking to perform. */
    private static readonly CHANNEL_ACTIONS: Record<string, ChannelAction> = {
        join_channel: "join",
        broadcast: "broadcast",
        channel_history: "history",
        presence_track: "join",
        presence_state: "presence"
    };

    /**
     * The one door every channel frame comes through.
     *
     * Returns synchronously — and so dispatches synchronously — unless an
     * authorizer is installed. That matters: a client sends `join_channel`,
     * `presence_state` and `channel_history` back to back on connect, and the
     * socket's message handler processes each frame up to its first `await`,
     * so a gate that always yielded would let the reads overtake the join that
     * is about to authorize them.
     */
    private handleChannelMessage(
        clientId: string,
        type: string,
        payload: Record<string, unknown> | undefined,
        authContext?: SubscriptionAuthContext
    ): void | Promise<void> {
        const channel = payload?.channel as string;

        // Leaving and untracking only ever remove the caller's own state, so
        // they need no permission — refusing them could only strand a client.
        if (type === "leave_channel") {
            this.leaveChannel(clientId, channel);
            return;
        }
        if (type === "presence_untrack") {
            this.removePresence(clientId, channel);
            return;
        }

        const action = RealtimeService.CHANNEL_ACTIONS[type];
        const allowed = this.authorizeChannelAction(clientId, channel, action, authContext);
        if (allowed === false) return;
        if (allowed === true) return this.dispatchChannelMessage(clientId, type, channel, payload);
        return allowed.then((ok) => {
            if (ok) return this.dispatchChannelMessage(clientId, type, channel, payload);
        });
    }

    /** Perform an already-authorized channel frame. */
    private dispatchChannelMessage(
        clientId: string,
        type: string,
        channel: string,
        payload: Record<string, unknown> | undefined
    ): void | Promise<void> {
        switch (type) {
            case "join_channel":
                this.joinChannel(clientId, channel);
                return;
            case "broadcast":
                this.broadcastToChannel(clientId, channel, payload?.event as string, payload?.payload);
                return;
            case "channel_history":
                return this.handleChannelHistoryRequest(
                    clientId,
                    channel,
                    payload?.sinceSeq as number | undefined,
                    payload?.limit as number | undefined
                );
            case "presence_track":
                // Auto-join the channel so presence works without a separate join
                this.joinChannel(clientId, channel);
                this.trackPresence(clientId, channel, payload?.state as Record<string, unknown> ?? {});
                return;
            case "presence_state":
                this.sendPresenceState(clientId, channel);
                return;
        }
    }

    /**
     * Decide whether a client may perform an action on a channel.
     *
     * **Membership is the floor.** Reading a channel's presence roster, replaying
     * its retained history and broadcasting into it all require that this client
     * has joined it. That is a low bar — joining is open to anyone who can name
     * the channel — but it is not the bar that was there before, which was none
     * at all: `channel_history` and `presence_state` answered any socket about
     * any channel, and a broadcast fanned out to members the sender had never
     * joined. Two internal tables (`rebase.channel_presence`,
     * `rebase.channel_messages`) are held outside RLS on the strength of this
     * check, so it fails closed: an authorizer that throws refuses the frame.
     *
     * Anything richer than membership belongs in a {@link ChannelAuthorizer};
     * this method is where it is consulted, and the only place.
     */
    private authorizeChannelAction(
        clientId: string,
        channel: string,
        action: ChannelAction,
        authContext?: SubscriptionAuthContext
    ): boolean | Promise<boolean> {
        // Joining is what establishes membership, so it cannot require it.
        if (action !== "join" && !this.channels.get(channel)?.has(clientId)) {
            this.denyChannelAction(clientId, channel, action, "not a member of the channel");
            return false;
        }

        const authorizer = this.channelAuthorizer;
        if (!authorizer) return true;

        let verdict: boolean | Promise<boolean>;
        try {
            verdict = authorizer({ channel, action, clientId, user: authContext });
        } catch (error) {
            logger.error(`❌ [Channels] Authorizer threw for ${action} on "${channel}" — refusing`, { error });
            this.denyChannelAction(clientId, channel, action, "channel authorization failed");
            return false;
        }

        if (typeof verdict === "boolean") {
            if (!verdict) this.denyChannelAction(clientId, channel, action, "refused by the channel authorizer");
            return verdict;
        }

        return verdict.then(
            (ok) => {
                if (!ok) this.denyChannelAction(clientId, channel, action, "refused by the channel authorizer");
                return ok;
            },
            (error) => {
                logger.error(`❌ [Channels] Authorizer rejected for ${action} on "${channel}" — refusing`, { error });
                this.denyChannelAction(clientId, channel, action, "channel authorization failed");
                return false;
            }
        );
    }

    /** Tell the client why its channel frame went nowhere, and say so in the log. */
    private denyChannelAction(clientId: string, channel: string, action: ChannelAction, reason: string): void {
        this.debugLog(`🚫 [Channels] Refused ${action} on "${channel}" for ${clientId}: ${reason}`);
        this.sendError(
            clientId,
            `Refused ${action} on channel "${channel}": ${reason}`,
            undefined,
            "CHANNEL_FORBIDDEN"
        );
    }

    /** Join a broadcast channel */
    joinChannel(clientId: string, channel: string): void {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        this.channels.get(channel)!.add(clientId);
        this.warnIfMemoryBusOnMultiplePods();
        this.debugLog(`📡 [Broadcast] Client ${clientId} joined channel: ${channel}`);
    }

    /**
     * Say something the first time channels are used on a deployment that is
     * demonstrably multi-pod while the bus is still the in-memory default.
     *
     * Every other warning in this subsystem covers a *configured* bus failing —
     * the case where the operator already knew a bus mattered. The common
     * misconfiguration is the opposite one: scaled to two replicas, never
     * touched `realtime.bus`, and broadcast and presence quietly serve a
     * fraction of the room. The evidence is already in the process, so use it.
     */
    private warnIfMemoryBusOnMultiplePods(): void {
        if (this.memoryBusWarned) return;
        if (this.bus.kind !== "memory" || !this.foreignInstanceSeen) return;
        this.memoryBusWarned = true;
        logger.warn(
            "⚠️ [ChannelBus] Channels are in use with the in-memory bus, but notifications from another " +
            "instance have been seen — this deployment runs more than one process. Broadcast and presence " +
            "reach only the clients connected to this one. Set `realtime.bus` (or REBASE_REALTIME_BUS=postgres) " +
            "to make channels cross-instance."
        );
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

    /**
     * Broadcast a message to all clients in a channel except the sender.
     *
     * On a channel with no retention rule this is what it always was: a
     * synchronous fan-out to whoever is connected, with no sequence number, no
     * SQL and no await — the body below runs to completion before returning.
     *
     * On a retained channel the message is durably numbered first and only then
     * delivered, through a per-channel queue so that delivery order matches
     * sequence order. That ordering is the whole point: a client that catches up
     * with `sinceSeq` has to arrive at the same state as one that never
     * disconnected.
     */
    broadcastToChannel(clientId: string, channel: string, event: string, payload: unknown): void {
        const retention = this.channelHistory?.retentionFor(channel);
        if (!retention) {
            this.fanOutBroadcast(clientId, channel, event, payload);
            // Other instances get the same frame, but never before the clients
            // on this one: the local fan-out above is synchronous and the
            // publish is not, which is also what keeps the ephemeral path free
            // of any await for a single-instance deployment.
            this.publishBroadcast(clientId, channel, event, payload);
            return;
        }

        const previous = this.channelSendQueues.get(channel) ?? Promise.resolve();
        const next = previous
            // A failed predecessor must not poison the chain — the next message
            // on this channel is independent and still deserves to be sent.
            .catch(() => { /* already reported below */ })
            .then(() => this.persistAndFanOut(clientId, channel, event, payload, retention));

        this.channelSendQueues.set(channel, next);
        void next.finally(() => {
            // Only clear if nothing has queued behind us in the meantime.
            if (this.channelSendQueues.get(channel) === next) this.channelSendQueues.delete(channel);
        });
    }

    /**
     * Number a broadcast, store it, then deliver it.
     *
     * A message that cannot be stored is **not** delivered. Delivering it would
     * put it in front of live subscribers while leaving it absent from every
     * future replay — the two views of the channel would disagree permanently,
     * and no later message could repair the gap. Failing loudly to the sender
     * instead lets it retry, which for an operation stream is the only outcome
     * that keeps clients convergent.
     */
    private async persistAndFanOut(
        clientId: string,
        channel: string,
        event: string,
        payload: unknown,
        retention: ResolvedRetention
    ): Promise<void> {
        let seq: number;
        try {
            ({ seq } = await this.channelHistory!.append(channel, event, payload, clientId));
        } catch (error) {
            logger.error(`❌ [ChannelHistory] Could not persist broadcast on "${channel}" — message dropped`, { error });
            this.sendError(
                clientId,
                `Could not persist broadcast on retained channel "${channel}"`,
                undefined,
                "CHANNEL_HISTORY_WRITE_FAILED"
            );
            return;
        }

        this.fanOutBroadcast(clientId, channel, event, payload, seq);
        this.publishBroadcast(clientId, channel, event, payload, seq);

        try {
            await this.channelHistory!.prune(channel, retention);
        } catch (error) {
            // Retention is a housekeeping concern; the message is already
            // delivered and durable, so a failed prune must not surface as a
            // broadcast failure. It will be retried on the next message.
            logger.warn(`⚠️ [ChannelHistory] Prune failed for "${channel}"`, { error });
        }
    }

    /** Deliver a broadcast frame to every member of a channel but the sender. */
    private fanOutBroadcast(clientId: string, channel: string, event: string, payload: unknown, seq?: number): void {
        const members = this.channels.get(channel);
        if (!members) return;

        const message = JSON.stringify({
            type: "broadcast",
            channel,
            event,
            payload,
            ...(seq !== undefined ? { seq } : {})
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
    // Cross-Instance Channel Bus
    // =============================================================================

    /**
     * Install the transport that carries channel frames between instances.
     *
     * Called once at boot. A bus that cannot start is reported and replaced with
     * the memory bus: losing cross-instance fan-out degrades collaboration to
     * what it was before this existed, whereas refusing to boot takes the whole
     * backend down for it.
     */
    async configureChannelBus(bus: ChannelBus): Promise<void> {
        if (bus.kind === "memory") {
            this.bus = bus;
            return;
        }

        try {
            await bus.start((frame) => this.handleBusFrame(frame));
        } catch (error) {
            logger.warn(
                `⚠️ [ChannelBus] Could not start the "${bus.kind}" channel bus — channel broadcast and presence ` +
                "stay per-instance. Clients served by different replicas will not see each other.",
                { error }
            );
            await bus.stop().catch(() => { /* best effort */ });
            this.bus = new MemoryChannelBus();
            return;
        }

        this.bus = bus;

        // Presence needs shared *state*, not just shared fan-out — see
        // `channel-presence.ts`. It comes up with the bus and only with it.
        try {
            const store = new ChannelPresenceStore(this.db, this.instanceId);
            await store.ensureTables();
            this.presenceStore = store;
            this.ensurePresenceSweep();
        } catch (error) {
            logger.warn(
                "⚠️ [ChannelBus] Could not create the shared presence table — presence rosters will only list " +
                "clients connected to this instance (broadcast is unaffected).",
                { error }
            );
            this.presenceStore = undefined;
        }

        logger.info(
            `📡 [ChannelBus] Cross-instance channels active via ${bus.kind} (instanceId: ${this.instanceId}).`
        );
    }

    /** Which transport is in use — `"memory"` means per-instance only. */
    public getChannelBusKind(): ChannelBus["kind"] {
        return this.bus.kind;
    }

    /**
     * Send a broadcast to the other instances.
     *
     * Fire-and-forget by design: the clients on this instance have already been
     * served, and a bus that is briefly unreachable must not turn a broadcast
     * into an error for the sender.
     */
    private publishBroadcast(clientId: string, channel: string, event: string, payload: unknown, seq?: number): void {
        if (this.bus.kind === "memory") return;

        const frame: ChannelBusFrame = {
            kind: "broadcast",
            sid: this.instanceId,
            channel,
            event,
            from: clientId,
            ...(seq !== undefined ? { seq } : {}),
            payload
        };

        // Postgres caps a NOTIFY payload at 8 KB. A retained message is already
        // durable and addressable, so it travels as a pointer and each receiver
        // reads the body back — the same shape as the entity path, which
        // notifies an address and refetches the row.
        if (frameByteLength(frame) > this.bus.maxFrameBytes) {
            if (seq === undefined) {
                this.reportOversizedBroadcast(clientId, channel);
                return;
            }
            void this.publishFrame({
                kind: "broadcast_ref",
                sid: this.instanceId,
                channel,
                from: clientId,
                seq
            });
            return;
        }

        void this.publishFrame(frame);
    }

    private async publishFrame(frame: ChannelBusFrame): Promise<void> {
        try {
            await this.bus.publish(frame);
        } catch (error) {
            logger.error("❌ [ChannelBus] Failed to publish frame — other instances did not receive it", {
                detail: `${frame.kind} on "${frame.channel}"`,
                error
            });
        }
    }

    /**
     * Tell the sender that a message was delivered locally but nowhere else.
     *
     * Staying quiet here would be the worst option available: on one instance
     * the app works, on two it works for half the users, and nothing in the
     * logs connects the two. The fix is a one-liner in config — give the
     * channel a retention rule and the message travels as a pointer instead —
     * so the message says exactly that.
     */
    private reportOversizedBroadcast(clientId: string, channel: string): void {
        const remedy =
            `Add a retention rule for "${channel}" (realtime.channels) — retained messages travel by reference ` +
            "and have no size limit.";

        if (!this.oversizedBroadcastWarned.has(channel)) {
            this.oversizedBroadcastWarned.add(channel);
            logger.warn(
                `⚠️ [ChannelBus] A broadcast on ephemeral channel "${channel}" exceeds the ` +
                `${this.bus.maxFrameBytes}-byte limit of the ${this.bus.kind} bus and reached only this instance. ` +
                remedy
            );
        }
        this.sendError(
            clientId,
            `Broadcast on "${channel}" was too large to reach other instances. ${remedy}`,
            undefined,
            "CHANNEL_BUS_PAYLOAD_TOO_LARGE"
        );
    }

    /**
     * Deliver a frame published by another instance to this one's clients.
     *
     * Frames we published ourselves are dropped on arrival — the local fan-out
     * happened before the publish — exactly as the entity-change handler skips
     * its own `sid`.
     */
    private async handleBusFrame(frame: ChannelBusFrame): Promise<void> {
        if (frame.sid === this.instanceId) return;

        switch (frame.kind) {
            case "broadcast":
                this.fanOutBroadcast(frame.from ?? "", frame.channel, frame.event, frame.payload, frame.seq);
                return;

            case "broadcast_ref": {
                // Nothing to read back for: skip the query rather than pay for
                // a message no client here is waiting for.
                if (!this.channels.get(frame.channel)?.size) return;

                const entry = await this.channelHistory?.getBySeq(frame.channel, frame.seq);
                if (!entry) {
                    logger.warn(
                        `⚠️ [ChannelBus] Message ${frame.seq} on "${frame.channel}" is no longer retained — ` +
                        "clients on this instance will need to replay (channel_history) to catch up."
                    );
                    return;
                }
                this.fanOutBroadcast(frame.from ?? "", frame.channel, entry.event, entry.payload, entry.seq);
                return;
            }

            case "presence_diff":
                this.deliverPresenceDiff(frame.channel, frame.joins, frame.leaves);
                return;
        }
    }

    // =============================================================================
    // Channel History
    // =============================================================================

    /**
     * Install retention rules and create the tables they need.
     *
     * Safe to call with no rules (and safe not to call at all): the store stays
     * inert, no schema is created, and broadcast keeps its original
     * fire-and-forget path.
     */
    async configureChannelHistory(rules: ChannelRetentionRule[] | undefined): Promise<void> {
        this.channelHistory = new ChannelHistoryStore(this.db, rules ?? []);
        if (!this.channelHistory.enabled) return;
        await this.channelHistory.ensureTables();
    }

    /** Whether any channel is configured to retain messages. */
    public isChannelHistoryEnabled(): boolean {
        return this.channelHistory?.enabled ?? false;
    }

    /**
     * Answer a client's catch-up request.
     *
     * A channel with no retention rule is answered with `retained: false`
     * rather than an empty list, so the client can tell "you missed nothing"
     * apart from "this channel never keeps anything" — the second means its
     * reconnect strategy has to be a full resync, and silence would leave it
     * guessing.
     */
    private async handleChannelHistoryRequest(
        clientId: string,
        channel: string,
        sinceSeq?: number,
        limit?: number
    ): Promise<void> {
        if (!channel) return;

        const retention = this.channelHistory?.retentionFor(channel);
        if (!retention) {
            this.sendChannelHistory(clientId, channel, [], false);
            return;
        }

        try {
            const { messages, latestSeq } = await this.channelHistory!.replay(channel, sinceSeq, limit);
            this.sendChannelHistory(clientId, channel, messages, true, latestSeq);
        } catch (error) {
            logger.error(`❌ [ChannelHistory] Replay failed for "${channel}"`, { error });
            this.sendError(clientId, `Could not replay history for channel "${channel}"`, undefined, "CHANNEL_HISTORY_READ_FAILED");
        }
    }

    private sendChannelHistory(
        clientId: string,
        channel: string,
        messages: ChannelHistoryEntry[],
        retained: boolean,
        latestSeq?: number
    ): void {
        const ws = this.clients.get(clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "channel_history",
                channel,
                messages,
                retained,
                ...(latestSeq !== undefined ? { latestSeq } : {})
            }));
        }
    }

    // =============================================================================
    // Presence
    // =============================================================================

    /**
     * Track presence in a channel.
     *
     * The client re-sends this every ~20s as a heartbeat against the 30s
     * timeout, so most calls carry the state that is already recorded. Those
     * refresh `last_seen` and stop there: re-announcing an unchanged state to
     * every instance would put a bus message per client per heartbeat on the
     * wire to tell everyone nothing happened.
     */
    trackPresence(clientId: string, channel: string, state: Record<string, unknown>): void {
        if (!this.presence.has(channel)) {
            this.presence.set(channel, new Map());
        }

        const channelPresence = this.presence.get(channel)!;
        const previous = channelPresence.get(clientId);
        const changed = !previous || JSON.stringify(previous.state) !== JSON.stringify(state);
        channelPresence.set(clientId, { state,
lastSeen: Date.now() });

        // Refresh the shared roster on every heartbeat — that timestamp is what
        // tells other instances this client is still here.
        void this.presenceStoreOp(() => this.presenceStore!.track(channel, clientId, state), "track");

        // Broadcast join / state update to channel
        this.deliverPresenceDiff(channel, { [clientId]: state }, {});
        if (changed) {
            this.publishPresenceDiff(channel, { [clientId]: state }, {});
        }

        // Start cleanup interval if not running
        this.ensurePresenceCleanup();
    }

    /**
     * Remove presence from a channel.
     *
     * `skipStore` is for the socket-close path, which clears every channel at
     * once and then deletes the client's rows in a single statement instead of
     * one per channel.
     */
    removePresence(clientId: string, channel: string, options?: { skipStore?: boolean }): void {
        const channelPresence = this.presence.get(channel);
        if (!channelPresence) return;

        const entry = channelPresence.get(clientId);
        if (entry) {
            channelPresence.delete(clientId);
            this.deliverPresenceDiff(channel, {}, { [clientId]: entry.state });
            this.publishPresenceDiff(channel, {}, { [clientId]: entry.state });
            if (!options?.skipStore) {
                void this.presenceStoreOp(() => this.presenceStore!.remove(channel, clientId), "remove");
            }
        }

        if (channelPresence.size === 0) {
            this.presence.delete(channel);
        }
    }

    /**
     * Send the full roster for a channel to one client.
     *
     * Answered from the shared table when there is one, because "who is in this
     * document?" has a single answer that must not depend on which replica the
     * asker happens to be connected to. Without a bus there is nothing to share
     * and the local map *is* the roster — that path stays synchronous, which is
     * what it always was.
     */
    sendPresenceState(clientId: string, channel: string): void {
        if (!this.presenceStore) {
            this.sendPresenceStateMessage(clientId, channel, this.localPresences(channel));
            return;
        }

        void this.presenceStore.roster(channel)
            .then((presences) => {
                this.sendPresenceStateMessage(clientId, channel, presences);
            })
            .catch((error) => {
                // A roster the asker can act on beats none: fall back to the
                // clients we can see rather than leaving the request unanswered.
                logger.warn(`⚠️ [Presence] Could not read the shared roster for "${channel}" — answering with this instance's clients only.`, { error });
                this.sendPresenceStateMessage(clientId, channel, this.localPresences(channel));
            });
    }

    /** Presence of the clients connected to this instance. */
    private localPresences(channel: string): Record<string, Record<string, unknown>> {
        const channelPresence = this.presence.get(channel);
        const presences: Record<string, Record<string, unknown>> = {};
        if (channelPresence) {
            for (const [id, { state }] of channelPresence) {
                presences[id] = state;
            }
        }
        return presences;
    }

    private sendPresenceStateMessage(
        clientId: string,
        channel: string,
        presences: Record<string, Record<string, unknown>>
    ): void {
        const ws = this.clients.get(clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "presence_state",
                channel,
                presences
            }));
        }
    }

    /** Deliver a presence diff to this instance's members of the channel. */
    private deliverPresenceDiff(
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

    /** Tell the other instances about a presence change. */
    private publishPresenceDiff(
        channel: string,
        joins: Record<string, Record<string, unknown>>,
        leaves: Record<string, Record<string, unknown>>
    ): void {
        if (this.bus.kind === "memory") return;
        void this.publishFrame({ kind: "presence_diff", sid: this.instanceId, channel, joins, leaves });
    }

    /** Run a roster write when there is a roster, and never let it throw. */
    private async presenceStoreOp(op: () => Promise<void>, label: string): Promise<void> {
        if (!this.presenceStore) return;
        try {
            await op();
        } catch (error) {
            logger.warn(`⚠️ [Presence] Shared roster ${label} failed`, { error });
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

    /**
     * Reap roster rows whose owning instance stopped heartbeating.
     *
     * This is the cross-instance half of the sweep above, and it doubles as
     * crash recovery: a pod that dies takes its clients with it but leaves
     * their rows behind, and after one TTL window they look exactly like any
     * other client that went quiet. The delete returns what it removed, so
     * whichever instance wins the race is the one that announces the
     * departures — once for the cluster, not once per replica.
     */
    private ensurePresenceSweep(): void {
        if (this.presenceSweepInterval || !this.presenceStore) return;

        this.presenceSweepInterval = setInterval(
            () => void this.sweepStalePresence(),
            RealtimeService.PRESENCE_SWEEP_INTERVAL_MS
        );

        // Never hold the process open for housekeeping.
        (this.presenceSweepInterval as unknown as { unref?: () => void }).unref?.();
    }

    /** One pass of the stale-roster sweep. See {@link ensurePresenceSweep}. */
    private async sweepStalePresence(): Promise<void> {
        if (!this.presenceStore) return;
        try {
            const removed = await this.presenceStore.sweepStale(RealtimeService.PRESENCE_TIMEOUT_MS);
            for (const row of removed) {
                this.debugLog(`👻 [Presence] Reaped stale presence ${row.clientId} on "${row.channel}"`);
                this.deliverPresenceDiff(row.channel, {}, { [row.clientId]: row.state });
                this.publishPresenceDiff(row.channel, {}, { [row.clientId]: row.state });
            }
        } catch (error) {
            logger.warn("⚠️ [Presence] Stale-roster sweep failed", { error });
        }
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
        // Pending history writes hold the pool open; let them settle before the
        // caller closes it, but never let a rejected one break shutdown.
        await Promise.allSettled([...this.channelSendQueues.values()]);
        this.channelSendQueues.clear();
        this.channelHistory?.clear();
        if (this.presenceInterval) {
            clearInterval(this.presenceInterval);
            this.presenceInterval = undefined;
        }
        if (this.presenceSweepInterval) {
            clearInterval(this.presenceSweepInterval);
            this.presenceSweepInterval = undefined;
        }
        this.oversizedBroadcastWarned.clear();

        // Drop this instance's roster rows now rather than leaving every other
        // replica to wait out a TTL window on ghosts — a rolling deploy would
        // otherwise show 30s of departed users on every restart.
        if (this.presenceStore) {
            try {
                await this.presenceStore.removeInstance();
            } catch (error) {
                logger.warn("⚠️ [Presence] Could not clear this instance's roster rows on shutdown", { error });
            }
            this.presenceStore = undefined;
        }

        // 4. Disconnect the dedicated LISTEN client(s)
        await this.stopListening();
        await this.stopCdc();
        await this.bus.stop().catch((error) =>
            logger.warn("⚠️ [ChannelBus] Error while stopping the channel bus", { error }));
        this.bus = new MemoryChannelBus();

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
        this.junctionLinkMap = buildJunctionLinkMap(this.registry);
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
            this.junctionLinkMap = undefined;
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
        this.junctionLinkMap = undefined;
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
            // A junction table backs no collection, but its rows *are* a child
            // list. Route the change to the lists it changes before giving up.
            if (await this.handleJunctionCdcEvent(event)) return;

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

    /**
     * Deliver a change on a many-to-many junction table as a change to the child
     * lists it belongs to.
     *
     * Linking a tag to a post writes only `posts_tags`. That table backs no
     * collection, so change capture dropped the event as unmapped and the
     * subscribers of `posts/1/tags` never heard about it — every other write in
     * the system was realtime, and this one silently was not. The junction row
     * carries both ids, so it names its own paths exactly.
     *
     * Notifies the nested path rather than either endpoint collection, because
     * invalidation walks *parent* paths and never child ones: telling `tags` it
     * changed would not reach a subscription on `posts/1/tags`.
     *
     * Returns whether the table was recognised as a junction.
     */
    private async handleJunctionCdcEvent(event: CdcChangeEvent): Promise<boolean> {
        const links = this.junctionLinkMap?.get(`${event.schema}.${event.table}`)
            ?? this.junctionLinkMap?.get(event.table);
        if (!links?.length) return false;

        for (const link of links) {
            const sourceId = event.row?.[link.sourceColumn];
            const targetId = event.row?.[link.targetColumn];
            if (sourceId === undefined || sourceId === null || targetId === undefined || targetId === null) {
                this.debugLog(
                    `📡 [CDC] Junction row on ${event.table} is missing '${link.sourceColumn}'/'${link.targetColumn}' — skipping.`
                );
                continue;
            }

            const path = `${link.parentCollection.slug}/${String(sourceId)}/${link.relationKey}`;
            // An unlink removes the target from this list; a link invalidates it
            // so each subscriber refetches under its own RLS context.
            const row = event.op === "DELETE" ? null : { _rebase_invalidated: true };

            await this.notifyUpdate(
                path,
                String(targetId),
                row,
                (link.parentCollection as { databaseId?: string }).databaseId,
                /* broadcast */ false,
                /* origin */ "cdc"
            );
        }

        return true;
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

                    // A foreign sid is proof of a second process. Nothing here
                    // needs that fact, but the channel path does — see
                    // `warnIfMemoryBusOnMultiplePods`.
                    this.foreignInstanceSeen = true;

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
