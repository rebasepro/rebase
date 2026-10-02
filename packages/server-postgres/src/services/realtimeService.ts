import { WebSocket } from "ws";
import { EventEmitter } from "events";
import { Client as PgClient } from "pg";
import { randomUUID } from "crypto";
import { DataService } from "./dataService";

import { ANONYMOUS_USER_ID, FetchCollectionProps, ListenCollectionProps, ListenOneProps, DataDriver, CollectionUpdateMessage, CollectionUpdateMeta, IncludeSpec, SingleUpdateMessage, CollectionPatchMessage, WebSocketMessage, FilterValues, LogicalCondition, OrderByTuple, CollectionConfig, RebaseCallContext, resolveClientListLimit, ListLimitError } from "@rebasepro/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { RealtimeProvider, CollectionSubscriptionConfig, SingleSubscriptionConfig, DrizzleClient } from "../interfaces";
import { PostgresCollectionRegistry } from "../collections/PostgresCollectionRegistry";
import { buildPropertyCallbacks, getTableName, normalizeDriverOrderBy, OrderBySpecError, parseOrderBySpecStrict, requireCallbackCollection } from "@rebasepro/common";
import { applyAuthContext } from "../security/rls-enforcement";
import { withFieldViewer } from "./field-viewer";
import { buildJunctionLinkMap, type JunctionLink } from "./cdc/junction-tables";
import { collectionKeyColumns } from "./cdc/identity-columns";
import { ApiError, logger, rawQueryLoggingEnabled } from "@rebasepro/server";
import { assertReadRequestReadable } from "./read-field-access";
import { sanitizeErrorForClient } from "../utils/pg-error-utils";
import { CdcListener, type CdcChangeEvent } from "./cdc/CdcListener";
import { deriveRowAddress, getPrimaryKeys, type PrimaryKeyInfo } from "./collection-helpers";
import { isNestedPath } from "./nested-path";
import { ChannelHistoryStore, type ResolvedRetention } from "./channel-history";
import { ChannelPresenceStore } from "./channel-presence";
import { CHANNEL_BUS_NOTIFY_CHANNEL, ChannelBus, ChannelBusFrame, MemoryChannelBus, PostgresChannelBus, frameByteLength } from "./channel-bus";
import type { ChannelHistoryEntry, ChannelRetentionRule, RealtimeListenerHealth, User } from "@rebasepro/types";
import { unref } from "@rebasepro/utils";

/** Channel name used for Postgres LISTEN/NOTIFY cross-instance realtime. */
const PG_NOTIFY_CHANNEL = "rebase_entity_changes";

/**
 * Auth context stored per-subscription so real-time refetches respect RLS.
 * Mirrors the session variables set by PostgresBackendDriver.withAuth().
 */
export interface SubscriptionAuthContext {
    uid: string;
    roles: string[];
    /**
     * Whether this session is a guest — anonymous sign-in rather than an
     * account. Carried so a refetch's policies see the same principal the
     * initial fetch did; without it a rule that excludes guests would filter on
     * the REST read and not on the frames that follow, which is the shape that
     * makes a realtime leak invisible from the surface people test.
     */
    isAnonymous?: boolean;
    /**
     * The custom claims on the socket's token, for the same reason
     * `isAnonymous` is here: a refetch has to evaluate the same policies
     * against the same principal the initial fetch did. A tenancy policy reads
     * a claim, so a subscription that carried none would answer every frame
     * from the tenant of nobody — which is no rows, silently, on a collection
     * whose first page loaded fine.
     */
    claims?: Record<string, unknown>;
}

/**
 * A driver that can build a callback context inside a transaction it did not
 * open. `PostgresBackendDriver.callContextWithin` is the one implementation.
 */
interface CallContextMinter {
    callContextWithin(tx: DrizzleClient, user: User): RebaseCallContext;
}

function mintsCallContexts(driver: DataDriver | undefined): driver is DataDriver & CallContextMinter {
    return driver !== undefined && "callContextWithin" in driver && typeof driver.callContextWithin === "function";
}

/**
 * The context a subscription frame's `afterRead` hooks run with.
 *
 * It used to be assembled here by hand — `{ user, driver, data }` cast to
 * `RebaseCallContext` — and the cast hid two faults. `data` was the realtime
 * service's own driver, the base one on the owner connection, outside the
 * transaction this frame's rows were read in: a hook enriching rows through
 * `context.data` bypassed RLS on every frame, while the REST read of the same
 * rows, whose hooks run on the caller's transaction, did not. And `client` and
 * `storageSource`, which the type declares required, were missing, so a hook
 * that signs a URL or invokes a function worked over REST and failed every
 * `.listen()`. The driver now builds it, bound to `tx`, the way the REST path
 * builds it.
 *
 * Refuses rather than falling back: the fallback IS the unscoped context.
 */
function callbackContextWithin(driver: DataDriver | undefined, tx: DrizzleClient, auth: SubscriptionAuthContext): RebaseCallContext {
    if (!mintsCallContexts(driver)) {
        throw new Error("This driver cannot run afterRead hooks inside the subscriber's transaction.");
    }
    return driver.callContextWithin(tx, {
        uid: auth.uid,
        roles: auth.roles,
        isAnonymous: auth.isAnonymous === true,
        // What a socket does not carry, stated rather than invented.
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "realtime",
        ...(auth.claims ? { claims: auth.claims } : {})
    });
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
    orderBy?: string | OrderByTuple[];
    order?: "desc" | "asc";
    limit?: number;
    offset?: number;
    startAfter?: Record<string, unknown>;
    databaseId?: string;
    searchString?: string;
    /** Ask each row which declared search field matched — populates `_matches`. */
    searchExplain?: boolean;
    /**
     * Relations to load, exactly as a REST list would.
     *
     * A subscription could not name any, and the refetch loaded **every**
     * relation because it passed none — so `find()` returned a row with a
     * foreign key and `listen()` returned the same row with a nested object
     * where that key was. Same query, two shapes, and a client rendering both
     * saw the row change the moment a write landed.
     */
    include?: IncludeSpec;
    /** Columns to return — the same projection `?fields=` asks for. */
    fields?: string[];
    /** `SELECT DISTINCT` over the projection. */
    distinct?: boolean;
};

type RealTimeListenEntityProps = ListenOneProps & { subscriptionId: string };

/**
 * What an in-process listener asks for: the read, and who it reads as.
 * See {@link RealtimeService.startDataDriverSubscription}.
 */
export type DataDriverSubscriptionRequest = {
    path: string;
    /** The subscriber. Absent reads as the anonymous user. */
    authContext?: SubscriptionAuthContext;
    onError?: (error: unknown) => void;
} & (
    | { type: "collection"; collectionRequest: StoredCollectionRequest }
    | { type: "single"; id: string | number }
);

/**
 * A registered subscription, plus the two counters that order its deliveries.
 *
 * Every update a subscription delivers is a full re-fetch, and more than one
 * thing starts one for the same subscription without coordinating: the initial
 * fetch at subscribe time, and a debounced refetch per notification (app
 * mutation, cross-instance NOTIFY, or CDC). A fetch that started earlier can
 * finish later, and the delivery replaces everything the subscriber has — so
 * the subscriber goes back to the state before the change and stays there,
 * silently, until the next write to that collection.
 *
 * The debounce is not a fix for this. It collapses a burst into one refetch and
 * does nothing about two refetches that overlap: notification A fires its timer
 * and starts fetch A, notification B arrives while A is still in flight, and B's
 * timer fires and starts fetch B regardless. See class 44 in
 * `docs/bug-classes.md`.
 *
 * `started` is taken before the work, `delivered` after it — which makes the
 * last delivery *started* the last one *delivered*.
 */
type Subscription = {
    /** The id the client named it by — what every frame for it carries. */
    subscriptionId: string;
    clientId: string;
    /** The {@link SubscriptionGroup} whose refetch answers it. */
    groupKey: string;
    type: "collection" | "single";
    path: string;
    id?: string | number;
    // Store full collection request parameters for proper refetching
    collectionRequest?: StoredCollectionRequest;
    // Auth context for RLS — when set, refetches run in a transaction
    // with set_config('app.uid', ...) / set_config('app.user_roles', ...)
    authContext?: SubscriptionAuthContext;
    /**
     * An in-process listener's error callback, called when a refetch fails.
     * Kept on the subscription so it goes wherever the subscription goes: a
     * replaced or cancelled one takes its listener with it.
     */
    onError?: (error: unknown) => void;
    /** How many deliveries have been started for this subscription. */
    started: number;
    /** The highest started-sequence that has already reached the subscriber. */
    delivered: number;
};

/**
 * What `beginDelivery` returns. Called, it claims the slot for a delivery;
 * `mayReportFailure()` asks whether this delivery's failure may be reported.
 */
type DeliveryCheck = (() => boolean) & { mayReportFailure: () => boolean };

/**
 * Subscriptions one read answers: the same path, the same request, read as the
 * same principal.
 *
 * Every delivery is a refetch under the subscriber's own scope, which is what
 * keeps a frame from carrying a row its reader may not see. It used to be one
 * refetch — and, for a list, one count — per subscription, so a write to a
 * list a thousand people had open cost two thousand transactions, queued on the
 * pool every REST request shares. Subscriptions whose refetch would run the
 * same query as the same principal get the same rows, so they share one: the
 * group's. A frame is still built from a read under the reader's own identity;
 * only who else asked the identical question changes.
 *
 * An in-process listener is a group of one — its callback receives the rows
 * themselves, and two listeners must not share an array either may mutate.
 */
type SubscriptionGroup = {
    key: string;
    path: string;
    type: "collection" | "single";
    /** The row a single-row group reads, as a string. */
    id?: string;
    collectionRequest?: StoredCollectionRequest;
    authContext?: SubscriptionAuthContext;
    /** The subscriptions in the group, by internal key. */
    members: Set<string>;
    /**
     * Who the next refetch is for: `"all"` after a change on the path, or the
     * members that asked on their own — a re-scoped subscription, say.
     */
    pending: Set<string> | "all";
    /** When the last change arrived; the refetch waits for a quiet debounce window. */
    lastChangeAt: number;
    timer?: ReturnType<typeof setTimeout>;
};

/** `JSON.stringify` with object keys sorted, so equal requests have one spelling. */
function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, nested: unknown) => {
        if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
        return Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    });
}

/**
 * The default ceiling on subscriptions one socket may hold.
 *
 * Each collection subscription is a refetch on every write to its collection;
 * without a ceiling one socket could open tens of thousands and turn every
 * write anyone made into as many transactions. The SDK shares identical
 * subscriptions on a socket, so a real page holds one per distinct list or
 * record on screen — the admin panel's tables, forms and reference previews
 * stay well under this. See `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET`.
 */
export const DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET = 1000;

/**
 * Read a subscription ceiling, refusing anything that is not a positive whole
 * number. A typo here does not fall back to a default: the ceiling is a limit
 * someone chose, and silently running with another one is how it stops
 * meaning anything.
 */
export function parseMaxSubscriptionsPerSocket(value: unknown, source: string): number {
    const parsed = typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : value;
    if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
            `${source} must be a positive whole number of subscriptions per socket — got ${JSON.stringify(value)}.`
        );
    }
    return parsed;
}

/**
 * How long a client gets to answer the close frame at shutdown before its
 * socket is dropped. `ws` would otherwise wait its own 30s close timeout, which
 * is longer than the whole shutdown budget.
 */
const WEBSOCKET_CLOSE_GRACE_MS = 1_000;

/**
 * Close each socket with 1001, and terminate the ones still open after
 * `graceMs`. Nothing here waits: the HTTP server's close() is what waits for
 * the sockets to end.
 */
function closeWebSockets(sockets: WebSocket[], graceMs: number): void {
    for (const ws of sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.close(1001, "server shutting down");
        // A no-op on a socket that has closed by the time it fires.
        if (ws.readyState !== WebSocket.CLOSED) unref(setTimeout(() => ws.terminate(), graceMs));
    }
}

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
    /** The receiving half of the same ordering: retained bus frames per channel, one at a time. */
    private channelReceiveQueues = new Map<string, Promise<void>>();

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
    /**
     * Every subscription, by {@link subscriptionKey} — the client's own id
     * qualified by the client that chose it.
     *
     * Keyed by the bare id, this was one namespace for every socket: two raw
     * clients that both counted from `"sub-1"` replaced each other's
     * subscription without a word, and either one's `unsubscribe` ended the
     * other's.
     */
    private _subscriptions = new Map<string, Subscription>();

    /** In-process listeners' callbacks, by subscription key. */
    private subscriptionCallbacks = new Map<string, (data: Record<string, unknown>[] | Record<string, unknown> | null) => void>();

    /** Each client's subscriptions, by key — for its ceiling and its disconnect. */
    private subscriptionsByClient = new Map<string, Set<string>>();

    /** Subscriptions one refetch answers — see {@link SubscriptionGroup}. */
    private groups = new Map<string, SubscriptionGroup>();
    /**
     * The collection groups on each path, and the single-row groups at each
     * `path` + id: what a change looks up, instead of walking every
     * subscription on the server once per changed row.
     */
    private collectionGroupsByPath = new Map<string, Set<SubscriptionGroup>>();
    private singleGroupsByAddress = new Map<string, Set<SubscriptionGroup>>();
    /**
     * Every path a subscription holds, with the collection it lands on and how
     * many hold it — the candidates `aliasPaths` considers, resolved once.
     */
    private subscribedPaths = new Map<string, { slug?: string; count: number }>();

    /**
     * How many subscriptions one socket may hold; set from config at boot. See
     * {@link DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET}.
     */
    public maxSubscriptionsPerSocket = DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET;

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
    /**
     * How long an app-emit key suppresses its own CDC echo: the refetch
     * debounce, and no longer.
     *
     * The mark cannot tell an echo from another writer's change to the same
     * row, and a save that touches no row of the table (a to-many relation
     * only, an empty payload) is announced with no echo ever coming to consume
     * it. Held for seconds, it swallowed the next change psql, a cron or
     * another instance made to that row. Inside the debounce nothing is lost:
     * the refetch the app emit scheduled has not started yet — its timer fires
     * no earlier than this — and it reads after any commit whose NOTIFY has
     * already arrived. An echo later than that costs one more refetch.
     */
    private static readonly CDC_DEDUP_WINDOW_MS = RealtimeService.REFETCH_DEBOUNCE_MS;

    constructor(private db: NodePgDatabase<any>, private registry: PostgresCollectionRegistry) {
        super();
        // No call-context provider, deliberately. This service is the
        // *no-driver* fallback — the branches below that cannot apply a database
        // auth context either — and without a driver there is no context to
        // build a `beforeQuery` hook from. So a hooked collection's read here
        // refuses rather than being served unnarrowed, which is the direction a
        // fallback has to fail in: the fallbacks above it are already written
        // around not handing out *more* than the path they stand in for.
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

    /**
     * Verbose subscription tracing.
     *
     * Through the logger at `debug`, behind the same switch that lifts the
     * `Failed query:` redaction: these lines quote paths, filters and refetch
     * SQL, and a `console.debug` gated on `NODE_ENV` alone wrote them to stdout
     * whatever `LOG_LEVEL` said, without passing through the one function where
     * redaction lives.
     */
    private debugLog(...args: unknown[]) {
        if (!rawQueryLoggingEnabled()) return;
        logger.debug(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    }

    setDataDriver(driver: DataDriver) {
        this.driver = driver;
    }

    /**
     * The live subscriptions by the id their client gave them — for tests and
     * diagnostics. Two clients may use one id; this view shows the last.
     */
    get subscriptions(): ReadonlyMap<string, Subscription> {
        return new Map([...this._subscriptions.values()].map((subscription) => [subscription.subscriptionId, subscription]));
    }

    // =============================================================================
    // Subscription registry and refetch groups
    // =============================================================================

    /** The internal key of `subscriptionId` as `clientId` named it. */
    private subscriptionKey(clientId: string, subscriptionId: string): string {
        return `${clientId}\u0000${subscriptionId}`;
    }

    /**
     * The group a subscription's refetch belongs to. Socket subscriptions that
     * would run the same read as the same principal share one; an in-process
     * listener is always alone — see {@link SubscriptionGroup}.
     */
    private groupKeyFor(
        key: string,
        shared: boolean,
        target: { type: "collection" | "single"; path: string; id?: string | number; collectionRequest?: StoredCollectionRequest; authContext?: SubscriptionAuthContext }
    ): string {
        if (!shared) return `listener\u0000${key}`;
        const auth = target.authContext ?? { uid: ANONYMOUS_USER_ID, roles: ["anon"] };
        return canonicalJson({
            type: target.type,
            path: target.path,
            id: target.type === "single" ? String(target.id) : undefined,
            request: target.type === "collection" ? (target.collectionRequest ?? {}) : undefined,
            // Exactly what the refetch binds: `applyAuthContext` and the field
            // viewer read these and nothing else.
            uid: auth.uid,
            roles: auth.roles ?? [],
            isAnonymous: auth.isAnonymous === true,
            claims: auth.claims
        });
    }

    /**
     * Register (or replace) a subscription under `key`, in its group and in
     * every index that finds it.
     */
    private registerSubscription(key: string, subscription: Subscription): void {
        const previous = this._subscriptions.get(key);
        if (previous) this.leaveGroup(key, previous);
        this._subscriptions.set(key, subscription);

        let owned = this.subscriptionsByClient.get(subscription.clientId);
        if (!owned) this.subscriptionsByClient.set(subscription.clientId, owned = new Set());
        owned.add(key);

        let group = this.groups.get(subscription.groupKey);
        if (!group) {
            group = {
                key: subscription.groupKey,
                path: subscription.path,
                type: subscription.type,
                ...(subscription.type === "single" ? { id: String(subscription.id) } : {}),
                collectionRequest: subscription.collectionRequest,
                authContext: subscription.authContext,
                members: new Set(),
                pending: new Set(),
                lastChangeAt: 0
            };
            this.groups.set(group.key, group);
            const [index, address] = group.type === "collection"
                ? [this.collectionGroupsByPath, group.path]
                : [this.singleGroupsByAddress, `${group.path}\u0000${group.id}`];
            let bucket = index.get(address);
            if (!bucket) index.set(address, bucket = new Set());
            bucket.add(group);
        }
        group.members.add(key);

        // Counted once per registration; `leaveGroup` above took the replaced
        // one's count back.
        const held = this.subscribedPaths.get(subscription.path);
        if (held) held.count++;
        else this.subscribedPaths.set(subscription.path, { slug: this.collectionSlugAt(subscription.path), count: 1 });
    }

    /** Remove the subscription under `key` from everything that holds it. */
    private dropSubscription(key: string): void {
        const subscription = this._subscriptions.get(key);
        this.subscriptionCallbacks.delete(key);
        if (!subscription) return;
        this._subscriptions.delete(key);
        this.leaveGroup(key, subscription);
        const owned = this.subscriptionsByClient.get(subscription.clientId);
        owned?.delete(key);
        if (owned?.size === 0) this.subscriptionsByClient.delete(subscription.clientId);
    }

    /** Take `subscription` out of its group and path count; a group left empty goes, timer and all. */
    private leaveGroup(key: string, subscription: Subscription): void {
        const held = this.subscribedPaths.get(subscription.path);
        if (held && --held.count <= 0) this.subscribedPaths.delete(subscription.path);

        const group = this.groups.get(subscription.groupKey);
        if (!group) return;
        group.members.delete(key);
        if (group.pending !== "all") group.pending.delete(key);
        if (group.members.size > 0) return;
        if (group.timer) clearTimeout(group.timer);
        this.groups.delete(group.key);
        const [index, address] = group.type === "collection"
            ? [this.collectionGroupsByPath, group.path]
            : [this.singleGroupsByAddress, `${group.path}\u0000${group.id}`];
        const bucket = index.get(address);
        bucket?.delete(group);
        if (bucket?.size === 0) index.delete(address);
    }

    /**
     * Ask for a refetch of `group` once changes have been quiet for the
     * debounce window — for every member, or only for `member`.
     *
     * The window is measured from the last change, as a debounce is, but the
     * timer is not re-armed per change: a 10k-row statement is 10k changes,
     * and re-arming a timer per change per group was work in proportion to
     * both. A change only moves the timestamp; the timer, when it fires early,
     * waits out the rest.
     */
    private scheduleGroupRefetch(group: SubscriptionGroup, member?: string): void {
        if (member === undefined) group.pending = "all";
        else if (group.pending !== "all") group.pending.add(member);
        group.lastChangeAt = Date.now();
        if (!group.timer) this.armGroupTimer(group, RealtimeService.REFETCH_DEBOUNCE_MS);
    }

    private armGroupTimer(group: SubscriptionGroup, delayMs: number): void {
        group.timer = setTimeout(() => {
            group.timer = undefined;
            if (this.groups.get(group.key) !== group) return;
            const quietFor = Date.now() - group.lastChangeAt;
            if (quietFor < RealtimeService.REFETCH_DEBOUNCE_MS) {
                this.armGroupTimer(group, RealtimeService.REFETCH_DEBOUNCE_MS - quietFor);
                return;
            }
            void this.refetchGroup(group);
        }, delayMs);
    }

    /**
     * One read for the group, delivered to each member it is for.
     *
     * Each member still claims its own delivery slot before the read and
     * checks it after (see {@link beginDelivery}), so a member that left, was
     * replaced or was overtaken while the read ran is skipped exactly as it
     * was when it had a read of its own. A socket frame is serialised once and
     * only its subscription id differs per member.
     */
    private async refetchGroup(group: SubscriptionGroup): Promise<void> {
        const keys = group.pending === "all" ? [...group.members] : [...group.pending];
        group.pending = new Set();

        const targets: Array<{ key: string; subscription: Subscription; canDeliver: DeliveryCheck; callback?: (data: Record<string, unknown>[] | Record<string, unknown> | null) => void }> = [];
        for (const key of keys) {
            const subscription = this._subscriptions.get(key);
            if (!subscription || subscription.groupKey !== group.key) continue;
            if (subscription.clientId === "driver") {
                const callback = this.subscriptionCallbacks.get(key);
                if (!callback) continue;
                targets.push({ key, subscription, canDeliver: this.beginDelivery(key, subscription), callback });
            } else if (this.clients.has(subscription.clientId)) {
                targets.push({ key, subscription, canDeliver: this.beginDelivery(key, subscription) });
            }
        }
        if (targets.length === 0) return;

        try {
            if (group.type === "collection") {
                const request = group.collectionRequest ?? {};
                const rows = await this.fetchCollectionWithAuth(group.path, request, group.authContext);
                const toSockets = targets.some((target) => !target.callback);
                const meta = toSockets
                    ? await this.collectionMetaWithAuth(group.path, request, rows, group.authContext)
                    : undefined;
                let frameTail: string | undefined;
                for (const target of targets) {
                    if (!target.canDeliver()) continue;
                    if (target.callback) {
                        target.callback(rows);
                        continue;
                    }
                    frameTail ??= this.collectionFrameTail(rows, group.path, meta);
                    this.sendRaw(
                        target.subscription.clientId,
                        `{"type":"collection_update","subscriptionId":${JSON.stringify(target.subscription.subscriptionId)},${frameTail}`
                    );
                }
            } else {
                const row = (await this.fetchEntityWithAuth(group.path, group.id!, group.authContext)) ?? null;
                for (const target of targets) {
                    if (!target.canDeliver()) continue;
                    if (target.callback) target.callback(row);
                    else this.sendSingleUpdate(target.subscription.clientId, target.subscription.subscriptionId, row);
                }
            }
        } catch (error) {
            for (const target of targets) {
                if (target.callback) {
                    logger.error(`❌ [RealtimeService] Error in a refetch for DataDriver subscription ${target.subscription.subscriptionId}`, { error });
                    this.reportDriverFetchFailure(target.subscription, target.canDeliver, error);
                } else {
                    this.reportSocketFetchFailure(target.subscription.clientId, target.subscription.subscriptionId, group.path, error, target.canDeliver);
                }
            }
        }
    }

    /**
     * Claim a delivery slot for a subscription, before doing the work.
     *
     * Returns the check to run immediately before delivering. It refuses in
     * three cases, all of which used to deliver:
     *
     * - **Out of order.** A newer refetch has already delivered, so this one is
     *   stale — the subscriber would go back to the state before the change.
     * - **Unsubscribed.** The subscription was cancelled while the fetch was in
     *   flight. The `has(subscriptionId)` check the debounced refetches ran
     *   *before* the await cannot answer this; only a check after it can.
     * - **Replaced.** The same id can name a *different* subscription by the
     *   time a fetch lands — a re-subscribe overwrites the map entry, and the
     *   old filter's rows would be delivered to the new subscriber.
     *
     * The last two are identity, not presence: the map has to still hold *this
     * exact object*, not merely something under this id.
     *
     * A failure goes through the same slot, by `mayReportFailure()`: an error
     * frame from a stale, cancelled or replaced fetch would mark a view that
     * already shows newer rows as failed, or fail another subscription's view.
     * It also answers yes to the delivery that already claimed the slot, since
     * that is the send itself failing (a row that will not serialise) after the
     * check passed and before anything reached the subscriber.
     */
    private beginDelivery(key: string, subscription: Subscription): DeliveryCheck {
        const seq = ++subscription.started;
        const canDeliver = () => {
            if (this._subscriptions.get(key) !== subscription) return false;
            if (seq <= subscription.delivered) return false;
            subscription.delivered = seq;
            return true;
        };
        const mayReportFailure = () =>
            canDeliver() || (this._subscriptions.get(key) === subscription && subscription.delivered === seq);
        return Object.assign(canDeliver, { mayReportFailure });
    }

    /**
     * Start an in-process listener: register it, then deliver its first rows.
     *
     * The first fetch runs here, as the subscriber and through a delivery slot,
     * the way every refetch after it does. `PostgresBackendDriver.listen*` used
     * to run it themselves, outside this service, and got all three wrong: a
     * listener on `withAuth(user)` read its first rows on the owner connection,
     * so it was handed rows its policies deny; a slow first fetch landed over a
     * newer refetch, and after an unsubscribe; and a row listener never heard a
     * `null`. The subscriber's identity is part of the request because a
     * subscription registered first and stamped with it afterwards has a first
     * fetch that ran before the stamp.
     *
     * No `authContext` reads as the anonymous user, first fetch and refetches
     * alike — see {@link fetchCollectionWithAuth}.
     */
    startDataDriverSubscription(
        subscriptionId: string,
        request: DataDriverSubscriptionRequest,
        callback: (data: Record<string, unknown>[] | Record<string, unknown> | null) => void
    ): void {
        this.debugLog("📋 [RealtimeService] Starting DataDriver subscription:", subscriptionId, request.authContext ? "(with auth)" : "(no auth)");
        const key = this.subscriptionKey("driver", subscriptionId);
        const subscription: Subscription = {
            subscriptionId,
            clientId: "driver",
            groupKey: this.groupKeyFor(key, false, request),
            ...request,
            started: 0,
            delivered: 0
        };
        this.registerSubscription(key, subscription);
        this.subscriptionCallbacks.set(key, callback);
        void this.deliverFirstToDataDriver(key, subscription, callback);
    }

    private async deliverFirstToDataDriver(
        key: string,
        subscription: Subscription,
        callback: (data: Record<string, unknown>[] | Record<string, unknown> | null) => void
    ): Promise<void> {
        // Claimed before the fetch, as the socket's first fetch claims it: this
        // is the oldest read, so a refetch started while it runs outranks it.
        const canDeliver = this.beginDelivery(key, subscription);
        try {
            const data = subscription.type === "collection"
                ? await this.fetchCollectionWithAuth(subscription.path, subscription.collectionRequest ?? {}, subscription.authContext)
                : (await this.fetchEntityWithAuth(subscription.path, String(subscription.id), subscription.authContext)) ?? null;
            if (canDeliver()) callback(data);
        } catch (error) {
            logger.error(`❌ [RealtimeService] Error in the first fetch for DataDriver subscription ${subscription.subscriptionId}`, { error: error });
            this.reportDriverFetchFailure(subscription, canDeliver, error);
        }
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
        callback?: (rows: Record<string, unknown>[]) => void,
        onError?: (error: unknown) => void
    ): void {
        const key = this.subscriptionKey(config.clientId, subscriptionId);
        const target = {
            type: "collection" as const,
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
        };
        this.registerSubscription(key, {
            subscriptionId,
            clientId: config.clientId,
            groupKey: this.groupKeyFor(key, false, target),
            ...target,
            onError,
            started: 0,
            delivered: 0
        });

        if (callback) {
            this.subscriptionCallbacks.set(key, callback as (data: Record<string, unknown>[] | Record<string, unknown> | null) => void);
        }
    }

    /**
     * Subscribe to single row changes (RealtimeProvider interface)
     */
    subscribeToOne(
        subscriptionId: string,
        config: SingleSubscriptionConfig,
        callback?: (row: Record<string, unknown> | null) => void,
        onError?: (error: unknown) => void
    ): void {
        const key = this.subscriptionKey(config.clientId, subscriptionId);
        const target = { type: "single" as const, path: config.path, id: config.id };
        this.registerSubscription(key, {
            subscriptionId,
            clientId: config.clientId,
            groupKey: this.groupKeyFor(key, false, target),
            ...target,
            onError,
            started: 0,
            delivered: 0
        });

        if (callback) {
            this.subscriptionCallbacks.set(key, callback as (data: Record<string, unknown>[] | Record<string, unknown> | null) => void);
        }
    }

    /**
     * Unsubscribe an in-process subscription (RealtimeProvider interface).
     *
     * By id alone, because the in-process callers hold nothing else — so a
     * socket's subscription under the same id is not this one, and is left
     * alone. A socket ends its own through the `unsubscribe` frame.
     */
    unsubscribe(subscriptionId: string): void {
        for (const [key, subscription] of [...this._subscriptions.entries()]) {
            if (subscription.subscriptionId !== subscriptionId || this.clients.has(subscription.clientId)) continue;
            this.dropSubscription(key);
        }
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

        // Remove all subscriptions and callbacks for this client; a group it
        // was the last member of goes with its pending refetch.
        for (const key of [...(this.subscriptionsByClient.get(clientId) ?? [])]) {
            this.dropSubscription(key);
        }

        // The shared rows go before the announcement, not after it. Every
        // `removePresence` below publishes a departure — to local members and
        // over the bus — while `sendPresenceState` answers a *newly arriving*
        // subscriber from this table. Announcing first leaves a window where the
        // table still lists someone who has left: a client hydrating inside it is
        // handed the ghost, and the diff that would have corrected it was
        // broadcast before that client existed, so it holds the ghost until the
        // TTL sweep rather than for the length of one statement.
        //
        // One statement for every channel the client was in, rather than one per
        // channel below — a disconnect is the common case, not a rare one. The
        // subscription and timer cleanup above stays synchronous on purpose: it
        // is what leaks if the database is slow, and it owes nothing to the
        // shared table. With no bus configured this is a no-op that never awaits
        // a query.
        await this.presenceStoreOp(() => this.presenceStore!.removeClient(clientId), "client removal");

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

    /**
     * Refuse a new subscription past the socket's ceiling, and say so.
     *
     * Every collection subscription is a refetch on every write to its
     * collection, so a socket allowed to open them without limit could turn
     * each write anyone makes into tens of thousands of transactions. Replacing
     * a subscription the socket already holds — the same id again — is not a
     * new one and always passes. Returns whether the subscription may go ahead.
     */
    private admitSubscription(clientId: string, subscriptionId: string): boolean {
        const held = this.subscriptionsByClient.get(clientId);
        if (!held || held.size < this.maxSubscriptionsPerSocket) return true;
        if (held.has(this.subscriptionKey(clientId, subscriptionId))) return true;
        const message =
            `This connection already holds ${held.size} subscriptions, the most one connection may hold ` +
            `(REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET, or realtime.maxSubscriptionsPerSocket). Unsubscribe from one first.`;
        logger.warn(`[RealtimeService] Refused a subscription for ${clientId}: ${held.size} held, ceiling ${this.maxSubscriptionsPerSocket}`);
        this.sendError(clientId, message, subscriptionId, "TOO_MANY_SUBSCRIPTIONS");
        return false;
    }

    private async handleCollectionSubscription(clientId: string, request: RealTimeListenCollectionProps, authContext?: SubscriptionAuthContext) {
        const subscriptionId = request.subscriptionId;
        const key = this.subscriptionKey(clientId, subscriptionId);
        // Out here so the `catch` can check it. It is claimed before the fetch
        // starts, so a failed fetch always has one.
        let canDeliver: DeliveryCheck | undefined;

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

            if (!this.admitSubscription(clientId, subscriptionId)) return;

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

            // The sort arrives as whatever JSON the client put in the frame, so
            // its *shape* is checked here the way the REST ingress checks the
            // query parameter. Unchecked, a malformed entry reads as a field
            // name that resolves to no column, and under lenient unknown-field
            // handling the subscription then streams rows in no order at all
            // while reporting nothing wrong.
            let orderBy: OrderByTuple[] | undefined;
            try {
                orderBy = parseOrderBySpecStrict(request.orderBy, request.order);
            } catch (e) {
                if (!(e instanceof OrderBySpecError)) throw e;
                logger.warn(`[RealtimeService] Refused subscription to '${request.path}': ${e.message}`);
                this.sendError(clientId, e.message, subscriptionId, e.code);
                return;
            }

            // No filter, sort or projection over a field the subscriber may not
            // read — the rule `GET` and the socket's request frames apply. The
            // strip keeps the value out of every frame; a subscription filtered
            // on it would still answer, row by row, whether it matches. Judged
            // against the subscriber's roles, and `anon` for a socket that never
            // signed in: an absent viewer is the trusted server plane. The
            // request itself, with the sort as parsed above — not a re-listed
            // copy of some of its keys, which is how the stored `include`
            // went unchecked while every refetch applied it.
            try {
                assertReadRequestReadable(
                    { ...request, orderBy },
                    collection,
                    { roles: authContext?.roles ?? ["anon"] }
                );
            } catch (e) {
                if (!(e instanceof ApiError)) throw e;
                logger.warn(`[RealtimeService] Refused subscription to '${request.path}': ${e.message}`);
                this.sendError(clientId, e.message, subscriptionId, e.code);
                return;
            }

            // Store subscription with full request parameters and auth context for RLS
            const collectionRequest: StoredCollectionRequest = {
                filter: request.filter,
                logical: request.logical,
                orderBy,
                order: request.order,
                limit: boundedLimit,
                // `page` wins over `offset`, exactly as `FindParams`
                // documents and the REST parser applies it — one rule, so a
                // live list and the fetch behind it land on the same window.
                offset: request.page != null && request.page > 0
                    ? (request.page - 1) * boundedLimit
                    : request.offset,
                startAfter: request.startAfter as Record<string, unknown> | undefined,
                databaseId: request.collection?.databaseId,
                searchString: request.searchString,
                searchExplain: request.searchExplain,
                // Stored, so every refetch answers the same query the
                // initial fetch did. A field declared on the incoming props
                // and not stored here is accepted over the wire and then
                // silently ignored — which is what `offset` and `logical`
                // both were.
                include: request.include,
                fields: request.fields,
                distinct: request.distinct
            };
            const target = { type: "collection" as const, path: request.path, collectionRequest, authContext };
            const subscription: Subscription = {
                subscriptionId,
                clientId,
                groupKey: this.groupKeyFor(key, true, target),
                ...target,
                started: 0,
                delivered: 0
            };
            this.registerSubscription(key, subscription);

            // The subscription is registered before this fetch runs, so a write
            // arriving in that window starts a refetch of its own — with nothing
            // ordering the two. Claim a slot first: this fetch is the oldest, so
            // if the refetch answers first, this one no longer delivers.
            canDeliver = this.beginDelivery(key, subscription);

            // Send initial data. Built from the request the subscription just
            // stored, so the first answer and every refetch after it cannot
            // describe different queries.
            const rows = await this.fetchCollectionWithAuth(
                request.path,
                subscription.collectionRequest!,
                authContext
            );
            const meta = await this.collectionMetaWithAuth(
                request.path, subscription.collectionRequest!, rows, authContext
            );

            if (canDeliver()) {
                this.sendCollectionUpdate(clientId, subscriptionId, rows, request.path, meta);
            }

        } catch (error) {
            this.reportSocketFetchFailure(clientId, subscriptionId, request.path, error, canDeliver);
        }
    }

    private async handleEntitySubscription(clientId: string, request: RealTimeListenEntityProps, authContext?: SubscriptionAuthContext) {
        const subscriptionId = request.subscriptionId;
        const key = this.subscriptionKey(clientId, subscriptionId);
        // As in the collection case: claimed before the fetch, checked in the `catch`.
        let canDeliver: DeliveryCheck | undefined;

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

            if (!this.admitSubscription(clientId, subscriptionId)) return;

            // Store subscription in memory with auth context for RLS
            const target = { type: "single" as const, path: request.path, id: request.id, authContext };
            const subscription: Subscription = {
                subscriptionId,
                clientId,
                groupKey: this.groupKeyFor(key, true, target),
                ...target,
                started: 0,
                delivered: 0
            };
            this.registerSubscription(key, subscription);

            // Same race as the collection case: a write landing between the
            // registration above and this fetch starts a refetch that can answer
            // first, and this one must not overwrite it afterwards.
            canDeliver = this.beginDelivery(key, subscription);

            // Send initial data
            const row = await this.fetchEntityWithAuth(
                request.path,
                String(request.id),
                authContext
            );

            if (canDeliver()) {
                this.sendSingleUpdate(clientId, subscriptionId, row || null);
            }

        } catch (error) {
            this.reportSocketFetchFailure(clientId, subscriptionId, request.path, error, canDeliver);
        }
    }

    /**
     * Answer a subscriber's failed fetch with an error frame, through the slot
     * its rows would have used.
     *
     * The error is always logged (`sanitizeErrorForClient` does that), but the
     * frame goes out only while this fetch holds the newest slot. A failed
     * straggler used to send one regardless. The client routes errors by
     * `subscriptionId`, so it called `onError` for a view already showing newer
     * rows, or for the subscription that replaced this one under the same id.
     *
     * With no slot, the subscribe failed before its fetch began. That part runs
     * synchronously, so nothing else can have answered the request yet.
     */
    private reportSocketFetchFailure(
        clientId: string,
        subscriptionId: string,
        path: string,
        error: unknown,
        canDeliver: DeliveryCheck | undefined
    ) {
        const sanitized = sanitizeErrorForClient(error, path);
        if (canDeliver && !canDeliver.mayReportFailure()) return;
        this.sendError(clientId, sanitized.message, subscriptionId, sanitized.code);
    }

    /**
     * Re-judge everything a socket holds open as the identity it has now.
     *
     * A socket re-authenticates on every session refresh, and when a role is
     * taken away, a tenant claim removed or a different account signs in, the
     * next token says so. Requests read as the new identity at once; the
     * subscriptions kept refetching as the one they were opened with, so a
     * demoted user went on receiving editor-only or another tenant's rows for
     * as long as the view stayed mounted.
     *
     * Each of this client's subscriptions is replaced by one carrying the new
     * identity — a replacement, so a refetch already running as the old one
     * cannot deliver — and refetched, so the view narrows now rather than at
     * the next write. A subscription whose filter, sort or projection names a
     * field the new roles may not read is ended with the refusal a new
     * subscription would get. Channel memberships are put to the authorizer
     * again, when one is installed, and left when it refuses.
     */
    async rescopeClient(clientId: string, authContext: SubscriptionAuthContext): Promise<void> {
        for (const key of [...(this.subscriptionsByClient.get(clientId) ?? [])]) {
            const subscription = this._subscriptions.get(key);
            if (!subscription) continue;
            const subscriptionId = subscription.subscriptionId;

            if (subscription.type === "collection" && subscription.collectionRequest) {
                const collection = this.registry.getCollectionByPath(subscription.path);
                const request = subscription.collectionRequest;
                try {
                    if (collection) {
                        assertReadRequestReadable(
                            {
                                // Stored from the subscription's own request, which carried it as one.
                                filter: request.filter as FilterValues<string>,
                                logical: request.logical,
                                orderBy: request.orderBy,
                                fields: request.fields
                            },
                            collection,
                            { roles: authContext.roles ?? ["anon"] }
                        );
                    }
                } catch (e) {
                    if (!(e instanceof ApiError)) throw e;
                    await this.handleUnsubscribe(clientId, subscriptionId);
                    this.sendError(clientId, e.message, subscriptionId, e.code);
                    continue;
                }
            }

            // A new identity is a new group: the read it shares is now the one
            // its new principal's subscriptions run.
            const rescoped: Subscription = {
                ...subscription,
                authContext,
                groupKey: this.groupKeyFor(key, true, { ...subscription, authContext }),
                started: 0,
                delivered: 0
            };
            this.registerSubscription(key, rescoped);
            const group = this.groups.get(rescoped.groupKey);
            if (group) this.scheduleGroupRefetch(group, key);
        }

        const authorizer = this.channelAuthorizer;
        if (!authorizer) return;
        for (const [channel, members] of [...this.channels.entries()]) {
            if (!members.has(clientId)) continue;
            let allowed: boolean;
            try {
                allowed = await authorizer({ channel, action: "join", clientId, user: authContext });
            } catch (error) {
                logger.error(`❌ [Channels] Authorizer threw re-checking "${channel}" after a sign-in — leaving it`, { error });
                allowed = false;
            }
            if (!allowed) {
                this.leaveChannel(clientId, channel);
                this.denyChannelAction(clientId, channel, "join", "refused by the channel authorizer for the identity this socket signed in as");
            }
        }
    }

    /**
     * End a socket's own subscription. Only its own: the id is the client's,
     * so another socket's subscription under the same id is a different one.
     */
    private async handleUnsubscribe(clientId: string, subscriptionId: string) {
        this.dropSubscription(this.subscriptionKey(clientId, subscriptionId));
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
        // The same row under the other paths a subscriber can address it by —
        // see `aliasPaths`.
        const aliases = this.aliasPaths(path);

        if (this.cdcActive) {
            const key = this.dedupKey(path, id, databaseId);
            if (origin === "cdc") {
                if (this.consumeAppEmit(key)) {
                    this.debugLog("🔁 [RealtimeService] Suppressing CDC echo of local app mutation:", key);
                    return;
                }
            } else {
                this.markAppEmit(key);
                // CDC reports the change under the table's own collection, so a
                // write through a nested path echoes back under the root one.
                // The aliases below have already delivered it there.
                if (isNestedPath(path)) {
                    const root = aliases.find(alias => !isNestedPath(alias));
                    if (root) this.markAppEmit(this.dedupKey(root, id, databaseId));
                }
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
            this.notifyPathUpdate(notifyPath, path, id);
        }

        // Each alias is an address of this very row, so its single-row
        // subscribers match by id exactly as the written path's do.
        for (const alias of aliases) {
            this.notifyPathUpdate(alias, alias, id);
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
     * Notify subscriptions for a specific path.
     *
     * **A subscriber only ever receives rows re-read under its own scope.**
     * `row` is used to decide *that* something changed, never to say *what* —
     * every delivery below goes through a refetch that binds the subscription's
     * own auth context.
     *
     * It used to be conditional. The CDC path already did the right thing: it
     * discards the captured tuple and emits `{_rebase_invalidated: true}`, and
     * that marker selected the refetch branch. But the marker is produced in
     * exactly two places, and the *other* side of each branch here shipped the
     * row it was handed straight to the socket. Two of the three entry paths
     * took that side — every API mutation (`PostgresBackendDriver.save` passes
     * the row it just wrote, read under the **writer's** scope) and the legacy
     * cross-instance LISTEN handler (which re-reads on the owner connection,
     * bypassing RLS altogether). Path matching was the only filter applied: the
     * subscription's own `filter`/`logical` was never evaluated, and any
     * `afterRead` redaction was the writer's rather than the reader's.
     *
     * A single-row subscription was the sharpest case. `subscribe_one` on a row
     * RLS denies is accepted and answered `null`; the next update then pushed
     * the full row with no later correction. The collection variant was merely
     * papered over ~300 ms later by the debounced refetch — after the bytes had
     * already reached the browser.
     *
     * The same defect was found and fixed on the Mongo driver in `065e2b615`
     * (see `packages/server-mongo/test/realtime-authorization.test.ts`); this is
     * the Postgres half, stated as one rule rather than three patched branches.
     *
     * The cost is the instant row-level patch that used to precede the refetch:
     * cross-tab feedback now waits for the debounce. That is the price of not
     * being able to know, without asking the database as this subscriber,
     * whether this subscriber may see the row at all.
     */
    private notifyPathUpdate(notifyPath: string, originalPath: string, id: string) {
        this.debugLog(`📡 [RealtimeService] Notifying path: ${notifyPath} (original: ${originalPath})`);

        // Every list on the path may have changed. A single-row subscription
        // is asked only at the written path, and only for its own row: a
        // parent path is a different record.
        for (const group of this.collectionGroupsByPath.get(notifyPath) ?? []) {
            this.scheduleGroupRefetch(group);
        }
        if (notifyPath !== originalPath) return;
        for (const group of this.singleGroupsByAddress.get(`${notifyPath}\u0000${id}`) ?? []) {
            this.scheduleGroupRefetch(group);
        }
    }

    /**
     * Tell an in-process listener its refetch failed, through the slot the
     * rows would have used.
     *
     * The two driver-refetch `catch` blocks used to log and stop, so the
     * listener heard nothing and kept its last rows as if they were current.
     * The error goes to it as thrown: this is trusted server code, and the
     * masking on the socket path is for clients. The slot keeps a failed
     * straggler from reporting over newer rows, and keeps a failure away from
     * a subscription that was cancelled or replaced while it ran.
     */
    private reportDriverFetchFailure(
        subscription: Subscription,
        canDeliver: () => boolean,
        error: unknown
    ) {
        if (!subscription.onError || !canDeliver()) return;
        try {
            subscription.onError(error);
        } catch (listenerError) {
            // Contained: this runs in a timer, where a throw would be an
            // unhandled rejection.
            logger.error(`❌ [RealtimeService] onError threw for DataDriver subscription ${subscription.subscriptionId}`, { error: listenerError });
        }
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
            // Always wrap in a transaction with session vars, defaulting to anonymous context if missing.
            // Refetches are reads: apply the same GUCs + reader-role downgrade as the
            // driver's read path, so realtime cannot leak rows the initial fetch hid.
            // `READ ONLY` like that path too (here, in the count and in the row
            // refetch): an `afterRead` that writes is refused with 25006 on every
            // request read, and a frame must not be the one door where it commits
            // — once per row, per subscriber, on every change anyone makes.
            const activeAuth = authContext || { uid: ANONYMOUS_USER_ID,
roles: ["anon"] };
            // The subscriber this frame is for, so per-field `access.read` is
            // applied to it. A frame is a read like any other and reaches the
            // same row pipeline; without this the initial `GET` would withhold a
            // field and the first `.listen()` update would hand it over.
            return await withFieldViewer({ roles: activeAuth.roles ?? [] }, async () =>
                await this.db.transaction(async (tx) => {
                    await applyAuthContext(
                        tx,
                        {
                            uid: activeAuth.uid,
                            roles: activeAuth.roles,
                            isAnonymous: activeAuth.isAnonymous === true,
                            // A refetch is a read under the same identity, and a
                            // tenancy policy reads a claim — without these a
                            // subscriber would receive rows the initial GET hid.
                            claims: activeAuth.claims
                        },
                        this.rlsUserRole
                    );
                    // Bound to the subscriber's own transaction and identity, so
                    // a `beforeQuery` narrows a subscription frame exactly as it
                    // narrows the `find()` that asked the same question. Lazy and
                    // memoized: nothing is built for a collection with no hook.
                    let hookContext: RebaseCallContext | undefined;
                    const txEntityService = new DataService(
                        tx, this.registry,
                        () => (hookContext ??= callbackContextWithin(this.driver, tx, activeAuth))
                    );
                    // The REST pipeline, not the driver's own fetch — one
                    // query, one include loader, one place search is decided.
                    //
                    // These are the rows a subscriber receives, and a subscriber
                    // asked the same question a `find()` asks — so they are the
                    // same rows, in the same shape, for every consumer on this
                    // wire. The admin panel included: it builds the view model
                    // it renders (dates as `Date`, relations as refs) in the
                    // browser, from the collection config it already has — see
                    // `toViewModelValues` in `buildRebaseData`. There is no
                    // second wire shape to keep in step with this one.
                    const fetchedEntities = await txEntityService.fetchCollectionForRest(notifyPath, {
                        filter: collectionRequest.filter as FilterValues<string>,
                        // The subscription stored a group; the search branch used to
                        // drop it, so a filtered live search widened to every row
                        // matching the text.
                        logical: collectionRequest.logical,
                        orderBy: collectionRequest.orderBy,
                        order: collectionRequest.order,
                        limit: collectionRequest.limit,
                        offset: collectionRequest.offset,
                        startAfter: collectionRequest.startAfter,
                        searchString: collectionRequest.searchString,
                        searchExplain: collectionRequest.searchExplain,
                        databaseId: collectionRequest.databaseId,
                        fields: collectionRequest.fields,
                        distinct: collectionRequest.distinct
                    }, collectionRequest.include);

                    // Re-apply `afterRead` lifecycle hooks to ensure consistent data structures
                    // between the initial driver fetch and this RLS-bound refetch.
                    const registryCollection = this.registry.getCollectionByPath(notifyPath);
                    // `| undefined`, and now it says so: the registry answers
                    // nothing for a path it does not know. The cast used to
                    // erase that one line above the `?.` that admits it.
                    const resolvedCollection: CollectionConfig | undefined = collection
                        ? { ...collection, ...registryCollection } as CollectionConfig
                        : registryCollection;

                    const callbacks = resolvedCollection?.callbacks;
                    const globalCallbacks = this.registry?.getGlobalCallbacks();
                    const propertyCallbacks = resolvedCollection?.properties ? buildPropertyCallbacks(resolvedCollection.properties) : undefined;

                    if (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead) {
                        // Bound to THIS transaction — the subscriber's — see
                        // callbackContextWithin below for what this used to be.
                        const contextForCallback = callbackContextWithin(this.driver, tx, activeAuth);

                        const callbackCollection = requireCallbackCollection(resolvedCollection, notifyPath);
                        return await Promise.all(fetchedEntities.map(async (fetchedRow) => {
                            let processedEntity = fetchedRow;
                            // 1. Global callbacks first
                            if (globalCallbacks?.afterRead) {
                                processedEntity = await globalCallbacks.afterRead({
                                    collection: callbackCollection,
                                    path: notifyPath,
                                    row: processedEntity,
                                    context: contextForCallback
                                }) ?? processedEntity;
                            }
                            // 2. Collection callbacks second
                            if (callbacks?.afterRead) {
                                processedEntity = await callbacks.afterRead({
                                    collection: callbackCollection,
                                    path: notifyPath,
                                    row: processedEntity,
                                    context: contextForCallback
                                }) ?? processedEntity;
                            }
                            // 3. Property callbacks third
                            if (propertyCallbacks?.afterRead) {
                                processedEntity = await propertyCallbacks.afterRead({
                                    collection: callbackCollection,
                                    path: notifyPath,
                                    row: processedEntity,
                                    context: contextForCallback
                                }) ?? processedEntity;
                            }
                            return processedEntity;
                        }));
                    }

                    return fetchedEntities;
                }, { accessMode: "read only" })
            );
        }

        // No driver — use dataService directly (no auth wrapping possible).
        // The `logical` group is carried here as well: this branch answers the
        // same subscription as the one above, and a fallback that drops a
        // condition returns *more* rows than the path it stands in for.
        //
        // The field viewer IS established, unlike the database's auth context:
        // the subscriber's roles are in hand either way, and leaving the scope
        // off would make this the one path where a role-restricted field is
        // served to everybody — a fallback that hands out *more* than the path
        // it stands in for, which is the defect the paragraph above describes
        // one clause at a time.
        return await withFieldViewer({ roles: authContext?.roles ?? [] }, async () =>
            await this.dataService.fetchCollectionForRest(notifyPath, {
                filter: collectionRequest.filter as FilterValues<string>,
                logical: collectionRequest.logical,
                orderBy: collectionRequest.orderBy,
                order: collectionRequest.order,
                limit: collectionRequest.limit,
                offset: collectionRequest.offset,
                startAfter: collectionRequest.startAfter,
                searchString: collectionRequest.searchString,
                searchExplain: collectionRequest.searchExplain,
                databaseId: collectionRequest.databaseId,
                fields: collectionRequest.fields,
                distinct: collectionRequest.distinct
            }, collectionRequest.include)
        );
    }

    /**
     * The `meta` a `collection_update` frame carries beside its rows.
     *
     * Frames used to carry rows and primary keys and nothing else, so the
     * client issued a `GET /count` **per push** to fill in a total it needed to
     * render the same list it had just been handed — one extra round trip per
     * write, per subscriber, forever. The refetch already knows the query; it
     * counts once, here, under the same RLS transaction that read the rows, so
     * the total describes the same set they came from.
     */
    private async collectionMetaWithAuth(
        notifyPath: string,
        collectionRequest: StoredCollectionRequest,
        rows: Record<string, unknown>[],
        authContext?: SubscriptionAuthContext
    ): Promise<CollectionUpdateMeta> {
        const limit = collectionRequest.limit ?? rows.length;
        const offset = collectionRequest.offset ?? 0;

        const countOnce = async (service: DataService) => service.count(notifyPath, {
            filter: collectionRequest.filter as FilterValues<string>,
            logical: collectionRequest.logical,
            searchString: collectionRequest.searchString,
            databaseId: collectionRequest.databaseId
        });

        let total: number;
        try {
            if (this.driver) {
                const activeAuth = authContext || { uid: ANONYMOUS_USER_ID, roles: ["anon"] };
                total = await this.db.transaction(async (tx) => {
                    await applyAuthContext(
                        tx,
                        {
                            uid: activeAuth.uid,
                            roles: activeAuth.roles,
                            isAnonymous: activeAuth.isAnonymous === true,
                            // A refetch is a read under the same identity, and a
                            // tenancy policy reads a claim — without these a
                            // subscriber would receive rows the initial GET hid.
                            claims: activeAuth.claims
                        },
                        this.rlsUserRole
                    );
                    // The same narrowing as the rows it is counting: a frame
                    // whose `meta.total` came from an unnarrowed count says
                    // "1 of 4 results".
                    let hookContext: RebaseCallContext | undefined;
                    return countOnce(new DataService(
                        tx, this.registry,
                        () => (hookContext ??= callbackContextWithin(this.driver, tx, activeAuth))
                    ));
                }, { accessMode: "read only" });
            } else {
                total = await countOnce(this.dataService);
            }
        } catch (error) {
            // A count that failed says nothing about the size of the
            // collection, and a frame with no `meta` is one the client can fall
            // back on. Reporting `rows.length` would claim a page read at
            // offset 10 held two rows.
            logger.warn(`[RealtimeService] Could not count '${notifyPath}' for a subscription frame`, { error });
            return { limit, offset, hasMore: false, partial: true };
        }

        const last = rows[rows.length - 1];
        const hasMore = offset + rows.length < total;
        const nextCursor = (hasMore && last)
            ? this.dataService.cursorFor?.(
                notifyPath, last, normalizeDriverOrderBy(collectionRequest.orderBy, collectionRequest.order)
            )
            : undefined;

        return { total, limit, offset, hasMore, ...(nextCursor && { nextCursor }) };
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
            // Always wrap in a transaction with session vars, defaulting to anonymous context if missing.
            // Same read isolation as collection refetches: GUCs + reader-role downgrade.
            const activeAuth = authContext || { uid: ANONYMOUS_USER_ID,
roles: ["anon"] };
            // The subscriber this frame is for, so per-field `access.read` is
            // applied to it. A frame is a read like any other and reaches the
            // same row pipeline; without this the initial `GET` would withhold a
            // field and the first `.listen()` update would hand it over.
            return await withFieldViewer({ roles: activeAuth.roles ?? [] }, async () =>
                await this.db.transaction(async (tx) => {
                    await applyAuthContext(
                        tx,
                        {
                            uid: activeAuth.uid,
                            roles: activeAuth.roles,
                            isAnonymous: activeAuth.isAnonymous === true,
                            // A refetch is a read under the same identity, and a
                            // tenancy policy reads a claim — without these a
                            // subscriber would receive rows the initial GET hid.
                            claims: activeAuth.claims
                        },
                        this.rlsUserRole
                    );
                    // Bound to the subscriber's own transaction and identity, so
                    // a `beforeQuery` narrows a subscription frame exactly as it
                    // narrows the `find()` that asked the same question. Lazy and
                    // memoized: nothing is built for a collection with no hook.
                    let hookContext: RebaseCallContext | undefined;
                    const txEntityService = new DataService(
                        tx, this.registry,
                        () => (hookContext ??= callbackContextWithin(this.driver, tx, activeAuth))
                    );
                    // The REST pipeline, for the same reason the collection refetch
                    // uses it: `listenById()` and `findById()` are the same read,
                    // and `fetchOne` renders the admin's view model — every relation
                    // eagerly loaded, each under a `{ __type: "relation" }`
                    // envelope. A subscriber got one shape and a fetch the other.
                    let processedEntity = await txEntityService.fetchOneForRest(
                        notifyPath, id, undefined, collection?.databaseId
                    ) ?? undefined;

                    if (processedEntity) {
                        const registryCollection = this.registry.getCollectionByPath(notifyPath);
                        // See the note on the collection refetch above.
                        const resolvedCollection: CollectionConfig | undefined = collection
                            ? { ...collection, ...registryCollection } as CollectionConfig
                            : registryCollection;

                        const callbacks = resolvedCollection?.callbacks;
                        const globalCallbacks = this.registry?.getGlobalCallbacks();
                        const propertyCallbacks = resolvedCollection?.properties ? buildPropertyCallbacks(resolvedCollection.properties) : undefined;

                        if (globalCallbacks?.afterRead || callbacks?.afterRead || propertyCallbacks?.afterRead) {
                            const contextForCallback = callbackContextWithin(this.driver, tx, activeAuth);
                            const callbackCollection = requireCallbackCollection(resolvedCollection, notifyPath);

                            // 1. Global callbacks first
                            if (globalCallbacks?.afterRead) {
                                processedEntity = await globalCallbacks.afterRead({
                                    collection: callbackCollection,
                                    path: notifyPath,
                                    row: processedEntity,
                                    context: contextForCallback
                                }) ?? processedEntity;
                            }
                            // 2. Collection callbacks second
                            if (callbacks?.afterRead) {
                                processedEntity = await callbacks.afterRead({
                                    collection: callbackCollection,
                                    path: notifyPath,
                                    row: processedEntity,
                                    context: contextForCallback
                                }) ?? processedEntity;
                            }
                            // 3. Property callbacks third
                            if (propertyCallbacks?.afterRead) {
                                processedEntity = await propertyCallbacks.afterRead({
                                    collection: callbackCollection,
                                    path: notifyPath,
                                    row: processedEntity,
                                    context: contextForCallback
                                }) ?? processedEntity;
                            }
                        }
                    }

                    return processedEntity;
                }, { accessMode: "read only" })
            );
        }

        // Same reasoning as the collection fallback above: no database auth
        // context is available here, but the subscriber's roles are.
        return await withFieldViewer(
            { roles: authContext?.roles ?? [] },
            async () => (await this.dataService.fetchOneForRest(notifyPath, id)) ?? undefined
        );
    }

    private sendCollectionUpdate(
        clientId: string,
        subscriptionId: string,
        rows: Record<string, unknown>[],
        path: string,
        meta?: CollectionUpdateMeta
    ) {
        const message: CollectionUpdateMessage = {
            type: "collection_update",
            subscriptionId,
            rows: rows,
            pks: this.primaryKeysForPath(path),
            // Beside the rows rather than fetched afterwards — see
            // {@link CollectionUpdateMeta} for the round trip this removes.
            ...(meta && { meta })
        };
        this.sendMessage(clientId, message);
    }

    /**
     * Everything in a `collection_update` frame after its subscription id,
     * serialised once for every member of a group: the same rows, keys and
     * meta as {@link sendCollectionUpdate} sends, in the same order.
     */
    private collectionFrameTail(rows: Record<string, unknown>[], path: string, meta?: CollectionUpdateMeta): string {
        return JSON.stringify({
            rows,
            pks: this.primaryKeysForPath(path),
            ...(meta && { meta })
        }).slice(1);
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

    /**
     * `channel` addresses the error to the channel frame it is about.
     *
     * Without it the client had nowhere to deliver a channel error: channel
     * frames are fire-and-forget, so there is no pending request to reject and
     * no subscription id to match, and `CHANNEL_FORBIDDEN`, `RATE_LIMITED` and
     * the two history failures fell through every branch of the client's
     * message handler into a console warning. The client already routes
     * channel-addressed frames by name — `onChannelMessage(channel, …)` — so
     * naming the channel is all that was missing.
     *
     * Additive on the wire: a client that does not read it behaves as before.
     */
    private sendError(clientId: string, error: string, subscriptionId?: string, code?: string, channel?: string) {
        const message = {
            type: "error" as const,
            subscriptionId,
            ...(channel !== undefined && { channel }),
            payload: {
                error: code ? { message: error, code } : error,
                ...(channel !== undefined && { channel })
            },
            error
        };
        this.sendMessage(clientId, message);
    }

    private sendMessage(clientId: string, message: CollectionUpdateMessage | SingleUpdateMessage | CollectionPatchMessage | { type: string; subscriptionId?: string; error?: string; payload?: unknown }) {
        this.sendRaw(clientId, JSON.stringify(message));
    }

    /** Send an already-serialised frame to a client, if it is still connected. */
    private sendRaw(clientId: string, frame: string) {
        const client = this.clients.get(clientId);
        if (client && client.readyState === WebSocket.OPEN) {
            client.send(frame);
        }
    }

    /**
     * Extract parent paths from a nested path like "posts/70/tags"
     * Returns ["posts", "posts/70"] for the example above
     */
    /**
     * The other paths a subscriber can address the row written at `path` by.
     *
     * `authors/1/posts` and `posts` are two addresses for the same rows, and
     * subscriptions were matched by the written path's exact string. So a post
     * saved through `authors/1/posts` never reached a subscriber of `posts` or
     * of `posts/43`, and one saved through `posts` never reached a subscriber
     * of `authors/1/posts`, whose list it may just have joined or left.
     *
     * The aliases are the target collection's root path, and every nested path
     * a live subscription holds that lands on the same collection. Each still
     * refetches under its own scope and its own parent, so naming a path here
     * decides only who is asked to look again — never what they are shown.
     */
    private aliasPaths(path: string): string[] {
        const slug = this.collectionSlugAt(path);
        if (!slug) return [];
        const aliases = new Set<string>();
        if (slug !== path) aliases.add(slug);
        // The paths subscriptions hold, each resolved once when it was first
        // subscribed — not every subscription on the server, once per change.
        for (const [subscribed, held] of this.subscribedPaths) {
            if (subscribed === path || aliases.has(subscribed) || !isNestedPath(subscribed)) continue;
            if (held.slug === slug) aliases.add(subscribed);
        }
        return [...aliases];
    }

    /** The slug of the collection a path lands on, or `undefined` for one that names none. */
    private collectionSlugAt(path: string): string | undefined {
        try {
            return this.registry.getCollectionByPath(path)?.slug;
        } catch {
            // A malformed or stale path names no collection, and a
            // notification is not the place to refuse it.
            return undefined;
        }
    }

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
            "CHANNEL_FORBIDDEN",
            channel
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
            "reach only the clients connected to this one. Set `realtime.bus` (or REALTIME_CHANNEL_BUS=postgres) " +
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
        // Over the Postgres bus the message is announced by the statement that
        // numbers it, and every instance — this one too — delivers it when the
        // announcement arrives: in commit order, which is sequence order. Fanned
        // out here first, a reader on this instance got this instance's N+1
        // before another's N, and a client that keeps a watermark dropped N for
        // good. The announcement is a pointer, whatever the message's size: any
        // database login can LISTEN, so the body stays in the history table and
        // each instance reads it back. See `ChannelHistoryStore.append`.
        const ordered = this.bus instanceof PostgresChannelBus;
        let seq: number;
        try {
            ({ seq } = await this.channelHistory!.append(channel, event, payload, clientId, ordered ? {
                notifyChannel: CHANNEL_BUS_NOTIFY_CHANNEL,
                sid: this.instanceId
            } : undefined));
        } catch (error) {
            logger.error(`❌ [ChannelHistory] Could not persist broadcast on "${channel}" — message dropped`, { error });
            this.sendError(
                clientId,
                `Could not persist broadcast on retained channel "${channel}"`,
                undefined,
                "CHANNEL_HISTORY_WRITE_FAILED",
                channel
            );
            return;
        }

        if (!ordered) {
            this.fanOutBroadcast(clientId, channel, event, payload, seq);
            this.publishBroadcast(clientId, channel, event, payload, seq);
        }

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
            "CHANNEL_BUS_PAYLOAD_TOO_LARGE",
            channel
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
        const retained = (frame.kind === "broadcast" || frame.kind === "broadcast_ref") && frame.seq !== undefined;
        // Our own frames were fanned out before they were published — except a
        // retained one over the Postgres bus, which reaches this instance's
        // clients only this way. See `persistAndFanOut`.
        if (frame.sid === this.instanceId && !(retained && this.bus instanceof PostgresChannelBus)) return;
        if (!retained) return this.deliverBusFrame(frame);

        // In the order they arrived, per channel: a pointer is read back from
        // the history table, and the frame after it must not overtake it.
        const previous = this.channelReceiveQueues.get(frame.channel) ?? Promise.resolve();
        const next = previous.catch(() => { /* reported where it failed */ }).then(() => this.deliverBusFrame(frame));
        this.channelReceiveQueues.set(frame.channel, next);
        void next.finally(() => {
            if (this.channelReceiveQueues.get(frame.channel) === next) this.channelReceiveQueues.delete(frame.channel);
        }).catch(() => { /* reported where it failed */ });
        return next;
    }

    private async deliverBusFrame(frame: ChannelBusFrame): Promise<void> {
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
                // The ordered path's pointer leaves the sender out — the stored
                // row names it, and the sender is not echoed its own message.
                this.fanOutBroadcast(frame.from ?? entry.senderId ?? "", frame.channel, entry.event, entry.payload, entry.seq);
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
    async configureChannelHistory(
        rules: ChannelRetentionRule[] | undefined,
        options?: { provision?: boolean }
    ): Promise<void> {
        // The store is built in every process, whether or not this one creates
        // the tables: retaining a message is what a process does when it
        // *publishes* to a retained channel, and a function handler publishes as
        // readily as a websocket client does. Only the DDL is owned.
        this.channelHistory = new ChannelHistoryStore(this.db, rules ?? []);
        if (!this.channelHistory.enabled) return;
        if (options?.provision === false) return;
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
            this.sendError(clientId, `Could not replay history for channel "${channel}"`, undefined, "CHANNEL_HISTORY_READ_FAILED", channel);
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
        unref(this.presenceSweepInterval);
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
     *  4. All WebSocket clients are closed with 1001 ("going away"); one that
     *     does not answer the close frame is dropped after a short grace.
     */
    async destroy(): Promise<void> {
        // 1. Cancel every pending debounced refetch timer
        for (const group of this.groups.values()) {
            if (group.timer) clearTimeout(group.timer);
            group.timer = undefined;
        }

        // 2. Clear subscriptions, callbacks and the groups and indexes over them
        this._subscriptions.clear();
        this.subscriptionCallbacks.clear();
        this.subscriptionsByClient.clear();
        this.groups.clear();
        this.collectionGroupsByPath.clear();
        this.singleGroupsByAddress.clear();
        this.subscribedPaths.clear();

        // 3. Clear broadcast channels and presence
        this.channels.clear();
        this.presence.clear();
        // Pending history writes hold the pool open; let them settle before the
        // caller closes it, but never let a rejected one break shutdown.
        await Promise.allSettled([...this.channelSendQueues.values(), ...this.channelReceiveQueues.values()]);
        this.channelSendQueues.clear();
        this.channelReceiveQueues.clear();
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

        // 5. Close the client sockets. The HTTP server's close() waits on an
        // upgraded connection for as long as the browser keeps it open, and
        // closeAllConnections() does not reach one either, so a socket left
        // open here holds the whole shutdown until its force timer.
        const sockets = [...this.clients.values()];
        this.clients.clear();
        closeWebSockets(sockets, WEBSOCKET_CLOSE_GRACE_MS);

        this.debugLog("🧹 [RealtimeService] destroy() complete — all resources released.");
    }

    // =============================================================================
    // Database-level Change Data Capture (CDC)
    // =============================================================================

    /**
     * Whether database-level change capture is the source and is listening.
     *
     * Configured is not enough: a CDC connection that went half-open used to
     * leave this `true` while nothing arrived. False while the connection is
     * down and being replaced.
     */
    public isCdcActive(): boolean {
        return this.cdcActive && this.cdcListener?.connected === true;
    }

    /** The LISTEN connections this service depends on — see `RealtimeProvider.health`. */
    health(): RealtimeListenerHealth[] {
        const listeners: RealtimeListenerHealth[] = [];
        if (this.cdcActive && this.cdcListener) {
            const { connected, downSince } = this.cdcListener.status();
            listeners.push({ name: "cdc", connected, ...(downSince !== undefined ? { downSince } : {}) });
        }
        const bus = this.bus instanceof PostgresChannelBus ? this.bus.status() : undefined;
        if (bus) {
            listeners.push({ name: "channel-bus", connected: bus.connected, ...(bus.downSince !== undefined ? { downSince: bus.downSince } : {}) });
        }
        return listeners;
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
        this.cdcListener = new CdcListener(
            connectionString,
            (event) => this.handleCdcEvent(event),
            () => this.resyncSubscriptions()
        );
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
        // The bootstrapper says the same thing one line later, in the
        // vocabulary of the setting that produced it (REALTIME_CDC).
        logger.debug(
            `📡 [RealtimeService] Database-level change capture ACTIVE — writes from ANY source now emit realtime events ` +
            `(${this.cdcTableMap.size} mapped table key(s)).`
        );
    }

    /**
     * Refetch every live subscription, as a change to its path would.
     *
     * Called when a LISTEN connection (CDC, or the cross-instance broadcast)
     * is listening again after a drop. Postgres does not queue NOTIFY for a
     * session that is not listening, so every change committed while it was
     * down — by another instance, psql, a cron — reached nobody here, and a
     * subscriber held its pre-gap rows until some later change to the same
     * collection happened to arrive. Each refetch runs under the
     * subscription's own scope, so this decides only who looks again.
     */
    private resyncSubscriptions(): void {
        for (const group of this.groups.values()) {
            this.scheduleGroupRefetch(group);
        }
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
     * Delivery is RLS-safe by construction: the event carries the changed row's
     * key and nothing else, and even that is NOT forwarded to subscribers. Instead the change is marked invalidated, so
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
        return deriveRowAddress(this.cdcRowByKeyFields(collection, row), collection, this.registry) || "*";
    }

    /**
     * A captured row with its key under the key's *field* names.
     *
     * The trigger captures the tuple by column — `user_id` — and an address is
     * built from the key's property names — `userId`. Read by property name
     * alone, a key declared apart from its column was never on the captured
     * row, the address fell back to `*`, and no single-row subscriber heard
     * about any write made outside this server.
     */
    private cdcRowByKeyFields(collection: CollectionConfig, row: Record<string, unknown>): Record<string, unknown> {
        const keyed: Record<string, unknown> = { ...row };
        for (const { fieldName, columnName } of collectionKeyColumns(collection, this.registry)) {
            if (fieldName in row) continue;
            if (columnName in row) keyed[fieldName] = row[columnName];
        }
        return keyed;
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
     *
     * @param reconnect Set when the client is coming back from a drop: every
     *        notification published in the gap is gone, so the subscriptions
     *        are refetched once it is listening again.
     */
    private async connectListenClient({ reconnect = false }: { reconnect?: boolean } = {}): Promise<void> {
        if (!this.listenConnectionString) return;

        let pending: PgClient | undefined;
        try {
            // See `PgNotifyListener.connect` — same shape, same reason. Until
            // `this.listenClient` is assigned, nothing else in this class knows
            // the connection exists, so a throw between `connect()` and that
            // assignment leaks a live backend and `scheduleReconnect` opens
            // another one three seconds later.
            const client = new PgClient({ connectionString: this.listenConnectionString });
            pending = client;

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
            // Adopted: `destroy()` and `scheduleReconnect` close it now.
            pending = undefined;

            this.debugLog(`📡 [RealtimeService] LISTEN client connected on channel "${PG_NOTIFY_CHANNEL}"`);
            if (reconnect) {
                logger.warn("⚠️ [RealtimeService] LISTEN client reconnected; refetching every subscription for what it missed.");
                this.resyncSubscriptions();
            }
        } catch (err) {
            if (pending) {
                try { await pending.end(); } catch { /* already dead */ }
            }
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

            await this.connectListenClient({ reconnect: true });
        }, delay);
    }
}

/**
 * Alias for RealtimeService for consistent naming with other database implementations.
 * This allows code to use PostgresRealtimeProvider alongside future MongoRealtimeProvider, etc.
 */
export const PostgresRealtimeProvider = RealtimeService;
