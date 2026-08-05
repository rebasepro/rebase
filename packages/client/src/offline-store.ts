/**
 * Persistence backends for the SDK's offline support.
 *
 * The store is a dumb, namespaced key/value surface with two areas: a read
 * cache (normalized rows, query snapshots and sync bookkeeping) and a mutation
 * queue (local writes waiting to reach the server). All structure — per-user
 * prefixes, the `row|`/`q|`/`meta|` namespaces, mutation ordering — is owned by
 * the {@link OfflineManager}; the store only promises that a prefix listing
 * comes back in lexicographic key order, which is what makes the queue a FIFO.
 *
 * Two implementations ship with the SDK:
 * - {@link IndexedDBOfflineStore} — the browser default; survives reloads.
 * - {@link MemoryOfflineStore} — the fallback everywhere IndexedDB does not
 *   exist (Node, React Native, tests); survives only the process.
 *
 * Environments with neither (React Native + AsyncStorage, Electron main, …)
 * implement this interface and pass it via `offline.store`.
 */

/** A cached value plus the moment it was written, for LRU eviction. */
export interface OfflineCacheEntry {
    value: unknown;
    cachedAt: number;
}

/** A cache entry with its key, as returned by prefix listings. */
export interface OfflineCacheRecord extends OfflineCacheEntry {
    key: string;
}

/** What a mutation has to put back if the server rejects it. */
export interface MutationRollback {
    /**
     * The rows as they were locally *before* this mutation was applied, keyed
     * by id. A `null` value means "the row did not exist" — restoring it is a
     * delete, not a write.
     */
    rows: Record<string, Record<string, unknown> | null>;
}

/**
 * A local write waiting to be replayed against the server.
 *
 * `mutationId` orders the queue globally (not per collection): a create in one
 * collection may be the parent a later insert in another references, so replay
 * must preserve the order the app issued the writes in. It is lexicographically
 * time-ordered and carries a random suffix, so two browser tabs writing in the
 * same millisecond produce distinct, still-roughly-ordered ids instead of
 * silently overwriting each other's queue entry.
 */
export interface PendingMutation {
    /** Unique, lexicographically sortable identity — also the queue key suffix. */
    mutationId: string;
    collection: string;
    type: "create" | "createMany" | "update" | "updateMany" | "delete" | "deleteMany";
    /** Target row id for update/delete, and the (client-generated) id of an offline create. */
    id?: string | number;
    /** Target row ids for `deleteMany`. */
    ids?: (string | number)[];
    /** `{ id, data }` entries for `updateMany`. */
    updates?: { id: string | number; data: Record<string, unknown> }[];
    /**
     * True when the SDK minted this create's id itself. Only such creates may
     * cancel out against a later offline delete: a freshly generated UUID
     * cannot name a row the server already has, while a caller-supplied id
     * can — and there the delete must still replay to remove the server row.
     */
    generatedId?: boolean;
    /** The payload: a row for create/update, an array of rows for createMany. */
    data?: Record<string, unknown> | Record<string, unknown>[];
    upsert?: boolean;
    queuedAt: number;
    /** How many times replay has been attempted (diagnostics for a stuck queue). */
    attempts?: number;
    /** The last replay failure's message, when there was one. */
    lastError?: string;
    /** Local state to restore if the server rejects this mutation. */
    rollback?: MutationRollback;
}

export interface OfflineStore {
    getCache(key: string): Promise<OfflineCacheEntry | undefined>;
    setCache(key: string, entry: OfflineCacheEntry): Promise<void>;
    /** Write many entries at once — one transaction where the backend has them. */
    setCacheMany(entries: { key: string; entry: OfflineCacheEntry }[]): Promise<void>;
    deleteCache(keys: string[]): Promise<void>;
    /** Every cache key starting with `prefix`, with its write time (for eviction). */
    listCache(prefix: string): Promise<{ key: string; cachedAt: number }[]>;
    /** As {@link listCache}, but with the values — the local query engine's input. */
    listCacheEntries(prefix: string): Promise<OfflineCacheRecord[]>;

    enqueue(key: string, mutation: PendingMutation): Promise<void>;
    dequeue(key: string): Promise<void>;
    /** Queued mutations whose key starts with `prefix`, in lexicographic key order. */
    listQueue(prefix: string): Promise<PendingMutation[]>;

    /** Remove every cache entry and queued mutation whose key starts with `prefix`. */
    clear(prefix: string): Promise<void>;
}

// ─── Mutation ids ────────────────────────────────────────────────────────────

/**
 * Monotonic within a tab, unique across tabs, and sortable as a plain string:
 * `<ms base36, padded>-<counter>-<random>`. The padding is what keeps
 * lexicographic order equal to chronological order, and the random suffix is
 * what stops two tabs from writing the same queue key in the same millisecond
 * — which would silently drop one of the two writes.
 */
let mutationCounter = 0;
export function createMutationId(now: number = Date.now()): string {
    const time = now.toString(36).padStart(10, "0");
    const counter = (mutationCounter = (mutationCounter + 1) % 1_679_616).toString(36).padStart(4, "0");
    const random = Math.random().toString(36).slice(2, 10).padStart(8, "0");
    return `${time}-${counter}-${random}`;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

/**
 * In-memory store: the default outside the browser and the workhorse of the
 * test suite. Values are deep-copied on the way in and out so a caller
 * mutating a returned row cannot silently edit the "persisted" copy — the
 * IndexedDB implementation gets the same guarantee for free from structured
 * cloning, and the two must not differ in aliasing behaviour.
 */
export class MemoryOfflineStore implements OfflineStore {
    private cache = new Map<string, OfflineCacheEntry>();
    private queue = new Map<string, PendingMutation>();

    async getCache(key: string): Promise<OfflineCacheEntry | undefined> {
        const entry = this.cache.get(key);
        return entry ? structuredClone(entry) : undefined;
    }

    async setCache(key: string, entry: OfflineCacheEntry): Promise<void> {
        this.cache.set(key, structuredClone(entry));
    }

    async setCacheMany(entries: { key: string; entry: OfflineCacheEntry }[]): Promise<void> {
        for (const { key, entry } of entries) this.cache.set(key, structuredClone(entry));
    }

    async deleteCache(keys: string[]): Promise<void> {
        for (const key of keys) this.cache.delete(key);
    }

    async listCache(prefix: string): Promise<{ key: string; cachedAt: number }[]> {
        const out: { key: string; cachedAt: number }[] = [];
        for (const [key, entry] of this.cache) {
            if (key.startsWith(prefix)) out.push({ key, cachedAt: entry.cachedAt });
        }
        return out;
    }

    async listCacheEntries(prefix: string): Promise<OfflineCacheRecord[]> {
        const out: OfflineCacheRecord[] = [];
        for (const [key, entry] of this.cache) {
            if (key.startsWith(prefix)) out.push({ key, ...structuredClone(entry) });
        }
        out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        return out;
    }

    async enqueue(key: string, mutation: PendingMutation): Promise<void> {
        this.queue.set(key, structuredClone(mutation));
    }

    async dequeue(key: string): Promise<void> {
        this.queue.delete(key);
    }

    async listQueue(prefix: string): Promise<PendingMutation[]> {
        return [...this.queue.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([, mutation]) => structuredClone(mutation));
    }

    async clear(prefix: string): Promise<void> {
        for (const key of [...this.cache.keys()]) {
            if (key.startsWith(prefix)) this.cache.delete(key);
        }
        for (const key of [...this.queue.keys()]) {
            if (key.startsWith(prefix)) this.queue.delete(key);
        }
    }
}

// ─── IndexedDB ───────────────────────────────────────────────────────────────

const IDB_NAME = "rebase-offline";
/**
 * v2 introduced the normalized row cache and string mutation ids. A v1
 * database holds whole-response blobs under keys this version cannot read and
 * queue entries ordered by a numeric `seq` this version no longer writes, so
 * the upgrade drops both stores rather than trying to translate them. Offline
 * support had not shipped in a release when v2 landed, so nothing in the wild
 * loses a queued write to this.
 */
const IDB_VERSION = 2;
const CACHE_STORE = "cache";
const QUEUE_STORE = "queue";

/** The exclusive upper bound of an IDBKeyRange covering every key under `prefix`. */
function prefixRange(prefix: string): IDBKeyRange {
    return IDBKeyRange.bound(prefix, prefix + "￿", false, false);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
}

/** Resolve when the whole transaction commits, not just when the last request returns. */
function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    });
}

/**
 * IndexedDB-backed store — the browser default, so cached rows and queued
 * writes survive a reload or a browser restart. Everything lives in one
 * database with two object stores; keys are the manager's full prefixed
 * strings, so multiple users (scopes) share the database without ever
 * sharing entries.
 */
export class IndexedDBOfflineStore implements OfflineStore {
    private dbPromise?: Promise<IDBDatabase>;

    private open(): Promise<IDBDatabase> {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(IDB_NAME, IDB_VERSION);
                request.onupgradeneeded = (event) => {
                    const db = request.result;
                    // A v1 database speaks a key layout this version cannot
                    // read; keeping it would surface as corrupt cache entries
                    // and un-replayable mutations. Start clean instead.
                    if (event.oldVersion > 0 && event.oldVersion < 2) {
                        if (db.objectStoreNames.contains(CACHE_STORE)) db.deleteObjectStore(CACHE_STORE);
                        if (db.objectStoreNames.contains(QUEUE_STORE)) db.deleteObjectStore(QUEUE_STORE);
                    }
                    if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
                    if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE);
                };
                request.onsuccess = () => {
                    const db = request.result;
                    // Another tab asking for a newer version needs this
                    // connection out of the way, or its upgrade blocks forever.
                    db.onversionchange = () => {
                        db.close();
                        this.dbPromise = undefined;
                    };
                    resolve(db);
                };
                // Reset so a transient failure (private browsing quota, a
                // version race with another tab) can be retried instead of
                // poisoning every later call with the same rejection.
                request.onerror = () => {
                    this.dbPromise = undefined;
                    reject(request.error ?? new Error("Failed to open IndexedDB"));
                };
                request.onblocked = () => {
                    this.dbPromise = undefined;
                    reject(new Error("IndexedDB upgrade blocked by another tab"));
                };
            });
        }
        return this.dbPromise;
    }

    private async store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
        const db = await this.open();
        return db.transaction(name, mode).objectStore(name);
    }

    async getCache(key: string): Promise<OfflineCacheEntry | undefined> {
        const store = await this.store(CACHE_STORE, "readonly");
        const entry = await requestToPromise(store.get(key));
        return entry as OfflineCacheEntry | undefined;
    }

    async setCache(key: string, entry: OfflineCacheEntry): Promise<void> {
        const store = await this.store(CACHE_STORE, "readwrite");
        await requestToPromise(store.put(entry, key));
    }

    async setCacheMany(entries: { key: string; entry: OfflineCacheEntry }[]): Promise<void> {
        if (entries.length === 0) return;
        const store = await this.store(CACHE_STORE, "readwrite");
        for (const { key, entry } of entries) store.put(entry, key);
        // One commit for the whole batch: a `find` writing 200 rows must not
        // be 200 round-trips through the transaction queue.
        await transactionDone(store.transaction);
    }

    async deleteCache(keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        const store = await this.store(CACHE_STORE, "readwrite");
        for (const key of keys) store.delete(key);
        await transactionDone(store.transaction);
    }

    async listCache(prefix: string): Promise<{ key: string; cachedAt: number }[]> {
        const store = await this.store(CACHE_STORE, "readonly");
        const [keys, entries] = await Promise.all([
            requestToPromise(store.getAllKeys(prefixRange(prefix))),
            requestToPromise(store.getAll(prefixRange(prefix)))
        ]);
        return keys.map((key, i) => ({
            key: String(key),
            cachedAt: (entries[i] as OfflineCacheEntry)?.cachedAt ?? 0
        }));
    }

    async listCacheEntries(prefix: string): Promise<OfflineCacheRecord[]> {
        const store = await this.store(CACHE_STORE, "readonly");
        const [keys, entries] = await Promise.all([
            requestToPromise(store.getAllKeys(prefixRange(prefix))),
            requestToPromise(store.getAll(prefixRange(prefix)))
        ]);
        return keys.map((key, i) => {
            const entry = entries[i] as OfflineCacheEntry | undefined;
            return { key: String(key), value: entry?.value, cachedAt: entry?.cachedAt ?? 0 };
        });
    }

    async enqueue(key: string, mutation: PendingMutation): Promise<void> {
        const store = await this.store(QUEUE_STORE, "readwrite");
        await requestToPromise(store.put(mutation, key));
    }

    async dequeue(key: string): Promise<void> {
        const store = await this.store(QUEUE_STORE, "readwrite");
        await requestToPromise(store.delete(key));
    }

    async listQueue(prefix: string): Promise<PendingMutation[]> {
        const store = await this.store(QUEUE_STORE, "readonly");
        // getAll on a key range returns values in key order, which is the
        // FIFO guarantee this interface promises.
        const entries = await requestToPromise(store.getAll(prefixRange(prefix)));
        return entries as PendingMutation[];
    }

    async clear(prefix: string): Promise<void> {
        const cache = await this.store(CACHE_STORE, "readwrite");
        await requestToPromise(cache.delete(prefixRange(prefix)));
        const queue = await this.store(QUEUE_STORE, "readwrite");
        await requestToPromise(queue.delete(prefixRange(prefix)));
    }
}
