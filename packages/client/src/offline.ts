import { buildQueryString, FindParams, RebaseApiError } from "./transport";
import { FindResult, LogicalCondition, SDKCollectionClient, WhereFilterOp, WhereValue } from "@rebasepro/types";
import { CollectionClient } from "./collection";
import { SDKQueryBuilder } from "./sdk_query_builder";
import {
    IndexedDBOfflineStore,
    MemoryOfflineStore,
    OfflineStore,
    PendingMutation
} from "./offline-store";

/**
 * Offline support for the SDK data layer.
 *
 * Reads are network-first: a successful `find`/`findById`/`count` refreshes a
 * local cache, and a network failure falls back to the last cached answer.
 * Writes made while offline are queued and replayed, in the order the app
 * issued them, when connectivity returns. Until then every read — cached or
 * fresh — has the queued writes overlaid, so the app sees its own changes
 * immediately instead of watching them flicker away on the next fetch.
 *
 * What this deliberately is NOT (yet): a local query engine. A cached query
 * is only ever answered for the exact same parameters, and queued creates are
 * folded into filtered queries' totals never — we cannot evaluate a `where`
 * clause client-side, so filtered results only overlay updates and deletes by
 * row id, which are always safe.
 */

export interface OfflineConfig {
    /**
     * Persistence backend. Defaults to IndexedDB in the browser and an
     * in-memory store elsewhere; pass a custom implementation (e.g. backed by
     * AsyncStorage in React Native) to persist in other environments.
     */
    store?: OfflineStore;
    /**
     * Cached query results kept per collection; the least recently written
     * are evicted beyond this. Defaults to 50.
     */
    maxCachedQueriesPerCollection?: number;
    /**
     * How often to retry replaying the queue while it is non-empty, in
     * milliseconds. The `online` browser event and a sign-in also trigger a
     * replay; this timer is the safety net for environments with neither.
     * Defaults to 30 000.
     */
    syncIntervalMs?: number;
    /**
     * Called when the server *rejects* a queued mutation during replay (a
     * 4xx/5xx response — validation, RLS, a since-deleted row). The mutation
     * is dropped: keeping it would jam the queue behind an error that will
     * never resolve. Network failures are not errors — the mutation stays
     * queued for the next attempt.
     */
    onSyncError?: (error: Error, mutation: PendingMutation) => void;
}

/** What `client.offline` exposes to the app. */
export interface OfflineApi {
    /** Replay the queue now. Resolves with what was flushed and what remains. */
    sync(): Promise<{ flushed: number; remaining: number }>;
    /** The queued mutations for the current user, oldest first. */
    pending(): Promise<PendingMutation[]>;
    /**
     * Drop the current user's queued mutations AND cached reads. Destructive:
     * queued writes are lost, not replayed. For "discard my offline changes"
     * flows, not for sign-out (scoping already isolates users).
     */
    clear(): Promise<void>;
    /** Subscribe to queue-size changes (for a "pending changes" badge). */
    onQueueChange(listener: (count: number) => void): () => void;
}

/** True for "the request never reached the server", false for a server reply. */
function isNetworkError(error: unknown): boolean {
    if (error instanceof RebaseApiError) return false;
    // fetch rejects with TypeError on network failure in every runtime we
    // support (browsers: "Failed to fetch"/"Load failed"; undici: "fetch
    // failed"). Anything else — a programming error — must propagate.
    return error instanceof TypeError;
}

function generateOfflineId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    // Non-cryptographic fallback for exotic runtimes; collision odds are
    // irrelevant at offline-queue scale.
    return `off-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A find is "appendable" when queued creates provably belong in its result set. */
function isAppendable(params?: FindParams): boolean {
    return !params?.where && !params?.logical && !params?.searchString;
}

type AnyRow = Record<string, unknown>;
type InnerFactory = (slug: string) => SDKCollectionClient<AnyRow>;

export class OfflineManager {
    private readonly store: OfflineStore;
    private readonly maxCachedQueries: number;
    private readonly onSyncError?: OfflineConfig["onSyncError"];
    private readonly syncIntervalMs: number;
    private readonly createInner: InnerFactory;
    private readonly inners = new Map<string, SDKCollectionClient<AnyRow>>();

    private scope = "anon";
    /** In-memory mirror of the current scope's queue, kept in seq order. */
    private queue: PendingMutation[] = [];
    private loadPromise?: Promise<void>;
    private nextSeq = 1;
    /** Serializes enqueues so concurrent writes get distinct, ordered seqs. */
    private enqueueChain: Promise<unknown> = Promise.resolve();
    private flushPromise?: Promise<{ flushed: number; remaining: number }>;
    private queueListeners = new Set<(count: number) => void>();
    private syncTimer?: ReturnType<typeof setInterval>;
    private readonly onOnline = () => { void this.sync().catch(() => undefined); };

    readonly api: OfflineApi;

    constructor(config: OfflineConfig, createInner: InnerFactory) {
        this.store = config.store
            ?? (typeof indexedDB !== "undefined" ? new IndexedDBOfflineStore() : new MemoryOfflineStore());
        this.maxCachedQueries = config.maxCachedQueriesPerCollection ?? 50;
        this.syncIntervalMs = config.syncIntervalMs ?? 30_000;
        this.onSyncError = config.onSyncError;
        this.createInner = createInner;

        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("online", this.onOnline);
        }

        this.api = {
            sync: () => this.sync(),
            pending: async () => {
                await this.ensureLoaded();
                // Deep-copied: these are live queue entries (tail coalescing
                // mutates them in place), and a caller must not be able to
                // edit what will be replayed.
                return this.queue.map((m) => structuredClone(m));
            },
            clear: async () => {
                await this.store.clear(`${this.scope}|`);
                this.queue = [];
                this.notifyQueue();
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
        this.loadPromise = undefined;
        this.queue = [];
        // The returning user's queue may hold writes from a previous session.
        void this.sync().catch(() => undefined);
    }

    /** Release the online listener and retry timer (client.close()). */
    dispose(): void {
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
            window.removeEventListener("online", this.onOnline);
        }
        this.stopTimer();
    }

    // ─── Collection wrapping ─────────────────────────────────────────────────

    wrap<M extends AnyRow>(slug: string, inner: CollectionClient<M>): CollectionClient<M> {
        this.inners.set(slug, inner as SDKCollectionClient<AnyRow>);

        const wrapped: CollectionClient<M> = {
            find: async (params?: FindParams): Promise<FindResult<M>> => {
                try {
                    const res = await inner.find(params);
                    await this.cacheSet(this.findKey(slug, params), res);
                    return await this.overlayFind(slug, params, res);
                } catch (error) {
                    if (!isNetworkError(error)) throw error;
                    const cached = await this.cacheGet<FindResult<M>>(this.findKey(slug, params));
                    if (cached === undefined) throw error;
                    return this.overlayFind(slug, params, cached);
                }
            },

            findById: async (id: string | number) => {
                try {
                    const row = await inner.findById(id);
                    if (row !== undefined) await this.cacheSet(this.rowKey(slug, id), row);
                    return await this.overlayRow(slug, id, row);
                } catch (error) {
                    if (!isNetworkError(error)) throw error;
                    const cached = await this.cacheGet<M>(this.rowKey(slug, id));
                    const { touched, row } = await this.composeRowFromQueue<M>(slug, id, cached);
                    if (!touched && cached === undefined) throw error;
                    return touched ? row : cached;
                }
            },

            create: async (data: Partial<M>, id?: string | number) => {
                try {
                    return await inner.create(data, id);
                } catch (error) {
                    if (!isNetworkError(error)) throw error;
                    const providedId = id ?? (data as AnyRow).id as string | number | undefined;
                    const rowId = providedId ?? generateOfflineId();
                    const row = { ...(data as AnyRow), id: rowId } as unknown as M;
                    await this.enqueue({
                        collection: slug,
                        type: "create",
                        id: rowId,
                        data: row,
                        generatedId: providedId === undefined
                    });
                    await this.cacheSet(this.rowKey(slug, rowId), row);
                    return row;
                }
            },

            createMany: async (data: Partial<M>[], options?: { upsert?: boolean }) => {
                try {
                    return await inner.createMany(data, options);
                } catch (error) {
                    if (!isNetworkError(error)) throw error;
                    if (!Array.isArray(data) || data.length === 0) return [];
                    const rows = data.map((r) => ({
                        ...(r as AnyRow),
                        id: (r as AnyRow).id ?? generateOfflineId()
                    })) as unknown as M[];
                    await this.enqueue({
                        collection: slug,
                        type: "createMany",
                        data: rows,
                        upsert: options?.upsert
                    });
                    for (const row of rows) {
                        await this.cacheSet(this.rowKey(slug, row.id as string | number), row);
                    }
                    return rows;
                }
            },

            update: async (id: string | number, data: Partial<M>) => {
                try {
                    const row = await inner.update(id, data);
                    await this.cacheSet(this.rowKey(slug, id), row);
                    return row;
                } catch (error) {
                    if (!isNetworkError(error)) throw error;
                    await this.enqueue({ collection: slug, type: "update", id, data: data as AnyRow });
                    const base = await this.cacheGet<M>(this.rowKey(slug, id));
                    const optimistic = { ...(base ?? {}), ...(data as AnyRow), id } as unknown as M;
                    await this.cacheSet(this.rowKey(slug, id), optimistic);
                    return optimistic;
                }
            },

            delete: async (id: string | number) => {
                try {
                    await inner.delete(id);
                    await this.cacheDelete(this.rowKey(slug, id));
                } catch (error) {
                    if (!isNetworkError(error)) throw error;
                    await this.enqueue({ collection: slug, type: "delete", id });
                    await this.cacheDelete(this.rowKey(slug, id));
                }
            },

            count: async (params?: FindParams): Promise<number> => {
                try {
                    const n = await inner.count(params);
                    await this.cacheSet(this.countKey(slug, params), n);
                    return this.overlayCount(slug, params, n);
                } catch (error) {
                    if (!isNetworkError(error)) throw error;
                    const cached = await this.cacheGet<number>(this.countKey(slug, params));
                    if (cached === undefined) throw error;
                    return this.overlayCount(slug, params, cached);
                }
            },

            // The builder calls back into `wrapped.find(...)`, so fluent
            // queries go through the cache/overlay path like direct calls.
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

        // Realtime passthrough: a live subscription is by definition online,
        // so the overlay would only fight the server's own event stream.
        if (inner.listen) wrapped.listen = inner.listen.bind(inner);
        if (inner.listenById) wrapped.listenById = inner.listenById.bind(inner);

        return wrapped;
    }

    // ─── Overlay: pending writes applied on top of a read ────────────────────

    private async pendingFor(slug: string): Promise<PendingMutation[]> {
        await this.ensureLoaded();
        return this.queue.filter((m) => m.collection === slug);
    }

    private async overlayFind<M extends AnyRow>(
        slug: string,
        params: FindParams | undefined,
        result: FindResult<M>
    ): Promise<FindResult<M>> {
        const ops = await this.pendingFor(slug);
        if (ops.length === 0) return result;

        const appendable = isAppendable(params);
        let rows = result.data.map((r) => ({ ...r }));
        let total = result.meta.total;

        const applyCreate = (row: AnyRow) => {
            if (!appendable) return;
            if (rows.some((r) => r.id === row.id)) return;
            rows.push({ ...row } as M);
            total++;
        };

        for (const op of ops) {
            if (op.type === "create") {
                applyCreate(op.data as AnyRow);
            } else if (op.type === "createMany") {
                for (const row of op.data as AnyRow[]) applyCreate(row);
            } else if (op.type === "update") {
                const idx = rows.findIndex((r) => r.id === op.id);
                if (idx >= 0) rows[idx] = { ...rows[idx], ...(op.data as AnyRow) } as M;
            } else if (op.type === "delete") {
                const before = rows.length;
                rows = rows.filter((r) => r.id !== op.id);
                if (rows.length < before) total = Math.max(0, total - 1);
            }
        }

        return { data: rows, meta: { ...result.meta, total } };
    }

    private async overlayCount(slug: string, params: FindParams | undefined, count: number): Promise<number> {
        const ops = await this.pendingFor(slug);
        if (ops.length === 0 || !isAppendable(params)) return count;
        let n = count;
        for (const op of ops) {
            if (op.type === "create") n++;
            else if (op.type === "createMany") n += (op.data as AnyRow[]).length;
            else if (op.type === "delete") n = Math.max(0, n - 1);
        }
        return n;
    }

    /**
     * Fold the queued ops for one row into a base value. `touched` separates
     * "the queue says this row does not exist" (a pending delete → undefined)
     * from "the queue has nothing to say" — the caller falls back differently.
     */
    private async composeRowFromQueue<M extends AnyRow>(
        slug: string,
        id: string | number,
        base: M | undefined
    ): Promise<{ touched: boolean; row: M | undefined }> {
        const ops = await this.pendingFor(slug);
        let touched = false;
        let row = base;
        for (const op of ops) {
            if (op.type === "create" && op.id === id) {
                row = { ...(op.data as AnyRow) } as M;
                touched = true;
            } else if (op.type === "createMany") {
                const match = (op.data as AnyRow[]).find((r) => r.id === id);
                if (match) { row = { ...match } as M; touched = true; }
            } else if (op.type === "update" && op.id === id) {
                row = { ...(row ?? {}), ...(op.data as AnyRow), id } as unknown as M;
                touched = true;
            } else if (op.type === "delete" && op.id === id) {
                row = undefined;
                touched = true;
            }
        }
        return { touched, row };
    }

    private async overlayRow<M extends AnyRow>(slug: string, id: string | number, base: M | undefined): Promise<M | undefined> {
        const { touched, row } = await this.composeRowFromQueue(slug, id, base);
        return touched ? row : base;
    }

    // ─── Queue ───────────────────────────────────────────────────────────────

    private ensureLoaded(): Promise<void> {
        if (!this.loadPromise) {
            const scope = this.scope;
            this.loadPromise = this.store.listQueue(`${scope}|`).then((queue) => {
                // A scope switch during the load must not graft the old
                // user's queue onto the new one.
                if (this.scope !== scope) return;
                this.queue = queue;
                this.nextSeq = queue.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
                if (queue.length > 0) this.startTimer();
                this.notifyQueue();
            });
        }
        return this.loadPromise;
    }

    private enqueue(mutation: Omit<PendingMutation, "seq" | "queuedAt">): Promise<void> {
        const result = this.enqueueChain.then(async () => {
            await this.ensureLoaded();

            // Tail coalescing: repeated edits to the most recently written row
            // (typing in a form) collapse into the queued op instead of
            // growing the queue. Only the queue *tail* may absorb an update —
            // merging into an earlier op would move this write across ops
            // queued after it, silently reordering what the app did.
            if (mutation.type === "update") {
                const tail = this.queue[this.queue.length - 1];
                if (tail
                    && tail.collection === mutation.collection
                    && (tail.type === "create" || tail.type === "update")
                    && tail.id === mutation.id) {
                    // The id must survive the merge: a queued create carries
                    // the client-generated id inside its data.
                    tail.data = { ...(tail.data as AnyRow), ...(mutation.data as AnyRow), id: tail.id };
                    await this.store.enqueue(this.queueKey(tail.seq), tail);
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
                const hasPendingCreate = this.queue.some((m) =>
                    m.collection === mutation.collection && m.type === "create"
                    && m.id === mutation.id && m.generatedId === true);
                if (hasPendingCreate) {
                    const doomed = this.queue.filter((m) =>
                        m.collection === mutation.collection
                        && m.id === mutation.id
                        && (m.type === "create" || m.type === "update"));
                    for (const op of doomed) await this.store.dequeue(this.queueKey(op.seq));
                    this.queue = this.queue.filter((m) => !doomed.includes(m));
                    this.notifyQueue();
                    return;
                }
            }

            const full: PendingMutation = { ...mutation, seq: this.nextSeq++, queuedAt: Date.now() };
            await this.store.enqueue(this.queueKey(full.seq), full);
            this.queue.push(full);
            this.startTimer();
            this.notifyQueue();
        });
        // The chain must survive a failed enqueue, or every later write dies
        // on the same stale rejection.
        this.enqueueChain = result.catch(() => undefined);
        return result;
    }

    sync(): Promise<{ flushed: number; remaining: number }> {
        if (this.flushPromise) return this.flushPromise;
        this.flushPromise = (async () => {
            await this.ensureLoaded();
            let flushed = 0;
            while (this.queue.length > 0) {
                const op = this.queue[0];
                try {
                    await this.replay(op);
                } catch (error) {
                    if (isNetworkError(error)) break; // still offline — keep the op, retry later
                    // The server saw it and said no. Drop it — replaying can
                    // only fail the same way — and let the app know.
                    await this.drop(op);
                    this.onSyncError?.(error as Error, op);
                    continue;
                }
                await this.drop(op);
                flushed++;
            }
            if (this.queue.length === 0) this.stopTimer();
            return { flushed, remaining: this.queue.length };
        })().finally(() => { this.flushPromise = undefined; });
        return this.flushPromise;
    }

    private async replay(op: PendingMutation): Promise<void> {
        const inner = this.innerFor(op.collection);
        if (op.type === "create") {
            // The queued row already carries its (client-generated) id.
            const row = await inner.create(op.data as AnyRow);
            await this.cacheSet(this.rowKey(op.collection, (row as AnyRow).id as string | number ?? op.id!), row);
        } else if (op.type === "createMany") {
            await inner.createMany(op.data as AnyRow[], op.upsert ? { upsert: true } : undefined);
        } else if (op.type === "update") {
            const row = await inner.update(op.id!, op.data as AnyRow);
            await this.cacheSet(this.rowKey(op.collection, op.id!), row);
        } else if (op.type === "delete") {
            await inner.delete(op.id!);
        }
    }

    private async drop(op: PendingMutation): Promise<void> {
        await this.store.dequeue(this.queueKey(op.seq));
        this.queue = this.queue.filter((m) => m.seq !== op.seq);
        this.notifyQueue();
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

    private notifyQueue(): void {
        for (const listener of this.queueListeners) listener(this.queue.length);
    }

    private startTimer(): void {
        if (this.syncTimer || this.syncIntervalMs <= 0) return;
        this.syncTimer = setInterval(() => {
            if (typeof navigator !== "undefined" && navigator.onLine === false) return;
            void this.sync().catch(() => undefined);
        }, this.syncIntervalMs);
        // In Node the timer must not keep a finished script alive.
        (this.syncTimer as { unref?: () => void }).unref?.();
    }

    private stopTimer(): void {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = undefined;
        }
    }

    // ─── Cache ───────────────────────────────────────────────────────────────

    private findKey(slug: string, params?: FindParams): string {
        return `${this.scope}|find|${slug}|${buildQueryString(params)}`;
    }

    private countKey(slug: string, params?: FindParams): string {
        return `${this.scope}|count|${slug}|${buildQueryString(params)}`;
    }

    private rowKey(slug: string, id: string | number): string {
        return `${this.scope}|row|${slug}|${String(id)}`;
    }

    private queueKey(seq: number): string {
        // Padded so lexicographic key order in the store IS seq order.
        return `${this.scope}|${String(seq).padStart(16, "0")}`;
    }

    private async cacheGet<T>(key: string): Promise<T | undefined> {
        try {
            const entry = await this.store.getCache(key);
            return entry?.value as T | undefined;
        } catch {
            // A broken cache read must degrade to "no cache", never break the app.
            return undefined;
        }
    }

    private async cacheSet(key: string, value: unknown): Promise<void> {
        try {
            await this.store.setCache(key, { value, cachedAt: Date.now() });
            if (key.startsWith(`${this.scope}|find|`)) {
                const bucket = key.slice(0, key.lastIndexOf("|") + 1);
                const entries = await this.store.listCache(bucket);
                if (entries.length > this.maxCachedQueries) {
                    entries.sort((a, b) => a.cachedAt - b.cachedAt);
                    await this.store.deleteCache(
                        entries.slice(0, entries.length - this.maxCachedQueries).map((e) => e.key)
                    );
                }
            }
        } catch {
            // Quota errors and private-browsing restrictions must not fail the read/write that got us here.
        }
    }

    private async cacheDelete(key: string): Promise<void> {
        try {
            await this.store.deleteCache([key]);
        } catch {
            // Same rationale as cacheSet.
        }
    }
}
