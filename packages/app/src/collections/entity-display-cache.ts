/**
 * The store behind a computed display value.
 *
 * A record's title is asked for far more often than it changes, and by many
 * components at once: a list of fifty rows, each row's relation chips, the
 * breadcrumb above them. Resolving per component is what makes an async display
 * value a bad idea — fifty rows becomes fifty reads, then fifty more on the next
 * render.
 *
 * So resolution is keyed by record *and* role, in-flight calls are shared, and
 * results are kept until something says otherwise. Deliberately not a React
 * thing: the same store answers an imperative caller (an export, a breadcrumb
 * built outside the tree), and it is testable without a renderer.
 */
import type { EntityDisplayRole } from "@rebasepro/cms-types";

type CacheEntry = ({
    /** Set once resolved. `null` means "resolved to nothing", not "unknown". */
    value: unknown;
} | {
    /** Shared by every caller that arrives while the first one is in flight. */
    promise: Promise<unknown>;
    /**
     * What this pair resolved to before the row under it changed, shown until
     * the new answer lands rather than flashing every caller's fallback.
     */
    previous?: { value: unknown };
}) & {
    /**
     * A fingerprint of the row the value (or the call in flight) was computed
     * from, when the caller named one. `undefined` when it did not.
     */
    source?: string;
};

export type EntityDisplayKey = string;

/** The identity of one role of one record, as a cache key. */
export function entityDisplayKey(
    path: string,
    entityId: string | number | undefined,
    role: EntityDisplayRole
): EntityDisplayKey {
    return `${role} ${path} ${entityId ?? ""}`;
}

/**
 * One shared store, so every surface agrees on a record and resolves it once.
 *
 * Module-level rather than a provider: two app instances on one page share a
 * cache keyed by collection path and record id, which *is* the same record.
 * A resolved title is what the signed-in user was allowed to read, though, so
 * the store is emptied with the rest of the session's caches when that user
 * signs out (`clearSessionCaches`).
 *
 * Built on first use rather than at module scope. Importing a module should not
 * construct anything: it runs during SSR where there is nothing to cache, and it
 * made the modules that read this store unimportable from any test that stubs
 * `@rebasepro/app`.
 */
let sharedCache: EntityDisplayCache | undefined;

export function getSharedEntityDisplayCache(): EntityDisplayCache {
    if (!sharedCache) sharedCache = new EntityDisplayCache();
    return sharedCache;
}

export class EntityDisplayCache {

    private readonly entries = new Map<EntityDisplayKey, CacheEntry>();
    private readonly listeners = new Set<() => void>();

    /**
     * The resolved value, or `undefined` when this pair has not been resolved
     * yet. `null` is a resolved absence, and the two must stay distinct: a
     * caller that reads "not yet" as "nothing" flickers its fallback in on every
     * mount.
     */
    peek(key: EntityDisplayKey): unknown | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if ("promise" in entry) return entry.previous ? entry.previous.value : undefined;
        return entry.value;
    }

    /**
     * True while a resolution for this pair is in flight and there is nothing
     * to show meanwhile. Re-resolving after the row changed is not loading: the
     * previous answer stays up until the new one lands.
     */
    isLoading(key: EntityDisplayKey): boolean {
        const entry = this.entries.get(key);
        return Boolean(entry && "promise" in entry && !entry.previous);
    }

    /**
     * Resolve once per record and role. Concurrent callers share the first
     * call's promise; later callers get the cached value with no promise at all.
     *
     * A resolver that throws is recorded as "nothing" rather than retried: the
     * alternative is every render re-running a call that just failed. And it is
     * reported here, which is a correction.
     *
     * It used to say "the caller that saw the rejection is the one that logs
     * it", and `useEntityDisplay` duly attached a `.catch()` that warned. But
     * both failure paths below swallow and return a *resolved* promise, so that
     * catch could never run — the two halves each did the reasonable thing and
     * between them the log was unreachable. A resolver that blew up produced a
     * blank chip and total silence, which is the failure mode
     * `EntityDisplayResolver`'s own contract ("treated as `undefined` and logged
     * once") exists to rule out.
     *
     * Reporting belongs here for the reason the caller could not do it: this is
     * the one place that runs exactly once per key, so "once" is a property of
     * the code rather than a hope about how many components mount.
     */
    resolve(key: EntityDisplayKey, resolver: () => unknown, source?: unknown): Promise<unknown> {
        // `source` is the row the resolver reads. An answer computed from a
        // different row is out of date — the record was saved, an action wrote
        // to it, a realtime update arrived — so it is resolved again. Without
        // it a computed subtitle kept saying "7 in stock" after a restock for
        // as long as the page stayed open.
        const fingerprint = source === undefined ? undefined : fingerprintOf(source);
        const entry = this.entries.get(key);
        if (entry && (fingerprint === undefined || entry.source === fingerprint)) {
            return "promise" in entry ? entry.promise : Promise.resolve(entry.value);
        }
        const previous = !entry ? undefined : "promise" in entry ? entry.previous : { value: entry.value };

        let produced: unknown;
        try {
            produced = resolver();
        } catch (error: unknown) {
            this.fail(key, error, fingerprint);
            return Promise.resolve(null);
        }

        // A synchronous resolver never enters the loading state. Putting it
        // through one would render every caller's fallback for a frame, for
        // nothing.
        if (!isPromise(produced)) {
            const value = normalize(produced);
            this.set(key, value, fingerprint);
            return Promise.resolve(value);
        }

        // Only the latest call for a pair may write its answer: a slow one for
        // the old row must not land over the one for the new.
        const isLatest = () => {
            const current = this.entries.get(key);
            return Boolean(current && "promise" in current && current.promise === promise);
        };
        const promise: Promise<unknown> = produced
            .then(resolved => {
                const value = normalize(resolved);
                if (isLatest()) this.set(key, value, fingerprint);
                return value;
            })
            .catch((error: unknown) => {
                if (isLatest()) this.fail(key, error, fingerprint);
                return null;
            });

        this.entries.set(key, { promise, previous, source: fingerprint });
        return promise;
    }

    /**
     * Drop what is known about a record, so the next ask resolves again. Called
     * after a write: the row that just saved may be called something else now.
     */
    invalidate(path: string, entityId?: string | number): void {
        const suffix = ` ${path} ${entityId ?? ""}`;
        let changed = false;
        for (const key of [...this.entries.keys()]) {
            // `undefined` id means the whole collection — after an import, or a
            // locale switch that changes what every title in it reads.
            const matches = entityId === undefined
                ? key.includes(` ${path} `) || key.endsWith(` ${path} `)
                : key.endsWith(suffix);
            if (matches) {
                this.entries.delete(key);
                changed = true;
            }
        }
        if (changed) this.emit();
    }

    /** Drop everything. The user signed out, or the app swapped datasource. */
    clear(): void {
        if (this.entries.size === 0) return;
        this.entries.clear();
        this.emit();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private set(key: EntityDisplayKey, value: unknown, source?: string): void {
        this.entries.set(key, { value, source });
        this.emit();
    }

    /**
     * Record a failed resolution as "nothing", and say so once.
     *
     * The key is the message: it is `<role> <path> <id>`, which is exactly what a
     * reader needs to find the resolver that blew up. A warning with no key would
     * tell them a display resolver failed somewhere in a list of fifty rows.
     *
     * `console.warn` rather than a thrown error, because this runs while a row is
     * rendering: the contract is that a title which cannot be fetched must not
     * take down the row that shows it.
     */
    private fail(key: EntityDisplayKey, error: unknown, source?: string): void {
        console.warn(`[rebase] Could not resolve display value for ${key}:`, error);
        this.set(key, null, source);
    }

    private emit(): void {
        for (const listener of [...this.listeners]) listener();
    }
}

/**
 * Empty strings and empty arrays are absences, not values — a title of `"  "`
 * would otherwise beat the derived one and render as a blank heading.
 */
function normalize(value: unknown): unknown {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (Array.isArray(value)) return value.length > 0 ? value : null;
    return value;
}

/**
 * The row a resolver read, as something comparable. A row is plain data from
 * the server, so its JSON is its identity; one that cannot be serialized
 * (a cycle) is never treated as changed, which is the behaviour of a caller
 * that names no row at all.
 */
function fingerprintOf(source: unknown): string | undefined {
    try {
        return JSON.stringify(source);
    } catch {
        return undefined;
    }
}

function isPromise(value: unknown): value is Promise<unknown> {
    return typeof (value as Promise<unknown> | undefined)?.then === "function";
}
