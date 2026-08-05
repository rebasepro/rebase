import { buildQueryString, FindParams, RebaseApiError } from "./transport";
import { FindAllParams, FindResult, IterateParams, LogicalCondition, SDKCollectionClient, WhereFilterOp, WhereValue, WriteOptions } from "@rebasepro/types";
import { collectAllPages, paginateFind } from "@rebasepro/common";
import { CollectionClient, LiveResult, ObserveOptions, RowSnapshotMeta } from "./collection";
import { SDKQueryBuilder } from "./sdk_query_builder";
import { dehydrateRow, hydrateRow } from "./offline-codec";
import { ConnectivityMonitor, isDuplicateKeyError, isNetworkError, isRetryableError } from "./offline-connectivity";
import {
    IndexedDBOfflineStore,
    MemoryOfflineStore,
    OfflineStore,
    PendingMutation,
    createMutationId
} from "./offline-store";
import {
    isExactlyEvaluable,
    matchesParams,
    resolvePagination,
    runLocalQuery,
    sortRows
} from "./offline-query";

/**
 * The SDK's local-first sync engine.
 *
 * The design goal is that the network is never in the way of the interface.
 * That comes from three properties, and everything in this file exists to
 * serve one of them:
 *
 * 1. **A local database, not a response cache.** Rows are stored normalized,
 *    by id, and queries are answered by evaluating them
 *    ({@link ./offline-query}) against those rows. A row written offline
 *    therefore appears in *every* list it belongs to, a row edited in one view
 *    updates in all of them, and `findById` answers for a row only ever seen
 *    inside a `find`. Server responses are merged into this database rather
 *    than replacing it, and a row with unsynced local writes keeps them: the
 *    user's own change never flickers away underneath them.
 *
 * 2. **Writes are decided locally.** A write made while offline is applied to
 *    the local database and queued — with the state it replaced, so a server
 *    rejection can be undone — and the call returns immediately. When
 *    connectivity is known to be gone the request is not even attempted, so
 *    an offline write costs nothing instead of a timeout.
 *
 * 3. **Reads are reactive.** {@link OfflineManager.observe} emits from the
 *    local database synchronously-ish, revalidates in the background, and
 *    re-emits whenever anything touches the rows it covers — a local write,
 *    a replay landing, a rollback, a realtime event, or another browser tab.
 *
 * What it deliberately is not: a full replica. Only rows the app has actually
 * read or written are local, so a query the cache cannot fully answer is
 * flagged `partial` rather than silently reported as complete.
 */

export interface OfflineConfig {
    /**
     * Persistence backend. Defaults to IndexedDB in the browser and an
     * in-memory store elsewhere; pass a custom implementation (e.g. backed by
     * AsyncStorage in React Native) to persist in other environments.
     */
    store?: OfflineStore;
    /**
     * Cached query snapshots kept per collection; the least recently written
     * are evicted beyond this. Defaults to 50.
     */
    maxCachedQueriesPerCollection?: number;
    /**
     * Cached rows kept per collection. Rows with unsynced local writes are
     * never evicted. Defaults to 5 000.
     */
    maxCachedRowsPerCollection?: number;
    /**
     * Ceiling for the exponential retry backoff, in milliseconds. Replay
     * retries start at one second and double up to this. `0` disables
     * automatic retries entirely — `client.offline.sync()`, a sign-in, and the
     * browser's `online` event still trigger one. Defaults to 60 000.
     */
    syncIntervalMs?: number;
    /**
     * Keep several tabs of the same app in step over a `BroadcastChannel`: a
     * write in one appears in the others, and only one of them replays the
     * shared queue. Defaults to on for the IndexedDB store (a real shared
     * database) and off for the in-memory one, which no other tab can see.
     */
    crossTab?: boolean;
    /**
     * How many times a mutation rejected with a *retryable* status (429, 503,
     * …) is replayed before it is given up on and rolled back. Network
     * failures do not count against this: being offline is not an attempt.
     * Defaults to 5.
     */
    maxRetries?: number;
    /**
     * Called when the server *rejects* a queued mutation (a 4xx/5xx that will
     * not resolve on its own — validation, RLS, a since-deleted row). The
     * local rows it wrote are rolled back to the state they had before it, and
     * any later queued writes to the same rows are discarded with it — they
     * were built on a change that never happened. Each discarded mutation is
     * reported here.
     *
     * Network failures are not errors: those mutations stay queued.
     */
    onSyncError?: (error: Error, mutation: PendingMutation) => void;
}

/** A snapshot of the engine's state, for a status indicator. */
export interface OfflineStatus {
    /** False once a request has failed to reach the server, until one does. */
    online: boolean;
    /** True while the queue is being replayed. */
    syncing: boolean;
    /** Local writes not yet accepted by the server. */
    pending: number;
    /** When the queue was last fully drained. */
    lastSyncedAt?: number;
    /** The last replay rejection, if any. */
    lastError?: string;
}

export type { LiveResult, ObserveOptions, RowSnapshotMeta } from "./collection";

/** What `client.offline` exposes to the app. */
export interface OfflineApi {
    /** Replay the queue now. Resolves with what was flushed and what remains. */
    sync(): Promise<{ flushed: number; remaining: number }>;
    /** The queued mutations for the current user, oldest first. */
    pending(): Promise<PendingMutation[]>;
    /** The current engine state — connectivity, queue depth, last sync. */
    status(): OfflineStatus;
    /** Subscribe to {@link OfflineStatus} changes (for a sync indicator). */
    onStatusChange(listener: (status: OfflineStatus) => void): () => void;
    /**
     * Drop the current user's queued mutations AND their local rows.
     * Destructive: queued writes are lost, not replayed. For "discard my
     * offline changes" flows, not for sign-out (scoping already isolates
     * users).
     */
    clear(): Promise<void>;
    /** Subscribe to queue-size changes (for a "pending changes" badge). */
    onQueueChange(listener: (count: number) => void): () => void;
}

/** True when a read failed because there was neither network nor local data. */
export function isOfflineError(error: unknown): boolean {
    return error instanceof RebaseApiError && error.code === "offline";
}

function offlineError(message: string): RebaseApiError {
    return new RebaseApiError(message, { status: 0, code: "offline" });
}

function generateOfflineId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    // Non-cryptographic fallback for exotic runtimes; collision odds are
    // irrelevant at offline-queue scale.
    return `off-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type AnyRow = Record<string, unknown>;
type InnerFactory = (slug: string) => SDKCollectionClient<AnyRow>;

/** What the server said about one query, as ids into the local row database. */
interface QuerySnapshot {
    ids: (string | number)[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

interface RowEntry {
    row: AnyRow;
    cachedAt: number;
    /** Bumped on every local change, so observers can diff cheaply. */
    rev: number;
}

interface CollectionState {
    rows: Map<string, RowEntry>;
    snapshots: Map<string, QuerySnapshot>;
    /**
     * Query keys whose snapshot came from a request that completed in this
     * session. Deliberately not persisted: a snapshot read back off disk is
     * exactly what "from the cache" means, however recent it looks.
     */
    fresh: Set<string>;
    /** The same, per row id, for `observeById`. */
    freshRows: Set<string>;
    /** Ids the server has confirmed do not exist — a negative cache. */
    absent: Set<string>;
    loaded?: Promise<void>;
    /**
     * True once the persisted rows are in memory. Observers must not emit
     * before this: an empty map during the load is not an empty collection,
     * and emitting it would flash an empty list over real data.
     */
    ready: boolean;
}

interface Observer {
    slug: string;
    params?: FindParams;
    /** Set for observeById; then `params` is unused. */
    id?: string | number;
    emit: () => void;
    /** Re-run this observer's query against the server. */
    refresh: () => Promise<unknown>;
    signature?: string;
    error?: Error;
    settled: boolean;
}

// `\u0000` as an escape, not a raw NUL byte in the source. The value is
// identical — an id can never contain it, which is the point — but written raw it
// made this whole file test as binary, so every `grep` over the repo skipped
// all 1,700 lines of it in silence.
const MISSING = "\u0000missing";

export class OfflineManager {
    private readonly store: OfflineStore;
    private readonly maxCachedQueries: number;
    private readonly maxCachedRows: number;
    private readonly maxRetries: number;
    private readonly onSyncError?: OfflineConfig["onSyncError"];
    private readonly createInner: InnerFactory;
    private readonly inners = new Map<string, SDKCollectionClient<AnyRow>>();
    private readonly connectivity: ConnectivityMonitor;

    private scope = "anon";
    /** The local database: normalized rows and query snapshots per collection. */
    private collections = new Map<string, CollectionState>();
    /** In-memory mirror of the current scope's queue, in replay order. */
    private queue: PendingMutation[] = [];
    /**
     * The mutation currently on the wire, if any.
     *
     * `flush` awaits `replay(op)` with `op` still at the head of `queue`, so for
     * the whole duration of that request the in-flight op is also the queue's
     * *tail* whenever it is the only entry. Both shortcuts in `enqueue` reach
     * for the tail, and neither may touch an op the server is already reading:
     *
     * - Coalescing an update into it mutates a payload that has already been
     *   serialized and sent, and `drop` then removes the whole entry on ACK —
     *   so the second edit is neither sent nor kept. A silently lost write.
     * - Cancelling it out against a delete assumes the server never saw the
     *   create. It is seeing it right now, so the row would be created and the
     *   delete never queued — an orphan row nothing will ever remove.
     *
     * Guarding on the id rather than on a boolean keeps this correct if the
     * flush loop ever sends more than one op at a time.
     */
    private inFlightId: string | null = null;
    private queueLoad?: Promise<void>;
    /** Serializes enqueues so concurrent writes keep the order the app made them. */
    private enqueueChain: Promise<unknown> = Promise.resolve();
    private flushPromise?: Promise<{ flushed: number; remaining: number }>;
    private queueListeners = new Set<(count: number) => void>();
    private statusListeners = new Set<(status: OfflineStatus) => void>();
    private observers = new Map<string, Set<Observer>>();
    private refreshPending = new Set<string>();
    private revCounter = 0;
    private disposed = false;
    private currentStatus: OfflineStatus = { online: true, syncing: false, pending: 0 };
    private readonly channel?: BroadcastChannel;
    private readonly tabId = createMutationId();

    readonly api: OfflineApi;

    constructor(config: OfflineConfig, createInner: InnerFactory) {
        this.store = config.store
            ?? (typeof indexedDB !== "undefined" ? new IndexedDBOfflineStore() : new MemoryOfflineStore());
        this.maxCachedQueries = config.maxCachedQueriesPerCollection ?? 50;
        this.maxCachedRows = config.maxCachedRowsPerCollection ?? 5_000;
        this.maxRetries = config.maxRetries ?? 5;
        this.onSyncError = config.onSyncError;
        this.createInner = createInner;

        const maxBackoffMs = config.syncIntervalMs ?? 60_000;
        this.connectivity = new ConnectivityMonitor({
            maxBackoffMs: Math.max(1_000, maxBackoffMs),
            // With no retry timer nothing would ever reopen the window, so a
            // single failure would strand the client offline forever.
            respectBackoff: maxBackoffMs > 0
        });
        if (maxBackoffMs > 0) {
            this.connectivity.onRetryDue = () => { void this.sync().catch(() => undefined); };
        }
        this.connectivity.onChange((online) => {
            this.patchStatus({ online });
            if (online) this.revalidateAll();
        });
        this.currentStatus.online = this.connectivity.isOnline();

        // Other tabs share the same IndexedDB. Without this they would each
        // hold a stale copy of the row database and quietly diverge — one tab
        // showing an edit the other never learns about. A memory store is not
        // shared with anyone, so there is nothing to reconcile and the channel
        // would only relay writes between unrelated clients.
        const crossTab = config.crossTab ?? this.store instanceof IndexedDBOfflineStore;
        if (crossTab && typeof BroadcastChannel !== "undefined") {
            try {
                this.channel = new BroadcastChannel("rebase-offline");
                this.channel.onmessage = (event: MessageEvent) => this.onBroadcast(event.data);
                // Node's BroadcastChannel is ref'd, and a script that opened a
                // client should still be able to exit.
                (this.channel as unknown as { unref?: () => void }).unref?.();
            } catch {
                // Not fatal: a browser that refuses the channel just loses
                // cross-tab propagation.
            }
        }

        this.api = {
            sync: () => this.sync(),
            pending: async () => {
                await this.ensureQueueLoaded();
                // Deep-copied: these are live queue entries (tail coalescing
                // mutates them in place), and a caller must not be able to
                // edit what will be replayed.
                return this.queue.map((m) => structuredClone(m));
            },
            status: () => ({ ...this.currentStatus }),
            onStatusChange: (listener) => {
                this.statusListeners.add(listener);
                return () => this.statusListeners.delete(listener);
            },
            clear: async () => {
                await this.store.clear(`${this.scope}|`);
                this.queue = [];
                this.resetCollections();
                this.patchStatus({ pending: 0, lastError: undefined });
                this.notifyQueue();
                for (const slug of this.observers.keys()) this.notifyCollection(slug, false);
            },
            onQueueChange: (listener) => {
                this.queueListeners.add(listener);
                return () => this.queueListeners.delete(listener);
            }
        };
    }

    /**
     * Cache and queue are partitioned per signed-in user: cached rows are
     * RLS-filtered for the user who fetched them, and queued writes must
     * replay under the credentials that made them — so neither may ever leak
     * across a sign-out/sign-in on a shared browser.
     */
    setScope(uid: string | undefined): void {
        const next = uid || "anon";
        if (next === this.scope) return;
        this.scope = next;
        this.queueLoad = undefined;
        this.queue = [];
        this.resetCollections();
        this.patchStatus({ pending: 0, lastError: undefined });
        this.notifyQueue();
        // Everything on screen belongs to the previous user.
        for (const slug of this.observers.keys()) this.notifyCollection(slug, false);
        this.revalidateAll();
        // The returning user's queue may hold writes from a previous session.
        void this.sync().catch(() => undefined);
    }

    /**
     * Throw away every local row, for a scope change or an explicit clear.
     *
     * The state objects are replaced rather than emptied, so a load still in
     * flight for the previous user fails its identity check and discards what
     * it read instead of grafting it onto the new one. The replacements are
     * marked ready: nothing needs loading until something asks, and observers
     * have to be told *now* that the rows they are showing are gone.
     */
    private resetCollections(): void {
        const slugs = [...this.collections.keys()];
        this.collections = new Map();
        for (const slug of slugs) {
            this.collections.set(slug, {
                rows: new Map(),
                snapshots: new Map(),
                fresh: new Set(),
                freshRows: new Set(),
                absent: new Set(),
                ready: true
            });
        }
    }

    /** Release listeners, timers and the cross-tab channel (client.close()). */
    dispose(): void {
        this.disposed = true;
        this.connectivity.dispose();
        try {
            this.channel?.close();
        } catch {
            // A channel that is already closed is not a problem.
        }
        this.observers.clear();
        this.queueListeners.clear();
        this.statusListeners.clear();
    }

    // ─── Collection wrapping ─────────────────────────────────────────────────

    wrap<M extends AnyRow>(slug: string, inner: CollectionClient<M>): CollectionClient<M> {
        this.inners.set(slug, inner as SDKCollectionClient<AnyRow>);

        const wrapped: CollectionClient<M> = {
            find: async (params?: FindParams<M>): Promise<FindResult<M>> => {
                const state = await this.ensureCollection(slug);
                if (this.connectivity.shouldAttempt()) {
                    try {
                        const res = await inner.find(params);
                        this.connectivity.markSuccess();
                        await this.ingest(slug, res.data ?? []);
                        const snapshot = this.recordSnapshot(slug, params, res);
                        const answer = this.answer<M>(slug, params, snapshot);
                        this.notifyCollection(slug, false);
                        return { data: answer.data, meta: answer.meta };
                    } catch (error) {
                        if (!isNetworkError(error)) {
                            // A 5xx or a rate limit still deserves the cached
                            // answer rather than an exception the app has to
                            // special-case, but only when we have one.
                            if (isRetryableError(error) && this.hasLocalAnswer(state, slug, params)) {
                                const answer = this.answer<M>(slug, params, this.snapshotFor(slug, params));
                                return { data: answer.data, meta: answer.meta };
                            }
                            throw error;
                        }
                        this.connectivity.markFailure();
                    }
                }
                const answer = this.localFind<M>(slug, params);
                // Falling back is a state change even when the rows are the
                // same — it is how a "showing cached data" badge lights up.
                this.notifyCollection(slug, false);
                return { data: answer.data, meta: answer.meta };
            },

            // Paginates the *wrapped* find, so a walk started offline is served
            // page by page out of the local database exactly as it would be
            // from the server, and rejoins the network mid-walk if it returns.
            iterate: (params?: IterateParams<M>) => paginateFind<M>((p) => wrapped.find(p), params, slug),

            findAll: (params?: FindAllParams<M>) => collectAllPages<M>((p) => wrapped.find(p), params, slug),

            findById: async (id: string | number) => {
                await this.ensureCollection(slug);
                if (this.connectivity.shouldAttempt()) {
                    try {
                        const row = await inner.findById(id);
                        this.connectivity.markSuccess();
                        if (row !== undefined) {
                            await this.ingest(slug, [row]);
                        } else if (!this.hasPending(slug, id)) {
                            // The server is authoritative that it is gone, and
                            // nothing local is waiting to recreate it.
                            this.removeLocalRow(slug, id, true);
                        }
                        this.notifyCollection(slug, false);
                        return this.localRow<M>(slug, id);
                    } catch (error) {
                        if (!isNetworkError(error)) throw error;
                        this.connectivity.markFailure();
                    }
                }
                const local = this.localRow<M>(slug, id);
                if (local !== undefined || this.hasPending(slug, id)) return local;
                // "Not there" is an answer, and one we may already have.
                if (this.collections.get(slug)?.absent.has(String(id))) return undefined;
                throw offlineError(
                    `Offline: "${slug}" row ${String(id)} is not in the local database.`
                );
            },

            create: async (data: Partial<M>, id?: string | number) => {
                await this.ensureCollection(slug);
                if (this.connectivity.shouldAttempt()) {
                    try {
                        const row = await inner.create(data, id);
                        this.connectivity.markSuccess();
                        await this.ingest(slug, [row]);
                        this.notifyCollection(slug);
                        this.scheduleRefresh(slug);
                        return row;
                    } catch (error) {
                        if (!isNetworkError(error)) throw error;
                        this.connectivity.markFailure();
                    }
                }
                const providedId = id ?? (data as AnyRow).id as string | number | undefined;
                const rowId = providedId ?? generateOfflineId();
                const row = { ...(data as AnyRow), id: rowId } as unknown as M;
                await this.enqueue({
                    collection: slug,
                    type: "create",
                    id: rowId,
                    data: row,
                    generatedId: providedId === undefined,
                    rollback: { rows: { [String(rowId)]: this.rawLocalRow(slug, rowId) ?? null } }
                });
                this.setLocalRow(slug, rowId, row);
                this.notifyCollection(slug);
                return row;
            },

            createMany: async (data: Partial<M>[], options?: { upsert?: boolean }) => {
                await this.ensureCollection(slug);
                if (!Array.isArray(data)) {
                    throw new TypeError("createMany expects an array of records.");
                }
                if (data.length === 0) return [];
                if (this.connectivity.shouldAttempt()) {
                    try {
                        const rows = await inner.createMany(data, options);
                        this.connectivity.markSuccess();
                        await this.ingest(slug, rows);
                        this.notifyCollection(slug);
                        this.scheduleRefresh(slug);
                        return rows;
                    } catch (error) {
                        if (!isNetworkError(error)) throw error;
                        this.connectivity.markFailure();
                    }
                }
                const rows = data.map((r) => ({
                    ...(r as AnyRow),
                    id: (r as AnyRow).id ?? generateOfflineId()
                })) as unknown as M[];
                const rollback: Record<string, AnyRow | null> = {};
                for (const row of rows) {
                    const key = String(row.id);
                    rollback[key] = this.rawLocalRow(slug, row.id as string | number) ?? null;
                }
                await this.enqueue({
                    collection: slug,
                    type: "createMany",
                    data: rows,
                    upsert: options?.upsert,
                    rollback: { rows: rollback }
                });
                for (const row of rows) this.setLocalRow(slug, row.id as string | number, row);
                this.notifyCollection(slug);
                return rows;
            },

            updateMany: async (updates: { id: string | number; data: Partial<M> }[], options?: WriteOptions) => {
                await this.ensureCollection(slug);
                if (!Array.isArray(updates)) {
                    throw new TypeError("updateMany expects an array of { id, data } entries.");
                }
                if (updates.length === 0) return [];
                // Any row in the batch with a write already queued sends the
                // whole batch to the queue. Splitting it — some rows now, some
                // later — would break the one guarantee a batch makes, that its
                // rows land together, and would reorder writes against a row
                // whose own create has not landed yet.
                const anyPending = updates.some((u) => this.hasPending(slug, u.id));
                if (this.connectivity.shouldAttempt() && !anyPending) {
                    try {
                        const rows = await inner.updateMany(updates, options);
                        this.connectivity.markSuccess();
                        await this.ingest(slug, rows);
                        this.notifyCollection(slug);
                        return rows;
                    } catch (error) {
                        if (!isNetworkError(error)) throw error;
                        this.connectivity.markFailure();
                    }
                }
                const rollback: Record<string, AnyRow | null> = {};
                const optimistic: M[] = [];
                for (const { id, data } of updates) {
                    const base = this.rawLocalRow(slug, id);
                    rollback[String(id)] = base ?? null;
                    optimistic.push({ ...(base ?? {}), ...(data as AnyRow), id } as unknown as M);
                }
                await this.enqueue({
                    collection: slug,
                    type: "updateMany",
                    updates: updates.map((u) => ({ id: u.id,
data: u.data as AnyRow })),
                    rollback: { rows: rollback }
                });
                for (const row of optimistic) this.setLocalRow(slug, row.id as string | number, row);
                this.notifyCollection(slug);
                return optimistic;
            },

            deleteMany: async (ids: (string | number)[], options?: WriteOptions) => {
                await this.ensureCollection(slug);
                if (!Array.isArray(ids)) {
                    throw new TypeError("deleteMany expects an array of ids.");
                }
                if (ids.length === 0) return;
                const anyPending = ids.some((id) => this.hasPending(slug, id));
                if (this.connectivity.shouldAttempt() && !anyPending) {
                    try {
                        await inner.deleteMany(ids, options);
                        this.connectivity.markSuccess();
                        for (const id of ids) this.removeLocalRow(slug, id, true);
                        this.notifyCollection(slug);
                        this.scheduleRefresh(slug);
                        return;
                    } catch (error) {
                        if (!isNetworkError(error)) throw error;
                        this.connectivity.markFailure();
                    }
                }
                const rollback: Record<string, AnyRow | null> = {};
                for (const id of ids) {
                    rollback[String(id)] = this.rawLocalRow(slug, id) ?? null;
                }
                await this.enqueue({
                    collection: slug,
                    type: "deleteMany",
                    ids,
                    rollback: { rows: rollback }
                });
                for (const id of ids) this.removeLocalRow(slug, id, false);
                this.notifyCollection(slug);
            },

            update: async (id: string | number, data: Partial<M>) => {
                await this.ensureCollection(slug);
                // Never overtake a write already queued for this row. The
                // reads already respect the queue; the writes did not, so an
                // edit made while the row's own create was still pending went
                // straight to a server that had never heard of the row and came
                // back 404 — the caller's edit failing on a row they could see.
                // Queuing keeps the order the app issued the writes in.
                if (this.connectivity.shouldAttempt() && !this.hasPending(slug, id)) {
                    try {
                        const row = await inner.update(id, data);
                        this.connectivity.markSuccess();
                        await this.ingest(slug, [row]);
                        this.notifyCollection(slug);
                        return row;
                    } catch (error) {
                        if (!isNetworkError(error)) throw error;
                        this.connectivity.markFailure();
                    }
                }
                const base = this.rawLocalRow(slug, id);
                await this.enqueue({
                    collection: slug,
                    type: "update",
                    id,
                    data: data as AnyRow,
                    rollback: { rows: { [String(id)]: base ?? null } }
                });
                const optimistic = { ...(base ?? {}), ...(data as AnyRow), id } as unknown as M;
                this.setLocalRow(slug, id, optimistic);
                this.notifyCollection(slug);
                return optimistic;
            },

            delete: async (id: string | number) => {
                await this.ensureCollection(slug);
                // As in `update`: a delete must not overtake this row's own
                // queued create, or it 404s and the create then lands behind
                // it, leaving the row the caller just deleted.
                if (this.connectivity.shouldAttempt() && !this.hasPending(slug, id)) {
                    try {
                        await inner.delete(id);
                        this.connectivity.markSuccess();
                        this.removeLocalRow(slug, id, true);
                        this.notifyCollection(slug);
                        this.scheduleRefresh(slug);
                        return;
                    } catch (error) {
                        if (!isNetworkError(error)) throw error;
                        this.connectivity.markFailure();
                    }
                }
                await this.enqueue({
                    collection: slug,
                    type: "delete",
                    id,
                    rollback: { rows: { [String(id)]: this.rawLocalRow(slug, id) ?? null } }
                });
                this.removeLocalRow(slug, id);
                this.notifyCollection(slug);
            },

            count: async (params?: FindParams<M>): Promise<number> => {
                await this.ensureCollection(slug);
                if (this.connectivity.shouldAttempt()) {
                    try {
                        const n = await inner.count(params);
                        this.connectivity.markSuccess();
                        void this.writeCache(this.countKey(slug, params), n);
                        return Math.max(0, n + this.pendingDelta(slug, params));
                    } catch (error) {
                        if (!isNetworkError(error)) throw error;
                        this.connectivity.markFailure();
                    }
                }
                const cached = await this.readCache<number>(this.countKey(slug, params));
                if (cached !== undefined) return Math.max(0, cached + this.pendingDelta(slug, params));
                const state = this.collections.get(slug);
                if (state && state.rows.size > 0) {
                    return runLocalQuery([...state.rows.values()].map((e) => e.row), params).meta.total;
                }
                throw offlineError(`Offline: no cached count for "${slug}".`);
            },

            observe: (
                params: FindParams<M> | undefined,
                onResult: (result: LiveResult<M>) => void,
                onError?: (error: Error) => void,
                options?: ObserveOptions
            ) => this.observe<M>(slug, wrapped, inner, params, onResult, onError, options),

            observeById: (
                id: string | number,
                onResult: (row: M | undefined, meta: RowSnapshotMeta) => void,
                onError?: (error: Error) => void,
                options?: ObserveOptions
            ) => this.observeById<M>(slug, wrapped, inner, id, onResult, onError, options),

            // The builder calls back into `wrapped.find(...)`, so fluent
            // queries go through the local database like direct calls.
            where(columnOrCondition: string | LogicalCondition, operator?: WhereFilterOp, value?: unknown) {
                const builder = new SDKQueryBuilder<M>(wrapped);
                if (typeof columnOrCondition === "object") return builder.where(columnOrCondition);
                return builder.where(
                    columnOrCondition as keyof M & string,
                    operator!,
                    value as WhereValue<M[keyof M & string]>
                );
            },
            orderBy: (column, direction) => new SDKQueryBuilder<M>(wrapped).orderBy(column, direction),
            limit: (count) => new SDKQueryBuilder<M>(wrapped).limit(count),
            offset: (count) => new SDKQueryBuilder<M>(wrapped).offset(count),
            search: (searchString) => new SDKQueryBuilder<M>(wrapped).search(searchString),
            include: (...relations) => new SDKQueryBuilder<M>(wrapped).include(...relations)
        };

        // Realtime stays a live server stream — but everything it delivers is
        // worth keeping, so it feeds the local database on its way past.
        if (inner.listen) {
            wrapped.listen = (params, onUpdate, onError) => inner.listen!(
                params,
                (response) => {
                    void this.ingest(slug, response.data ?? []).then(() => this.notifyCollection(slug, false));
                    onUpdate(response);
                },
                onError
            );
        }
        if (inner.listenById) {
            wrapped.listenById = (id, onUpdate, onError) => inner.listenById!(
                id,
                (row) => {
                    if (row) void this.ingest(slug, [row]).then(() => this.notifyCollection(slug, false));
                    onUpdate(row);
                },
                onError
            );
        }

        return wrapped;
    }

    // ─── Live queries ────────────────────────────────────────────────────────

    private observe<M extends AnyRow>(
        slug: string,
        wrapped: CollectionClient<M>,
        inner: CollectionClient<M>,
        params: FindParams<M> | undefined,
        onResult: (result: LiveResult<M>) => void,
        onError?: (error: Error) => void,
        options?: ObserveOptions
    ): () => void {
        let closed = false;
        let unlisten: (() => void) | undefined;

        const observer: Observer = {
            slug,
            params,
            settled: false,
            refresh: () => wrapped.find(params).catch(() => undefined),
            emit: () => {
                if (closed || !this.collections.get(slug)?.ready) return;
                const result = this.answer<M>(slug, params, this.snapshotFor(slug, params));
                // Every field the callback receives has to be in the
                // signature, or a change to one of them is deduplicated away —
                // a row settling from "saving" to saved is exactly that.
                const signature = `${result.fromCache ? "c" : "s"}${result.hasPendingWrites ? "p" : "-"}`
                    + this.signature(slug, result.data, result.meta.total);
                if (observer.settled && signature === observer.signature) return;
                observer.signature = signature;
                observer.settled = true;
                onResult(observer.error ? { ...result, error: observer.error } : result);
            }
        };
        this.observersFor(slug).add(observer);

        void (async () => {
            await this.ensureCollection(slug);
            if (closed) return;
            // Emit whatever is already local before touching the network. An
            // app that has run this query before renders instantly.
            if (this.hasLocalAnswer(this.collections.get(slug), slug, params)) observer.emit();
            try {
                await wrapped.find(params);
                observer.error = undefined;
            } catch (error) {
                observer.error = error as Error;
                if (closed) return;
                // A read that found nothing locally has nothing to emit, so the
                // failure is all the app gets.
                if (!observer.settled) {
                    onError?.(error as Error);
                    return;
                }
            }
            if (!closed) observer.emit();
        })();

        if (options?.realtime !== false && inner.listen) {
            unlisten = inner.listen(params, (response) => {
                void this.ingest(slug, response.data ?? []).then(() => {
                    this.recordSnapshot(slug, params, response);
                    this.notifyCollection(slug, false);
                });
            }, onError);
        }

        return () => {
            closed = true;
            this.observersFor(slug).delete(observer);
            unlisten?.();
        };
    }

    private observeById<M extends AnyRow>(
        slug: string,
        wrapped: CollectionClient<M>,
        inner: CollectionClient<M>,
        id: string | number,
        onResult: (row: M | undefined, meta: RowSnapshotMeta) => void,
        onError?: (error: Error) => void,
        options?: ObserveOptions
    ): () => void {
        let closed = false;
        let unlisten: (() => void) | undefined;
        const observer: Observer = {
            slug,
            id,
            settled: false,
            refresh: () => wrapped.findById(id).catch(() => undefined),
            emit: () => {
                if (closed || !this.collections.get(slug)?.ready) return;
                const row = this.localRow<M>(slug, id);
                const entry = this.collections.get(slug)?.rows.get(String(id));
                const fromCache = !this.collections.get(slug)?.freshRows.has(String(id));
                const hasPendingWrites = this.hasPending(slug, id);
                const signature = `${fromCache ? "c" : "s"}${hasPendingWrites ? "p" : "-"}|`
                    + (row === undefined ? MISSING : `${String(id)}:${entry?.rev ?? 0}`);
                if (observer.settled && signature === observer.signature) return;
                observer.signature = signature;
                observer.settled = true;
                onResult(row, { fromCache, hasPendingWrites });
            }
        };
        this.observersFor(slug).add(observer);

        void (async () => {
            await this.ensureCollection(slug);
            if (closed) return;
            if (this.localRow<M>(slug, id) !== undefined) observer.emit();
            try {
                await wrapped.findById(id);
            } catch (error) {
                if (closed) return;
                if (!observer.settled) {
                    onError?.(error as Error);
                    return;
                }
            }
            if (!closed) observer.emit();
        })();

        if (options?.realtime !== false && inner.listenById) {
            unlisten = inner.listenById(id, (row) => {
                if (!row) {
                    if (!this.hasPending(slug, id)) this.removeLocalRow(slug, id, true);
                    this.notifyCollection(slug, false);
                    return;
                }
                void this.ingest(slug, [row]).then(() => this.notifyCollection(slug, false));
            }, onError);
        }

        return () => {
            closed = true;
            this.observersFor(slug).delete(observer);
            unlisten?.();
        };
    }

    private observersFor(slug: string): Set<Observer> {
        let set = this.observers.get(slug);
        if (!set) {
            set = new Set();
            this.observers.set(slug, set);
        }
        return set;
    }

    /** Cheap change detection: which rows, in what order, at which revision. */
    private signature(slug: string, rows: AnyRow[], total: number): string {
        const state = this.collections.get(slug);
        const parts = rows.map((row) => {
            const key = String(row.id);
            return `${key}:${state?.rows.get(key)?.rev ?? 0}`;
        });
        return `${total}|${parts.join(",")}`;
    }

    private notifyCollection(slug: string, broadcast = true): void {
        const set = this.observers.get(slug);
        if (set) for (const observer of [...set]) observer.emit();
        if (broadcast) this.broadcast({ type: "rows", slugs: [slug] });
    }

    /** Connectivity came back (or the user changed): re-read everything live. */
    private revalidateAll(): void {
        for (const slug of this.observers.keys()) {
            this.notifyCollection(slug, false);
            this.scheduleRefresh(slug);
        }
    }

    // ─── Reading the local database ──────────────────────────────────────────

    private collectionState(slug: string): CollectionState {
        let state = this.collections.get(slug);
        if (!state) {
            state = {
                rows: new Map(),
                snapshots: new Map(),
                fresh: new Set(),
                freshRows: new Set(),
                absent: new Set(),
                ready: false
            };
            this.collections.set(slug, state);
        }
        return state;
    }

    private ensureCollection(slug: string): Promise<CollectionState> {
        const state = this.collectionState(slug);
        if (!state.loaded) {
            const scope = this.scope;
            state.loaded = (async () => {
                await this.ensureQueueLoaded();
                const [rows, snapshots, absent] = await Promise.all([
                    this.store.listCacheEntries(`${scope}|row|${slug}|`).catch(() => []),
                    this.store.listCacheEntries(`${scope}|q|${slug}|`).catch(() => []),
                    this.store.listCache(`${scope}|abs|${slug}|`).catch(() => [])
                ]);
                // A scope switch mid-load must not graft the previous user's
                // rows onto the new one.
                if (this.scope !== scope || this.collections.get(slug) !== state) return;
                for (const entry of rows) {
                    const row = entry.value as AnyRow | undefined;
                    if (!row || row.id === undefined || row.id === null) continue;
                    state.rows.set(String(row.id), {
                        row: hydrateRow(row),
                        cachedAt: entry.cachedAt,
                        rev: ++this.revCounter
                    });
                }
                for (const entry of snapshots) {
                    const key = entry.key.slice(`${scope}|q|${slug}|`.length);
                    if (entry.value) state.snapshots.set(key, entry.value as QuerySnapshot);
                }
                for (const entry of absent) {
                    state.absent.add(entry.key.slice(`${scope}|abs|${slug}|`.length));
                }
            })().catch(() => undefined).finally(() => { state.ready = true; });
        }
        return state.loaded.then(() => state);
    }

    private snapshotFor(slug: string, params?: FindParams): QuerySnapshot | undefined {
        return this.collections.get(slug)?.snapshots.get(buildQueryString(params));
    }

    private hasLocalAnswer(state: CollectionState | undefined, slug: string, params?: FindParams): boolean {
        if (!state) return false;
        return state.snapshots.has(buildQueryString(params)) || state.rows.size > 0;
    }

    /**
     * Answer a query from the local database.
     *
     * With a snapshot, the server's own page — its ids, order and total — is
     * the skeleton, and the local rows fill it in: rows deleted locally drop
     * out, rows edited locally show the edit, and rows *created* locally join
     * the first page if they match. Without one, the query is evaluated
     * outright over every cached row, which is the best that can be done for a
     * query the server has never answered here.
     */
    private answer<M extends AnyRow>(
        slug: string,
        params: FindParams | undefined,
        snapshot: QuerySnapshot | undefined
    ): LiveResult<M> {
        const state = this.collections.get(slug);
        const exact = isExactlyEvaluable(params);
        const fromCache = !state?.fresh.has(buildQueryString(params));
        if (!state) {
            return {
                data: [],
                meta: { ...resolvePagination(params), total: 0, hasMore: false },
                fromCache: true,
                hasPendingWrites: false,
                partial: true
            };
        }

        if (!snapshot) {
            const local = runLocalQuery<M>([...state.rows.values()].map((e) => e.row) as M[], params);
            return {
                ...local,
                fromCache,
                hasPendingWrites: local.data.some((row) => this.hasPending(slug, row.id as string | number)),
                partial: true
            };
        }

        const rows: M[] = [];
        const seen = new Set<string>();
        /** Rows the server counted that we know are no longer in the result. */
        let removed = 0;
        for (const id of snapshot.ids) {
            const key = String(id);
            const entry = state.rows.get(key);
            if (!entry) {
                // Gone for a reason (deleted here, or confirmed gone by the
                // server) versus merely evicted to stay under the cache cap:
                // only the former should move the total the server gave us.
                if (state.absent.has(key) || this.hasPending(slug, key)) removed++;
                continue;
            }
            // A local edit that moves a row out of its own filter should take
            // it off the list, exactly as a refetch would.
            if (exact && this.hasPending(slug, key) && !matchesParams(entry.row, params)) {
                removed++;
                continue;
            }
            rows.push(entry.row as M);
            seen.add(key);
        }

        // Rows the server has never seen belong on the first page of a
        // matching query. Injecting them into *every* page would show the same
        // new row once per page.
        let added = 0;
        const offset = snapshot.offset ?? 0;
        if (exact && offset === 0) {
            for (const [key, entry] of state.rows) {
                if (seen.has(key) || !this.hasPending(slug, key)) continue;
                if (!this.isLocallyCreated(slug, key)) continue;
                if (!matchesParams(entry.row, params)) continue;
                rows.push(entry.row as M);
                added++;
            }
            if (added > 0 && params?.orderBy) sortRows(rows, params.orderBy);
        }

        const total = Math.max(rows.length, snapshot.total - removed + added);
        return {
            data: rows,
            meta: {
                total,
                limit: snapshot.limit,
                offset,
                hasMore: snapshot.hasMore
            },
            fromCache,
            hasPendingWrites: rows.some((row) => this.hasPending(slug, row.id as string | number)),
            partial: !exact
        };
    }

    private localFind<M extends AnyRow>(slug: string, params?: FindParams): LiveResult<M> {
        const state = this.collections.get(slug);
        const snapshot = this.snapshotFor(slug, params);
        // However recent it looks, this answer did not come from the server.
        state?.fresh.delete(buildQueryString(params));
        if (!snapshot && (!state || state.rows.size === 0)) {
            throw offlineError(`Offline: no cached data for "${slug}".`);
        }
        const answer = this.answer<M>(slug, params, snapshot);
        return snapshot ? answer : { ...answer, partial: true };
    }

    private rawLocalRow(slug: string, id: string | number): AnyRow | undefined {
        const entry = this.collections.get(slug)?.rows.get(String(id));
        return entry ? { ...entry.row } : undefined;
    }

    private localRow<M extends AnyRow>(slug: string, id: string | number): M | undefined {
        return this.collections.get(slug)?.rows.get(String(id))?.row as M | undefined;
    }

    // ─── Writing the local database ──────────────────────────────────────────

    private setLocalRow(slug: string, id: string | number, row: AnyRow): void {
        const state = this.collectionState(slug);
        const key = String(id);
        const cachedAt = Date.now();
        state.rows.set(key, { row: { ...row }, cachedAt, rev: ++this.revCounter });
        state.freshRows.delete(key);
        this.forgetTombstone(slug, key);
        void this.writeCache(this.rowKey(slug, key), dehydrateRow(row), cachedAt);
        this.evictRows(slug);
    }

    /**
     * Drop a row and, when the server is the one saying it is gone, remember
     * that. "I looked it up and it does not exist" is real knowledge: without
     * it, opening a deleted row while offline would report a missing local
     * database instead of a missing row.
     */
    private removeLocalRow(slug: string, id: string | number, known = false): void {
        const state = this.collectionState(slug);
        const key = String(id);
        const existed = state.rows.delete(key);
        if (known) {
            state.absent.add(key);
            state.freshRows.add(key);
            void this.writeCache(this.absentKey(slug, key), true);
        } else {
            state.freshRows.delete(key);
        }
        if (existed) void this.deleteCache([this.rowKey(slug, key)]);
    }

    private forgetTombstone(slug: string, key: string): void {
        const state = this.collectionState(slug);
        if (!state.absent.delete(key)) return;
        void this.deleteCache([this.absentKey(slug, key)]);
    }

    /**
     * Merge server rows into the local database. A row with unsynced local
     * writes keeps them: the server's copy is the base the queued mutations
     * are re-applied to, not a replacement for what the user did.
     *
     * Rows that came back unchanged keep their identity and revision, so a
     * refetch that changed nothing does not re-render every live query that
     * touches them — or rewrite them all to disk.
     */
    private async ingest(slug: string, rows: AnyRow[]): Promise<void> {
        if (rows.length === 0) return;
        const state = await this.ensureCollection(slug);
        const cachedAt = Date.now();
        const writes: { key: string; entry: { value: unknown; cachedAt: number } }[] = [];
        const deletes: string[] = [];
        for (const raw of rows) {
            if (!raw || raw.id === undefined || raw.id === null) continue;
            const key = String(raw.id);
            const merged = this.hasPending(slug, key)
                ? this.applyPendingToRow(slug, key, { ...raw })
                : { ...raw };
            if (merged === undefined) {
                // A queued delete says this row is gone; do not resurrect it.
                state.rows.delete(key);
                deletes.push(this.rowKey(slug, key));
                continue;
            }
            this.forgetTombstone(slug, key);
            state.freshRows.add(key);
            const existing = state.rows.get(key);
            if (existing && JSON.stringify(existing.row) === JSON.stringify(merged)) {
                existing.cachedAt = cachedAt;
                continue;
            }
            state.rows.set(key, { row: merged, cachedAt, rev: ++this.revCounter });
            writes.push({ key: this.rowKey(slug, key), entry: { value: dehydrateRow(merged), cachedAt } });
        }
        if (writes.length > 0) void this.store.setCacheMany(writes).catch(() => undefined);
        if (deletes.length > 0) void this.deleteCache(deletes);
        this.evictRows(slug);
    }

    /**
     * Fold the queued mutations for one row over a base, newest last.
     * `afterMutationId` skips everything up to and including that mutation,
     * which is how a just-replayed write avoids being applied on top of the
     * server's response to it.
     */
    private applyPendingToRow(
        slug: string,
        idKey: string,
        base: AnyRow | undefined,
        afterMutationId?: string
    ): AnyRow | undefined {
        let row = base;
        let skipping = afterMutationId !== undefined;
        for (const op of this.queue) {
            if (skipping) {
                if (op.mutationId === afterMutationId) skipping = false;
                continue;
            }
            if (op.collection !== slug) continue;
            if (op.type === "createMany") {
                const match = (op.data as AnyRow[] | undefined)?.find((r) => String(r.id) === idKey);
                if (match) row = { ...match };
                continue;
            }
            if (op.id === undefined || String(op.id) !== idKey) continue;
            if (op.type === "create") row = { ...(op.data as AnyRow) };
            else if (op.type === "update") row = { ...(row ?? {}), ...(op.data as AnyRow), id: op.id };
            else if (op.type === "delete") row = undefined;
        }
        return row;
    }

    private recordSnapshot(slug: string, params: FindParams | undefined, result: FindResult<AnyRow>): QuerySnapshot {
        const window = resolvePagination(params);
        const meta = result.meta ?? { total: result.data?.length ?? 0, ...window, hasMore: false };
        const snapshot: QuerySnapshot = {
            ids: (result.data ?? []).map((row) => row.id as string | number).filter((id) => id !== undefined),
            total: meta.total ?? result.data?.length ?? 0,
            limit: meta.limit ?? window.limit,
            offset: meta.offset ?? window.offset,
            hasMore: meta.hasMore ?? false
        };
        const state = this.collectionState(slug);
        const key = buildQueryString(params);
        state.snapshots.set(key, snapshot);
        state.fresh.add(key);
        void this.writeCache(`${this.scope}|q|${slug}|${key}`, snapshot);
        this.evictSnapshots(slug);
        return snapshot;
    }

    /**
     * A write changed which rows belong in a list, and only the server can say
     * how — a row it generated is in no cached page, and the totals moved.
     * Re-run every live query on the collection; queries nobody is watching
     * are corrected by their next `find`.
     *
     * Coalesced per microtask so a burst of writes costs one round trip, and
     * skipped entirely while offline, where the local database is already the
     * best answer available.
     */
    private scheduleRefresh(slug: string): void {
        if (this.refreshPending.has(slug)) return;
        const observers = this.observers.get(slug);
        if (!observers || observers.size === 0) return;
        this.refreshPending.add(slug);
        void Promise.resolve().then(() => {
            this.refreshPending.delete(slug);
            if (this.disposed || !this.connectivity.shouldAttempt()) return;
            for (const observer of [...(this.observers.get(slug) ?? [])]) void observer.refresh();
        });
    }

    private evictRows(slug: string): void {
        const state = this.collections.get(slug);
        if (!state || state.rows.size <= this.maxCachedRows) return;
        const evictable = [...state.rows.entries()]
            .filter(([key]) => !this.hasPending(slug, key))
            .sort((a, b) => a[1].cachedAt - b[1].cachedAt);
        const excess = state.rows.size - this.maxCachedRows;
        const doomed = evictable.slice(0, excess);
        for (const [key] of doomed) state.rows.delete(key);
        if (doomed.length > 0) void this.deleteCache(doomed.map(([key]) => this.rowKey(slug, key)));

        // Tombstones are tiny but unbounded — every row the app ever asked for
        // and did not find leaves one. Cap them against the same budget.
        if (state.absent.size > this.maxCachedRows) {
            const stale = [...state.absent].slice(0, state.absent.size - this.maxCachedRows);
            for (const key of stale) state.absent.delete(key);
            void this.deleteCache(stale.map((key) => this.absentKey(slug, key)));
        }
    }

    private evictSnapshots(slug: string): void {
        const state = this.collections.get(slug);
        if (!state || state.snapshots.size <= this.maxCachedQueries) return;
        // Insertion order is recency order for a Map that re-sets on write.
        const excess = state.snapshots.size - this.maxCachedQueries;
        const doomed = [...state.snapshots.keys()].slice(0, excess);
        for (const key of doomed) state.snapshots.delete(key);
        void this.deleteCache(doomed.map((key) => `${this.scope}|q|${slug}|${key}`));
    }

    // ─── Queue ───────────────────────────────────────────────────────────────

    private ensureQueueLoaded(): Promise<void> {
        if (!this.queueLoad) {
            const scope = this.scope;
            this.queueLoad = this.store.listQueue(`${scope}|`).then((queue) => {
                // A scope switch during the load must not graft the old
                // user's queue onto the new one.
                if (this.scope !== scope) return;
                this.queue = queue;
                this.patchStatus({ pending: queue.length });
                this.notifyQueue();
            }).catch(() => undefined);
        }
        return this.queueLoad;
    }

    private enqueue(mutation: Omit<PendingMutation, "mutationId" | "queuedAt">): Promise<void> {
        const result = this.enqueueChain.then(async () => {
            await this.ensureQueueLoaded();

            // Tail coalescing: repeated edits to the most recently written row
            // (typing in a form) collapse into the queued op instead of
            // growing the queue. Only the queue *tail* may absorb an update —
            // merging into an earlier op would move this write across ops
            // queued after it, silently reordering what the app did.
            if (mutation.type === "update") {
                const tail = this.queue[this.queue.length - 1];
                if (tail
                    && tail.mutationId !== this.inFlightId
                    && tail.collection === mutation.collection
                    && (tail.type === "create" || tail.type === "update")
                    && tail.id === mutation.id) {
                    // The id must survive the merge: a queued create carries
                    // the client-generated id inside its data. The rollback
                    // stays the tail's — the state before the *first* of the
                    // merged writes, which is what undoing them all restores.
                    tail.data = { ...(tail.data as AnyRow), ...(mutation.data as AnyRow), id: tail.id };
                    await this.store.enqueue(this.queueKey(tail), tail);
                    return;
                }
            }

            // Cancel-out: deleting a row whose create is still queued — and
            // whose id the SDK generated, so the server cannot already have a
            // row under it — means the server never saw the row. Remove every
            // queued op for it and queue nothing. Creates with caller-supplied
            // ids do NOT cancel (the id may name an existing server row, which
            // the delete must still remove), and neither do rows queued inside
            // a createMany (the bulk op replays first, then the delete).
            if (mutation.type === "delete") {
                // An in-flight create disqualifies the shortcut entirely: the
                // server is being told about the row as we speak, so "it never
                // saw it" is false and the delete has to replay after it.
                const hasPendingCreate = this.queue.some((m) =>
                    m.collection === mutation.collection && m.type === "create"
                    && m.id === mutation.id && m.generatedId === true
                    && m.mutationId !== this.inFlightId);
                if (hasPendingCreate) {
                    const doomed = this.queue.filter((m) =>
                        m.collection === mutation.collection
                        && m.id === mutation.id
                        && (m.type === "create" || m.type === "update")
                        && m.mutationId !== this.inFlightId);
                    for (const op of doomed) await this.store.dequeue(this.queueKey(op));
                    this.queue = this.queue.filter((m) => !doomed.includes(m));
                    this.afterQueueChange();
                    return;
                }
            }

            const full: PendingMutation = {
                ...mutation,
                mutationId: createMutationId(),
                queuedAt: Date.now()
            };
            await this.store.enqueue(this.queueKey(full), full);
            this.queue.push(full);
            this.afterQueueChange();
        });
        // The chain must survive a failed enqueue, or every later write dies
        // on the same stale rejection.
        this.enqueueChain = result.catch(() => undefined);
        return result;
    }

    private hasPending(slug: string, id: string | number): boolean {
        const key = String(id);
        return this.queue.some((op) => {
            if (op.collection !== slug) return false;
            if (op.type === "createMany") {
                return (op.data as AnyRow[] | undefined)?.some((r) => String(r.id) === key) ?? false;
            }
            return op.id !== undefined && String(op.id) === key;
        });
    }

    /** Is this row one the server has never been told about? */
    private isLocallyCreated(slug: string, idKey: string): boolean {
        return this.queue.some((op) => {
            if (op.collection !== slug) return false;
            if (op.type === "create") return op.id !== undefined && String(op.id) === idKey;
            if (op.type === "createMany") {
                return (op.data as AnyRow[] | undefined)?.some((r) => String(r.id) === idKey) ?? false;
            }
            return false;
        });
    }

    /** How many rows the queue adds to (or removes from) a server-side count. */
    private pendingDelta(slug: string, params?: FindParams): number {
        if (!isExactlyEvaluable(params)) return 0;
        let delta = 0;
        for (const op of this.queue) {
            if (op.collection !== slug) continue;
            if (op.type === "create") {
                if (matchesParams(op.data as AnyRow, params)) delta++;
            } else if (op.type === "createMany") {
                for (const row of (op.data as AnyRow[] | undefined) ?? []) {
                    if (matchesParams(row, params)) delta++;
                }
            } else if (op.type === "delete") {
                const before = op.rollback?.rows?.[String(op.id)];
                if (before && matchesParams(before, params)) delta--;
            }
        }
        return delta;
    }

    // ─── Replay ──────────────────────────────────────────────────────────────

    sync(): Promise<{ flushed: number; remaining: number }> {
        if (this.flushPromise) return this.flushPromise;
        this.flushPromise = this.withLock(() => this.flush())
            .finally(() => { this.flushPromise = undefined; });
        return this.flushPromise;
    }

    private async flush(): Promise<{ flushed: number; remaining: number }> {
        await this.ensureQueueLoaded();
        // Another tab may have queued or drained work since we last looked.
        await this.reloadQueue();
        if (this.queue.length === 0) return { flushed: 0, remaining: 0 };
        // No `shouldAttempt` guard: every caller of `sync` — the app, the
        // retry timer, an `online` event, a sign-in — is asking for a real
        // attempt, and its outcome is what reopens the connection.

        this.patchStatus({ syncing: true });
        const touched = new Set<string>();
        const queuedAtStart = this.queue.length;
        let flushed = 0;
        try {
            while (this.queue.length > 0 && !this.disposed) {
                const op = this.queue[0];
                touched.add(op.collection);
                // Held across `drop` as well as `replay`: between the ACK and
                // the dequeue the op is still in `queue`, still the tail, and
                // still about to be removed — coalescing into it there loses
                // the write exactly as coalescing during the request does.
                this.inFlightId = op.mutationId;
                try {
                    try {
                        await this.replay(op);
                    } catch (error) {
                        if (isNetworkError(error)) {
                            // Still offline — keep the op and everything behind it.
                            this.connectivity.markFailure();
                            break;
                        }
                        op.attempts = (op.attempts ?? 0) + 1;
                        op.lastError = (error as Error)?.message ?? String(error);
                        if (isRetryableError(error) && op.attempts < this.maxRetries) {
                            // The server is busy, not unhappy. Keep the op — and
                            // its place in line, since later writes may depend on
                            // it — and come back after a backoff.
                            await this.store.enqueue(this.queueKey(op), op).catch(() => undefined);
                            this.connectivity.deferRetry();
                            this.patchStatus({ lastError: op.lastError });
                            break;
                        }
                        await this.rejectMutation(op, error as Error);
                        continue;
                    }
                    this.connectivity.markSuccess();
                    await this.drop(op);
                    flushed++;
                } finally {
                    this.inFlightId = null;
                }
            }
        } finally {
            this.patchStatus({ syncing: false });
        }

        if (this.queue.length !== queuedAtStart) {
            for (const slug of touched) {
                this.notifyCollection(slug);
                // The server has now seen these writes, and its page
                // composition and totals moved with them.
                this.scheduleRefresh(slug);
            }
            // One message for the whole drain — including a drain that only
            // rolled writes back, which other tabs need to hear about just as
            // much as one that succeeded.
            this.broadcast({ type: "queue" });
        }
        if (this.queue.length === 0) this.patchStatus({ lastSyncedAt: Date.now() });
        return { flushed, remaining: this.queue.length };
    }

    private async replay(op: PendingMutation): Promise<void> {
        const inner = this.innerFor(op.collection);
        if (op.type === "create") {
            // The queued row already carries its (client-generated) id.
            let row: AnyRow | undefined;
            try {
                // The mutation id names this write, so a server that stores keys
                // recognises a replay instead of inserting a second row. This is
                // the only defence for a table with a server-assigned id: the id
                // the client chose was never used, so a duplicate is invisible
                // from here. Ignored by servers that do not support it.
                row = await inner.create(op.data as AnyRow, undefined, { idempotencyKey: op.mutationId });
            } catch (error) {
                // A lost response, not a rejection. The request reached the
                // server and committed; only the ACK went missing, so the
                // replay finds the row already there.
                //
                // Restricted to ids the SDK minted: a fresh uuid cannot name a
                // row anyone else created, so a duplicate under it is
                // necessarily this mutation's own first attempt. A
                // caller-supplied id carries no such guarantee — it may well
                // collide with a row that was already there, which is a real
                // conflict the caller has to hear about.
                //
                // Without this, `rejectMutation` rolled the write back and
                // DELETED the local row — the one case where the row does exist
                // on the server. The user watched their own saved record vanish.
                if (!(op.generatedId === true && isDuplicateKeyError(error))) throw error;
                row = await inner.findById(op.id!).catch(() => undefined) as AnyRow | undefined;
                // The read can fail on its own (offline again, RLS). The row is
                // known to exist, so keep the local copy rather than rolling
                // back; the next refresh reconciles it.
                if (!row) return;
            }
            await this.adoptServerRow(op, op.id, row);
        } else if (op.type === "createMany") {
            const queued = (op.data as AnyRow[]) ?? [];
            // The mutation id names this batch, exactly as it names a single
            // `create` above — and it matters more here. Without it, a batch
            // whose ACK went missing replays as a second genuine import and
            // duplicates every row it holds, not one. `upsert` masked that for
            // the callers who set it; nothing covered the ones who did not.
            const rows = await inner.createMany(queued, {
                ...(op.upsert ? { upsert: true } : {}),
                idempotencyKey: op.mutationId
            });
            for (let i = 0; i < rows.length; i++) {
                await this.adoptServerRow(op, queued[i]?.id as string | number | undefined, rows[i]);
            }
        } else if (op.type === "updateMany") {
            const queued = op.updates ?? [];
            // Keyed like every other replay: an update re-applied in full is
            // naturally idempotent, but one interleaved with another writer's is
            // not, and a lost ACK would otherwise re-apply a stale batch over
            // newer data.
            const rows = await inner.updateMany(
                queued.map(u => ({ id: u.id,
data: u.data as AnyRow })),
                { idempotencyKey: op.mutationId }
            );
            for (let i = 0; i < rows.length; i++) {
                await this.ingestReplaced(op, queued[i].id, rows[i]);
            }
        } else if (op.type === "update") {
            const row = await inner.update(op.id!, op.data as AnyRow);
            await this.ingestReplaced(op, op.id!, row);
        } else if (op.type === "deleteMany") {
            const ids = op.ids ?? [];
            await inner.deleteMany(ids, { idempotencyKey: op.mutationId });
            for (const id of ids) this.removeLocalRow(op.collection, id, true);
        } else if (op.type === "delete") {
            await inner.delete(op.id!);
            this.removeLocalRow(op.collection, op.id!, true);
        }
    }

    /**
     * Take the server's version of a row the client created offline.
     *
     * The server may have assigned a different id — a serial column ignores
     * the id we invented — in which case every local trace of the temporary id
     * has to move with it, including queued writes that were made against it
     * before it was ever sent.
     */
    private async adoptServerRow(
        op: PendingMutation,
        localId: string | number | undefined,
        row: AnyRow | undefined
    ): Promise<void> {
        if (!row) return;
        const slug = op.collection;
        const serverId = row.id as string | number | undefined;
        if (localId !== undefined && serverId !== undefined && String(serverId) !== String(localId)) {
            const oldKey = String(localId);
            this.removeLocalRow(slug, localId);
            for (const queued of this.queue) {
                if (queued.collection !== slug) continue;
                let dirty = false;
                if (queued.id !== undefined && String(queued.id) === oldKey) {
                    queued.id = serverId;
                    if (queued.data && !Array.isArray(queued.data)) {
                        (queued.data as AnyRow).id = serverId;
                    }
                    dirty = true;
                }
                // The rollback map is keyed by row id too, and restoring it
                // under a name the server never had would resurrect a ghost.
                const rollbackRows = queued.rollback?.rows;
                if (rollbackRows && oldKey in rollbackRows) {
                    rollbackRows[String(serverId)] = rollbackRows[oldKey];
                    delete rollbackRows[oldKey];
                    dirty = true;
                }
                if (dirty) await this.store.enqueue(this.queueKey(queued), queued).catch(() => undefined);
            }
        }
        await this.ingestReplaced(op, serverId ?? localId!, row);
    }

    /**
     * Write a server row over the local one, ignoring the mutation that just
     * produced it — re-applying that would put the pre-server values back on
     * top of the server's answer — but keeping every write queued *after* it.
     * Those are still unsent, and dropping them here would make the row snap
     * back to the server's version in front of the user, only to change again
     * when they replay a moment later.
     */
    private async ingestReplaced(op: PendingMutation, id: string | number, row: AnyRow): Promise<void> {
        const slug = op.collection;
        const state = await this.ensureCollection(slug);
        const key = String(id);
        const merged = this.applyPendingToRow(slug, key, { ...row }, op.mutationId);
        if (merged === undefined) {
            // A queued delete is still waiting behind this write.
            this.removeLocalRow(slug, key);
            return;
        }
        const cachedAt = Date.now();
        state.rows.set(key, { row: merged, cachedAt, rev: ++this.revCounter });
        if (this.applyPendingToRow(slug, key, undefined, op.mutationId) === undefined) {
            // Nothing local is left on top of it, so this *is* the server's row.
            state.freshRows.add(key);
        }
        void this.writeCache(this.rowKey(slug, key), dehydrateRow(merged), cachedAt);
    }

    /**
     * The server refused a mutation. Put back what it changed, and discard the
     * queued writes that were built on top of it: an edit to a row whose
     * creation was rejected can only fail the same way, and applying it would
     * leave the local database claiming a row the server does not have.
     *
     * The cascade stops the moment a later write stops *depending* on the
     * rejected one. An `update` reads the row it edits, so it is doomed with
     * it; a `create` overwrites the row outright and a `delete` needs nothing
     * of it, so both stand on their own and are kept — dropping them would
     * silently lose writes the server would have accepted.
     */
    private async rejectMutation(op: PendingMutation, error: Error): Promise<void> {
        const ids = new Set(Object.keys(op.rollback?.rows ?? {}));
        if (op.id !== undefined) ids.add(String(op.id));

        const doomed: PendingMutation[] = [op];
        const orphaned = new Set(ids);
        const position = this.queue.indexOf(op);
        for (const later of this.queue.slice(position + 1)) {
            if (later.collection !== op.collection) continue;
            const hit = this.idsOf(later).filter((id) => orphaned.has(id));
            if (hit.length === 0) continue;
            if (later.type === "update") doomed.push(later);
            else for (const id of hit) orphaned.delete(id);
        }

        for (const dropped of doomed) await this.drop(dropped);

        for (const [idKey, previous] of Object.entries(op.rollback?.rows ?? {})) {
            // With the doomed writes gone, whatever survives in the queue is
            // what the row should still look like on top of the restored base.
            const restored = this.applyPendingToRow(op.collection, idKey, previous ?? undefined);
            if (restored === undefined) this.removeLocalRow(op.collection, idKey);
            else this.setLocalRow(op.collection, idKey, restored);
        }

        this.patchStatus({ lastError: error.message });
        this.notifyCollection(op.collection);
        this.scheduleRefresh(op.collection);
        for (const dropped of doomed) this.onSyncError?.(error, dropped);
    }

    /** Every row id a mutation writes to. */
    private idsOf(op: PendingMutation): string[] {
        if (op.type === "createMany") {
            return ((op.data as AnyRow[] | undefined) ?? []).map((r) => String(r.id));
        }
        return op.id === undefined ? [] : [String(op.id)];
    }

    private async drop(op: PendingMutation): Promise<void> {
        await this.store.dequeue(this.queueKey(op)).catch(() => undefined);
        this.queue = this.queue.filter((m) => m.mutationId !== op.mutationId);
        // No broadcast per item: draining a queue of fifty would be fifty
        // messages to every other tab. The flush announces itself once, at the end.
        this.afterQueueChange(false);
    }

    /** Replay uses unwrapped clients: a failure must never re-enqueue itself. */
    private innerFor(slug: string): SDKCollectionClient<AnyRow> {
        let inner = this.inners.get(slug);
        if (!inner) {
            inner = this.createInner(slug);
            this.inners.set(slug, inner);
        }
        return inner;
    }

    private async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
        // Two tabs replaying the same queue would each send every mutation.
        if (!locks?.request) return fn();
        try {
            return await locks.request(`rebase-offline-sync:${this.scope}`, fn) as T;
        } catch {
            // A browser that denies the lock (or a policy that blocks it) must
            // not stop the queue from draining at all.
            return fn();
        }
    }

    // ─── Cross-tab ───────────────────────────────────────────────────────────

    private broadcast(message: { type: "rows"; slugs: string[] } | { type: "queue" }): void {
        if (!this.channel) return;
        try {
            this.channel.postMessage({ ...message, scope: this.scope, sender: this.tabId });
        } catch {
            // Structured-clone failures here would only cost cross-tab freshness.
        }
    }

    private onBroadcast(message: unknown): void {
        if (this.disposed || !message || typeof message !== "object") return;
        const msg = message as { type?: string; scope?: string; sender?: string; slugs?: string[] };
        if (msg.sender === this.tabId || msg.scope !== this.scope) return;
        if (msg.type === "rows") {
            for (const slug of msg.slugs ?? []) void this.reloadCollection(slug);
        } else if (msg.type === "queue") {
            void this.reloadQueue();
        }
    }

    /** Re-read one collection from the store, replacing what is in memory. */
    private async reloadCollection(slug: string): Promise<void> {
        const state = this.collections.get(slug);
        if (!state?.loaded) return; // never loaded here — nothing to keep fresh
        await this.reloadQueue();
        const scope = this.scope;
        const [rows, snapshots, absent] = await Promise.all([
            this.store.listCacheEntries(`${scope}|row|${slug}|`).catch(() => []),
            this.store.listCacheEntries(`${scope}|q|${slug}|`).catch(() => []),
            this.store.listCache(`${scope}|abs|${slug}|`).catch(() => [])
        ]);
        if (this.scope !== scope || this.collections.get(slug) !== state) return;
        const next = new Map<string, RowEntry>();
        for (const entry of rows) {
            const row = entry.value as AnyRow | undefined;
            if (!row || row.id === undefined || row.id === null) continue;
            const key = String(row.id);
            const existing = state.rows.get(key);
            const hydrated = hydrateRow(row);
            // Keep the previous revision when nothing actually changed, so a
            // cross-tab ping does not re-render every observer.
            const unchanged = existing && JSON.stringify(existing.row) === JSON.stringify(hydrated);
            next.set(key, {
                row: hydrated,
                cachedAt: entry.cachedAt,
                rev: unchanged ? existing!.rev : ++this.revCounter
            });
        }
        state.rows = next;
        state.snapshots = new Map();
        for (const entry of snapshots) {
            const key = entry.key.slice(`${scope}|q|${slug}|`.length);
            if (entry.value) state.snapshots.set(key, entry.value as QuerySnapshot);
        }
        state.absent = new Set(absent.map((entry) => entry.key.slice(`${scope}|abs|${slug}|`.length)));
        this.notifyCollection(slug, false);
    }

    private async reloadQueue(): Promise<void> {
        const scope = this.scope;
        const queue = await this.store.listQueue(`${scope}|`).catch(() => undefined);
        if (!queue || this.scope !== scope) return;
        this.queue = queue;
        this.afterQueueChange(false);
    }

    // ─── Notifications ───────────────────────────────────────────────────────

    private afterQueueChange(broadcast = true): void {
        this.patchStatus({ pending: this.queue.length });
        this.notifyQueue();
        if (broadcast) this.broadcast({ type: "queue" });
    }

    private notifyQueue(): void {
        for (const listener of this.queueListeners) listener(this.queue.length);
    }

    private patchStatus(patch: Partial<OfflineStatus>): void {
        let changed = false;
        for (const [key, value] of Object.entries(patch) as [keyof OfflineStatus, never][]) {
            if (this.currentStatus[key] !== value) {
                this.currentStatus[key] = value;
                changed = true;
            }
        }
        if (!changed) return;
        const snapshot = { ...this.currentStatus };
        for (const listener of this.statusListeners) listener(snapshot);
    }

    // ─── Store keys and access ───────────────────────────────────────────────

    private countKey(slug: string, params?: FindParams): string {
        return `${this.scope}|count|${slug}|${buildQueryString(params)}`;
    }

    private rowKey(slug: string, id: string | number): string {
        return `${this.scope}|row|${slug}|${String(id)}`;
    }

    private absentKey(slug: string, id: string | number): string {
        return `${this.scope}|abs|${slug}|${String(id)}`;
    }

    private queueKey(mutation: PendingMutation): string {
        return `${this.scope}|${mutation.mutationId}`;
    }

    private async readCache<T>(key: string): Promise<T | undefined> {
        try {
            const entry = await this.store.getCache(key);
            return entry?.value as T | undefined;
        } catch {
            // A broken cache read must degrade to "no cache", never break the app.
            return undefined;
        }
    }

    private async writeCache(key: string, value: unknown, cachedAt = Date.now()): Promise<void> {
        try {
            await this.store.setCache(key, { value, cachedAt });
        } catch {
            // Quota errors and private-browsing restrictions must not fail the
            // read or write that got us here.
        }
    }

    private async deleteCache(keys: string[]): Promise<void> {
        try {
            await this.store.deleteCache(keys);
        } catch {
            // Same rationale as writeCache.
        }
    }
}
