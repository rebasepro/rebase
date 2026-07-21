/**
 * Persistence backends for the SDK's offline support.
 *
 * The store is a dumb, namespaced key/value surface with two areas: a read
 * cache (query results, LRU-evicted) and a mutation queue (writes made while
 * offline, replayed in order). All scoping — per-user prefixes, sequence
 * numbers, key layout — is owned by the `OfflineManager`; the store only
 * promises that `listQueue` returns entries in lexicographic key order, which
 * is what makes the padded sequence numbers a FIFO.
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

/**
 * A write made while offline, waiting to be replayed against the server.
 *
 * `seq` orders the queue globally (not per collection): a create in one
 * collection may be the parent a later insert in another references, so
 * replay must preserve the order the app issued the writes in.
 */
export interface PendingMutation {
    seq: number;
    collection: string;
    type: "create" | "createMany" | "update" | "delete";
    /** Target row id for update/delete, and the (client-generated) id of an offline create. */
    id?: string | number;
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
}

export interface OfflineStore {
    getCache(key: string): Promise<OfflineCacheEntry | undefined>;
    setCache(key: string, entry: OfflineCacheEntry): Promise<void>;
    deleteCache(keys: string[]): Promise<void>;
    /** Every cache key starting with `prefix`, with its write time (for eviction). */
    listCache(prefix: string): Promise<{ key: string; cachedAt: number }[]>;

    enqueue(key: string, mutation: PendingMutation): Promise<void>;
    dequeue(key: string): Promise<void>;
    /** Queued mutations whose key starts with `prefix`, in lexicographic key order. */
    listQueue(prefix: string): Promise<PendingMutation[]>;

    /** Remove every cache entry and queued mutation whose key starts with `prefix`. */
    clear(prefix: string): Promise<void>;
}

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

const IDB_NAME = "rebase-offline";
const IDB_VERSION = 1;
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

/**
 * IndexedDB-backed store — the browser default, so cached reads and queued
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
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
                    if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE);
                };
                request.onsuccess = () => resolve(request.result);
                // Reset so a transient failure (private browsing quota, a
                // version race with another tab) can be retried instead of
                // poisoning every later call with the same rejection.
                request.onerror = () => {
                    this.dbPromise = undefined;
                    reject(request.error ?? new Error("Failed to open IndexedDB"));
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

    async deleteCache(keys: string[]): Promise<void> {
        if (keys.length === 0) return;
        const store = await this.store(CACHE_STORE, "readwrite");
        await Promise.all(keys.map((key) => requestToPromise(store.delete(key))));
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
