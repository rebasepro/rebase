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
import type { EntityDisplayRole } from "@rebasepro/admin-types";

type CacheEntry = {
    /** Set once resolved. `null` means "resolved to nothing", not "unknown". */
    value: unknown;
} | {
    /** Shared by every caller that arrives while the first one is in flight. */
    promise: Promise<unknown>;
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
        if (!entry || "promise" in entry) return undefined;
        return entry.value;
    }

    /** True while a resolution for this pair is in flight. */
    isLoading(key: EntityDisplayKey): boolean {
        const entry = this.entries.get(key);
        return Boolean(entry && "promise" in entry);
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
    resolve(key: EntityDisplayKey, resolver: () => unknown): Promise<unknown> {
        const entry = this.entries.get(key);
        if (entry) {
            return "promise" in entry ? entry.promise : Promise.resolve(entry.value);
        }

        let produced: unknown;
        try {
            produced = resolver();
        } catch (error: unknown) {
            this.fail(key, error);
            return Promise.resolve(null);
        }

        // A synchronous resolver never enters the loading state. Putting it
        // through one would render every caller's fallback for a frame, for
        // nothing.
        if (!isPromise(produced)) {
            const value = normalize(produced);
            this.set(key, value);
            return Promise.resolve(value);
        }

        const promise = produced
            .then(resolved => {
                const value = normalize(resolved);
                this.set(key, value);
                return value;
            })
            .catch((error: unknown) => {
                this.fail(key, error);
                return null;
            });

        this.entries.set(key, { promise });
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

    private set(key: EntityDisplayKey, value: unknown): void {
        this.entries.set(key, { value });
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
    private fail(key: EntityDisplayKey, error: unknown): void {
        console.warn(`[rebase] Could not resolve display value for ${key}:`, error);
        this.set(key, null);
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

function isPromise(value: unknown): value is Promise<unknown> {
    return typeof (value as Promise<unknown> | undefined)?.then === "function";
}
