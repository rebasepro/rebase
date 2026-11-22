/**
 * A cross-tab mutex over `localStorage`, for the browsers that have no Web
 * Locks: Safari before 15.4, pages served over plain http from anything but
 * localhost (Web Locks is secure-context only), and embedded webviews.
 *
 * Without it two tabs on such a browser each replayed the whole offline queue,
 * so every queued write reached the server twice. Creates survived that (the
 * idempotency key dedups them) and deletes did too (a second delete's 404 is
 * taken as done), but an update with `If-Match` came back `412` from its own
 * twin and was reported as a conflict nobody caused.
 *
 * The lease is a `{ holder, until }` record under one key. A tab takes it by
 * writing its own record when the key is empty, expired or already its own,
 * then reading it back after `settleMs`: `localStorage` has no compare-and-set,
 * but every tab reads and writes in one synchronous step, so two tabs can only
 * both write within the time a write takes to reach the other process — far
 * under `settleMs` — and the read-back sees whichever write landed last. Only
 * that tab proceeds. The holder renews the record while it works and removes it
 * when done; a tab that died holding it is outlived by `ttlMs`.
 *
 * It is a weaker guarantee than Web Locks, on purpose kept to what it can
 * promise: a holder whose timers the browser throttles hard enough (a hidden
 * tab can be held to one timer a minute) may see its lease expire mid-replay,
 * and the next tab then replays what is still queued. That costs at most the
 * one write in flight, not the whole queue.
 */

import { unref } from "@rebasepro/utils";

/** The part of `Storage` the lease uses — `localStorage`, or a test double. */
export interface LeaseStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface StorageLeaseOptions {
    /** How long a record stays valid without renewal. */
    ttlMs?: number;
    /** How long to wait before reading a fresh claim back. */
    settleMs?: number;
    /** How often a waiting tab looks again. */
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

interface LeaseRecord {
    holder: string;
    until: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_SETTLE_MS = 50;
const DEFAULT_POLL_MS = 200;

function readRecord(storage: LeaseStorage, key: string): LeaseRecord | null {
    let raw: string | null;
    try {
        raw = storage.getItem(key);
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            parsed !== null && typeof parsed === "object"
            && "holder" in parsed && typeof parsed.holder === "string"
            && "until" in parsed && typeof parsed.until === "number"
        ) {
            return { holder: parsed.holder, until: parsed.until };
        }
    } catch {
        // A record this code cannot read is treated as no record: whoever wrote
        // it is not following this protocol, so it cannot be waited on.
    }
    return null;
}

/**
 * `localStorage` when this page can use it, or `undefined` — a worker has none,
 * and a browser with storage blocked throws on the mere access.
 */
export function browserLeaseStorage(): LeaseStorage | undefined {
    try {
        // A browser's only: touching Node's own `localStorage` prints a warning.
        if (typeof window === "undefined" || typeof localStorage === "undefined") return undefined;
        const storage: LeaseStorage = localStorage;
        // Safari in some private modes exposes the object and throws on write.
        const probe = "rebase-lease-probe";
        storage.setItem(probe, "1");
        storage.removeItem(probe);
        return storage;
    } catch {
        return undefined;
    }
}

/**
 * Run `fn` while holding the lease named `key`, waiting for another holder to
 * finish first. Storage that fails mid-protocol makes the lease unenforceable,
 * and then `fn` runs anyway: a queue that never drains is worse than one that
 * might drain twice.
 */
export async function withStorageLease<T>(
    storage: LeaseStorage,
    key: string,
    holder: string,
    fn: () => Promise<T>,
    options: StorageLeaseOptions = {}
): Promise<T> {
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    const write = (): boolean => {
        try {
            storage.setItem(key, JSON.stringify({ holder, until: now() + ttlMs } satisfies LeaseRecord));
            return true;
        } catch {
            return false;
        }
    };

    for (;;) {
        const current = readRecord(storage, key);
        if (!current || current.until <= now() || current.holder === holder) {
            if (!write()) return fn();
            await sleep(settleMs);
            if (readRecord(storage, key)?.holder === holder) break;
        }
        await sleep(pollMs);
    }

    const renew = setInterval(() => {
        // Renew only a lease still ours: one that expired and was taken by
        // another tab is theirs now, and writing over it would let both run.
        if (readRecord(storage, key)?.holder === holder) write();
    }, Math.max(1, Math.floor(ttlMs / 3)));
    unref(renew);

    try {
        return await fn();
    } finally {
        clearInterval(renew);
        try {
            if (readRecord(storage, key)?.holder === holder) storage.removeItem(key);
        } catch {
            // Left behind, the record expires on its own.
        }
    }
}
