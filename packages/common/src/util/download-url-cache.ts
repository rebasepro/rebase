import type { DownloadConfig } from "@rebasepro/types";

/**
 * What a storage source resolved for one path, and how long it may be reused.
 */
export interface ResolvedDownload {
    config: DownloadConfig;
    /**
     * Epoch milliseconds after which `config.url` must not be handed out (its
     * download token expires). Absent: it never expires — a public file's
     * permanent URL.
     */
    expiresAt?: number;
    /** Hand the answer to the callers waiting for it, but do not keep it (a 404). */
    noStore?: boolean;
}

export interface DownloadUrlCacheOptions {
    /** Entries kept; past it the least recently used goes. Default 2,000. */
    maxEntries?: number;
    /** Clock, for tests. */
    now?: () => number;
}

/**
 * The signed-URL cache behind a storage source's `getSignedUrl`.
 *
 * A collection view mounts one preview per row in the same tick, rows share
 * files, and every miss is a `/storage/metadata` request against the user's
 * rate-limit budget. So:
 *
 *  - concurrent lookups of one key share one load — a cache written only when
 *    a response lands is still empty while the burst goes out;
 *  - an answer is reused until its `expiresAt` (the download token's life), and
 *    never after;
 *  - at most `maxEntries` are kept, least recently used dropped first, so a long
 *    session browsing thousands of files does not grow without bound;
 *  - a failed load is not kept: the next lookup asks again.
 *
 * The key is whatever the source passes — its own path (and bucket). The cache
 * belongs to ONE source instance, and its entries to ONE user: a private URL
 * carries a token minted for the user who asked. A source outlives its user —
 * a sign-out, or another user signing in, in the same tab — so it names whose
 * entries it is holding with {@link claim} before every lookup, and a different
 * owner empties the cache.
 */
export interface DownloadUrlCache {
    get(key: string, load: () => Promise<ResolvedDownload>): Promise<DownloadConfig>;
    /** The cached config for `key` if it is still valid, without loading. */
    peek(key: string): DownloadConfig | undefined;
    /** Remember an answer obtained some other way. */
    set(key: string, resolved: ResolvedDownload): void;
    delete(key: string): void;
    /**
     * Forget everything, as a hard boundary: a load still in flight is not
     * stored when it lands, and a lookup made after this starts its own load
     * rather than waiting on one started before.
     */
    clear(): void;
    /**
     * Say whose lookups follow — the user, or the credential the loads are
     * made with. The same owner keeps the entries; a different one
     * {@link clear}s them first. Returns whether it did.
     */
    claim(owner: string): boolean;
    /** The last owner {@link claim}ed, if any. */
    readonly owner: string | undefined;
    readonly size: number;
}

export const DEFAULT_DOWNLOAD_URL_CACHE_ENTRIES = 2_000;

export function createDownloadUrlCache(options: DownloadUrlCacheOptions = {}): DownloadUrlCache {
    const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_DOWNLOAD_URL_CACHE_ENTRIES);
    const now = options.now ?? Date.now;
    // A Map iterates in insertion order: re-inserting on a hit makes the first
    // key the least recently used one.
    const entries = new Map<string, { config: DownloadConfig; expiresAt?: number }>();
    const inFlight = new Map<string, Promise<DownloadConfig>>();
    // Bumped by every clear(): a load stores its answer only if none happened
    // since it started, so a URL minted for the previous owner never lands.
    let generation = 0;
    let owner: string | undefined;

    function clear(): void {
        entries.clear();
        inFlight.clear();
        generation++;
    }

    function valid(key: string): DownloadConfig | undefined {
        const entry = entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt !== undefined && entry.expiresAt <= now()) {
            entries.delete(key);
            return undefined;
        }
        entries.delete(key);
        entries.set(key, entry);
        return entry.config;
    }

    function store(key: string, resolved: ResolvedDownload): void {
        if (resolved.noStore) return;
        entries.delete(key);
        entries.set(key, { config: resolved.config, expiresAt: resolved.expiresAt });
        for (const oldest of entries.keys()) {
            if (entries.size <= maxEntries) break;
            entries.delete(oldest);
        }
    }

    return {
        get(key, load) {
            const cached = valid(key);
            if (cached) return Promise.resolve(cached);
            const pending = inFlight.get(key);
            if (pending) return pending;

            const startedIn = generation;
            const request: Promise<DownloadConfig> = load()
                .then(resolved => {
                    if (generation === startedIn) store(key, resolved);
                    return resolved.config;
                })
                .finally(() => {
                    if (inFlight.get(key) === request) inFlight.delete(key);
                });
            inFlight.set(key, request);
            return request;
        },
        peek: valid,
        set: store,
        delete(key) {
            entries.delete(key);
        },
        clear,
        claim(next) {
            if (next === owner) return false;
            owner = next;
            clear();
            return true;
        },
        get owner() {
            return owner;
        },
        get size() {
            return entries.size;
        }
    };
}

/**
 * Run at most `max` of the tasks given to the returned function at once; the
 * rest wait in order. For the requests a storage source makes per file, so a
 * folder of a thousand files is not a thousand simultaneous requests.
 */
export function createConcurrencyLimit(max: number): <T>(task: () => Promise<T>) => Promise<T> {
    const limit = Math.max(1, max);
    let running = 0;
    const waiting: (() => void)[] = [];

    function next(): void {
        running--;
        waiting.shift()?.();
    }

    return function run<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const start = () => {
                running++;
                let result: Promise<T>;
                try {
                    result = task();
                } catch (error) {
                    result = Promise.reject(error);
                }
                result.then(resolve, reject).finally(next);
            };
            if (running < limit) start();
            else waiting.push(start);
        });
    };
}

/** Requests for signed URLs a storage source keeps open at once. */
export const DOWNLOAD_URL_CONCURRENCY = 8;
